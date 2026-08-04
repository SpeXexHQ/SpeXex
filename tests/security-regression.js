#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const values = new Map();
let failStorageKey = '';
const localStorage = {
	getItem(key) { return values.has(key) ? values.get(key) : null; },
	setItem(key, value) {
		if (failStorageKey && key === failStorageKey) {
			failStorageKey = '';
			throw new Error('simulated storage write failure');
		}
		values.set(key, String(value));
	},
	removeItem(key) { values.delete(key); },
	key(index) { return Array.from(values.keys())[index] || null; },
	get length() { return values.size; }
};
const context = {
	console,
	document: { location: { protocol: 'http:', hostname: 'localhost' } },
	localStorage,
	navigator: {},
	setTimeout,
	clearTimeout,
	Uint8Array,
	window: null
};
context.window = context;
function jqueryStub() {
	return {
		val() { return ''; },
		text() { return ''; },
		trigger() { return this; }
	};
}
jqueryStub.extend = function () {
		let deep = false;
		let target;
		let index = 0;
		if (typeof arguments[0] === 'boolean') {
			deep = arguments[0];
			target = arguments[1] || {};
			index = 2;
		} else {
			target = arguments[0] || {};
			index = 1;
		}
		for (; index < arguments.length; index++) {
			const source = arguments[index];
			if (!source) continue;
			for (const key of Object.keys(source)) {
				const value = source[key];
				if (deep && value && typeof value === 'object' && !Array.isArray(value)) {
					target[key] = jqueryStub.extend(true, target[key] || {}, value);
				} else if (deep && Array.isArray(value)) {
					target[key] = value.slice();
				} else {
					target[key] = value;
				}
			}
		}
		return target;
};
jqueryStub.isArray = Array.isArray;
jqueryStub.trim = function (value) { return String(value).trim(); };
jqueryStub.getJSON = function () { throw new Error('network disabled in security regression'); };
context.$ = context.jQuery = jqueryStub;
context.crypto = {
	getRandomValues(target) {
		crypto.randomFillSync(target);
		return target;
	}
};
vm.createContext(context);

[
	'js/crypto-min.js',
	'js/crypto-sha256.js',
	'js/crypto-sha256-hmac.js',
	'js/sha512.js',
	'js/ripemd160.js',
	'js/jsbn.js',
	'js/ellipticcurve.js',
	'js/chain-registry.js',
	'js/coin.js',
	'js/ecdsa-adaptor.js',
	'js/otc-chains.js',
	'js/otc-storage.js',
	'js/otc-nostr.js',
	'js/otc-swap.js',
	'js/otc-engine.js'
].forEach((relativePath) => {
	const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
	vm.runInContext(source, context, { filename: relativePath });
});

const NOSTR = context.rodOtc.nostr;
const SWAP = context.rodOtc.swap;
const CHAINS = context.rodOtc.chains;
const ADAPTOR = context.rodOtc.adaptor;
const ENGINE = context.rodOtc.engine;
const STORAGE = context.rodOtc.storage;

function expectThrow(fn, pattern, label) {
	let thrown = null;
	try { fn(); } catch (error) { thrown = error; }
	assert(thrown, label + ': expected an exception');
	assert(pattern.test(String(thrown.message || thrown)), label + ': unexpected error "' + thrown + '"');
}

function stableStringify(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
	return '{' + Object.keys(value).sort().map((key) =>
		JSON.stringify(key) + ':' + stableStringify(value[key])
	).join(',') + '}';
}

function recoveryChecksum(payload) {
	return crypto.createHash('sha256').update(Buffer.from(stableStringify(payload), 'utf8')).digest('hex');
}

function signedFixture(privateKeyHex, type) {
	return NOSTR.createEnvelope({
		swapId: 'security-regression-swap',
		type: type || 'swap_terms',
		sequence: 1,
		payload: { test: true },
		privateKeyHex,
		createdAt: 1700000000,
		auxiliaryRandomnessHex: '00'.repeat(32)
	});
}

