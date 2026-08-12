/*
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 *
 * otc-explorer.js — pluggable block-explorer adapter.
 *
 * The wallet's chain code was written against the Blockstream Esplora REST
 * shape, which Litecoin has a public instance of and Dogecoin does not. Rather
 * than fork every call site per chain, this module normalises each supported
 * backend INTO the Esplora shape, so everything downstream keeps consuming one
 * response format:
 *
 *   utxos(network, address)      -> [ {txid, vout, value, scriptpubkey} ]
 *   balance(network, address)    -> <int base units>
 *   tx(network, txid)            -> { txid, vin[], vout[], status{}, hex }
 *   txHex(network, txid)         -> "<raw hex>"
 *   outspend(network, txid, n)   -> { spent, txid }
 *   tipHeight(network)           -> <int>
 *   broadcast(network, hex)      -> { success, txid, error }
 *
 * Values are ALWAYS integer base units (satoshi / koinu) — never coin floats.
 *
 * Backends
 * --------
 * esplora      Blockstream Esplora and its forks (litecoinspace.org for LTC,
 *              digiexplorer.info for DGB, or self-hosted electrs-doge for
 *              DOGE). Native shape, passthrough.
 * blockcypher  The default for Dogecoin: the only keyless public API serving
 *              permissive CORS, raw transaction hex AND a spending-tx lookup,
 *              all three of which this protocol requires.
 *
 * Load order: after coin.js (needs coinjs.ajax) and before any module that
 * performs chain I/O.
 */
