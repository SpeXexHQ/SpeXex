/*
 * End-to-end two-chain OTC swap proof — v2 (refunds + adaptor settlement).
 *
 * Runs the REAL wallet app (unmodified index.html + js/) in two headless
 * Chromium contexts — Alice (sells the asset, holds the adaptor secret) and
 * Bob (buys it with the payment coin) — wired to mock chain APIs that independently validate
 * every broadcast transaction (bitcoinjs-lib sighash + noble secp256k1,
 * nLockTime finality, min-relay fees, dust) and a real local NIP-01 relay.
 *
 * SCENARIO=happy (default):
 *   1. In-page OTC validation suites pass.
 *   2. Both sides PLAN (sign, don't broadcast) funding, exchange pre-signed
 *      timelocked refunds, exchange VERIFIED adaptor signatures → PREPARED.
 *   3. Alice's fully-signed ROD refund is REJECTED as non-final before its
 *      lock height (proves the timelock actually protects the funds).
 *   4. Timeline proves PREPARED came before any funding broadcast.
 *   5. ROD funding txid matches the planned txid; confirmations gated.
 *   6. Alice claims LTC with her sig + Bob's COMPLETED adaptor signature.
 *   7. Bob recovers the adaptor secret FROM THE REAL SIGNATURE, verifies it
 *      against the adaptor point, and claims ROD with Alice's completed sig.
 *   8. Zero normal-signature messages on the relay (settlement is atomic).
 *   9. Both sessions COMPLETE; money lands at the payout addresses.
 *
 * SCENARIO=refund:
 *   1. Runs through PREPARED; Alice broadcasts ROD funding.
 *   2. Bob requires 3 ROD confirmations (mock height frozen → he never funds
 *      LTC — proves the confirmation gate) and then disappears.
 *   3. Alice's refund is rejected as non-final before the lock height.
 *   4. Mock chain advances past assetRefundLockHeight → Alice's automation
 *      broadcasts the pre-signed refund; the mock validates locktime + both
 *      CHECKMULTISIG signatures; funds return to Alice; state = REFUNDED.
 *
 * RELOAD_TEST=1 (with SCENARIO=happy): reloads Alice after PREPARED and
 * requires the swap to still complete (persistence + relay replay).
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const CHAIN_REGISTRY = require('../../js/chain-registry.js');
const { MockChain, rodApiServer, esploraServer, blockcypherServer, blockchairServer, nostrRelay, staticServer } = require('./mock-infra');

const APP_DIR = process.env.APP_DIR || path.resolve(__dirname, '..', '..');
const SCENARIO = process.env.SCENARIO || 'happy';
const HARNESS_REPEAT_INDEX = process.env.HARNESS_REPEAT_INDEX || '';
if (HARNESS_REPEAT_INDEX && !/^[1-9][0-9]*$/.test(HARNESS_REPEAT_INDEX)) {
  throw new Error('HARNESS_REPEAT_INDEX must be a positive integer');
}
const REPORT_REPEAT_SUFFIX = HARNESS_REPEAT_INDEX ? `-repeat-${HARNESS_REPEAT_INDEX}` : '';
/* Asset/payment are per-swap roles. ALT_CHAIN remains a compatibility alias
   for older invocations, but no test role is structurally tied to ROD. */
const ASSET = (process.env.ASSET_CHAIN || 'ROD').toUpperCase();
const PAYMENT = (process.env.PAYMENT_CHAIN || process.env.ALT_CHAIN || 'LTC').toUpperCase();
const ALT = PAYMENT;
const SUPPORTED_SWAP_CHAINS = CHAIN_REGISTRY.swapCodes();
if (!SUPPORTED_SWAP_CHAINS.includes(ASSET) || !SUPPORTED_SWAP_CHAINS.includes(PAYMENT) || ASSET === PAYMENT) {
  throw new Error(
    `Unsupported settlement pair ${ASSET}/${PAYMENT}; distinct certified chains are ` +
    `${SUPPORTED_SWAP_CHAINS.join(', ')}`
  );
}

const MOCK_SERVER_BY_API_TYPE = {
  rod: rodApiServer,
  esplora: esploraServer,
  blockcypher: blockcypherServer,
  blockchair: blockchairServer
};
const MOCK_API_PATH_BY_TYPE = { rod: '', esplora: '/api', blockcypher: '', blockchair: '' };

function decimalToBaseUnits(value) {
  const parts = String(value).split('.');
  return Number(parts[0]) * 1e8 + Number(((parts[1] || '') + '00000000').slice(0, 8));
}

function harnessProfile(code) {
  const profile = CHAIN_REGISTRY.getProfile(code);
  const swap = profile.swap;
  const startServer = MOCK_SERVER_BY_API_TYPE[profile.api.type];
  if (!startServer) {
    throw new Error(`Certified chain ${code} uses ${profile.api.type}, but the proof harness has no mock server for that API type`);
  }
  return {
    amount: swap.certification.testAmount,
    claimFee: decimalToBaseUnits(swap.fees.claim),
    refundBlocks: swap.refundBlocks.payment,
    assetRefundBlocks: swap.refundBlocks.asset,
    confirmations: swap.confirmations,
    apiType: profile.api.type,
    apiPath: MOCK_API_PATH_BY_TYPE[profile.api.type] || '',
    startServer: (chain, port) => startServer(chain, port)
  };
}

const CONTROL_PROFILE = harnessProfile('ROD');
const ROD_PROFILE = harnessProfile(ASSET);
const ALT_PROFILE = harnessProfile(ALT);

const PORTS = { app: 9300, rod: 9301, asset: 9302, relay: 9303, alt: 9304 };
const ROD_AMOUNT = ROD_PROFILE.amount;
const ALT_AMOUNT = ALT_PROFILE.amount;
const START_HEIGHT = 500000;
const RELEASE_HEIGHT = 500002;
const REFUND_ROD_BLOCKS = ROD_PROFILE.assetRefundBlocks;
const PAYMENT_REFUND_BLOCKS = ALT_PROFILE.refundBlocks;
const ROD_CLAIM_FEE = ROD_PROFILE.claimFee;
const ALT_CLAIM_FEE = ALT_PROFILE.claimFee;
const ASSET_REFUND_FEE = decimalToBaseUnits(CHAIN_REGISTRY.getProfile(ASSET).swap.fees.refund);
const ALT_AMOUNT_SATS = Math.round(parseFloat(ALT_AMOUNT) * 1e8);
const PROTOCOL_STAGE_TIMEOUT_MS = Number(process.env.PROTOCOL_STAGE_TIMEOUT_MS || 45000);
if (!Number.isSafeInteger(PROTOCOL_STAGE_TIMEOUT_MS) || PROTOCOL_STAGE_TIMEOUT_MS < 5000) {
  throw new Error('PROTOCOL_STAGE_TIMEOUT_MS must be an integer of at least 5000');
}