function testNostrSignatures() {
	const valid = signedFixture('03'.padStart(64, '0'));
	assert.strictEqual(NOSTR.validateEnvelope(valid).type, 'swap_terms', 'valid signed swap event must pass');

	const unsigned = JSON.parse(JSON.stringify(valid));
	delete unsigned.sig;
	expectThrow(
		() => NOSTR.validateEnvelope(unsigned),
		/signature/i,
		'unsigned swap event'
	);

	expectThrow(
		() => NOSTR.createEnvelope({
			swapId: 'security-regression-swap',
			type: 'swap_accept',
			sequence: 2,
			payload: { accepted: true },
			pubkey: valid.pubkey
		}),
		/private key|sign/i,
		'unsigned event creation'
	);

	const contentTampered = JSON.parse(JSON.stringify(valid));
	contentTampered.content = JSON.stringify({ version: 2, swapId: valid.swapId, type: 'swap_complete', sequence: 99 });
	expectThrow(() => NOSTR.validateEnvelope(contentTampered), /ID mismatch/i, 'tampered event content');

	const signatureTampered = JSON.parse(JSON.stringify(valid));
	signatureTampered.sig = '00'.repeat(64);
	expectThrow(() => NOSTR.validateEnvelope(signatureTampered), /signature/i, 'tampered event signature');

	const signerTampered = JSON.parse(JSON.stringify(valid));
	signerTampered.pubkey = NOSTR.identityFromPrivateKey('04'.padStart(64, '0')).pubkey;
	expectThrow(() => NOSTR.validateEnvelope(signerTampered), /ID mismatch|signature/i, 'substituted event signer');

	const kindTampered = JSON.parse(JSON.stringify(valid));
	kindTampered.kind = 1;
	expectThrow(() => NOSTR.validateEnvelope(kindTampered), /unsupported.*kind/i, 'unsupported event kind');
}

function testOrderEventAuthentication() {
	const privateKeyHex = '05'.padStart(64, '0');
	const event = NOSTR.createOrderEvent({
		order: {
			orderId: 'security-order',
			pair: 'ROD/DOGE',
			side: 'sell',
			give: '10.00000000',
			want: '20.00000000'
		},
		privateKeyHex,
		createdAt: 1700000000,
		auxiliaryRandomnessHex: '00'.repeat(32)
	});
	assert.strictEqual(NOSTR.validateOrderEvent(event).order.orderId, 'security-order');

	const unsigned = JSON.parse(JSON.stringify(event));
	delete unsigned.sig;
	expectThrow(() => NOSTR.validateOrderEvent(unsigned), /signature/i, 'unsigned order event');

	const tampered = JSON.parse(JSON.stringify(event));
	const envelope = JSON.parse(tampered.content);
	envelope.order.want = '2000.00000000';
	tampered.content = JSON.stringify(envelope);
	expectThrow(() => NOSTR.validateOrderEvent(tampered), /ID mismatch/i, 'tampered order economics');

	const identityMismatch = JSON.parse(JSON.stringify(event));
	const body = JSON.parse(identityMismatch.content);
	body.order.nostrPubkey = NOSTR.identityFromPrivateKey('06'.padStart(64, '0')).pubkey;
	identityMismatch.content = JSON.stringify(body);
	expectThrow(() => NOSTR.validateOrderEvent(identityMismatch), /ID mismatch|identity/i, 'order identity substitution');
}

function testNostrIdentityBinding() {
	const remoteKey = '03'.padStart(64, '0');
	const attackerKey = '04'.padStart(64, '0');
	const remote = NOSTR.identityFromPrivateKey(remoteKey);
	const attacker = NOSTR.identityFromPrivateKey(attackerKey);
	const evenAddress = CHAINS.publicKeyToAddress('ROD', '02' + remote.pubkey, 'legacy');
	const oddAddress = CHAINS.publicKeyToAddress('ROD', '03' + remote.pubkey, 'legacy');
	const remoteAddress = [evenAddress, oddAddress].find((address) =>
		SWAP.nostrPubkeyMatchesRodIdentity(remote.pubkey, address)
	);
	assert(remoteAddress, 'one compressed-key parity must reproduce the remote ROD identity');
	assert.strictEqual(SWAP.nostrPubkeyMatchesRodIdentity(remote.pubkey, remoteAddress), true);
	assert.strictEqual(SWAP.nostrPubkeyMatchesRodIdentity(attacker.pubkey, remoteAddress), false);
}

