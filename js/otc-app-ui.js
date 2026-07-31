/*
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 * Fork-specific OTC swap UI for SpeXex.
 */

$(function () {
	'use strict';
	if (!window.rodOtc || !window.rodOtc.swap) return;
	var SWAP = rodOtc.swap, ENGINE = rodOtc.engine, STORAGE = rodOtc.storage, CHAINS = rodOtc.chains, NOSTR = rodOtc.nostr;
	var $root = $('#otc'); if (!$root.length) return;
	function esc(v) { return $('<span>').text(v == null ? '' : String(v)).html(); }
	function short(id) { return id ? id.slice(0, 12) + '…' : '—'; }
	function ts() { return new Date().toLocaleTimeString(); }
	function rate(rod, alt) { var r = parseFloat(rod), l = parseFloat(alt); return (r > 0 && l > 0) ? (l / r).toFixed(8) : '—'; }
	var cfg = ENGINE.loadConfig();

	/* Only expose chains implemented by every OTC layer. Wallet-only networks
	   must not enter a swap flow merely because they have an explorer driver. */
	function altChainCodes() {
		var codes = [];
		for (var code in SWAP.ALT_CHAIN_FEES) {
			if (SWAP.ALT_CHAIN_FEES.hasOwnProperty(code) &&
				coinjs.networks[code] && CHAINS.definitions[code]) {
				codes.push(code);
			}
		}
		return codes.sort();
	}

	function altChainOptionsHtml() {
		var codes = altChainCodes(), html = [];
		for (var i = 0; i < codes.length; i++) {
			var network = coinjs.networks[codes[i]];
			html.push('<option value="' + esc(codes[i]) + '">' + esc(network.name || codes[i]) + ' (' + esc(codes[i]) + ')</option>');
		}
		return html.join('');
	}

	function altChainSettingsHtml(currentCfg) {
		var codes = altChainCodes(), html = [];
		for (var i = 0; i < codes.length; i++) {
			var code = codes[i];
			var chainCfg = ENGINE.altChainConfig(code, currentCfg);
			var backends = [];
			for (var driver in coinjs.explorer.drivers) {
				if (coinjs.explorer.drivers.hasOwnProperty(driver)) {
					backends.push('<option value="' + esc(driver) + '"' + (chainCfg.apiType === driver ? ' selected' : '') + '>' + esc(driver) + '</option>');
				}
			}
			html.push(
				'<label style="margin-top:8px">' + esc(code) + ' API</label>' +
				'<input id="cfgAltApi_' + esc(code) + '" class="form-control js-alt-api" data-chain="' + esc(code) + '" value="' + esc(chainCfg.apiUrl || '') + '">' +
				'<label style="margin-top:4px;font-weight:normal;font-size:11px">' + esc(code) + ' backend</label>' +
				'<select id="cfgAltType_' + esc(code) + '" class="form-control js-alt-type" data-chain="' + esc(code) + '">' + backends.join('') + '</select>'
			);
		}
		return html.join('');
	}

	/* ============ HTML ============ */
	$root.html([
		'<h2 id="otcTitle">ROD ↔ <span id="otcTitleAlt">' + esc(altChainCodes()[0] || 'LTC') + '</span> OTC Swap</h2>',
		'<div class="otc-rod-warn"><span class="glyphicon glyphicon-info-sign"></span> OTC swaps use <b>ROD</b> for on-chain operations (order publishing, name registration, and settlement transactions). Ensure your ROD RPC wallet has sufficient balance to cover transaction fees.</div>',
		'<div id="otcWarn" class="alert alert-warning" style="display:none"><b>Wallet not loaded.</b> Open your wallet in the <a href="#" onclick="$(\'a[href=#wallet]\').tab(\'show\');return false">Wallet tab</a> first. Your wallet key is used for swap authentication and signing.</div>',
		'<div id="otcWalletOk" class="alert alert-success" style="display:none"></div>',
		'<div id="otcFlash" class="alert hidden"></div>',

		/* Tabs */
		'<ul class="nav nav-pills otc-nav" id="otcNav">',
		'<li class="active"><a data-toggle="tab" href="#otcDash"><span class="glyphicon glyphicon-dashboard"></span> Dashboard</a></li>',
		'<li><a data-toggle="tab" href="#otcNew"><span class="glyphicon glyphicon-plus"></span> New swap</a></li>',
		'<li><a data-toggle="tab" href="#otcActive" id="otcActiveTab"><span class="glyphicon glyphicon-eye-open"></span> Active swap</a></li>',
		'<li><a data-toggle="tab" href="#otcHist"><span class="glyphicon glyphicon-time"></span> History</a></li>',
		'<li><a data-toggle="tab" href="#otcCfg"><span class="glyphicon glyphicon-cog"></span> Settings</a></li>',
		'</ul>',

		'<div class="tab-content" style="margin-top:14px">',

		/* ============ DASHBOARD ============ */
		'<div class="tab-pane active" id="otcDash">',

		/* Orderbook */
		'<div class="otc-panel">',
		'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">',
		'<h4 style="margin:0">ROD Orderbook</h4>',
		'<div class="otc-book-controls">',
		'<select id="otcBookChainFilter" class="form-control input-sm"><option value="">All chains</option></select>',
		'<label class="otc-auto"><input type="checkbox" id="otcBookAutoRefresh"> auto</label>',
		'<small id="otcBookTime" class="text-muted"></small>',
		'<button class="btn btn-default btn-xs" id="otcRefreshBook">Refresh</button>',
		'</div>',
		'</div>',
		'<div class="otc-book-grid">',
		'<div class="otc-book-col">',
		'<div class="otc-book-head otc-book-head-ask"><span>Ask</span><small>sell ROD</small></div>',
		'<table class="table otc-book-tbl"><thead><tr><th>Price</th><th class="otc-num">ROD</th><th class="otc-num">Lots</th></tr></thead><tbody id="otcAsks"></tbody></table>',
		'</div>',
		'<div class="otc-book-mid">',
		'<div class="otc-mid-card">',
		'<div class="otc-mid-label">Current price</div>',
		'<div id="otcMidPrice" class="otc-mid-value">—</div>',
		'<div class="otc-mid-unit" id="otcMidPriceUnit">LTC per ROD</div>',
		'<div class="otc-mid-note" id="otcMidPriceNote"></div>',
		'<div class="otc-mid-sep"></div>',
		'<div class="otc-mid-label">Last settled</div>',
		'<div id="otcLastTraded" class="otc-mid-last">—</div>',
		'</div>',
		'</div>',
		'<div class="otc-book-col">',
		'<div class="otc-book-head otc-book-head-bid"><span>Bid</span><small>buy ROD</small></div>',
		'<table class="table otc-book-tbl"><thead><tr><th>Price</th><th class="otc-num">ROD</th><th class="otc-num">Lots</th></tr></thead><tbody id="otcBids"></tbody></table>',
		'</div>',
		'</div>',
		/* Expanded lots for the selected price. OTC is lot-picking, not
		   matching against a curve, so the amount box drives the ordering. */
		'<div id="otcBookDetail" class="otc-lots" style="display:none">',
		'<div class="otc-lots-head">',
		'<h5 id="otcBookDetailTitle" style="margin:0"></h5>',
		'<div class="otc-lots-filter">',
		'<label for="otcLotAmount">I want</label>',
		'<input type="text" id="otcLotAmount" class="form-control input-sm" placeholder="any" autocomplete="off">',
		'<span class="otc-lots-unit">ROD</span>',
		'<button class="btn btn-default btn-xs" id="otcLotAmountClear">clear</button>',
		'</div>',
		'</div>',
		'<div id="otcLotSummary" class="otc-lots-summary"></div>',
		'<table class="table otc-session-table otc-lots-tbl"><thead><tr><th>Counterparty</th><th class="otc-num">ROD</th><th class="otc-num">Counter</th><th>Settlement</th><th></th></tr></thead><tbody id="otcBookDetailBody"></tbody></table>',
		'</div>',
		/* Own orders: hidden from the takeable book, managed here */
		'<div style="margin-top:14px">',
		'<div style="display:flex;justify-content:space-between;align-items:center">',
		'<h5 style="margin:0">My orders <span class="badge" id="otcMyOrdersCount">0</span></h5>',
		'<small class="text-muted">Your own orders are hidden from the book above</small>',
		'</div>',
		'<table class="table otc-session-table"><thead><tr><th>Order</th><th>Side</th><th>ROD</th><th>Counter</th><th>Status</th><th></th></tr></thead><tbody id="otcMyOrdersBody"></tbody></table>',
		'</div>',
		'<div style="margin-top:10px">',
		'<label style="font-size:12px">Orderbook sources</label>',
		'<p class="text-muted" style="font-size:11px;margin:0 0 6px">Offers come from the ROD name DB only, via <code>name_scan</code> <code>^d/otc-swap/</code>. Each record may anchor a Nostr event id carrying the full order detail; that detail is accepted only when its id and signing key match the anchor written on chain.</p>',
		'<div id="otcScanReport" style="margin-top:6px;font-size:11px;font-family:monospace;max-height:140px;overflow-y:auto"></div>',
		'</div>',
		'</div>',

		/* Connection status + active swaps */
		'<div class="row" style="margin-top:14px">',
		'<div class="col-md-4"><div class="otc-panel">',
		'<h5>Connections</h5>',
		'<div id="otcConnStatus" class="otc-conn-status">',
		'<div class="otc-conn-row"><span class="otc-conn-label">ROD Core RPC</span><span id="otcRpcStatus" class="otc-conn-val text-muted">—</span></div>',
		'<div class="otc-conn-row"><span class="otc-conn-label">Nostr relays</span><span id="otcRelayStatus" class="otc-conn-val text-muted">—</span></div>',
		'</div>',
		'<p style="margin:8px 0 0;font-size:11px;color:#9ec7db">Optional local helper: run <code>tools/rod-rpc-cors-proxy.exe</code>, then point RPC at port 18080. Nostr connects in-page.</p>',
		'</div></div>',
		'<div class="col-md-8"><div class="otc-panel"><h5>Active swaps</h5>',
		'<div class="input-group input-group-sm" style="margin-bottom:8px">',
		'<input id="otcTrackSwapId" class="form-control" placeholder="Paste Swap ID to track incoming negotiation">',
		'<span class="input-group-btn"><button class="btn btn-default" type="button" id="otcTrackSwapBtn">Add by Swap ID</button></span>',
		'</div>',
		'<div id="otcTrackSwapStatus" class="text-muted" style="font-size:11px;margin-bottom:8px"></div>',
		'<div id="otcSwapList"></div></div></div>',
		'</div>',
		'<div class="otc-panel" style="margin-top:12px"><h5>Event log</h5><div id="otcLog" style="max-height:160px;overflow-y:auto;font-size:11px;font-family:monospace"></div></div>',
		'</div>',

		/* ============ NEW SWAP ============ */
		'<div class="tab-pane" id="otcNew">',
		'<div class="otc-panel">',
		'<h4>Create order</h4>',
		'<p class="text-muted" style="font-size:12px;margin-top:0">Post an open <b>order</b> with your terms. To <b>take</b> an existing order and start a swap, use the <b>Dashboard</b> tab.</p>',
		'<div class="row"><div class="col-md-6">',
		'<label>Counter chain</label><select id="nsAltChain" class="form-control">' + altChainOptionsHtml() + '</select>',
		'<p id="nsAltHint" class="text-muted" style="font-size:11px;margin:4px 0 0"></p>',
		'<label>Your role</label><select id="nsRole" class="form-control"><option value="seller">I sell ROD for <span class="js-alt-unit">LTC</span></option><option value="buyer">I buy ROD with <span class="js-alt-unit">LTC</span></option></select>',
		'<label>ROD amount</label><input id="nsRod" class="form-control" value="1000.00000000">',
		'<label><span class="js-alt-unit">LTC</span> amount</label><input id="nsAlt" class="form-control" value="5.00000000">',
		'<label>Release ROD height <small id="nsHeightHint" class="text-muted"></small></label><input id="nsRelease" class="form-control" value="" readonly>',
		'<input id="nsOrderName" type="hidden" value="">',
		'<input id="nsPeer" type="hidden" value="">',
		'<input id="nsPeerXpub" type="hidden" value="">',
		'<input id="nsPeerPayoutAddr" type="hidden" value="">',
		'<div style="margin-top:14px">',
		'<button class="btn btn-default" id="nsCreateOrder" type="button">Create order</button> ',
		'<button class="btn btn-primary" id="nsCreate" type="button" style="display:none">Create &amp; start swap</button>',
		'</div>',
		'<p id="nsModeHint" class="text-muted" style="font-size:11px;margin-top:8px"></p>',
		'<p id="nsPublishStatus" class="text-muted" style="font-size:11px;margin-top:4px"></p>',
		'</div><div class="col-md-6">',
		'<label>Your identity</label><input id="nsMyAddr" class="form-control" readonly>',
		'<label>Your swap xpub</label><input id="nsMyXpub" class="form-control" readonly>',
		'<input id="nsSwapId" type="hidden" value="">',
		'<label>Offer JSON</label><textarea id="nsOffer" class="form-control otc-textarea" readonly style="min-height:140px"></textarea>',
		'</div></div></div></div>',

		/* ============ ACTIVE SWAP ============ */
		'<div class="tab-pane" id="otcActive">',
		'<div class="otc-panel" id="otcActivePanel">',
		'<h4>Active swap detail</h4>',
		'<div id="otcActiveNone" class="text-muted">Select a swap from the Dashboard.</div>',
		'<div id="otcActiveDetail" style="display:none">',
		'<div class="row">',
		'<div class="col-md-6">',
		'<table class="table table-condensed" style="font-size:12px"><tbody id="otcAInfo"></tbody></table>',
		'</div>',
		'<div class="col-md-6">',
		'<h5>Timeline</h5><div id="otcATimeline" style="max-height:200px;overflow-y:auto;font-size:11px"></div>',
		'</div>',
		'</div>',
		'<h5>Execution log</h5>',
		'<div id="otcALog" class="otc-swap-log" style="max-height:250px"></div>',
		'<div id="otcExecution" class="otc-panel" style="margin-top:12px">',
		'<h5>Real swap execution</h5>',
		'<div class="alert alert-info" style="font-size:12px;margin-bottom:8px"><b>Safety:</b> funding is broadcast only after BOTH pre-signed timelocked refunds and BOTH verified adaptor signatures are in place (PREPARED). If the counterparty disappears, the automation broadcasts your refund once its lock height passes.</div>',
		'<div id="otcExecStatus" style="font-size:12px;margin-top:8px"></div>',
		'<div class="btn-toolbar" style="margin-top:10px">',
		'<button class="btn btn-primary btn-sm otcExecBtn" data-action="accept-offer">Accept swap</button> ',
		'<button class="btn btn-success btn-sm otcExecBtn" data-action="claim-alt">Accept: claim <span class="js-alt-unit">LTC</span></button> ',
		'<button class="btn btn-success btn-sm otcExecBtn" data-action="claim-rod">Accept: claim ROD</button> ',
		'<button class="btn btn-warning btn-sm otcExecBtn" data-action="attempt-refund">Attempt refund</button> ',
		'<button class="btn btn-default btn-sm otcExecBtn" data-action="refresh">Refresh confirmations</button>',
		'</div>',
		'</div>',
		'</div>',
		'</div></div>',

		/* ============ HISTORY ============ */
		'<div class="tab-pane" id="otcHist">',
		'<div class="otc-panel otc-hist-panel"><h4>Trade history</h4><table class="table otc-session-table otc-hist-table"><thead><tr><th>Date</th><th>ID</th><th>Role</th><th>ROD</th><th>Counter</th><th>State</th></tr></thead><tbody id="otcHistBody"></tbody></table><button class="btn btn-default btn-xs" id="otcClearHist">Clear</button></div></div>',

		/* ============ SETTINGS ============ */
		'<div class="tab-pane" id="otcCfg">',
		'<div class="row"><div class="col-md-6"><div class="otc-panel">',
		'<h4>Nostr relays</h4>',
		'<textarea id="cfgRelays" class="form-control" rows="3">' + esc((cfg.relays || ENGINE.DEFAULT_RELAYS).join('\n')) + '</textarea>',
		'<button class="btn btn-primary btn-sm" id="cfgSaveApi" style="margin-top:10px">Save relay settings</button>',
		'<p class="text-muted" style="font-size:11px;margin-top:6px"><span class="glyphicon glyphicon-info-sign"></span> API servers have moved to the global <a href="#" onclick="$(\'a[href=#settings]\').tab(\'show\');return false">Settings</a> tab.</p>',
		'</div></div>',
		'<div class="col-md-6"><div class="otc-panel">',
		'<h4>ROD Core RPC <small>(optional local helper)</small></h4>',
		'<p style="color:#9ec7db;font-size:11px">Raw Core has no CORS. Run <code>tools\\rod-rpc-cors-proxy.exe</code>, then point here at the <b>proxy</b> (port <b>18080</b>), not Core 11999. Leave blank for pure offline use.</p>',
		'<pre style="font-size:11px;background:rgba(0,0,0,0.25);padding:8px;border-radius:6px;white-space:pre-wrap">tools\\rod-rpc-cors-proxy.exe\nhttp://USER:PASS@127.0.0.1:18080/wallet/ROD</pre>',
		'<label>URL <small class="text-muted">(host or full URL)</small></label><input id="cfgRpcUrl" class="form-control" value="' + esc(cfg.rpcUrl) + '" placeholder="http://USER:PASS@127.0.0.1:18080/wallet/ROD">',
		'<label>Port <small class="text-muted">(ignored if URL has port)</small></label><input id="cfgRpcPort" class="form-control" value="' + esc(cfg.rpcPort || '18080') + '">',
		'<label>User</label><input id="cfgRpcUser" class="form-control" value="' + esc(cfg.rpcUser) + '">',
		'<label>Password</label><input id="cfgRpcPass" class="form-control" type="password" value="' + esc(cfg.rpcPass) + '">',
		'<label>Wallet <small class="text-muted">(e.g. ROD → /wallet/ROD)</small></label><input id="cfgRpcWallet" class="form-control" value="' + esc(cfg.rpcWallet) + '" placeholder="ROD">',
		'<button class="btn btn-primary btn-sm" id="cfgSaveRpc" style="margin-top:10px">Save RPC settings</button>',
		'<p id="cfgRpcEndpointHint" style="margin-top:8px;font-size:11px;color:#9ec7db"></p>',
		'</div></div></div>',
		'<div class="row" style="margin-top:14px"><div class="col-md-6"><div class="otc-panel">',
		'<h4>Validation</h4><button class="btn btn-default btn-sm" id="cfgRunTests">Run test suite</button> <span id="cfgTestR"></span>',
		'</div></div>',
		'<div class="col-md-6"><div class="otc-panel">',
		'<h4>Backup / restore</h4>',
		'<p class="text-muted" style="font-size:11px">Recovery backups contain active swap state and signed transactions, but never your wallet WIF or local RPC credentials. To resume signing or settlement, reopen the same wallet that created the swap.</p>',
		'<button class="btn btn-default btn-xs" id="cfgExport">Export</button> <button class="btn btn-default btn-xs" id="cfgImport">Import</button>',
		'<textarea id="cfgBackup" class="form-control otc-textarea" style="margin-top:6px"></textarea>',
		'</div></div></div>',
		'</div>',

		'</div>',
		'<style>',
		'.otc-nav{margin-bottom:0;border-bottom:1px solid rgba(126,233,255,0.15)}',
		'.otc-nav>li>a{color:#9ec7db;border-radius:10px 10px 0 0;padding:8px 14px;font-size:13px}',
		'.otc-nav>li.active>a,.otc-nav>li.active>a:hover,.otc-nav>li.active>a:focus{background:rgba(9,199,247,0.12);color:#fff;border:1px solid rgba(126,233,255,0.25);border-bottom-color:transparent}',
		'.otc-nav>li>a:hover{background:rgba(255,255,255,0.04);color:#fff}',
		/* --- Orderbook layout --- */
		'.otc-book-controls{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}',
		'.otc-book-controls select{width:auto!important}',
		'.otc-auto{font-weight:400;font-size:11px;margin:0;color:#9ec7db;display:flex;align-items:center;gap:4px}',
		'.otc-auto input{margin:0}',
		'.otc-book-grid{display:flex;gap:18px;align-items:flex-start;margin-top:12px;flex-wrap:wrap}',
		'.otc-book-col{flex:1 1 260px;min-width:240px}',
		'.otc-book-mid{flex:0 0 200px;display:flex;justify-content:center}',
		'@media (max-width:900px){.otc-book-mid{order:-1;flex:1 1 100%}}',
		'.otc-book-head{display:flex;align-items:baseline;gap:6px;padding-bottom:6px;margin-bottom:2px;border-bottom:1px solid rgba(126,233,255,0.14)}',
		'.otc-book-head span{font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:1.2px}',
		'.otc-book-head small{font-size:10px;color:#7fa6ba}',
		'.otc-book-head-ask span{color:#62e6a6}.otc-book-head-bid span{color:#f1334a}',
		/* Depth reads as a background gradient on the row itself, which frees
		   the column the cumulative figure used to occupy. */
		'.otc-book-tbl{margin-bottom:0;table-layout:fixed;width:100%}',
		'.otc-book-tbl td,.otc-book-tbl th{padding:5px 8px!important;font-size:11px;border-top:0!important}',
		'.otc-book-tbl thead th{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#7fa6ba;border-bottom:0!important;font-weight:600}',
		'.otc-num{text-align:right}',
		'.otc-book-tbl tr.otc-price-row{cursor:pointer;position:relative}',
		'.otc-book-tbl tr.otc-price-row td{position:relative;z-index:1}',
		'.otc-book-tbl tr.otc-price-row .otc-depth{position:absolute;top:0;bottom:0;left:0;z-index:0;border-radius:3px;pointer-events:none}',
		'.otc-book-tbl tr.otc-ask-row .otc-depth{background:linear-gradient(90deg,rgba(98,230,166,0.20),rgba(98,230,166,0.04))}',
		'.otc-book-tbl tr.otc-bid-row .otc-depth{background:linear-gradient(90deg,rgba(241,51,74,0.20),rgba(241,51,74,0.04))}',
		'.otc-book-tbl tr.otc-price-row:hover{background:rgba(255,255,255,0.06)}',
		'.otc-book-tbl tr.otc-price-row.otc-selected{background:rgba(9,199,247,0.14)!important;box-shadow:inset 3px 0 0 #09c7f7}',
		'.otc-book-tbl tr.otc-price-row.otc-selected .otc-price{color:#fff}',
		/* Bootstrap ships .active as a light contextual row colour; never let it
		   apply here or the selected row turns white-on-white. */
		'.otc-book-tbl>tbody>tr.active>td{background-color:transparent!important}',
		'.otc-book-tbl .otc-price{font-variant-numeric:tabular-nums;font-weight:600}',
		'.otc-book-tbl .otc-chaintag{font-size:9px;color:#7fa6ba;margin-left:4px}',
		'.otc-book-empty{color:#7fa6ba;font-size:11px;font-style:italic}',
		/* --- Mid card --- */
		'.otc-mid-card{background:rgba(9,199,247,0.06);border:1px solid rgba(126,233,255,0.18);border-radius:12px;padding:14px 16px;text-align:center;min-width:180px}',
		'.otc-mid-label{font-size:9px;color:#7fa6ba;text-transform:uppercase;letter-spacing:1.2px}',
		'.otc-mid-value{font-size:26px;font-weight:700;color:#fff;margin:4px 0 2px;font-variant-numeric:tabular-nums;line-height:1.1;word-break:break-all}',
		'.otc-mid-unit{font-size:11px;color:#9ec7db}',
		'.otc-mid-note{font-size:10px;color:#7fa6ba;margin-top:3px;min-height:13px}',
		'.otc-mid-sep{height:1px;background:rgba(126,233,255,0.14);margin:10px 0 8px}',
		'.otc-mid-last{font-size:13px;color:#9ec7db;font-variant-numeric:tabular-nums;margin-top:2px}',
		/* --- Settlement clock --- */
		'.otc-clock{display:inline-block;font-size:10px;padding:1px 7px;border-radius:9px;white-space:nowrap;font-weight:600}',
		'.otc-clock-ok{background:rgba(98,230,166,0.14);color:#62e6a6}',
		'.otc-clock-warn{background:rgba(240,173,78,0.16);color:#f0ad4e}',
		'.otc-clock-bad{background:rgba(241,51,74,0.16);color:#ff7183}',
		/* --- Lot picker --- */
		'.otc-lots{margin-top:16px;border-top:1px solid rgba(126,233,255,0.14);padding-top:12px}',
		'.otc-lots-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}',
		'.otc-lots-filter{display:flex;align-items:center;gap:6px;font-size:11px;color:#9ec7db}',
		'.otc-lots-filter input{width:120px;display:inline-block;font-variant-numeric:tabular-nums}',
		'.otc-lots-unit{font-size:11px;color:#7fa6ba}',
		/* Bootstrap form controls default to light-on-white and read as holes
		   punched in the dark panel. */
		'select#otcBookChainFilter.form-control,input#otcLotAmount.form-control{background-color:rgba(255,255,255,0.06)!important;background-image:none;border:1px solid rgba(126,233,255,0.22)!important;color:#e8f6ff!important;box-shadow:none!important;height:28px;padding:2px 8px}',
		'select#otcBookChainFilter.form-control:focus,input#otcLotAmount.form-control:focus{border-color:#09c7f7!important;box-shadow:0 0 0 2px rgba(9,199,247,0.18)!important;color:#fff!important}',
		'#otcLotAmount::placeholder{color:#6b8fa3}',
		'#otcBookChainFilter option{background:#0b2030;color:#e8f6ff}',
		'.otc-lots-summary{font-size:11px;color:#9ec7db;margin-bottom:6px;min-height:16px}',
		'.otc-lots-tbl td{vertical-align:middle!important}',
		'.otc-lot-fit{box-shadow:inset 2px 0 0 #62e6a6}',
		'.otc-lot-unfit{opacity:.42}',
		'.otc-lot-unfit .btn{pointer-events:none}',
		'.otc-swap-card{padding:12px;background:rgba(255,255,255,0.03);border:1px solid rgba(126,233,255,0.12);border-radius:10px;margin-bottom:8px;cursor:pointer}',
		'.otc-swap-card:hover{border-color:rgba(126,233,255,0.35)}',
		'.otc-swap-log{max-height:200px;overflow-y:auto;font-size:11px;font-family:monospace;padding:8px;background:rgba(0,0,0,0.2);border-radius:8px}',
		'.otc-conn-status{font-size:12px}',
		'.otc-conn-row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid rgba(126,233,255,0.08)}',
		'.otc-conn-row:last-child{border-bottom:0}',
		'.otc-conn-label{color:#9ec7db;font-weight:600}',
		'.otc-conn-val{text-align:right}',
		'.otc-conn-ok{color:#62e6a6}',
		'.otc-conn-bad{color:#f1334a}',
		'.otc-conn-warn{color:#f0ad4e}',
		/* --- History table --- */
		'.otc-hist-panel{background:rgba(9,199,247,0.04)}',
		'.otc-hist-table{background:rgba(0,0,0,0.2);border-radius:8px}',
		'.otc-hist-table td,.otc-hist-table th{border-color:rgba(126,233,255,0.10)!important;color:#d1ecf7}',
		'.otc-hist-table thead th{color:#9ec7db;font-weight:600;border-bottom:2px solid rgba(126,233,255,0.18)!important}',
		'.otc-hist-table tr:nth-child(odd){background:rgba(255,255,255,0.03)}',
		'.otc-hist-table tr:nth-child(even){background:rgba(0,0,0,0.1)}',
		/* --- ROD warning banner --- */
		'.otc-rod-warn{background:rgba(240,173,78,0.10);border:1px solid rgba(240,173,78,0.25);border-radius:8px;padding:8px 14px;font-size:12px;color:#f0ad4e;margin-bottom:12px}',
		'</style>'
	].join('\n'));

	/* ============ Helpers ============ */
	function flash(t, m) { $('#otcFlash').removeClass('hidden alert-success alert-danger alert-warning alert-info').addClass('alert-' + t).text(m); }
	var EVENT_LOG_LIMIT = 200;
	function log(m) {
		var $log = $('#otcLog');
		$log.prepend('<div>[' + ts() + '] ' + esc(m) + '</div>');
		var $entries = $log.children();
		if ($entries.length > EVENT_LOG_LIMIT) {
			$entries.slice(EVENT_LOG_LIMIT).remove();
		}
	}
	var walletId = null, swapAcct = null;
	var lastWalletWif = null;
	function checkWallet() {
		walletId = ENGINE.getWalletIdentity();
		if (!walletId) { $('#otcWarn').show(); $('#otcWalletOk').hide(); swapAcct = null; lastWalletWif = null; return false; }
		/* A wallet just appeared (or a different one was opened). Any automation
		   cooldown accumulated while key material was missing describes a
		   condition that no longer applies, so clear it and let the swaps
		   resume immediately instead of serving out a stale penalty. */
		if (walletId.wif && walletId.wif !== lastWalletWif) {
			lastWalletWif = walletId.wif;
			resetAutomationBackoff();
		}
		$('#otcWarn').hide();
		try {
			/* master() returns {privkey:xprv, pubkey:xpub} — not keys_extended */
			var hd = ENGINE.deriveSwapAccount(walletId.wif);
			var xprv = hd && (hd.privkey || (hd.keys_extended && hd.keys_extended.privkey)) || '';
			var xpub = hd && (hd.pubkey || (hd.keys_extended && hd.keys_extended.pubkey)) || '';
			if (!xprv || !xpub) throw new Error('Could not derive swap account from wallet');
			swapAcct = { xprv: xprv, xpub: xpub };
			var npub = '';
			try {
				if (NOSTR && NOSTR.identityFromWif) {
					var nostrIdentity = NOSTR.identityFromWif(walletId.wif);
					npub = nostrIdentity.npub || '';
					walletId.nostrPrivateKey = nostrIdentity.privateKeyHex || '';
				}
			} catch (npubErr) { npub = ''; }
			walletId.npub = npub;
			var okHtml = 'Wallet: <code>' + esc(walletId.address) + '</code>';
			if (npub) {
				okHtml += ' &nbsp;·&nbsp; Nostr: <code title="' + esc(npub) + '">' + esc(npub) + '</code>';
			}
			$('#otcWalletOk').html(okHtml).show();
			$('#nsMyAddr').val(walletId.address);
			$('#nsMyXpub').val(swapAcct.xpub);
			return true;
		} catch (e) {
			swapAcct = null;
			$('#otcWarn').show();
			$('#otcWalletOk').hide();
			return false;
		}
	}
	$('a[data-toggle="tab"][href="#otc"]').on('shown.bs.tab', checkWallet);
	setInterval(function () { if ($('#otc').is(':visible')) checkWallet(); }, 5000);
	checkWallet();

	/* ============ ORDERBOOK ============ */
	var allOffers = [], currentRodHeight = 0;
	/* The economics of an offer ARE the offer. They are read from the ROD name
	   record and never from relay detail, so a relay cannot restate a price,
	   a size, a side or a counter chain even for an order it legitimately
	   carries the detail for. */
	var CHAIN_ONLY_ORDER_FIELDS = {
		give: true, want: true, rodAmount: true, altAmount: true,
		side: true, pair: true, altChain: true, releaseRodHeight: true,
		orderId: true, nostrEventId: true, nostrPubkey: true
	};
	function orderCreatedAt(order) {
		var orderId = String(order && order.orderId || '');
		var match = orderId.match(/(\d{13})$/);
		if (!match) return '';
		var createdAt = new Date(parseInt(match[1], 10));
		return isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleString();
	}
	function isOrderExpired(order, chainHeight) {
		var dueBlock = parseInt(order && order.releaseRodHeight, 10);
		return !!(dueBlock && chainHeight && dueBlock <= chainHeight);
	}

	/* ---- Settlement clock ----
	   releaseRodHeight is not decoration: it is when the counter-leg claim
	   unlocks, and taking an order sets your own ROD refund at
	   (current height + refundRodBlocks). Two numbers follow from that and both
	   matter before committing coin:

	     wait  = release - now          how long funds sit before settlement
	                                    can even begin
	     slack = (now + refundBlocks)   how much room is left between
	             - release              settlement and your refund unlocking

	   Little slack is the dangerous case — the claim window is narrow and a
	   slow confirmation can push settlement past the point where the
	   counterparty could instead refund. The book used to print the raw block
	   delta in grey next to orders that were materially different in risk. */
	function rodBlockSeconds() {
		try { return CHAINS.getPolicy('ROD').blockSeconds || 30; } catch (e) { return 30; }
	}
	function humanDuration(seconds) {
		if (!isFinite(seconds) || seconds <= 0) return 'now';
		if (seconds < 90) return '~' + Math.round(seconds) + 's';
		if (seconds < 5400) return '~' + Math.round(seconds / 60) + 'm';
		if (seconds < 172800) return '~' + Math.round(seconds / 3600) + 'h';
		return '~' + Math.round(seconds / 86400) + 'd';
	}
	function settlementClock(order, chainHeight) {
		var release = parseInt(order && order.releaseRodHeight, 10) || 0;
		if (!release || !chainHeight) return null;
		var cfg = ENGINE.loadConfig() || {};
		var refundBlocks = parseInt(cfg.refundRodBlocks, 10) || 480;
		var secs = rodBlockSeconds();
		var wait = release - chainHeight;
		var slack = (chainHeight + refundBlocks) - release;
		/* Below ~15% of the refund window there is very little room between the
		   claim unlocking and the refund unlocking. */
		var slackRatio = slack / refundBlocks;
		var level = 'ok';
		if (slack <= 0) level = 'invalid';
		else if (slackRatio < 0.15) level = 'tight';
		else if (slackRatio < 0.35) level = 'fair';
		return {
			waitBlocks: wait,
			waitLabel: wait <= 0 ? 'settles immediately' : 'settles in ' + humanDuration(wait * secs),
			slackBlocks: slack,
			slackLabel: humanDuration(slack * secs) + ' of refund slack',
			level: level
		};
	}
	function settlementBadge(clock) {
		if (!clock) return '';
		if (clock.level === 'invalid') {
			return '<span class="otc-clock otc-clock-bad" title="This order\'s release height is at or beyond the refund height a new swap would use — it cannot be settled safely.">unsafe window</span>';
		}
		var cls = clock.level === 'tight' ? 'otc-clock-bad' : (clock.level === 'fair' ? 'otc-clock-warn' : 'otc-clock-ok');
		var title = clock.waitLabel + ' · ' + clock.slackLabel +
			(clock.level === 'tight' ? ' · little room between settlement and your refund unlocking' : '');
		return '<span class="otc-clock ' + cls + '" title="' + esc(title) + '">' + esc(clock.waitLabel) + '</span>';
	}

	/* Everything that identifies "me" as a counterparty, so an order I
	   published can be recognised regardless of which source it arrived from. */
	function myOrderIdentity() {
		var identity = { address: '', xpub: '' };
		try {
			/* Read only — a render helper must not quietly reassign the shared
			   wallet handle that checkWallet() owns. */
			var w = walletId || (ENGINE.getWalletIdentity && ENGINE.getWalletIdentity());
			if (w) identity.address = w.address || '';
			if (swapAcct && swapAcct.xpub) identity.xpub = swapAcct.xpub;
		} catch (e) {}
		return identity;
	}

	/* Taking your own offer is already refused at swap creation, where the
	   counterparty xpub is required to differ from the local swap xpub — so
	   this is not a fund-safety guard. It exists so the book does not advertise
	   orders that could only ever produce that error: own orders move out of
	   the takeable list into the "My orders" panel instead. Orders are bound to
	   an identity (the ROD address derived from the swap xpub), so both are
	   matched. */
	function isOwnOffer(offer, identity) {
		if (!offer || !identity) return false;
		if (identity.xpub && (offer.sellerSwapXpub === identity.xpub || offer.buyerSwapXpub === identity.xpub)) return true;
		if (identity.address && (offer.seller === identity.address || offer.buyer === identity.address)) return true;
		return false;
	}

	/* Own orders are hidden from the takeable book, so they need their own
	   view — otherwise a user cannot tell whether their order was published.
	   Sourced from the name-DB scan, since a name record is what makes an
	   order exist. */
	function renderMyOrders(ownOffers, chainHeight) {
		if (!ownOffers.length) {
			$('#otcMyOrdersBody').html('<tr><td colspan="6" class="text-muted" style="font-size:11px">You have no published orders. Create one in <b>New swap / order</b>.</td></tr>');
			$('#otcMyOrdersCount').text('0');
			return;
		}
		var activeOwn = ownOffers.filter(function (o) { return !o._isExpired; });
		$('#otcMyOrdersCount').text(String(activeOwn.length));
		/* Show only the last 10 orders (most recent first). Orders are scanned
		   by name, so sort by creation timestamp descending. */
		var displayOwn = ownOffers.slice().sort(function (a, b) {
			var at = a._createdAt || '', bt = b._createdAt || '';
			return bt > at ? 1 : (bt < at ? -1 : 0);
		}).slice(0, 10);
		$('#otcMyOrdersBody').html(displayOwn.map(function (o) {
			var status = o._isExpired
				? '<span class="label label-warning">expired</span>'
				: '<span class="label label-success">live</span>';
			var blocksLeft = (o._dueBlock && chainHeight) ? (o._dueBlock - chainHeight) : null;
			return '<tr><td><code style="font-size:10px">' + esc(short(o._name || o.orderId || '—')) + '</code></td>' +
				'<td>' + esc(o.side || '—') + '</td>' +
				'<td>' + esc(o.give || o.rodAmount || '—') + ' ROD</td>' +
				'<td>' + esc(o.want || o.altAmount || '—') + ' ' + esc(o.altChain || SWAP.DEFAULT_ALT_CHAIN) + '</td>' +
				'<td>' + status + (blocksLeft != null && blocksLeft > 0 ? ' <span class="text-muted" style="font-size:10px">' + esc(blocksLeft) + ' blk left</span>' : '') + '</td>' +
				'<td></td></tr>';
		}).join(''));
	}

	function refreshBook() {
		$('#otcBookTime').text('Scanning ROD name DB…');

		var scanPromise = ENGINE.scanOtcOrdersFromDb({ regexp: ENGINE.OTC_NAME_REGEXP || '^d/otc-swap/' })
			.then(null, function (scanError) {
				return $.Deferred().resolve({ offers: [], reports: [], _scanError: errorString(scanError) }).promise();
			});

		$.when(scanPromise, ENGINE.getRodHeight().then(null, function () { return $.Deferred().resolve(0).promise(); }))
			.then(function (result, height) {
			var scanResult = result && result.offers ? result : (coinjs.isArray(result) ? result[0] : result);
			var chainHeight = parseInt(height, 10) || 0;
			var offers = (scanResult && scanResult.offers) ? scanResult.offers : [];
			var reports = (scanResult && scanResult.reports) ? scanResult.reports : [];

			/* Hydrate each on-chain record from the relay event it names.
			   Two rules, both deliberate:

			   1. The TRADABLE TERMS are the offer, so they come from the chain
			      and nothing else. price, size, side, pair and counter chain are
			      never taken from, nor overwritten by, relay detail — an order
			      whose economics lived off-chain would not really be listed in
			      the name DB at all. (normalizeOffer already rejects a record
			      missing give/want, so an anchor-only record is refused before
			      it reaches this point; that is the intended behaviour, not an
			      oversight.) Relay detail supplies ancillary fields only.
			   2. Anything the record states itself wins, so detail can only
			      fill gaps, and it is accepted only when the event id and
			      signing key match the anchor written on chain. */
			var hydrated = 0, anchored = 0, missingDetail = 0;
			offers.forEach(function (offer) {
				if (!offer.nostrEventId) return;
				anchored++;
				var detail = ENGINE.orderDetailFromAnchor
					? ENGINE.orderDetailFromAnchor({ nostrEventId: offer.nostrEventId, nostrPubkey: offer.nostrPubkey })
					: null;
				if (!detail) { missingDetail++; offer._detailMissing = true; return; }
				var filled = false;
				for (var key in detail) {
					if (!Object.prototype.hasOwnProperty.call(detail, key)) continue;
					if (CHAIN_ONLY_ORDER_FIELDS[key]) continue;
					if (offer[key] == null || offer[key] === '') { offer[key] = detail[key]; filled = true; }
				}
				offer._detailHydrated = true;
				if (filled) hydrated++;
			});

			var activeOffers = [];
			var expiredCount = 0;
			currentRodHeight = chainHeight;
			offers.forEach(function (offer) {
				offer._createdAt = orderCreatedAt(offer);
				offer._dueBlock = parseInt(offer.releaseRodHeight, 10) || 0;
				offer._isExpired = isOrderExpired(offer, chainHeight);
				if (offer._isExpired) {
					expiredCount++;
					return;
				}
				activeOffers.push(offer);
			});
			/* Move our own orders out of the takeable book — creation would
			   reject them anyway — and into the My orders panel. */
			var mine = myOrderIdentity();
			var selfCount = 0;
			var ownOffers = offers.filter(function (o) { return isOwnOffer(o, mine); });
			activeOffers = activeOffers.filter(function (o) {
				if (isOwnOffer(o, mine)) { selfCount++; return false; }
				return true;
			});
			/* Chain filter */
			var chainFilter = $('#otcBookChainFilter').val() || '';
			if (chainFilter) activeOffers = activeOffers.filter(function (o) { return (o.altChain || SWAP.DEFAULT_ALT_CHAIN) === chainFilter; });
			allOffers = activeOffers;
			renderMyOrders(ownOffers, chainHeight);
			/* Group by price for ask/bid */
			var asks = {}, bids = {};
			activeOffers.forEach(function (o) {
				var rod = parseFloat(o.give || o.rodAmount || 0), alt = parseFloat(o.want || o.altAmount || 0);
				if (rod <= 0 || alt <= 0) return;
				/* Key on the COUNTER CHAIN as well as the price. "5.0" DOGE per
				   ROD and "5.0" LTC per ROD are unrelated prices for unrelated
				   assets; merging them would sum their volumes into one row and
				   let a user take a swap in an asset they did not choose. */
				var chain = o.altChain || SWAP.DEFAULT_ALT_CHAIN;
				var price = (alt / rod).toFixed(8);
				var key = chain + '@' + price;
				var side = (o.side === 'buy') ? bids : asks;
				if (!side[key]) side[key] = { vol: 0, offers: [], price: price, chain: chain };
				side[key].vol += rod;
				side[key].offers.push(o);
			});
			renderBookSide('#otcAsks', asks, 'ask');
			renderBookSide('#otcBids', bids, 'bid');
			/* Mid price is PER CHAIN. Averaging a DOGE ask against an LTC bid
			   produces a number that describes no tradable market at all — the
			   two legs are unrelated assets. Quote the chain the user is
			   actually looking at and label it. */
			var quoteChain = $('#otcBookChainFilter').val() || selectedAltChain();
			var priceList = function (book) {
				var out = [];
				for (var k in book) {
					if (!book.hasOwnProperty(k)) continue;
					if (book[k].chain !== quoteChain) continue;
					out.push(Number(book[k].price));
				}
				return out;
			};
			var askPrices = priceList(asks).sort(function (x, y) { return x - y; });
			var bidPrices = priceList(bids).sort(function (x, y) { return y - x; });
			var mid = '—', midNote = '';
			if (askPrices.length && bidPrices.length) {
				mid = ((askPrices[0] + bidPrices[0]) / 2).toFixed(8);
				midNote = 'mid of best bid/ask';
			} else if (askPrices.length) {
				mid = askPrices[0].toFixed(8);
				midNote = 'best ask only — no bids';
			} else if (bidPrices.length) {
				mid = bidPrices[0].toFixed(8);
				midNote = 'best bid only — no asks';
			} else {
				midNote = 'no ' + quoteChain + ' orders';
			}
			$('#otcMidPrice').text(mid);
			$('#otcMidPriceNote').text(midNote);
			$('#otcMidPriceUnit').text(quoteChain + ' per ROD');
			renderLastTraded();
			var scanned = (scanResult && scanResult.scanned != null) ? scanResult.scanned : reports.length;
			$('#otcBookTime').text(
				activeOffers.length + ' active offers' +
				(selfCount ? ' · ' + selfCount + ' own hidden' : '') +
				(expiredCount ? ' · ' + expiredCount + ' expired filtered' : '') +
				' · h' + chainHeight + ' · ' + ts()
			);
			/* Re-render the open lot panel rather than collapsing it: the book
			   refreshes on a timer and on relay events, and closing the panel
			   under the user mid-decision loses their place. */
			if (selectedPriceRow) {
				var $sel = $('.otc-price-row').filter(function () {
					return String($(this).data('price')) === selectedPriceRow.price &&
						String($(this).data('chain')) === selectedPriceRow.chain &&
						String($(this).data('side')) === selectedPriceRow.side;
				});
				if ($sel.length) {
					$sel.addClass('otc-selected');
					renderLotDetail();
				} else {
					/* The row is gone — filtered out, taken, or expired. Leaving
					   its lot panel open would invite a Take on an offer no
					   longer in the book. */
					selectedPriceRow = null;
					$('#otcBookDetail').hide();
				}
			} else {
				$('#otcBookDetail').hide();
			}

			var sourceLines = [];
			if (scanResult && scanResult._scanError) {
				sourceLines.push('<div style="color:#f1334a">ROD name DB scan failed: ' + esc(scanResult._scanError) + ' — is ROD Core RPC / proxy connected?</div>');
			} else {
				sourceLines.push('<div class="text-muted">regexp <code>^d/otc-swap/</code> · ' + esc(scanned) + ' name(s) · block <code>' + esc(chainHeight) + '</code> · expired filtered <code>' + esc(expiredCount) + '</code></div>');
			}
			/* Detail transport is a subordinate fact about orders the chain
			   already listed, never a source of orders — report it as such. */
			if (anchored) {
				sourceLines.push('<div><span class="label label-info">detail</span> ' + esc(anchored) +
					' order(s) anchor Nostr detail · ' + esc(hydrated) + ' hydrated' +
					(missingDetail ? ' · <span style="color:#f0ad4e">' + esc(missingDetail) + ' awaiting relay detail</span>' : '') + '</div>');
			}
			var badReports = reports.filter(function (report) { return !report.ok; });
			if (badReports.length) {
				/* Show only a count of rejected names, not the exact offers —
				   exposing the full details can leak counterparty information. */
				sourceLines.push('<div class="text-muted" style="margin-top:4px">Rejected names: <b>' + esc(badReports.length) + '</b> name(s) failed validation</div>');
			}
			$('#otcScanReport').html(sourceLines.join(''));
		});
	}
	/* `grouped` is keyed "<CHAIN>@<price>"; each entry carries its own price and
	   chain so rows stay per-asset — summing ROD depth across different counter
	   assets would be meaningless.

	   Depth is drawn as a background bar scaled to the largest row rather than
	   spent on a cumulative column. In a book this thin the running total told
	   the reader almost nothing, while relative size is legible at a glance and
	   the freed column now carries the lot count, which is what a taker
	   actually chooses between. */
	function renderBookSide(sel, grouped, side) {
		var entries = [];
		for (var key in grouped) {
			if (grouped.hasOwnProperty(key)) entries.push(grouped[key]);
		}
		entries.sort(function (a, b) {
			if (a.chain !== b.chain) return a.chain < b.chain ? -1 : 1;
			return side === 'ask' ? (a.price - b.price) : (b.price - a.price);
		});
		var maxVol = 0;
		entries.forEach(function (g) { if (g.vol > maxVol) maxVol = g.vol; });
		var rows = entries.map(function (g) {
			var pct = maxVol > 0 ? Math.max(4, Math.round((g.vol / maxVol) * 100)) : 0;
			return '<tr class="otc-price-row otc-' + side + '-row" data-price="' + esc(g.price) + '" data-chain="' + esc(g.chain) + '" data-side="' + side + '">' +
				'<td><span class="otc-depth" style="width:' + pct + '%"></span>' +
				'<span class="otc-price">' + esc(g.price) + '</span><span class="otc-chaintag">' + esc(g.chain) + '</span></td>' +
				'<td class="otc-num">' + g.vol.toFixed(2) + '</td>' +
				'<td class="otc-num">' + g.offers.length + '</td></tr>';
		});
		$(sel).html(rows.join('') ||
			'<tr><td colspan="3" class="otc-book-empty">No ' + (side === 'ask' ? 'asks' : 'bids') + ' — publish one to open this side.</td></tr>');
	}

	/* Last settled price, taken from this wallet's own completed swaps. The
	   book otherwise has no reference point at all: a price is only meaningful
	   against something that actually traded. */
	function renderLastTraded() {
		var quoteChain = $('#otcBookChainFilter').val() || selectedAltChain();
		var history = [];
		try { history = ENGINE.getHistory() || []; } catch (e) { history = []; }
		for (var i = 0; i < history.length; i++) {
			var h = history[i];
			if (!h || h.state !== 'COMPLETE') continue;
			var chain = h.altChain || (h.pair ? String(h.pair).split('/')[1] : '') || SWAP.DEFAULT_ALT_CHAIN;
			if (chain !== quoteChain) continue;
			var rod = parseFloat(h.rodAmount || 0), alt = parseFloat(h.altAmount || h.ltcAmount || 0);
			if (!(rod > 0 && alt > 0)) continue;
			$('#otcLastTraded').html(esc((alt / rod).toFixed(8)) + ' <span style="font-size:10px;color:#7fa6ba">' + esc(quoteChain) + '</span>');
			return;
		}
		$('#otcLastTraded').html('<span style="font-size:11px;color:#7fa6ba">no ' + esc(quoteChain) + ' swaps yet</span>');
	}
	$('#otcRefreshBook').on('click', refreshBook);
	/* Auto-load orderbook when OTC tab is opened */
	$('a[data-toggle="tab"][href="#otc"]').on('shown.bs.tab', function () {
		refreshBook();
	});
	/* Also refresh when Dashboard sub-tab is shown */
	$(document).on('shown.bs.tab', 'a[href="#otcDash"]', function () {
		refreshBook();
	});
	setTimeout(function () {
		if ($('#otc').hasClass('active') || $('#otcDash').hasClass('active')) refreshBook();
	}, 800);

	/* Populate the chain filter from the chains this build can actually settle,
	   so the book can never offer a filter for an unsupported asset. */
	(function populateChainFilter() {
		var codes = [];
		for (var code in CHAINS.definitions) {
			if (Object.prototype.hasOwnProperty.call(CHAINS.definitions, code) && code !== 'ROD') codes.push(code);
		}
		codes.sort();
		var $sel = $('#otcBookChainFilter');
		codes.forEach(function (c) { $sel.append('<option value="' + esc(c) + '">' + esc(c) + '</option>'); });
	})();
	$(document).on('change', '#otcBookChainFilter', refreshBook);

	/* Relay orders arrive asynchronously; without a live subscription the book
	   only changed when the user pressed Refresh. Subscribe once and re-render
	   on arrival, throttled so a burst of events cannot thrash the DOM. */
	var bookRenderTimer = null;
	function scheduleBookRender() {
		if (bookRenderTimer) return;
		bookRenderTimer = setTimeout(function () { bookRenderTimer = null; refreshBook(); }, 1200);
	}
	try {
		ENGINE.onRelayOrderDetail = function () { scheduleBookRender(); };
		ENGINE.startOrderbookRelay();
	} catch (orderSubError) {
		log('Orderbook relay subscription deferred: ' + (orderSubError.message || orderSubError));
	}
	/* Periodic refresh keeps ages and expiries honest even with no new events. */
	setInterval(function () {
		if (!$('#otcBookAutoRefresh').is(':checked')) return;
		if ($('#otc').hasClass('active') || $('#otcDash').hasClass('active')) refreshBook();
	}, 30000);


	/* ---- Lot picker ----
	   OTC is lot-picking, not matching against a curve: orders at one price are
	   accumulated into a single book row and the taker chooses the individual
	   lot whose size suits them. The amount box drives that choice directly —
	   lots that can serve the requested quantity sort first and are marked,
	   lots that cannot are dimmed and their Take action is inert. Sorting is
	   smallest-sufficient-first, because over-filling an OTC lot means
	   committing more coin than intended. */
	var selectedPriceRow = null;

	function renderLotDetail() {
		if (!selectedPriceRow) return;
		var price = selectedPriceRow.price, side = selectedPriceRow.side, chainCode = selectedPriceRow.chain;
		var matching = allOffers.filter(function (o) {
			var rod = parseFloat(o.give || o.rodAmount || 0), alt = parseFloat(o.want || o.altAmount || 0);
			if (!(rod > 0 && alt > 0)) return false;
			if ((o.altChain || SWAP.DEFAULT_ALT_CHAIN) !== chainCode) return false;
			return (alt / rod).toFixed(8) === price;
		});

		var wanted = parseFloat($('#otcLotAmount').val());
		var hasWanted = isFinite(wanted) && wanted > 0;
		matching.forEach(function (o) { o._rodSize = parseFloat(o.give || o.rodAmount || 0); });
		matching.sort(function (a, b) {
			if (hasWanted) {
				var aFit = a._rodSize >= wanted, bFit = b._rodSize >= wanted;
				if (aFit !== bFit) return aFit ? -1 : 1;          /* fitting lots first */
				if (aFit && bFit) return a._rodSize - b._rodSize;  /* smallest sufficient */
				return b._rodSize - a._rodSize;                    /* else largest first */
			}
			return b._rodSize - a._rodSize;
		});

		$('#otcBookDetailTitle').text((side === 'ask' ? 'Sell' : 'Buy') + ' lots at ' + price + ' ' + chainCode + ' per ROD');

		var actionable = function (o) { return !!(o.sellerSwapXpub || o.buyerSwapXpub); };
		var fitting = (hasWanted ? matching.filter(function (o) { return o._rodSize >= wanted; }) : matching.slice())
			.filter(actionable);
		var totalRod = matching.reduce(function (sum, o) { return sum + o._rodSize; }, 0);
		if (hasWanted) {
			$('#otcLotSummary').html(fitting.length
				? esc(fitting.length) + ' of ' + esc(matching.length) + ' lot(s) can fill ' + esc(wanted) + ' ROD · smallest sufficient is <b>' + esc(fitting[0]._rodSize) + ' ROD</b> (costs ' + esc((fitting[0]._rodSize * parseFloat(price)).toFixed(8)) + ' ' + esc(chainCode) + ')'
				: '<span style="color:#f0ad4e">No single lot covers ' + esc(wanted) + ' ROD. Largest here is ' + esc(matching.length ? matching[0]._rodSize : 0) + ' ROD — OTC lots are taken whole.</span>');
		} else {
			$('#otcLotSummary').html(esc(matching.length) + ' lot(s) · ' + esc(totalRod.toFixed(2)) + ' ROD total at this price');
		}

		$('#otcBookDetailBody').html(matching.map(function (o) {
			var fits = !hasWanted || o._rodSize >= wanted;
			/* An order can be legitimately listed — it is in the name DB — and
			   still not be actionable yet. Taking one needs the counterparty
			   swap xpub; if the record left that to relay detail that has not
			   arrived, the take would fail deep in the create path with
			   "Take an order on the Dashboard first", which describes nothing
			   the user did wrong. Say the real reason and disable the action. */
			var takeXpub = o.sellerSwapXpub || o.buyerSwapXpub || '';
			var blockedReason = '';
			if (!takeXpub) {
				blockedReason = o._detailMissing
					? 'waiting for the order detail this record points at'
					: 'this record carries no counterparty swap key';
			}
			var takeable = fits && !blockedReason;
			/* Every order here comes from the name DB. What varies is whether its
			   detail came in the record itself or from the anchored relay event. */
			var detailBadge = '';
			if (o._detailHydrated) detailBadge = ' <span class="label label-info" title="Detail resolved from the Nostr event this record anchors">detail</span>';
			else if (o._detailMissing) detailBadge = ' <span class="label label-warning" title="The record anchors relay detail that has not arrived yet">detail pending</span>';

			var clock = settlementClock(o, currentRodHeight);
			var counterparty = o.seller || o.buyer || o._name || '—';
			var xpub = takeXpub;
			var created = o._createdAt ? '<div class="text-muted" style="font-size:10px">Created ' + esc(o._createdAt) + '</div>' : '';

			return '<tr class="' + (takeable ? 'otc-lot-fit' : 'otc-lot-unfit') + '">' +
				'<td><div><code style="font-size:10px">' + esc(short(counterparty)) + '</code>' + detailBadge + '</div>' +
				created +
				(xpub ? '<div class="text-muted" style="font-size:10px">xpub <code style="font-size:10px">' + esc(short(xpub)) + '</code></div>' : '') + '</td>' +
				'<td class="otc-num"><b>' + esc(o.give || o.rodAmount) + '</b></td>' +
				'<td class="otc-num">' + esc(o.want || o.altAmount) + ' <span style="font-size:10px;color:#7fa6ba">' + esc(o.altChain || SWAP.DEFAULT_ALT_CHAIN) + '</span></td>' +
				'<td>' + (clock
					? settlementBadge(clock) + '<div class="text-muted" style="font-size:10px;margin-top:2px">block ' + esc(o._dueBlock) + ' · ' + esc(clock.slackLabel) + '</div>'
					: '<span class="otc-clock otc-clock-warn" title="This record states no release height, so there is no settlement window to check.">no window</span>') +
				(blockedReason ? '<div style="font-size:10px;color:#f0ad4e;margin-top:2px">Not takeable — ' + esc(blockedReason) + '</div>' : '') + '</td>' +
				'<td><button class="btn btn-xs btn-primary otcTakeOffer"' + (takeable ? '' : ' disabled') +
					' data-rod="' + esc(o.give || o.rodAmount) + '" data-alt="' + esc(o.want || o.altAmount) +
					'" data-chain="' + esc(o.altChain || SWAP.DEFAULT_ALT_CHAIN) + '" data-peer="' + esc(o.seller || o.buyer || '') +
					'" data-xpub="' + esc(xpub) + '" data-release="' + esc(o.releaseRodHeight || '') +
					'" data-peer-payout="' + esc(o.sellerAltPayoutAddress || o.buyerRodPayoutAddress || '') +
					'" data-side="' + esc(side) + '">Take</button></td></tr>';
		}).join(''));
		$('#otcBookDetail').show();
	}

	$(document).on('click', '.otc-price-row', function () {
		$('.otc-price-row').removeClass('otc-selected'); $(this).addClass('otc-selected');
		selectedPriceRow = {
			price: String($(this).data('price')),
			side: $(this).data('side'),
			chain: String($(this).data('chain') || SWAP.DEFAULT_ALT_CHAIN)
		};
		renderLotDetail();
	});
	$(document).on('input', '#otcLotAmount', renderLotDetail);
	$(document).on('click', '#otcLotAmountClear', function () { $('#otcLotAmount').val(''); renderLotDetail(); });

	/* Retitle every alt-chain-dependent label when the counter chain changes. */
	function refreshAltChainLabels() {
		var code = selectedAltChain();
		$('.js-alt-unit').text(code);
		$('#nsAltHint').text(coinjs.networks[code] ? (coinjs.networks[code].name + ' · ' + (CHAINS.supportsSegwit(code) ? 'SegWit available' : 'legacy P2SH only, no SegWit')) : '');
		/* Update the OTC Swap title to reflect current pair */
		$('#otcTitleAlt').text(code);
	}
	$(document).on('change', '#nsAltChain', refreshAltChainLabels);
	/* Chain filter also updates the title to reflect the filtered pair */
	$(document).on('change', '#otcBookChainFilter', function () {
		var chain = $(this).val();
		$('#otcTitleAlt').text(chain || selectedAltChain());
	});

	/* Take offer → fill counterparty fields and immediately start the swap */
	var nsPrefillFromOrder = false;
	/* Taking an offer only CREATES a local session — nothing is signed or
	   broadcast here. The commit gate is the "Accept swap" button, which is
	   where both peers agree terms before any funding is planned, so an extra
	   confirmation in front of this would just be a second click on the same
	   decision. */
	$(document).on('click', '.otcTakeOffer', function () {
		startTakeOffer($(this));
	});

	function startTakeOffer($b) {
		nsPrefillFromOrder = true;
		/* Set the counter chain before anything else: fees, dust limits, refund
		   block counts and the payout address all derive from it. */
		var offerChain = String($b.data('chain') || SWAP.DEFAULT_ALT_CHAIN);
		if ($('#nsAltChain option[value="' + offerChain + '"]').length) {
			$('#nsAltChain').val(offerChain);
			refreshAltChainLabels();
		}
		$('#nsRod').val($b.data('rod'));
		$('#nsAlt').val($b.data('alt'));
		$('#nsPeer').val($b.data('peer') || '');
		$('#nsPeerXpub').val($b.data('xpub') || '');
		/* Peer payout address: use the chain-specific payout from the
		   order if available, otherwise fall back to the peer's ROD
		   identity address. */
		$('#nsPeerPayoutAddr').val($b.data('peer-payout') || $b.data('peer') || '');
		if ($b.data('release')) $('#nsRelease').val($b.data('release'));
		/* Taking an ask (sell) → you are buyer (buyer); taking a bid → you are seller (seller) */
		$('#nsRole').val($b.data('side') === 'bid' ? 'seller' : 'buyer');
		updateNsModeHint();
		/* Confirmed by the user in the modal above, so start the swap. */
		$('#nsCreate').click();
	}

	/* ============ CONNECTIONS (RPC + Nostr) ============ */
	function setConnVal(sel, cls, text) {
		$(sel).removeClass('text-muted otc-conn-ok otc-conn-bad otc-conn-warn').addClass(cls).text(text);
	}
	function refreshRelayStatus() {
		if (!ENGINE.pool) {
			setConnVal('#otcRelayStatus', 'text-muted', 'Not started');
			return;
		}
		var n = ENGINE.pool.count();
		var total = ENGINE.pool.total();
		if (n > 0) setConnVal('#otcRelayStatus', 'otc-conn-ok', n + ' / ' + total + ' connected');
		else setConnVal('#otcRelayStatus', 'otc-conn-warn', 'Connecting… (0 / ' + total + ')');
	}
	function refreshRpcStatus() {
		ENGINE.checkRpcStatus().then(function (st) {
			if (!st.configured) setConnVal('#otcRpcStatus', 'text-muted', 'Not configured');
			else if (st.online) setConnVal('#otcRpcStatus', 'otc-conn-ok', 'Connected' + (st.height != null ? ' · h' + st.height : ''));
			else setConnVal('#otcRpcStatus', 'otc-conn-bad', st.message || 'Offline');
		});
	}
	function updateRpcEndpointHint() {
		var draft = {
			rpcUrl: $.trim($('#cfgRpcUrl').val()),
			rpcPort: $.trim($('#cfgRpcPort').val()) || '11999',
			rpcUser: $.trim($('#cfgRpcUser').val()),
			rpcPass: $('#cfgRpcPass').val(),
			rpcWallet: $.trim($('#cfgRpcWallet').val())
		};
		var ep = draft.rpcUrl ? ENGINE.buildRpcEndpoint(draft) : null;
		if (!ep) {
			$('#cfgRpcEndpointHint').text('Resolved endpoint: (not set)');
			return;
		}
		$('#cfgRpcEndpointHint').text('Resolved endpoint: ' + ep.url + (ep.user ? '  ·  auth as ' + ep.user : '  ·  no auth'));
	}
	$('#cfgRpcUrl,#cfgRpcPort,#cfgRpcUser,#cfgRpcPass,#cfgRpcWallet').on('input change', updateRpcEndpointHint);
	updateRpcEndpointHint();
	function refreshConnStatus() {
		refreshRelayStatus();
		refreshRpcStatus();
	}
	function startNostr(restart) {
		if (restart) {
			ENGINE.restartRelays();
		} else {
			ENGINE.startRelays();
		}
		if (ENGINE.pool) {
			ENGINE.pool.onStatus = function (t, u) {
				log((t === '+' ? 'relay up' : 'relay down') + ' ' + u);
				refreshRelayStatus();
			};
			ENGINE.pool.onNotice = function (message, relayUrl) {
				var kind = message && message[0] ? message[0] : 'RELAY';
				var detail = '';
				if (kind === 'OK') detail = (message[2] ? 'accepted' : 'rejected') + ' ' + short(message[1]) + (message[3] ? ' · ' + message[3] : '');
				else if (kind === 'LOCAL_FLUSH') detail = 'replayed ' + message[1] + ' queued OTC event(s)';
				else detail = message && message.length > 1 ? message.slice(1).join(' · ') : '';
				log(kind + ' ' + relayUrl + (detail ? ' · ' + detail : ''));
			};
		}
		ENGINE.onRelayPublish = function (eventObject, relayCount) {
			var envelope = {};
			try { envelope = JSON.parse(eventObject.content || '{}'); } catch (error) {}
			log('→ ' + (envelope.type || 'event') + ' ' + short(envelope.swapId || '') + ' kind ' + eventObject.kind + ' id ' + short(eventObject.id || '') + ' sig=' + (!!eventObject.sig) + ' sent to ' + relayCount + ' relay(s)');
			if (!relayCount) flash('warning', 'Nostr publish had 0 connected relays; counterparty cannot discover this swap yet.');
		};
		ENGINE.onRelaySubscription = function (subId, filter, label) {
			log('sub ' + label + ' ' + subId + ' ' + JSON.stringify(filter));
		};
		ENGINE.onRelayEventDebug = function (message) {
			log('debug ' + message);
		};
		ENGINE.startListening(!!restart);
		ENGINE.onSwapMessage = function (env, eventObject) {
			if (!shouldProcessRelayEvent(env)) return;
			log('← ' + env.type + ' ' + short(env.swapId));
			autoProcess(env, eventObject);
			refreshSwaps();
		};
		refreshRelayStatus();
		setTimeout(refreshRelayStatus, 1500);
		setTimeout(refreshRelayStatus, 4000);
	}

	/* ============ DASHBOARD SWAP LIST ============ */
	function refreshSwaps() {
		var all = ENGINE.loadLive(), ids = Object.keys(all);
		if (!ids.length) { $('#otcSwapList').html('<div class="text-muted" style="font-size:12px">No active swaps.</div>'); return; }
		$('#otcSwapList').html(ids.map(function (id) {
			var s = all[id], cls = s.state === 'COMPLETE' ? 'success' : 'info';
			return '<div class="otc-swap-card" data-id="' + esc(id) + '">' +
				'<span class="label label-' + cls + '">' + esc(s.state) + '</span> ' +
				'<code>' + esc(short(id)) + '</code> · ' + esc(s.role === 'seller' ? 'Seller' : 'Buyer') +
				' · ' + esc(s.terms.rodAmount) + ' ROD / ' + esc(s.terms.altAmount) + ' ' + esc(altChainOf(s)) +
				' <button class="btn btn-xs btn-default otcRmSwap pull-right" data-id="' + esc(id) + '">×</button></div>';
		}).join(''));
	}
	$(document).on('click', '.otc-swap-card', function (e) {
		if ($(e.target).hasClass('otcRmSwap')) return;
		showActiveSwap($(this).data('id'));
	});
	$(document).on('click', '.otcRmSwap', function (e) {
		e.stopPropagation(); ENGINE.removeLive($(this).data('id')); refreshSwaps();
	});
	$('#otcTrackSwapBtn').on('click', function () {
		var swapId = $.trim($('#otcTrackSwapId').val()).toLowerCase();
		try {
			if (!checkWallet()) throw new Error('Open your wallet before tracking a swap');
			if (ENGINE.trackSwapId) ENGINE.trackSwapId(swapId);
			$('#otcTrackSwapStatus').html('Tracking <code>' + esc(short(swapId)) + '</code> — waiting for matching Nostr events.');
			flash('info', 'Tracking swap ' + short(swapId) + '. Keep this tab open until terms arrive.');
			log('Tracking swap ID ' + swapId);
		} catch (error) {
			$('#otcTrackSwapStatus').html('<span style="color:#f1334a">' + esc(error.message || error) + '</span>');
			flash('warning', error.message || String(error));
		}
	});

	/* ============ ACTIVE SWAP DETAIL (read-only) ============ */
	function showActiveSwap(id) {
		var s = ENGINE.restoreLive(id);
		if (!s) { flash('warning', 'Session not found'); return; }
		$('#otcActiveTab').tab('show');
		$('#otcActiveNone').hide(); $('#otcActiveDetail').show();
		var readiness = s.readiness || {};
		var execution = s.execution || {};
		var rows = [
			['Swap ID', '<code style="font-size:10px;word-break:break-all">' + esc(s.swapId) + '</code>'],
			['State', '<span class="label label-info">' + esc(s.state) + '</span>'],
			['Role', esc(s.role === 'seller' ? 'Seller (Seller)' : 'Buyer (Buyer)')],
			['Decision', decisionSummary(s)],
			['ROD amount', esc(s.terms.rodAmount)],
			[esc(altChainOf(s)) + ' amount', esc(s.terms.altAmount)],
			['Rate', esc(rate(s.terms.rodAmount, s.terms.altAmount)) + ' ' + esc(altChainOf(s)) + '/ROD'],
			['Bilateral ready', s.bilateralReady ? '<span class="label label-success">yes</span>' : '<span class="label label-default">no</span>'],
			['Local readiness', readinessSummary(readiness.local)],
			['Remote readiness', readinessSummary(readiness.remote)],
			['Release height', esc(s.terms.releaseRodHeight)],
			['ROD refund height', esc(s.terms.refundRodHeight || '—') + (s.rodRefund && s.rodRefund.signedHex ? ' · <span class="label label-success">refund signed</span>' : ' · <span class="label label-default">refund pending</span>')],
			[esc(altChainOf(s)) + ' refund height', esc(s.terms.altRefundLockHeight || '—') + (s.altRefund && s.altRefund.signedHex ? ' · <span class="label label-success">refund signed</span>' : ' · <span class="label label-default">refund pending</span>')],
			['Planned ROD funding', s.plannedRodFunding ? '<code style="font-size:10px;word-break:break-all">' + esc(s.plannedRodFunding.txid) + '</code>' : '<span class="text-muted">not planned</span>'],
			['Planned ' + esc(altChainOf(s)) + ' funding', s.plannedAltFunding ? '<code style="font-size:10px;word-break:break-all">' + esc(s.plannedAltFunding.txid) + '</code>' : '<span class="text-muted">not planned</span>'],
			['Prepared', (s.localPrepared ? '<span class="label label-success">local</span>' : '<span class="label label-default">local pending</span>') + ' ' + (s.remotePrepared ? '<span class="label label-success">remote</span>' : '<span class="label label-default">remote pending</span>')],
			['Adaptor sigs', (s.localAltAdaptorSignature || s.localRodAdaptorSignature ? '<span class="label label-success">local sent</span>' : '<span class="label label-default">local pending</span>') + ' ' + (s.remoteAltAdaptorSignature || s.remoteRodAdaptorSignature ? '<span class="label label-success">remote verified</span>' : '<span class="label label-default">remote pending</span>')],
			['Terms hash', '<code style="font-size:10px">' + esc(s.terms.termsHash) + '</code>'],
			['Child index', esc(s.childIndex)],
			['ROD multisig', '<code style="font-size:10px">' + esc(s.terms.rodFunding.multisigAddress) + '</code>'],
			[esc(altChainOf(s)) + ' multisig', '<code style="font-size:10px">' + esc(s.terms.altFunding.multisigAddress) + '</code>'],
			['ROD funding tx', txSummary(execution.rodFunding)],
			[esc(altChainOf(s)) + ' funding tx', txSummary(execution.altFunding)],
			[esc(altChainOf(s)) + ' claim tx', txSummary(execution.altClaim)],
			['ROD claim tx', txSummary(execution.rodClaim)],
			['Redeem (ROD)', '<code style="font-size:9px;word-break:break-all">' + esc(s.terms.rodFunding.redeemScript) + '</code>'],
			['Redeem (' + esc(altChainOf(s)) + ')', '<code style="font-size:9px;word-break:break-all">' + esc(s.terms.altFunding.redeemScript) + '</code>'],
			['Adaptor point', s.adaptorPoint ? '<code style="font-size:10px">' + esc(s.adaptorPoint) + '</code>' : '<span class="text-muted">not yet</span>'],
			['Seller pubkey', '<code style="font-size:10px">' + esc(s.terms.sellerChildPubKey) + '</code>'],
			['Buyer pubkey', '<code style="font-size:10px">' + esc(s.terms.buyerChildPubKey) + '</code>'],
			['Seller xpub', '<code style="font-size:10px;word-break:break-all">' + esc(s.sellerSwapXpub) + '</code>'],
			['Buyer xpub', '<code style="font-size:10px;word-break:break-all">' + esc(s.buyerSwapXpub) + '</code>'],
			['Messages', (s.messages || []).length + ' events']
		];
		$('#otcAInfo').html(rows.map(function (r) { return '<tr><td style="width:120px;color:#9ec7db;font-weight:600">' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join(''));
		renderExecutionButtons(s);
		/* Timeline */
		$('#otcATimeline').html((s.timeline || []).map(function (t) {
			return '<div style="margin-bottom:4px"><span class="label label-default" style="font-size:10px">' + esc(t.state) + '</span> <small>' + esc(t.at) + '</small> <small class="text-muted">' + esc(t.note || '') + '</small></div>';
		}).join(''));
		/* Execution log */
		var logs = (s._log || []);
		$('#otcALog').html(logs.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') || '<div class="text-muted">No events yet.</div>');
		$('#otcExecStatus').html(executionStatusHtml(s));
	}

	function txSummary(evidence) {
		if (!evidence || !evidence.txid) return '<span class="text-muted">not set</span>';
		return '<code style="font-size:10px;word-break:break-all">' + esc(evidence.txid) + '</code>' + (evidence.confirmations != null ? ' · conf ' + esc(evidence.confirmations) : '');
	}

	function decisionSummary(session) {
		if (session.declined) return '<span class="label label-danger">declined</span>';
		var local = session.localAccepted ? '<span class="label label-success">local accepted</span>' : '<span class="label label-default">local pending</span>';
		var remote = session.remoteAccepted ? '<span class="label label-success">remote accepted</span>' : '<span class="label label-default">remote pending</span>';
		return local + ' ' + remote;
	}

	function renderExecutionButtons(session) {
		$('.otcExecBtn').hide().prop('disabled', false);
		$('.otcExecBtn[data-action="refresh"]').show();
		var execution = session.execution || {};
		if (!session.declined && !session.localAccepted && session.state !== 'COMPLETE') {
			$('.otcExecBtn[data-action="accept-offer"]').show();
		}
		if (session.role === 'seller' && session.localAccepted && session.state !== 'COMPLETE' && !(execution.altClaim && execution.altClaim.txid)) {
			$('.otcExecBtn[data-action="claim-alt"]').show().prop('disabled', !altClaimReady(session));
		}
		if (session.role === 'buyer' && session.localAccepted && session.state !== 'COMPLETE' && !(execution.rodClaim && execution.rodClaim.txid)) {
			$('.otcExecBtn[data-action="claim-rod"]').show().prop('disabled', !rodClaimReady(session));
		}
		var ownRefund = session.role === 'seller' ? session.rodRefund : session.altRefund;
		var ownFunding = session.role === 'seller' ? execution.rodFunding : execution.altFunding;
		if (ownRefund && ownRefund.signedHex && ownFunding && ownFunding.txid && session.state !== 'COMPLETE') {
			$('.otcExecBtn[data-action="attempt-refund"]').show();
		}
	}

	function executionStatusHtml(session) {
		var e = session.execution || {};
		return [
			'<div><b>ROD funding:</b> ' + txSummary(e.rodFunding) + '</div>',
			'<div><b>' + esc(altChainOf(session)) + ' funding:</b> ' + txSummary(e.altFunding) + '</div>',
			'<div><b>' + esc(altChainOf(session)) + ' claim:</b> ' + txSummary(e.altClaim) + '</div>',
			'<div><b>ROD claim:</b> ' + txSummary(e.rodClaim) + '</div>'
		].join('');
	}

	/* Every swap is ROD <-> one "alt" chain. Which alt chain is fixed in the
	   canonical terms at negotiation time, so the entire execution path must
	   read it from there instead of assuming Litecoin. Sessions persisted
	   before multi-alt-chain support existed carry no altChain field and are
	   therefore Litecoin by definition. */
	var DEFAULT_ALT_CHAIN = 'LTC';

	function altChainOf(sessionOrTerms) {
		if (!sessionOrTerms) return DEFAULT_ALT_CHAIN;
		var terms = sessionOrTerms.terms || sessionOrTerms;
		var code = terms && terms.altChain;
		return (code && CHAINS.definitions[code] && code !== 'ROD') ? code : DEFAULT_ALT_CHAIN;
	}

	/* Alt chain currently chosen in the New swap form (before any session or
	   terms exist yet). */
	function selectedAltChain() {
		var code = $.trim($('#nsAltChain').val() || '');
		return (code && CHAINS.definitions[code] && code !== 'ROD') ? code : DEFAULT_ALT_CHAIN;
	}

	function pairLabel(sessionOrTerms) {
		return 'ROD/' + altChainOf(sessionOrTerms);
	}

	function fundingFee(chainCode) {
		return chainCode === 'ROD' ? '0.00051900' : SWAP.altFees(chainCode).fundingFee;
	}

	/* Settlement fees come from canonical terms so both sides construct
	   byte-identical claim/refund transactions (diverging fees would diverge
	   the sighashes and invalidate every exchanged signature). */
	function claimFee(session, chainCode) {
		var terms = session && session.terms || {};
		if (chainCode === 'ROD') return terms.rodClaimFee || SWAP.DEFAULT_FEES.rodClaimFee;
		return terms.altClaimFee || SWAP.altFees(chainCode).claimFee;
	}

	function refundFee(session, chainCode) {
		var terms = session && session.terms || {};
		if (chainCode === 'ROD') return terms.rodRefundFee || SWAP.DEFAULT_FEES.rodRefundFee;
		return terms.altRefundFee || SWAP.altFees(chainCode).refundFee;
	}

	/* Planned (signed, unbroadcast) funding is the single source of truth for
	   every dependent transaction: refunds, adaptor sigs and claims all spend
	   the planned outpoint, and the on-chain funding is later gated to match. */
	function plannedFunding(session, chainCode) {
		return chainCode === 'ROD' ? session.plannedRodFunding : session.plannedAltFunding;
	}

	function claimTxFor(session, chainCode) {
		var planned = plannedFunding(session, chainCode);
		if (!planned || !planned.txid) throw new Error(chainCode + ' planned funding is missing');
		return ENGINE.buildClaimTxFromFunding(chainCode, planned, fundingTarget(session, chainCode).redeemScript, claimDestination(session, chainCode), claimFee(session, chainCode));
	}

	function refundTxFor(session, chainCode) {
		var planned = plannedFunding(session, chainCode);
		if (!planned || !planned.txid) throw new Error(chainCode + ' planned funding is missing');
		var terms = session.terms;
		var destination = chainCode === 'ROD' ? terms.sellerRodRefundAddress : terms.buyerAltRefundAddress;
		var lockHeight = chainCode === 'ROD' ? terms.refundRodHeight : terms.altRefundLockHeight;
		if (!destination) throw new Error(chainCode + ' refund destination missing from terms');
		if (!lockHeight) throw new Error(chainCode + ' refund lock height missing from terms');
		return ENGINE.buildRefundTxFromFunding(chainCode, planned, fundingTarget(session, chainCode).redeemScript, destination, refundFee(session, chainCode), lockHeight);
	}

	function altClaimReady(session) {
		return !!(session.remoteAltAdaptorSignature && session.adaptorSecret && session.plannedAltFunding &&
			session.execution && session.execution.altFunding && session.execution.altFunding.verifiedLocally);
	}

	function rodClaimReady(session) {
		return !!(session.remoteRodAdaptorSignature && session.recoveredAdaptorSecret && session.plannedRodFunding);
	}

	/* ============ NEW SWAP ============ */
	function clearCounterpartyFields() {
		$('#nsPeer').val('');
		$('#nsPeerXpub').val('');
		$('#nsPeerPayoutAddr').val('');
		/* Regenerate random ROD name for the next order */
		$('#nsOrderName').val('d/otc-swap/' + randomOrderNameSuffix());
		nsPrefillFromOrder = false;
		updateNsModeHint();
	}

	function updateNsModeHint() {
		var peer = $.trim($('#nsPeer').val());
		var xpub = $.trim($('#nsPeerXpub').val());
		if (peer && xpub) {
			$('#nsModeHint').html(nsPrefillFromOrder
				? 'Mode: <b>start swap</b> (counterparty loaded from Dashboard order).'
				: 'Mode: <b>start swap</b> (counterparty entered manually).');
		} else {
			$('#nsModeHint').html('Mode: <b>create order</b> — counterparty fields incomplete. Take an order on the Dashboard to start a swap.');
		}
	}
	$('#nsPeer, #nsPeerXpub').on('input change', updateNsModeHint);

	function decimalToBaseUnits(value) {
		var text = $.trim(value == null ? '' : String(value));
		if (!/^\d+(\.\d{0,8})?$/.test(text)) return null;
		var parts = text.split('.');
		var whole = parts[0].replace(/^0+(?=\d)/, '') || '0';
		var fraction = (parts[1] || '').slice(0, 8);
		while (fraction.length < 8) fraction += '0';
		return (whole + fraction).replace(/^0+(?=\d)/, '') || '0';
	}

	function isBaseUnitsLessThan(left, right) {
		var a = String(left || '0').replace(/^0+(?=\d)/, '') || '0';
		var b = String(right || '0').replace(/^0+(?=\d)/, '') || '0';
		if (a.length !== b.length) return a.length < b.length;
		return a < b;
	}

	function balanceResponseAmount(response) {
		var row = response && response.data && response.data[0] ? response.data[0] : null;
		return row && row.balance != null ? row.balance : null;
	}

	function getWalletAddressForChain(wif, chainCode) {
		var previousNetworkCode = coinjs.activeNetwork;
		try {
			coinjs.setNetwork(chainCode);
			return coinjs.wif2address(wif).address;
		} finally {
			coinjs.setNetwork(previousNetworkCode || 'ROD');
		}
	}

	function getChainBalance(chainCode, address) {
		var d = $.Deferred();
		var previousNetworkCode = coinjs.activeNetwork;
		try {
			coinjs.setNetwork(chainCode);
			/* addressBalance captures coinjs.getNetwork() synchronously at
			   call time, so the global network can be restored immediately.
			   Restoring inside the async callback left the whole page on LTC
			   for the duration of the request — any concurrent derivation
			   (checkWallet poll) then emitted LTC-versioned keys. */
			coinjs.addressBalance(address, function (response) {
				var balance = balanceResponseAmount(response);
				if (!response || !response.success || balance == null) {
					d.reject((response && response.error) || (chainCode + ' balance lookup failed'));
					return;
				}
				d.resolve({ chainCode: chainCode, address: address, balance: balance });
			});
		} catch (error) {
			d.reject((error && error.message) ? error.message : String(error));
		} finally {
			coinjs.setNetwork(previousNetworkCode || 'ROD');
		}
		return d.promise();
	}

	function ensureWalletFundsForRole(role, rodAmount, altAmount, altChain) {
		var d = $.Deferred();
		if (!walletId || !walletId.wif) {
			d.reject('Open your wallet first');
			return d.promise();
		}
		var requiredChain = role === 'seller' ? 'ROD' : (altChain || selectedAltChain());
		var requiredAmount = role === 'seller' ? rodAmount : altAmount;
		var requiredUnits = decimalToBaseUnits(requiredAmount);
		if (!requiredUnits || requiredUnits === '0') {
			d.reject('Enter a positive ' + requiredChain + ' amount');
			return d.promise();
		}
		var address = getWalletAddressForChain(walletId.wif, requiredChain);
		getChainBalance(requiredChain, address).then(function (result) {
			var balanceUnits = decimalToBaseUnits(result.balance);
			if (!balanceUnits) {
				d.reject('Could not parse ' + requiredChain + ' balance for ' + result.address);
				return;
			}
			if (isBaseUnitsLessThan(balanceUnits, requiredUnits)) {
				d.reject('Insufficient ' + requiredChain + ' balance in wallet ' + result.address + ': need ' + requiredAmount + ', available ' + result.balance);
				return;
			}
			d.resolve($.extend({}, result, {
				role: role,
				requiredAmount: requiredAmount,
				verifiedAt: new Date().toISOString()
			}));
		}, function (error) {
			d.reject('Could not verify ' + requiredChain + ' balance: ' + error);
		});
		return d.promise();
	}

	function buildLocalReadinessUnchecked(role, rodAmount, altAmount, reason, altChain) {
		var requiredChain = role === 'seller' ? 'ROD' : (altChain || selectedAltChain());
		var requiredAmount = role === 'seller' ? rodAmount : altAmount;
		return {
			role: role,
			chain: requiredChain,
			address: getWalletAddressForChain(walletId.wif, requiredChain),
			requiredAmount: requiredAmount,
			observedBalance: 'unverified',
			verifiedAt: new Date().toISOString(),
			warning: reason || 'Balance API unavailable; readiness is local-only and funding may still fail'
		};
	}

	function readinessRoleChain(role, altChain) {
		return role === 'seller' ? 'ROD' : (altChain || selectedAltChain());
	}

	function readinessRequiredAmount(session, role) {
		return role === 'seller' ? session.terms.rodAmount : session.terms.altAmount;
	}

	function readinessSummary(readiness) {
		if (!readiness) return '<span class="text-muted">not received</span>';
		var warning = readiness.warning ? ' · <span class="label label-warning">unverified</span> ' + esc(readiness.warning) : '';
		return '<code>' + esc(readiness.role || '—') + '</code> · ' + esc(readiness.chain || '—') +
			' · need ' + esc(readiness.requiredAmount) + ' · balance ' + esc(readiness.observedBalance) +
			' · <code style="font-size:10px">' + esc(short(readiness.address)) + '</code> · ' + esc(readiness.verifiedAt || '—') + warning;
	}

	function readinessMatches(session, readiness, expectedRole) {
		return !!(readiness && readiness.role === expectedRole && readiness.chain === readinessRoleChain(expectedRole, altChainOf(session)) && readiness.requiredAmount === readinessRequiredAmount(session, expectedRole));
	}

	function saveLocalReadiness(session, readiness, note) {
		var liveSession = ENGINE.restoreLive(session.swapId) || session;
		liveSession.readiness = liveSession.readiness || {};
		liveSession.readiness.local = readiness;
		ENGINE.saveLive(liveSession);
		publish(liveSession, 'swap_ready', { readiness: liveSession.readiness.local });
		slog(liveSession.swapId, note || '→ Sent local readiness proof');
		markBilateralReady(liveSession);
		autoContinueSwap(liveSession);
		refreshSwaps();
		showActiveSwap(liveSession.swapId);
		return liveSession;
	}

	function buildReadinessEvidence(balanceProof) {
		return {
			role: balanceProof.role,
			chain: balanceProof.chainCode,
			address: balanceProof.address,
			requiredAmount: balanceProof.requiredAmount,
			observedBalance: balanceProof.balance,
			verifiedAt: balanceProof.verifiedAt
		};
	}

	function markBilateralReady(session) {
		var readiness = session.readiness || {};
		var remoteRole = session.role === 'seller' ? 'buyer' : 'seller';
		if (session.bilateralReady || !readinessMatches(session, readiness.local, session.role) || !readinessMatches(session, readiness.remote, remoteRole)) return false;
		session.bilateralReady = true;
		session.timeline = session.timeline || [];
		session.timeline.push({ state: 'BILATERAL_READY', at: new Date().toISOString(), note: 'Local and remote balance readiness proofs present' });
		slog(session.swapId, '✓ Bilateral readiness proven for ' + readiness.local.chain + ' and ' + readiness.remote.chain);
		ENGINE.saveLive(session);
		return true;
	}

	function selectedSwap() {
		var visibleId = $('#otcAInfo code:first').text();
		var all = ENGINE.loadLive(), ids = Object.keys(all);
		for (var i = 0; i < ids.length; i++) if (ids[i] === visibleId) return ENGINE.restoreLive(ids[i]);
		if (ids.length === 1) return ENGINE.restoreLive(ids[0]);
		return null;
	}

	function publish(session, type, payload) {
		if (ENGINE.pool) ENGINE.publishSwapMessage(session, type, payload || {});
	}

	function shouldProcessRelayEvent(env) {
		var liveSessions = ENGINE.loadLive();
		if (liveSessions[env.swapId]) return true;
		if (ENGINE.trackedSwapIds && ENGINE.trackedSwapIds[env.swapId]) return true;
		return env.type === 'swap_terms';
	}

	function eventPubkey(eventObject) {
		return eventObject && eventObject.pubkey ? String(eventObject.pubkey) : '';
	}

	/* True when a relay replays one of OUR OWN events (e.g. after a page
	   reload, when the engine-level seen{} cache is empty). Signature and
	   claim handlers must never treat those as counterparty messages. */
	function isLocalEcho(sess, eventObject) {
		var pubkey = eventPubkey(eventObject);
		return !!(pubkey && sess.localNostrPubkey && pubkey === sess.localNostrPubkey);
	}

	function ensureRemotePeer(session, eventObject) {
		var pubkey = eventPubkey(eventObject);
		if (!pubkey) throw new Error('Remote OTC event is missing pubkey');
		if (session.localNostrPubkey && pubkey === session.localNostrPubkey) throw new Error('Ignoring local echo event');
		/* A valid Nostr signature proves control of the event key, but the key
		   must also belong to the counterparty named in the canonical terms.
		   Nostr keys are derived from the same wallet key as the ROD identity;
		   bind the x-only event key back to that ROD P2PKH address before pinning
		   it as this session's peer. */
		var remoteRodIdentity = session.role === 'seller'
			? session.terms && session.terms.buyerIdentity
			: session.terms && session.terms.sellerIdentity;
		if (!remoteRodIdentity || !SWAP.nostrPubkeyMatchesRodIdentity(pubkey, remoteRodIdentity)) {
			throw new Error('Remote OTC event signer does not match the counterparty ROD identity');
		}
		if (session.remoteNostrPubkey && session.remoteNostrPubkey !== pubkey) throw new Error('Remote OTC event pubkey mismatch');
		session.remoteNostrPubkey = pubkey;
		return pubkey;
	}

	function saveExecution(session, key, evidence) {
		/* Merge into the FRESHEST stored copy — saving the caller's (possibly
		   stale) session object wholesale can silently undo concurrent updates
		   made by other async automation steps. */
		var live = ENGINE.restoreLive(session.swapId) || session;
		live.execution = live.execution || {};
		live.execution[key] = $.extend({}, live.execution[key] || {}, evidence || {});
		session.execution = live.execution;
		ENGINE.saveLive(live);
		showActiveSwap(live.swapId);
		refreshSwaps();
	}

	/* Automation locks are IN-MEMORY per page run, never persisted. Persisting
	   them inside the session object caused ghost locks: an async callback
	   saving a stale session copy resurrected a lock that had already been
	   cleared, and the blocked step (e.g. the refund monitor) then waited out
	   the full staleness window. A page reload naturally clears these. */
	var automationLocks = {};
	/* Per-key adaptive backoff. A flat retry delay is wrong in both directions:
	   too short and a rate-limited explorer (BlockCypher allows ~200 req/h
	   keyless) keeps getting hammered and never recovers; too long and the
	   common "broadcast succeeded but the tx is not indexed yet" 404 stalls the
	   whole swap for minutes. Classify the failure and scale the delay to it. */
	var automationBackoff = {};
	var BACKOFF_POLICY = {
		/* explorer says slow down — back off hard and grow fast */
		ratelimit: { base: 120000, max: 900000, factor: 2 },
		/* tx simply not indexed yet — it WILL appear; retry briskly */
		notfound:  { base: 5000,   max: 60000,  factor: 1.6 },
		/* transport/5xx — server-side trouble, moderate backoff */
		network:   { base: 15000,  max: 300000, factor: 2 },
		/* logic/validation errors — no point spinning fast */
		other:     { base: 30000,  max: 300000, factor: 2 },
		/* LOCAL precondition, not a network problem: the wallet is closed or a
		   key is not available yet. Backing off here would punish the operator
		   for the seconds it takes them to reopen the wallet and would leave
		   the swap idle long after the condition was fixed. Retry almost
		   immediately and never escalate. */
		local:     { base: 2000,   max: 2000,   factor: 1 }
	};

	/* Map an arbitrary error onto a backoff class. Explorer adapters surface
	   HTTP status text through the message, so match on both. Local
	   precondition failures are matched FIRST: "Open your wallet first" must
	   never be mistaken for a server problem. */
	function classifyFailure(error) {
		var m = ((error && (error.message || error.error)) || String(error || '')).toLowerCase();
		if (!m) return 'other';
		if (m.indexOf('open your wallet') !== -1 || m.indexOf('wallet is required') !== -1 ||
			m.indexOf('reopen the wallet') !== -1 || m.indexOf('unavailable; reopen') !== -1 ||
			m.indexOf('cannot be decrypted') !== -1 || m.indexOf('wallet wif') !== -1) return 'local';
		if (m.indexOf('429') !== -1 || m.indexOf('rate limit') !== -1 || m.indexOf('too many requests') !== -1) return 'ratelimit';
		/* Match '404' only as an HTTP status, never as a substring: transaction
		   ids are hex and frequently contain "404", which previously made an
		   HTTP 500 mentioning tx a404b… look like a not-found. */
		if (m.indexOf('no such mempool') !== -1 || m.indexOf('not found') !== -1 ||
			/(^|[^0-9a-f])404([^0-9a-f]|$)/.test(m) ||
			m.indexOf('no such transaction') !== -1 || m.indexOf('could not find') !== -1) return 'notfound';
		if (m.indexOf('unreachable') !== -1 || m.indexOf('timed out') !== -1 || m.indexOf('timeout') !== -1 ||
			m.indexOf('networkerror') !== -1 || m.indexOf('http 5') !== -1 || m.indexOf('502') !== -1 ||
			m.indexOf('503') !== -1 || m.indexOf('504') !== -1) return 'network';
		return 'other';
	}

	/* Drop every pending cooldown. Called when the wallet is (re)opened: any
	   backoff accumulated while key material was unavailable describes a
	   condition that no longer holds, and the swap should resume at once
	   rather than waiting out a penalty it no longer deserves. */
	function resetAutomationBackoff() {
		automationBackoff = {};
	}

	/* Take the lock and start an async step.

	   Several steps build their arguments with calls that throw SYNCHRONOUSLY —
	   requireWalletWif() is the common one, e.g.
	       ENGINE.buildFundingTx('ROD', requireWalletWif(), …).then(…).fail(…)
	   where the throw happens while evaluating the arguments, so the promise is
	   never constructed and NEITHER handler ever runs. The lock taken a line
	   earlier was then held until the 120 s staleness ceiling expired, freezing
	   that step for two minutes every time the wallet happened to be closed.
	   Running the starter inside try/catch converts that into a normal,
	   classified failure (wallet errors are class 'local' → ~2 s retry). */
	function guardedStart(sess, key, startFn) {
		if (!markAutomationBusy(sess, key)) return true;
		try {
			startFn();
		} catch (syncError) {
			failAutomationBusy(sess, key, syncError);
			slog(sess.swapId, key + ' blocked: ' + (syncError && syncError.message || syncError) + backoffNote(sess, key));
		}
		return true;
	}

	function markAutomationBusy(session, key) {
		var lockKey = session.swapId + '|' + key;
		var now = Date.now();
		/* An in-flight operation holds the lock; 120 s is the hard ceiling that
		   guarantees a swallowed callback can never wedge the swap forever. */
		var stamp = automationLocks[lockKey];
		if (stamp && (now - stamp) < 120000) return false;
		/* A failed operation holds a cooldown sized by its failure class. */
		var b = automationBackoff[lockKey];
		if (b && now < b.until) return false;
		automationLocks[lockKey] = now;
		return true;
	}

	/* Success: release the lock AND forget the penalty. */
	function clearAutomationBusy(session, key) {
		var lockKey = session.swapId + '|' + key;
		delete automationLocks[lockKey];
		delete automationBackoff[lockKey];
	}

	/* Failure: release the lock but install a cooldown so the next tick does
	   not immediately re-issue the same doomed request. */
	function failAutomationBusy(session, key, error) {
		var lockKey = session.swapId + '|' + key;
		delete automationLocks[lockKey];
		var cls = classifyFailure(error);
		var policy = BACKOFF_POLICY[cls] || BACKOFF_POLICY.other;
		var prev = automationBackoff[lockKey];
		var delay = (prev && prev.cls === cls) ? Math.min(prev.delay * policy.factor, policy.max) : policy.base;
		automationBackoff[lockKey] = { cls: cls, delay: delay, until: Date.now() + delay };
		return { cls: cls, delay: delay };
	}

	/* Human-readable suffix for the pending log lines. */
	function backoffNote(session, key) {
		var b = automationBackoff[session.swapId + '|' + key];
		if (!b) return '';
		return ' · retry in ' + Math.round(b.delay / 1000) + 's (' + b.cls + ')';
	}

	function fundingTarget(session, chainCode) {
		return chainCode === 'ROD' ? session.terms.rodFunding : session.terms.altFunding;
	}

	function payoutDestinationLabel(chainCode) {
		return chainCode === 'ROD' ? 'buyer ROD wallet address' : 'seller ' + chainCode + ' wallet address';
	}

	function claimDestination(session, chainCode) {
		var address = chainCode === altChainOf(session) ? session.terms.sellerAltPayoutAddress : session.terms.buyerRodPayoutAddress;
		if (!address) throw new Error('Missing ' + payoutDestinationLabel(chainCode) + ' in swap terms');
		return address;
	}

	function requireWalletWif() {
		if (!checkWallet() || !walletId || !walletId.wif) throw new Error('Open your wallet first');
		return walletId.wif;
	}

	function verifyFunding(session, chainCode, manualTxid) {
		var target = fundingTarget(session, chainCode);
		var txid = $.trim(manualTxid || (session.execution && session.execution[chainCode === 'ROD' ? 'rodFunding' : 'altFunding'] && session.execution[chainCode === 'ROD' ? 'rodFunding' : 'altFunding'].txid) || '');
		if (!txid) return $.Deferred().reject(new Error('Enter or receive ' + chainCode + ' funding txid first')).promise();
		return ENGINE.findFundingOutput(chainCode, txid, target.multisigAddress, target.amount).then(function (evidence) {
			/* Set ONLY here: this browser checked the chain API itself.
			   Remote evidence messages have this flag stripped on receipt. */
			evidence.verifiedLocally = true;
			saveExecution(session, chainCode === 'ROD' ? 'rodFunding' : 'altFunding', evidence);
			return evidence;
		});
	}

	function scalarResult(value) {
		return $.isArray(value) ? value[0] : value;
	}

	function validateRefundOrderingFresh(session) {
		var chainCode = altChainOf(session);
		return $.when(ENGINE.getRodHeight(), ENGINE.getAltHeight(chainCode)).then(function (rodHeight, altHeight) {
			return SWAP.assertRefundOrdering(
				session.terms,
				scalarResult(rodHeight),
				scalarResult(altHeight)
			);
		});
	}

	function acceptSession(session, note) {
		/* Acceptance is the last user-controlled point before automated signing.
		   Read both chain tips now; never acknowledge terms whose counter-chain
		   refund is not safely earlier in wall-clock time. */
		return validateRefundOrderingFresh(session).then(function (proof) {
			session.localAccepted = true;
			session._refundSafety = session._refundSafety || {};
			session._refundSafety.accept = $.extend({ checkedAt: Date.now(), termsHash: session.terms.termsHash }, proof);
			if (session.state === 'OPEN') SWAP.safeAdvance(session, 'NEGOTIATING', note || 'Offer accepted');
			if (session.remoteAccepted) SWAP.safeAdvance(session, 'TERMS_ACCEPTED', note || 'Offer accepted');
			ENGINE.saveLive(session);
			publish(session, 'swap_accept', { accepted: true, acceptedAt: new Date().toISOString() });
			slog(session.swapId, session.remoteAccepted ? '→ Offer accepted; both peers accepted' : '→ Offer accepted; waiting for counterparty accept');
			autoContinueSwap(session);
			return session;
		});
	}

	function declineSession(session) {
		session.declined = true;
		session.declinedAt = new Date().toISOString();
		ENGINE.saveLive(session);
		publish(session, 'swap_decline', { declined: true, declinedAt: session.declinedAt });
		slog(session.swapId, '→ Offer declined');
		refreshSwaps();
		showActiveSwap(session.swapId);
	}

	var STATE_ORDER = ['OPEN', 'NEGOTIATING', 'TERMS_ACCEPTED', 'REFUNDS_READY', 'SIGNATURES_EXCHANGED', 'PREPARED', 'SELLER_ROD_FUNDED', 'BUYER_ALT_FUNDED', 'READY', 'ALT_CLAIMED', 'SECRET_RECOVERED', 'ROD_CLAIMED', 'COMPLETE'];
	function stateRank(state) { return STATE_ORDER.indexOf(state); }
	function isTerminal(session) {
		return !session || session.declined || session.state === 'COMPLETE' ||
			session.state === 'REFUNDED' || session.state === 'PARTIALLY_SETTLED' ||
			session.state === 'ROD_REFUNDED' || session.state === 'ALT_REFUNDED';
	}

	var REFUND_SAFETY_PROOF_MAX_AGE_MS = 60000;
	function currentRefundSafetyProof(session, stage) {
		var proof = session._refundSafety && session._refundSafety[stage];
		return !!(proof && proof.termsHash === session.terms.termsHash &&
			(Date.now() - parseInt(proof.checkedAt, 10)) <= REFUND_SAFETY_PROOF_MAX_AGE_MS);
	}

	/* Async security gate used immediately before the pre-funding signature
	   pipeline and again before this peer broadcasts its funding transaction.
	   It returns true only when a fresh proof is already present; otherwise it
	   starts the check and the success callback re-drives automation. */
	function ensureRefundSafetyGate(session, stage) {
		if (session._refundSafetyFault) return false;
		if (currentRefundSafetyProof(session, stage)) return true;
		var lockName = 'refundSafety-' + stage;
		if (!markAutomationBusy(session, lockName)) return false;
		validateRefundOrderingFresh(session).then(function (proof) {
			var live = ENGINE.restoreLive(session.swapId) || session;
			live._refundSafety = live._refundSafety || {};
			live._refundSafety[stage] = $.extend({
				checkedAt: Date.now(),
				termsHash: live.terms.termsHash
			}, proof);
			ENGINE.saveLive(live);
			clearAutomationBusy(session, lockName);
			slog(live.swapId, '✓ Refund ordering revalidated before ' + (stage === 'preFunding' ? 'refund signing' : 'funding'));
			autoContinueSwap(live);
		}, function (error) {
			var message = error && error.message || String(error);
			if (/refund ordering|future lock heights|unsupported alt chain/i.test(message)) {
				var live = ENGINE.restoreLive(session.swapId) || session;
				live._refundSafetyFault = message;
				ENGINE.saveLive(live);
				clearAutomationBusy(session, lockName);
				slog(live.swapId, '✗ Settlement blocked: ' + message);
				flash('danger', 'Unsafe refund ordering on swap ' + short(live.swapId) + ': no signing or funding will proceed.');
				return;
			}
			failAutomationBusy(session, lockName, error);
			slog(session.swapId, 'Refund ordering check pending: ' + message + backoffNote(session, lockName));
		});
		return false;
	}

	function autoContinueSwap(session) {
		var latest = ENGINE.restoreLive(session.swapId) || session;
		if (isTerminal(latest)) return;
		if (SWAP.REFUND_STATES[latest.state]) { checkRefunds(latest); return; }
		var bothAccepted = !!(latest.localAccepted && latest.remoteAccepted);
		if (bothAccepted && latest.state === 'NEGOTIATING') {
			SWAP.safeAdvance(latest, 'TERMS_ACCEPTED', 'Both peers accepted offer');
			ENGINE.saveLive(latest);
		}
		if (!bothAccepted) return;
		/* Refund monitoring runs FIRST and independently of stage progress:
		   a stalled confirmation-wait loop must never starve the refund path
		   (checkRefunds is height-gated, lock-guarded and cheap). */
		checkRefunds(latest);
		if (stateRank(latest.state) < stateRank('PREPARED')) {
			if (!ensureRefundSafetyGate(latest, 'preFunding')) return;
			if (advancePreFunding(latest)) return;
		}
		var execution = latest.execution || {};
		var ownFundingMissing = latest.role === 'seller'
			? !(execution.rodFunding && execution.rodFunding.txid)
			: !(execution.altFunding && execution.altFunding.txid);
		if (stateRank(latest.state) >= stateRank('PREPARED') && ownFundingMissing &&
			!ensureRefundSafetyGate(latest, 'funding')) return;
		if (advanceFunding(latest)) return;
		advanceSettlement(latest);
	}

	/* Consume stashed protocol payloads whose prerequisites have arrived.
	   Sync, idempotent, safe to call from handlers and from the tick. */
	function processPendingProtocol(sess) {
		var terms = sess.terms;
		/* Buyer: verify + countersign Seller's ROD refund */
		if (sess.role === 'buyer' && sess._pendingRodRefundSig && !sess.rodRefundCosigned && sess.plannedRodFunding) {
			try {
				var rodRefundTxB = refundTxFor(sess, 'ROD');
				if (!ENGINE.verifyDerSig(ENGINE.sighash(rodRefundTxB), terms.sellerChildPubKey, sess._pendingRodRefundSig)) {
					slog(sess.swapId, '✗ Seller ROD refund signature failed verification — dropped');
					sess._pendingRodRefundSig = '';
					ENGINE.saveLive(sess);
				} else {
					var buyerRodRefundSig = ENGINE.signClaimTx('ROD', rodRefundTxB, getLocalChildWif(sess, 'ROD'));
					sess.rodRefund = $.extend({}, sess.rodRefund || {}, { remoteSig: sess._pendingRodRefundSig, localSig: buyerRodRefundSig, lockHeight: terms.refundRodHeight });
					sess.rodRefundCosigned = true;
					sess._pendingRodRefundSig = '';
					ENGINE.saveLive(sess);
					publish(sess, 'swap_rod_refund_signature', { from: 'buyer', signature: buyerRodRefundSig, txid: sess.plannedRodFunding.txid, vout: 0, lockHeight: terms.refundRodHeight });
					slog(sess.swapId, '✓ Verified + countersigned Seller ROD refund (locktime ' + terms.refundRodHeight + ')');
				}
			} catch (rodCosignError) { slog(sess.swapId, 'ROD refund countersign pending: ' + (rodCosignError.message || rodCosignError)); }
		}
		/* Seller: verify + countersign Buyer's LTC refund */
		if (sess.role === 'seller' && sess._pendingAltRefundSig && !sess.altRefundCosigned && sess.plannedAltFunding) {
			try {
				var altRefundTxA = refundTxFor(sess, altChainOf(sess));
				if (!ENGINE.verifyDerSig(ENGINE.sighash(altRefundTxA), terms.buyerChildPubKey, sess._pendingAltRefundSig)) {
					slog(sess.swapId, '✗ Buyer ' + altChainOf(sess) + ' refund signature failed verification — dropped');
					sess._pendingAltRefundSig = '';
					ENGINE.saveLive(sess);
				} else {
					var sellerAltRefundSig = ENGINE.signClaimTx(altChainOf(sess), altRefundTxA, getLocalChildWif(sess, altChainOf(sess)));
					sess.altRefund = $.extend({}, sess.altRefund || {}, { remoteSig: sess._pendingAltRefundSig, localSig: sellerAltRefundSig, lockHeight: terms.altRefundLockHeight });
					sess.altRefundCosigned = true;
					sess._pendingAltRefundSig = '';
					ENGINE.saveLive(sess);
					publish(sess, 'swap_alt_refund_signature', { from: 'seller', signature: sellerAltRefundSig, txid: sess.plannedAltFunding.txid, vout: 0, lockHeight: terms.altRefundLockHeight });
					slog(sess.swapId, '✓ Verified + countersigned Buyer ' + altChainOf(sess) + ' refund (locktime ' + terms.altRefundLockHeight + ')');
				}
			} catch (altCosignError) { slog(sess.swapId, '' + altChainOf(sess) + ' refund countersign pending: ' + (altCosignError.message || altCosignError)); }
		}
		/* Seller: assemble her fully-signed ROD refund from Buyer's countersig */
		if (sess.role === 'seller' && sess._pendingRodRefundCosig && sess.rodRefund && sess.rodRefund.localSig && !sess.rodRefund.signedHex) {
			try {
				var rodRefundTxA = refundTxFor(sess, 'ROD');
				if (!ENGINE.verifyDerSig(ENGINE.sighash(rodRefundTxA), terms.buyerChildPubKey, sess._pendingRodRefundCosig)) {
					slog(sess.swapId, '✗ Buyer ROD refund countersignature failed verification — dropped');
					sess._pendingRodRefundCosig = '';
					ENGINE.saveLive(sess);
				} else {
					var rodRefundOrdered = [sess.rodRefund.localSig, sess._pendingRodRefundCosig];
					if (verifyClaimSignatures(sess, rodRefundTxA, rodRefundOrdered)) {
						sess.rodRefund.remoteSig = sess._pendingRodRefundCosig;
						ENGINE.applyMultisigSignatures('ROD', rodRefundTxA, terms.rodFunding.redeemScript, rodRefundOrdered);
						sess.rodRefund.signedHex = rodRefundTxA.serialize();
						sess.rodRefund.txid = txidOfHex(sess.rodRefund.signedHex);
						sess._pendingRodRefundCosig = '';
						ENGINE.saveLive(sess);
						slog(sess.swapId, '✓ ROD refund fully signed (' + short(sess.rodRefund.txid) + ', locktime ' + terms.refundRodHeight + ') — ROD funding is now protected');
					} else {
						sess._pendingRodRefundCosig = '';
						ENGINE.saveLive(sess);
						slog(sess.swapId, '✗ Assembled ROD refund failed CHECKMULTISIG verification');
					}
				}
			} catch (rodAssembleError) { slog(sess.swapId, 'ROD refund assembly pending: ' + (rodAssembleError.message || rodAssembleError)); }
		}
		/* Buyer: assemble his fully-signed LTC refund from Seller's countersig */
		if (sess.role === 'buyer' && sess._pendingAltRefundCosig && sess.altRefund && sess.altRefund.localSig && !sess.altRefund.signedHex) {
			try {
				var altRefundTxB = refundTxFor(sess, altChainOf(sess));
				if (!ENGINE.verifyDerSig(ENGINE.sighash(altRefundTxB), terms.sellerChildPubKey, sess._pendingAltRefundCosig)) {
					slog(sess.swapId, '✗ Seller ' + altChainOf(sess) + ' refund countersignature failed verification — dropped');
					sess._pendingAltRefundCosig = '';
					ENGINE.saveLive(sess);
				} else {
					var altRefundOrdered = [sess._pendingAltRefundCosig, sess.altRefund.localSig];
					if (verifyClaimSignatures(sess, altRefundTxB, altRefundOrdered)) {
						sess.altRefund.remoteSig = sess._pendingAltRefundCosig;
						ENGINE.applyMultisigSignatures(altChainOf(sess), altRefundTxB, terms.altFunding.redeemScript, altRefundOrdered);
						sess.altRefund.signedHex = altRefundTxB.serialize();
						sess.altRefund.txid = txidOfHex(sess.altRefund.signedHex);
						sess._pendingAltRefundCosig = '';
						ENGINE.saveLive(sess);
						slog(sess.swapId, '✓ ' + altChainOf(sess) + ' refund fully signed (' + short(sess.altRefund.txid) + ', locktime ' + terms.altRefundLockHeight + ') — ' + altChainOf(sess) + ' funding is now protected');
					} else {
						sess._pendingAltRefundCosig = '';
						ENGINE.saveLive(sess);
						slog(sess.swapId, '✗ Assembled ' + altChainOf(sess) + ' refund failed CHECKMULTISIG verification');
					}
				}
			} catch (altAssembleError) { slog(sess.swapId, '' + altChainOf(sess) + ' refund assembly pending: ' + (altAssembleError.message || altAssembleError)); }
		}
		/* Seller: verify Buyer's LTC claim adaptor signature */
		if (sess.role === 'seller' && sess._pendingAltAdaptorSig && !sess.remoteAltAdaptorSignature && sess.plannedAltFunding && sess.adaptorPoint) {
			try {
				var altClaimTxV = claimTxFor(sess, altChainOf(sess));
				if (ENGINE.verifyAdaptorSig(ENGINE.sighash(altClaimTxV), terms.buyerChildPubKey, sess.adaptorPoint, sess._pendingAltAdaptorSig)) {
					sess.remoteAltAdaptorSignature = sess._pendingAltAdaptorSig;
					sess._pendingAltAdaptorSig = '';
					ENGINE.saveLive(sess);
					slog(sess.swapId, '✓ Verified Buyer ' + altChainOf(sess) + ' claim adaptor signature (DLEQ + pre-signature)');
				} else {
					sess._pendingAltAdaptorSig = '';
					ENGINE.saveLive(sess);
					slog(sess.swapId, '✗ Buyer ' + altChainOf(sess) + ' adaptor signature failed verification — dropped');
				}
			} catch (altAdaptorVerifyError) { slog(sess.swapId, '' + altChainOf(sess) + ' adaptor verify pending: ' + (altAdaptorVerifyError.message || altAdaptorVerifyError)); }
		}
		/* Buyer: verify Seller's ROD claim adaptor signature */
		if (sess.role === 'buyer' && sess._pendingRodAdaptorSig && !sess.remoteRodAdaptorSignature && sess.plannedRodFunding && sess.adaptorPoint) {
			try {
				var rodClaimTxV = claimTxFor(sess, 'ROD');
				if (ENGINE.verifyAdaptorSig(ENGINE.sighash(rodClaimTxV), terms.sellerChildPubKey, sess.adaptorPoint, sess._pendingRodAdaptorSig)) {
					sess.remoteRodAdaptorSignature = sess._pendingRodAdaptorSig;
					sess._pendingRodAdaptorSig = '';
					ENGINE.saveLive(sess);
					slog(sess.swapId, '✓ Verified Seller ROD claim adaptor signature (DLEQ + pre-signature)');
				} else {
					sess._pendingRodAdaptorSig = '';
					ENGINE.saveLive(sess);
					slog(sess.swapId, '✗ Seller ROD adaptor signature failed verification — dropped');
				}
			} catch (rodAdaptorVerifyError) { slog(sess.swapId, 'ROD adaptor verify pending: ' + (rodAdaptorVerifyError.message || rodAdaptorVerifyError)); }
		}
	}

	/* ---- Stage 1: pre-funding pipeline ----
	   Plan (sign, DO NOT broadcast) own funding → exchange pre-signed
	   timelocked refunds → exchange claim adaptor signatures → PREPARED.
	   Nothing touches a chain until every dependent transaction is verified
	   locally. Returns true when it performed or started a step. */
	function advancePreFunding(sess) {
		if (stateRank(sess.state) >= stateRank('PREPARED')) return false;
		processPendingProtocol(sess);
		var terms = sess.terms;
		/* Lazy adaptor-point generation & re-publish for Seller.
		   Covers edge cases: session created before fix was deployed,
		   or the initial relay publish was lost / rate-limited.

		   CRITICAL: generate ONLY when no adaptor commitment exists yet.
		   restoreLive() leaves adaptorSecret falsy whenever the wallet is
		   closed (pw === '') or the wrong wallet is open (AES decrypt with a
		   bad key returns an EMPTY STRING rather than throwing). Regenerating
		   in that situation silently replaces a point the counterparty has
		   already encrypted their adaptor signature against, which makes
		   recoverSecret() fail forever ("Secret recovery failed for all
		   candidate signatures") and strands both legs until refund.
		   _ea (the stored ciphertext) or an existing adaptorPoint both prove a
		   secret was already committed, so treat that as recoverable operator
		   error, not as a missing secret. */
		if (sess.role === 'seller') {
			if (!sess.adaptorSecret) {
				var committed = !!(sess._ea || sess.adaptorPoint);
				if (!committed) {
					var y = coinjs.adaptor.generateSecret();
					sess.adaptorSecret = y;
					sess.adaptorPoint = coinjs.adaptor.publicKey(y);
					ENGINE.saveLive(sess);
					slog(sess.swapId, '⚠ Lazy-generated adaptor secret (missed at session creation)');
				} else if (!sess._adaptorLockWarned) {
					sess._adaptorLockWarned = true;
					ENGINE.saveLive(sess);
					slog(sess.swapId, '✗ Adaptor secret is sealed but cannot be decrypted — reopen the SAME wallet that created this swap. Refusing to regenerate (that would permanently break settlement).');
				}
			}
			if (sess.adaptorPoint && !sess.remotePrepared) {
				publish(sess, 'swap_adaptor_point', { adaptorPoint: sess.adaptorPoint });
			}
		}
		if (sess.role === 'seller') {
			/* Plan ROD funding */
			if (!sess.plannedRodFunding && sess.bilateralReady) {
				return guardedStart(sess, 'planRod', function () {
					ENGINE.buildFundingTx('ROD', requireWalletWif(), terms.rodFunding.multisigAddress, terms.rodAmount, fundingFee('ROD')).then(function (built) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						live.plannedRodFunding = { txid: built.txid, vout: 0, value: CHAINS.decimalToSats(terms.rodAmount), amount: terms.rodAmount, txhex: built.txhex };
						ENGINE.saveLive(live);
						publish(live, 'swap_rod_funding_planned', { txid: built.txid, vout: 0, value: live.plannedRodFunding.value, amount: terms.rodAmount });
						slog(live.swapId, '→ Planned ROD funding ' + short(built.txid) + ' (signed, NOT broadcast)');
						clearAutomationBusy(sess, 'planRod');
						autoContinueSwap(live);
					}).fail(function (error) {
						failAutomationBusy(sess, 'planRod', error);
						slog(sess.swapId, 'ROD funding planning blocked: ' + (error && error.message || error) + backoffNote(sess, 'planRod'));
					});
				});
			}
			/* Sign own ROD refund and send it for countersignature */
			if (sess.plannedRodFunding && !(sess.rodRefund && sess.rodRefund.localSig)) {
				try {
					var rodRefundTx = refundTxFor(sess, 'ROD');
					var rodRefundSig = ENGINE.signClaimTx('ROD', rodRefundTx, getLocalChildWif(sess, 'ROD'));
					sess.rodRefund = $.extend({}, sess.rodRefund || {}, {
						lockHeight: terms.refundRodHeight, destination: terms.sellerRodRefundAddress,
						fee: refundFee(sess, 'ROD'), localSig: rodRefundSig
					});
					ENGINE.saveLive(sess);
					publish(sess, 'swap_rod_refund_signature', { from: 'seller', signature: rodRefundSig, txid: sess.plannedRodFunding.txid, vout: 0, value: sess.plannedRodFunding.value, lockHeight: terms.refundRodHeight });
					slog(sess.swapId, '→ Signed ROD refund (locktime ' + terms.refundRodHeight + '); requested Buyer countersignature');
				} catch (rodRefundError) { slog(sess.swapId, 'ROD refund signing blocked: ' + (rodRefundError.message || rodRefundError)); }
				return true;
			}
			/* Send ROD claim adaptor signature once the refund layer is safe:
			   own refund fully signed and Buyer's refund countersigned. */
			if (sess.rodRefund && sess.rodRefund.signedHex && sess.plannedAltFunding && sess.altRefundCosigned && sess.adaptorPoint && !sess.localRodAdaptorSignature) {
				try {
					/* Pre-validate every field the adaptor-signing chain touches so
					   that a bad session field gives an actionable message instead
					   of a cryptic "Cannot read properties of undefined" deep inside
					   the crypto or serialisation layer. */
					var _ft = fundingTarget(sess, 'ROD');
					if (!_ft || !_ft.redeemScript) slog(sess.swapId, 'DIAG: rodFunding target missing or no redeemScript');
					var _cd = claimDestination(sess, 'ROD');
					if (!_cd) slog(sess.swapId, 'DIAG: ROD claim destination is empty');
					var _pf = plannedFunding(sess, 'ROD');
					if (!_pf || !_pf.txid) slog(sess.swapId, 'DIAG: plannedRodFunding missing txid');
					if (!sess.localChildPrivateKey) slog(sess.swapId, 'DIAG: localChildPrivateKey is empty — wallet locked or wrong WIF?');
					var rodClaimTx = claimTxFor(sess, 'ROD');
					var rodAdaptor = ENGINE.makeAdaptorSig(sess, rodClaimTx);
					sess.localRodAdaptorSignature = rodAdaptor.hex;
					SWAP.safeAdvance(sess, 'REFUNDS_READY', 'Both timelocked refunds pre-signed');
					ENGINE.saveLive(sess);
					publish(sess, 'swap_rod_adaptor_signature', { hex: rodAdaptor.hex, txid: sess.plannedRodFunding.txid, vout: 0 });
					slog(sess.swapId, '→ Sent ROD claim adaptor signature (encrypted to adaptor point)');
				} catch (rodAdaptorError) { slog(sess.swapId, 'ROD adaptor signing blocked: ' + (rodAdaptorError.message || rodAdaptorError)); }
				return true;
			}
			/* PREPARED gate */
			if (sess.localRodAdaptorSignature && sess.remoteAltAdaptorSignature && sess.rodRefund && sess.rodRefund.signedHex && !sess.localPrepared) {
				SWAP.safeAdvance(sess, 'SIGNATURES_EXCHANGED', 'Adaptor signatures exchanged and verified');
				SWAP.safeAdvance(sess, 'PREPARED', 'All pre-funding requirements verified');
				sess.localPrepared = true;
				ENGINE.saveLive(sess);
				publish(sess, 'swap_prepared', { prepared: true });
				slog(sess.swapId, '✓ PREPARED — refunds signed, adaptor signatures verified; funding is safe');
				refreshSwaps();
				return true;
			}
			return false;
		}
		/* --- Buyer --- */
		if (sess.role === 'buyer') {
			/* Plan LTC funding */
			if (!sess.plannedAltFunding && sess.bilateralReady) {
				return guardedStart(sess, 'planAlt', function () {
					ENGINE.buildFundingTx(altChainOf(sess), requireWalletWif(), terms.altFunding.multisigAddress, terms.altAmount, fundingFee(altChainOf(sess))).then(function (built) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						live.plannedAltFunding = { txid: built.txid, vout: 0, value: CHAINS.decimalToSats(terms.altAmount), amount: terms.altAmount, txhex: built.txhex };
						ENGINE.saveLive(live);
						publish(live, 'swap_alt_funding_planned', { txid: built.txid, vout: 0, value: live.plannedAltFunding.value, amount: terms.altAmount });
						slog(live.swapId, '→ Planned ' + altChainOf(live) + ' funding ' + short(built.txid) + ' (signed, NOT broadcast)');
						clearAutomationBusy(sess, 'planAlt');
						autoContinueSwap(live);
					}).fail(function (error) {
						failAutomationBusy(sess, 'planAlt', error);
						slog(sess.swapId, '' + altChainOf(sess) + ' funding planning blocked: ' + (error && error.message || error) + backoffNote(sess, 'planAlt'));
					});
				});
			}
			/* Sign own LTC refund and send for countersignature */
			if (sess.plannedAltFunding && !(sess.altRefund && sess.altRefund.localSig)) {
				try {
					var altRefundTx = refundTxFor(sess, altChainOf(sess));
					var altRefundSig = ENGINE.signClaimTx(altChainOf(sess), altRefundTx, getLocalChildWif(sess, altChainOf(sess)));
					sess.altRefund = $.extend({}, sess.altRefund || {}, {
						lockHeight: terms.altRefundLockHeight, destination: terms.buyerAltRefundAddress,
						fee: refundFee(sess, altChainOf(sess)), localSig: altRefundSig
					});
					ENGINE.saveLive(sess);
					publish(sess, 'swap_alt_refund_signature', { from: 'buyer', signature: altRefundSig, txid: sess.plannedAltFunding.txid, vout: 0, value: sess.plannedAltFunding.value, lockHeight: terms.altRefundLockHeight });
					slog(sess.swapId, '→ Signed ' + altChainOf(sess) + ' refund (locktime ' + terms.altRefundLockHeight + '); requested Seller countersignature');
				} catch (altRefundError) { slog(sess.swapId, '' + altChainOf(sess) + ' refund signing blocked: ' + (altRefundError.message || altRefundError)); }
				return true;
			}
			/* Send ALT claim adaptor signature */
			if (sess.altRefund && sess.altRefund.signedHex && sess.plannedRodFunding && sess.rodRefundCosigned && sess.adaptorPoint && !sess.localAltAdaptorSignature) {
				try {
					var _altCc = altChainOf(sess);
					var _altFt = fundingTarget(sess, _altCc);
					if (!_altFt || !_altFt.redeemScript) slog(sess.swapId, 'DIAG: altFunding target missing or no redeemScript');
					var _altCd = claimDestination(sess, _altCc);
					if (!_altCd) slog(sess.swapId, 'DIAG: ' + _altCc + ' claim destination is empty');
					if (!sess.localChildPrivateKey) slog(sess.swapId, 'DIAG: localChildPrivateKey is empty — wallet locked or wrong WIF?');
					var altClaimTx = claimTxFor(sess, _altCc);
					var altAdaptor = ENGINE.makeAdaptorSig(sess, altClaimTx);
					sess.localAltAdaptorSignature = altAdaptor.hex;
					SWAP.safeAdvance(sess, 'REFUNDS_READY', 'Both timelocked refunds pre-signed');
					ENGINE.saveLive(sess);
					publish(sess, 'swap_alt_adaptor_signature', { hex: altAdaptor.hex, txid: sess.plannedAltFunding.txid, vout: 0 });
					slog(sess.swapId, '→ Sent ' + _altCc + ' claim adaptor signature (encrypted to adaptor point)');
				} catch (altAdaptorError) { slog(sess.swapId, '' + altChainOf(sess) + ' adaptor signing blocked: ' + (altAdaptorError.message || altAdaptorError)); }
				return true;
			}
			/* PREPARED gate */
			if (sess.localAltAdaptorSignature && sess.remoteRodAdaptorSignature && sess.altRefund && sess.altRefund.signedHex && !sess.localPrepared) {
				SWAP.safeAdvance(sess, 'SIGNATURES_EXCHANGED', 'Adaptor signatures exchanged and verified');
				SWAP.safeAdvance(sess, 'PREPARED', 'All pre-funding requirements verified');
				sess.localPrepared = true;
				ENGINE.saveLive(sess);
				publish(sess, 'swap_prepared', { prepared: true });
				slog(sess.swapId, '✓ PREPARED — refunds signed, adaptor signatures verified; funding is safe');
				refreshSwaps();
				return true;
			}
			return false;
		}
		return false;
	}

	function confirmedEnough(evidence, requiredConfirmations) {
		return !!(evidence && evidence.verifiedLocally && (evidence.confirmations || 0) >= (requiredConfirmations || 1));
	}

	/* ---- Stage 2: gated funding ----
	   Seller broadcasts her PRE-SIGNED planned ROD funding only from PREPARED
	   (with the counterparty also prepared). Buyer broadcasts the alt leg only after the
	   on-chain ROD funding txid matches the planned txid AND reaches the
	   agreed confirmation count. */
	function advanceFunding(sess) {
		if (stateRank(sess.state) < stateRank('PREPARED')) return false;
		var terms = sess.terms;
		var execution = sess.execution || {};
		var rodFunding = execution.rodFunding || null;
		var altFunding = execution.altFunding || null;
		if (sess.role === 'seller') {
			if (!(rodFunding && rodFunding.txid)) {
				if (!sess.remotePrepared) { slog(sess.swapId, 'Waiting for counterparty PREPARED before ROD funding broadcast'); return true; }
				if (!markAutomationBusy(sess, 'fundRod')) return true;
				ENGINE.broadcastTx('ROD', sess.plannedRodFunding.txhex).then(function (response) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					live.execution = live.execution || {};
					live.execution.rodFunding = {
						txid: (response && response.txid) || live.plannedRodFunding.txid, vout: 0,
						value: live.plannedRodFunding.value, amount: live.plannedRodFunding.amount,
						broadcastAt: new Date().toISOString()
					};
					SWAP.safeAdvance(live, 'SELLER_ROD_FUNDED', 'ROD funding broadcast');
					ENGINE.saveLive(live);
					publish(live, 'swap_rod_funded', { funding: { txid: live.execution.rodFunding.txid, vout: 0, value: live.execution.rodFunding.value, amount: live.execution.rodFunding.amount } });
					slog(live.swapId, '→ ROD funding broadcast ' + live.execution.rodFunding.txid);
					clearAutomationBusy(sess, 'fundRod');
					refreshSwaps(); showActiveSwap(live.swapId);
					autoContinueSwap(live);
				}).fail(function (error) {
					failAutomationBusy(sess, 'fundRod', error);
					slog(sess.swapId, 'ROD funding broadcast blocked: ' + (error && error.message || error) + backoffNote(sess, 'fundRod'));
				});
				return true;
			}
			/* Self-verify own ROD funding until confirmation target reached */
			if (rodFunding.txid && !confirmedEnough(rodFunding, terms.rodConfirmations)) {
				if (!markAutomationBusy(sess, 'verifyRodSelf')) return true;
				verifyFunding(sess, 'ROD', sess.plannedRodFunding.txid).then(function (evidence) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					var cleanEvidence = $.extend({}, evidence); delete cleanEvidence.verifiedLocally;
					publish(live, 'swap_rod_funded', { funding: cleanEvidence });
					var confs = evidence.confirmations || 0;
					slog(live.swapId, '✓ Own ROD funding verified · ' + confs + '/' + terms.rodConfirmations + ' confs');
					clearAutomationBusy(sess, 'verifyRodSelf');
					/* Only advance immediately when target reached; otherwise let the
					   30 s liveness tick re-check to avoid hammering the explorer API. */
					if (confs >= terms.rodConfirmations) autoContinueSwap(live);
				}).fail(function (error) {
					failAutomationBusy(sess, 'verifyRodSelf', error);
					slog(sess.swapId, 'Own ROD verify pending: ' + (error && error.message || error) + backoffNote(sess, 'verifyRodSelf'));
				});
				return true;
			}
			/* Verify Buyer's LTC funding (must match his planned txid) → READY */
			if (sess.plannedAltFunding && !confirmedEnough(altFunding, terms.altConfirmations)) {
				if (!markAutomationBusy(sess, 'verifyAlt')) return true;
				verifyFunding(sess, altChainOf(sess), sess.plannedAltFunding.txid).then(function (evidence) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					SWAP.safeAdvance(live, 'BUYER_ALT_FUNDED', '' + altChainOf(live) + ' funding verified on-chain');
					var confs = evidence.confirmations || 0;
					if (confs >= terms.altConfirmations) {
						SWAP.safeAdvance(live, 'READY', altChainOf(live) + ' funding reached ' + terms.altConfirmations + ' confirmation(s)');
					}
					ENGINE.saveLive(live);
					slog(live.swapId, '✓ ' + altChainOf(live) + ' funding verified · ' + confs + '/' + terms.altConfirmations + ' confs');
					clearAutomationBusy(sess, 'verifyAlt');
					/* Only advance immediately when target reached; otherwise let the
					   30 s liveness tick re-check to avoid hammering the explorer API. */
					if (confs >= terms.altConfirmations) autoContinueSwap(live);
				}).fail(function (error) {
					failAutomationBusy(sess, 'verifyAlt', error);
					slog(sess.swapId, '' + altChainOf(sess) + ' funding verify pending: ' + (error && error.message || error) + backoffNote(sess, 'verifyAlt'));
				});
				return true;
			}
			if (confirmedEnough(altFunding, terms.altConfirmations) && stateRank(sess.state) < stateRank('READY')) {
				SWAP.safeAdvance(sess, 'READY', 'Both fundings confirmed');
				ENGINE.saveLive(sess);
				return true;
			}
			return false;
		}
		if (sess.role === 'buyer') {
			/* Verify Seller's ROD funding (gate: on-chain txid == planned txid,
			   confirmations >= agreed) before committing any alt coin. */
			if (!(altFunding && altFunding.txid)) {
				if (!sess.plannedRodFunding) return false;
				var rodOk = confirmedEnough(rodFunding, terms.rodConfirmations) && rodFunding.txid === sess.plannedRodFunding.txid;
				if (!rodOk) {
					if (!markAutomationBusy(sess, 'verifyRod')) return true;
					verifyFunding(sess, 'ROD', sess.plannedRodFunding.txid).then(function (evidence) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						SWAP.safeAdvance(live, 'SELLER_ROD_FUNDED', 'ROD funding verified on-chain');
						ENGINE.saveLive(live);
						var confs = evidence.confirmations || 0;
						slog(live.swapId, '✓ ROD funding verified · ' + confs + '/' + terms.rodConfirmations + ' confs · txid matches planned');
						clearAutomationBusy(sess, 'verifyRod');
						/* Only advance immediately when target reached (proceed to fund ALT);
						   otherwise let the 30 s liveness tick re-check. */
						if (confs >= terms.rodConfirmations) autoContinueSwap(live);
					}).fail(function (error) {
						failAutomationBusy(sess, 'verifyRod', error);
						slog(sess.swapId, 'ROD funding verify pending: ' + (error && error.message || error) + backoffNote(sess, 'verifyRod'));
					});
					return true;
				}
				/* Adaptor signature sanity re-check against the REAL funding */
				if (!sess.remoteRodAdaptorSignature) { slog(sess.swapId, 'Missing Seller ROD adaptor signature; not funding ' + altChainOf(sess)); return true; }
				if (!markAutomationBusy(sess, 'fundAlt')) return true;
				ENGINE.broadcastTx(altChainOf(sess), sess.plannedAltFunding.txhex).then(function (response) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					live.execution = live.execution || {};
					live.execution.altFunding = {
						txid: (response && response.txid) || live.plannedAltFunding.txid, vout: 0,
						value: live.plannedAltFunding.value, amount: live.plannedAltFunding.amount,
						broadcastAt: new Date().toISOString()
					};
					SWAP.safeAdvance(live, 'BUYER_ALT_FUNDED', '' + altChainOf(live) + ' funding broadcast');
					ENGINE.saveLive(live);
					publish(live, 'swap_alt_funded', { funding: { txid: live.execution.altFunding.txid, vout: 0, value: live.execution.altFunding.value, amount: live.execution.altFunding.amount } });
					slog(live.swapId, '→ ' + altChainOf(live) + ' funding broadcast ' + live.execution.altFunding.txid);
					clearAutomationBusy(sess, 'fundAlt');
					refreshSwaps(); showActiveSwap(live.swapId);
					autoContinueSwap(live);
				}).fail(function (error) {
					failAutomationBusy(sess, 'fundAlt', error);
					slog(sess.swapId, '' + altChainOf(sess) + ' funding broadcast blocked: ' + (error && error.message || error) + backoffNote(sess, 'fundAlt'));
				});
				return true;
			}
			/* Self-verify own LTC funding until confirmation target reached */
			if (altFunding.txid && !confirmedEnough(altFunding, terms.altConfirmations)) {
				if (!markAutomationBusy(sess, 'verifyAltSelf')) return true;
				verifyFunding(sess, altChainOf(sess), sess.plannedAltFunding.txid).then(function (evidence) {
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					var cleanEvidence = $.extend({}, evidence); delete cleanEvidence.verifiedLocally;
					publish(live, 'swap_alt_funded', { funding: cleanEvidence });
					var confs = evidence.confirmations || 0;
					if (confs >= terms.altConfirmations) {
						SWAP.safeAdvance(live, 'READY', altChainOf(live) + ' funding reached ' + terms.altConfirmations + ' confirmation(s)');
						ENGINE.saveLive(live);
					}
					slog(live.swapId, '✓ Own ' + altChainOf(live) + ' funding verified · ' + confs + '/' + terms.altConfirmations + ' confs');
					clearAutomationBusy(sess, 'verifyAltSelf');
					/* Only advance immediately when target reached; otherwise let the
					   30 s liveness tick re-check to avoid hammering the explorer API. */
					if (confs >= terms.altConfirmations) autoContinueSwap(live);
				}).fail(function (error) {
					failAutomationBusy(sess, 'verifyAltSelf', error);
					slog(sess.swapId, 'Own ' + altChainOf(sess) + ' verify pending: ' + (error && error.message || error) + backoffNote(sess, 'verifyAltSelf'));
				});
				return true;
			}
			return false;
		}
		return false;
	}

	/* ---- Stage 3: atomic settlement ----
	   Seller completes Buyer's alt-leg adaptor signature with y and broadcasts the
	   alt claim (revealing y in the real signature). Buyer recovers y from that
	   signature — via Nostr evidence or directly from the chain — completes
	   Seller's ROD adaptor signature and claims ROD. */
	function errorString(e) {
		if (!e) return 'unknown error';
		if (typeof e === 'string') return e;
		if (e.message) return e.message;
		if (e.statusText) return e.status + ' ' + e.statusText;
		if (e.responseText) return e.responseText.substring(0, 200);
		try { return JSON.stringify(e); } catch (_) { return String(e); }
	}

	function advanceSettlement(sess) {
		var terms = sess.terms;
		var execution = sess.execution || {};
		if (sess.role === 'seller') {
			/* After LTC claim, poll ROD funding outpoint to detect Buyer's
			   ROD claim on-chain — the relay swap_complete message may be
			   lost or rate-limited, so chain is the authoritative fallback. */
			if (execution.altClaim && execution.altClaim.txid) {
				if (sess.state === 'COMPLETE') return false;
				if (!markAutomationBusy(sess, 'pollRodSpend')) return true;
				ENGINE.getOutspend('ROD', sess.plannedRodFunding.txid, 0).then(function (outspend) {
					if (!outspend || !outspend.spent || !outspend.txid) {
						clearAutomationBusy(sess, 'pollRodSpend');
						return;
					}
					var live = ENGINE.restoreLive(sess.swapId) || sess;
					live.execution = live.execution || {};
					live.execution.rodClaim = $.extend({}, live.execution.rodClaim || {}, { txid: outspend.txid });
					SWAP.safeAdvance(live, 'ROD_CLAIMED', 'ROD claim detected on-chain');
					SWAP.safeAdvance(live, 'COMPLETE', 'Swap complete');
					ENGINE.saveLive(live);
					ENGINE.recordTrade(live);
					slog(live.swapId, '✓ COMPLETE — Buyer\'s ROD claim detected on-chain ' + short(outspend.txid));
					clearAutomationBusy(sess, 'pollRodSpend');
					refreshSwaps(); showActiveSwap(live.swapId); refreshHistory();
				}).fail(function (err) {
					failAutomationBusy(sess, 'pollRodSpend', err);
					slog(sess.swapId, 'ROD outpoint poll failed: ' + errorString(err) + backoffNote(sess, 'pollRodSpend'));
				});
				return true;
			}
			if (!confirmedEnough(execution.altFunding, terms.altConfirmations)) return false;
			if (!sess.remoteAltAdaptorSignature || !sess.adaptorSecret) return false;
			if (!markAutomationBusy(sess, 'claimAlt')) return true;
			ENGINE.getRodHeight().then(function (rodHeight) {
				if (rodHeight < terms.releaseRodHeight) {
					slog(sess.swapId, '' + altChainOf(sess) + ' claim waiting for release height ' + terms.releaseRodHeight + ' (current ' + rodHeight + ')');
					clearAutomationBusy(sess, 'claimAlt');
					return;
				}
				var live = ENGINE.restoreLive(sess.swapId) || sess;
				try {
					claimAltAsSeller(live).then(function (evidence) {
						var updated = ENGINE.restoreLive(live.swapId) || live;
						SWAP.safeAdvance(updated, 'ALT_CLAIMED', '' + altChainOf(updated) + ' claimed with completed adaptor signature');
						ENGINE.saveLive(updated);
						slog(updated.swapId, '✓ ' + altChainOf(updated) + ' claimed ' + evidence.txid + ' — adaptor secret is now revealed on-chain');
						clearAutomationBusy(sess, 'claimAlt');
						refreshSwaps(); showActiveSwap(updated.swapId);
					}).fail(function (error) {
						failAutomationBusy(sess, 'claimAlt', error);
						slog(sess.swapId, '' + altChainOf(sess) + ' claim blocked: ' + errorString(error) + backoffNote(sess, 'claimAlt'));
					});
				} catch (claimError) {
					clearAutomationBusy(sess, 'claimAlt');
					slog(sess.swapId, '' + altChainOf(sess) + ' claim blocked: ' + errorString(claimError));
				}
			}, function (heightError) {
				clearAutomationBusy(sess, 'claimAlt');
				slog(sess.swapId, 'ROD height check failed: ' + errorString(heightError));
			});
			return true;
		}
		if (sess.role === 'buyer') {
			/* Recover the adaptor secret from the real LTC claim signature */
			if (!sess.recoveredAdaptorSecret && sess.localAltAdaptorSignature && execution.altFunding && execution.altFunding.txid) {
				if (execution.altClaim && (execution.altClaim.completedSigHex || execution.altClaim.txhex)) {
					if (tryRecoverFromEvidence(sess)) { autoContinueSwap(ENGINE.restoreLive(sess.swapId) || sess); }
					return true;
				}
				/* Chain fallback: poll the LTC funding outpoint spend status so
				   recovery works even if every relay drops the notification. */
				if (!markAutomationBusy(sess, 'pollAltSpend')) return true;
				ENGINE.getOutspend(altChainOf(sess), sess.plannedAltFunding.txid, 0).then(function (outspend) {
					if (!outspend || !outspend.spent || !outspend.txid) {
						clearAutomationBusy(sess, 'pollAltSpend');
						return;
					}
					return ENGINE.getTxHex(altChainOf(sess), outspend.txid).then(function (txhex) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						live.execution = live.execution || {};
						live.execution.altClaim = $.extend({}, live.execution.altClaim || {}, { txid: outspend.txid, txhex: txhex });
						ENGINE.saveLive(live);
						slog(live.swapId, '← ' + altChainOf(live) + ' claim discovered on-chain ' + short(outspend.txid));
						clearAutomationBusy(sess, 'pollAltSpend');
						if (tryRecoverFromEvidence(live)) autoContinueSwap(ENGINE.restoreLive(live.swapId) || live);
					});
				}).fail(function (err) { failAutomationBusy(sess, 'pollAltSpend', err); });
				return true;
			}
			/* Claim ROD with the recovered secret */
			if (sess.recoveredAdaptorSecret && sess.remoteRodAdaptorSignature && !(execution.rodClaim && execution.rodClaim.txid)) {
				if (!markAutomationBusy(sess, 'claimRod')) return true;
				try {
					claimRodAsBuyer(sess).then(function (evidence) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						SWAP.safeAdvance(live, 'ROD_CLAIMED', 'ROD claimed with completed adaptor signature');
						SWAP.safeAdvance(live, 'COMPLETE', 'Swap complete');
						ENGINE.saveLive(live);
						ENGINE.recordTrade(live);
						publish(live, 'swap_complete', { rodClaim: { txid: evidence.txid } });
						slog(live.swapId, '✓ COMPLETE — ROD claimed ' + evidence.txid);
						clearAutomationBusy(sess, 'claimRod');
						refreshSwaps(); showActiveSwap(live.swapId); refreshHistory();
					}).fail(function (error) {
						failAutomationBusy(sess, 'claimRod', error);
						slog(sess.swapId, 'ROD claim blocked: ' + errorString(error) + backoffNote(sess, 'claimRod'));
					});
				} catch (rodClaimError) {
					clearAutomationBusy(sess, 'claimRod');
					slog(sess.swapId, 'ROD claim blocked: ' + errorString(rodClaimError));
				}
				return true;
			}
			return false;
		}
		return false;
	}

	/* Extract Buyer's completed signature from the LTC claim evidence and
	   recover the adaptor secret. recover() itself validates the candidate
	   against the adaptor point (yG == Y, or the low-S negation), so a forged
	   signature cannot inject a bogus secret. */
	function tryRecoverFromEvidence(sess) {
		if (sess.role !== 'buyer' || sess.recoveredAdaptorSecret || !sess.localAltAdaptorSignature) return false;
		var evidence = sess.execution && sess.execution.altClaim;
		if (!evidence) return false;
		var candidates = [];
		if (evidence.completedSigHex) candidates.push(evidence.completedSigHex);
		if (evidence.txhex) {
			try {
				var extracted = ENGINE.extractMultisigScriptSigSigs(evidence.txhex);
				/* Redeem order is [seller, buyer] — Buyer's completed sig is second,
				   but try every extracted signature for robustness. */
				for (var i = extracted.signatures.length - 1; i >= 0; i--) candidates.push(extracted.signatures[i]);
			} catch (extractError) { slog(sess.swapId, 'Claim scriptSig parse failed: ' + (extractError.message || extractError)); }
		}
		for (var c = 0; c < candidates.length; c++) {
			try {
				var recovered = ENGINE.recoverSecret(Crypto.util.hexToBytes(sess.localAltAdaptorSignature), candidates[c], sess.adaptorPoint);
				sess.recoveredAdaptorSecret = recovered;
				SWAP.safeAdvance(sess, 'ALT_CLAIMED', '' + altChainOf(sess) + ' claim observed');
				SWAP.safeAdvance(sess, 'SECRET_RECOVERED', 'Adaptor secret recovered from the real ' + altChainOf(sess) + ' claim signature');
				ENGINE.saveLive(sess);
				publish(sess, 'swap_secret_recovered', { recovered: true });
				slog(sess.swapId, '✓ Adaptor secret recovered from ' + altChainOf(sess) + ' claim signature (verified against adaptor point)');
				refreshSwaps();
				return true;
			} catch (recoverError) { /* try next candidate */ }
		}
		slog(sess.swapId, 'Secret recovery failed for all candidate signatures; will retry');
		return false;
	}

	/* ---- Stage 4: refund monitoring ----
	   Runs when the swap is stalled. Broadcasts the PRE-SIGNED timelocked
	   refund once the lock height passes and the funding output is still
	   unspent. An honest Seller never refunds after claiming the alt coin. */
	function checkRefunds(sess) {
		var terms = sess.terms;
		var execution = sess.execution || {};
		if (sess.state === 'COMPLETE') return;
		if (sess.role === 'seller' && sess.rodRefund && sess.rodRefund.signedHex &&
			execution.rodFunding && execution.rodFunding.txid &&
			!(execution.altClaim && execution.altClaim.txid) &&
			!(execution.rodRefund && execution.rodRefund.txid)) {
			if (!markAutomationBusy(sess, 'refundRod')) return;
			ENGINE.getRodHeight().then(function (rodHeight) {
				if (rodHeight < terms.refundRodHeight) {
					clearAutomationBusy(sess, 'refundRod');
					return;
				}
				return ENGINE.isOutpointUnspent('ROD', terms.rodFunding.multisigAddress, sess.plannedRodFunding.txid, 0).then(function (status) {
					if (!status.unspent) {
						clearAutomationBusy(sess, 'refundRod');
						slog(sess.swapId, 'ROD refund not needed: funding output already spent');
						return;
					}
					return ENGINE.broadcastTx('ROD', sess.rodRefund.signedHex).then(function (response) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						live.execution = live.execution || {};
						live.execution.rodRefund = { txid: (response && response.txid) || txidOfHex(live.rodRefund.signedHex), txhex: live.rodRefund.signedHex, broadcastAt: new Date().toISOString() };
						SWAP.markRefundState(live, 'ROD_REFUND_BROADCAST', 'Timelocked ROD refund broadcast at height ' + rodHeight);
						SWAP.markRefundState(live, (execution.altFunding && execution.altFunding.txid) ? 'ROD_REFUNDED' : 'REFUNDED', 'ROD refund accepted by network');
						ENGINE.saveLive(live);
						publish(live, 'swap_rod_refund_broadcast', { txid: live.execution.rodRefund.txid });
						if (live.state === 'REFUNDED') publish(live, 'swap_refunded', { chain: 'ROD' });
						slog(live.swapId, '✓ ROD refund broadcast ' + live.execution.rodRefund.txid + ' — funds returned to ' + terms.sellerRodRefundAddress);
						clearAutomationBusy(sess, 'refundRod');
						refreshSwaps(); showActiveSwap(live.swapId);
					});
				});
			}).fail(function (error) {
				failAutomationBusy(sess, 'refundRod', error);
				slog(sess.swapId, 'ROD refund check failed: ' + (error && error.message || error) + backoffNote(sess, 'refundRod'));
			});
			return;
		}
		if (sess.role === 'buyer' && sess.altRefund && sess.altRefund.signedHex &&
			execution.altFunding && execution.altFunding.txid &&
			!sess.recoveredAdaptorSecret &&
			!(execution.altRefund && execution.altRefund.txid)) {
			if (!markAutomationBusy(sess, 'refundAlt')) return;
			ENGINE.getAltHeight(altChainOf(sess)).then(function (altHeight) {
				if (altHeight < terms.altRefundLockHeight) {
					clearAutomationBusy(sess, 'refundAlt');
					return;
				}
				return ENGINE.isOutpointUnspent(altChainOf(sess), terms.altFunding.multisigAddress, sess.plannedAltFunding.txid, 0).then(function (status) {
					if (!status.unspent) {
						/* Spent but no secret yet → Seller claimed; recovery path
						   will pick it up via outspend polling. */
						clearAutomationBusy(sess, 'refundAlt');
						slog(sess.swapId, altChainOf(sess) + ' refund skipped: funding output spent (checking for Seller claim)');
						autoContinueSwap(ENGINE.restoreLive(sess.swapId) || sess);
						return;
					}
					return ENGINE.broadcastTx(altChainOf(sess), sess.altRefund.signedHex).then(function (response) {
						var live = ENGINE.restoreLive(sess.swapId) || sess;
						live.execution = live.execution || {};
						live.execution.altRefund = { txid: (response && response.txid) || txidOfHex(live.altRefund.signedHex), txhex: live.altRefund.signedHex, broadcastAt: new Date().toISOString() };
						SWAP.markRefundState(live, 'ALT_REFUND_BROADCAST', 'Timelocked ' + altChainOf(live) + ' refund broadcast at height ' + altHeight);
						SWAP.markRefundState(live, 'ALT_REFUNDED', altChainOf(live) + ' refund accepted by network');
						ENGINE.saveLive(live);
						publish(live, 'swap_alt_refund_broadcast', { txid: live.execution.altRefund.txid });
						slog(live.swapId, '✓ ' + altChainOf(live) + ' refund broadcast ' + live.execution.altRefund.txid + ' — funds returned to ' + terms.buyerAltRefundAddress);
						clearAutomationBusy(sess, 'refundAlt');
						refreshSwaps(); showActiveSwap(live.swapId);
					});
				});
			}).fail(function (error) {
				failAutomationBusy(sess, 'refundAlt', error);
				slog(sess.swapId, '' + altChainOf(sess) + ' refund check failed: ' + (error && error.message || error) + backoffNote(sess, 'refundAlt'));
			});
		}
	}

	function getLocalChildWif(session, chainCode) {
		if (!session.localChildPrivateKey) throw new Error('Local swap child private key is unavailable; reopen the wallet that created this session');
		return CHAINS.withChain(chainCode, function () {
			return coinjs.privkey2wif(session.localChildPrivateKey);
		});
	}

	/* Emulate OP_CHECKMULTISIG before broadcast: every signature must verify,
	   in order, against the redeem-script pubkeys [seller, buyer]. Catches a bad
	   or misattributed counterparty signature locally instead of broadcasting
	   a transaction the network is guaranteed to reject. */
	function verifyClaimSignatures(session, tx, orderedSigs) {
		var redeemPubkeys = [session.terms.sellerChildPubKey, session.terms.buyerChildPubKey];
		var sighash = Crypto.util.hexToBytes(tx.transactionHash(0, 1));
		var pubkeyIndex = 0;
		for (var i = 0; i < orderedSigs.length; i++) {
			if (!orderedSigs[i]) return false;
			var sigBytes = Crypto.util.hexToBytes(orderedSigs[i]);
			var matched = false;
			while (pubkeyIndex < redeemPubkeys.length && !matched) {
				var decompressed = coinjs.pubkeydecompress(redeemPubkeys[pubkeyIndex]);
				pubkeyIndex++;
				if (!decompressed) continue;
				try { matched = coinjs.verifySignature(sighash, sigBytes, Crypto.util.hexToBytes(decompressed)); }
				catch (verifyError) { matched = false; }
			}
			if (!matched) return false;
		}
		return true;
	}

	function txidOfHex(txhex) {
		try {
			var firstHash = Crypto.SHA256(Crypto.util.hexToBytes(txhex), { asBytes: true });
			return Crypto.util.bytesToHex(Crypto.SHA256(firstHash, { asBytes: true }).reverse());
		} catch (hashError) { return ''; }
	}

	/* Generic 2-of-2 claim broadcaster. orderedSigs MUST match the redeem
	   pubkey order [seller, buyer]; every signature is CHECKMULTISIG-verified
	   locally before broadcast. */
	function broadcastClaim(session, chainCode, orderedSigs, claimKey, messageType, extraEvidence) {
		var tx = claimTxFor(session, chainCode);
		if (!verifyClaimSignatures(session, tx, orderedSigs)) {
			throw new Error(chainCode + ' claim signatures failed local CHECKMULTISIG verification');
		}
		var redeemScript = fundingTarget(session, chainCode).redeemScript;
		ENGINE.applyMultisigSignatures(chainCode, tx, redeemScript, orderedSigs);
		var claimTxHex = tx.serialize();
		var claimTxid = txidOfHex(claimTxHex);
		slog(session.swapId, '→ Broadcasting ' + chainCode + ' claim ' + short(claimTxid));
		function persistClaimEvidence(txid, alreadyBroadcast) {
			var evidence = $.extend({
				chainCode: chainCode,
				txid: txid || claimTxid,
				txhex: claimTxHex,
				broadcastAt: new Date().toISOString()
			}, extraEvidence || {});
			if (alreadyBroadcast) evidence.alreadyInChain = true;
			saveExecution(session, claimKey, evidence);
			publish(session, messageType, evidence);
			slog(session.swapId, (alreadyBroadcast ? '✓ ' + chainCode + ' claim already known ' : '✓ ' + chainCode + ' claim broadcast ') + evidence.txid);
			return evidence;
		}
		return ENGINE.broadcastTx(chainCode, claimTxHex).then(function (response) {
			return persistClaimEvidence((response && response.txid) || claimTxid, false);
		}, function (error) {
			var message = (error && error.message) ? error.message : String(error || '');
			if (/already in block chain|already in blockchain|already have transaction|txn-already-known|transaction already in block chain/i.test(message)) {
				return persistClaimEvidence(claimTxid, true);
			}
			return $.Deferred().reject(new Error(errorString(error))).promise();
		});
	}

	/* Seller's LTC claim: her own fresh normal signature + Buyer's adaptor
	   signature COMPLETED with the adaptor secret y. Broadcasting this is the
	   act that reveals y to Buyer (he recovers it from the completed signature
	   in the real transaction). */
	function claimAltAsSeller(session) {
		if (session.role !== 'seller') throw new Error('Only Seller claims ' + altChainOf(session));
		if (!session.adaptorSecret) throw new Error('Adaptor secret unavailable; reopen the wallet that created this swap');
		if (!session.remoteAltAdaptorSignature) throw new Error('Buyer\'s ' + altChainOf(session) + ' adaptor signature has not arrived yet');
		var tx = claimTxFor(session, altChainOf(session));
		var sellerSig = ENGINE.signClaimTx(altChainOf(session), tx, getLocalChildWif(session, altChainOf(session)));
		var completedBuyerSig = ENGINE.completeSig(Crypto.util.hexToBytes(session.remoteAltAdaptorSignature), session.adaptorSecret);
		return broadcastClaim(session, altChainOf(session), [sellerSig, completedBuyerSig], 'altClaim', 'swap_alt_claimed', { completedSigHex: completedBuyerSig });
	}

	/* Buyer's ROD claim: Seller's adaptor signature completed with the RECOVERED
	   secret + his own fresh normal signature. */
	function claimRodAsBuyer(session) {
		if (session.role !== 'buyer') throw new Error('Only Buyer claims ROD');
		if (!session.recoveredAdaptorSecret) throw new Error('Adaptor secret has not been recovered from the ' + altChainOf(session) + ' claim yet');
		if (!session.remoteRodAdaptorSignature) throw new Error('Seller\'s ROD adaptor signature has not arrived yet');
		var tx = claimTxFor(session, 'ROD');
		var buyerSig = ENGINE.signClaimTx('ROD', tx, getLocalChildWif(session, 'ROD'));
		var completedSellerSig = ENGINE.completeSig(Crypto.util.hexToBytes(session.remoteRodAdaptorSignature), session.recoveredAdaptorSecret);
		return broadcastClaim(session, 'ROD', [completedSellerSig, buyerSig], 'rodClaim', 'swap_rod_claimed', { completedSigHex: completedSellerSig });
	}

	$(document).on('click', '.otcExecBtn', function () {
		var action = $(this).data('action'), session = selectedSwap(), $button = $(this);
		if (!session) { flash('warning', 'Select an active swap first'); return; }
		$button.prop('disabled', true);
		try {
			if (action === 'accept-offer') {
				acceptSession(session, 'Offer accepted by user').then(function (acceptedSession) {
					var liveAcceptedSession = ENGINE.restoreLive(acceptedSession.swapId) || acceptedSession;
					flash('success', liveAcceptedSession.remoteAccepted ? 'Offer accepted. Automatic negotiation/funding is running.' : 'Offer accepted. Waiting for counterparty accept.');
				}, function (error) {
					flash('danger', 'Swap not accepted: ' + (error && error.message || error));
				}).always(function () {
					$button.prop('disabled', false);
				});
				return;
			}
			if (action === 'decline-offer') {
				declineSession(session);
				flash('info', 'Offer declined. No automatic funding will be started.');
				$button.prop('disabled', false);
				return;
			}
			if (action === 'claim-alt') {
				if (session.role !== 'seller') throw new Error('Only Seller claims ' + altChainOf(session) + ' first');
				slog(session.swapId, '→ Claim ' + altChainOf(session) + ' requested by seller');
				claimAltAsSeller(session).then(function (evidence) {
					var liveSession = ENGINE.restoreLive(session.swapId) || session;
					SWAP.safeAdvance(liveSession, 'ALT_CLAIMED', '' + altChainOf(liveSession) + ' claimed');
					ENGINE.saveLive(liveSession);
					showActiveSwap(liveSession.swapId);
					refreshSwaps();
					slog(liveSession.swapId, '→ ' + altChainOf(liveSession) + ' claimed ' + evidence.txid);
				}).fail(function (error) { flash('warning', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'claim-rod') {
				if (session.role !== 'buyer') throw new Error('Only Buyer claims ROD after recovering the adaptor secret');
				slog(session.swapId, '→ Claim ROD requested by buyer');
				claimRodAsBuyer(session).then(function (evidence) {
					var liveSession = ENGINE.restoreLive(session.swapId) || session;
					SWAP.safeAdvance(liveSession, 'ROD_CLAIMED', 'ROD claimed');
					SWAP.safeAdvance(liveSession, 'COMPLETE', 'Swap complete');
					ENGINE.saveLive(liveSession);
					ENGINE.recordTrade(liveSession);
					publish(liveSession, 'swap_complete', { rodClaim: { txid: evidence.txid } });
					showActiveSwap(liveSession.swapId);
					refreshSwaps();
					slog(liveSession.swapId, '✓ COMPLETE ' + evidence.txid);
					refreshHistory();
				}).fail(function (error) { flash('warning', error.message || error); }).always(function () { $button.prop('disabled', false); });
				return;
			}
			if (action === 'attempt-refund') {
				slog(session.swapId, '↻ Manual refund check requested');
				checkRefunds(session);
				$button.prop('disabled', false);
				return;
			}
			if (action === 'refresh') {
				var tasks = [];
				if (session.execution && session.execution.rodFunding && session.execution.rodFunding.txid) tasks.push(verifyFunding(session, 'ROD'));
				if (session.execution && session.execution.altFunding && session.execution.altFunding.txid) tasks.push(verifyFunding(session, altChainOf(session)));
				$.when.apply($, tasks).always(function () { var liveSession = ENGINE.restoreLive(session.swapId) || session; slog(session.swapId, '↻ Refreshed funding confirmations'); autoContinueSwap(liveSession); showActiveSwap(session.swapId); $button.prop('disabled', false); });
				return;
			}
		} catch (error) {
			flash(error.message === 'Funding cancelled' ? 'info' : 'danger', error.message || String(error));
			$button.prop('disabled', false);
		}
	});

	/* Auto-fill release height; clear counterparty unless arrived via Take offer */
	$('a[href="#otcNew"]').on('shown.bs.tab', function () {
		checkWallet();
		if (!nsPrefillFromOrder) {
			clearCounterpartyFields();
		} else {
			/* consume one-shot prefill flag after showing fields */
			updateNsModeHint();
			nsPrefillFromOrder = false;
		}
		if (!$('#nsRelease').val()) {
			ENGINE.getRodHeight().then(function (h) {
				var releaseOffset = ENGINE.defaults.releaseBlocks || 120;
				var release = h + releaseOffset;
				$('#nsRelease').val(release);
				$('#nsHeightHint').text('(current: ' + h + ' + ' + releaseOffset + ')');
			}).fail(function () { $('#nsHeightHint').text('(could not fetch height)'); });
		}
	});

	function randomOrderNameSuffix() {
		var bytes = coinjs.secureRandomBytes ? coinjs.secureRandomBytes(8) : null;
		var hex = '';
		if (bytes && bytes.length) {
			for (var i = 0; i < bytes.length; i++) {
				hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
			}
		} else {
			hex = Math.abs(Date.now()).toString(16) + Math.floor(Math.random() * 1e8).toString(16);
		}
		return hex;
	}

	function buildOpenOrderPayload() {
		if (!checkWallet()) throw new Error('Open your wallet first');
		if (!swapAcct || !swapAcct.xpub) throw new Error('Swap account not ready — reopen wallet');
		var role = $('#nsRole').val();
		var myAddr = walletId.address;
		var rodAmount = $.trim($('#nsRod').val());
		var altAmount = $.trim($('#nsAlt').val());
		var releaseRodHeight = parseInt($('#nsRelease').val(), 10);
		if (!rodAmount || parseFloat(rodAmount) <= 0) throw new Error('Enter a positive ROD amount');
		if (!altAmount || parseFloat(altAmount) <= 0) throw new Error('Enter a positive ' + selectedAltChain() + ' amount');
		if (!releaseRodHeight) throw new Error('Set release ROD height');
		var orderId = myAddr + '/otc-order-' + Date.now();
		/* Compact single-line JSON is safer for name_update size limits */
		var payload = {
			version: 1,
			type: 'otc-order',
			side: role === 'seller' ? 'sell' : 'buy',
			seller: role === 'seller' ? myAddr : '',
			buyer: role === 'buyer' ? myAddr : '',
			altChain: selectedAltChain(),
			pair: 'ROD/' + selectedAltChain(),
			give: rodAmount,
			want: altAmount,
			sellerSwapXpub: role === 'seller' ? swapAcct.xpub : '',
			buyerSwapXpub: role === 'buyer' ? swapAcct.xpub : '',
			sellerAltPayoutAddress: role === 'seller' ? getWalletAddressForChain(walletId.wif, selectedAltChain()) : '',
			buyerRodPayoutAddress: role === 'buyer' ? walletId.address : '',
			releaseRodHeight: releaseRodHeight,
			orderId: orderId
		};
		var serialized = JSON.stringify(payload);
		if (serialized.length > 1023) {
			throw new Error('Order JSON is ' + serialized.length + ' chars — may exceed name value limit. Shorten fields.');
		}
		payload._bytes = serialized.length;
		return payload;
	}

	function addNameToScanList(name) {
		/* Orderbook now auto-scans ^d/otc-swap/ via name_scan; keep last name for UX only */
		var n = $.trim(name || '');
		if (n) localStorage.setItem('otcLastOrderName', n);
	}

	/* nsOrderNameGen button removed — name is now auto-generated on
	   page load, after Create Order, and on clearCounterpartyFields() */

	/* Create open order and publish full JSON to ROD name DB via Core RPC */
	$('#nsCreateOrder').on('click', function () {
		var $btn = $('#nsCreateOrder');
		try {
			var payload = buildOpenOrderPayload();
			var bytes = payload._bytes;
			delete payload._bytes;
			var name = $.trim($('#nsOrderName').val());
			if (!name) {
				name = 'd/otc-swap/' + randomOrderNameSuffix();
				$('#nsOrderName').val(name);
			}
			$('#nsSwapId').val('');
			$('#nsOffer').val(JSON.stringify(payload, null, 2));
			$('#nsPublishStatus').text('Checking wallet balance…');
			$btn.prop('disabled', true);
			ensureWalletFundsForRole($('#nsRole').val(), payload.give, payload.want).then(function () {
				/* Publish the full detail to the relays first so the name record
				   can carry its event id. The relay copy advertises NOTHING on
				   its own — until the name record below is written the order is
				   in no book. Recording the id and signing key on chain is what
				   pins the detail: it cannot later be substituted or altered. */
				var detailNote = '';
				try {
					var detail = ENGINE.publishOrderDetail(payload);
					payload.nostrEventId = detail.eventId;
					payload.nostrPubkey = detail.nostrPubkey;
					detailNote = 'Detail published to ' + detail.relays + ' relay(s). ';
					log('Order detail on relays ' + short(detail.eventId) + ' for ' + payload.orderId);
				} catch (detailError) {
					/* Not fatal: the name record can carry the order by itself,
					   it is only larger. */
					detailNote = 'Relay detail unavailable (' + (detailError.message || detailError) + '); publishing full order on chain. ';
					log(detailNote);
				}
				$('#nsOffer').val(JSON.stringify(payload, null, 2));
				$('#nsPublishStatus').text(detailNote + 'Publishing to ROD name DB…');
				return ENGINE.namePublish(name, payload);
			}).then(function (res) {
				localStorage.setItem('otcLastOrderName', res.name);
				addNameToScanList(res.name);
				var tx = res.txid || '';
				/* name_register/name_update is always a ROD chain transaction,
				   so always link to the ROD explorer regardless of which alt
				   chain is currently selected. */
				var rodNet = (coinjs.networks && coinjs.networks.ROD) || {};
				var explorer = (rodNet.explorer && rodNet.explorer.tx) || 'https://explorer.rod.spacexpanse.org/tx/';
				$('#nsPublishStatus').html(
					'Published via <b>name_' + esc(res.action) + '</b> to <code>' + esc(res.name) + '</code>' +
					(tx ? (' · txid <a href="' + esc(explorer + tx) + '" target="_blank">' + esc(short(tx)) + '</a>') : '')
				);
				flash('success', 'Order written to ROD DB (' + res.action + '): ' + res.name + (tx ? ' · ' + tx : ''));
				log('Published order → ' + res.name + ' (' + res.action + ', ' + bytes + ' bytes)' + (tx ? ' tx=' + tx : ''));
				/* Regenerate random ROD name for the next order */
				$('#nsOrderName').val('d/otc-swap/' + randomOrderNameSuffix());
				/* Name may need a confirmation before name_show returns the new value */
				setTimeout(function () { refreshBook(); }, 2000);
			}, function (err) {
				var msg = '';
				if (typeof err === 'string') msg = err;
				else if (err && err.message) msg = err.message;
				else if (err && err.error && err.error.message) msg = err.error.message;
				else try { msg = JSON.stringify(err); } catch (e2) { msg = String(err); }
				if (/passphrase|encrypted|unlocked/i.test(msg)) {
					msg += ' — unlock the wallet in ROD Core (walletpassphrase) first.';
				}
				$('#nsPublishStatus').html('<span style="color:#f1334a">Publish failed: ' + esc(msg) + '</span> <span class="text-muted">The order is NOT in the book — the ROD name record is what publishes it.</span>');
				flash('danger', 'Publish failed: ' + msg);
				log('Publish failed for ' + name + ': ' + msg);
			}).always(function () {
				$btn.prop('disabled', false);
			});
		} catch (e) {
			$btn.prop('disabled', false);
			flash('danger', (e && e.message) ? e.message : String(e));
		}
	});

	/* Start bilateral swap — requires counterparty (manual or from Dashboard Take) */
	$('#nsCreate').on('click', function () {
		var $btn = $('#nsCreate');
		try {
			if (!checkWallet()) throw new Error('Open your wallet first');
			if (!swapAcct || !swapAcct.xprv || !swapAcct.xpub) throw new Error('Swap account not ready — reopen wallet');
			var role = $('#nsRole').val(), peer = $.trim($('#nsPeer').val()), peerXpub = $.trim($('#nsPeerXpub').val());
			var peerPayoutAddress = $.trim($('#nsPeerPayoutAddr').val()) || peer;
			if (!peer) throw new Error('Take an order on the Dashboard first');
			if (!peerXpub) throw new Error('Take an order on the Dashboard first');
			if (!peerPayoutAddress) throw new Error('Take an order on the Dashboard first');
			/* The peer payout address must be an actual blockchain address, not
			   an order name or d-tag that leaked from the orderbook fallback. */
			if (/^d\//.test(peerPayoutAddress) || peerPayoutAddress.indexOf('/') !== -1) {
				throw new Error('Counterparty payout address looks like an order name ("' + peerPayoutAddress.substring(0, 30) + '…"), not a valid address. The order may be missing the seller/buyer address field.');
			}
			if (peerXpub === swapAcct.xpub) throw new Error('Counterparty xpub must differ from your swap xpub');

			/* Dust-limit validation: both the funding output AND the claim
			   output (funding minus fee) must exceed the network dust
			   threshold — otherwise the tx will be rejected by nodes. */
			var altChainCode = selectedAltChain();
			/* Dust is per-chain, and on Dogecoin it is an ABSOLUTE amount
			   (0.001 DOGE hard limit) rather than something derived from a fee
			   rate — so it cannot be paid away by bidding the fee higher. */
			/* Gate on the ECONOMICAL minimum, not the hard dust limit. On
			   Dogecoin an output between the two (0.001–0.01 DOGE) is legal but
			   adds a flat 0.01 DOGE surcharge to the relay minimum — which
			   exceeds the canonical settlement fee already fixed in the terms,
			   so the claim and refund transactions could never be signed and the
			   swap would stall permanently after passing this check. */
			var rodDust = CHAINS.minEconomicalOutputSats('ROD');
			var altDust = CHAINS.minEconomicalOutputSats(altChainCode);
			var rodSats = CHAINS.decimalToSats($('#nsRod').val());
			var altSats = CHAINS.decimalToSats($('#nsAlt').val());
			var rodClaimFeeSats = CHAINS.decimalToSats(claimFee(null, 'ROD'));
			var altClaimFeeSats = CHAINS.decimalToSats(claimFee(null, altChainCode));
			if (rodSats < rodDust) throw new Error('ROD amount (' + rodSats + ' sats) is below the dust limit (' + rodDust + ' sats). Minimum: ' + CHAINS.satsToDecimal(rodDust) + ' ROD');
			if (altSats < altDust) throw new Error(altChainCode + ' amount (' + altSats + ' base units) is below the dust limit (' + altDust + '). Minimum: ' + CHAINS.satsToDecimal(altDust) + ' ' + altChainCode);
			if (rodSats - rodClaimFeeSats < rodDust) throw new Error('ROD claim output (' + (rodSats - rodClaimFeeSats) + ' sats) would be dust after fee. Increase the ROD amount.');
			if (altSats - altClaimFeeSats < altDust) throw new Error(altChainCode + ' claim output (' + (altSats - altClaimFeeSats) + ') would be dust after fee. Increase the ' + altChainCode + ' amount.');

			$btn.prop('disabled', true);
			flash('info', 'Checking wallet balance…');

			$.when(
				ensureWalletFundsForRole(role, $('#nsRod').val(), $('#nsAlt').val(), altChainCode),
				ENGINE.getRodHeight(),
				ENGINE.getAltHeight(altChainCode)
			).then(function (balanceProof, rodHeight, altHeight) {
				try {
				var cfgNow = ENGINE.loadConfig();
				var altChainCfg = ENGINE.altChainConfig(altChainCode, cfgNow);
				var myAddr = walletId.address;
				var orderId = (role === 'seller' ? myAddr : peer) + '/otc-' + Date.now();
				var sellerIdentity = role === 'seller' ? myAddr : peer;
				var buyerIdentity = role === 'buyer' ? myAddr : peer;
				var termsNonce = randomOrderNameSuffix() + randomOrderNameSuffix();
				var swapId = SWAP.swapIdFromOrder(orderId, '1', sellerIdentity, buyerIdentity, termsNonce);
				/* Payout addresses — each side's claim tx pays to
				   their current wallet address on the destination chain.
				   LOCAL: derived from the open wallet's WIF.
				   PEER: carried from the order via peerPayoutAddress. */
				var sellerAltPayoutAddress = role === 'seller'
					? getWalletAddressForChain(walletId.wif, altChainCode)
					: peerPayoutAddress;
				var buyerRodPayoutAddress = role === 'buyer'
					? walletId.address
					: peerPayoutAddress;
				/* Refund locks: Seller (secret holder) refunds LATE on ROD, Buyer
				   refunds EARLY on the alt chain — enforced by native
				   nLockTime. The alt block count is per chain so the window is
				   the same wall-clock duration on every chain. */
				var refundRodHeight = parseInt(rodHeight, 10) + (parseInt(cfgNow.refundRodBlocks, 10) || 480);
				var altRefundLockHeight = parseInt(altHeight, 10) + (parseInt(altChainCfg.refundBlocks, 10) || 24);
				var releaseRodHeight = parseInt($('#nsRelease').val(), 10);
				if (releaseRodHeight >= refundRodHeight) {
					throw new Error('Release height ' + releaseRodHeight + ' must be below the ROD refund height ' + refundRodHeight);
				}

				var session = SWAP.createOfferSession({
					role: role, swapId: swapId, orderId: orderId,
					altChain: altChainCode,
					rodAmount: $('#nsRod').val(), altAmount: $('#nsAlt').val(),
					releaseRodHeight: $('#nsRelease').val(),
					sellerSwapAccountKey: role === 'seller' ? swapAcct.xprv : peerXpub,
					buyerSwapAccountKey: role === 'seller' ? peerXpub : swapAcct.xprv,
					sellerSwapXpub: role === 'seller' ? swapAcct.xpub : peerXpub,
					buyerSwapXpub: role === 'seller' ? peerXpub : swapAcct.xpub,
					sellerAltPayoutAddress: sellerAltPayoutAddress,
					buyerRodPayoutAddress: buyerRodPayoutAddress,
					sellerIdentity: sellerIdentity,
					buyerIdentity: buyerIdentity,
					termsNonce: termsNonce,
					refundRodHeight: refundRodHeight,
					altRefundLockHeight: altRefundLockHeight,
					rodConfirmations: parseInt(cfgNow.rodConfirmations, 10) || 1,
					altConfirmations: parseInt(altChainCfg.confirmations, 10) || 1
				});

				session.readiness = session.readiness || {};
				session.readiness.local = buildReadinessEvidence(balanceProof);

				if (role === 'seller') {
					var y = coinjs.adaptor.generateSecret();
					session.adaptorSecret = y;
					session.adaptorPoint = coinjs.adaptor.publicKey(y);
				}
				session.localNostrPubkey = NOSTR.identityFromWif(walletId.wif).pubkey || '';
				session.localNostrPrivateKey = walletId.nostrPrivateKey || NOSTR.identityFromWif(walletId.wif).privateKeyHex || '';

				ENGINE.saveLive(session);

				/* Auto-negotiate terms and readiness only; user accept/decline controls funding start. */
				SWAP.advanceState(session, 'NEGOTIATING', 'Terms sent');
				if (ENGINE.pool) {
					ENGINE.publishSwapMessage(session, 'swap_terms', { terms: session.terms });
					if (session.adaptorPoint) ENGINE.publishSwapMessage(session, 'swap_adaptor_point', { adaptorPoint: session.adaptorPoint });
					ENGINE.publishSwapMessage(session, 'swap_ready', { readiness: session.readiness.local });
					slog(session.swapId, '→ Sent terms + readiness via Nostr');
				}
				markBilateralReady(session);
				ENGINE.saveLive(session);

				$('#nsSwapId').val(session.swapId);
				$('#nsOffer').val(JSON.stringify({
					version: 1, type: 'otc-order', seller: role === 'seller' ? myAddr : peer,
					buyer: role === 'buyer' ? myAddr : peer,
					pair: pairLabel(session), altChain: altChainOf(session), give: session.terms.rodAmount, want: session.terms.altAmount,
					sellerSwapXpub: session.sellerSwapXpub, buyerSwapXpub: session.buyerSwapXpub,
					sellerAltPayoutAddress: session.terms.sellerAltPayoutAddress,
					buyerRodPayoutAddress: session.terms.buyerRodPayoutAddress,
					releaseRodHeight: session.terms.releaseRodHeight,
					termsHash: session.terms.termsHash
				}, null, 2));

				/* Clear counterparty after successful start so next visit is a clean order form */
				clearCounterpartyFields();
				refreshSwaps();
				flash('success', 'Swap created: ' + short(swapId) + '. Review details, then accept or decline.');
				} catch (createError) {
					flash('danger', (createError && createError.message) ? createError.message : String(createError));
				}
			}, function (error) {
				flash('danger', (error && error.message) ? error.message : String(error));
			}).always(function () {
				$btn.prop('disabled', false);
			});
		} catch (e) {
			$btn.prop('disabled', false);
			flash('danger', (e && e.message) ? e.message : String(e));
		}
	});

	updateNsModeHint();

	/* ============ AUTO-NEGOTIATION ============ */
	function slog(id, msg) {
		var all = ENGINE.loadLive(), s = all[id]; if (!s) return;
		s._log = s._log || [];
		s._log.push('[' + ts() + '] ' + msg);
		if (s._log.length > 80) s._log = s._log.slice(-80);
		all[id] = s; localStorage.setItem('rodOtcLive', JSON.stringify(all));
		log(msg);
	}

	function localRoleFromTerms(terms) {
		if (!checkWallet() || !swapAcct || !swapAcct.xprv || !swapAcct.xpub || !terms) return '';
		if (ENGINE.sameExtendedKey(terms.sellerSwapXpub, swapAcct.xpub)) return 'seller';
		if (ENGINE.sameExtendedKey(terms.buyerSwapXpub, swapAcct.xpub)) return 'buyer';
		return '';
	}

	/* Recovery automation must never sign or fund under whichever unrelated
	   wallet happens to be open. A fully restored session becomes active only
	   when its role-bound swap xpub matches the currently open wallet. */
	function sessionBelongsToOpenWallet(session) {
		return !!(session && session.terms && localRoleFromTerms(session.terms) === session.role);
	}

	function createIncomingTermsSession(env, eventObject, freshTips) {
		var p = env.payload || {}, terms = p.terms;
		if (env.type !== 'swap_terms' || !terms) {
			if (ENGINE.trackedSwapIds && ENGINE.trackedSwapIds[env.swapId]) log('Tracked ' + short(env.swapId) + ' ignored until swap_terms arrives; got ' + env.type);
			return null;
		}
		var all = ENGINE.loadLive();
		if (all[env.swapId]) return ENGINE.restoreLive(env.swapId) || all[env.swapId];
		var role = localRoleFromTerms(terms);
		if (!role) {
			log('Incoming terms role mismatch ' + short(env.swapId) + ': local xpub ' + short(swapAcct && swapAcct.xpub || '') + ' seller ' + short(terms.sellerSwapXpub || '') + ' buyer ' + short(terms.buyerSwapXpub || ''));
			return null;
		}
		try {
			/* Bind the swap ID to the 5-field hash so a peer cannot reuse
			   terms under a different identity or replay an old session. */
			if (terms.termsNonce) {
				var expectedSwapId = SWAP.swapIdFromOrder(terms.orderId, '1', terms.sellerIdentity, terms.buyerIdentity, terms.termsNonce);
				if (expectedSwapId !== env.swapId) {
					throw new Error('Incoming swapId does not match SHA256(orderId|rev|seller|buyer|nonce)');
				}
			}
			/* Refund-safety sanity checks before a session is even created */
			if (!(parseInt(terms.refundRodHeight, 10) > parseInt(terms.releaseRodHeight, 10))) {
				throw new Error('Incoming terms rejected: refundRodHeight must be above releaseRodHeight');
			}
			if (!(parseInt(terms.altRefundLockHeight, 10) > 0)) {
				throw new Error('Incoming terms rejected: missing alt-chain refund lock height');
			}
			/* Reject an unknown alt chain up front. Without this the rebuild
			   below would silently fall back to the default chain, and the peer
			   would only see an opaque terms-hash mismatch. The hash check that
			   follows is what actually BINDS the chain: terms are rebuilt
			   locally from terms.altChain, so a peer cannot announce one chain
			   and get signatures for another. */
			var incomingAltChain = terms.altChain || SWAP.DEFAULT_ALT_CHAIN;
			if (incomingAltChain === 'ROD' || !CHAINS.definitions[incomingAltChain]) {
				throw new Error('Incoming terms rejected: unsupported alt chain ' + incomingAltChain);
			}
			if (!freshTips) {
				throw new Error('Incoming terms rejected: current chain heights were not verified');
			}
			var refundProof = SWAP.assertRefundOrdering(terms, freshTips.rodHeight, freshTips.altHeight);
			var session = SWAP.createOfferSession({
				role: role,
				swapId: env.swapId,
				orderId: terms.orderId,
				altChain: incomingAltChain,
				rodAmount: terms.rodAmount,
				altAmount: terms.altAmount,
					releaseRodHeight: terms.releaseRodHeight,
					sellerSwapAccountKey: role === 'seller' ? swapAcct.xprv : terms.sellerSwapXpub,
					buyerSwapAccountKey: role === 'buyer' ? swapAcct.xprv : terms.buyerSwapXpub,
					sellerSwapXpub: terms.sellerSwapXpub,
					buyerSwapXpub: terms.buyerSwapXpub,
					sellerAltPayoutAddress: terms.sellerAltPayoutAddress,
				buyerRodPayoutAddress: terms.buyerRodPayoutAddress,
				sellerIdentity: terms.sellerIdentity,
				buyerIdentity: terms.buyerIdentity,
				termsNonce: terms.termsNonce,
				refundRodHeight: terms.refundRodHeight,
				altRefundLockHeight: terms.altRefundLockHeight,
				rodConfirmations: terms.rodConfirmations,
				altConfirmations: terms.altConfirmations,
				rodClaimFee: terms.rodClaimFee,
				altClaimFee: terms.altClaimFee,
				rodRefundFee: terms.rodRefundFee,
				altRefundFee: terms.altRefundFee
			});
			try {
				/* The locally rebuilt terms are authoritative. A child-key match
				   proves only one field; it cannot authenticate amounts, payout
				   addresses, fees, chain or deadlines. Any hash mismatch is final
				   and remote terms are never copied over the local reconstruction. */
				SWAP.assertMatchingTermsHash(session.terms, terms);
			} catch (termsError) {
				if (SWAP.removeSession) SWAP.removeSession(env.swapId);
				ENGINE.removeLive(env.swapId);
				log('Incoming terms hash mismatch ' + short(env.swapId) + ': local ' +
					short(session.terms && session.terms.termsHash || '') + ' remote ' +
					short(terms.termsHash || ''));
				throw termsError;
			}
			session._refundSafety = session._refundSafety || {};
			session._refundSafety.incoming = $.extend({
				checkedAt: Date.now(),
				termsHash: session.terms.termsHash
			}, refundProof);
			if (eventObject) {
				ensureRemotePeer(session, eventObject);
				try { SWAP.addMessage(env.swapId, eventObject); } catch (messageError) {}
			}
			/* Seller must generate the adaptor secret when receiving
			   incoming terms, just as she does in the Create button path.
			   Without this, the adaptor point is never published and the
			   swap deadlocks after refund exchange. */
			if (role === 'seller' && !session.adaptorSecret && !session._ea && !session.adaptorPoint) {
				var y = coinjs.adaptor.generateSecret();
				session.adaptorSecret = y;
				session.adaptorPoint = coinjs.adaptor.publicKey(y);
			}
			session.localNostrPubkey = NOSTR.identityFromWif(walletId.wif).pubkey || '';
			session.localNostrPrivateKey = walletId.nostrPrivateKey || NOSTR.identityFromWif(walletId.wif).privateKeyHex || '';
			SWAP.safeAdvance(session, 'NEGOTIATING', 'Incoming terms received');
			ENGINE.saveLive(session);
			/* Publish adaptor point immediately so Buyer receives it via relay */
			if (session.adaptorPoint) {
				publish(session, 'swap_adaptor_point', { adaptorPoint: session.adaptorPoint });
				slog(env.swapId, '→ Adaptor point published (incoming session)');
			}
			$('#otcTrackSwapStatus').html('Added <code>' + esc(short(env.swapId)) + '</code> from incoming terms.');
			slog(env.swapId, '← Created incoming ' + (role === 'seller' ? 'seller' : 'buyer') + ' session from terms');
			ensureWalletFundsForRole(role, terms.rodAmount, terms.altAmount, altChainOf(terms)).then(function (balanceProof) {
				saveLocalReadiness(session, buildReadinessEvidence(balanceProof), '→ Sent local readiness proof');
			}, function (error) {
				var fallbackReadiness = buildLocalReadinessUnchecked(role, terms.rodAmount, terms.altAmount, 'Balance check blocked: ' + error, altChainOf(terms));
				saveLocalReadiness(session, fallbackReadiness, '⚠ Sent unverified local readiness after balance check failed: ' + error);
				flash('warning', 'Readiness sent without balance verification: ' + error);
			});
			return session;
		} catch (error) {
			if (SWAP.removeSession) SWAP.removeSession(env.swapId);
			ENGINE.removeLive(env.swapId);
			log('Incoming terms rejected ' + short(env.swapId) + ': ' + (error.message || error));
			flash('warning', 'Incoming swap terms rejected: ' + (error.message || error));
			return null;
		}
	}

	var incomingTermsChecks = {};
	function queueIncomingTermsSession(env, eventObject) {
		if (incomingTermsChecks[env.swapId]) return;
		var terms = env.payload && env.payload.terms;
		var chainCode = terms && String(terms.altChain || SWAP.DEFAULT_ALT_CHAIN).toUpperCase();
		if (!terms || chainCode === 'ROD' || !CHAINS.definitions[chainCode]) {
			createIncomingTermsSession(env, eventObject, null);
			return;
		}
		incomingTermsChecks[env.swapId] = true;
		$.when(ENGINE.getRodHeight(), ENGINE.getAltHeight(chainCode)).then(function (rodHeight, altHeight) {
			delete incomingTermsChecks[env.swapId];
			var created = createIncomingTermsSession(env, eventObject, {
				rodHeight: scalarResult(rodHeight),
				altHeight: scalarResult(altHeight)
			});
			if (created) autoProcess(env, eventObject);
		}, function (error) {
			delete incomingTermsChecks[env.swapId];
			if (eventObject && eventObject.id && ENGINE.forgetSeenEventId) ENGINE.forgetSeenEventId(eventObject.id);
			log('Incoming terms deferred ' + short(env.swapId) + ': could not verify current refund ordering: ' + (error && error.message || error));
			flash('warning', 'Incoming swap terms were not accepted because current chain heights could not be verified.');
			setTimeout(function () { queueIncomingTermsSession(env, eventObject); }, 30000);
		});
	}

	function autoProcess(env, eventObject) {
		if (ENGINE.trackedSwapIds && ENGINE.trackedSwapIds[env.swapId]) {
			$('#otcTrackSwapStatus').html('Heard <code>' + esc(short(env.swapId)) + '</code> event type <code>' + esc(env.type) + '</code>.');
		}
		var all = ENGINE.loadLive(), sess = all[env.swapId];
		if (!sess) {
			if (env.type === 'swap_terms') queueIncomingTermsSession(env, eventObject);
			return;
		}
		/* Decrypt keys */
		var pw = ENGINE.walletPassword();
		if (sess._ep && pw) { try { sess.localChildPrivateKey = CryptoJS.AES.decrypt(sess._ep, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (sess._ea && pw) { try { sess.adaptorSecret = CryptoJS.AES.decrypt(sess._ea, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		if (sess._en && pw) { try { sess.localNostrPrivateKey = CryptoJS.AES.decrypt(sess._en, pw).toString(CryptoJS.enc.Utf8); } catch (e) {} }
		var p = env.payload || {};
		/* Authentication is an envelope-wide boundary, not a per-handler option.
		   validateEnvelope() has already verified the Schnorr signature; now bind
		   that signer to the ROD identity in the canonical terms before ANY
		   payload, including the adaptor-point commitment, is inspected. */
		try {
			ensureRemotePeer(sess, eventObject);
		} catch (peerAuthError) {
			slog(env.swapId, 'Rejected OTC message: ' + (peerAuthError.message || peerAuthError));
			return;
		}

		/* The adaptor point is a COMMITMENT, not a mutable field. Seller
		   re-publishes it on every tick until remotePrepared, so duplicates are
		   normal and idempotent. A CHANGED point after we have already built an
		   adaptor signature against the old one is not recoverable: our
		   localAltAdaptorSignature is encrypted to the old Y, so recoverSecret()
		   against a new Y fails for every candidate. Pin the first value we act
		   on and treat any later disagreement as a protocol fault. */
		if (env.type === 'swap_adaptor_point' && p.adaptorPoint) {
			if (!sess.adaptorPoint) {
				sess.adaptorPoint = p.adaptorPoint;
				slog(env.swapId, '← Adaptor point received');
				ENGINE.saveLive(sess);
			} else if (sess.adaptorPoint !== p.adaptorPoint) {
				var pinned = !!(sess.localAltAdaptorSignature || sess.localRodAdaptorSignature || sess.localPrepared);
				if (pinned) {
					if (!sess._adaptorPointConflict) {
						sess._adaptorPointConflict = true;
						ENGINE.saveLive(sess);
						slog(env.swapId, '✗ Counterparty sent a DIFFERENT adaptor point after signatures were committed — ignoring it. Their wallet likely regenerated its secret; this swap must be refunded rather than settled.');
						flash('danger', 'Adaptor point conflict on swap ' + short(env.swapId) + ' — settlement is unsafe; let the refund timer run.');
					}
				} else {
					/* Nothing committed yet: adopting the newer point is safe. */
					sess.adaptorPoint = p.adaptorPoint;
					slog(env.swapId, '← Adaptor point updated (no signatures committed yet)');
					ENGINE.saveLive(sess);
				}
			}
		}
		if (env.type === 'swap_ready' && p.readiness) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError0) { slog(env.swapId, peerError0.message || peerError0); return; }
			sess.readiness = sess.readiness || {};
			sess.readiness.remote = p.readiness;
			slog(env.swapId, '← Remote readiness proof received');
			markBilateralReady(sess);
			ENGINE.saveLive(sess);
			refreshSwaps();
			autoContinueSwap(sess);
		}
		if (env.type === 'swap_accept') {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError1) { slog(env.swapId, peerError1.message || peerError1); return; }
			sess.remoteAccepted = true;
			if (sess.localAccepted) SWAP.safeAdvance(sess, 'TERMS_ACCEPTED', 'Both peers accepted offer');
			slog(env.swapId, '← Counterparty accepted offer');
			ENGINE.saveLive(sess);
			refreshSwaps();
			autoContinueSwap(sess);
		}
		if (env.type === 'swap_decline') {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError2) { slog(env.swapId, peerError2.message || peerError2); return; }
			sess.declined = true;
			sess.declinedAt = new Date().toISOString();
			slog(env.swapId, '← Counterparty declined offer');
			ENGINE.saveLive(sess);
			refreshSwaps();
		}
		/* --- Pre-funding protocol messages --- */
		if (env.type === 'swap_rod_funding_planned' && p.txid && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorP1) { slog(env.swapId, peerErrorP1.message || peerErrorP1); return; }
			if (sess.role === 'buyer' && !(sess.plannedRodFunding && sess.plannedRodFunding.txid)) {
				sess.plannedRodFunding = { txid: p.txid, vout: p.vout || 0, value: p.value, amount: p.amount };
				slog(env.swapId, '← Seller planned ROD funding ' + short(p.txid) + ' (not yet broadcast)');
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_alt_funding_planned' && p.txid && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorP2) { slog(env.swapId, peerErrorP2.message || peerErrorP2); return; }
			if (sess.role === 'seller' && !(sess.plannedAltFunding && sess.plannedAltFunding.txid)) {
				sess.plannedAltFunding = { txid: p.txid, vout: p.vout || 0, value: p.value, amount: p.amount };
				slog(env.swapId, '← Buyer planned ' + altChainOf(sess) + ' funding ' + short(p.txid) + ' (not yet broadcast)');
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		/* Refund signature exchange and adaptor signatures are ORDER-SENSITIVE
		   (they need the planned-funding announcement first). Payloads are
		   stashed in pending slots and consumed by processPendingProtocol(),
		   which runs both here and from the automation tick, so out-of-order
		   relay delivery can never deadlock the handshake. The receiving side
		   always rebuilds the refund/claim TEMPLATE ITSELF from canonical
		   terms + the planned outpoint and verifies against that self-built
		   sighash — nothing signed here is taken on trust from the wire. */
		if (env.type === 'swap_rod_refund_signature' && p.signature && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorR1) { slog(env.swapId, peerErrorR1.message || peerErrorR1); return; }
			if (sess.role === 'buyer' && p.from === 'seller' && !sess.rodRefundCosigned) {
				sess._pendingRodRefundSig = p.signature;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
			if (sess.role === 'seller' && p.from === 'buyer' && sess.rodRefund && sess.rodRefund.localSig && !sess.rodRefund.signedHex) {
				sess._pendingRodRefundCosig = p.signature;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_alt_refund_signature' && p.signature && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorR2) { slog(env.swapId, peerErrorR2.message || peerErrorR2); return; }
			if (sess.role === 'seller' && p.from === 'buyer' && !sess.altRefundCosigned) {
				sess._pendingAltRefundSig = p.signature;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
			if (sess.role === 'buyer' && p.from === 'seller' && sess.altRefund && sess.altRefund.localSig && !sess.altRefund.signedHex) {
				sess._pendingAltRefundCosig = p.signature;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_alt_adaptor_signature' && p.hex && !isLocalEcho(sess, eventObject)) {
			if (sess.role === 'seller' && !sess.remoteAltAdaptorSignature) {
				sess._pendingAltAdaptorSig = p.hex;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_rod_adaptor_signature' && p.hex && !isLocalEcho(sess, eventObject)) {
			if (sess.role === 'buyer' && !sess.remoteRodAdaptorSignature) {
				sess._pendingRodAdaptorSig = p.hex;
				ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_prepared' && !isLocalEcho(sess, eventObject)) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerErrorP3) { slog(env.swapId, peerErrorP3.message || peerErrorP3); return; }
			sess.remotePrepared = true;
			slog(env.swapId, '← Counterparty PREPARED');
			ENGINE.saveLive(sess);
			autoContinueSwap(sess);
		}
		if (env.type === 'swap_rod_funded' && p.funding) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError3) { slog(env.swapId, peerError3.message || peerError3); return; }
			/* Gate: on-chain funding evidence must match the PLANNED txid the
			   refunds and adaptor signatures were built against. */
			if (sess.plannedRodFunding && p.funding.txid && p.funding.txid !== sess.plannedRodFunding.txid) {
				slog(env.swapId, '✗ ROD funding evidence txid does not match planned funding — ignored');
			} else {
				/* Merge (not replace) so locally-derived fields survive, and strip
				   verifiedLocally: remote claims are never local verification. */
				var rodEvidence = $.extend({}, p.funding); delete rodEvidence.verifiedLocally;
				sess.execution = sess.execution || {};
				sess.execution.rodFunding = $.extend({}, sess.execution.rodFunding || {}, rodEvidence);
				try { SWAP.safeAdvance(sess, 'SELLER_ROD_FUNDED', 'Remote ROD funding evidence'); } catch (e1) {}
				slog(env.swapId, '← ROD funding evidence'); ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_alt_funded' && p.funding) {
			try { ensureRemotePeer(sess, eventObject); } catch (peerError4) { slog(env.swapId, peerError4.message || peerError4); return; }
			if (sess.plannedAltFunding && p.funding.txid && p.funding.txid !== sess.plannedAltFunding.txid) {
				slog(env.swapId, '✗ ' + altChainOf(sess) + ' funding evidence txid does not match planned funding — ignored');
			} else {
				var altEvidence = $.extend({}, p.funding); delete altEvidence.verifiedLocally;
				sess.execution = sess.execution || {};
				sess.execution.altFunding = $.extend({}, sess.execution.altFunding || {}, altEvidence);
				try { SWAP.safeAdvance(sess, 'BUYER_ALT_FUNDED', 'Remote ' + altChainOf(sess) + ' funding evidence'); } catch (e2) {}
				slog(env.swapId, '← ' + altChainOf(sess) + ' funding evidence'); ENGINE.saveLive(sess);
				autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_alt_claimed' && !isLocalEcho(sess, eventObject)) {
			sess.execution = sess.execution || {};
			sess.execution.altClaim = $.extend({}, sess.execution.altClaim || {}, p);
			try { SWAP.safeAdvance(sess, 'ALT_CLAIMED', 'Remote ' + altChainOf(sess) + ' claim evidence'); } catch (e3) {}
			slog(env.swapId, '← ' + altChainOf(sess) + ' claimed evidence'); ENGINE.saveLive(sess);
			if (sess.role === 'buyer') {
				if (tryRecoverFromEvidence(sess)) autoContinueSwap(ENGINE.restoreLive(sess.swapId) || sess);
				else autoContinueSwap(sess);
			}
		}
		if (env.type === 'swap_rod_refund_broadcast' && !isLocalEcho(sess, eventObject)) {
			sess.execution = sess.execution || {};
			sess.execution.rodRefund = $.extend({}, sess.execution.rodRefund || {}, { txid: p.txid || '' });
			try {
				var altClaimedBySeller = !!(sess.execution.altClaim && sess.execution.altClaim.txid);
				SWAP.markRefundState(sess, altClaimedBySeller ? 'PARTIALLY_SETTLED' : (sess.state === 'ALT_REFUNDED' ? 'REFUNDED' : 'ROD_REFUNDED'), 'Counterparty broadcast ROD refund');
			} catch (refundStateError1) {}
			slog(env.swapId, '← ROD refund broadcast by counterparty'); ENGINE.saveLive(sess);
			refreshSwaps();
		}
		if (env.type === 'swap_alt_refund_broadcast' && !isLocalEcho(sess, eventObject)) {
			sess.execution = sess.execution || {};
			sess.execution.altRefund = $.extend({}, sess.execution.altRefund || {}, { txid: p.txid || '' });
			try {
				SWAP.markRefundState(sess, (sess.state === 'ROD_REFUNDED' || sess.state === 'REFUNDED') ? 'REFUNDED' : 'ALT_REFUNDED', 'Counterparty broadcast ' + altChainOf(sess) + ' refund');
			} catch (refundStateError2) {}
			slog(env.swapId, '← ' + altChainOf(sess) + ' refund broadcast by counterparty'); ENGINE.saveLive(sess);
			refreshSwaps();
		}
		if (env.type === 'swap_refunded' && !isLocalEcho(sess, eventObject)) {
			try { SWAP.markRefundState(sess, 'REFUNDED', 'Counterparty reported swap refunded'); } catch (refundStateError3) {}
			slog(env.swapId, '← Swap refunded'); ENGINE.saveLive(sess);
			refreshSwaps();
		}
		if (env.type === 'swap_secret_recovered' && !isLocalEcho(sess, eventObject)) {
			try { SWAP.safeAdvance(sess, 'SECRET_RECOVERED', 'Remote secret recovery evidence'); } catch (e4) {}
			slog(env.swapId, '← Secret recovery evidence'); ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_rod_claimed' && !isLocalEcho(sess, eventObject)) {
			sess.execution = sess.execution || {}; sess.execution.rodClaim = p;
			try { SWAP.safeAdvance(sess, 'ROD_CLAIMED', 'Remote ROD claim evidence'); } catch (e5) {}
			slog(env.swapId, '← ROD claimed evidence'); ENGINE.saveLive(sess);
		}
		if (env.type === 'swap_complete' && !isLocalEcho(sess, eventObject)) {
			sess.state = 'COMPLETE'; ENGINE.saveLive(sess);
			ENGINE.recordTrade(sess);
			slog(env.swapId, '✓ COMPLETE');
			refreshHistory();
		}
		showActiveSwap(sess.swapId);
		refreshSwaps();
	}

	/* ============ HISTORY ============ */
	function refreshHistory() {
		var h = ENGINE.getHistory();
		$('#otcHistBody').html(h.map(function (t) {
			var counterCurrency = t.altChain || (t.pair ? String(t.pair).split('/')[1] : '') || DEFAULT_ALT_CHAIN;
			return '<tr><td>' + esc((t.completedAt || '').slice(0, 16)) + '</td><td><code style="font-size:10px;word-break:break-all">' + esc(t.swapId) + '</code></td><td>' + esc(t.role) + '</td><td>' + esc(t.rodAmount) + '</td><td>' + esc(t.altAmount) + ' <span style="font-size:10px;color:#7fa6ba">' + esc(counterCurrency) + '</span></td><td><span class="label label-' + (t.state === 'COMPLETE' ? 'success' : 'default') + '">' + esc(t.state) + '</span></td></tr>';
		}).join('') || '<tr><td colspan="6" class="text-muted">No trades yet.</td></tr>');
	}
	$('#otcClearHist').on('click', function () { ENGINE.clearHistory(); refreshHistory(); });
	refreshHistory();

	/* ============ SETTINGS ============ */
	$('#cfgSaveApi').on('click', function () {
		var c = ENGINE.loadConfig();
		var def = ENGINE.defaults || {};
		c.relays = $('#cfgRelays').val().split('\n').map($.trim).filter(Boolean);
		if (!c.relays.length) {
			c.relays = (ENGINE.DEFAULT_RELAYS || def.relays || []).slice();
			$('#cfgRelays').val(c.relays.join('\n'));
		}
		ENGINE.saveConfig(c);
		/* Apply new relay list immediately (old pool ignored post-save before). */
		startNostr(true);
		log('Relays updated: ' + c.relays.join(', '));
		flash('success', 'Relay settings saved — reconnecting to ' + c.relays.length + ' relay(s).');
		refreshRelayStatus();
	});
	$('#cfgSaveRpc').on('click', function () {
		var c = ENGINE.loadConfig();
		c.rpcUrl = $.trim($('#cfgRpcUrl').val()); c.rpcPort = $.trim($('#cfgRpcPort').val()) || '11999';
		c.rpcUser = $.trim($('#cfgRpcUser').val()); c.rpcPass = $('#cfgRpcPass').val();
		c.rpcWallet = $.trim($('#cfgRpcWallet').val());
		var ep = c.rpcUrl ? ENGINE.buildRpcEndpoint(c) : null;
		if (ep && ep.user && !c.rpcUser) {
			c.rpcUser = ep.user; c.rpcPass = ep.pass;
			$('#cfgRpcUser').val(ep.user); $('#cfgRpcPass').val(ep.pass);
		}
		// Do not point the browser name-helper at raw Core RPC (not CORS-safe).
		ENGINE.saveConfig(c);
		updateRpcEndpointHint();
		flash('success', 'RPC settings saved locally' + (ep ? ' → ' + ep.url : '') + '.');
		refreshRpcStatus();
	});
	$('#cfgRunTests').on('click', function () {
		try {
			var r = rodOtc.validation.runAll();
			if (r.passed) {
				$('#cfgTestR').html('<span style="color:#62e6a6">All ' + r.results.length + ' tests passed ✓</span>');
			} else {
				var failedNames = [];
				for (var ti = 0; ti < r.results.length; ti++) {
					if (!r.results[ti].passed) failedNames.push(r.results[ti].name || ('Test ' + (ti + 1)));
				}
				$('#cfgTestR').html('<span style="color:#f1334a">Failed ✗</span> <span style="font-size:11px;color:#f0ad4e">' + esc(failedNames.join(', ')) + '</span>');
			}
		} catch (testError) {
			$('#cfgTestR').html('<span style="color:#f1334a">Error ✗</span> <span style="font-size:11px;color:#f0ad4e">' + esc(testError.message || String(testError)) + '</span>');
		}
	});
	$('#cfgExport').on('click', function () {
		try {
			$('#cfgBackup').val(ENGINE.exportRecoveryState());
			flash('success', 'Exported recoverable OTC backup with live sessions, refund transactions, settings, and history.');
		} catch (e) {
			flash('danger', e.message || String(e));
		}
	});
	$('#cfgImport').on('click', function () {
		try {
			var result = ENGINE.importRecoveryState($('#cfgBackup').val());
			$('#cfgRelays').val((ENGINE.loadConfig().relays || ENGINE.DEFAULT_RELAYS).join('\n'));
			startNostr(true);
			resetAutomationBackoff();
			var awaitingWallet = 0;
			var activeRestored = 0;
			for (var ri = 0; ri < result.importedSwapIds.length; ri++) {
				var importedSwapId = result.importedSwapIds[ri];
				try { if (ENGINE.trackSwapId) ENGINE.trackSwapId(importedSwapId); } catch (trackError) {}
				var restored = ENGINE.restoreLive(importedSwapId);
				if (restored && !isTerminal(restored)) {
					activeRestored++;
					if (sessionBelongsToOpenWallet(restored)) autoContinueSwap(restored);
					else awaitingWallet++;
				}
			}
			refreshSwaps();
			refreshHistory();
			flash(awaitingWallet ? 'warning' : 'success',
				'Imported recoverable OTC backup: ' + result.sessions + ' live session(s) and ' +
				result.hexBlobs + ' transaction blob(s) restored.' +
				(awaitingWallet
					? ' Open the same wallet that created ' + awaitingWallet + ' active swap(s) to resume them.'
					: (activeRestored ? ' Active swaps resumed.' : ' No active swap required resuming.')));
		} catch (e) { flash('danger', e.message); }
	});

	/* ============ INIT ============ */
	/* Automation locks are per-attempt, not durable state: clear any that a
	   previous page run left behind, then resume automation for every live
	   session so a reload never strands a swap mid-flow. */
	(function resumeAfterReload() {
		var all = ENGINE.loadLive(), changed = false;
		for (var id in all) {
			if (all[id] && all[id].automation) { delete all[id].automation; changed = true; }
		}
		if (changed) localStorage.setItem('rodOtcLive', JSON.stringify(all));
		setTimeout(function () {
			var sessions = ENGINE.loadLive();
			for (var swapId in sessions) {
				var restored = ENGINE.restoreLive(swapId);
				if (restored && !isTerminal(restored) && sessionBelongsToOpenWallet(restored)) {
					try { autoContinueSwap(restored); } catch (e) { log('Resume failed for ' + short(swapId) + ': ' + (e.message || e)); }
				}
			}
		}, 4000); /* give relays time to connect first */
	})();
	startNostr();
	refreshConnStatus();
	/* Liveness tick: automation used to advance only on incoming Nostr events
	   or manual refresh, so one failed verify (e.g. API 404 right after
	   broadcast) stranded the swap. Re-drive every live session periodically;
	   markAutomationBusy() locks keep this idempotent and non-overlapping.
	   The tick also runs the refund monitor, so a disappeared counterparty
	   leads to an automatic timelocked refund instead of stranded funds. */
	setInterval(function () {
		var liveSessions = ENGINE.loadLive();
		for (var liveSwapId in liveSessions) {
			var liveSession = ENGINE.restoreLive(liveSwapId);
			if (liveSession && !isTerminal(liveSession) && sessionBelongsToOpenWallet(liveSession)) {
				try { autoContinueSwap(liveSession); } catch (tickError) {}
			}
		}
	}, parseInt(ENGINE.loadConfig().tickMs, 10) || 30000);
	setInterval(function () {
		if ($('#otc').is(':visible')) refreshRelayStatus();
	}, 5000);
	setInterval(function () {
		if ($('#otc').is(':visible')) refreshRpcStatus();
	}, 30000);
	/* Generate random ROD name on every page load */
	$('#nsOrderName').val('d/otc-swap/' + randomOrderNameSuffix());
	refreshAltChainLabels();
	refreshSwaps();
	log('OTC swap app ready — Nostr connecting automatically');
});