const results = { steps: [], ok: true };
const runtime = {
  browser: null,
  alice: null,
  bob: null,
  rodChain: null,
  controlRodChain: null,
  paymentChain: null,
  relay: null,
  servers: [],
  swapId: '',
  browserIssues: [],
  reloadAbortUntil: {},
  expectedReloadAborts: []
};
function step(name, ok, detail) {
  results.steps.push({ name, ok, detail: detail || '' });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) results.ok = false;
}

function expectedTransientApiResponse(urlValue, status) {
  if (status !== 404) return false;
  const url = new URL(urlValue);
  if (url.hostname !== '127.0.0.1' || ![PORTS.asset, PORTS.alt].includes(Number(url.port))) return false;
  return /^\/api\/tx\/[0-9a-f]{64}(?:\/hex)?$/i.test(url.pathname) ||
    /^\/txs\/[0-9a-f]{64}$/i.test(url.pathname);
}

function expectedDeliberateReloadAbort(label, request) {
  if (process.env.RELOAD_TEST !== '1' || Date.now() > (runtime.reloadAbortUntil[label] || 0)) return false;
  const failure = request.failure();
  if (!failure || failure.errorText !== 'net::ERR_ABORTED') return false;
  const url = new URL(request.url());
  return url.hostname === '127.0.0.1' &&
    [PORTS.rod, PORTS.asset, PORTS.alt].includes(Number(url.port));
}

function rejectUnsafeChromiumArgs(args) {
  const unsafe = (args || []).find((arg) => /^--single-process(?:=|$)/.test(String(arg)));
  if (unsafe) {
    throw new Error(
      `Unsafe Chromium argument ${unsafe}: --single-process can share state between ` +
      'the Alice and Bob test contexts and manufacture protocol deadlocks'
    );
  }
}

function resolveChromiumLaunchOptions() {
  const configuredExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PW_CHROMIUM_EXECUTABLE_PATH;
  let args;
  if (process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON) {
    args = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON);
    if (!Array.isArray(args)) throw new Error('PLAYWRIGHT_CHROMIUM_ARGS_JSON must be a JSON array');
  }
  rejectUnsafeChromiumArgs(args);
  if (configuredExecutablePath) {
    return { executablePath: configuredExecutablePath, args };
  }

  const pinnedExecutablePath = '/opt/pw-browsers/chromium';
  if (fs.existsSync(pinnedExecutablePath)) {
    return { executablePath: pinnedExecutablePath, args };
  }

  return args ? { args } : {};
}

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('Timeout waiting for: ' + label);
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function sessionProtocolState(page, swapId) {
  return page.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    if (!s) return { exists: false };
    return {
      exists: true,
      role: s.role || '',
      state: s.state || '',
      localAccepted: !!s.localAccepted,
      remoteAccepted: !!s.remoteAccepted,
      bilateralReady: !!s.bilateralReady,
      adaptorPoint: s.adaptorPoint || '',
      plannedAssetFunding: !!(s.plannedAssetFunding && s.plannedAssetFunding.txid),
      plannedPaymentFunding: !!(s.plannedPaymentFunding && s.plannedPaymentFunding.txid),
      assetRefundLocalSig: !!(s.assetRefund && s.assetRefund.localSig),
      assetRefundSigned: !!(s.assetRefund && s.assetRefund.signedHex),
      assetRefundCosigned: !!s.assetRefundCosigned,
      paymentRefundLocalSig: !!(s.paymentRefund && s.paymentRefund.localSig),
      paymentRefundSigned: !!(s.paymentRefund && s.paymentRefund.signedHex),
      paymentRefundCosigned: !!s.paymentRefundCosigned,
      localAssetAdaptorSignature: !!s.localAssetAdaptorSignature,
      remoteAssetAdaptorSignature: !!s.remoteAssetAdaptorSignature,
      localPaymentAdaptorSignature: !!s.localPaymentAdaptorSignature,
      remotePaymentAdaptorSignature: !!s.remotePaymentAdaptorSignature,
      localPrepared: !!s.localPrepared,
      remotePrepared: !!s.remotePrepared,
      pending: {
        assetRefundSig: !!s._pendingAssetRefundSig,
        assetRefundCosig: !!s._pendingAssetRefundCosig,
        paymentRefundSig: !!s._pendingPaymentRefundSig,
        paymentRefundCosig: !!s._pendingPaymentRefundCosig,
        rodAdaptorSig: !!s._pendingRodAdaptorSig,
        altAdaptorSig: !!s._pendingAltAdaptorSig
      }
    };
  }, swapId);
}

function relayDiagnostics(swapId) {
  const byType = {};
  const byPubkey = {};
  const events = runtime.relay && Array.isArray(runtime.relay.events) ? runtime.relay.events : [];
  for (const event of events) {
    let envelope;
    try { envelope = JSON.parse(event.content); } catch (error) { continue; }
    if (swapId && envelope.swapId !== swapId) continue;
    const type = envelope.type || 'unknown';
    const pubkey = event.pubkey || 'missing';
    byType[type] = (byType[type] || 0) + 1;
    byPubkey[pubkey] = (byPubkey[pubkey] || 0) + 1;
  }
  return { total: Object.values(byType).reduce((sum, count) => sum + count, 0), byType, byPubkey };
}

function missingPreparedPrerequisites(session) {
  if (!session) return ['session'];
  const missing = [];
  const need = (condition, name) => { if (!condition) missing.push(name); };
  need(session.localAccepted, 'localAccepted');
  need(session.remoteAccepted, 'remoteAccepted');
  need(session.bilateralReady, 'bilateralReady');
  need(session.adaptorPoint, 'adaptorPoint');
  need(session.plannedAssetFunding, 'plannedAssetFunding');
  need(session.plannedPaymentFunding, 'plannedPaymentFunding');
  if (session.role === 'seller') {
    need(session.assetRefundSigned, 'assetRefund.signedHex');
    need(session.paymentRefundCosigned, 'paymentRefundCosigned');
    need(session.localAssetAdaptorSignature, 'localAssetAdaptorSignature');
    need(session.remotePaymentAdaptorSignature, 'remotePaymentAdaptorSignature');
  } else if (session.role === 'buyer') {
    need(session.paymentRefundSigned, 'paymentRefund.signedHex');
    need(session.assetRefundCosigned, 'assetRefundCosigned');
    need(session.localPaymentAdaptorSignature, 'localPaymentAdaptorSignature');
    need(session.remoteAssetAdaptorSignature, 'remoteAssetAdaptorSignature');
  } else {
    missing.push('valid role');
  }
  need(session.localPrepared, 'localPrepared');
  return missing;
}