function testTermsHashHardFailure() {
	const local = { termsHash: '11'.repeat(32) };
	const identicalRemote = { termsHash: local.termsHash };
	assert.strictEqual(SWAP.assertMatchingTermsHash(local, identicalRemote), true);
	expectThrow(
		() => SWAP.assertMatchingTermsHash(local, { termsHash: '22'.repeat(32) }),
		/terms hash/i,
		'mismatched canonical terms'
	);
	expectThrow(
		() => SWAP.assertMatchingTermsHash(local, {}),
		/terms hash/i,
		'missing remote terms hash'
	);
	assert.strictEqual(
		SWAP.assertMatchingTermsHash(local, { termsHash: local.termsHash.toUpperCase() }),
		true,
		'hex case must not create a false mismatch'
	);
	expectThrow(
		() => SWAP.assertMatchingTermsHash({ termsHash: '1'.repeat(63) }, { termsHash: '1'.repeat(63) }),
		/terms hash/i,
		'truncated matching hashes'
	);

	const uiSource = fs.readFileSync(path.join(root, 'js/otc-app-ui.js'), 'utf8');
	assert(!/session\.terms\s*=\s*\$\.extend\(true,\s*\{\},\s*terms\)/.test(uiSource),
		'incoming UI must never replace locally reconstructed terms with remote terms');
	assert(/SWAP\.assertMatchingTermsHash\(session\.terms,\s*terms\)/.test(uiSource),
		'incoming UI must call the canonical terms-hash gate');
}

function testRefundOrdering() {
	const validLtc = {
		assetChain: 'ROD',
		paymentChain: 'LTC',
		assetRefundLockHeight: 100480,
		paymentRefundLockHeight: 200024,
		assetConfirmations: 1,
		paymentConfirmations: 1
	};
	const validDoge = {
		assetChain: 'ROD',
		paymentChain: 'DOGE',
		assetRefundLockHeight: 100480,
		paymentRefundLockHeight: 300060,
		assetConfirmations: 1,
		paymentConfirmations: 6
	};
	const ltc = SWAP.assertRefundOrdering(validLtc, 100000, 200000);
	const doge = SWAP.assertRefundOrdering(validDoge, 100000, 300000);
	assert(ltc.assetRemainingSeconds > ltc.paymentRemainingSeconds + ltc.safetyMarginSeconds);
	assert(doge.assetRemainingSeconds > doge.paymentRemainingSeconds + doge.safetyMarginSeconds);
	const reversed = SWAP.assertRefundOrdering({
		assetChain: 'LTC',
		paymentChain: 'ROD',
		releaseRodHeight: 300030,
		assetRefundLockHeight: 200000 + CHAINS.getRefundBlocks('LTC', 'asset'),
		paymentRefundLockHeight: 300000 + CHAINS.getRefundBlocks('ROD', 'payment'),
		assetConfirmations: 1,
		paymentConfirmations: 1
	}, 200000, 300000, 300000);
	assert(reversed.assetRemainingSeconds > reversed.paymentRemainingSeconds + reversed.safetyMarginSeconds,
		'reversed LTC/ROD roles must receive safe role-specific default windows');
	for (const code of CHAINS.codes()) {
		assert.strictEqual(CHAINS.getRefundBlocks(code, 'asset') * CHAINS.getPolicy(code).blockSeconds, 4 * 60 * 60,
			code + ' asset refund should target four hours');
		assert.strictEqual(CHAINS.getRefundBlocks(code, 'payment') * CHAINS.getPolicy(code).blockSeconds, 60 * 60,
			code + ' payment refund should target one hour');
	}

	expectThrow(
		() => SWAP.assertRefundOrdering({
			assetChain: 'ROD',
			paymentChain: 'LTC',
			assetRefundLockHeight: 100120,
			paymentRefundLockHeight: 200120,
			assetConfirmations: 1,
			paymentConfirmations: 1
		}, 100000, 200000),
		/refund ordering/i,
		'later alt-chain refund'
	);

	expectThrow(
		() => SWAP.assertRefundOrdering({
			assetChain: 'ROD',
			paymentChain: 'DOGE',
			assetRefundLockHeight: 100480,
			paymentRefundLockHeight: 300470,
			assetConfirmations: 1,
			paymentConfirmations: 6
		}, 100000, 300000),
		/refund ordering/i,
		'DOGE wall-clock reversal'
	);

	expectThrow(
		() => SWAP.assertRefundOrdering({
			assetChain: 'ROD',
			paymentChain: 'LTC',
			assetRefundLockHeight: 100140,
			paymentRefundLockHeight: 200016,
			assetConfirmations: 1,
			paymentConfirmations: 1
		}, 100000, 200000),
		/refund ordering/i,
		'exact safety-margin boundary must fail because action time must remain'
	);
	expectThrow(
		() => SWAP.assertRefundOrdering(validLtc, 100480, 200000),
		/future lock heights/i,
		'expired ROD refund'
	);
	expectThrow(
		() => SWAP.assertRefundOrdering(Object.assign({}, validLtc, { paymentChain: 'DGB' }), 100000, 200000),
		/unsupported swap chain/i,
		'wallet-only chain used as swap counter chain'
	);
}

