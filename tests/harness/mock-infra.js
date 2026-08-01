/*
 * Mock infrastructure for the ROD↔LTC OTC swap end-to-end proof.
 *  - MockChain: in-memory UTXO chain with FULL independent tx validation
 *    (bitcoinjs-lib legacy sighash + @noble/curves secp256k1 signature checks)
 *  - rodApiServer: mimics api.spacexpanse.org:1234 (sats everywhere:
 *    /unspent, /balance, /transaction — confirmed via live API probe)
 *  - esploraServer: mimics litecoinspace.org/api (sats everywhere)
 *  - nostrRelay: minimal NIP-01 relay over ws://
 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const { Transaction, script: bscript, crypto: bcrypto } = require('bitcoinjs-lib');
const { secp256k1 } = require('@noble/curves/secp256k1');
const bs58check = require('bs58check');
const { WebSocketServer } = require('ws');
const CHAIN_REGISTRY = require('../../js/chain-registry.js');

function sha256d(buf) {
  const a = crypto.createHash('sha256').update(buf).digest();
  return crypto.createHash('sha256').update(a).digest();
}
function hash160(buf) {
  return bcrypto.hash160(buf);
}
function p2pkhScript(pubkeyHash) {
  return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), pubkeyHash, Buffer.from([0x88, 0xac])]);
}
function p2shScript(scriptHash) {
  return Buffer.concat([Buffer.from([0xa9, 0x14]), scriptHash, Buffer.from([0x87])]);
}
/* Independent validation consumes the same authoritative address records as
   the browser. Adding a profile therefore cannot leave the mock decoder using
   another chain's P2SH prefix. Chain-specific known vectors remain separate
   tests so a wrong source record is still detected. */
const CHAIN_VERSIONS = {};
for (const code of CHAIN_REGISTRY.codes()) {
  const profile = CHAIN_REGISTRY.getProfile(code);
  CHAIN_VERSIONS[code] = { pub: profile.address.pub, p2sh: profile.address.multisig };
}
function addressToScript(address, chain) {
  const payload = Buffer.from(bs58check.decode(address));
  const version = payload[0];
  const hash = payload.subarray(1);
  const expected = CHAIN_VERSIONS[chain];
  if (!expected) throw new Error('Unknown mock-chain address profile: ' + chain);
  if (version === expected.p2sh) return p2shScript(hash);
  if (version === expected.pub) return p2pkhScript(hash);
  throw new Error(`Address version ${version} is not valid for mock chain ${chain}`);
}
function scriptToAddress(scriptBuf, chain) {
  const versions = CHAIN_VERSIONS[chain];
  if (!versions) throw new Error('Unknown mock-chain address profile: ' + chain);
  const pubVer = versions.pub;
  const p2shVer = versions.p2sh;
  if (scriptBuf.length === 25 && scriptBuf[0] === 0x76) {
    return bs58check.encode(Buffer.concat([Buffer.from([pubVer]), scriptBuf.subarray(3, 23)]));
  }
  if (scriptBuf.length === 23 && scriptBuf[0] === 0xa9) {
    return bs58check.encode(Buffer.concat([Buffer.from([p2shVer]), scriptBuf.subarray(2, 22)]));
  }
  return '';
}
/* SCRIPT_VERIFY_LOW_S is in STANDARD_SCRIPT_VERIFY_FLAGS on both Litecoin and
   Dogecoin, so a high-S signature is validly-signed but will NOT relay. The
   mocks reject it, which is what turns "our signatures are low-S" from an
   assumption into a proven property of every broadcast in this suite. */
function isLowS(sigWithHashType) {
  try {
    const der = sigWithHashType.subarray(0, sigWithHashType.length - 1);
    return secp256k1.Signature.fromDER(der).hasHighS() === false;
  } catch (e) {
    return false;
  }
}
function verifyDerSig(sigWithHashType, msgHash, pubkey) {
  try {
    const der = sigWithHashType.subarray(0, sigWithHashType.length - 1);
    const sig = secp256k1.Signature.fromDER(der);
    return secp256k1.verify(sig, msgHash, pubkey, { lowS: false });
  } catch (e) {
    return false;
  }
}