async function waitForProtocolStage(label, predicate, timeoutMs) {
  const deadline = timeoutMs || PROTOCOL_STAGE_TIMEOUT_MS;
  const startedAt = Date.now();
  try {
    const state = await waitFor(async () => {
      const [aliceState, bobState] = await Promise.all([
        sessionProtocolState(runtime.alice, runtime.swapId),
        sessionProtocolState(runtime.bob, runtime.swapId)
      ]);
      return predicate(aliceState, bobState) ? { alice: aliceState, bob: bobState } : null;
    }, deadline, `protocol stage "${label}"`);
    step(`protocol stage: ${label}`, true, `${Date.now() - startedAt} ms`);
    return state;
  } catch (error) {
    let aliceState = null;
    let bobState = null;
    try { aliceState = await sessionProtocolState(runtime.alice, runtime.swapId); } catch (diagnosticError) {}
    try { bobState = await sessionProtocolState(runtime.bob, runtime.swapId); } catch (diagnosticError) {}
    error.message += '\nProtocol stage: ' + label;
    error.message += '\nAlice missing: ' + JSON.stringify(missingPreparedPrerequisites(aliceState));
    error.message += '\nBob missing: ' + JSON.stringify(missingPreparedPrerequisites(bobState));
    error.message += '\nAlice protocol state: ' + JSON.stringify(aliceState);
    error.message += '\nBob protocol state: ' + JSON.stringify(bobState);
    error.message += '\nRelay diagnostics: ' + JSON.stringify(relayDiagnostics(runtime.swapId));
    step(`protocol stage: ${label}`, false, `${Date.now() - startedAt} ms`);
    throw error;
  }
}

async function sessionDiagnostics(page, swapId) {
  return page.evaluate((id) => {
    const session = rodOtc.engine.restoreLive(id);
    const bool = (value) => !!value;
    const funding = (value) => value ? {
      txid: value.txid || '',
      vout: value.vout,
      value: value.value,
      amount: value.amount,
      hasTxhex: !!value.txhex
    } : null;
    const refund = (value) => value ? {
      lockHeight: value.lockHeight,
      txid: value.txid || '',
      hasLocalSig: !!value.localSig,
      hasRemoteSig: !!value.remoteSig,
      hasSignedHex: !!value.signedHex
    } : null;
    const pending = session ? {
      assetRefundSig: bool(session._pendingAssetRefundSig),
      assetRefundCosig: bool(session._pendingAssetRefundCosig),
      paymentRefundSig: bool(session._pendingPaymentRefundSig),
      paymentRefundCosig: bool(session._pendingPaymentRefundCosig),
      rodAdaptorSig: bool(session._pendingRodAdaptorSig),
      altAdaptorSig: bool(session._pendingAltAdaptorSig)
    } : {};
    return {
      flash: $('#otcFlash').text(),
      eventLog: $('#otcLog').text(),
      contextId: localStorage.getItem('rodOtcHarnessContextId') || '',
      session: session ? {
        role: session.role || '',
        state: session.state,
        localAccepted: !!session.localAccepted,
        remoteAccepted: !!session.remoteAccepted,
        bilateralReady: !!session.bilateralReady,
        localPrepared: !!session.localPrepared,
        remotePrepared: !!session.remotePrepared,
        hasAdaptorPoint: !!session.adaptorPoint,
        plannedAssetFunding: funding(session.plannedAssetFunding),
        plannedPaymentFunding: funding(session.plannedPaymentFunding),
        assetRefund: refund(session.assetRefund),
        paymentRefund: refund(session.paymentRefund),
        assetRefundCosigned: !!session.assetRefundCosigned,
        paymentRefundCosigned: !!session.paymentRefundCosigned,
        hasLocalRodAdaptorSignature: !!session.localAssetAdaptorSignature,
        hasRemoteRodAdaptorSignature: !!session.remoteAssetAdaptorSignature,
        hasLocalAltAdaptorSignature: !!session.localPaymentAdaptorSignature,
        hasRemoteAltAdaptorSignature: !!session.remotePaymentAdaptorSignature,
        pending,
        localNostrPubkey: session.localNostrPubkey || '',
        remoteNostrPubkey: session.remoteNostrPubkey || '',
        sellerIdentity: session.terms && session.terms.seller || '',
        buyerIdentity: session.terms && session.terms.buyer || '',
        refundSafetyFault: session._refundSafetyFault || '',
        automationErrors: session._automationErrors || {},
        timeline: session.timeline || [],
        log: session._log || []
      } : null
    };
  }, swapId);
}

async function assertContextStorageIsolation(alice, bob, aliceContextId, bobContextId) {
  const aliceProbe = 'alice-' + crypto.randomBytes(12).toString('hex');
  const bobProbe = 'bob-' + crypto.randomBytes(12).toString('hex');

  await alice.evaluate((value) => localStorage.setItem('rodOtcHarnessIsolationProbe', value), aliceProbe);
  const bobSawAlice = await bob.evaluate(() => localStorage.getItem('rodOtcHarnessIsolationProbe'));
  await alice.evaluate(() => localStorage.removeItem('rodOtcHarnessIsolationProbe'));

  await bob.evaluate((value) => localStorage.setItem('rodOtcHarnessIsolationProbe', value), bobProbe);
  const aliceSawBob = await alice.evaluate(() => localStorage.getItem('rodOtcHarnessIsolationProbe'));
  await bob.evaluate(() => localStorage.removeItem('rodOtcHarnessIsolationProbe'));

  const [aliceId, bobId] = await Promise.all([
    alice.evaluate(() => localStorage.getItem('rodOtcHarnessContextId')),
    bob.evaluate(() => localStorage.getItem('rodOtcHarnessContextId'))
  ]);
  if (bobSawAlice !== null || aliceSawBob !== null ||
      aliceId !== aliceContextId || bobId !== bobContextId || aliceId === bobId) {
    throw new Error('Browser context isolation preflight failed: Alice and Bob do not have independent localStorage');
  }
  step('Alice and Bob browser storage is isolated', true);
}

async function assertPeerIdentityIsolation(alice, bob, aliceWallet, bobWallet, aliceXpub, bobXpub) {
  const identityFor = (page, wallet) => page.evaluate((wif) => {
    const identity = rodOtc.nostr.identityFromWif(wif);
    return {
      nostrPubkey: identity.pubkey || '',
      contextId: localStorage.getItem('rodOtcHarnessContextId') || '',
      liveSwapCount: Object.keys(rodOtc.engine.loadLive()).length
    };
  }, wallet.wif);
  const [aliceIdentity, bobIdentity] = await Promise.all([
    identityFor(alice, aliceWallet),
    identityFor(bob, bobWallet)
  ]);
  const isolated =
    aliceWallet.address !== bobWallet.address &&
    aliceWallet.wif !== bobWallet.wif &&
    aliceXpub && bobXpub && aliceXpub !== bobXpub &&
    aliceIdentity.nostrPubkey && bobIdentity.nostrPubkey &&
    aliceIdentity.nostrPubkey !== bobIdentity.nostrPubkey &&
    aliceIdentity.contextId !== bobIdentity.contextId &&
    aliceIdentity.liveSwapCount === 0 && bobIdentity.liveSwapCount === 0;
  if (!isolated) {
    throw new Error('Peer identity isolation preflight failed: wallet, xpub, Nostr key, or session state is shared');
  }
  step('Alice and Bob wallet, xpub, Nostr identity, and initial session state are isolated', true);
}