function testRuntimeBoundaryWiring() {
	const uiSource = fs.readFileSync(path.join(root, 'js/otc-app-ui.js'), 'utf8');
	const engineSource = fs.readFileSync(path.join(root, 'js/otc-engine.js'), 'utf8');
	const incomingCheck = uiSource.indexOf('SWAP.assertRefundOrdering(terms, freshTips.assetHeight, freshTips.paymentHeight, freshTips.controlHeight)');
	const incomingCreate = uiSource.indexOf('var session = SWAP.createOfferSession({', incomingCheck);
	assert(incomingCheck !== -1 && incomingCreate > incomingCheck,
		'incoming terms must pass refund ordering before a session is created');
	assert(/function acceptSession[\s\S]*?return validateRefundOrderingFresh\(session\)\.then/.test(uiSource),
		'local acceptance must wait for fresh refund-ordering validation');
	assert(/ensureRefundSafetyGate\(latest, 'preFunding'\)/.test(uiSource),
		'refund signing pipeline must have a fresh ordering gate');
	assert(/ensureRefundSafetyGate\(latest, 'funding'\)/.test(uiSource),
		'funding broadcast pipeline must have a fresh ordering gate');

	const globalPeerGate = uiSource.indexOf('ensureRemotePeer(sess, eventObject);', uiSource.indexOf('function autoProcess'));
	const adaptorHandler = uiSource.indexOf("if (env.type === 'swap_adaptor_point'", globalPeerGate);
	assert(globalPeerGate !== -1 && adaptorHandler > globalPeerGate,
		'signer identity must be bound before the first swap payload handler');
	const envelopeValidation = engineSource.indexOf('var env = NOSTR.validateEnvelope(ev);');
	const messageDispatch = engineSource.indexOf('engine.onSwapMessage(env, ev);', envelopeValidation);
	assert(envelopeValidation !== -1 && messageDispatch > envelopeValidation,
		'envelope signature validation must precede runtime message dispatch');
}

function testPreservedProtocolBehavior() {
	const results = [
		NOSTR.testValidation(),
		CHAINS.testAgainstRodGlobals(),
		ADAPTOR.testVectors(),
		SWAP.testFixtures()
	];
	for (const result of results) {
		assert.strictEqual(result.passed, true, (result.name || 'protocol fixture') + ' must remain green');
	}
}