/* Relay/mining policy each mock enforces before accepting a transaction.

   DOGE numbers come from dogecoin/dogecoin v1.14.6+:
     DEFAULT_MIN_RELAY_TX_FEE = 0.001 DOGE/kB =  100 koinu/byte
     DEFAULT_BLOCK_MIN_TX_FEE = 0.01  DOGE/kB = 1000 koinu/byte
     DEFAULT_HARD_DUST_LIMIT  = 100000 koinu, DEFAULT_DUST_LIMIT = 1000000
   and GetDogecoinMinRelayFee() adds one flat softDust surcharge PER soft-dust
   output on top of the size-proportional component. blockMinPerByte is not a
   relay rule — it is recorded so the harness can assert that what we broadcast
   would actually be MINED, not merely accepted into a mempool. */
const CHAIN_POLICY = {};
for (const code of CHAIN_REGISTRY.swapCodes()) {
  const source = CHAIN_REGISTRY.getProfile(code).swap.policy;
  CHAIN_POLICY[code] = {
    relayPerByte: source.relayFloorPerByte,
    hardDust: source.hardDustSats,
    softDust: source.softDustSats,
    surcharge: source.dustSurchargeSats,
    blockMinPerByte: source.feeRatePerByte
  };
}

class MockChain {
  constructor(name) {
    this.name = name;              // 'ROD' | 'LTC' | 'DOGE'
    if (!CHAIN_POLICY[name]) throw new Error(`No certified mock policy for chain ${name}`);
    this.policy = CHAIN_POLICY[name];
    this.utxos = new Map();        // 'txid:vout' -> {txid, vout, value, script(Buffer), address}
    this.txs = new Map();          // txid -> {hex, tx, vouts:[{value, script, address, spent}]}
    this.broadcasts = [];          // audit log: {txid, hex, valid, details}
    this.height = 500000;
  }
  credit(address, valueSats) {
    const fakeTxid = crypto.randomBytes(32).toString('hex');
    const script = addressToScript(address, this.name);
    this.utxos.set(fakeTxid + ':0', { txid: fakeTxid, vout: 0, value: valueSats, script, address });
    this.txs.set(fakeTxid, {
      hex: '',
      tx: null,
      coinbase: true,
      vouts: [{ value: valueSats, script, address, spent: false }]
    });
    return fakeTxid;
  }
  utxosForAddress(address) {
    return [...this.utxos.values()].filter((u) => u.address === address);
  }
  balance(address) {
    return this.utxosForAddress(address).reduce((s, u) => s + u.value, 0);
  }
  confirmationsOf(txid) {
    const rec = this.txs.get(txid);
    if (!rec) return 0;
    const at = rec.acceptedAtHeight || this.height;
    return Math.max(1, this.height - at + 1);
  }
  /* Full validation: structure, input existence, nLockTime finality, value
     balance, and script/sig verification for P2PKH and P2SH 2-of-2
     CHECKMULTISIG inputs. */
  validateAndAccept(hex) {
    const details = [];
    /* Bitcoin Cash: signatures must carry SIGHASH_FORKID and commit to the
       BIP-143 preimage (bitcoinjs-lib's hashForWitnessV0 computes exactly
       that). Verifying BCH with the legacy algorithm would make this mock
       AGREE with a legacy-signing bug instead of catching it - the same trap
       the Blockchair prevout mapping fell into. */
    const forkId = this.name === 'BCH';
    const expectedHashType = forkId ? 0x41 : 0x01;
    const sighashFor = (tx, i, script, value) => forkId
      ? tx.hashForWitnessV0(i, script, value, expectedHashType)
      : tx.hashForSignature(i, script, expectedHashType);
    let tx;
    try {
      tx = Transaction.fromHex(hex);
    } catch (e) {
      return { ok: false, error: 'unparseable transaction: ' + e.message, details };
    }
    const txid = Buffer.from(sha256d(Buffer.from(hex, 'hex'))).reverse().toString('hex');
    if (this.txs.has(txid)) return { ok: false, error: 'txn-already-known', details };

    /* BIP-113-style finality: a tx with nLockTime > 0 is final only when
       every input sequence is 0xffffffff OR the chain height has reached the
       locktime. This is what makes pre-signed refunds time-enforced. */
    if (tx.locktime > 0 && tx.locktime < 500000000) {
      const allFinalSeq = tx.ins.every((i) => i.sequence === 0xffffffff);
      if (!allFinalSeq && tx.locktime > this.height) {
        return { ok: false, error: `non-final: locktime ${tx.locktime} > height ${this.height}`, details };
      }
      details.push(`locktime ${tx.locktime} satisfied at height ${this.height}`);
    }

    let inputSum = 0;
    const spentKeys = [];
    for (let i = 0; i < tx.ins.length; i++) {
      const prevTxid = Buffer.from(tx.ins[i].hash).reverse().toString('hex');
      const key = prevTxid + ':' + tx.ins[i].index;
      const utxo = this.utxos.get(key);
      if (!utxo) return { ok: false, error: 'missing-or-spent input ' + key, details };
      inputSum += utxo.value;
      spentKeys.push(key);

      // ---- script verification ----
      const chunks = bscript.decompile(tx.ins[i].script);
      if (utxo.script[0] === 0x76) {
        // P2PKH: <sig> <pubkey>
        if (!chunks || chunks.length !== 2) return { ok: false, error: `input ${i}: bad P2PKH scriptSig`, details };
        const [sig, pubkey] = chunks;
        if (!Buffer.isBuffer(sig) || !Buffer.isBuffer(pubkey)) return { ok: false, error: `input ${i}: bad P2PKH pushes`, details };
        if (!hash160(pubkey).equals(utxo.script.subarray(3, 23))) {
          return { ok: false, error: `input ${i}: pubkey hash mismatch`, details };
        }
        const hashType = sig[sig.length - 1];
        if (hashType !== expectedHashType) return { ok: false, error: `input ${i}: unexpected hashtype ${hashType} (expected ${expectedHashType})`, details };
        const sighash = sighashFor(tx, i, utxo.script, utxo.value);
        if (!verifyDerSig(sig, sighash, pubkey)) {
          return { ok: false, error: `input ${i}: P2PKH signature INVALID`, details };
        }
        if (!isLowS(sig)) return { ok: false, error: `input ${i}: non-canonical high-S signature (would not relay)`, details };
        details.push(`input ${i}: P2PKH signature valid (pubkey ${pubkey.toString('hex').slice(0, 16)}…)`);
      } else if (utxo.script[0] === 0xa9) {
        // P2SH: OP_0 <sig...> <redeemScript>
        if (!chunks || chunks.length < 3 || chunks[0] !== 0) {
          return { ok: false, error: `input ${i}: bad P2SH multisig scriptSig`, details };
        }
        const redeem = chunks[chunks.length - 1];
        if (!Buffer.isBuffer(redeem)) return { ok: false, error: `input ${i}: missing redeemScript`, details };
        if (!hash160(redeem).equals(utxo.script.subarray(2, 22))) {
          return { ok: false, error: `input ${i}: redeemScript hash mismatch`, details };
        }
        const redeemChunks = bscript.decompile(redeem);
        const m = redeemChunks[0] - 0x50; // OP_M
        const n = redeemChunks[redeemChunks.length - 2] - 0x50; // OP_N
        if (redeemChunks[redeemChunks.length - 1] !== 0xae) {
          return { ok: false, error: `input ${i}: redeemScript is not CHECKMULTISIG`, details };
        }
        const pubkeys = redeemChunks.slice(1, 1 + n);
        const sigs = chunks.slice(1, chunks.length - 1).filter((c) => Buffer.isBuffer(c) && c.length > 0);
        if (sigs.length < m) return { ok: false, error: `input ${i}: need ${m} sigs, got ${sigs.length}`, details };
        // CHECKMULTISIG order semantics: each sig must match pubkeys in order
        let pkIdx = 0;
        for (let s = 0; s < sigs.length; s++) {
          const hashType = sigs[s][sigs[s].length - 1];
          if (hashType !== expectedHashType) return { ok: false, error: `input ${i}: sig ${s} unexpected hashtype ${hashType} (expected ${expectedHashType})`, details };
          const sighash = sighashFor(tx, i, redeem, utxo.value);
          let matched = false;
          while (pkIdx < pubkeys.length && !matched) {
            if (verifyDerSig(sigs[s], sighash, pubkeys[pkIdx])) matched = true;
            pkIdx++;
          }
          if (!matched) return { ok: false, error: `input ${i}: multisig sig ${s} INVALID or out of order`, details };
          if (!isLowS(sigs[s])) return { ok: false, error: `input ${i}: multisig sig ${s} is high-S (would not relay)`, details };
        }
        details.push(`input ${i}: P2SH ${m}-of-${n} CHECKMULTISIG valid (${sigs.length} sigs verified in order)`);
      } else {
        return { ok: false, error: `input ${i}: unsupported prevout script`, details };
      }
    }

    let outputSum = 0;
    tx.outs.forEach((o) => { outputSum += Number(o.value); });
    if (outputSum > inputSum) return { ok: false, error: `bad-txns-in-belowout (${inputSum} < ${outputSum})`, details };
    const fee = inputSum - outputSum;
    const bytes = hex.length / 2;
    const policy = this.policy;

    /* Hard dust: on Dogecoin an output below DEFAULT_HARD_DUST_LIMIT makes the
       whole transaction non-standard, and no amount of fee can rescue it. */
    for (const o of tx.outs) {
      if (Number(o.value) > 0 && Number(o.value) < policy.hardDust) {
        return { ok: false, error: `dust output ${o.value} (hard limit ${policy.hardDust})`, details };
      }
    }

    /* GetDogecoinMinRelayFee(): size component + flat surcharge per soft-dust
       output. Degenerates to the plain per-byte floor on ROD and LTC. */
    let softDustOutputs = 0;
    if (policy.softDust > 0) {
      for (const o of tx.outs) {
        if (Number(o.value) < policy.softDust) softDustOutputs++;
      }
    }
    const minRelay = Math.ceil(bytes * policy.relayPerByte) + (softDustOutputs * policy.surcharge);
    if (fee < minRelay) {
      return {
        ok: false,
        error: `min relay fee not met: ${fee} for ${bytes} bytes` +
          (softDustOutputs ? ` + ${softDustOutputs} soft-dust output(s)` : '') + ` (need ${minRelay})`,
        details
      };
    }
    if (policy.blockMinPerByte > 0) {
      const blockMin = Math.ceil(bytes * policy.blockMinPerByte);
      if (fee < blockMin) {
        details.push(`WARNING: fee ${fee} is under -blockmintxfee ${blockMin} — would relay but not be mined`);
      } else {
        details.push(`fee clears -blockmintxfee (${blockMin}) — miners with default policy would include it`);
      }
    }

    // accept: spend inputs, add outputs, record spender for outspend lookups
    this.spenders = this.spenders || new Map();
    spentKeys.forEach((k) => { this.utxos.delete(k); this.spenders.set(k, txid); });
    const vouts = tx.outs.map((o, idx) => {
      const script = Buffer.from(o.script);
      const address = scriptToAddress(script, this.name);
      const rec = { value: Number(o.value), script, address, spent: false };
      this.utxos.set(txid + ':' + idx, { txid, vout: idx, value: rec.value, script, address });
      return rec;
    });
    this.txs.set(txid, { hex, tx, vouts, coinbase: false, acceptedAtHeight: this.height });
    details.push(`fee ${fee} sats over ${hex.length / 2} bytes (${(fee / (hex.length / 2)).toFixed(2)} sat/B)`);
    this.broadcasts.push({ txid, hex, valid: true, details: details.slice() });
    return { ok: true, txid, fee, details };
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}
function sendJson(res, obj, code) {
  res.writeHead(code || 200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(obj));
}
function sendText(res, text, code) {
  res.writeHead(code || 200, {
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(text);
}

/* ROD API mock: sats in all endpoints (/unspent, /balance, /transaction) */
function rodApiServer(chain, port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendText(res, '');
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'info') return sendJson(res, { result: { blocks: chain.height } });
    if (parts[0] === 'balance') {
      return sendJson(res, { result: { balance: chain.balance(decodeURIComponent(parts[1])) } });
    }
    if (parts[0] === 'unspent') {
      const utxos = chain.utxosForAddress(decodeURIComponent(parts[1])).map((u) => ({
        txid: u.txid,
        index: u.vout,
        value: u.value, // sats
        scriptPubKey: u.script.toString('hex')
      }));
      return sendJson(res, { result: utxos });
    }
    if (parts[0] === 'transaction') {
      const txidReq = decodeURIComponent(parts[1]);
      const rec = chain.txs.get(txidReq);
      if (!rec) return sendJson(res, { error: { message: 'transaction not found' } });
      return sendJson(res, {
        result: {
          txid: txidReq,
          confirmations: chain.confirmationsOf(txidReq),
          hex: rec.hex || '',
          vout: rec.vouts.map((v, n) => ({
            n,
            value: v.value, // sats — matches real ROD API (2026-07-18 live probe)
            scriptPubKey: { hex: v.script.toString('hex'), address: v.address }
          }))
        }
      });
    }
    if (parts[0] === 'broadcast' && req.method === 'POST') {
      const body = await readBody(req);
      const m = /(?:^|&)raw=([^&]+)/.exec(body);
      const hex = m ? decodeURIComponent(m[1]) : body.trim();
      const r = chain.validateAndAccept(hex);
      if (!r.ok) {
        chain.broadcasts.push({ txid: '', hex, valid: false, details: [r.error] });
        return sendJson(res, { error: { message: r.error } });
      }
      return sendJson(res, { result: r.txid });
    }
    sendJson(res, { error: { message: 'not found' } }, 404);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* esplora/mempool mock (litecoinspace.org/api shape): sats everywhere */
function esploraServer(chain, port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendText(res, '');
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    if (parts[0] !== 'api') return sendText(res, 'not found', 404);
    if (parts[1] === 'address' && parts.length === 3) {
      const addr = decodeURIComponent(parts[2]);
      const funded = chain.balance(addr);
      return sendJson(res, {
        address: addr,
        chain_stats: { funded_txo_sum: funded, spent_txo_sum: 0, tx_count: 1 },
        mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0, tx_count: 0 }
      });
    }
    if (parts[1] === 'address' && parts[3] === 'utxo') {
      const addr = decodeURIComponent(parts[2]);
      // real esplora /utxo has NO scriptpubkey field — keep it that way to
      // exercise the app's fallback-script path
      return sendJson(res, chain.utxosForAddress(addr).map((u) => ({
        txid: u.txid,
        vout: u.vout,
        status: { confirmed: true, block_height: chain.height },
        value: u.value // sats
      })));
    }
    if (parts[1] === 'blocks' && parts[2] === 'tip' && parts[3] === 'height') {
      return sendText(res, String(chain.height));
    }
    if (parts[1] === 'tx' && req.method === 'GET' && parts.length === 3) {
      const rec = chain.txs.get(decodeURIComponent(parts[2]));
      if (!rec) return sendText(res, 'Transaction not found', 404);
      return sendJson(res, {
        txid: parts[2],
        status: { confirmed: true, block_height: rec.acceptedAtHeight || chain.height },
        vout: rec.vouts.map((v) => ({
          scriptpubkey: v.script.toString('hex'),
          scriptpubkey_address: v.address,
          value: v.value // sats
        }))
      });
    }
    if (parts[1] === 'tx' && req.method === 'GET' && parts.length === 4 && parts[3] === 'hex') {
      const rec = chain.txs.get(decodeURIComponent(parts[2]));
      if (!rec || !rec.hex) return sendText(res, 'Transaction not found', 404);
      return sendText(res, rec.hex);
    }
    if (parts[1] === 'tx' && req.method === 'GET' && parts.length === 5 && parts[3] === 'outspend') {
      const txidReq = decodeURIComponent(parts[2]);
      const voutReq = parseInt(parts[4], 10);
      chain.spenders = chain.spenders || new Map();
      const spender = chain.spenders.get(txidReq + ':' + voutReq);
      if (spender) {
        return sendJson(res, { spent: true, txid: spender, status: { confirmed: true, block_height: chain.height } });
      }
      return sendJson(res, { spent: false });
    }
    if (parts[1] === 'tx' && req.method === 'POST') {
      const hex = (await readBody(req)).trim();
      const r = chain.validateAndAccept(hex);
      if (!r.ok) {
        chain.broadcasts.push({ txid: '', hex, valid: false, details: [r.error] });
        return sendText(res, 'sendrawtransaction RPC error: ' + r.error, 400);
      }
      return sendText(res, r.txid);
    }
    sendText(res, 'not found', 404);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* BlockCypher-shaped mock (api.blockcypher.com/v1/doge/main).

   Dogecoin has no public Esplora, so the wallet's default DOGE backend is
   BlockCypher and the response shape is materially different: outputs carry a
   `spent_by` field instead of a separate outspend endpoint, raw hex arrives
   inline via ?includeHex=true, and broadcast is a JSON POST rather than a
   plain-text body. Mocking THIS shape (rather than reusing the esplora mock)
   is what proves the explorer adapter actually translates a non-Esplora
   backend end-to-end, instead of only proving Dogecoin's version bytes. */
function blockcypherServer(chain, port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendText(res, '');
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);

    const txPayload = (txid) => {
      const rec = chain.txs.get(txid);
      if (!rec) return null;
      chain.spenders = chain.spenders || new Map();
      const height = rec.acceptedAtHeight || chain.height;
      return {
        hash: txid,
        block_height: height,
        confirmations: chain.confirmationsOf(txid),
        ver: rec.tx ? rec.tx.version : 1,
        lock_time: rec.tx ? rec.tx.locktime : 0,
        size: rec.hex ? rec.hex.length / 2 : 0,
        fees: 0,
        inputs: rec.tx
          ? rec.tx.ins.map((i) => ({
              prev_hash: Buffer.from(i.hash).reverse().toString('hex'),
              output_index: i.index,
              script: Buffer.from(i.script).toString('hex'),
              sequence: i.sequence
            }))
          : [],
        outputs: rec.vouts.map((v, n) => {
          const out = {
            value: v.value,
            script: v.script.toString('hex'),
            addresses: v.address ? [v.address] : []
          };
          /* BlockCypher OMITS spent_by entirely while an output is unspent —
             it does not send an empty string. The adapter must treat absence
             as "unspent", so the mock reproduces that exactly. */
          const spender = chain.spenders.get(txid + ':' + n);
          if (spender) out.spent_by = spender;
          return out;
        }),
        hex: rec.hex || ''
      };
    };

    // GET /  -> chain status
    if (parts.length === 0) {
      return sendJson(res, { name: chain.name.toLowerCase() + '/main', height: chain.height });
    }
    // GET /addrs/{addr}/balance
    if (parts[0] === 'addrs' && parts[2] === 'balance') {
      const addr = decodeURIComponent(parts[1]);
      return sendJson(res, { address: addr, balance: chain.balance(addr), unconfirmed_balance: 0, final_balance: chain.balance(addr) });
    }
    // GET /addrs/{addr}?unspentOnly=true&includeScript=true
    if (parts[0] === 'addrs' && parts.length === 2) {
      const addr = decodeURIComponent(parts[1]);
      const includeScript = url.searchParams.get('includeScript') === 'true';
      return sendJson(res, {
        address: addr,
        balance: chain.balance(addr),
        final_balance: chain.balance(addr),
        txrefs: chain.utxosForAddress(addr).map((u) => {
          const ref = {
            tx_hash: u.txid,
            block_height: chain.height,
            tx_output_n: u.vout,
            value: u.value,
            spent: false,
            confirmations: 1
          };
          if (includeScript) ref.script = u.script.toString('hex');
          return ref;
        })
      });
    }
    // GET /txs/{txid}?includeHex=true
    if (parts[0] === 'txs' && parts.length === 2 && req.method === 'GET') {
      const payload = txPayload(decodeURIComponent(parts[1]));
      if (!payload) return sendJson(res, { error: 'Transaction not found' }, 404);
      if (url.searchParams.get('includeHex') !== 'true') delete payload.hex;
      return sendJson(res, payload);
    }
    // POST /txs/push  {"tx":"<hex>"}
    if (parts[0] === 'txs' && parts[1] === 'push' && req.method === 'POST') {
      const body = await readBody(req);
      let hex = '';
      try {
        hex = (JSON.parse(body).tx || '').trim();
      } catch (e) {
        return sendJson(res, { error: 'malformed push body' }, 400);
      }
      const r = chain.validateAndAccept(hex);
      if (!r.ok) {
        chain.broadcasts.push({ txid: '', hex, valid: false, details: [r.error] });
        return sendJson(res, { error: r.error }, 400);
      }
      return sendJson(res, { tx: { hash: r.txid } });
    }
    sendJson(res, { error: 'not found' }, 404);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* Blockchair-shaped mock (api.blockchair.com/bitcoin-cash).

   Bitcoin Cash has no public Esplora and no BlockCypher support, so the
   wallet's default BCH backend is Blockchair. The response shape is deeply
   nested under data[key] with different endpoint patterns. Mocking THIS
   shape (rather than reusing the esplora mock) is what proves the Blockchair
   explorer adapter translates a non-Esplora backend end-to-end. */
function blockchairServer(chain, port) {
  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendText(res, '');
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);

    // GET /stats -> { data: { blocks: height } }
    if (parts[0] === 'stats' && parts.length === 1) {
      return sendJson(res, { data: { blocks: chain.height } });
    }
    // GET /dashboards/address/{addr} -> { data: { addr: { address: {balance}, utxo: [] } } }
    if (parts[0] === 'dashboards' && parts[1] === 'address' && parts.length === 3) {
      const addr = decodeURIComponent(parts[2]);
      /* limit is "{transactions},{utxo}" here. Honouring the utxo cap for real
         is what makes a bare "?limit=0" fail loudly in this harness instead of
         silently reporting every funded address as empty. */
      const utxoCap = parseInt((url.searchParams.get('limit') || '').split(',')[1], 10);
      const utxos = chain.utxosForAddress(addr).slice(0, isFinite(utxoCap) ? utxoCap : 100);
      const data = {};
      data[addr] = {
        address: { balance: chain.balance(addr) },
        utxo: utxos.map((u) => ({
          transaction_hash: u.txid,
          index: u.vout,
          value: u.value,
          block_id: chain.height
        }))
      };
      return sendJson(res, { data: data });
    }
    // GET /dashboards/transaction/{txid} -> deeply nested tx data
    if (parts[0] === 'dashboards' && parts[1] === 'transaction' && parts.length === 3) {
      const txid = decodeURIComponent(parts[2]);
      const rec = chain.txs.get(txid);
      if (!rec) return sendJson(res, { data: null, context: { error: 'Transaction not found' } }, 404);
      chain.spenders = chain.spenders || new Map();
      const height = rec.acceptedAtHeight || chain.height;
      /* Blockchair returns each input as the OUTPUT RECORD being consumed:
         transaction_hash/index are the prevout, spending_* refer to this tx.
         Emitting both correctly is what proves the adapter reads the prevout
         from the right pair of fields. */
      const inputs = rec.tx
        ? rec.tx.ins.map((i, n) => ({
            transaction_hash: Buffer.from(i.hash).reverse().toString('hex'),
            index: i.index,
            spending_transaction_hash: txid,
            spending_index: n,
            spending_signature_hex: Buffer.from(i.script).toString('hex'),
            spending_sequence: i.sequence,
            value: 0,
            recipient: ''
          }))
        : [];
      const outputs = rec.vouts.map((v, n) => {
        const out = {
          value: v.value,
          script_hex: v.script.toString('hex'),
          recipient: v.address || '',
          spending_transaction_hash: ''
        };
        const spender = chain.spenders.get(txid + ':' + n);
        if (spender) out.spending_transaction_hash = spender;
        return out;
      });
      const data = {};
      data[txid] = {
        transaction: {
          hash: txid,
          block_id: height,
          version: rec.tx ? rec.tx.version : 1,
          lock_time: rec.tx ? rec.tx.locktime : 0,
          size: rec.hex ? rec.hex.length / 2 : 0,
          fee: 0
        },
        inputs: inputs,
        outputs: outputs
      };
      return sendJson(res, { data: data });
    }
    // GET /raw/transaction/{txid} -> { data: { txid: { raw_transaction: hex } } }
    if (parts[0] === 'raw' && parts[1] === 'transaction' && parts.length === 3) {
      const txid = decodeURIComponent(parts[2]);
      const rec = chain.txs.get(txid);
      if (!rec || !rec.hex) return sendJson(res, { data: null, context: { error: 'Transaction not found' } }, 404);
      const data = {};
      data[txid] = { raw_transaction: rec.hex };
      return sendJson(res, { data: data });
    }
    // POST /push/transaction  data=<hex> (form-encoded)
    if (parts[0] === 'push' && parts[1] === 'transaction' && req.method === 'POST') {
      const body = await readBody(req);
      // body is form-encoded: data=<hex>
      let hex = '';
      const match = body.match(/(?:^|&)data=([^&]*)/);
      if (match) hex = decodeURIComponent(match[1]).trim();
      if (!hex) {
        return sendJson(res, { context: { error: 'missing transaction hex' } }, 400);
      }
      const r = chain.validateAndAccept(hex);
      if (!r.ok) {
        chain.broadcasts.push({ txid: '', hex, valid: false, details: [r.error] });
        return sendJson(res, { context: { error: r.error } }, 400);
      }
      return sendJson(res, { data: { transaction_hash: r.txid } });
    }
    sendJson(res, { context: { error: 'not found' } }, 404);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* Minimal NIP-01 relay */
function nostrRelay(port) {
  const events = [];
  const wss = new WebSocketServer({ host: '127.0.0.1', port });
  const log = [];
  function matches(ev, filter) {
    if (filter.kinds && !filter.kinds.includes(ev.kind)) return false;
    for (const key of Object.keys(filter)) {
      if (key.startsWith('#')) {
        const tagName = key.slice(1);
        const wanted = filter[key];
        const has = (ev.tags || []).some((t) => t[0] === tagName && wanted.includes(t[1]));
        if (!has) return false;
      }
    }
    return true;
  }
  wss.on('connection', (ws) => {
    const subs = new Map();
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (msg[0] === 'EVENT') {
        const ev = msg[1];
        if (!events.find((e) => e.id === ev.id)) events.push(ev);
        log.push({ dir: 'in', kind: ev.kind, id: ev.id });
        ws.send(JSON.stringify(['OK', ev.id, true, '']));
        // fan out to every sub on every client
        for (const client of wss.clients) {
          if (client.readyState !== 1) continue;
          const clientSubs = client._subs || new Map();
          for (const [sid, filter] of clientSubs) {
            if (matches(ev, filter)) client.send(JSON.stringify(['EVENT', sid, ev]));
          }
        }
      } else if (msg[0] === 'REQ') {
        const sid = msg[1];
        const filter = msg[2] || {};
        subs.set(sid, filter);
        ws._subs = subs;
        for (const ev of events) {
          if (matches(ev, filter)) ws.send(JSON.stringify(['EVENT', sid, ev]));
        }
        ws.send(JSON.stringify(['EOSE', sid]));
      } else if (msg[0] === 'CLOSE') {
        subs.delete(msg[1]);
      }
    });
    ws._subs = subs;
  });
  return { wss, events, log };
}

/* Static file server for the wallet app */
function staticServer(rootDir, port) {
  const fs = require('fs');
  const path = require('path');
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject' };
  const server = http.createServer((req, res) => {
    let p = new URL(req.url, 'http://x').pathname;
    if (p === '/') p = '/index.html';
    const file = path.join(rootDir, p);
    if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); return res.end('nope');
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { MockChain, rodApiServer, esploraServer, blockcypherServer, blockchairServer, nostrRelay, staticServer, addressToScript, CHAIN_VERSIONS, CHAIN_POLICY };