async function main() {
  const rodChain = new MockChain(ASSET);
  const paymentChain = new MockChain(ALT);
  const controlRodChain = ASSET === 'ROD' ? rodChain : (ALT === 'ROD' ? paymentChain : new MockChain('ROD'));
  runtime.rodChain = rodChain;
  runtime.paymentChain = paymentChain;
  runtime.controlRodChain = controlRodChain;
  rodChain.height = START_HEIGHT;
  paymentChain.height = START_HEIGHT;
  controlRodChain.height = START_HEIGHT;
  runtime.servers.push(await rodApiServer(controlRodChain, PORTS.rod));
  if (ASSET !== 'ROD') runtime.servers.push(await ROD_PROFILE.startServer(rodChain, PORTS.asset));
  if (ALT !== 'ROD') runtime.servers.push(await ALT_PROFILE.startServer(paymentChain, PORTS.alt));
  const relay = nostrRelay(PORTS.relay);
  runtime.relay = relay;
  runtime.servers.push(await staticServer(APP_DIR, PORTS.app));
  console.log(`mock servers up · scenario=${SCENARIO} · pair=${ASSET}/${ALT} · app=${APP_DIR}`);

  const assetConfirmationsCfg = SCENARIO === 'refund' ? 3 : 1;

  const browser = await chromium.launch(resolveChromiumLaunchOptions());
  runtime.browser = browser;
  const mkContext = async (label) => {
    const contextId = `${label}-${process.pid}-${crypto.randomBytes(12).toString('hex')}`;
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript(({ rodPort, assetPort, altPort, relayPort, controlAssetRefundBlocks, controlPaymentRefundBlocks, controlConfirmations, assetCode, assetType, assetPath, assetConfirmations, altCode, altType, altPath, assetRefundBlocks, assetPaymentRefundBlocks, paymentAssetRefundBlocks, paymentRefundBlocks, paymentConfirmations, harnessContextId }) => {
      const chainUrl = (code, port, suffix) => code === 'ROD'
        ? 'http://127.0.0.1:' + rodPort
        : 'http://127.0.0.1:' + port + suffix;
      const chains = {
        ROD: {
          apiUrl: 'http://127.0.0.1:' + rodPort,
          apiType: 'rod',
          refundBlocks: { asset: controlAssetRefundBlocks, payment: controlPaymentRefundBlocks },
          confirmations: controlConfirmations
        }
      };
      chains[assetCode] = {
        apiUrl: chainUrl(assetCode, assetPort, assetPath),
        apiType: assetType,
        refundBlocks: { asset: assetRefundBlocks, payment: assetPaymentRefundBlocks },
        confirmations: assetConfirmations
      };
      chains[altCode] = {
        apiUrl: chainUrl(altCode, altPort, altPath),
        apiType: altType,
        refundBlocks: {
          asset: paymentAssetRefundBlocks,
          payment: paymentRefundBlocks
        },
        confirmations: paymentConfirmations
      };
      localStorage.setItem('spexSwapV2Config', JSON.stringify({
        chains: chains,
        relays: ['ws://127.0.0.1:' + relayPort],
        releaseBlocks: 2,
        tickMs: 1500
      }));
      localStorage.setItem('rodOtcTestAssetChain', assetCode);
      localStorage.setItem('rodOtcTestPaymentChain', altCode);
      localStorage.setItem('rodOtcHarnessContextId', harnessContextId);
    }, {
      rodPort: PORTS.rod, assetPort: PORTS.asset, altPort: PORTS.alt, relayPort: PORTS.relay,
      controlAssetRefundBlocks: CONTROL_PROFILE.assetRefundBlocks,
      controlPaymentRefundBlocks: CONTROL_PROFILE.refundBlocks,
      controlConfirmations: CONTROL_PROFILE.confirmations,
      assetCode: ASSET, assetType: ROD_PROFILE.apiType, assetPath: ROD_PROFILE.apiPath,
      assetConfirmations: assetConfirmationsCfg,
      altCode: ALT, altType: ALT_PROFILE.apiType, altPath: ALT_PROFILE.apiPath,
      assetRefundBlocks: ROD_PROFILE.assetRefundBlocks, assetPaymentRefundBlocks: ROD_PROFILE.refundBlocks,
      paymentAssetRefundBlocks: ALT_PROFILE.assetRefundBlocks,
      paymentRefundBlocks: PAYMENT_REFUND_BLOCKS, paymentConfirmations: ALT_PROFILE.confirmations,
      harnessContextId: contextId
    });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      /* Chromium emits this generic line for HTTP errors. The response event
         below owns classification because it includes the URL and status. */
      if (/^Failed to load resource:/.test(text)) return;
      runtime.browserIssues.push({ page: label, type: 'console.error', detail: text });
    });
    page.on('response', (response) => {
      if (response.status() < 400) return;
      if (expectedTransientApiResponse(response.url(), response.status())) {
        if (process.env.TRACE_404) console.log(`[${label} expected HTTP ${response.status()}] ${response.url()}`);
        return;
      }
      runtime.browserIssues.push({
        page: label, type: 'http', status: response.status(), detail: response.url()
      });
    });
    page.on('requestfailed', (request) => {
      if (expectedDeliberateReloadAbort(label, request)) {
        runtime.expectedReloadAborts.push({
          page: label,
          detail: request.url(),
          error: request.failure().errorText
        });
        return;
      }
      runtime.browserIssues.push({
        page: label, type: 'requestfailed', detail: request.url(),
        error: request.failure() ? request.failure().errorText : ''
      });
    });
    page.on('pageerror', (error) => {
      runtime.browserIssues.push({ page: label, type: 'pageerror', detail: error.message });
    });
    await page.goto(`http://127.0.0.1:${PORTS.app}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.rodOtc && window.rodOtc.engine && window.jQuery);
    page.harnessContextId = contextId;
    return page;
  };

  const alice = await mkContext('alice');
  const bob = await mkContext('bob');
  runtime.alice = alice;
  runtime.bob = bob;
  await assertContextStorageIsolation(alice, bob, alice.harnessContextId, bob.harnessContextId);

  const mkWallet = (page) => page.evaluate(() => {
    coinjs.setNetwork('ROD');
    const prevCompressed = coinjs.compressed;
    coinjs.compressed = true;
    const keys = coinjs.newKeys();
    coinjs.compressed = prevCompressed;
    $('#walletKeys .privkey').val(keys.wif);
    $('#walletKeys .pubkey').val(keys.pubkey);
    $('#walletAddress').text(keys.address);
    const prevNet = coinjs.activeNetwork;
    const addressFor = (code) => {
      coinjs.setNetwork(code);
      return coinjs.wif2address(keys.wif).address;
    };
    const assetAddress = addressFor(localStorage.getItem('rodOtcTestAssetChain') || 'ROD');
    const altAddress = addressFor(localStorage.getItem('rodOtcTestPaymentChain') || 'LTC');
    coinjs.setNetwork(prevNet || 'ROD');
    return { address: keys.address, assetAddress, altAddress, pubkey: keys.pubkey, wif: keys.wif };
  });
  const setWallet = (page, wallet) => page.evaluate((w) => {
    $('#walletKeys .privkey').val(w.wif);
    $('#walletKeys .pubkey').val(w.pubkey);
    $('#walletAddress').text(w.address);
    return true;
  }, wallet);
  const aliceWallet = await mkWallet(alice);
  const bobWallet = await mkWallet(bob);
  console.log('alice ROD identity', aliceWallet.address, `| alice ${ASSET} addr`, aliceWallet.assetAddress,
    '| bob ROD identity', bobWallet.address, `| bob ${ALT} addr`, bobWallet.altAddress);

  const assetAmountSats = Math.round(parseFloat(ROD_AMOUNT) * 1e8);
  rodChain.credit(aliceWallet.assetAddress, Math.max(assetAmountSats * 4, 2000 * 1e8));
  /* Two UTXOs, sized relative to the swap amount so the same multi-input
     selection path is exercised on every alt chain. */
  paymentChain.credit(bobWallet.altAddress, ALT_AMOUNT_SATS * 4);
  paymentChain.credit(bobWallet.altAddress, Math.round(ALT_AMOUNT_SATS * 0.6));

  for (const [label, page] of [['alice', alice], ['bob', bob]]) {
    const suite = await page.evaluate(() => rodOtc.validation.runAll());
    step(`${label}: in-page OTC validation suite`, !!suite.passed,
      suite.results.map((r) => `${r.name}:${r.passed ? 'ok' : 'FAIL'}`).join(', '));
  }

  for (const page of [alice, bob]) {
    await page.evaluate(() => { $('a[href="#otc"]').tab('show'); });
  }
  await waitFor(async () => {
    const a = await alice.evaluate(() => rodOtc.engine.pool && rodOtc.engine.pool.count());
    const b = await bob.evaluate(() => rodOtc.engine.pool && rodOtc.engine.pool.count());
    return a >= 1 && b >= 1;
  }, 15000, 'both pages connected to local Nostr relay');
  step('both pages connected to local Nostr relay', true);

  await waitFor(() => alice.evaluate(() => $('#nsMyXpub').val() ? true : false), 15000, 'alice swap xpub');
  await waitFor(() => bob.evaluate(() => $('#nsMyXpub').val() ? true : false), 15000, 'bob swap xpub');
  const aliceXpub = await alice.evaluate(() => $('#nsMyXpub').val());
  const bobXpub = await bob.evaluate(() => $('#nsMyXpub').val());
  step('swap accounts derived (both)', !!bobXpub, 'bob xpub ' + bobXpub.slice(0, 12) + '…');
  await assertPeerIdentityIsolation(alice, bob, aliceWallet, bobWallet, aliceXpub, bobXpub);

  // ---- Alice creates & starts the swap ----
  await alice.evaluate(({ rod, alt, assetCode, altCode, peerXpub, peerRodIdentity, peerAssetPayout, release }) => {
    /* The asset is the website-wide active coin. Switching it here exercises
       the same path as Coins and Chain Info; only the payment leg remains selectable. */
    window.spexSetActiveCoin(assetCode);
    $('#nsPaymentChain').val(altCode).trigger('change');
    $('#nsRole').val('seller');
    $('#nsRod').val(rod);
    $('#nsAlt').val(alt);
    $('#nsRelease').val(String(release));
    $('#nsPeer').val(peerRodIdentity);
    $('#nsPeerXpub').val(peerXpub);
    $('#nsPeerPayoutAddr').val(peerAssetPayout);
    $('#nsCreate').click();
  }, {
    rod: ROD_AMOUNT, alt: ALT_AMOUNT, assetCode: ASSET, altCode: ALT, peerXpub: bobXpub,
    peerRodIdentity: bobWallet.address, peerAssetPayout: bobWallet.assetAddress,
    release: RELEASE_HEIGHT
  });

  const swapId = await waitFor(() => alice.evaluate(() => $('#nsSwapId').val() || null), 20000, 'alice swap created');
  runtime.swapId = swapId;
  step('alice created swap session', !!swapId, 'swapId ' + swapId.slice(0, 16) + '…');

  // terms carry the refund protocol fields
  const termsCheck = await alice.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return {
      assetRefundLockHeight: s.terms.assetRefundLockHeight,
      paymentRefundLockHeight: s.terms.paymentRefundLockHeight,
      assetConfirmations: s.terms.assetConfirmations,
      paymentConfirmations: s.terms.paymentConfirmations,
      sellerAssetRefundAddress: s.terms.sellerAssetRefundAddress,
      buyerPaymentRefundAddress: s.terms.buyerPaymentRefundAddress,
      nonce: s.terms.termsNonce
    };
  }, swapId);
  step('terms include refund heights + confirmations + 5-field swapId nonce',
    termsCheck.assetRefundLockHeight === START_HEIGHT + REFUND_ROD_BLOCKS &&
    termsCheck.paymentRefundLockHeight === START_HEIGHT + PAYMENT_REFUND_BLOCKS &&
    termsCheck.assetConfirmations === assetConfirmationsCfg &&
    termsCheck.paymentConfirmations === ALT_PROFILE.confirmations &&
    !!termsCheck.sellerAssetRefundAddress && !!termsCheck.buyerPaymentRefundAddress && !!termsCheck.nonce,
    JSON.stringify(termsCheck));

  try {
    await waitFor(() => bob.evaluate((id) => {
      const all = rodOtc.engine.loadLive();
      return all[id] ? true : null;
    }, swapId), 30000, 'bob auto-created session from swap_terms');
  } catch (error) {
    const diagnostics = await bob.evaluate((id) => ({
      flash: $('#otcFlash').text(),
      log: $('#otcLog').text(),
      seenEventIds: JSON.parse(localStorage.getItem('spexSwapV2SeenEventIds') || '[]'),
      liveSwapIds: Object.keys(rodOtc.engine.loadLive()),
      tracked: !!(rodOtc.engine.trackedSwapIds && rodOtc.engine.trackedSwapIds[id])
    }), swapId);
    error.message += '\nBob diagnostics: ' + JSON.stringify(diagnostics);
    throw error;
  }
  step('bob auto-created session from incoming terms', true);

  const accept = async (page) => {
    await page.evaluate((id) => {
      const card = $('.otc-swap-card[data-id="' + id + '"]');
      if (card.length) card.trigger('click');
      $('.otcExecBtn[data-action="accept-offer"]').trigger('click');
    }, swapId);
    return waitFor(() => page.evaluate((id) => {
      const session = rodOtc.engine.restoreLive(id);
      return session && session.localAccepted === true ? true : null;
    }, swapId), 15000, 'local acceptance after fresh refund-order check');
  };
  step('bob accepted', await accept(bob));
  step('alice accepted', await accept(alice));

  // ---- pre-funding pipeline → PREPARED on both, with NOTHING broadcast ----
  await waitForProtocolStage('bilateral acceptance and readiness', (a, b) =>
    a.localAccepted && a.remoteAccepted && a.bilateralReady &&
    b.localAccepted && b.remoteAccepted && b.bilateralReady);
  await waitForProtocolStage('adaptor-point commitment received by both peers', (a, b) =>
    a.adaptorPoint && b.adaptorPoint && a.adaptorPoint === b.adaptorPoint);
  await waitForProtocolStage('both planned funding transactions exchanged', (a, b) =>
    a.plannedAssetFunding && a.plannedPaymentFunding &&
    b.plannedAssetFunding && b.plannedPaymentFunding);
  await waitForProtocolStage('both timelocked refund exchanges completed', (a, b) =>
    a.role === 'seller' && a.assetRefundSigned && a.paymentRefundCosigned &&
    b.role === 'buyer' && b.assetRefundCosigned && b.paymentRefundSigned);
  await waitForProtocolStage('both claim adaptor signatures exchanged and verified', (a, b) =>
    a.localAssetAdaptorSignature && a.remotePaymentAdaptorSignature &&
    b.localPaymentAdaptorSignature && b.remoteAssetAdaptorSignature);
  await waitForProtocolStage('both peers persisted local PREPARED', (a, b) =>
    a.localPrepared && b.localPrepared);
  await waitForProtocolStage('both peers observed counterparty PREPARED', (a, b) =>
    a.remotePrepared && b.remotePrepared);
  step('both sides PREPARED: planned fundings, pre-signed refunds, verified adaptor signatures', true);

  const aliceRefund = await alice.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return { signedHex: s.assetRefund.signedHex, lockHeight: s.assetRefund.lockHeight, plannedTxid: s.plannedAssetFunding.txid };
  }, swapId);
  const bobRefund = await bob.evaluate((id) => {
    const s = rodOtc.engine.restoreLive(id);
    return { signedHex: s.paymentRefund.signedHex, lockHeight: s.paymentRefund.lockHeight, plannedTxid: s.plannedPaymentFunding.txid };
  }, swapId);
  step('refund locktimes match terms',
    aliceRefund.lockHeight === START_HEIGHT + REFUND_ROD_BLOCKS && bobRefund.lockHeight === START_HEIGHT + PAYMENT_REFUND_BLOCKS,
    `${ASSET} refund locks at ${aliceRefund.lockHeight}, ${ALT} refund locks at ${bobRefund.lockHeight}`);

  if (SCENARIO === 'happy') {
    await runHappyPath();
  } else if (SCENARIO === 'altrefund') {
    await runPaymentRefundPath();
  } else {
    await runRefundPath();
  }

  step('no unexpected browser console, page, request, or HTTP errors',
    runtime.browserIssues.length === 0, JSON.stringify(runtime.browserIssues));

  fs.writeFileSync(path.join(__dirname, `e2e-report-${ASSET.toLowerCase()}-${ALT.toLowerCase()}-${SCENARIO}${REPORT_REPEAT_SUFFIX}.json`), JSON.stringify({
    scenario: SCENARIO,
    swapId,
    steps: results.steps,
    assetBroadcasts: rodChain.broadcasts,
    paymentBroadcasts: paymentChain.broadcasts,
    browserIssues: runtime.browserIssues,
    expectedReloadAborts: runtime.expectedReloadAborts,
    relayDiagnostics: relayDiagnostics(swapId),
    relayEventTypes: relay.events.map((e) => {
      try { return JSON.parse(e.content).type; } catch (err) { return 'unknown'; }
    })
  }, null, 2));

  await browser.close();
  console.log('\n================= RESULT =================');
  console.log(results.ok ? 'ALL CHECKS PASSED ✓' : 'FAILURES PRESENT ✗');
  process.exit(results.ok ? 0 : 1);

  /* ================= happy path ================= */
  async function runHappyPath() {
    // Asset funding must appear AND match the planned txid
    await waitFor(() => rodChain.broadcasts.length > 0 || null, 60000, `${ASSET} funding broadcast`);
    const assetFundingB = rodChain.broadcasts[0];
    step(`${ASSET} funding tx broadcast & independently validated`, assetFundingB.valid, assetFundingB.details.join(' | '));
    step(`${ASSET} funding txid equals PLANNED txid (refunds/adaptor sigs bind to it)`, assetFundingB.txid === aliceRefund.plannedTxid,
      `${assetFundingB.txid.slice(0, 16)}… vs planned ${aliceRefund.plannedTxid.slice(0, 16)}…`);

    // Alice's refund must be REJECTED before its lock height (direct probe;
    // rejection is NOT recorded as a broadcast attempt)
    const probe = rodChain.validateAndAccept(aliceRefund.signedHex);
    step(`pre-signed ${ASSET} refund rejected as non-final before lock height`,
      !probe.ok && /non-final/.test(probe.error || ''), probe.error || 'UNEXPECTEDLY ACCEPTED');

    // timeline ordering: PREPARED strictly before ASSET_FUNDED
    const timeline = await alice.evaluate((id) => (rodOtc.engine.restoreLive(id).timeline || []).map((t) => t.state), swapId);
    const preparedIdx = timeline.indexOf('PREPARED');
    const fundedIdx = timeline.indexOf('ASSET_FUNDED');
    step(`timeline: PREPARED precedes ${ASSET} funding broadcast`, preparedIdx !== -1 && fundedIdx !== -1 && preparedIdx < fundedIdx,
      timeline.join(' → '));

    await waitFor(() => paymentChain.broadcasts.length > 0 || null, 120000, `${ALT} funding broadcast`);
    const paymentFundingB = paymentChain.broadcasts[0];
    step(`${ALT} funding tx broadcast & independently validated (${ALT_AMOUNT} ${ALT})`, paymentFundingB.valid, paymentFundingB.details.join(' | '));
    step(`${ALT} funding txid equals PLANNED txid`, paymentFundingB.txid === bobRefund.plannedTxid);

    if (ALT_PROFILE.confirmations > 1) {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      step(`${ALT} confirmation gate prevents claim at 1/${ALT_PROFILE.confirmations}`,
        paymentChain.broadcasts.length === 1, `alt broadcasts: ${paymentChain.broadcasts.length}`);
      paymentChain.height += ALT_PROFILE.confirmations - 1;
    }

    if (process.env.RELOAD_TEST === '1') {
      /* Navigation intentionally cancels in-flight requests. An in-flight
         request to one of this scenario's local chain APIs may be aborted;
         failures outside that short reload window remain release blockers. */
      runtime.reloadAbortUntil.alice = Date.now() + 5000;
      await alice.reload({ waitUntil: 'load' });
      await alice.waitForFunction(() => window.rodOtc && window.rodOtc.engine && window.jQuery);
      await setWallet(alice, aliceWallet);
      await alice.evaluate(() => { $('a[href="#otc"]').tab('show'); });
      await waitFor(() => alice.evaluate(() => (rodOtc.engine.pool && rodOtc.engine.pool.count() >= 1) || null), 15000, 'alice relay reconnect after reload');
      const persisted = await alice.evaluate((id) => {
        const s = rodOtc.engine.restoreLive(id);
        return !!(s && s.remotePaymentAdaptorSignature && s.assetRefund && s.assetRefund.signedHex && s.adaptorSecret);
      }, swapId);
      step('after reload: adaptor sig, refund and secret persisted', persisted);
      if (runtime.expectedReloadAborts.length) {
        step('deliberate reload aborts only transient local chain API requests', true,
          runtime.expectedReloadAborts.length + ' expected request abort(s)');
      }
    }

    // release the claim height gate
    controlRodChain.height = RELEASE_HEIGHT + 1;

    await waitFor(() => paymentChain.broadcasts.length > 1 || null, 120000, `${ALT} claim broadcast`);
    const paymentClaimB = paymentChain.broadcasts[1];
    step(`${ALT} claim tx (2-of-2 P2SH, completed adaptor sig) broadcast & independently validated`, paymentClaimB.valid, paymentClaimB.details.join(' | '));

    // Bob recovers the secret FROM THE REAL SIGNATURE
    await waitFor(() => bob.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return s && s.recoveredAdaptorSecret ? true : null;
    }, swapId), 90000, 'bob recovered adaptor secret');
    const recovery = await bob.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return {
        matchesPoint: coinjs.adaptor.publicKey(s.recoveredAdaptorSecret) === s.adaptorPoint,
        state: s.state
      };
    }, swapId);
    step('recovered secret verifies against adaptor point (yG == Y)', recovery.matchesPoint, 'state ' + recovery.state);

    await waitFor(() => rodChain.broadcasts.length > 1 || null, 90000, `${ASSET} claim broadcast`);
    const assetClaimB = rodChain.broadcasts[1];
    step(`${ASSET} claim tx (2-of-2 P2SH, completed adaptor sig) broadcast & independently validated`, assetClaimB.valid, assetClaimB.details.join(' | '));

    const bobState = await waitFor(() => bob.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return s && s.state === 'COMPLETE' ? s.state : null;
    }, swapId), 60000, 'bob COMPLETE');
    step('bob session COMPLETE', bobState === 'COMPLETE');
    const aliceState = await waitFor(() => alice.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return s && s.state === 'COMPLETE' ? s.state : null;
    }, swapId), 60000, 'alice COMPLETE');
    step('alice session COMPLETE', aliceState === 'COMPLETE', aliceState);

    // money flow: payout addresses from terms (wallet addresses, not child keys)
    const dests = await alice.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return {
        sellerAltPayout: s.terms.sellerPaymentPayoutAddress,
        buyerRodPayout: s.terms.buyerAssetPayoutAddress,
        altMultisig: s.terms.paymentFunding.multisigAddress,
        rodMultisig: s.terms.assetFunding.multisigAddress
      };
    }, swapId);
    const aliceGotAlt = paymentChain.balance(dests.sellerAltPayout);
    const bobGotRod = rodChain.balance(dests.buyerRodPayout);
    step(`alice received ${ALT} at her payout address`, aliceGotAlt === ALT_AMOUNT_SATS - ALT_CLAIM_FEE,
      `${aliceGotAlt} sats at ${dests.sellerAltPayout}`);
    step(`bob received ${ASSET} at his payout address`, bobGotRod === Math.round(parseFloat(ROD_AMOUNT) * 1e8) - ROD_CLAIM_FEE,
      `${bobGotRod} sats at ${dests.buyerRodPayout}`);
    step(`${ALT} multisig fully swept`, paymentChain.balance(dests.altMultisig) === 0);
    step(`${ASSET} multisig fully swept`, rodChain.balance(dests.rodMultisig) === 0);

    // atomicity proof: NO normal-signature messages were ever needed
    const relayTypes = relay.events.map((e) => { try { return JSON.parse(e.content).type; } catch (err) { return ''; } });
    const normalSigs = relayTypes.filter((t) => /normal_signature/.test(t));
    step('zero normal-signature messages on relay (settlement fully adaptor-based)', normalSigs.length === 0,
      'message types seen: ' + [...new Set(relayTypes)].join(', '));

    const invalidRod = rodChain.broadcasts.filter((b) => !b.valid);
    const invalidAlt = paymentChain.broadcasts.filter((b) => !b.valid);
    step(`zero invalid broadcast attempts (${ASSET})`, invalidRod.length === 0, invalidRod.map((b) => b.details.join()).join('; '));
    step(`zero invalid broadcast attempts (${ALT})`, invalidAlt.length === 0, invalidAlt.map((b) => b.details.join()).join('; '));
  }

  /* ================= refund path ================= */
  async function runRefundPath() {
    await waitFor(() => rodChain.broadcasts.length > 0 || null, 60000, `${ASSET} funding broadcast`);
    const assetFundingB = rodChain.broadcasts[0];
    step(`${ASSET} funding tx broadcast & independently validated`, assetFundingB.valid, assetFundingB.details.join(' | '));

    // Bob requires 3 confirmations; height is frozen at 1 conf → he must NOT fund LTC
    await new Promise((r) => setTimeout(r, 8000)); // several automation ticks
    step(`confirmation gate held: Bob did NOT fund ${ALT} at 1/3 confirmations`, paymentChain.broadcasts.length === 0,
      `alt broadcasts: ${paymentChain.broadcasts.length}`);

    // refund is non-final before lock height
    const probe = rodChain.validateAndAccept(aliceRefund.signedHex);
    step(`pre-signed ${ASSET} refund rejected as non-final before lock height`,
      !probe.ok && /non-final/.test(probe.error || ''), probe.error || 'UNEXPECTEDLY ACCEPTED');

    // Bob disappears
    await bob.context().close();
    step(`bob disappeared (context closed) after ${ASSET} funding`, true);

    // chain advances past the refund height
    rodChain.height = START_HEIGHT + REFUND_ROD_BLOCKS + 5;

    await waitFor(() => rodChain.broadcasts.length > 1 || null, 90000, `${ASSET} refund broadcast by automation`);
    const refundB = rodChain.broadcasts[1];
    step(`pre-signed ${ASSET} refund broadcast & independently validated (locktime + 2-of-2 sigs)`, refundB.valid, refundB.details.join(' | '));

    const aliceState = await waitFor(() => alice.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return (s && (s.state === 'REFUNDED' || s.state === 'ASSET_REFUNDED')) ? s.state : null;
    }, swapId), 60000, 'alice refund state');
    step('alice session reached refund state', aliceState === 'REFUNDED' || aliceState === 'ASSET_REFUNDED', aliceState);

    const refundDest = await alice.evaluate((id) => rodOtc.engine.restoreLive(id).terms.sellerAssetRefundAddress, swapId);
    const refunded = rodChain.balance(refundDest);
    step('funds returned to Alice refund address (amount minus refund fee)',
      refunded === Math.round(parseFloat(ROD_AMOUNT) * 1e8) - ASSET_REFUND_FEE, `${refunded} sats at ${refundDest}`);

    const rodMultisig = await alice.evaluate((id) => rodOtc.engine.restoreLive(id).terms.assetFunding.multisigAddress, swapId);
    step(`${ASSET} multisig fully swept by refund`, rodChain.balance(rodMultisig) === 0);

    const invalidRod = rodChain.broadcasts.filter((b) => !b.valid);
    step(`zero invalid broadcast attempts (${ASSET})`, invalidRod.length === 0, invalidRod.map((b) => b.details.join()).join('; '));
    step(`zero ${ALT} broadcasts at all (Bob never funded)`, paymentChain.broadcasts.length === 0);
  }

  /* ================= alt-leg refund path =================
     The mirror image of runRefundPath, and the case that matters most for a
     newly-added chain: BOTH legs are funded, then the secret holder vanishes
     WITHOUT claiming. Bob must be able to recover his alt coin using only the
     refund he pre-signed before any coin moved. This exercises a timelocked
     2-of-2 P2SH spend under the alt chain's own consensus and relay policy —
     on Dogecoin that means legacy sighash, low-S DER, nLockTime finality with
     sequence 0xfffffffe, the absolute dust limits and the koinu/byte fee
     floor, none of which the Litecoin path proves. */
  async function runPaymentRefundPath() {
    await waitFor(() => rodChain.broadcasts.length > 0 || null, 60000, `${ASSET} funding broadcast`);
    step(`${ASSET} funding tx broadcast & independently validated`, rodChain.broadcasts[0].valid,
      rodChain.broadcasts[0].details.join(' | '));

    await waitFor(() => paymentChain.broadcasts.length > 0 || null, 120000, `${ALT} funding broadcast`);
    const paymentFundingB = paymentChain.broadcasts[0];
    step(`${ALT} funding tx broadcast & independently validated`, paymentFundingB.valid, paymentFundingB.details.join(' | '));
    step(`${ALT} funding txid equals PLANNED txid`, paymentFundingB.txid === bobRefund.plannedTxid);

    /* The pre-signed alt refund must be worthless until its lock height. */
    const probe = paymentChain.validateAndAccept(bobRefund.signedHex);
    step(`pre-signed ${ALT} refund rejected as non-final before lock height`,
      !probe.ok && /non-final/.test(probe.error || ''), probe.error || 'UNEXPECTEDLY ACCEPTED');

    /* Alice vanishes holding the secret, without ever claiming. */
    await alice.context().close();
    step('alice disappeared (context closed) without claiming', true);

    paymentChain.height = START_HEIGHT + PAYMENT_REFUND_BLOCKS + 5;

    await waitFor(() => paymentChain.broadcasts.length > 1 || null, 120000, `${ALT} refund broadcast by automation`);
    const paymentRefundB = paymentChain.broadcasts[1];
    step(`pre-signed ${ALT} refund broadcast & independently validated (locktime + 2-of-2 sigs + ${ALT} policy)`,
      paymentRefundB.valid, paymentRefundB.details.join(' | '));

    const bobState = await waitFor(() => bob.evaluate((id) => {
      const s = rodOtc.engine.restoreLive(id);
      return (s && /REFUND/.test(s.state)) ? s.state : null;
    }, swapId), 60000, 'bob refund state');
    step('bob session reached a refund state', /REFUND/.test(bobState), bobState);

    const bobDests = await bob.evaluate((id) => {
      const t = rodOtc.engine.restoreLive(id).terms;
      return { refundAddr: t.buyerPaymentRefundAddress, multisig: t.paymentFunding.multisigAddress, refundFee: t.paymentRefundFee };
    }, swapId);
    const refunded = paymentChain.balance(bobDests.refundAddr);
    const expected = ALT_AMOUNT_SATS - Math.round(parseFloat(bobDests.refundFee) * 1e8);
    step(`${ALT} returned to Bob's refund address (amount minus refund fee)`, refunded === expected,
      `${refunded} vs expected ${expected} at ${bobDests.refundAddr}`);
    step(`${ALT} multisig fully swept by refund`, paymentChain.balance(bobDests.multisig) === 0);

    const invalidAlt = paymentChain.broadcasts.filter((b) => !b.valid);
    step(`zero invalid broadcast attempts (${ALT})`, invalidAlt.length === 0,
      invalidAlt.map((b) => b.details.join()).join('; '));
    step('alice never claimed: no secret was ever revealed on the alt chain',
      paymentChain.broadcasts.filter((b) => b.valid).length === 2,
      `${paymentChain.broadcasts.length} alt broadcasts (funding + refund only)`);
  }
}

