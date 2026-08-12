#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const requests = [];
let responder = null;

function Deferred() {
	let resolvePromise;
	let rejectPromise;
	const promise = new Promise((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		resolve(value) { resolvePromise(value); return this; },
		reject(value) { rejectPromise(value instanceof Error ? value : new Error(String(value))); return this; },
		promise() { return promise; },
		then() { return promise.then.apply(promise, arguments); },
		fail(fn) { promise.catch(fn); return this; }
	};
}

const context = {
	console,
	window: null,
	jQuery: {
		Deferred,
		when(value) { return Promise.resolve(value); }
	},
	coinjs: {
		isArray: Array.isArray,
		ajax(url, callback, method, options) {
			requests.push({ url, method: method || 'GET', options: options || {} });
			Promise.resolve().then(() => responder(url, method || 'GET', options || {})).then(callback);
		}
	}
};
context.window = context;
vm.createContext(context);
vm.runInContext(
	fs.readFileSync(path.join(root, 'js', 'otc-explorer.js'), 'utf8'),
	context,
	{ filename: 'js/otc-explorer.js' }
);

const explorer = context.coinjs.explorer;
function network(code, apiType) {
	return { code, apiType, apiBase: 'https://mock.invalid/' + code.toLowerCase() };
}
function reset(nextResponder) {
	requests.length = 0;
	responder = nextResponder;
}
async function rejects(promise, pattern, label) {
	let error = null;
	try { await promise; } catch (caught) { error = caught; }
	assert(error, label + ': expected rejection');
	assert(pattern.test(String(error.message || error)), label + ': unexpected "' + error + '"');
}

async function testEsplora() {
	const net = network('DGB', 'esplora');
	reset((url, method) => {
		if (url.endsWith('/address/Daddr')) {
			return JSON.stringify({
				chain_stats: { funded_txo_sum: 200000000, spent_txo_sum: 25000000 },
				mempool_stats: { funded_txo_sum: 5000000, spent_txo_sum: 1000000 }
			});
		}
		if (url.endsWith('/address/Daddr/utxo')) {
			return JSON.stringify([{ txid: '11'.repeat(32), vout: 2, value: 179000000, status: { confirmed: true } }]);
		}
		if (url.endsWith('/blocks/tip/height')) return '21000000\n';
		if (url.endsWith('/tx') && method === 'POST') return '22'.repeat(32);
		throw new Error('unexpected Esplora request ' + method + ' ' + url);
	});
	assert.strictEqual(await explorer.balance(net, 'Daddr'), 179000000);
	assert.deepStrictEqual(
		JSON.parse(JSON.stringify(await explorer.utxos(net, 'Daddr'))),
		[{ txid: '11'.repeat(32), vout: 2, value: 179000000, scriptpubkey: '', confirmations: 1 }]
	);
	assert.strictEqual(await explorer.tipHeight(net), 21000000);
	const broadcast = await explorer.broadcast(net, '00');
	assert.strictEqual(broadcast.success, true);
	assert.strictEqual(broadcast.txid, '22'.repeat(32));
	assert(requests.some((request) => request.method === 'POST' && request.options.contentType === 'text/plain'));

	reset((url) => url.endsWith('/hex') ? '<html>gateway error</html>' : '0');
	await rejects(explorer.txHex(net, '33'.repeat(32)), /invalid tx hex/i, 'invalid Esplora tx hex');
	await rejects(explorer.tipHeight(net), /invalid tip height/i, 'invalid Esplora tip');
}

async function testBlockCypher() {
	const net = network('DOGE', 'blockcypher');
	const txid = '44'.repeat(32);
	reset((url, method, options) => {
		if (url.endsWith('/doge')) return JSON.stringify({ height: 6000000 });
		if (url.includes('/addrs/Ddoge/balance')) return JSON.stringify({ balance: 1, final_balance: 0 });
		if (url.includes('/txs/' + txid)) {
			return JSON.stringify({
				hash: txid,
				block_height: 5999999,
				confirmations: 2,
				fees: 1000000,
				hex: '01000000',
				inputs: [{
					prev_hash: '55'.repeat(32), output_index: 3, output_value: 50000000,
					script: 'aa', sequence: 4294967294, addresses: ['Dprev']
				}],
				outputs: [{
					value: 49000000, script: 'bb', addresses: ['Dout'], spent_by: '66'.repeat(32)
				}]
			});
		}
		if (url.endsWith('/txs/push') && method === 'POST') {
			assert.strictEqual(JSON.parse(options.body).tx, '01000000');
			return JSON.stringify({ tx: { hash: txid } });
		}
		throw new Error('unexpected BlockCypher request ' + method + ' ' + url);
	});
	assert.strictEqual(await explorer.balance(net, 'Ddoge'), 0, 'zero final_balance must not fall back to stale balance');
	assert.strictEqual(await explorer.tipHeight(net), 6000000);
	const tx = await explorer.tx(net, txid);
	assert.strictEqual(tx.vin[0].txid, '55'.repeat(32));
	assert.strictEqual(tx.vin[0].vout, 3);
	assert.strictEqual(tx.vout[0].spent_by, '66'.repeat(32));
	assert.strictEqual((await explorer.outspend(net, txid, 0)).spent, true);
	assert.strictEqual(await explorer.txHex(net, txid), '01000000');
	assert.strictEqual((await explorer.broadcast(net, '01000000')).success, true);
}

async function testBlockchair() {
	const net = network('BCH', 'blockchair');
	const txid = '77'.repeat(32);
	reset((url) => {
		if (url.endsWith('/dashboards/transaction/' + txid)) {
			const data = {};
			data[txid] = {
				transaction: { hash: txid, block_id: 800000, version: 2, lock_time: 0, size: 300, fee: 1000 },
				inputs: [{
					transaction_hash: '88'.repeat(32),
					index: 4,
					spending_transaction_hash: txid,
					spending_index: 0,
					spending_signature_hex: 'aa',
					spending_sequence: 4294967294,
					value: 100000,
					recipient: 'prev'
				}],
				outputs: [{ index: 0, value: 99000, script_hex: 'bb', recipient: 'out' }]
			};
			return JSON.stringify({ data });
		}
		throw new Error('unexpected Blockchair request ' + url);
	});
	const tx = await explorer.tx(net, txid);
	assert.strictEqual(tx.vin[0].txid, '88'.repeat(32), 'prevout must not point back to the spending transaction');
	assert.strictEqual(tx.vin[0].vout, 4);
	assert.strictEqual(tx.vin[0].sequence, 4294967294);
}

async function testBlockbook() {
	const net = network('BCH', 'blockbook');
	const txid = '99'.repeat(32);
	reset((url) => {
		if (url.includes('/api/v2/address/qaddr')) {
			return JSON.stringify({ balance: '9007199254740000', unconfirmedBalance: '991' });
		}
		if (url.endsWith('/api/v2')) return JSON.stringify({ blockbook: { bestHeight: 900000 } });
		if (url.includes('/api/v2/tx/' + txid)) {
			return JSON.stringify({
				txid, blockHeight: 899999, confirmations: 2, fees: '1000', hex: '01000000',
				vin: [{ txid: 'aa'.repeat(32), vout: 1, value: '100000', sequence: 4294967294, addresses: ['prev'] }],
				vout: [{ n: 0, value: '99000', hex: 'bb', addresses: ['out'], spent: false }]
			});
		}
		throw new Error('unexpected Blockbook request ' + url);
	});
	assert.strictEqual(await explorer.balance(net, 'qaddr'), 9007199254740991);
	assert.strictEqual(await explorer.tipHeight(net), 900000);
	const tx = await explorer.tx(net, txid);
	assert.strictEqual(tx.vin[0].sequence, 4294967294);
	assert.strictEqual(tx.status.confirmed, true);
	assert.strictEqual(await explorer.txHex(net, txid), '01000000');
}

async function testStoneApi() {
	const net = { code: 'STONE', apiType: 'stoneapi', apiBase: 'https://mock.invalid/stone/api/v1' };
	const txid = 'ab'.repeat(32);
	reset((url, method, options) => {
		if (url.includes('/api/v1/address/Sstone/balance')) {
			return JSON.stringify({ ok: true, confirmed_sats: 123456789, unconfirmed_sats: 11, total_stone: 1.23456789 });
		}
		if (url.includes('/api/v1/address/Sstone/utxos')) {
			return JSON.stringify({
				ok: true,
				utxos: [{ txid, vout: 1, value_sats: '123456789', script_pubkey: '76a9', height: 19040 }]
			});
		}
		if (url.endsWith('/api/v1/height')) return JSON.stringify({ ok: true, height: 19041 });
		if (url.includes('/api/v1/tx/' + txid)) {
			return JSON.stringify({
				ok: true,
				txid,
				hex: '01000000',
				confirmations: 2,
				block_height: 19040
			});
		}
		if (url.endsWith('/api/v1/broadcast') && method === 'POST') {
			assert.strictEqual(options.body, '01000000');
			assert.strictEqual(options.contentType, 'text/plain');
			return JSON.stringify({ ok: true, txid });
		}
		throw new Error('unexpected STONE API request ' + method + ' ' + url);
	});
	assert.strictEqual(await explorer.balance(net, 'Sstone'), 123456789);
	assert.strictEqual(requests[0].url.includes('/api/v1/api/v1/'), false, 'STONE base normalization must avoid duplicated /api/v1');
	assert.deepStrictEqual(
		JSON.parse(JSON.stringify(await explorer.utxos(net, 'Sstone'))),
		[{ txid, vout: 1, value: 123456789, scriptpubkey: '76a9', confirmations: 1 }]
	);
	assert.strictEqual(await explorer.tipHeight(net), 19041);
	const tx = await explorer.tx(net, txid);
	assert.strictEqual(tx.txid, txid);
	assert.strictEqual(tx.hex, '01000000');
	assert.deepStrictEqual(JSON.parse(JSON.stringify(tx.vin)), []);
	assert.deepStrictEqual(JSON.parse(JSON.stringify(tx.vout)), []);
	assert.strictEqual((await explorer.outspend(net, txid, 0)).spent, false);
	assert.strictEqual(await explorer.txHex(net, txid), '01000000');
	assert.strictEqual((await explorer.broadcast(net, '01000000')).success, true);

	reset(() => JSON.stringify({ ok: false, error: 'bad stone request' }));
	await rejects(explorer.tipHeight(net), /bad stone request/i, 'STONE api error envelope');
}

async function testFailureIsolationAndCoalescing() {
	const net = network('DGB', 'esplora');
	let hits = 0;
	reset(async () => {
		hits += 1;
		await new Promise((resolve) => setTimeout(resolve, 10));
		return hits === 1 ? '{"error":"rate limited"}' : '12345';
	});
	const first = await Promise.allSettled([
		explorer.tipHeight(net),
		explorer.tipHeight(net),
		explorer.tipHeight(net)
	]);
	assert.strictEqual(hits, 1, 'concurrent identical GETs must coalesce');
	assert(first.every((result) => result.status === 'rejected'), 'all coalesced callers must observe the failure');
	assert.strictEqual(await explorer.tipHeight(net), 12345, 'a failed request must not poison a later retry');
	assert.strictEqual(hits, 2);

	await rejects(
		explorer.balance({ code: 'NOPE', apiType: 'unknown', apiBase: 'https://invalid' }, 'x'),
		/no usable explorer backend/i,
		'unknown driver'
	);
}

const tests = [
	['Esplora contract and malformed responses', testEsplora],
	['BlockCypher normalization', testBlockCypher],
	['Blockchair prevout mapping', testBlockchair],
	['Blockbook normalization and safe integers', testBlockbook],
	['STONE wallet API normalization', testStoneApi],
	['failure isolation and in-flight coalescing', testFailureIsolationAndCoalescing]
];

(async () => {
	let passed = 0;
	for (const [name, test] of tests) {
		try {
			await test();
			passed += 1;
			console.log('PASS ' + name);
		} catch (error) {
			console.error('FAIL ' + name + ': ' + (error.stack || error));
			process.exitCode = 1;
		}
	}
	console.log(passed + '/' + tests.length + ' explorer contract groups passed');
})();