function testBilateralTermsReconstruction() {
	localStorage.removeItem('spexSwapV2State');
	const seller = SWAP.createSwapAccount('security seller fixture');
	const buyer = SWAP.createSwapAccount('security buyer fixture');
	const swapId = SWAP.swapIdFromOrder('security/order', '1', 'seller', 'buyer', 'nonce');
	const childIndex = SWAP.childIndexFromSwapId(swapId);
	const sellerKeys = SWAP.deriveSwapKeys(seller.xpub, childIndex);
	const buyerKeys = SWAP.deriveSwapKeys(buyer.xpub, childIndex);
	const common = {
		swapId,
		orderId: 'security/order',
		assetChain: 'ROD',
		paymentChain: 'DOGE',
		assetAmount: '10.00000000',
		paymentAmount: '20.00000000',
		sellerSwapXpub: seller.xpub,
		buyerSwapXpub: buyer.xpub,
		releaseRodHeight: 100100,
		sellerPaymentPayoutAddress: CHAINS.publicKeyToAddress('DOGE', sellerKeys.publicKey, 'legacy'),
		buyerAssetPayoutAddress: CHAINS.publicKeyToAddress('ROD', buyerKeys.publicKey, 'legacy'),
		sellerIdentity: 'seller',
		buyerIdentity: 'buyer',
		termsNonce: 'nonce',
		assetRefundLockHeight: 100480,
		paymentRefundLockHeight: 300060,
		assetConfirmations: 1,
		paymentConfirmations: 6
	};
	const sender = SWAP.createOfferSession(Object.assign({
		role: 'seller',
		sellerSwapAccountKey: seller.xprv,
		buyerSwapAccountKey: buyer.xpub
	}, common));
	const receiver = SWAP.createOfferSession(Object.assign({
		role: 'buyer',
		sellerSwapAccountKey: seller.xpub,
		buyerSwapAccountKey: buyer.xprv
	}, common));
	assert.strictEqual(receiver.localChildPublicKey, sender.remoteChildPublicKey,
		'receiver must derive the same local child public key');
	assert.strictEqual(receiver.terms.termsHash, sender.terms.termsHash,
		'legitimate sender and receiver must reconstruct the same canonical terms hash');

	/* Roles are per swap, not properties of separate coin packages. Prove the
	   same engine can place LTC on the asset side and ROD on the payment side. */
	const reversed = SWAP.createOfferSession(Object.assign({}, common, {
		role: 'seller',
		assetChain: 'LTC',
		paymentChain: 'ROD',
		sellerSwapAccountKey: seller.xprv,
		buyerSwapAccountKey: buyer.xpub,
		sellerPaymentPayoutAddress: CHAINS.publicKeyToAddress('ROD', sellerKeys.publicKey, 'legacy'),
		buyerAssetPayoutAddress: CHAINS.publicKeyToAddress('LTC', buyerKeys.publicKey, 'legacy')
	}));
	assert.strictEqual(reversed.terms.pair, 'LTC/ROD');
	assert.strictEqual(reversed.terms.assetClaimFee, CHAINS.getFees('LTC').claim);
	assert.strictEqual(reversed.terms.paymentClaimFee, CHAINS.getFees('ROD').claim);
}

function testProtocolV1Isolation() {
	values.clear();
	values.set('rodOtcState', JSON.stringify({ version: 1, payload: { sessions: { old: { swapId: 'old' } } } }));
	values.set('rodOtcLive', JSON.stringify({ old: { swapId: 'old', state: 'PREPARED' } }));
	values.set('rodOtcEngineConfig', JSON.stringify({ rodApiUrl: 'https://legacy.invalid' }));
	assert.deepStrictEqual(Object.keys(STORAGE.load().sessions), [], 'v1 storage state must be invisible to v2');
	assert.deepStrictEqual(Object.keys(ENGINE.loadLive()), [], 'v1 live swaps must not be readable or resumable');
	assert.strictEqual(ENGINE.loadConfig().chains.ROD.apiUrl, CHAINS.getDefinition('ROD').apiUrl,
		'v1 engine config must not be migrated into v2');

	const oldOffer = ENGINE.normalizeOffer('d/otc-swap/legacy', {
		version: 1,
		type: 'otc-order',
		pair: 'ROD/LTC',
		assetChain: 'ROD',
		paymentChain: 'LTC',
		give: '1',
		want: '1'
	});
	assert.strictEqual(oldOffer.ok, false, 'v1 ROD/LTC orderbook entries must be ignored');

	const oldEvent = signedFixture('07'.padStart(64, '0'));
	oldEvent.kind = 7340;
	expectThrow(() => NOSTR.validateEnvelope(oldEvent), /unsupported.*kind/i,
		'v1 swap event kind must not enter the v2 engine');
}