main().catch(async (e) => {
  const report = {
    scenario: SCENARIO,
    swapId: runtime.swapId,
    ok: false,
    error: e && (e.stack || e.message) || String(e),
    steps: results.steps,
    browserIssues: runtime.browserIssues,
    expectedReloadAborts: runtime.expectedReloadAborts,
    assetBroadcasts: runtime.rodChain ? runtime.rodChain.broadcasts : [],
    paymentBroadcasts: runtime.paymentChain ? runtime.paymentChain.broadcasts : [],
    relayDiagnostics: relayDiagnostics(runtime.swapId),
    relayEventTypes: runtime.relay && runtime.relay.events
      ? runtime.relay.events.map((event) => {
          try { return JSON.parse(event.content).type; } catch (error) { return 'unknown'; }
        })
      : []
  };
  for (const [label, page] of [['alice', runtime.alice], ['bob', runtime.bob]]) {
    try {
      if (page && !page.isClosed()) {
        report[label] = await sessionDiagnostics(page, runtime.swapId);
        const protocol = await sessionProtocolState(page, runtime.swapId);
        report[label].protocol = protocol;
        report[label].missingPreparedPrerequisites = missingPreparedPrerequisites(protocol);
      }
    } catch (diagnosticError) {
      report[label] = { diagnosticError: diagnosticError.message };
    }
  }
  fs.writeFileSync(
    path.join(__dirname, `e2e-report-${ASSET.toLowerCase()}-${ALT.toLowerCase()}-${SCENARIO}${REPORT_REPEAT_SUFFIX}.json`),
    JSON.stringify(report, null, 2)
  );
  try { if (runtime.browser) await runtime.browser.close(); } catch (closeError) {}
  for (const server of runtime.servers) {
    try { server.close(); } catch (closeError) {}
  }
  try { if (runtime.relay && runtime.relay.close) runtime.relay.close(); } catch (closeError) {}
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
