/*
	SPDX-License-Identifier: Apache-2.0
	Copyright 2026 SpaceXpanse
	Fork-specific OTC swap engine for the SpaceXpanse ROD wallet.

	otc-engine.js — Phase 2 swap engine.
	Namespace: window.rodOtc.engine
*/
(function () {
	'use strict';
	var root = window.rodOtc = window.rodOtc || {};
	var engine = root.engine = {};
	var SWAP = root.swap;
	var STORAGE = root.storage;
	var CHAINS = root.chains;
	var NOSTR = root.nostr;

	function desktopRpcProxyDefaults() {
		try {
			var desktop = window.rodDesktop || {};
			var proxy = desktop.rpcProxy || {};
			if (proxy.available !== true || !proxy.url) {
				return { rpcUrl: '', rpcPort: '18080', rpcWallet: '' };
			}
			var match = String(proxy.url).match(/:(\d+)(?:\/)?$/);
			return {
				rpcUrl: String(proxy.url).replace(/\/+$/, ''),
				rpcPort: match ? match[1] : '18080',
				rpcWallet: 'ROD'
			};
		} catch (e) {
			return { rpcUrl: '', rpcPort: '18080', rpcWallet: '' };
		}
	}

	/* ============ Config ============ */
	var CFG_KEY = 'spexSwapV2Config';
	var desktopRpcDefaults = desktopRpcProxyDefaults();
	var defaults = {
		rpcUrl: desktopRpcDefaults.rpcUrl, rpcPort: desktopRpcDefaults.rpcPort, rpcUser: '', rpcPass: '', rpcWallet: desktopRpcDefaults.rpcWallet,
		relays: ['wss://relay.damus.io','wss://nos.lol','wss://relay.nostr.band'],
		releaseBlocks: 30,
		chains: {},
		/* Automation re-drive interval (ms); tests may lower this */
		tickMs: 30000
	};
	CHAINS.codes().forEach(function (code) {
		var definition = CHAINS.getDefinition(code);
		defaults.chains[code] = {
			apiUrl: definition.apiUrl,
			apiType: definition.apiType,
			refundBlocks: {
				asset: CHAINS.getRefundBlocks(code, 'asset'),
				payment: CHAINS.getRefundBlocks(code, 'payment')
			},
			confirmations: definition.confirmations
		};
	});
	engine.defaults = defaults;

	function mergeChains(saved) {
		var merged = {};
		var protectedApiTypeByCode = {
			'ROD': true,
			'STONE': true
		};
		function trimApiUrl(url) {
			return $.trim(url || '').replace(/\/+$/g, '');
		}
		function apiUrlForComparison(url, apiType) {
			var trimmedUrl = trimApiUrl(url);
			if (String(apiType || '') === 'rod') {
				trimmedUrl = trimmedUrl.replace(/\/api$/i, '');
			}
			if (String(apiType || '') === 'stoneapi') {
				trimmedUrl = trimmedUrl.replace(/\/api\/v1$/i, '');
			}
			return trimmedUrl;
		}
		function conflictsWithCanonicalApi(code, apiUrl, apiType) {
			var candidate = apiUrlForComparison(apiUrl, apiType);
			if (!candidate) return false;
			for (var otherCode in defaults.chains) {
				if (!defaults.chains.hasOwnProperty(otherCode) || otherCode === code) continue;
				var otherCanonical = defaults.chains[otherCode];
				if (!otherCanonical || !otherCanonical.apiUrl) continue;
				if (candidate === apiUrlForComparison(otherCanonical.apiUrl, otherCanonical.apiType) &&
					String(otherCanonical.apiType || '') !== String(apiType || '')) {
					return true;
				}
			}
			return false;
		}
		for (var code in defaults.chains) {
			if (defaults.chains.hasOwnProperty(code)) {
				merged[code] = $.extend({}, defaults.chains[code]);
			}
		}
		if (saved && typeof saved === 'object') {
			for (var savedCode in saved) {
				if (saved.hasOwnProperty(savedCode) && defaults.chains[savedCode] &&
					saved[savedCode] && typeof saved[savedCode] === 'object') {
					var savedApiType = saved[savedCode].apiType;
					merged[savedCode] = $.extend(merged[savedCode], saved[savedCode]);
					if (protectedApiTypeByCode[savedCode]) {
						merged[savedCode].apiType = defaults.chains[savedCode].apiType;
						merged[savedCode].apiUrl = trimApiUrl(merged[savedCode].apiUrl);
						if (savedApiType !== defaults.chains[savedCode].apiType ||
							!merged[savedCode].apiUrl ||
							apiUrlForComparison(merged[savedCode].apiUrl, merged[savedCode].apiType) === apiUrlForComparison(defaults.chains[savedCode].apiUrl, defaults.chains[savedCode].apiType) ||
							conflictsWithCanonicalApi(savedCode, merged[savedCode].apiUrl, savedApiType)) {
							merged[savedCode].apiUrl = defaults.chains[savedCode].apiUrl;
						}
					}
				}
			}
		}
		return merged;
	}

	/* Every settlement chain uses the same profile shape. */
	engine.chainConfig = function (cc, cfg) {
		var c = cfg || engine.loadConfig();
		var code = String(cc || SWAP.DEFAULT_PAYMENT_CHAIN).toUpperCase();
		var resolved = $.extend({}, (c.chains && c.chains[code]) || defaults.chains[code] || {});
		return resolved;
	};
	/* Shallow merge + explicit array replace.
	   jQuery deep extend merges arrays by index, so saving 2 relays left the 3rd default stuck. */
	engine.loadConfig = function () {
		var cfg = $.extend({}, defaults);
		cfg.relays = defaults.relays.slice();
		try {
			var raw = localStorage.getItem(CFG_KEY);
			if (!raw) return cfg;
			var saved = JSON.parse(raw);
			if (!saved || typeof saved !== 'object') return cfg;
			$.extend(cfg, saved);
			if (Object.prototype.hasOwnProperty.call(saved, 'relays')) {
				cfg.relays = $.isArray(saved.relays) ? saved.relays.slice() : defaults.relays.slice();
			} else {
				cfg.relays = defaults.relays.slice();
			}
			/* $.extend is shallow, so a saved chains map containing only the
			   chain the user edited would otherwise delete every other chain's
			   settings. Merge per chain instead. */
			cfg.chains = mergeChains(saved.chains);
			return cfg;
		} catch (e) {
			cfg = $.extend({}, defaults);
			cfg.relays = defaults.relays.slice();
			return cfg;
		}
	};
	engine.saveConfig = function (c) {
		var toSave = $.extend({}, c || {});
		if ($.isArray(toSave.relays)) {
			toSave.relays = toSave.relays.slice();
		}
		localStorage.setItem(CFG_KEY, JSON.stringify(toSave));
		engine.applyApiConfig(toSave);
	};
	/* Propagate configured API base URLs into the coinjs network profiles.
	   Without this, the OTC Settings per-chain API fields were saved but every
	   actual chain call (listUnspent/broadcast/getTransaction/addressBalance)
	   kept using the compile-time defaults in coinjs.networks. */
	engine.applyApiConfig = function (cfg) {
		var c = cfg || engine.loadConfig();
		try {
			var rodProfile = engine.chainConfig('ROD', c);
			var rod = $.trim(rodProfile.apiUrl || '');
			if (rod) {
				rod = rod.replace(/\/+$/, '');
				coinjs.networks.ROD.apiBase = rod;
				coinjs.rodApi = rod;
			}
			for (var code in coinjs.networks) {
				if (!coinjs.networks.hasOwnProperty(code)) continue;
				var chainCfg = engine.chainConfig(code, c);
				var base = $.trim(chainCfg.apiUrl || '');
				if (base) {
					coinjs.networks[code].apiBase = base.replace(/\/+$/, '');
				}
				if (chainCfg.apiType && coinjs.explorer && coinjs.explorer.drivers[chainCfg.apiType]) {
					coinjs.networks[code].apiType = chainCfg.apiType;
				}
			}
		} catch (e) {}
		return c;
	};

	/* ============ Wallet bridge ============ */
	engine.getWalletIdentity = function () {
		var wif = $('#walletKeys .privkey').val() || '';
		if (!wif) return null;
		try {
			/* ROD is the identity/control plane even when the wallet tab is
			   currently showing LTC, DOGE, or another settlement network. The
			   visible address therefore cannot be used as the trader identity.
			   Re-derive the same private key under ROD here and keep the visible
			   address only as diagnostic context. */
			var rodMaterial = CHAINS.getWalletMaterialForChain(wif, 'ROD');
			if (!rodMaterial || !rodMaterial.pubkey || !rodMaterial.address) return null;
			return {
				wif: wif,
				pubkey: rodMaterial.pubkey,
				address: rodMaterial.address,
				rodAddress: rodMaterial.address,
				activeAddress: ($('#walletAddress').text() || '').replace(/\s+/g, ''),
				activeChain: coinjs.activeNetwork || 'ROD'
			};
		} catch (identityError) {
			return null;
		}
	};
	engine.walletPassword = function () {
		var w = engine.getWalletIdentity();
		return w ? w.wif : '';
	};
	/* Returns master HD account {privkey:xprv, pubkey:xpub} from coinjs.hd().make() */
	engine.deriveSwapAccount = function (wif) {
		if (!wif) throw new Error('Wallet WIF is required to derive swap account');
		var decoded = coinjs.wif2privkey(wif);
		if (!decoded || !decoded.privkey) throw new Error('Invalid wallet WIF');
		/* Pin derivation to ROD HD version bytes: the async balance checks
		   temporarily switch the global network, and an unpinned derive that
		   lands in that window emits an Ltub-prefixed xpub that later fails
		   string comparison against a ROD-prefixed one for the same key. */
		var master = CHAINS.withChain('ROD', function () {
			return coinjs.hd().master('rod-otc-swap|' + decoded.privkey);
		});
		if (!master || !master.privkey || !master.pubkey) {
			throw new Error('HD master derivation failed');
		}
		return master;
	};

	/* Chain-agnostic BIP32 key identity: strips the 4 network version bytes
	   and compares depth/fingerprint/index/chaincode/key material only, so a
	   ROD-encoded and an LTC-encoded xpub of the SAME key compare equal. */
	engine.xpubKeyMaterial = function (extendedKey) {
		try {
			var decoded = coinjs.base58decode(extendedKey);
			if (!decoded || decoded.length !== 82) return '';
			return Crypto.util.bytesToHex(decoded.slice(4, 78));
		} catch (e) { return ''; }
	};
	engine.sameExtendedKey = function (a, b) {
		if (!a || !b) return false;
		if (a === b) return true;
		var ma = engine.xpubKeyMaterial(a), mb = engine.xpubKeyMaterial(b);
		return !!ma && ma === mb;
	};

	/* ============ API access ============ */
	engine.rodGet = function (path) {
		return $.getJSON(engine.chainConfig('ROD').apiUrl + path);
	};
	engine.getRodHeight = function () {
		return engine.rodGet('/info').then(function (r) {
			var d = r.result || r;
			return d.blocks || d.height || (d.info && d.info.blocks) || 0;
		});
	};
	/* Chain tip for any non-ROD settlement chain, via its explorer backend
	   is configured to use. */
	function getExplorerHeight(cc) {
		var chainCode = cc;
		var network = coinjs.networks[chainCode];
		if (!network) return $.Deferred().reject('Unknown chain ' + chainCode).promise();
		if (!coinjs.explorer || !coinjs.explorer.isSupported(network)) {
			return $.Deferred().reject('No explorer backend for ' + chainCode).promise();
		}
		return coinjs.explorer.tipHeight(network);
	}
	engine.getChainHeight = function (cc) {
		var code = SWAP.normalizeChain(cc);
		return code === 'ROD' ? engine.getRodHeight() : getExplorerHeight(code);
	};
	/**
	 * Resolve stored RPC settings to a display endpoint (no network I/O).
	 * This static wallet cannot call raw ROD Core from the browser (no CORS);
	 * settings are retained for optional same-origin / helper workflows only.
	 */
	engine.buildRpcEndpoint = function (cfg) {
		var c = cfg || engine.loadConfig();
		var raw = $.trim(c.rpcUrl || '');
		if (!raw) return null;

		var user = $.trim(c.rpcUser || '');
		var pass = c.rpcPass || '';
		var port = $.trim(c.rpcPort || '') || '11999';
		var wallet = $.trim(c.rpcWallet || '');
		var endpoint = raw;
		var pathFromUrl = '';

		// Full URL: scheme://[user:pass@]host[:port][/path]
		if (/^https?:\/\//i.test(raw)) {
			var m = raw.match(/^(https?):\/\/(?:([^:@\/]+)(?::([^@\/]*))?@)?([^:\/]+)(?::(\d+))?(\/.*)?$/i);
			if (!m) return null;
			var scheme = m[1];
			if (m[2] && !user) {
				user = decodeURIComponent(m[2]);
				pass = m[3] != null ? decodeURIComponent(m[3]) : pass;
			}
			var host = m[4];
			var urlPort = m[5] || port;
			pathFromUrl = m[6] || '';
			endpoint = scheme + '://' + host + ':' + urlPort;
		} else {
			raw = raw.replace(/\/+$/, '');
			if (raw.indexOf(':') !== -1 && raw.split(':').length === 2 && /^\d+$/.test(raw.split(':')[1])) {
				endpoint = 'http://' + raw.replace(/^\/\//, '');
			} else {
				endpoint = 'http://' + raw.replace(/^\/\//, '') + ':' + port;
			}
		}

		// Multiwallet path: bare /NAME → /wallet/NAME
		if (pathFromUrl && pathFromUrl !== '/') {
			var cleanPath = pathFromUrl.replace(/\/+$/, '');
			if (/^\/[^\/]+$/.test(cleanPath) && cleanPath.indexOf('/wallet') !== 0) {
				cleanPath = '/wallet' + cleanPath;
			}
			endpoint += cleanPath;
		} else if (wallet) {
			if (wallet.indexOf('/wallet/') === 0) endpoint += wallet;
			else if (wallet.indexOf('wallet/') === 0) endpoint += '/' + wallet;
			else if (wallet.indexOf('/') === 0) endpoint += '/wallet' + wallet;
			else endpoint += '/wallet/' + encodeURIComponent(wallet);
		}

		return {
			url: endpoint,
			user: user,
			pass: pass,
			authHeader: user ? ('Basic ' + btoa(user + ':' + pass)) : ''
		};
	};

	/* JSON-RPC call (use tools/rod-rpc-cors-proxy.exe in front of raw Core). */
	engine.rpc = function (method, params) {
		var ep = engine.buildRpcEndpoint();
		if (!ep) return $.Deferred().reject('RPC not configured').promise();
		var headers = { 'Content-Type': 'application/json' };
		if (ep.authHeader) headers.Authorization = ep.authHeader;
		return $.ajax({
			url: ep.url,
			method: 'POST',
			contentType: 'application/json',
			headers: headers,
			data: JSON.stringify({ jsonrpc: '1.0', id: 'otc', method: method, params: params || [] }),
			timeout: 8000
		}).then(function (r) {
			if (r && r.error) {
				return $.Deferred().reject(r.error.message || JSON.stringify(r.error)).promise();
			}
			return r ? r.result : null;
		});
	};

	/* Live probe when a CORS-capable endpoint (e.g. tools proxy) is configured. */
	engine.checkRpcStatus = function () {
		var c = engine.loadConfig();
		var d = $.Deferred();
		if (!$.trim(c.rpcUrl || '')) {
			d.resolve({ configured: false, online: false, message: 'Not configured' });
			return d.promise();
		}
		var ep = engine.buildRpcEndpoint(c);
		if (!ep) {
			d.resolve({ configured: false, online: false, message: 'Invalid URL' });
			return d.promise();
		}
		engine.rpc('getblockcount', []).then(function (height) {
			d.resolve({ configured: true, online: true, message: 'Connected', height: height, url: ep.url });
		}, function (err, textStatus) {
			var msg = 'Unreachable';
			if (typeof err === 'string') msg = err;
			else if (err && err.responseJSON && err.responseJSON.error) {
				msg = err.responseJSON.error.message || JSON.stringify(err.responseJSON.error);
			} else if (err && err.status === 401) msg = 'Auth failed (401)';
			else if (err && err.status > 0) msg = 'HTTP ' + err.status;
			else if (textStatus === 'timeout') msg = 'Timeout';
			else msg = 'Unreachable (start tools/rod-rpc-cors-proxy.exe?)';
			d.resolve({ configured: true, online: false, message: msg, url: ep.url });
		});
		return d.promise();
	};

	/* Extract order object from name_show result or raw value. */
	engine.extractNameValue = function (r) {
		if (r == null) return null;
		if (typeof r === 'string') {
			try { return JSON.parse(r); } catch (e) { return r; }
		}
		/* Full name_show record: prefer .value */
		if (r && typeof r === 'object' && r.value != null) {
			if (typeof r.value === 'string') {
				try { return JSON.parse(r.value); } catch (e2) { return { _rawValue: r.value }; }
			}
			if (typeof r.value === 'object') return r.value;
		}
		return r;
	};

	/* Name lookup: Core via proxy when RPC is configured, else name helper adapter. */
	engine.nameLookup = function (name) {
		var c = engine.loadConfig();
		if ($.trim(c.rpcUrl || '')) {
			return engine.rpc('name_show', [name]).then(function (r) {
				return engine.extractNameValue(r);
			});
		}
		var d = $.Deferred();
		SWAP.nameAdapter.lookup(name, function (resp) {
			if (resp.success && resp.data) {
				try {
					d.resolve(engine.extractNameValue(resp.data));
				} catch (e) { d.reject(e); }
			} else {
				d.reject(resp.error || (resp.unavailable ? 'Name helper not configured' : 'lookup failed'));
			}
		});
		return d.promise();
	};

	/**
	 * Publish a value to the ROD name DB (name_update if exists, else name_register).
	 * Requires ROD Core RPC (via tools/rod-rpc-cors-proxy.exe).
	 * Resolves { name, value, txid, action: 'update'|'register' }.
	 */
	engine.namePublish = function (name, valueObject) {
		var d = $.Deferred();
		var nameKey = $.trim(name || '');
		if (!nameKey) {
			d.reject('ROD name is required');
			return d.promise();
		}
		var c = engine.loadConfig();
		if (!$.trim(c.rpcUrl || '')) {
			d.reject('ROD Core RPC is not configured — set it in OTC Settings and run the CORS proxy');
			return d.promise();
		}
		var valueStr;
		try {
			if (typeof valueObject === 'string') {
				valueStr = valueObject;
			} else {
				/* Compact JSON for name value size limits */
				valueStr = JSON.stringify(valueObject);
			}
		} catch (e) {
			d.reject('Invalid order value');
			return d.promise();
		}
		if (valueStr.length > 1023) {
			d.reject('Order JSON is ' + valueStr.length + ' bytes (limit ~1023 for name value)');
			return d.promise();
		}

		function doUpdate() {
			return engine.rpc('name_update', [nameKey, valueStr]).then(function (txid) {
				return { name: nameKey, value: valueStr, txid: txid, action: 'update' };
			});
		}
		function doRegister() {
			return engine.rpc('name_register', [nameKey, valueStr]).then(function (txid) {
				return { name: nameKey, value: valueStr, txid: txid, action: 'register' };
			});
		}

		/* Prefer update when name already exists; otherwise register */
		engine.rpc('name_show', [nameKey]).then(function () {
			doUpdate().then(function (r) { d.resolve(r); }, function (err) { d.reject(err); });
		}, function () {
			doRegister().then(function (r) { d.resolve(r); }, function (err) {
				/* Race: name appeared between show and register — try update once */
				doUpdate().then(function (r) { d.resolve(r); }, function (err2) {
					d.reject(err2 || err || 'name_register/name_update failed');
				});
			});
		});
		return d.promise();
	};

	/* Validate/normalize an on-chain OTC order value. Returns {ok, offer?, reason?} */
	engine.normalizeOffer = function (name, value) {
		if (value == null) {
			return { ok: false, reason: 'empty name value' };
		}
		if (typeof value === 'string') {
			return { ok: false, reason: 'name value is not JSON (got a string)' };
		}
		if (value._rawValue) {
			return { ok: false, reason: 'name value is not valid JSON' };
		}
		var typeOk = value.version === SWAP.PROTOCOL_VERSION && value.type === 'otc-order';
		if (!typeOk) {
			return { ok: false, reason: 'not an otc-order (type=' + (value.type || value.t || 'missing') + ')' };
		}
		var pair = value.pair || '';
		var pairParts = String(pair).split('/');
		var pairAssetChain = pairParts.length === 2 ? pairParts[0] : '';
		var pairPaymentChain = pairParts.length === 2 ? pairParts[1] : '';
		if (!pairAssetChain || !pairPaymentChain || pairAssetChain === pairPaymentChain ||
			!CHAINS.definitions[pairAssetChain] || !CHAINS.definitions[pairPaymentChain] ||
			value.assetChain !== pairAssetChain || value.paymentChain !== pairPaymentChain) {
			return { ok: false, reason: 'unsupported pair ' + pair };
		}
		var give = value.give != null ? value.give : value.assetAmount;
		var want = value.want != null ? value.want : value.paymentAmount;
		if (!(parseFloat(give) > 0) || !(parseFloat(want) > 0)) {
			return {
				ok: false,
				reason: 'incomplete order — need give/want (or assetAmount/paymentAmount). On-chain value only has: ' +
					Object.keys(value).join(', ')
			};
		}
		var offer = $.extend({}, value);
		offer.pair = pair;
		offer.assetChain = pairAssetChain;
		offer.paymentChain = pairPaymentChain;
		offer.type = value.type || 'otc-order';
		offer.give = give;
		offer.want = want;
		offer._name = name;
		/* side: explicit, else sell/ask by default; buy → bid */
		if (!offer.side) {
			if (offer.buyerSwapXpub && !offer.sellerSwapXpub) offer.side = 'buy';
			else offer.side = 'sell';
		}
		return { ok: true, offer: offer };
	};

	/* ============ Nostr relay pool ============ */
	engine.DEFAULT_RELAYS = defaults.relays;
	function Pool(urls) {
		this.urls = urls || defaults.relays.slice();
		this.ws = {};
		this.h = {};
		this.outbox = [];
		this.n = 0;
		this.onStatus = null;
		this.onNotice = null;
		this.closed = false;
	}
	Pool.prototype.connect = function () { var s = this; this.urls.forEach(function (u) { s._open(u); }); };
	Pool.prototype._queue = function (eventObject) {
		if (!eventObject || !eventObject.id) return;
		for (var i = 0; i < this.outbox.length; i++) {
			if (this.outbox[i].id === eventObject.id) return;
		}
		this.outbox.push(eventObject);
		if (this.outbox.length > 100) this.outbox = this.outbox.slice(-100);
	};
	Pool.prototype._flush = function (u) {
		var w = this.ws[u];
		if (!w || w.readyState !== 1 || !this.outbox.length) return 0;
		var sent = 0;
		for (var i = 0; i < this.outbox.length; i++) {
			try { w.send(JSON.stringify(['EVENT', this.outbox[i]])); sent++; } catch (e) {}
		}
		return sent;
	};
	Pool.prototype._open = function (u) {
		var s = this;
		if (s.closed) return;
		if (s.ws[u] && s.ws[u].readyState <= 1) return;
		try {
			var w = new WebSocket(u);
			w.onopen = function () {
				if (s.closed) { try { w.close(); } catch (e0) {} return; }
				if (s.onStatus) s.onStatus('+', u);
				var now = Math.floor(Date.now() / 1000);
				for (var id in s.h) {
					var h = s.h[id];
					if (!h.f) continue;
					/* Refresh the since timestamp so reconnect replays only the
					   intended lookback window, not the full history from when
					   the subscription was originally created. */
					if (h.lookback > 0) {
						h.f = $.extend({}, h.f, { since: Math.max(0, now - h.lookback) });
					}
					w.send(JSON.stringify(['REQ', id, h.f]));
				}
				var flushed = s._flush(u);
				if (flushed && s.onNotice) s.onNotice(['LOCAL_FLUSH', flushed], u);
			};
			w.onmessage = function (m) {
				try {
					var d = JSON.parse(m.data);
					if (d[0] === 'EVENT' && s.h[d[1]]) s.h[d[1]].cb(d[2], u);
					else if ((d[0] === 'OK' || d[0] === 'NOTICE' || d[0] === 'AUTH') && s.onNotice) s.onNotice(d, u);
				} catch (e) {}
			};
			w.onclose = function () {
				delete s.ws[u];
				if (s.onStatus) s.onStatus('-', u);
				/* Reconnect only while pool is still active */
				if (!s.closed) setTimeout(function () { s._open(u); }, 8000);
			};
			w.onerror = function () {};
			s.ws[u] = w;
		} catch (e) {}
	};
	Pool.prototype.close = function () {
		this.closed = true;
		for (var u in this.ws) {
			try {
				this.ws[u].onclose = null;
				this.ws[u].onmessage = null;
				this.ws[u].onerror = null;
				this.ws[u].close();
			} catch (e) {}
		}
		this.ws = {};
		this.h = {};
	};
	Pool.prototype.pub = function (ev) {
		this._queue(ev);
		var f = JSON.stringify(['EVENT', ev]), n = 0;
		for (var u in this.ws) if (this.ws[u].readyState === 1) { this.ws[u].send(f); n++; }
		return n;
	};
	Pool.prototype.sub = function (filt, cb, lookbackSeconds) {
		var id = 'o' + (++this.n) + '-' + Date.now();
		this.h[id] = { cb: cb, f: filt, lookback: lookbackSeconds || 0 };
		var fr = JSON.stringify(['REQ', id, filt]); for (var u in this.ws) if (this.ws[u].readyState === 1) this.ws[u].send(fr);
		return id;
	};
	Pool.prototype.unsub = function (id) { delete this.h[id]; var f = JSON.stringify(['CLOSE', id]); for (var u in this.ws) if (this.ws[u].readyState === 1) this.ws[u].send(f); };
	Pool.prototype.count = function () { var c = 0; for (var u in this.ws) if (this.ws[u].readyState === 1) c++; return c; };
	Pool.prototype.total = function () { return (this.urls || []).length; };

	engine.pool = null;
	engine._wantListening = false;
	engine._listenHandler = null;
	engine.onRelayEventDebug = null;
	engine.onRelaySubscription = null;
	function debugRelay(message) {
		if (engine.onRelayEventDebug) engine.onRelayEventDebug(message);
	}
	function otcKinds() {
		return [(NOSTR && NOSTR.OTC_EVENT_KIND) || 7341];
	}

	engine.stopRelays = function () {
		if (engine.pool) {
			engine.pool.close();
			engine.pool = null;
		}
		engine._trackedSwapSubscriptions = {};
	};

	engine.startRelays = function (urls) {
		if (engine.pool && !engine.pool.closed) return engine.pool;
		var list = urls || engine.loadConfig().relays || engine.DEFAULT_RELAYS;
		if (!list || !list.length) list = engine.DEFAULT_RELAYS.slice();
		engine.pool = new Pool(list);
		engine._trackedSwapSubscriptions = engine._trackedSwapSubscriptions || {};
		engine.pool.connect();
		return engine.pool;
	};

	/* Close existing sockets and connect to a new relay list (used after Settings save). */
	engine.restartRelays = function (urls) {
		var prevStatus = engine.pool ? engine.pool.onStatus : null;
		engine.stopRelays();
		var pool = engine.startRelays(urls);
		if (prevStatus) pool.onStatus = prevStatus;
		if (engine._wantListening) {
			engine.startListening(true);
		}
		return pool;
	};

	/* ============ Nostr auto-negotiation ============ */
	var SEEN_EVENT_IDS_KEY = 'spexSwapV2SeenEventIds';
	var SEEN_EVENT_IDS_LIMIT = 800;
	var GLOBAL_SUB_LOOKBACK_SECONDS = 30;
	var TRACKED_SWAP_SUB_LOOKBACK_SECONDS = 900;
	var TRACKED_SWAP_EVENT_LIMIT = 80;
	var seen = loadSeenEventIds();
	function loadSeenEventIds() {
		try {
			var parsed = JSON.parse(localStorage.getItem(SEEN_EVENT_IDS_KEY) || '[]');
			var seenEventIds = {};
			if (!$.isArray(parsed)) return seenEventIds;
			for (var index = 0; index < parsed.length; index++) {
				if (typeof parsed[index] === 'string' && parsed[index]) seenEventIds[parsed[index]] = true;
			}
			return seenEventIds;
		} catch (error) {
			return {};
		}
	}
	function persistSeenEventId(eventId) {
		if (!eventId || seen[eventId]) return;
		seen[eventId] = true;
		try {
			var eventIds = Object.keys(seen);
			if (eventIds.length > SEEN_EVENT_IDS_LIMIT) {
				eventIds = eventIds.slice(eventIds.length - SEEN_EVENT_IDS_LIMIT);
				seen = {};
				for (var index = 0; index < eventIds.length; index++) {
					seen[eventIds[index]] = true;
				}
			}
			localStorage.setItem(SEEN_EVENT_IDS_KEY, JSON.stringify(Object.keys(seen)));
		} catch (error) {}
	}
	/* A valid incoming swap_terms event may need fresh chain tips before the UI
	   can accept it. If that read fails transiently, let the same relay event be
	   delivered again instead of permanently recording it as consumed. */
	engine.forgetSeenEventId = function (eventId) {
		if (!eventId || !seen[eventId]) return;
		delete seen[eventId];
		try { localStorage.setItem(SEEN_EVENT_IDS_KEY, JSON.stringify(Object.keys(seen))); }
		catch (error) {}
	};
	function subscriptionSince(seconds) {
		return Math.max(0, Math.floor(Date.now() / 1000) - seconds);
	}
	engine.onSwapMessage = null;
	engine.publishSwapMessage = function (sess, type, payload) {
		var nostrPrivateKey = sess.localNostrPrivateKey || '';
		if (!nostrPrivateKey) {
			var walletIdentity = engine.getWalletIdentity();
			if (walletIdentity && walletIdentity.wif && NOSTR.identityFromWif) {
				nostrPrivateKey = NOSTR.identityFromWif(walletIdentity.wif).privateKeyHex;
			}
		}
		var ev = SWAP.createEnvelopeForSession(sess, type, payload, sess.localNostrPubkey, nostrPrivateKey);
		/* Mark our own event as seen so relay echoes of it are never processed
		   as counterparty messages (a self-echo of swap_*_normal_signature used
		   to overwrite remote* signature slots with our OWN signature, which
		   assembled an invalid 2-of-2 scriptSig at claim time). */
		if (ev && ev.id) persistSeenEventId(ev.id);
		try { SWAP.addMessage(sess.swapId, ev); } catch (addError) { debugRelay('local message store skipped for ' + type + ': ' + (addError.message || addError)); }
		sess.messages = sess.messages || [];
		sess.messages.push(ev);
		try { engine.saveLive(sess); } catch (saveError) { debugRelay('live message store skipped for ' + type + ': ' + (saveError.message || saveError)); }
		var relayCount = engine.pool ? engine.pool.pub(ev) : 0;
		if (engine.onRelayPublish) engine.onRelayPublish(ev, relayCount);
		return ev;
	};
	function handleRelaySwapEvent(ev, relayUrl, source, expectedSwapId) {
		var eventId = ev && ev.id ? ev.id : '';
		try {
			var env = NOSTR.validateEnvelope(ev);
			if (expectedSwapId && env.swapId !== expectedSwapId) {
				debugRelay('drop ' + source + ' event ' + (eventId ? eventId.slice(0, 12) + '…' : 'unknown') + ' from ' + relayUrl + ': swapId mismatch ' + env.swapId.slice(0, 12) + '…');
				return;
			}
			if (seen[eventId]) {
				debugRelay('duplicate ' + source + ' ' + env.type + ' ' + env.swapId.slice(0, 12) + '… from ' + relayUrl);
				return;
			}
			persistSeenEventId(eventId);
			debugRelay('event ' + source + ' ' + env.type + ' ' + env.swapId.slice(0, 12) + '… kind ' + ev.kind + ' from ' + relayUrl + ' sig=' + (!!ev.sig));
			try { SWAP.addMessage(env.swapId, ev); }
			catch (messageError) { debugRelay('message pre-store skipped for ' + env.type + ' ' + env.swapId.slice(0, 12) + '…: ' + (messageError.message || messageError)); }
			if (engine.onSwapMessage) engine.onSwapMessage(env, ev);
		} catch (error) {
			debugRelay('reject ' + source + ' event ' + (eventId ? eventId.slice(0, 12) + '…' : 'unknown') + ' from ' + relayUrl + ': ' + (error.message || error));
		}
	}
	engine.startListening = function (force) {
		if (!engine.pool) engine.startRelays();
		engine._wantListening = true;
		if (engine._listenHandler && !force) return;
		engine._listenHandler = function (ev, relayUrl) {
			handleRelaySwapEvent(ev, relayUrl || 'unknown relay', 'global', '');
		};
		var globalFilter = { kinds: otcKinds(), since: subscriptionSince(GLOBAL_SUB_LOOKBACK_SECONDS), limit: TRACKED_SWAP_EVENT_LIMIT };
		var subId = engine.pool.sub(globalFilter, engine._listenHandler, GLOBAL_SUB_LOOKBACK_SECONDS);
		if (engine.onRelaySubscription) engine.onRelaySubscription(subId, globalFilter, 'global');
	};

	engine.untrackSwapId = function (swapId) {
		if (!engine.pool || !engine._trackedSwapSubscriptions) return;
		var subs = engine._trackedSwapSubscriptions[swapId];
		if (!subs) return;
		if (subs.dSub) engine.pool.unsub(subs.dSub);
		if (subs.swapIdSub) engine.pool.unsub(subs.swapIdSub);
		delete engine._trackedSwapSubscriptions[swapId];
		if (engine.trackedSwapIds) delete engine.trackedSwapIds[swapId];
	};
	engine.trackSwapId = function (swapId) {
		if (!engine.pool) engine.startRelays();
		engine.startListening();
		var cleanSwapId = $.trim(swapId || '');
		if (!/^[0-9a-f]{64}$/i.test(cleanSwapId)) {
			throw new Error('Swap ID must be a 64-character hex value');
		}
		engine.trackedSwapIds = engine.trackedSwapIds || {};
		engine._trackedSwapSubscriptions = engine._trackedSwapSubscriptions || {};
		if (engine._trackedSwapSubscriptions[cleanSwapId]) return engine._trackedSwapSubscriptions[cleanSwapId].swapIdSub;
		engine.trackedSwapIds[cleanSwapId] = true;
		var trackedSince = subscriptionSince(TRACKED_SWAP_SUB_LOOKBACK_SECONDS);
		var dFilter = { kinds: otcKinds(), '#d': [cleanSwapId], since: trackedSince, limit: TRACKED_SWAP_EVENT_LIMIT };
		var dSub = engine.pool.sub(dFilter, function (ev, relayUrl) {
			handleRelaySwapEvent(ev, relayUrl || 'unknown relay', '#d', cleanSwapId);
		}, TRACKED_SWAP_SUB_LOOKBACK_SECONDS);
		if (engine.onRelaySubscription) engine.onRelaySubscription(dSub, dFilter, '#d');
		var swapIdFilter = { kinds: otcKinds(), '#swapId': [cleanSwapId], since: trackedSince, limit: TRACKED_SWAP_EVENT_LIMIT };
		var swapIdSub = engine.pool.sub(swapIdFilter, function (ev, relayUrl) {
			handleRelaySwapEvent(ev, relayUrl || 'unknown relay', '#swapId', cleanSwapId);
		}, TRACKED_SWAP_SUB_LOOKBACK_SECONDS);
		if (engine.onRelaySubscription) engine.onRelaySubscription(swapIdSub, swapIdFilter, '#swapId');
		engine._trackedSwapSubscriptions[cleanSwapId] = { dSub: dSub, swapIdSub: swapIdSub };
		return swapIdSub;
	};

	/* ============ Tx helpers ============ */
	engine.withChain = function (cc, fn) { return CHAINS.withChain(cc, fn); };
	function withChain(cc, fn) { return engine.withChain(cc, fn); }
	function txidFromHex(txhex) {
		var first = Crypto.SHA256(Crypto.util.hexToBytes(txhex), { asBytes: true });
		return Crypto.util.bytesToHex(Crypto.SHA256(first, { asBytes: true }).reverse());
	}
	function promiseFromCoinCallback(work) {
		var d = $.Deferred();
		try { work(function (response) { response && response.success ? d.resolve(response) : d.reject((response && response.error) || 'Chain request failed'); }); }
		catch (error) { d.reject(error.message || String(error)); }
		return d.promise();
	}
	function scriptForAddress(address) {
		return Crypto.util.bytesToHex(coinjs.script().spendToScript(address).buffer);
	}
	/* UTXO/evidence values are ALWAYS satoshi integers: esplora returns sats
	   and the ROD /unspent endpoint returns sats (the wallet UI divides by
	   1e8). Only decimal strings containing '.' are coin-denominated. The old
	   ">21000000 ? sats : coins" heuristic misread every LTC value below
	   0.21 LTC (21,000,000 sats) as coins and inflated it 1e8-fold, which
	   broke LTC UTXO selection, funding verification and claim amounts. */
	function normalizeAmountSats(value) {
		if (typeof value === 'number') {
			if (!isFinite(value) || value < 0) throw new Error('Invalid satoshi amount: ' + value);
			return Math.round(value);
		}
		var text = String(value == null ? '' : value);
		if (text.indexOf('.') !== -1) {
			return CHAINS.decimalToSats(text);
		}
		var parsed = parseInt(text, 10);
		if (!isFinite(parsed) || parsed < 0) throw new Error('Invalid satoshi amount: ' + text);
		return parsed;
	}
	engine.listUnspent = function (cc, address) {
		return withChain(cc, function () {
			return promiseFromCoinCallback(function (done) { coinjs.transaction().listUnspent(address, done); });
		});
	};
	engine.broadcastTx = function (cc, txhex) {
		return withChain(cc, function () {
			return promiseFromCoinCallback(function (done) { coinjs.transaction().broadcast(done, txhex); });
		});
	};
	engine.getTransaction = function (cc, txid) {
		return withChain(cc, function () {
			return promiseFromCoinCallback(function (done) { coinjs.transaction().getTransaction(txid, done); });
		});
	};
	engine.findFundingOutput = function (cc, txid, expectedAddress, expectedAmount) {
		var expectedSats = CHAINS.decimalToSats(expectedAmount);
		var apiType = '';
		var matched = withChain(cc, function () {
			var expectedScript = scriptForAddress(expectedAddress);
			apiType = coinjs.getNetwork().apiType;
			/* Both the esplora and ROD /transaction/ endpoints return
			   satoshi-denominated integer values.  The ROD API is NOT
			   standard Bitcoin Core — it returns satoshis in /balance/,
			   /unspent/ AND /transaction/ (confirmed by live API probe
			   2026-07-18).  Only a decimal-string value (containing '.')
			   is treated as coin-denominated. */
			/* Use getTransactionRaw to get ALL outputs, not just unspent.
			   getTransaction filters with !isSpent, which can hide a P2SH
			   funding output if the API reports a spurious spent flag. */
			return engine.getTransactionRaw(cc, txid).then(function (txData) {
				try {
				var outputs = txData.vout || [];
				for (var i = 0; i < outputs.length; i++) {
					var output = outputs[i];
					var vout = (typeof output.n !== 'undefined') ? output.n : i;
					var rawVal = output.value;
					var outputSats;
					if (typeof rawVal === 'number') {
						outputSats = Math.round(rawVal);          // always sats
					} else {
						outputSats = normalizeAmountSats(rawVal);  // handles '.' decimals
					}
					/* Address: ROD API uses scriptPubKey.address (singular);
					   some Core versions use scriptPubKey.addresses[] (array) */
					var spk = output.scriptPubKey || {};
					var outAddr = (spk.addresses && spk.addresses[0])
						? spk.addresses[0]
						: (spk.address || output.scriptpubkey_address || output.address || '');
					var outScript = (output.scriptPubKey && output.scriptPubKey.hex)
						? output.scriptPubKey.hex
						: (output.scriptpubkey || output.script || '');
					/* Match by address OR script, with 1-sat tolerance for float rounding */
					var addrMatch = outAddr === expectedAddress;
					var scriptMatch = outScript && expectedScript && outScript === expectedScript;
					var valueMatch = Math.abs(outputSats - expectedSats) <= 1;
					if ((addrMatch || scriptMatch) && valueMatch) {
						return {
							chainCode: cc, txid: txid, vout: vout,
							amount: CHAINS.satsToDecimal(outputSats), value: outputSats,
							address: expectedAddress, scriptPubKey: outScript,
							confirmations: txData.confirmations || (txData.status && txData.status.confirmed ? 1 : 0),
							_esploraBlockHeight: (txData.status && txData.status.block_height) || 0,
							verifiedAt: new Date().toISOString()
						};
					}
				}
				throw new Error(cc + ' funding output not found for ' + expectedAddress + ' amount ' + expectedAmount + ' (checked ' + outputs.length + ' vouts)');
				} catch (verifyError) {
					return $.Deferred().reject(verifyError).promise();
				}
			});
		});
		/* Esplora reports no confirmation count — derive a real one from the
		   chain tip so confirmation gates work on LTC, not just ROD. */
		return matched.then(function (evidence) {
			if (apiType === 'rod' || !evidence._esploraBlockHeight) {
				delete evidence._esploraBlockHeight;
				return evidence;
			}
			return engine.getChainHeight(cc).then(function (tip) {
				evidence.confirmations = Math.max(1, tip - evidence._esploraBlockHeight + 1);
				delete evidence._esploraBlockHeight;
				return evidence;
			}, function () {
				delete evidence._esploraBlockHeight;
				return evidence; /* keep the 0/1 fallback on tip fetch failure */
			});
		});
	};
	/* Raw transaction data without the !isSpent filter */
	engine.getTransactionRaw = function (cc, txid) {
		return withChain(cc, function () {
			var d = $.Deferred();
			var network = coinjs.getNetwork();
			if (coinjs.explorer && coinjs.explorer.isSupported(network)) {
				return coinjs.explorer.tx(network, txid);
			}
			var url = (network.apiBase || coinjs.rodApi) + '/transaction/' + encodeURIComponent(txid);
			coinjs.ajax(url, function (response) {
				try {
					var parsed = JSON.parse(response);
					if (parsed && parsed.error) {
						d.reject((parsed.error.message || parsed.error) || 'Transaction lookup failed');
						return;
					}
					var txData = (parsed && parsed.result) ? parsed.result : parsed;
					d.resolve(txData);
				} catch (e) {
					d.reject('Invalid transaction response for ' + txid);
				}
			}, 'GET');
			return d.promise();
		});
	};
	/* Construction fee rate in base units per estimated byte, per chain. Comes
	   from the chain policy table so a new chain cannot be added without one:
	   ROD stays at 0 ("use the caller's fee verbatim"), Litecoin at 2 lit/vB,
	   Dogecoin at its 1000 koinu/B mining floor. */
	engine.feeRateFor = function (cc) {
		return CHAINS.getPolicy(cc).feeRatePerByte || 0;
	};
	engine.estimateP2pkhTxBytes = function (inputCount, outputCount) {
		/* ~148 B per P2PKH input, ~34 B per output, ~10 B overhead */
		return 10 + (inputCount * 148) + (outputCount * 34);
	};
	/* A 2-of-2 P2SH settlement input carries OP_0 + two ~72 B DER signatures +
	   a 71 B redeem script ≈ 258 B including its length prefix. */
	engine.estimateP2shMultisigTxBytes = function (inputCount, outputCount) {
		return 12 + (inputCount * 260) + (outputCount * 34);
	};

	/* Reject a settlement transaction that the network would not relay or mine,
	   BEFORE its sighash is committed to by a signature. On Dogecoin this is
	   load-bearing rather than cosmetic: dust is an absolute amount there, so
	   an output under the hard limit makes the whole transaction non-standard
	   no matter how much fee is attached, and the relay minimum carries a flat
	   surcharge for every soft-dust output. */
	engine.assertSettlementPolicy = function (cc, sizeBytes, feeSats, outputValuesSats, label) {
		var policy = CHAINS.getPolicy(cc);
		var what = label || 'settlement';
		for (var i = 0; i < outputValuesSats.length; i++) {
			if (CHAINS.isHardDust(cc, outputValuesSats[i])) {
				throw new Error(cc + ' ' + what + ' output ' + outputValuesSats[i] +
					' is below the ' + policy.hardDustSats + ' dust limit — the transaction would be non-standard');
			}
		}
		var minimum = CHAINS.minRelayFeeSats(cc, sizeBytes, outputValuesSats);
		if (feeSats < minimum) {
			throw new Error(cc + ' ' + what + ' fee ' + feeSats + ' is below the ' + minimum +
				' relay minimum for ' + sizeBytes + ' bytes — the transaction would not propagate');
		}
		return true;
	};
	engine.buildFundingTx = function (cc, sourceWif, destinationAddress, amountDecimal, feeDecimal) {
		var wallet = CHAINS.getWalletMaterialForChain(sourceWif, cc);
		var amountSats = CHAINS.decimalToSats(amountDecimal);
		var baseFeeSats = CHAINS.decimalToSats(feeDecimal || '0.00001000');
		return engine.listUnspent(cc, wallet.address).then(function (response) {
			try {
			return withChain(cc, function () {
				var utxos = response.data || [];
				var policy = CHAINS.getPolicy(cc);
				var feeRate = engine.feeRateFor(cc);
				function selectUtxos(feeSats) {
					var picked = [], sum = 0;
					for (var i = 0; i < utxos.length && sum < amountSats + feeSats; i++) {
						var utxo = utxos[i];
						var value = normalizeAmountSats(utxo.value);
						if (!utxo.transaction_hash || utxo.vout == null || value <= 0) continue;
						picked.push({ txid: utxo.transaction_hash, vout: utxo.vout, value: value, script: utxo.script_pub_key_hex || '' });
						sum += value;
					}
					return { selected: picked, total: sum };
				}
				/* Iterate: a bigger fee can need more inputs, which grows the
				   tx and can require a bigger fee again. Converges fast. */
				var feeSats = baseFeeSats, selection = selectUtxos(feeSats);
				for (var pass = 0; pass < 5; pass++) {
					var estBytes = engine.estimateP2pkhTxBytes(Math.max(selection.selected.length, 1), 2);
					/* On Dogecoin a change output under the soft dust limit adds a
					   flat per-output surcharge to the relay minimum, so the fee
					   has to be sized against the OUTPUTS as well as the bytes. */
					var projectedChange = selection.total - amountSats - feeSats;
					var projectedOutputs = (projectedChange >= policy.changeThresholdSats)
						? [amountSats, projectedChange]
						: [amountSats];
					var minFee = Math.max(
						baseFeeSats,
						Math.ceil(estBytes * feeRate),
						CHAINS.minRelayFeeSats(cc, estBytes, projectedOutputs)
					);
					if (minFee <= feeSats) break;
					feeSats = minFee;
					selection = selectUtxos(feeSats);
				}
				var selected = selection.selected, total = selection.total;
				if (total < amountSats + feeSats) throw new Error('Insufficient ' + cc + ' UTXOs: need ' + CHAINS.satsToDecimal(amountSats + feeSats) + ', selected ' + CHAINS.satsToDecimal(total));
				var tx = coinjs.transaction();
				for (var s = 0; s < selected.length; s++) {
					tx.addinput(selected[s].txid, selected[s].vout, selected[s].script, 0xffffffff);
				}
				tx.addoutput(destinationAddress, CHAINS.satsToDecimal(amountSats));
				var change = total - amountSats - feeSats;
				/* Change below the chain's threshold is abandoned to the fee
				   rather than emitted: on Dogecoin an uneconomic change output
				   would either be outright non-standard (hard dust) or trigger
				   the 0.01 DOGE soft-dust surcharge, which costs more than the
				   change is worth. */
				if (change >= policy.changeThresholdSats) {
					tx.addoutput(wallet.address, CHAINS.satsToDecimal(change));
				} else if (change > 0) {
					feeSats += change;
					change = 0;
				}
				/* Validate what was actually built, not what the loop intended:
				   the convergence loop above is bounded, and funding is the one
				   transaction that had no post-construction policy check. An
				   underpaid funding tx relays but is skipped by miners running
				   the default -blockmintxfee, so it can sit unconfirmed past the
				   swap's refund deadline. */
				var finalOutputs = change > 0 ? [amountSats, change] : [amountSats];
				var finalBytes = engine.estimateP2pkhTxBytes(selected.length, finalOutputs.length);
				engine.assertSettlementPolicy(cc, finalBytes, feeSats, finalOutputs, 'funding');
				tx.sign(sourceWif);
				var txhex = tx.serialize();
				return { chainCode: cc, txhex: txhex, txid: txidFromHex(txhex), sourceAddress: wallet.address, destinationAddress: destinationAddress, amount: CHAINS.satsToDecimal(amountSats), fee: CHAINS.satsToDecimal(feeSats), selectedUtxos: selected, change: CHAINS.satsToDecimal(change > 0 ? change : 0) };
			});
			} catch (buildError) {
				/* jQuery 1.9 does not convert exceptions in .then callbacks into
				   rejections — without this, a failed build (e.g. insufficient
				   LTC UTXOs) escapes uncaught, .fail() never runs and the
				   fundAlt automation flag stays stuck forever. */
				return $.Deferred().reject(buildError).promise();
			}
		});
	};
	engine.buildClaimTxFromFunding = function (cc, fundingEvidence, redeemScript, destinationAddress, feeDecimal) {
		return withChain(cc, function () {
			/* Validate destination address decodes under the target chain BEFORE
			   building the transaction.  A bad address would otherwise cascade
			   into an opaque "Cannot read properties of undefined" deep inside
			   the script serialiser. */
			if (!destinationAddress || typeof destinationAddress !== 'string') {
				throw new Error(cc + ' claim destination address is missing');
			}
			var trimmedDest = destinationAddress.replace(/\s+/g, '');
			if (trimmedDest !== destinationAddress) {
				debugRelay(cc + ' claim destination had whitespace — trimmed "' + destinationAddress.substring(0, 20) + '…"');
				destinationAddress = trimmedDest;
			}
			var decoded = coinjs.addressDecode(destinationAddress);
			if (!decoded) {
				throw new Error(cc + ' claim destination address does not decode (wrong chain or corrupt): ' + destinationAddress.substring(0, 20) + '…');
			}
			/* Verified funding evidence stores .value in satoshis; broadcast-only
			   evidence carries the decimal .amount string. Both parties MUST
			   resolve the same satoshi amount or their claim sighashes diverge. */
			var amountSats = (fundingEvidence.value != null)
				? normalizeAmountSats(fundingEvidence.value)
				: CHAINS.decimalToSats(String(fundingEvidence.amount));
			var feeSats = CHAINS.decimalToSats(feeDecimal || '0.00001000');
			if (amountSats <= feeSats) throw new Error('Claim amount does not cover fee');
			engine.assertSettlementPolicy(cc, engine.estimateP2shMultisigTxBytes(1, 1), feeSats, [amountSats - feeSats], 'claim');
			var tx = coinjs.transaction();
			tx.addinput(fundingEvidence.txid, fundingEvidence.vout, redeemScript, 0xffffffff);
			tx.addoutput(destinationAddress, CHAINS.satsToDecimal(amountSats - feeSats));
			return tx;
		});
	};
	engine.signClaimTx = function (cc, tx, wif) { return withChain(cc, function () { return tx.transactionSig(0, wif, 1); }); };
	/* Timelocked refund spending the 2-of-2 funding output back to the
	   original funder. nLockTime enforcement requires a non-final input
	   sequence (0xfffffffe); the tx is then invalid until the chain reaches
	   lockHeight. Both parties MUST construct this identically (same funding
	   outpoint, destination, fee, lockHeight) or their sighashes diverge. */
	engine.buildRefundTxFromFunding = function (cc, fundingEvidence, redeemScript, destinationAddress, feeDecimal, lockHeight) {
		return withChain(cc, function () {
			if (!destinationAddress || typeof destinationAddress !== 'string') {
				throw new Error(cc + ' refund destination address is missing');
			}
			var trimmedDest = destinationAddress.replace(/\s+/g, '');
			if (trimmedDest !== destinationAddress) {
				debugRelay(cc + ' refund destination had whitespace — trimmed');
				destinationAddress = trimmedDest;
			}
			var decoded = coinjs.addressDecode(destinationAddress);
			if (!decoded) {
				throw new Error(cc + ' refund destination address does not decode (wrong chain or corrupt): ' + destinationAddress.substring(0, 20) + '…');
			}
			var amountSats = (fundingEvidence.value != null)
				? normalizeAmountSats(fundingEvidence.value)
				: CHAINS.decimalToSats(String(fundingEvidence.amount));
			var feeSats = CHAINS.decimalToSats(feeDecimal || '0.00001000');
			if (amountSats <= feeSats) throw new Error('Refund amount does not cover fee');
			var height = parseInt(lockHeight, 10);
			if (!isFinite(height) || height <= 0) throw new Error('Refund lock height is required');
			engine.assertSettlementPolicy(cc, engine.estimateP2shMultisigTxBytes(1, 1), feeSats, [amountSats - feeSats], 'refund');
			var tx = coinjs.transaction();
			tx.lock_time = height;
			tx.addinput(fundingEvidence.txid, fundingEvidence.vout, redeemScript, 0xfffffffe);
			tx.addoutput(destinationAddress, CHAINS.satsToDecimal(amountSats - feeSats));
			return tx;
		});
	};
	/* Raw tx hex: esplora GET /tx/:txid/hex (plain text); the ROD /transaction
	   response includes a .hex field. Needed to extract the counterparty's
	   completed signature from the REAL broadcast claim transaction. */
	engine.getTxHex = function (cc, txid) {
		return withChain(cc, function () {
			var network = coinjs.getNetwork();
			if (coinjs.explorer && coinjs.explorer.isSupported(network)) {
				return coinjs.explorer.txHex(network, txid);
			}
			return engine.getTransactionRaw(cc, txid).then(function (txData) {
				if (txData && txData.hex) return txData.hex;
				return $.Deferred().reject('ROD tx has no hex field').promise();
			});
		});
	};
	/* Esplora outpoint spend status: GET /tx/:txid/outspend/:vout →
	   {spent:bool, txid?:hex}. Lets Buyer discover Seller's LTC claim directly
	   from the chain even if every Nostr relay drops the notification. */
	engine.getOutspend = function (cc, txid, vout) {
		return withChain(cc, function () {
			var network = coinjs.getNetwork();
			if (coinjs.explorer && coinjs.explorer.isSupported(network)) {
				return coinjs.explorer.outspend(network, txid, vout);
			}
			/* ROD (non-esplora) fallback: fetch the tx and check if the vout
			   has a spentTxId or isSpent flag set by the REST API. */
			return engine.getTransactionRaw(cc, txid).then(function (txData) {
				var outputs = txData.vout || [];
				var out = outputs[parseInt(vout, 10)];
				if (!out) return { spent: false };
				if (out.spentTxId) return { spent: true, txid: out.spentTxId };
				if (out.isSpent) return { spent: true, txid: '' };
				return { spent: false };
			});
		});
	};
	/* Is the funding outpoint still unspent? Used as the refund pre-check.
	   Resolves {unspent:bool}. */
	engine.isOutpointUnspent = function (cc, address, txid, vout) {
		return engine.listUnspent(cc, address).then(function (response) {
			var utxos = (response && response.data) || [];
			for (var i = 0; i < utxos.length; i++) {
				var utxoTxid = utxos[i].transaction_hash || utxos[i].txid || '';
				var utxoVout = (typeof utxos[i].vout !== 'undefined') ? utxos[i].vout : utxos[i].index;
				if (utxoTxid === txid && parseInt(utxoVout, 10) === parseInt(vout, 10)) return { unspent: true };
			}
			return { unspent: false };
		});
	};
	/* Parse a P2SH 2-of-2 claim scriptSig [OP_0 <sigA> <sigB> <redeem>] out of
	   a raw tx hex. Returns {signatures:[hexWithSighashByte,...], redeemScript}.
	   Signature order matches the redeem-script pubkey order [seller, buyer]. */
	engine.extractMultisigScriptSigSigs = function (txhex) {
		var parsed = coinjs.transaction().deserialize(txhex);
		if (!parsed || !parsed.ins || !parsed.ins.length) throw new Error('Cannot parse claim transaction');
		var chunks = parsed.ins[0].script.chunks || [];
		var signatures = [];
		var redeemScript = '';
		for (var i = 0; i < chunks.length; i++) {
			var chunk = chunks[i];
			if (typeof chunk === 'number') continue; /* OP_0 etc. */
			var hex = Crypto.util.bytesToHex(chunk);
			/* DER signatures start 0x30; the final push is the redeem script */
			if (i === chunks.length - 1) redeemScript = hex;
			else if (chunk[0] === 0x30) signatures.push(hex);
		}
		if (!signatures.length) throw new Error('No signatures found in claim scriptSig');
		return { signatures: signatures, redeemScript: redeemScript };
	};
	engine.applyMultisigSignatures = function (cc, tx, redeemScript, signatures) {
		return withChain(cc, function () {
			var script = coinjs.script();
			script.writeOp(0);
			for (var i = 0; i < signatures.length; i++) script.writeBytes(Crypto.util.hexToBytes(signatures[i]));
			script.writeBytes(Crypto.util.hexToBytes(redeemScript));
			tx.ins[0].script = script;
			return tx;
		});
	};
	engine.buildClaimTx = function (cc, txid, vout, rs, amt, addr, fee) {
		return withChain(cc, function () {
			var tx = coinjs.transaction(); tx.addinput(txid, vout, rs, 0xffffffff);
			tx.addoutput(addr, parseFloat(amt) - parseFloat(fee)); return tx;
		});
	};
	engine.sighash = function (tx) { return Crypto.util.hexToBytes(tx.transactionHash(0, 1)); };
	engine.signOrd = function (tx, wif) { return tx.transactionSig(0, wif, 1); };
	engine.makeAdaptorSig = function (sess, tx) {
		if (!sess.localChildPrivateKey || typeof sess.localChildPrivateKey !== 'string' || sess.localChildPrivateKey.length < 60) {
			throw new Error('localChildPrivateKey is missing or corrupt (length=' + (sess.localChildPrivateKey ? sess.localChildPrivateKey.length : 0) + ') — wallet may be locked or wrong WIF');
		}
		if (!sess.adaptorPoint || typeof sess.adaptorPoint !== 'string' || sess.adaptorPoint.length < 60) {
			throw new Error('adaptorPoint is missing or corrupt (length=' + (sess.adaptorPoint ? sess.adaptorPoint.length : 0) + ')');
		}
		var hash = engine.sighash(tx);
		if (!hash || !hash.length || hash.length !== 32) {
			throw new Error('sighash produced invalid result (length=' + (hash ? hash.length : 'null') + ') — claim tx may be malformed');
		}
		return coinjs.adaptor.encrypt({ messageHash: hash, signingPrivateKey: sess.localChildPrivateKey, adaptorPublicKey: sess.adaptorPoint, auxiliaryRandomness: coinjs.newPrivkey() });
	};
	/* Completed signature must carry the SIGHASH_ALL byte to be valid in a
	   scriptSig; adaptor.complete() returns bare DER. */
	engine.completeSig = function (asig, secret) { return coinjs.adaptor.complete({ adaptorSignature: asig, adaptorSecret: secret }).hex + '01'; };
	/* parseDER reads by DER length fields, so a trailing sighash byte on the
	   completed signature (as extracted from a real scriptSig) is tolerated. */
	engine.recoverSecret = function (asig, csig, Y) { return coinjs.adaptor.recover({ adaptorSignature: asig, completedSignature: Crypto.util.hexToBytes(csig), adaptorPublicKey: Y }); };
	/* Verify a counterparty adaptor signature (DLEQ + pre-signature check)
	   against the exact claim sighash before trusting it for settlement. */
	engine.verifyAdaptorSig = function (sighashBytes, signerPubkeyHex, adaptorPointHex, adaptorSigHex) {
		try {
			return coinjs.adaptor.verify({
				messageHash: sighashBytes,
				signingPublicKey: signerPubkeyHex,
				adaptorPublicKey: adaptorPointHex,
				adaptorSignature: Crypto.util.hexToBytes(adaptorSigHex)
			});
		} catch (e) { return false; }
	};
	/* Verify a plain DER(+sighash byte) ECDSA signature against a sighash. */
	engine.verifyDerSig = function (sighashBytes, signerPubkeyHex, derSigHex) {
		try {
			var decompressed = coinjs.pubkeydecompress(signerPubkeyHex) || signerPubkeyHex;
			return coinjs.verifySignature(sighashBytes, Crypto.util.hexToBytes(derSigHex), Crypto.util.hexToBytes(decompressed));
		} catch (e) { return false; }
	};

	/* ============ Persistent sessions ============ */
	var LIVE = 'spexSwapV2Live';

	/* Large hex blobs (raw tx hex for planned fundings and signed refund txns)
	   are offloaded to individual localStorage keys so that one session with a
	   big tx cannot blow the 5 MB quota for the whole v2 live-swap map.
	   Each blob lives under  spexSwapV2Hex_<swapId>_<parent>_<field>  and is
	   removed with the session when removeLive() is called.
	   NOTE: txhex/signedHex are still held in memory on the live object;
	   only the persisted copy has them stripped and re-merged on restore. */
	var HEX_PREFIX = 'spexSwapV2Hex_';
	var HEX_PATHS = [
		['plannedAssetFunding', 'txhex'],
		['plannedPaymentFunding', 'txhex'],
		['assetRefund',         'signedHex'],
		['paymentRefund',         'signedHex']
	];
	var RECOVERY_VERSION = 2;
	var RECOVERY_TYPE = 'spex-swap-recovery';
	var RECOVERY_MAX_BYTES = 8 * 1024 * 1024;
	var RECOVERY_SENSITIVE_FIELDS = {
		localChildPrivateKey: true,
		privateKeyHex: true,
		privateKeyWif: true,
		xprv: true,
		adaptorSecret: true,
		localNostrPrivateKey: true
	};
	var RECOVERY_SEALED_FIELDS = {
		localChildPrivateKey: '_ep',
		adaptorSecret: '_ea',
		localNostrPrivateKey: '_en'
	};
	var RECOVERY_LOCAL_CONFIG_FIELDS = {
		rpcUrl: true,
		rpcPort: true,
		rpcUser: true,
		rpcPass: true,
		rpcWallet: true
	};
	function _hexKey(swapId, parent, field) { return HEX_PREFIX + swapId + '_' + parent + '_' + field; }
	function _saveHexBlobs(swapId, clone) {
		HEX_PATHS.forEach(function (p) {
			var obj = clone[p[0]];
			if (obj && obj[p[1]]) {
				try { localStorage.setItem(_hexKey(swapId, p[0], p[1]), obj[p[1]]); } catch (e) {}
				delete obj[p[1]];
			}
		});
	}
	function _loadHexBlobs(swapId, s) {
		HEX_PATHS.forEach(function (p) {
			var val = localStorage.getItem(_hexKey(swapId, p[0], p[1]));
			if (val) { if (!s[p[0]]) s[p[0]] = {}; s[p[0]][p[1]] = val; }
		});
	}
	function _removeHexBlobs(swapId) {
		HEX_PATHS.forEach(function (p) { localStorage.removeItem(_hexKey(swapId, p[0], p[1])); });
	}
	function _eachStorageKey(prefix, fn) {
		if (!localStorage || typeof localStorage.length !== 'number' || typeof localStorage.key !== 'function') return;
		var keys = [];
		for (var i = 0; i < localStorage.length; i++) {
			var key = localStorage.key(i);
			if (!prefix || (key && key.indexOf(prefix) === 0)) keys.push(key);
		}
		for (var j = 0; j < keys.length; j++) fn(keys[j]);
	}
	function _stableStringify(value) {
		if (value === null || typeof value !== 'object') return JSON.stringify(value);
		if ($.isArray(value)) {
			var arrayParts = [];
			for (var ai = 0; ai < value.length; ai++) arrayParts.push(_stableStringify(value[ai]));
			return '[' + arrayParts.join(',') + ']';
		}
		var keys = [];
		for (var name in value) if (Object.prototype.hasOwnProperty.call(value, name)) keys.push(name);
		keys.sort();
		var objectParts = [];
		for (var ki = 0; ki < keys.length; ki++) objectParts.push(JSON.stringify(keys[ki]) + ':' + _stableStringify(value[keys[ki]]));
		return '{' + objectParts.join(',') + '}';
	}
	function _checksum(value) {
		return Crypto.util.bytesToHex(Crypto.SHA256(Crypto.charenc.UTF8.stringToBytes(_stableStringify(value)), { asBytes: true }));
	}
	function _plainRecord(value) {
		return !!value && Object.prototype.toString.call(value) === '[object Object]';
	}
	function _sessionMatchesWallet(session, walletWif) {
		try {
			if (!walletWif || !session || !session.terms) return false;
			var account = engine.deriveSwapAccount(walletWif);
			var expected = session.role === 'seller'
				? session.terms.sellerSwapXpub
				: (session.role === 'buyer' ? session.terms.buyerSwapXpub : '');
			return !!expected && engine.sameExtendedKey(account.pubkey, expected);
		} catch (e) { return false; }
	}
	function _sanitizeRecoveryConfig(config) {
		var sanitized = $.extend(true, {}, config || {});
		for (var field in RECOVERY_LOCAL_CONFIG_FIELDS) {
			if (Object.prototype.hasOwnProperty.call(sanitized, field)) delete sanitized[field];
		}
		return sanitized;
	}
	function _prepareRecoverySession(session, walletWif) {
		var sanitized = $.extend(true, {}, session || {});
		for (var rawField in RECOVERY_SEALED_FIELDS) {
			if (!Object.prototype.hasOwnProperty.call(sanitized, rawField)) continue;
			var rawValue = sanitized[rawField];
			var sealedField = RECOVERY_SEALED_FIELDS[rawField];
			if (rawValue && !sanitized[sealedField]) {
				if (!_sessionMatchesWallet(sanitized, walletWif)) {
					throw new Error('Swap ' + (sanitized.swapId || '(unknown)') +
						' contains unsealed recovery secrets. Open the same wallet that created it, then export again.');
				}
				sanitized[sealedField] = CryptoJS.AES.encrypt(rawValue, walletWif).toString();
			}
			delete sanitized[rawField];
		}
		for (var field in RECOVERY_SENSITIVE_FIELDS) {
			if (Object.prototype.hasOwnProperty.call(sanitized, field)) delete sanitized[field];
		}
		/* Automation locks describe one page run, not durable protocol state. */
		delete sanitized.automation;
		return sanitized;
	}
	function _validateImportedSession(swapId, session) {
		if (!swapId || swapId.length > 256 || /[\u0000-\u001f]/.test(swapId) ||
			swapId === '__proto__' || swapId === 'prototype' || swapId === 'constructor') {
			throw new Error('OTC recovery backup contains an invalid swap ID');
		}
		if (!_plainRecord(session) || String(session.swapId || '') !== swapId ||
			!_plainRecord(session.terms) || session.terms.protocol !== SWAP.PROTOCOL_VERSION ||
			(session.role !== 'seller' && session.role !== 'buyer')) {
			throw new Error('OTC recovery backup contains an invalid session for ' + swapId);
		}
		for (var field in RECOVERY_SENSITIVE_FIELDS) {
			if (Object.prototype.hasOwnProperty.call(session, field)) {
				throw new Error('OTC recovery backup contains an unencrypted sensitive field: ' + field);
			}
		}
		var sanitized = $.extend(true, {}, session);
		delete sanitized.automation;
		return sanitized;
	}
	function _collectHexBlobs(live) {
		var blobs = {};
		for (var swapId in (live || {})) {
			if (!Object.prototype.hasOwnProperty.call(live, swapId)) continue;
			HEX_PATHS.forEach(function (p) {
				var key = _hexKey(swapId, p[0], p[1]);
				var value = localStorage.getItem(key);
				if (value) blobs[key] = value;
			});
		}
		return blobs;
	}
	function _makeRecoveryEnvelope(payload) {
		return {
			version: RECOVERY_VERSION,
			type: RECOVERY_TYPE,
			updatedAt: new Date().toISOString(),
			payload: payload,
			checksum: _checksum(payload)
		};
	}
	function _validateRecoveryEnvelope(envelope) {
		if (!_plainRecord(envelope) || envelope.version !== RECOVERY_VERSION || envelope.type !== RECOVERY_TYPE ||
			!_plainRecord(envelope.payload) || !envelope.checksum) {
			throw new Error('Unsupported or incomplete OTC recovery backup');
		}
		if (_checksum(envelope.payload) !== envelope.checksum) throw new Error('OTC recovery checksum mismatch');
		if (!_plainRecord(envelope.payload.live)) throw new Error('OTC recovery backup is missing live sessions');
		if (!_plainRecord(envelope.payload.hexBlobs)) throw new Error('OTC recovery backup is missing recovery blobs');
		if (envelope.payload.config != null && !_plainRecord(envelope.payload.config)) {
			throw new Error('OTC recovery backup contains invalid settings');
		}
		if (envelope.payload.history != null && !$.isArray(envelope.payload.history)) {
			throw new Error('OTC recovery backup contains invalid history');
		}
		return envelope;
	}
	function _recoveryStorageSnapshot() {
		var snapshot = {};
		[ LIVE, CFG_KEY, HK ].forEach(function (key) { snapshot[key] = localStorage.getItem(key); });
		_eachStorageKey(HEX_PREFIX, function (key) { snapshot[key] = localStorage.getItem(key); });
		return snapshot;
	}
	function _restoreRecoveryStorage(snapshot) {
		_eachStorageKey(HEX_PREFIX, function (key) { localStorage.removeItem(key); });
		[ LIVE, CFG_KEY, HK ].forEach(function (key) { localStorage.removeItem(key); });
		for (var key in snapshot) {
			if (Object.prototype.hasOwnProperty.call(snapshot, key) && snapshot[key] != null) {
				localStorage.setItem(key, snapshot[key]);
			}
		}
		engine.applyApiConfig(engine.loadConfig());
	}
	function _mergeRecoveryHistory(current, imported) {
		var merged = [], seenHistory = {};
		(current || []).concat(imported || []).forEach(function (entry) {
			if (!_plainRecord(entry) || merged.length >= 100) return;
			var key = [entry.swapId || '', entry.state || '', entry.completedAt || '', entry.orderId || ''].join('|');
			if (seenHistory[key]) return;
			seenHistory[key] = true;
			merged.push(entry);
		});
		return merged;
	}

	var TERMINAL_STATES = { COMPLETE: true, REFUNDED: true, PARTIALLY_SETTLED: true, ASSET_REFUNDED: true, PAYMENT_REFUNDED: true };
	function isTerminalSession(s) {
		return !!(s && (s.declined || TERMINAL_STATES[s.state]));
	}
	engine.saveLive = function (sess) {
		var all = engine.loadLive(), c = $.extend(true, {}, sess), pw = engine.walletPassword();
		if (c.localChildPrivateKey && pw) { c._ep = CryptoJS.AES.encrypt(c.localChildPrivateKey, pw).toString(); delete c.localChildPrivateKey; }
		if (c.adaptorSecret && pw) { c._ea = CryptoJS.AES.encrypt(c.adaptorSecret, pw).toString(); delete c.adaptorSecret; }
		if (c.localNostrPrivateKey && pw) { c._en = CryptoJS.AES.encrypt(c.localNostrPrivateKey, pw).toString(); delete c.localNostrPrivateKey; }
		_saveHexBlobs(sess.swapId, c);
		all[sess.swapId] = c;
		/* When a session reaches a terminal state, clean up relay resources:
		   unsub its tracked subscriptions so reconnect doesn't re-subscribe,
		   and purge its events from the outbox so reconnect doesn't re-publish
		   dozens of completed-swap messages back to the relay. */
		if (isTerminalSession(sess)) {
			engine.untrackSwapId(sess.swapId);
			if (engine.pool) {
				var sid = sess.swapId;
				engine.pool.outbox = engine.pool.outbox.filter(function (ev) {
					try { return JSON.parse(ev.content || '{}').swapId !== sid; } catch (e) { return true; }
				});
			}
		}
		try {
			localStorage.setItem(LIVE, JSON.stringify(all));
		} catch (e) {
			if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === DOMException.QUOTA_EXCEEDED_ERR) {
				/* Pass 1: drop COMPLETE sessions and retry */
				Object.keys(all).forEach(function (id) { if (id !== sess.swapId && all[id].state === 'COMPLETE') delete all[id]; });
				try {
					localStorage.setItem(LIVE, JSON.stringify(all));
				} catch (e2) {
					/* Pass 2: keep only the current session */
					var minimal = {}; minimal[sess.swapId] = c;
					try { localStorage.setItem(LIVE, JSON.stringify(minimal)); } catch (e3) {
						console.error('spexSwapV2Live: storage full even after pruning — session not persisted', e3);
					}
				}
			}
		}
	};
	engine.loadLive = function () {
		try {
			return JSON.parse(localStorage.getItem(LIVE)) || {};
		} catch (e) { return {}; }
	};
	engine.restoreLive = function (id) {
		var all = engine.loadLive(), s = all[id]; if (!s) return null;
		var pw = engine.walletPassword();
		if (s._ep && pw) { try { s.localChildPrivateKey = CryptoJS.AES.decrypt(s._ep, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (s._ea && pw) { try { s.adaptorSecret = CryptoJS.AES.decrypt(s._ea, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (s._en && pw) { try { s.localNostrPrivateKey = CryptoJS.AES.decrypt(s._en, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		_loadHexBlobs(id, s);
		return s;
	};
	engine.removeLive = function (id) {
		var a = engine.loadLive(); delete a[id];
		_removeHexBlobs(id);
		try { localStorage.setItem(LIVE, JSON.stringify(a)); } catch (e) {}
	};
	engine.exportRecoveryState = function () {
		var live = engine.loadLive();
		var sanitizedLive = {};
		var walletWif = engine.walletPassword();
		for (var swapId in live) {
			if (Object.prototype.hasOwnProperty.call(live, swapId)) {
				sanitizedLive[swapId] = _prepareRecoverySession(live[swapId], walletWif);
			}
		}
		var payload = {
			live: sanitizedLive,
			hexBlobs: _collectHexBlobs(live),
			/* Local Core RPC details may contain credentials or only make sense
			   on this machine. Public API/relay preferences remain portable. */
			config: _sanitizeRecoveryConfig(engine.loadConfig()),
			history: engine.getHistory ? engine.getHistory() : []
		};
		return JSON.stringify(_makeRecoveryEnvelope(payload), null, 2);
	};
	engine.importRecoveryState = function (serializedValue) {
		if (typeof serializedValue !== 'string' || !serializedValue.trim()) {
			throw new Error('Paste an OTC recovery backup before importing');
		}
		if (serializedValue.length > RECOVERY_MAX_BYTES) throw new Error('OTC recovery backup is too large');
		var envelope = _validateRecoveryEnvelope(JSON.parse(serializedValue));
		var importedLive = {};
		for (var swapId in envelope.payload.live) {
			if (Object.prototype.hasOwnProperty.call(envelope.payload.live, swapId)) {
				importedLive[swapId] = _validateImportedSession(swapId, envelope.payload.live[swapId]);
			}
		}
		var allowedBlobs = {};
		for (var id in importedLive) {
			if (!Object.prototype.hasOwnProperty.call(importedLive, id)) continue;
			HEX_PATHS.forEach(function (p) { allowedBlobs[_hexKey(id, p[0], p[1])] = true; });
		}
		var validBlobs = {};
		for (var blobKey in envelope.payload.hexBlobs) {
			if (!Object.prototype.hasOwnProperty.call(envelope.payload.hexBlobs, blobKey)) continue;
			var blobValue = envelope.payload.hexBlobs[blobKey];
			if (!allowedBlobs[blobKey] || typeof blobValue !== 'string' ||
				!blobValue || blobValue.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(blobValue)) {
				throw new Error('OTC recovery backup contains an invalid recovery blob: ' + blobKey);
			}
			validBlobs[blobKey] = blobValue;
		}

		/* Never let an older backup silently overwrite a live local session.
		   Non-conflicting sessions are merged, so import is additive. */
		var currentLive = engine.loadLive();
		var conflicts = [];
		for (var importedId in importedLive) {
			if (Object.prototype.hasOwnProperty.call(importedLive, importedId) &&
				Object.prototype.hasOwnProperty.call(currentLive, importedId)) conflicts.push(importedId);
		}
		if (conflicts.length) {
			throw new Error('Recovery import would overwrite existing swap(s): ' + conflicts.join(', ') +
				'. Remove those local sessions only if you intentionally want to replace them.');
		}
		var mergedLive = {};
		for (var currentId in currentLive) {
			if (Object.prototype.hasOwnProperty.call(currentLive, currentId)) mergedLive[currentId] = currentLive[currentId];
		}
		for (var newId in importedLive) {
			if (Object.prototype.hasOwnProperty.call(importedLive, newId)) mergedLive[newId] = importedLive[newId];
		}
		var currentConfig = engine.loadConfig();
		var importedConfig = _sanitizeRecoveryConfig(envelope.payload.config || {});
		var mergedConfig = $.extend({}, currentConfig, importedConfig);
		if ($.isArray(importedConfig.relays)) mergedConfig.relays = importedConfig.relays.slice();
		for (var localField in RECOVERY_LOCAL_CONFIG_FIELDS) {
			if (Object.prototype.hasOwnProperty.call(currentConfig, localField)) {
				mergedConfig[localField] = currentConfig[localField];
			}
		}
		var mergedHistory = _mergeRecoveryHistory(engine.getHistory(), envelope.payload.history || []);
		var snapshot = _recoveryStorageSnapshot();
		try {
			localStorage.setItem(LIVE, JSON.stringify(mergedLive));
			for (var validBlobKey in validBlobs) {
				if (Object.prototype.hasOwnProperty.call(validBlobs, validBlobKey)) {
					localStorage.setItem(validBlobKey, validBlobs[validBlobKey]);
				}
			}
			engine.saveConfig(mergedConfig);
			localStorage.setItem(HK, JSON.stringify(mergedHistory));
		} catch (writeError) {
			try { _restoreRecoveryStorage(snapshot); } catch (rollbackError) {
				throw new Error('Recovery import failed and local rollback also failed: ' + (rollbackError.message || rollbackError));
			}
			throw new Error('Recovery import failed; existing local state was restored: ' + (writeError.message || writeError));
		}
		return {
			sessions: Object.keys(importedLive).length,
			hexBlobs: Object.keys(validBlobs).length,
			importedSwapIds: Object.keys(importedLive)
		};
	};

	/* ============ Trade history ============ */
	var HK = 'spexSwapV2History';
	engine.getHistory = function () { try { return JSON.parse(localStorage.getItem(HK)) || []; } catch (e) { return []; } };
	engine.recordTrade = function (s) {
		var h = engine.getHistory();
		h.unshift({ swapId: s.swapId, orderId: s.orderId, role: s.role, state: s.state, pair: s.terms.pair, assetChain: s.terms.assetChain, paymentChain: s.terms.paymentChain, assetAmount: s.terms.assetAmount, paymentAmount: s.terms.paymentAmount, assetFundingTxid: s.execution && s.execution.assetFunding && s.execution.assetFunding.txid || '', paymentFundingTxid: s.execution && s.execution.paymentFunding && s.execution.paymentFunding.txid || '', paymentClaimTxid: s.execution && s.execution.paymentClaim && s.execution.paymentClaim.txid || '', assetClaimTxid: s.execution && s.execution.assetClaim && s.execution.assetClaim.txid || '', completedAt: new Date().toISOString() });
		if (h.length > 100) h = h.slice(0, 100);
		localStorage.setItem(HK, JSON.stringify(h));
	};
	engine.clearHistory = function () { localStorage.removeItem(HK); };

	/* ============ Order detail transport over Nostr ============
	   The ROD name DB is the ONLY source of truth for what is on offer: an order
	   exists because a name record exists, and nothing a relay says can add an
	   order to the book. What the name DB is bad at is carrying bulk data — the
	   value is size-limited and every edit costs an on-chain name operation — so
	   the record stores a compact ANCHOR (the Nostr event id and the publishing
	   key) and the full order detail travels over the relay pool the swap
	   protocol already maintains.

	   The anchor is what makes this safe. Detail is accepted only when the relay
	   event's id matches the id named on-chain and its signature verifies under
	   the key named on-chain, so the chain record pins exactly one immutable
	   payload. A relay can withhold detail, but it cannot substitute, alter or
	   invent an order. Kind 31341 is parameterised-replaceable so a re-publish
	   supersedes cleanly under the same d-tag. */
	engine.relayOrderDetail = {};        /* nostr event id -> { order, event } */
	engine.onRelayOrderDetail = null;    /* UI hook, fired when detail arrives */
	var ORDER_SUB_LOOKBACK_SECONDS = 604800;

	function orderKindFilter() {
		return [(NOSTR && NOSTR.ORDER_EVENT_KIND) || 31341];
	}

	/* Publish order detail to the relays and return the anchor that must then be
	   written into the ROD name record. Publishing detail alone advertises
	   nothing — until the name record exists the order is not in any book. */
	engine.publishOrderDetail = function (order) {
		var walletIdentity = engine.getWalletIdentity();
		if (!walletIdentity || !walletIdentity.wif) throw new Error('Open your wallet first');
		var identity = NOSTR.identityFromWif(walletIdentity.wif);
		var ev = NOSTR.createOrderEvent({ order: order, privateKeyHex: identity.privateKeyHex });
		if (!engine.pool) engine.startRelays();
		var relayCount = engine.pool ? engine.pool.pub(ev) : 0;
		engine.ingestOrderDetail(ev, 'self');
		return { eventId: ev.id, nostrPubkey: ev.pubkey, relays: relayCount, event: ev };
	};

	engine.ingestOrderDetail = function (ev, source) {
		var envelope;
		try { envelope = NOSTR.validateOrderEvent(ev); }
		catch (e) {
			/* Silently discard events that don't look like OTC orders at all
			   (other apps may use nearby application kinds). Only log
			   when it superficially matches our envelope but fails auth or
			   integrity checks, because that is meaningful. */
			var isOurFormat = false;
			try {
				var parsed = JSON.parse(ev.content || '{}');
				isOurFormat = (parsed.version === SWAP.PROTOCOL_VERSION && parsed.kind === 'otc-order');
			} catch (pe) { /* unparseable content — definitely not ours */ }
			if (isOurFormat) {
				debugRelay('reject order detail from ' + (source || 'relay') + ': ' + (e.message || e));
			}
			return null;
		}
		/* Keyed by event id: the anchor names one exact event, so there is no
		   newest-wins race to arbitrate here. A superseded order is superseded
		   by a new NAME RECORD pointing at a new event, not by relay ordering. */
		var entry = { order: envelope.order || {}, event: ev, pubkey: ev.pubkey, receivedAt: Math.floor(Date.now() / 1000) };
		engine.relayOrderDetail[ev.id] = entry;
		if (engine.onRelayOrderDetail) engine.onRelayOrderDetail(entry);
		return entry;
	};

	/* Resolve the detail an on-chain record points at.
	   Returns null when the relays have not supplied it, so the caller can fall
	   back to whatever the name record itself carries. */
	engine.orderDetailFromAnchor = function (anchor) {
		if (!anchor || !anchor.nostrEventId) return null;
		var entry = engine.relayOrderDetail[anchor.nostrEventId];
		if (!entry) return null;
		/* The chain record names the key; detail signed by anything else is not
		   the detail this order committed to. */
		if (anchor.nostrPubkey && entry.pubkey !== anchor.nostrPubkey) {
			debugRelay('reject detail ' + anchor.nostrEventId + ': pubkey does not match the on-chain anchor');
			return null;
		}
		return entry.order;
	};

	engine.startOrderbookRelay = function (force) {
		if (!engine.pool) engine.startRelays();
		if (engine._orderSub && !force) return engine._orderSub;
		var filter = { kinds: orderKindFilter(), since: subscriptionSince(ORDER_SUB_LOOKBACK_SECONDS), limit: 500 };
		engine._orderSub = engine.pool.sub(filter, function (ev) { engine.ingestOrderDetail(ev, 'relay'); });
		if (engine.onRelaySubscription) engine.onRelaySubscription(engine._orderSub, filter, 'orderbook');
		return engine._orderSub;
	};

	/* ============ Orderbook scanner ============ */
	engine.orderbook = [];
	/* Only OTC order names in the ROD name DB */
	engine.OTC_NAME_REGEXP = '^d/otc-swap/';
	engine.OTC_NAME_PREFIX = 'd/otc-swap/';

	engine.scanNames = function (names) {
		var d = $.Deferred(), offers = [], reports = [], pending = names.length;
		if (!pending) {
			d.resolve({ offers: [], reports: [] });
			return d;
		}
		names.forEach(function (n) {
			engine.nameLookup(n).then(function (v) {
				var norm = engine.normalizeOffer(n, v);
				if (norm.ok) {
					offers.push(norm.offer);
					reports.push({ name: n, ok: true, detail: 'ok · ' + norm.offer.side + ' ' + norm.offer.give + ' ' + norm.offer.assetChain + ' / ' + norm.offer.want + ' ' + norm.offer.paymentChain });
				} else {
					reports.push({ name: n, ok: false, detail: norm.reason || 'rejected' });
				}
			}, function (err) {
				var msg = (err && err.message) ? err.message : (typeof err === 'string' ? err : 'lookup failed');
				reports.push({ name: n, ok: false, detail: msg });
			}).always(function () {
				if (--pending <= 0) {
					engine.orderbook = offers;
					d.resolve({ offers: offers, reports: reports });
				}
			});
		});
		return d;
	};

	/**
	 * Query ROD name DB for OTC orders: name_scan with regexp ^d/otc-swap/
	 * Paginates until exhausted or maxNames reached.
	 */
	engine.scanOtcOrdersFromDb = function (opts) {
		var d = $.Deferred();
		var options = opts || {};
		var regexp = options.regexp || engine.OTC_NAME_REGEXP;
		var pageSize = options.pageSize || 500;
		var maxNames = options.maxNames || 5000;
		var c = engine.loadConfig();
		if (!$.trim(c.rpcUrl || '')) {
			d.reject('ROD Core RPC is not configured — set it in OTC Settings and run the CORS proxy');
			return d.promise();
		}

		var offers = [];
		var reports = [];
		var start = options.start != null ? options.start : 'd/otc-swap/';
		var collected = 0;
		var seen = {};

		function page(startName) {
			engine.rpc('name_scan', [startName, pageSize, { regexp: regexp }]).then(function (rows) {
				var list = coinjs.isArray(rows) ? rows : [];
				if (!list.length) {
					engine.orderbook = offers;
					d.resolve({ offers: offers, reports: reports, scanned: collected, regexp: regexp });
					return;
				}
				var lastName = '';
				var newInPage = 0;
				for (var i = 0; i < list.length; i++) {
					var row = list[i] || {};
					var n = row.name || row.name_error || '';
					if (!n) continue;
					lastName = n;
					if (seen[n]) continue;
					seen[n] = true;
					newInPage++;
					/* Defence in depth: only d/otc-swap/ names */
					if (!/^d\/otc-swap\//.test(n)) {
						reports.push({ name: n, ok: false, detail: 'skipped (name does not match ^d/otc-swap/)' });
						continue;
					}
					collected++;
					var value = null;
					if (row.value_error) {
						reports.push({ name: n, ok: false, detail: 'value error: ' + row.value_error });
						continue;
					}
					if (typeof row.value === 'string') {
						try { value = JSON.parse(row.value); }
						catch (e) { reports.push({ name: n, ok: false, detail: 'invalid JSON value' }); continue; }
					} else if (row.value && typeof row.value === 'object') {
						value = row.value;
					} else {
						value = engine.extractNameValue(row);
					}
					var norm = engine.normalizeOffer(n, value);
					if (norm.ok) {
						offers.push(norm.offer);
						reports.push({
							name: n,
							ok: true,
							detail: 'ok · ' + norm.offer.side + ' ' + norm.offer.give + ' ' + norm.offer.assetChain + ' / ' + norm.offer.want + ' ' + norm.offer.paymentChain
						});
					} else {
						reports.push({ name: n, ok: false, detail: norm.reason || 'rejected' });
					}
				}
				if (!newInPage || list.length < pageSize || collected >= maxNames || !lastName) {
					engine.orderbook = offers;
					d.resolve({ offers: offers, reports: reports, scanned: collected, regexp: regexp });
					return;
				}
				/* Continue strictly after lastName */
				page(lastName + '\u0000');
			}, function (err) {
				d.reject(err);
			});
		}

		page(start);
		return d.promise();
	};

	/* Apply any persisted API configuration as soon as the engine loads so
	   coinjs network calls use the user-configured endpoints from the start. */
	engine.applyApiConfig(engine.loadConfig());
})();