function testRecoveryExportImportRestoresLiveSwap() {
	values.clear();
	const swapId = 'recoverable-security-swap';
	const session = {
		swapId,
		role: 'seller',
		state: 'PREPARED',
		terms: { protocol: 2, termsHash: 'terms-hash', pair: 'ROD/DOGE', assetChain: 'ROD', paymentChain: 'DOGE' },
		assetRefund: { signedHex: 'aa'.repeat(120), localSig: 'bb' },
		paymentRefund: { signedHex: 'cc'.repeat(120), localSig: 'dd' },
		localChildPrivateKey: 'raw-private-key-must-not-export',
		adaptorSecret: 'raw-adaptor-secret-must-not-export',
		localNostrPrivateKey: 'raw-nostr-secret-must-not-export',
		_ep: 'sealed-child-key',
		_ea: 'sealed-adaptor-secret',
		_en: 'sealed-nostr-key'
	};
	ENGINE.saveConfig({
		relays: ['wss://relay.example'],
		chains: { ROD: { apiUrl: 'https://api.example.invalid', apiType: 'rod', refundBlocks: { asset: 480, payment: 120 }, confirmations: 1 } },
		rpcUrl: 'http://user:pass@127.0.0.1:18080/wallet/ROD',
		rpcPort: '18080',
		rpcUser: 'user',
		rpcPass: 'pass',
		rpcWallet: 'ROD'
	});
	ENGINE.saveLive(session);
	ENGINE.recordTrade(Object.assign({}, session, {
		orderId: 'recoverable-order',
		terms: Object.assign({}, session.terms, { assetAmount: '1.00000000', paymentAmount: '2.00000000' }),
		execution: { assetFunding: { txid: 'rod-funding' }, paymentFunding: { txid: 'alt-funding' } }
	}));

	const exported = ENGINE.exportRecoveryState();
	assert(!exported.includes('raw-private-key-must-not-export'), 'recovery export must not contain raw child private key');
	assert(!exported.includes('raw-adaptor-secret-must-not-export'), 'recovery export must not contain raw adaptor secret');
	assert(!exported.includes('raw-nostr-secret-must-not-export'), 'recovery export must not contain raw Nostr secret');
	assert(!exported.includes('user:pass'), 'recovery export must not contain RPC URL credentials');
	assert(!exported.includes('"rpcUser"'), 'recovery export must not contain RPC username');
	assert(!exported.includes('"rpcPass"'), 'recovery export must not contain RPC password');
	assert(exported.includes('spexSwapV2Hex_' + swapId + '_assetRefund_signedHex'), 'recovery export must include offloaded asset refund hex');
	assert(exported.includes('spexSwapV2Hex_' + swapId + '_paymentRefund_signedHex'), 'recovery export must include offloaded payment refund hex');

	values.clear();
	ENGINE.saveConfig({ rpcUrl: 'http://127.0.0.1:19090', rpcUser: 'local-user', rpcPass: 'local-pass' });
	const result = ENGINE.importRecoveryState(exported);
	const restored = ENGINE.restoreLive(swapId);
	assert.strictEqual(result.sessions, 1, 'one live session must be restored');
	assert.strictEqual(result.hexBlobs, 2, 'only two valid recovery blobs must be reported as restored');
	assert.strictEqual(JSON.stringify(result.importedSwapIds), JSON.stringify([swapId]),
		'import must report the exact restored swap IDs');
	assert(restored, 'imported live session must be visible to restoreLive');
	assert.strictEqual(restored.role, 'seller');
	assert.strictEqual(restored.state, 'PREPARED');
	assert.strictEqual(restored.assetRefund.signedHex, 'aa'.repeat(120), 'ROD refund hex must be restored from blob storage');
	assert.strictEqual(restored.paymentRefund.signedHex, 'cc'.repeat(120), 'alt refund hex must be restored from blob storage');
	assert.strictEqual(ENGINE.loadConfig().chains.ROD.apiUrl, 'https://api.example.invalid', 'recovery import must restore chain settings');
	assert.strictEqual(ENGINE.loadConfig().rpcUrl, 'http://127.0.0.1:19090', 'recovery import must preserve machine-local RPC URL');
	assert.strictEqual(ENGINE.loadConfig().rpcUser, 'local-user', 'recovery import must preserve machine-local RPC username');
	assert.strictEqual(ENGINE.loadConfig().rpcPass, 'local-pass', 'recovery import must preserve machine-local RPC password');
	assert.strictEqual(ENGINE.getHistory().length, 1, 'recovery import must restore trade history');

	const tampered = JSON.parse(exported);
	tampered.payload.live[swapId].state = 'COMPLETE';
	expectThrow(() => ENGINE.importRecoveryState(JSON.stringify(tampered)), /checksum/i, 'tampered recovery backup');

	expectThrow(() => ENGINE.importRecoveryState(exported), /overwrite existing swap/i,
		'import must refuse to overwrite an existing live session');
	assert.strictEqual(ENGINE.restoreLive(swapId).state, 'PREPARED',
		'conflict rejection must preserve the existing session');

	const malformedBlob = JSON.parse(exported);
	malformedBlob.payload.hexBlobs['spexSwapV2Hex_' + swapId + '_unexpected_signedHex'] = 'aa';
	malformedBlob.checksum = recoveryChecksum(malformedBlob.payload);
	values.clear();
	expectThrow(() => ENGINE.importRecoveryState(JSON.stringify(malformedBlob)), /invalid recovery blob/i,
		'import must reject unexpected recovery blob keys');
	assert.strictEqual(values.size, 0, 'invalid recovery blobs must be rejected before storage is changed');

	/* A quota/write failure after the live-map write must roll the complete
	   recovery namespace back to its previous state. */
	values.clear();
	const existing = {
		swapId: 'existing-swap',
		role: 'buyer',
		state: 'OPEN',
		terms: { termsHash: 'existing-terms', paymentChain: 'LTC' }
	};
	ENGINE.saveLive(existing);
	const existingBefore = localStorage.getItem('spexSwapV2Live');
	failStorageKey = 'spexSwapV2Hex_' + swapId + '_assetRefund_signedHex';
	expectThrow(() => ENGINE.importRecoveryState(exported), /existing local state was restored/i,
		'failed import must report successful rollback');
	assert.strictEqual(localStorage.getItem('spexSwapV2Live'), existingBefore,
		'failed import must restore the prior live-session map');
	assert.strictEqual(localStorage.getItem('spexSwapV2Hex_' + swapId + '_assetRefund_signedHex'), null,
		'failed import must remove partially written recovery blobs');
}