(function () {
	'use strict';

	var explorer = coinjs.explorer = {};

	function deferred() { return jQuery.Deferred(); }

	function toInt(value, fallback) {
		var parsed = parseInt(value, 10);
		return isFinite(parsed) ? parsed : (fallback === undefined ? 0 : fallback);
	}

	/* Base units only. Some backends return decimal STRINGS whose coin value can
	   exceed Number.MAX_SAFE_INTEGER on a chain with Dogecoin's supply, so a
	   plain parseInt on a coin-denominated string would silently lose precision.
	   Anything containing '.' is coin-denominated and converted exactly. */
	function baseUnits(value) {
		if (typeof value === 'number') {
			if (!isFinite(value)) throw new Error('Invalid amount: ' + value);
			return Math.round(value);
		}
		var text = String(value == null ? '0' : value).replace(/^\s+|\s+$/g, '');
		if (text.indexOf('.') !== -1) {
			var parts = text.split('.');
			var whole = toInt(parts[0], 0);
			var fraction = (parts[1] || '').substring(0, 8);
			while (fraction.length < 8) fraction += '0';
			return whole * 100000000 + toInt(fraction, 0);
		}
		return toInt(text, 0);
	}

	/* ------------------------------------------------------------------
	   In-flight request coalescing.

	   The automation re-drives every live session on a timer, and several
	   sessions on the same chain ask for the same tip height or the same
	   transaction within one tick. Those duplicate GETs are merged into a
	   single HTTP request, which matters on BlockCypher's keyless tier
	   (~100 requests/hour per source IP).

	   This is deliberately NOT a time-based cache. A response is shared only
	   while its request is still outstanding, so a caller can never observe a
	   value that was already stale when it asked — which in a swap is the
	   difference between seeing a counterparty's claim in time to recover the
	   secret and missing it. It also cannot pin a failure: coinjs.ajax has no
	   error channel (it invokes its success callback with the body of a 4xx,
	   a 5xx or a timeout), so an errored response resolves like any other and
	   a TTL cache would have held it for the full TTL.
	   ------------------------------------------------------------------ */

	var inFlight = {};

	function get(url) {
		if (inFlight[url]) return inFlight[url];
		var d = deferred();
		inFlight[url] = d.promise();
		coinjs.ajax(url, function (response) {
			delete inFlight[url];
			d.resolve(response);
		}, 'GET');
		return inFlight[url];
	}

	function getJson(url) {
		return get(url).then(function (response) {
			var parsed;
			try {
				parsed = JSON.parse(response);
			} catch (e) {
				return deferred().reject('Invalid JSON from ' + url).promise();
			}
			if (parsed && parsed.error && !parsed.data) {
				var message = (parsed.error && parsed.error.message) ? parsed.error.message : String(parsed.error);
				return deferred().reject(message).promise();
			}
			if (parsed && parsed.ok === false) {
				var apiMessage = parsed.error || parsed.message || ('API request failed for ' + url);
				if (typeof apiMessage !== 'string') apiMessage = JSON.stringify(apiMessage);
				return deferred().reject(apiMessage).promise();
			}
			return parsed;
		});
	}

	function getText(url) {
		return get(url).then(function (response) {
			return String(response == null ? '' : response).replace(/^\s+|\s+$/g, '');
		});
	}

	function postRaw(url, body, contentType) {
		var d = deferred();
		coinjs.ajax(url, function (response) {
			d.resolve(String(response == null ? '' : response));
		}, 'POST', { body: body, contentType: contentType || 'text/plain' });
		return d.promise();
	}

	/* ------------------------------------------------------------------
	   Driver: Esplora (native shape)
	   ------------------------------------------------------------------ */

	var esploraDriver = {
		name: 'esplora',
		utxos: function (base, address) {
			return getJson(base + '/address/' + encodeURIComponent(address) + '/utxo').then(function (list) {
				if (!coinjs.isArray(list)) {
					return deferred().reject('Unexpected utxo response').promise();
				}
				var out = [];
				for (var i = 0; i < list.length; i++) {
					var u = list[i];
					out.push({
						txid: u.txid || u.transaction_hash,
						vout: (typeof u.vout !== 'undefined') ? u.vout : u.index,
						value: baseUnits(u.value),
						scriptpubkey: u.scriptpubkey || u.script || '',
						confirmations: (u.status && u.status.confirmed) ? 1 : (u.confirmations || 0)
					});
				}
				return out;
			});
		},
		balance: function (base, address) {
			return getJson(base + '/address/' + encodeURIComponent(address)).then(function (data) {
				var chain = data.chain_stats || {};
				var mempool = data.mempool_stats || {};
				var funded = toInt(chain.funded_txo_sum, 0) + toInt(mempool.funded_txo_sum, 0);
				var spent = toInt(chain.spent_txo_sum, 0) + toInt(mempool.spent_txo_sum, 0);
				return funded - spent;
			});
		},
		tx: function (base, txid) {
			return getJson(base + '/tx/' + encodeURIComponent(txid));
		},
		txHex: function (base, txid) {
			return getText(base + '/tx/' + encodeURIComponent(txid) + '/hex').then(function (hex) {
				if (!/^[0-9a-f]+$/i.test(hex)) {
					return deferred().reject('Invalid tx hex response').promise();
				}
				return hex;
			});
		},
		outspend: function (base, txid, vout) {
			return getJson(base + '/tx/' + encodeURIComponent(txid) + '/outspend/' + toInt(vout, 0));
		},
		tipHeight: function (base) {
			return getText(base + '/blocks/tip/height').then(function (body) {
				var height = toInt(String(body).replace(/[^0-9]/g, ''), 0);
				if (height <= 0) return deferred().reject('Invalid tip height: ' + body).promise();
				return height;
			});
		},
		broadcast: function (base, txhex) {
			return postRaw(base + '/tx', txhex, 'text/plain').then(function (body) {
				var text = body.replace(/^"|"$/g, '');
				if (/^[a-fA-F0-9]{64}$/.test(text)) {
					return { success: true, txid: text, error: '', raw: body };
				}
				var message = text || 'Broadcast failed';
				try {
					var parsed = JSON.parse(text);
					if (parsed && (parsed.error || parsed.message)) message = parsed.error || parsed.message;
				} catch (e) { /* Esplora returns plain-text errors */ }
				return { success: false, txid: '', error: message, raw: body };
			});
		}
	};

	/* ------------------------------------------------------------------
	   Driver: BlockCypher

	   Docs: https://www.blockcypher.com/dev/bitcoin/
	   Base: https://api.blockcypher.com/v1/doge/main
	   All amounts are integer base units. block_height is -1 while unconfirmed.
	   ------------------------------------------------------------------ */

	function blockcypherTxToEsplora(tx) {
		var inputs = tx.inputs || [];
		var outputs = tx.outputs || [];
		var vin = [];
		for (var i = 0; i < inputs.length; i++) {
			vin.push({
				txid: inputs[i].prev_hash || '',
				vout: toInt(inputs[i].output_index, 0),
				scriptsig: inputs[i].script || '',
				sequence: toInt(inputs[i].sequence, 0xffffffff),
				prevout: {
					value: baseUnits(inputs[i].output_value || 0),
					scriptpubkey_address: (inputs[i].addresses && inputs[i].addresses[0]) || ''
				}
			});
		}
		var vout = [];
		for (var j = 0; j < outputs.length; j++) {
			vout.push({
				n: j,
				value: baseUnits(outputs[j].value),
				scriptpubkey: outputs[j].script || '',
				scriptpubkey_address: (outputs[j].addresses && outputs[j].addresses[0]) || '',
				/* preserved so outspend() can answer without a second request */
				spent_by: outputs[j].spent_by || ''
			});
		}
		var height = toInt(tx.block_height, -1);
		var confirmed = height > 0;
		return {
			txid: tx.hash || tx.txid || '',
			version: toInt(tx.ver, 1),
			locktime: toInt(tx.lock_time, 0),
			size: toInt(tx.size, 0),
			fee: baseUnits(tx.fees || 0),
			vin: vin,
			vout: vout,
			hex: tx.hex || '',
			confirmations: toInt(tx.confirmations, confirmed ? 1 : 0),
			status: { confirmed: confirmed, block_height: confirmed ? height : 0 }
		};
	}

	function blockcypherTxUrl(base, txid) {
		return base + '/txs/' + encodeURIComponent(txid) + '?includeHex=true&limit=200';
	}

	var blockcypherDriver = {
		name: 'blockcypher',
		utxos: function (base, address) {
			var url = base + '/addrs/' + encodeURIComponent(address) + '?unspentOnly=true&includeScript=true&limit=2000';
			return getJson(url).then(function (data) {
				var refs = (data.txrefs || []).concat(data.unconfirmed_txrefs || []);
				var out = [];
				for (var i = 0; i < refs.length; i++) {
					var r = refs[i];
					/* unspentOnly is advisory on some deployments — filter again. */
					if (r.spent === true) continue;
					out.push({
						txid: r.tx_hash,
						vout: toInt(r.tx_output_n, 0),
						value: baseUnits(r.value),
						scriptpubkey: r.script || '',
						confirmations: toInt(r.confirmations, 0)
					});
				}
				return out;
			});
		},
		balance: function (base, address) {
			return getJson(base + '/addrs/' + encodeURIComponent(address) + '/balance').then(function (data) {
				return baseUnits(data.final_balance != null ? data.final_balance : (data.balance || 0));
			});
		},
		tx: function (base, txid) {
			return getJson(blockcypherTxUrl(base, txid)).then(blockcypherTxToEsplora);
		},
		txHex: function (base, txid) {
			return blockcypherDriver.tx(base, txid).then(function (tx) {
				if (tx.hex && /^[0-9a-f]+$/i.test(tx.hex)) return tx.hex;
				return deferred().reject('BlockCypher returned no tx hex for ' + txid).promise();
			});
		},
		outspend: function (base, txid, vout) {
			/* BlockCypher marks a spent output with spent_by; the field is
			   omitted entirely while the output is still unspent. */
			return blockcypherDriver.tx(base, txid).then(function (tx) {
				var out = tx.vout[toInt(vout, 0)];
				if (!out) return { spent: false };
				return out.spent_by ? { spent: true, txid: out.spent_by } : { spent: false };
			});
		},
		tipHeight: function (base) {
			return getJson(base).then(function (data) {
				var height = toInt(data.height, 0);
				if (height <= 0) return deferred().reject('Invalid BlockCypher tip height').promise();
				return height;
			});
		},
		broadcast: function (base, txhex) {
			return postRaw(base + '/txs/push', JSON.stringify({ tx: txhex }), 'application/json')
				.then(function (body) {
					var parsed;
					try {
						parsed = JSON.parse(body);
					} catch (e) {
						return { success: false, txid: '', error: body || 'Broadcast failed', raw: body };
					}
					var txid = (parsed && parsed.tx && (parsed.tx.hash || parsed.tx.txid)) || parsed.hash || '';
					if (txid) return { success: true, txid: txid, error: '', raw: parsed };
					var message = parsed.error || parsed.errors || 'Broadcast failed';
					if (typeof message !== 'string') message = JSON.stringify(message);
					return { success: false, txid: '', error: message, raw: parsed };
				});
		}
	};

	/* ------------------------------------------------------------------
	   Driver: Blockchair

	   Docs: https://blockchair.com/api
	   Base: https://api.blockchair.com/bitcoin-cash  (or /digibyte, etc.)
	   Amounts are always integer base units. The dashboards endpoint wraps
	   everything under data[address].address (balance, utxo, transactions).
	   ------------------------------------------------------------------ */

	var blockchairDriver = {
		name: 'blockchair',
		utxos: function (base, address) {
			var url = base + '/dashboards/address/' + encodeURIComponent(address) + '?limit=100';
			return getJson(url).then(function (data) {
				if (!data || !data.data || !data.data[address]) {
					return deferred().reject('Blockchair: unexpected response for ' + address).promise();
				}
				var utxoList = data.data[address].utxo || [];
				var out = [];
				for (var i = 0; i < utxoList.length; i++) {
					var u = utxoList[i];
					out.push({
						txid: u.transaction_hash,
						vout: toInt(u.index, 0),
						value: baseUnits(u.value),
						scriptpubkey: '',
						confirmations: toInt(u.block_id, -1) > 0 ? 1 : 0
					});
				}
				return out;
			});
		},
		balance: function (base, address) {
			var url = base + '/dashboards/address/' + encodeURIComponent(address);
			return getJson(url).then(function (data) {
				if (!data || !data.data || !data.data[address]) {
					return deferred().reject('Blockchair: unexpected response for ' + address).promise();
				}
				var info = data.data[address].address;
				return baseUnits(info.balance || 0);
			});
		},
		tx: function (base, txid) {
			var url = base + '/dashboards/transaction/' + encodeURIComponent(txid);
			return getJson(url).then(function (data) {
				if (!data || !data.data || !data.data[txid]) {
					return deferred().reject('Blockchair: unknown transaction ' + txid).promise();
				}
				var txData = data.data[txid];
				var tx = txData.transaction || {};
				var inputs = txData.inputs || [];
				var outputs = txData.outputs || [];
				var vin = [];
				for (var i = 0; i < inputs.length; i++) {
					vin.push({
						/* Blockchair describes the output being spent here.
						   transaction_hash/index identify that prevout;
						   spending_* identify the transaction currently being
						   viewed and must never be fed back as its own input. */
						txid: inputs[i].transaction_hash || '',
						vout: toInt(inputs[i].index, 0),
						scriptsig: inputs[i].spending_signature_hex || '',
						sequence: toInt(inputs[i].spending_sequence, 0xffffffff),
						prevout: {
							value: baseUnits(inputs[i].value || 0),
							scriptpubkey_address: inputs[i].recipient || ''
						}
					});
				}
				var vout = [];
				for (var j = 0; j < outputs.length; j++) {
					vout.push({
						n: toInt(outputs[j].index, j),
						value: baseUnits(outputs[j].value),
						scriptpubkey: outputs[j].script_hex || '',
						scriptpubkey_address: outputs[j].recipient || '',
						spent_by: outputs[j].spending_transaction_hash || ''
					});
				}
				var height = toInt(tx.block_id, -1);
				var confirmed = height > 0;
				return {
					txid: tx.hash || txid,
					version: toInt(tx.version, 1),
					locktime: toInt(tx.lock_time, 0),
					size: toInt(tx.size, 0),
					fee: baseUnits(tx.fee || 0),
					vin: vin,
					vout: vout,
					hex: tx.raw_hex || '',
					confirmations: confirmed ? 1 : 0,
					status: { confirmed: confirmed, block_height: confirmed ? height : 0 }
				};
			});
		},
		txHex: function (base, txid) {
			var url = base + '/raw/transaction/' + encodeURIComponent(txid);
			return getJson(url).then(function (data) {
				var hex = data && data.data && data.data[txid] && data.data[txid].raw_transaction;
				if (hex && /^[0-9a-f]+$/i.test(hex)) return hex;
				return deferred().reject('Blockchair returned no raw tx hex for ' + txid).promise();
			});
		},
		outspend: function (base, txid, vout) {
			return blockchairDriver.tx(base, txid).then(function (tx) {
				var out = tx.vout[toInt(vout, 0)];
				if (!out) return { spent: false };
				return out.spent_by ? { spent: true, txid: out.spent_by } : { spent: false };
			});
		},
		tipHeight: function (base) {
			return getJson(base + '/stats').then(function (data) {
				var height = data && data.data && toInt(data.data.blocks, 0);
				if (height <= 0) return deferred().reject('Invalid Blockchair tip height').promise();
				return height;
			});
		},
		broadcast: function (base, txhex) {
			return postRaw(base + '/push/transaction', JSON.stringify({ data: txhex }), 'application/json')
				.then(function (body) {
					var parsed;
					try { parsed = JSON.parse(body); } catch (e) {
						return { success: false, txid: '', error: body || 'Broadcast failed', raw: body };
					}
					var txid = parsed && parsed.data && parsed.data.transaction_hash;
					if (txid) return { success: true, txid: txid, error: '', raw: parsed };
					var message = (parsed && parsed.context && parsed.context.error) || 'Broadcast failed';
					return { success: false, txid: '', error: message, raw: parsed };
				});
		}
	};

	/* ------------------------------------------------------------------
	   Driver: Blockbook (Trezor)

	   Docs: https://github.com/trezor/blockbook/blob/master/docs/api.md
	   Bases: https://bch1.trezor.io  etc.
	   All amounts are string satoshi / base-unit integers. CORS enabled.
	   ------------------------------------------------------------------ */

	var blockbookDriver = {
		name: 'blockbook',
		utxos: function (base, address) {
			return getJson(base + '/api/v2/utxo/' + encodeURIComponent(address) + '?confirmed=false').then(function (list) {
				if (!coinjs.isArray(list)) {
					return deferred().reject('Unexpected Blockbook UTXO response').promise();
				}
				var out = [];
				for (var i = 0; i < list.length; i++) {
					var u = list[i];
					out.push({
						txid: u.txid,
						vout: toInt(u.vout, 0),
						value: baseUnits(u.value),
						scriptpubkey: u.scriptPubKey || '',
						confirmations: toInt(u.confirmations, 0)
					});
				}
				return out;
			});
		},
		balance: function (base, address) {
			return getJson(base + '/api/v2/address/' + encodeURIComponent(address) + '?details=basic').then(function (data) {
				if (!data || typeof data.balance === 'undefined') {
					return deferred().reject('Blockbook: unexpected balance response').promise();
				}
				/* Blockbook returns string satoshi; add confirmed + unconfirmed */
				var confirmed = baseUnits(data.balance || 0);
				var unconfirmed = baseUnits(data.unconfirmedBalance || 0);
				return confirmed + unconfirmed;
			});
		},
		tx: function (base, txid) {
			return getJson(base + '/api/v2/tx/' + encodeURIComponent(txid)).then(function (tx) {
				var vin = [];
				var inputs = tx.vin || [];
				for (var i = 0; i < inputs.length; i++) {
					vin.push({
						txid: inputs[i].txid || '',
						vout: toInt(inputs[i].vout, 0),
						scriptsig: inputs[i].hex || '',
						sequence: toInt(inputs[i].sequence, 0xffffffff),
						prevout: {
							value: baseUnits(inputs[i].value || 0),
							scriptpubkey_address: (inputs[i].addresses && inputs[i].addresses[0]) || ''
						}
					});
				}
				var vout = [];
				var outputs = tx.vout || [];
				for (var j = 0; j < outputs.length; j++) {
					vout.push({
						n: toInt(outputs[j].n, j),
						value: baseUnits(outputs[j].value),
						scriptpubkey: outputs[j].hex || '',
						scriptpubkey_address: (outputs[j].addresses && outputs[j].addresses[0]) || '',
						spent_by: outputs[j].spent === true ? (outputs[j].spentTxId || 'unknown') : ''
					});
				}
				var height = toInt(tx.blockHeight, -1);
				var confirmed = height > 0;
				return {
					txid: tx.txid || txid,
					version: toInt(tx.version, 1),
					locktime: toInt(tx.lockTime, 0),
					size: toInt(tx.size, 0),
					fee: baseUnits(tx.fees || 0),
					vin: vin,
					vout: vout,
					hex: tx.hex || '',
					confirmations: toInt(tx.confirmations, confirmed ? 1 : 0),
					status: { confirmed: confirmed, block_height: confirmed ? height : 0 }
				};
			});
		},
		txHex: function (base, txid) {
			return blockbookDriver.tx(base, txid).then(function (tx) {
				if (tx.hex && /^[0-9a-f]+$/i.test(tx.hex)) return tx.hex;
				return deferred().reject('Blockbook returned no tx hex for ' + txid).promise();
			});
		},
		outspend: function (base, txid, vout) {
			return blockbookDriver.tx(base, txid).then(function (tx) {
				var out = tx.vout[toInt(vout, 0)];
				if (!out) return { spent: false };
				return out.spent_by ? { spent: true, txid: out.spent_by } : { spent: false };
			});
		},
		tipHeight: function (base) {
			return getJson(base + '/api/v2').then(function (data) {
				var height = data && data.blockbook && toInt(data.blockbook.bestHeight, 0);
				if (height <= 0) return deferred().reject('Invalid Blockbook tip height').promise();
				return height;
			});
		},
		broadcast: function (base, txhex) {
			return getText(base + '/api/v2/sendtx/' + encodeURIComponent(txhex)).then(function (body) {
				/* Blockbook returns the txid as plain text on success, or a JSON
				   error object on failure. */
				if (/^[a-fA-F0-9]{64}$/.test(body)) {
					return { success: true, txid: body, error: '', raw: body };
				}
				var message = body || 'Broadcast failed';
				try {
					var parsed = JSON.parse(body);
					if (parsed && parsed.error) message = parsed.error;
				} catch (e) { /* plain-text error */ }
				return { success: false, txid: '', error: message, raw: body };
			});
		}
	};

	/* ------------------------------------------------------------------
	   Driver: Bloodstone wallet API

	   Base: https://bloodstone.rocks/stone-wallet-api
	   Contract probe (2026-08-06) exposes:
	     GET  /api/v1/address/<addr>/balance
	     GET  /api/v1/address/<addr>/utxos
	     GET  /api/v1/tx/<txid>
	     GET  /api/v1/height
	     POST /api/v1/broadcast  JSON {"hex":"..."}

	   The endpoint is wallet-oriented rather than Esplora-native, so the
	   adapter normalizes several plausible field spellings into the wallet's
	   existing Esplora-shaped contract.
	   ------------------------------------------------------------------ */

	function stoneField(source, names, fallback) {
		if (!source) return fallback;
		for (var i = 0; i < names.length; i++) {
			if (typeof source[names[i]] !== 'undefined') return source[names[i]];
		}
		return fallback;
	}

	function stoneStatus(confirmed, blockHeight, confirmations) {
		var normalizedHeight = toInt(blockHeight, 0);
		var normalizedConfirmations = toInt(confirmations, 0);
		var isConfirmed = (typeof confirmed === 'boolean')
			? confirmed
			: (normalizedConfirmations > 0 || normalizedHeight > 0);
		return {
			confirmed: !!isConfirmed,
			block_height: isConfirmed ? normalizedHeight : 0
		};
	}

	function stoneTxToEsplora(tx) {
		var raw = tx && tx.data ? tx.data : tx;
		if (raw && raw.hex && !stoneField(raw, ['vin', 'inputs', 'vout', 'outputs'], null)) {
			return {
				txid: stoneField(raw, ['txid', 'hash'], ''),
				version: toInt(stoneField(raw, ['version'], 1), 1),
				locktime: toInt(stoneField(raw, ['locktime', 'lock_time'], 0), 0),
				size: toInt(stoneField(raw, ['size', 'vsize'], 0), 0),
				fee: baseUnits(stoneField(raw, ['fee', 'fees'], 0)),
				vin: [],
				vout: [],
				hex: stoneField(raw, ['hex', 'rawhex', 'rawHex'], ''),
				confirmations: toInt(stoneField(raw, ['confirmations'], 0), 0),
				status: stoneStatus(
					stoneField(raw, ['confirmed'], undefined),
					stoneField(raw, ['block_height', 'blockHeight', 'height'], 0),
					stoneField(raw, ['confirmations'], 0)
				)
			};
		}
		var vinSource = stoneField(raw, ['vin', 'inputs'], []);
		var voutSource = stoneField(raw, ['vout', 'outputs'], []);
		var vin = [];
		for (var i = 0; i < vinSource.length; i++) {
			var input = vinSource[i] || {};
			var prevout = stoneField(input, ['prevout', 'prevOut'], null) || {};
			vin.push({
				txid: stoneField(input, ['txid', 'prev_txid', 'prevTxid', 'transaction_hash'], ''),
				vout: toInt(stoneField(input, ['vout', 'prev_vout', 'prevVout', 'index'], 0), 0),
				scriptsig: stoneField(input, ['scriptsig', 'scriptSig', 'script'], ''),
				sequence: toInt(stoneField(input, ['sequence'], 0xffffffff), 0xffffffff),
				prevout: {
					value: baseUnits(stoneField(prevout, ['value', 'amount', 'satoshis'], stoneField(input, ['value', 'amount', 'satoshis'], 0))),
					scriptpubkey_address: stoneField(prevout, ['scriptpubkey_address', 'address'], stoneField(input, ['address'], ''))
				}
			});
		}
		var vout = [];
		for (var j = 0; j < voutSource.length; j++) {
			var output = voutSource[j] || {};
			vout.push({
				n: toInt(stoneField(output, ['n', 'vout', 'index'], j), j),
				value: baseUnits(stoneField(output, ['value', 'amount', 'satoshis'], 0)),
				scriptpubkey: stoneField(output, ['scriptpubkey', 'scriptPubKey', 'script'], ''),
				scriptpubkey_address: stoneField(output, ['scriptpubkey_address', 'address'], ''),
				spent_by: stoneField(output, ['spent_by', 'spentBy', 'spent_txid', 'spentTxId'], '')
			});
		}
		var confirmations = toInt(stoneField(raw, ['confirmations'], 0), 0);
		var blockHeight = stoneField(raw, ['block_height', 'blockHeight', 'height'], 0);
		var status = stoneStatus(stoneField(raw, ['confirmed'], undefined), blockHeight, confirmations);
		return {
			txid: stoneField(raw, ['txid', 'hash'], ''),
			version: toInt(stoneField(raw, ['version'], 1), 1),
			locktime: toInt(stoneField(raw, ['locktime', 'lock_time'], 0), 0),
			size: toInt(stoneField(raw, ['size', 'vsize'], 0), 0),
			fee: baseUnits(stoneField(raw, ['fee', 'fees'], 0)),
			vin: vin,
			vout: vout,
			hex: stoneField(raw, ['hex', 'rawhex', 'rawHex'], ''),
			confirmations: confirmations || (status.confirmed ? 1 : 0),
			status: status
		};
	}

	var stoneapiDriver = {
		name: 'stoneapi',
		utxos: function (base, address) {
			return getJson(base + '/api/v1/address/' + encodeURIComponent(address) + '/utxos').then(function (data) {
				var list = data && data.data ? data.data : (data && data.utxos ? data.utxos : data);
				if (!coinjs.isArray(list)) {
					return deferred().reject('Unexpected STONE UTXO response').promise();
				}
				var out = [];
				for (var i = 0; i < list.length; i++) {
					var u = list[i] || {};
					out.push({
						txid: stoneField(u, ['txid', 'transaction_hash', 'hash'], ''),
						vout: toInt(stoneField(u, ['vout', 'index', 'n'], 0), 0),
						value: baseUnits(stoneField(u, ['value_sats', 'value', 'amount', 'satoshis'], 0)),
						scriptpubkey: stoneField(u, ['script_pubkey', 'scriptpubkey', 'scriptPubKey', 'script'], ''),
						confirmations: toInt(stoneField(u, ['confirmations'], stoneField(u, ['height'], 0) ? 1 : 0), 0)
					});
				}
				return out;
			});
		},
		balance: function (base, address) {
			return getJson(base + '/api/v1/address/' + encodeURIComponent(address) + '/balance').then(function (data) {
				var payload = data && data.data ? data.data : data;
				var direct = stoneField(payload, ['balance', 'confirmed', 'confirmed_balance', 'confirmedBalance', 'confirmed_sats', 'final_balance', 'satoshis'], undefined);
				if (typeof direct !== 'undefined') return baseUnits(direct);
				var total = stoneField(payload, ['total_sats'], undefined);
				if (typeof total !== 'undefined') return baseUnits(total);
				var confirmed = baseUnits(stoneField(payload, ['funded', 'funded_txo_sum'], 0)) - baseUnits(stoneField(payload, ['spent', 'spent_txo_sum'], 0));
				var mempool = baseUnits(stoneField(payload, ['unconfirmed_sats', 'mempool_funded', 'mempool_funded_txo_sum'], 0)) - baseUnits(stoneField(payload, ['mempool_spent', 'mempool_spent_txo_sum'], 0));
				return confirmed + mempool;
			});
		},
		tx: function (base, txid) {
			return getJson(base + '/api/v1/tx/' + encodeURIComponent(txid)).then(stoneTxToEsplora);
		},
		txHex: function (base, txid) {
			return stoneapiDriver.tx(base, txid).then(function (tx) {
				if (tx.hex && /^[0-9a-f]+$/i.test(tx.hex)) return tx.hex;
				return deferred().reject('STONE API returned no tx hex for ' + txid).promise();
			});
		},
		outspend: function (base, txid, vout) {
			return stoneapiDriver.tx(base, txid).then(function (tx) {
				var out = tx.vout[toInt(vout, 0)];
				if (!out) return { spent: false };
				if (out.spent_by) return { spent: true, txid: out.spent_by };
				return { spent: !!out.spent };
			});
		},
		tipHeight: function (base) {
			return getJson(base + '/api/v1/height').then(function (data) {
				var payload = data && data.data ? data.data : data;
				var height = toInt(stoneField(payload, ['height'], 0), 0);
				if (height <= 0) return deferred().reject('Invalid STONE tip height').promise();
				return height;
			});
		},
		broadcast: function (base, txhex) {
			return postRaw(base + '/api/v1/broadcast', JSON.stringify({ hex: txhex }), 'application/json').then(function (body) {
				var parsed;
				try { parsed = JSON.parse(body); } catch (e) {
					return { success: false, txid: '', error: body || 'Broadcast failed', raw: body };
				}
				var txid = (parsed && (parsed.txid || parsed.hash || (parsed.data && (parsed.data.txid || parsed.data.hash)))) || '';
				if ((parsed && parsed.ok !== false) && /^[a-fA-F0-9]{64}$/.test(txid)) {
					return { success: true, txid: txid, error: '', raw: parsed };
				}
				var message = (parsed && (parsed.error || parsed.message || (parsed.data && parsed.data.error))) || 'Broadcast failed';
				if (typeof message !== 'string') message = JSON.stringify(message);
				return { success: false, txid: '', error: message, raw: parsed };
			});
		}
	};

	explorer.drivers = {
		esplora: esploraDriver,
		blockcypher: blockcypherDriver,
		blockchair: blockchairDriver,
		blockbook: blockbookDriver,
		stoneapi: stoneapiDriver
	};

	/* ------------------------------------------------------------------
	   Dispatch
	   ------------------------------------------------------------------ */

	explorer.isSupported = function (network) {
		return !!(network && explorer.drivers[network.apiType]);
	};

	/* Normalize user-configurable API bases so the driver sees one canonical
	   root. STONE historically accepted the wallet host root in Settings, while
	   some saved/manual values include the `/api/v1` prefix that the driver adds
	   itself. Without normalization that duplicated segment produces 404s. */
	function normalizedApiBase(driver, base) {
		var trimmedBase = String(base || '').replace(/\/+$/, '');
		if (driver && driver.name === 'stoneapi') {
			return trimmedBase.replace(/\/api\/v1$/i, '');
		}
		return trimmedBase;
	}

	function dispatch(network, method, args) {
		var driver = network && explorer.drivers[network.apiType];
		var base = normalizedApiBase(driver, (network && network.apiBase) || '');
		if (!driver || typeof driver[method] !== 'function' || !base) {
			return deferred().reject(
				'No usable explorer backend for ' + ((network && network.code) || '?') +
				' (apiType ' + ((network && network.apiType) || 'unset') + ')'
			).promise();
		}
		try {
			return jQuery.when(driver[method].apply(driver, [base].concat(args)));
		} catch (e) {
			return deferred().reject((e && e.message) || String(e)).promise();
		}
	}

	explorer.utxos = function (network, address) { return dispatch(network, 'utxos', [address]); };
	explorer.balance = function (network, address) { return dispatch(network, 'balance', [address]); };
	explorer.tx = function (network, txid) { return dispatch(network, 'tx', [txid]); };
	explorer.txHex = function (network, txid) { return dispatch(network, 'txHex', [txid]); };
	explorer.outspend = function (network, txid, vout) { return dispatch(network, 'outspend', [txid, vout]); };
	explorer.tipHeight = function (network) { return dispatch(network, 'tipHeight', []); };
	explorer.broadcast = function (network, txhex) { return dispatch(network, 'broadcast', [txhex]); };
})();