const tests = [
	['Nostr signatures', testNostrSignatures],
	['Nostr order-event authentication', testOrderEventAuthentication],
	['Nostr identity binding', testNostrIdentityBinding],
	['terms hash hard failure', testTermsHashHardFailure],
	['refund ordering for LTC and DOGE', testRefundOrdering],
	['runtime security boundary wiring', testRuntimeBoundaryWiring],
	['preserved protocol and DOGE vectors', testPreservedProtocolBehavior],
	['bilateral canonical terms reconstruction', testBilateralTermsReconstruction],
	['protocol v1 storage, order, and event isolation', testProtocolV1Isolation],
	['recovery export/import restores live swap state', testRecoveryExportImportRestoresLiveSwap]
];

const filter = process.env.SECURITY_REGRESSION_FILTER;
const selectedTests = filter
	? tests.filter(([name]) => filter.split(',').map((part) => part.trim()).filter(Boolean).includes(name))
	: tests;
if (filter && selectedTests.length === 0) {
	console.error('FAIL security regression filter matched no groups: ' + filter);
	process.exit(64);
}

let passed = 0;
for (const [name, test] of selectedTests) {
	try {
		test();
		passed += 1;
		console.log('PASS ' + name);
	} catch (error) {
		console.error('FAIL ' + name + ': ' + (error.stack || error));
		process.exitCode = 1;
	}
}
const label = filter ? ' selected security regression groups passed' : ' security regression groups passed';
console.log(passed + '/' + selectedTests.length + label);
