$(document).ready(function() {

function captchaPassed(){
var value = $("#captcha").val();
return typeof value === "string" && value !== "1";
}

/* open wallet code */

	var explorer_tx = "https://explorer.rod.spacexpanse.org/tx/"
	var explorer_addr = "https://explorer.rod.spacexpanse.org/address/"
	var explorer_block = "https://explorer.rod.spacexpanse.org/blocks/"

	var wallet_timer = false;
	var openWalletData = false;
	var WALLET_SESSION_KEY = 'rodWalletSession';
	var ACTIVE_COIN_KEY = 'rodActiveCoin';

	/* Balance requests outlive network switches.  Keep request ownership in an
	   epoch instead of using the loader's visibility as application state: a
	   late DGB explorer callback must never overwrite (or block) a newer ROD,
	   LTC, DOGE, BTC, or BCH request. */
	function createWalletBalanceRequestEpoch(){
		var epoch = 0;
		var pending = false;

		function matches(request, networkCode, address){
			return !!(
				request &&
				pending &&
				request.epoch === epoch &&
				pending.epoch === request.epoch &&
				request.networkCode === networkCode &&
				request.address === address
			);
		}

		return {
			reset: function(){
				epoch += 1;
				pending = false;
			},
			begin: function(networkCode, address){
				if(pending && pending.networkCode === networkCode && pending.address === address){
					return false;
				}
				pending = {
					epoch: ++epoch,
					networkCode: networkCode,
					address: address
				};
				return pending;
			},
			isCurrent: matches,
			finish: function(request, networkCode, address){
				if(!matches(request, networkCode, address)){
					return false;
				}
				pending = false;
				return true;
			}
		};
	}

	var walletBalanceRequests = createWalletBalanceRequestEpoch();

	/* Any coin registered in coinjs.networks is selectable; unknown values fall
	   back to ROD so a stale localStorage entry cannot leave the wallet on a
	   network that no longer exists. */
	function normalizeCoinCode(code){
		var c = String(code || 'ROD').toUpperCase();
		return (coinjs.networks && coinjs.networks[c]) ? c : 'ROD';
	}

	/* The Coins menu is registry-driven. Adding a profile must not require a
	   second, easily forgotten edit to index.html. Attestation affects only
	   grouping/copy here; every entry remains an ordinary wallet network. */
	function renderWalletCoinMenu(){
		var $menu = $('#walletCoinMenu');
		if(!$menu.length) return;
		$menu.empty();
		var groups = [
			{ status: 'attested', label: 'Swap attested' },
			{ status: 'wallet-only', label: 'Wallet only' }
		];
		for(var groupIndex = 0; groupIndex < groups.length; groupIndex++){
			var group = groups[groupIndex];
			var groupCodes = [];
			for(var code in coinjs.networks){
				if(coinjs.networks.hasOwnProperty(code) && coinjs.networks[code].swapStatus === group.status){
					groupCodes.push(code);
				}
			}
			groupCodes.sort();
			if(!groupCodes.length) continue;
			if($menu.children().length) $menu.append($('<li>').addClass('divider'));
			$menu.append($('<li>').addClass('dropdown-header').text(group.label));
			for(var codeIndex = 0; codeIndex < groupCodes.length; codeIndex++){
				var chainCode = groupCodes[codeIndex];
				var network = coinjs.networks[chainCode];
				var routeStatus = network.routeStatus || { status: 'community-run', label: 'Community-run route · external server' };
				var routeClass = routeStatus.status === 'attested-hosted' ? 'coin-route-hosted' : 'coin-route-community';
				var $attested = network.swapStatus === 'attested' || network.swapStatus === 'certified'
					? $('<span>').addClass('glyphicon glyphicon-ok-sign coin-attested ' + routeClass).attr('title', routeStatus.label)
					: $('<span>').addClass('glyphicon glyphicon-briefcase coin-wallet-only').attr('title', 'Wallet only');
				var $link = $('<a>').attr('href', 'javascript:;').addClass('walletCoinSelect').attr('data-coin', chainCode);
				$link.append($attested).append(document.createTextNode(' ' + chainCode + ' '));
				$link.append($('<small>').addClass('text-muted').text(network.shortName || network.name || chainCode));
				$menu.append($('<li>').addClass('wallet-coin-item').attr('data-coin', chainCode).append($link));
			}
		}
	}


	function chainInfoEsc(value){
		return $('<span>').text(value == null ? '' : String(value)).html();
	}

	function chainInfoHex(value, width){
		var hex = Number(value).toString(16);
		while(hex.length < (width || 2)) hex = '0' + hex;
		return '0x' + hex;
	}

	function chainInfoSafeLink(url, label){
		if(typeof url !== 'string' || !/^https:\/\//.test(url)) return chainInfoEsc(label || url || '—');
		return '<a href="' + chainInfoEsc(url) + '" target="_blank" rel="noopener noreferrer">' + chainInfoEsc(label || url) + '</a>';
	}

	function chainInfoCodeFromHash(){
		var match = String(window.location.hash || '').match(/^#chain\/([A-Z0-9]{2,10})$/i);
		return match ? normalizeCoinCode(match[1]) : '';
	}

	function renderChainInfoNavigation(selectedCode){
		var registry = window.spexChainRegistry;
		var $list = $('#chainInfoList');
		if(!$list.length || !registry) return;
		$list.empty();
		registry.codes().forEach(function(code){
			var profile = registry.getProfile(code);
			var attested = profile.swap.status === 'attested' || profile.swap.status === 'certified';
			var routeStatus = registry.routeStatusForChain(code);
			var routeClass = routeStatus.status === 'attested-hosted' ? 'chain-route-hosted' : 'chain-route-community';
			var $link = $('<a>')
				.attr('href', '#chain/' + code)
				.attr('data-chain', code)
				.addClass('list-group-item chainInfoSelect' + (code === selectedCode ? ' active' : ''));
			$link.append($('<span>').addClass('chain-info-code').text(code));
			if(attested){
				$link.append($('<span>').addClass('glyphicon glyphicon-ok-sign chain-info-attested ' + routeClass).attr('title', routeStatus.label));
			} else {
				$link.append($('<span>').addClass('glyphicon glyphicon-briefcase chain-info-wallet-only').attr('title', 'Wallet only'));
			}
			$link.append($('<span>').addClass('chain-info-name').text(profile.shortName || profile.name));
			$list.append($link);
		});
	}

	function chainInfoRows(profile){
		var rows = [
			['Ticker / unit', profile.code + ' / ' + profile.unit],
			['URI prefix', profile.uriPrefix + ':'],
			['P2PKH version', profile.address.pub + ' (' + chainInfoHex(profile.address.pub) + ')'],
			['WIF version', profile.address.priv + ' (' + chainInfoHex(profile.address.priv) + ')'],
			['P2SH version', profile.address.multisig + ' (' + chainInfoHex(profile.address.multisig) + ')'],
			['HD private', chainInfoHex(profile.hdkey.prv, 8)],
			['HD public', chainInfoHex(profile.hdkey.pub, 8)],
			['SegWit', profile.segwit === false ? 'Not supported' : 'Supported'],
			['Bech32 HRP', profile.bech32.hrp || 'Not available'],
			['API adapter', profile.api.type]
		];
		if(profile.swap.status === 'attested' || profile.swap.status === 'certified'){
			rows.push(['Transaction model', profile.swap.transactionModel]);
			rows.push(['Curve / signature', profile.swap.curve + ' / ' + profile.swap.signature]);
			rows.push(['Escrow', profile.swap.escrow]);
			rows.push(['Sighash', profile.swap.sighash]);
			rows.push(['Timelock', profile.swap.timelock]);
			rows.push(['Target block time', profile.swap.blockSeconds + ' seconds']);
			rows.push(['Confirmations', profile.swap.confirmations]);
			rows.push(['Asset / payment refunds', profile.swap.refundBlocks.asset + ' / ' + profile.swap.refundBlocks.payment + ' blocks']);
		}
		return rows.map(function(row){
			return '<tr><th>' + chainInfoEsc(row[0]) + '</th><td><code>' + chainInfoEsc(row[1]) + '</code></td></tr>';
		}).join('');
	}

	function renderChainInfo(code){
		var registry = window.spexChainRegistry;
		var normalized = normalizeCoinCode(code || getActiveCoin());
		var $content = $('#chainInfoContent');
		if(!$content.length || !registry) return normalized;
		var profile = registry.getProfile(normalized);
		var attested = profile.swap.status === 'attested' || profile.swap.status === 'certified';
		var routes = registry.attestedRoutes ? registry.attestedRoutes(normalized) : registry.verifiedRoutes(normalized);
		var repositoryLinks = profile.repositories.map(function(repository){
			return '<li>' + chainInfoSafeLink(repository.url, repository.label) + '</li>';
		}).join('');
		var endpointRows = [
			['API endpoint', profile.api.base],
			['Transaction explorer', profile.explorer.tx],
			['Address explorer', profile.explorer.addr],
			['Block explorer', profile.explorer.block]
		].map(function(endpoint){
			return '<tr><th>' + chainInfoEsc(endpoint[0]) + '</th><td>' + chainInfoSafeLink(endpoint[1], endpoint[1]) + '</td></tr>';
		}).join('');
		var routeHtml = routes.length ? routes.map(function(route){
			var legs = (route.legs || []).map(function(leg){
				var legClass = leg.status === 'attested-hosted' ? 'chain-route-leg-hosted' : 'chain-route-leg-community';
				return '<span class="chain-route-leg ' + legClass + '"><span class="glyphicon glyphicon-ok-sign"></span> <b>' + chainInfoEsc(leg.code) + '</b> · ' + chainInfoEsc(leg.label) + '</span>';
			}).join('');
			return '<div class="chain-route-card"><div class="chain-route-market"><b>' + chainInfoEsc(route.market) + '</b> <span class="label label-default">canonical market</span></div>' +
				'<div class="chain-route-directions text-muted">' + route.routes.map(chainInfoEsc).join(' &nbsp;·&nbsp; ') + '</div><div class="chain-route-legs">' + legs + '</div></div>';
		}).join('') : '<p class="text-muted">No OTC swap route is attested for this wallet-only chain.</p>';
		var selectedRouteStatus = registry.routeStatusForChain(normalized);
		var selectedRouteClass = selectedRouteStatus.status === 'attested-hosted' ? 'chain-status-hosted' : 'chain-status-community';
		var swapFacts = attested ? [
			'<div class="chain-status ' + selectedRouteClass + '"><span class="glyphicon glyphicon-ok-sign"></span><div><b>' + chainInfoEsc(selectedRouteStatus.label) + '</b><br><span>Protocol-attested as either asset or payment chain in every canonical market listed below.</span></div></div>',
			'<table class="table table-condensed chain-info-table"><tbody>',
			'<tr><th>Claim fee</th><td><code>' + chainInfoEsc(profile.swap.fees.claim + ' ' + profile.unit) + '</code></td></tr>',
			'<tr><th>Refund fee</th><td><code>' + chainInfoEsc(profile.swap.fees.refund + ' ' + profile.unit) + '</code></td></tr>',
			'<tr><th>Funding fee</th><td><code>' + chainInfoEsc(profile.swap.fees.funding + ' ' + profile.unit) + '</code></td></tr>',
			'<tr><th>Hard dust floor</th><td><code>' + chainInfoEsc(profile.swap.policy.hardDustSats + ' base units') + '</code></td></tr>',
			'<tr><th>Change threshold</th><td><code>' + chainInfoEsc(profile.swap.policy.changeThresholdSats + ' base units') + '</code></td></tr>',
			'</tbody></table>'
		].join('') : '<div class="chain-status chain-status-wallet"><span class="glyphicon glyphicon-briefcase"></span><div><b>Wallet support only</b><br><span>Address, key, explorer and transaction tools are available; OTC settlement is not attested.</span></div></div>';

		$content.html([
			'<article class="chain-info-page" data-chain="' + chainInfoEsc(normalized) + '">',
			'<header class="chain-info-hero"><div><p class="rod-eyebrow">' + chainInfoEsc(attested ? 'Attested settlement chain' : 'Wallet-supported chain') + '</p>',
			'<h1>' + chainInfoEsc(profile.name) + ' <small>' + chainInfoEsc(profile.code) + '</small></h1>',
			'<p>' + chainInfoEsc(profile.description) + '</p></div>',
			'<div class="chain-info-status-badge ' + (attested ? (selectedRouteStatus.status === 'attested-hosted' ? 'is-hosted' : 'is-community') : 'is-wallet') + '">' + (attested ? '<span class="glyphicon glyphicon-ok-sign"></span> ' + chainInfoEsc(selectedRouteStatus.label) : '<span class="glyphicon glyphicon-briefcase"></span> Wallet only') + '</div></header>',
			'<div class="row chain-info-grid"><div class="col-md-6"><section class="chain-info-card"><h3>Network parameters</h3><table class="table table-condensed chain-info-table"><tbody>' + chainInfoRows(profile) + '</tbody></table></section></div>',
			'<div class="col-md-6"><section class="chain-info-card"><h3>Endpoints</h3><table class="table table-condensed chain-info-table"><tbody>' + endpointRows + '</tbody></table></section>',
			'<section class="chain-info-card"><h3>Official resources</h3><ul class="chain-info-links"><li>' + chainInfoSafeLink(profile.website, 'Official website') + '</li><li>' + chainInfoSafeLink(profile.documentation, 'Documentation') + '</li>' + repositoryLinks + '</ul></section></div></div>',
			'<div class="row chain-info-grid"><div class="col-md-6"><section class="chain-info-card"><h3>Support status</h3>' + swapFacts + '</section></div>',
			'<div class="col-md-6"><section class="chain-info-card"><h3>Attested swap routes</h3>' + routeHtml + '</section></div></div>',
			'<p class="chain-info-canonical"><span class="glyphicon glyphicon-link"></span> Canonical page: <code>#chain/' + chainInfoEsc(normalized) + '</code></p>',
			'</article>'
		].join(''));
		renderChainInfoNavigation(normalized);
		return normalized;
	}

	function openChainInfo(code, updateHash){
		var normalized = renderChainInfo(code);
		if(updateHash){
			var target = '#chain/' + normalized;
			if(window.history && window.history.replaceState) window.history.replaceState(null, '', target);
			else window.location.hash = target;
		}
		/* Set the canonical hash before Bootstrap emits shown.bs.tab. Otherwise
		   the first page opened from another tab can be overwritten by the hash
		   of the previously viewed chain. */
		$('a[href="#chainInfo"]').tab('show');
		document.title = window.spexChainRegistry.getProfile(normalized).name + ' (' + normalized + ') Chain Information | SpeXex';
	}

	function getActiveCoin(){
		try {
			return normalizeCoinCode(window.localStorage.getItem(ACTIVE_COIN_KEY));
		} catch (e) {
			return 'ROD';
		}
	}

	function syncExplorersFromNetwork(){
		var net = coinjs.getNetwork ? coinjs.getNetwork() : null;
		if(!net || !net.explorer){
			return;
		}
		explorer_tx = net.explorer.tx;
		explorer_addr = net.explorer.addr;
		explorer_block = net.explorer.block || explorer_block;
	}

	function encodeWifForNetwork(privHex, compressed, privVersion){
		var r = Crypto.util.hexToBytes(privHex);
		if(compressed){
			r.push(0x01);
		}
		r.unshift(privVersion);
		var hash = Crypto.SHA256(Crypto.SHA256(r, {asBytes: true}), {asBytes: true});
		return coinjs.base58encode(r.concat(hash.slice(0, 4)));
	}

	function walletMaterialFromWif(wif){
		var decoded = coinjs.wif2privkey(wif);
		var pub = coinjs.wif2pubkey(wif);
		return {
			privkey: decoded.privkey,
			compressed: !!decoded.compressed,
			pubkey: pub.pubkey,
			wif: wif
		};
	}

	function walletWifForActiveNetwork(material){
		if(!material || !material.privkey){
			return '';
		}
		var prevCompressed = coinjs.compressed;
		coinjs.compressed = !!material.compressed;
		var wif = encodeWifForNetwork(material.privkey, !!material.compressed, coinjs.priv);
		coinjs.compressed = prevCompressed;
		return wif;
	}

	function refreshSiteCoinLabels(){
		var net = coinjs.getNetwork ? coinjs.getNetwork() : {'code':'ROD','unit':'ROD','name':'SpaceXpanse ROD'};
		var unit = net.unit || net.code || 'ROD';
		/* Hide the SegWit controls entirely on chains that do not implement it,
		   rather than offering an option that silently produces dead addresses. */
		var segwitCapable = !coinjs.supportsSegwit || coinjs.supportsSegwit();
		$('#walletSegwit').closest('.walletOptions, .checkbox, div').first().toggle(!!segwitCapable);
		if(!segwitCapable){
			$('#walletSegwit')[0] && ($('#walletSegwit')[0].checked = false);
			$('#walletSegwitp2sh')[0] && ($('#walletSegwitp2sh')[0].checked = false);
			$('#walletSegwitBech32')[0] && ($('#walletSegwitBech32')[0].checked = false);
		}
		$('#activeCoinBadge').text(unit);
		$('#walletActiveCoinLabel').text(net.name || unit);
		$('#walletBalanceCoinTag').text(unit);
		$('#walletSendCoinLabel').text(unit);
		$('.js-coin-unit').text(unit);
		$('.js-coin-name').text(net.name || unit);
		document.title = net.name + ' Wallet by rod-web-wallet';
		$('#walletCoinMenu .wallet-coin-item').removeClass('active-coin');
		$('#walletCoinMenu .wallet-coin-item[data-coin="'+net.code+'"]').addClass('active-coin');
		/* Spend form copy */
		$('#walletSpend h3').html('<span class="glyphicon glyphicon-send"></span> Send '+unit);
		$('#walletSpend .text-muted').first().text('Enter a recipient and amount, then review before broadcasting.');
		$('#walletSpendTo').closest('.walletOptions').find('label').each(function(){
			var t = $(this).text();
			if(/Recipient/.test(t)){ $(this).text('Recipient '+unit+' address'); }
			if(/Amount in/.test(t)){ $(this).text('Amount in '+unit); }
		});
	}

	function applyActiveCoin(coin, options){
		var opts = options || {};
		var c = normalizeCoinCode(coin);


		try { window.localStorage.setItem(ACTIVE_COIN_KEY, c); } catch (e) { /* ignore */ }
		if(coinjs.setNetwork){
			coinjs.setNetwork(c);
		}

		/* The old request may still complete, but it no longer owns the balance
		   UI.  Reset the loader and value before renderOpenWallet() starts the
		   request for the newly selected network. */
		walletBalanceRequests.reset();
		$("#walletLoader").addClass("hidden");
		var nextUnit = (coinjs.getNetwork && coinjs.getNetwork().unit) || c;
		$("#walletBalance").html('0.00000000 '+nextUnit).attr('rel', 0);

		/* Clear per-host API errors from the previous network so the banner
		   does not stick when switching coins. */
		_apiHostErrors = {};
		updateApiServerStatus({online: true, url: ''});

		syncExplorersFromNetwork();
		refreshSiteCoinLabels();
		if($('#chainInfo').hasClass('active')) renderChainInfo(c);

		/* Keep settings panel fields in sync */
		$("#coinjs_pub").val('0x'+(coinjs.pub).toString(16));
		$("#coinjs_priv").val('0x'+(coinjs.priv).toString(16));
		$("#coinjs_multisig").val('0x'+(coinjs.multisig).toString(16));
		$("#coinjs_hdpub").val('0x'+(coinjs.hdkey.pub).toString(16));
		$("#coinjs_hdprv").val('0x'+(coinjs.hdkey.prv).toString(16));
		if(typeof populateNetworkDropdown === 'function'){
			try { populateNetworkDropdown(); } catch (e2) { /* may run before define */ }
		}

		if(!opts.skipWallet && openWalletData){
			/* Re-encode WIF + address for the active network. A non-SegWit coin
			   must never inherit a Bech32/P2SH-SegWit display mode from the
			   previously active network. */
			if(openWalletData.privkey){
				openWalletData.compressed = (typeof openWalletData.compressed === 'boolean') ? openWalletData.compressed : true;
				openWalletData.wif = walletWifForActiveNetwork(openWalletData);
				var prevC = coinjs.compressed;
				coinjs.compressed = openWalletData.compressed;
				openWalletData.pubkey = coinjs.newPubkey(openWalletData.privkey);
				coinjs.compressed = prevC;
			}
			var nextAddressType = openWalletData.addressType || getWalletAddressType();
			if(coinjs.supportsSegwit && !coinjs.supportsSegwit()) nextAddressType = 'legacy';
			renderOpenWallet(nextAddressType);
		}
		$(document).trigger('spexActiveCoinChanged', [c]);
		return c;
	}

	function setActiveCoin(coin){
		return applyActiveCoin(coin, {});
	}

	function updateActiveCoinUi(coin){
		refreshSiteCoinLabels();
	}

	window.spexSetActiveCoin = setActiveCoin;
	window.spexGetActiveCoin = getActiveCoin;

	/* Persist open-wallet session across page reloads (cleared on Logout).
	   Stores network-agnostic privkey so Coins menu can re-encode ROD/LTC WIF. */
	function saveWalletSession(data){
		if(!data || !data.privkey || !data.pubkey){
			return;
		}
		try {
			window.localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify({
				v: 2,
				privkey: data.privkey,
				compressed: !!data.compressed,
				pubkey: data.pubkey,
				privkeyaes: data.privkeyaes || '',
				addressType: data.addressType || 'legacy',
				savedAt: new Date().toISOString()
			}));
		} catch (e) {
			/* quota / private mode — session still works in-memory */
		}
	}

	function clearWalletSession(){
		try {
			window.localStorage.removeItem(WALLET_SESSION_KEY);
		} catch (e) { /* ignore */ }
	}

	function loadWalletSession(){
		try {
			var raw = window.localStorage.getItem(WALLET_SESSION_KEY);
			if(!raw){
				return null;
			}
			var parsed = JSON.parse(raw);
			if(!parsed){
				clearWalletSession();
				return null;
			}
			/* Migrate v1 (network-bound WIF) → v2 (privkey hex) */
			if(parsed.v === 1 && parsed.wif){
				try {
					var mat = walletMaterialFromWif(parsed.wif);
					return {
						privkey: mat.privkey,
						compressed: mat.compressed,
						pubkey: mat.pubkey,
						privkeyaes: parsed.privkeyaes || '',
						addressType: parsed.addressType || 'legacy'
					};
				} catch (e1) {
					clearWalletSession();
					return null;
				}
			}
			if(parsed.v !== 2 || !parsed.privkey || !parsed.pubkey){
				clearWalletSession();
				return null;
			}
			return {
				privkey: parsed.privkey,
				compressed: !!parsed.compressed,
				pubkey: parsed.pubkey,
				privkeyaes: parsed.privkeyaes || '',
				addressType: parsed.addressType || 'legacy'
			};
		} catch (e) {
			clearWalletSession();
			return null;
		}
	}

	function restoreWalletSession(){
		var session = loadWalletSession();
		if(!session){
			return false;
		}
		openWalletData = {
			'privkey': session.privkey,
			'compressed': session.compressed,
			'pubkey': session.pubkey,
			'wif': walletWifForActiveNetwork(session),
			'privkeyaes': session.privkeyaes,
			'addressType': session.addressType
		};
		renderOpenWallet(session.addressType);
		return true;
	}

	/* Track per-host API status so one host recovering does not hide
	   another host's failure.  Keys are hostnames, values are the error
	   message string (present = down, absent = up). */
	var _apiHostErrors = {};

	function _hostFromUrl(url) {
		try { var m = /^https?:\/\/([^\/]+)/.exec(url); return m ? m[1] : ''; } catch(e) { return ''; }
	}

	function updateApiServerStatus(status){
		var statusBox = $("#apiServerStatus");
		if(!statusBox.length) return;

		var host = _hostFromUrl(status && status.url);
		if(status && status.online){
			if(host) delete _apiHostErrors[host];
		} else {
			var msg = (status && status.message) ? status.message : (host || 'API server') + ' is unreachable';
			if(host) _apiHostErrors[host] = msg;
		}

		/* Build a combined message from all currently-down hosts. */
		var msgs = [];
		for(var h in _apiHostErrors){ if(_apiHostErrors.hasOwnProperty(h)) msgs.push(_apiHostErrors[h]); }
		if(msgs.length === 0){
			statusBox.addClass("hidden");
			return;
		}
		statusBox.find(".api-server-status-message").text(msgs.join(' · ') + ". Balance, UTXO lookup, and broadcast may be unavailable; local address generation and signing still work.");
		statusBox.removeClass("hidden").fadeOut().fadeIn();
	}

	$(document).on('coinjsApiStatus', function(event, status){
		updateApiServerStatus(status);
	});

	if(coinjs.apiHealthCheck){
		coinjs.apiHealthCheck();
	}

	function getWalletAddressType(){
		/* Dogecoin has no SegWit at all: DEPLOYMENT_SEGWIT is permanently
		   disabled and IsWitnessEnabled() hard-returns false in Dogecoin Core,
		   so a p2wpkh-in-p2sh or bech32 address would be unspendable. Force
		   legacy regardless of what the (hidden) checkboxes say. */
		if(coinjs.supportsSegwit && !coinjs.supportsSegwit()){
			return 'legacy';
		}
		if($("#walletSegwit").is(":checked")){
			return $("#walletSegwitBech32").is(":checked") ? 'bech32' : 'segwit';
		}

		return 'legacy';
	}

	function setWalletAddressControls(addressType){
		$("#walletSegwit")[0].checked = addressType != 'legacy';
		$("#walletSegwitp2sh")[0].checked = addressType == 'segwit';
		$("#walletSegwitBech32")[0].checked = addressType == 'bech32';
		syncWalletSegwitState();
	}

	function getWalletAddressData(pubkey, addressType){
		var address = coinjs.pubkey2address(pubkey);
		var label = 'Legacy';
		var redeemscript = false;

		if(addressType == 'bech32'){
			var bech32 = coinjs.bech32Address(pubkey);
			address = bech32.address;
			label = 'SegWit/Bech32';
			redeemscript = bech32.redeemscript;
		} else if(addressType == 'segwit'){
			var segwit = coinjs.segwitAddress(pubkey);
			address = segwit.address;
			label = 'SegWit';
			redeemscript = segwit.redeemscript;
		}

		return {
			'address': address,
			'label': label,
			'redeemscript': redeemscript
		};
	}

	function renderOpenWallet(addressType){
		if(!openWalletData){
			return;
		}

		if(coinjs.supportsSegwit && !coinjs.supportsSegwit()) addressType = 'legacy';
		var net = coinjs.getNetwork ? coinjs.getNetwork() : {'unit':'ROD','uriPrefix':'rod','code':'ROD'};
		if(openWalletData.privkey){
			openWalletData.wif = walletWifForActiveNetwork(openWalletData);
			var prevC = coinjs.compressed;
			coinjs.compressed = !!openWalletData.compressed;
			openWalletData.pubkey = coinjs.newPubkey(openWalletData.privkey);
			coinjs.compressed = prevC;
		}

		var addressData = getWalletAddressData(openWalletData.pubkey, addressType);
		openWalletData.addressType = addressType;
		openWalletData.address = addressData.address;
		setWalletAddressControls(addressType);
		refreshSiteCoinLabels();

		$("#walletKeys .walletSegWitRS").addClass("hidden");
		$("#walletKeys .walletSegWitRS input:text").val('');
		if(addressData.redeemscript){
			$("#walletKeys .walletSegWitRS").removeClass("hidden");
			$("#walletKeys .walletSegWitRS input:text").val(addressData.redeemscript);
		}

		$("#walletToBtn").html(addressData.label+' <span class="caret"></span>');
		$("#walletAddress").html(addressData.address);
		$("#walletHistory").attr('href', explorer_addr + addressData.address);

		$("#walletQrCode").html("");
		var qrcode = new QRCode("walletQrCode");
		qrcode.makeCode((net.uriPrefix || 'rod') + ':' + addressData.address);

		$("#walletKeys .privkey").val(openWalletData.wif);
		$("#walletKeys .pubkey").val(openWalletData.pubkey);
		$("#walletKeys .privkeyaes").val(openWalletData.privkeyaes);

		$("#openLogin").hide();
		$("#openWallet").removeClass("hidden").show();

		saveWalletSession(openWalletData);
		walletBalance();
	}

	function openWallet(keys, privkeyaes, addressType){
		var material;
		if(keys.privkey){
			material = {
				privkey: keys.privkey,
				compressed: (typeof keys.compressed === 'boolean') ? keys.compressed : !!coinjs.compressed,
				pubkey: keys.pubkey,
				wif: keys.wif || ''
			};
		} else {
			material = walletMaterialFromWif(keys.wif);
		}
		openWalletData = {
			'privkey': material.privkey,
			'compressed': material.compressed,
			'pubkey': material.pubkey || keys.pubkey,
			'wif': material.wif || walletWifForActiveNetwork(material),
			'privkeyaes': privkeyaes || '',
			'addressType': addressType
		};

		saveWalletSession(openWalletData);
		renderOpenWallet(addressType);
	}

	function showWalletLoginError(selector, message){
		$(selector).html('<span class="glyphicon glyphicon-exclamation-sign"></span> '+message).removeClass("hidden").fadeOut().fadeIn();
	}

	function walletAccessWarningsAcknowledged(selector){
		return $(selector).is(":checked");
	}

	function brainwalletWarningsAcknowledged(selector){
		return !$(selector).is(":checked") || $(selector+"Ack").is(":checked");
	}

	$("#openBtn").click(function(){
  if(!captchaPassed()){
    return;
  }
  var email = $("#openEmail").val().toLowerCase();
		var walletPassword = $("#openPass").val();
		var minimumWalletPasswordLength = 16;
		var hasLowercaseCharacter = /[a-z]/.test(walletPassword);
		var hasUppercaseCharacter = /[A-Z]/.test(walletPassword);
		var hasNumericCharacter = /[0-9]/.test(walletPassword);
		var hasSpecialCharacter = /[^A-Za-z0-9]/.test(walletPassword);
		var hasNoWhitespace = !/\s/.test(walletPassword);
		var isWalletPasswordStrong = (
			walletPassword.length >= minimumWalletPasswordLength &&
			hasLowercaseCharacter &&
			hasUppercaseCharacter &&
			hasNumericCharacter &&
			hasSpecialCharacter &&
			hasNoWhitespace
		);
		if(email.match(/[\s\w\d]+@[\s\w\d]+/g)){
			if(isWalletPasswordStrong){
				if($("#openPass").val()==$("#openPassConfirm").val()){
					if(!walletAccessWarningsAcknowledged("#openWalletRiskAcknowledgement")){
						showWalletLoginError("#openLoginStatus", "Confirm the local-only wallet warning before opening the wallet.");
						return;
					}
					var email = $("#openEmail").val().toLowerCase();
					var pass = walletPassword;
					var s = email;
					s += '|'+pass+'|';
					s += s.length+'|!@'+((pass.length*7)+email.length)*7;
					var regchars = (pass.match(/[a-z]+/g)) ? pass.match(/[a-z]+/g).length : 1;
					var regupchars = (pass.match(/[A-Z]+/g)) ? pass.match(/[A-Z]+/g).length : 1;
					var regnums = (pass.match(/[0-9]+/g)) ? pass.match(/[0-9]+/g).length : 1;
					s += ((regnums+regchars)+regupchars)*pass.length+'3571';
					s += (s+''+s);

					for(i=0;i<=50;i++){
						s = Crypto.SHA256(s);
					}

					coinjs.compressed = true;
					var keys = coinjs.newKeys(s);
					var privkeyaes = CryptoJS.AES.encrypt(keys.wif, pass);
					$("#openLoginStatus").html("").addClass("hidden");
					openWallet(keys, privkeyaes, getWalletAddressType());
				} else {
					showWalletLoginError("#openLoginStatus", "Your passwords do not match!");
				}
			} else {
				showWalletLoginError("#openLoginStatus", "Password must be at least 16 characters and include uppercase, lowercase, number, symbol, and no spaces.");
			}
		} else {
			showWalletLoginError("#openLoginStatus", "Your email address doesn't appear to be valid");
		}
	});

	$("#openWifBtn").click(function(){
  if(!captchaPassed()){
    return;
  }
		if(!walletAccessWarningsAcknowledged("#openWifRiskAcknowledgement")){
			showWalletLoginError("#openWifStatus", "Confirm the local-only wallet warning before importing a WIF key.");
			return;
		}
  var wif = $.trim($("#openWifKey").val());
		$("#openWifStatus").html("").addClass("hidden");

		try {
			var wifAddress = coinjs.wif2address(wif);
			var wifPubkey = coinjs.wif2pubkey(wif);
			var decodedAddress = coinjs.addressDecode(wifAddress.address);
			if(!decodedAddress || decodedAddress.version != coinjs.pub){
				showWalletLoginError("#openWifStatus", "Unable to decode a valid " + ((coinjs.getNetwork && coinjs.getNetwork().unit) || 'coin') + " address from this WIF private key.");
				return;
			}

			openWallet({
				'wif': wif,
				'pubkey': wifPubkey.pubkey,
				'address': wifAddress.address
			}, '', getWalletAddressType());
		} catch(e) {
			showWalletLoginError("#openWifStatus", "Enter a valid WIF private key for the selected network.");
		}
	});

	$("#walletLogout").click(function(){
		$("#openEmail").val("");
		$("#openPass").val("");
		$("#openPassConfirm").val("");
		$("#openWifKey").val("");
		openWalletData = false;
		clearWalletSession();

		$("#openLogin").show();
		$("#openWallet").addClass("hidden").show();

		$("#walletAddress").html("");
		$("#walletHistory").attr('href',explorer_addr);

		$("#walletQrCode").html("");
		var qrcode = new QRCode("walletQrCode");
		var uri = (coinjs.getNetwork && coinjs.getNetwork().uriPrefix) || 'rod';
		qrcode.makeCode(uri + ":");

		$("#walletKeys .privkey").val("");
		$("#walletKeys .pubkey").val("");
		$("#walletKeys .privkeyaes").val("");

		$("#openLoginStatus").html("").hide();
		$("#openWifStatus").html("").hide();
	});

	function syncWalletSegwitState(){
		if($("#walletSegwit").is(":checked")){
			$(".walletSegwitType").prop('disabled', false);
		} else {
			$(".walletSegwitType").prop('disabled', true);
		}
	}

	function scrollToWalletActionPanel(){
		var walletActionPanel = $("#walletActionPanel");
		if(walletActionPanel.length){
			$("html, body").animate({scrollTop: walletActionPanel.offset().top - 80}, 250);
		}
	}

	$("#walletSegwit").on("change", function(){
		syncWalletSegwitState();
	});

	var walletSegwitCheckbox = $("#walletSegwit")[0];
	walletSegwitCheckbox.defaultChecked = false;
	walletSegwitCheckbox.checked = false;
	syncWalletSegwitState();

	/* Apply saved coin network site-wide, then restore wallet if any. */
	renderWalletCoinMenu();
	applyActiveCoin(getActiveCoin(), {skipWallet: true});
	renderChainInfoNavigation(getActiveCoin());
	renderChainInfo(chainInfoCodeFromHash() || getActiveCoin());
	restoreWalletSession();

	$(document).on('click', '.chainInfoSelect', function(event){
		event.preventDefault();
		var code = setActiveCoin($(this).attr('data-chain'));
		openChainInfo(code, true);
	});
	$('a[href="#chainInfo"]').on('shown.bs.tab', function(){
		var requested = chainInfoCodeFromHash();
		if(requested) renderChainInfo(requested);
		else openChainInfo(getActiveCoin(), true);
	});
	$(window).on('hashchange', function(){
		var requested = chainInfoCodeFromHash();
		if(requested){
			setActiveCoin(requested);
			openChainInfo(requested, false);
		}
	});
	if(chainInfoCodeFromHash()){
		setActiveCoin(chainInfoCodeFromHash());
		openChainInfo(chainInfoCodeFromHash(), false);
	}

	$("#walletToSegWit").click(function(){
		renderOpenWallet('segwit');
	});

	$("#walletToSegWitBech32").click(function(){
		renderOpenWallet('bech32');
	});

	$("#walletToLegacy").click(function(){
		renderOpenWallet('legacy');
	});

	$("#walletShowKeys").click(function(){
		$(".walletOptions").removeClass("hidden").addClass("hidden");
		$("#walletActionPlaceholder").addClass("hidden");
		$("#walletKeys").removeClass("hidden");
		scrollToWalletActionPanel();
	});

	$("#walletShowBuy").click(function(){
		/* For chains that have OTC swap support (listed in CHAINS.definitions),
		   navigate to the OTC Swap tab. For wallet-only chains, show a message
		   derived from the same registry rather than a copied support list. */
		var activeCoin = getActiveCoin();
		var otcSupported = window.rodOtc && window.rodOtc.chains && window.rodOtc.chains.definitions;
		if(otcSupported && otcSupported[activeCoin]){
			/* Navigate to OTC Swap tab */
			$('a[href="#otc"]').tab('show');
		} else {
			$(".walletOptions").removeClass("hidden").addClass("hidden");
			$("#walletActionPlaceholder").addClass("hidden");
			/* Show pending message in the action panel */
			if(!$('#walletBuyPending').length){
				$('#walletActionPanel').append('<div id="walletBuyPending" class="walletOptions hidden"><h3><span class="glyphicon glyphicon-info-sign"></span> OTC swap support pending</h3><p class="text-muted">OTC atomic swap support for <b class="js-coin-unit">'+activeCoin+'</b> is not yet available. Currently swap-attested chains: <span class="js-swap-attested"></span>.</p><p class="text-muted">Wallet features (address generation, balance check, and key management) work normally.</p></div>');
			}
			$('#walletBuyPending .js-coin-unit').text(activeCoin);
			var swapCodes = (window.rodOtc && window.rodOtc.chains && window.rodOtc.chains.codes)
				? window.rodOtc.chains.codes() : [];
			$('#walletBuyPending .js-swap-attested').text(swapCodes.length ? swapCodes.join(', ') : 'none');
			$('#walletBuyPending').removeClass('hidden');
			scrollToWalletActionPanel();
		}
	});

	/* Clicking balance refresh link triggers a balance refresh */
	$(document).on('click', '#walletRefreshLink', function(){ walletBalance(); });

	/* Clicking QR code or address copies the address to clipboard */
	$("#walletAddress, #walletQrCode").click(function(){
		var addr = $.trim($("#walletAddress").text());
		if(!addr) return;
		/* Use modern Clipboard API if available, fallback to execCommand */
		if(navigator.clipboard && navigator.clipboard.writeText){
			navigator.clipboard.writeText(addr).then(function(){
				flash_wallet_copy('Address copied!');
			}, function(){ fallback_copy_wallet(addr); });
		} else {
			fallback_copy_wallet(addr);
		}
	});

	function fallback_copy_wallet(text){
		var ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.select();
		try { document.execCommand('copy'); flash_wallet_copy('Address copied!'); }
		catch(e){ flash_wallet_copy('Copy failed — select manually'); }
		document.body.removeChild(ta);
	}

	function flash_wallet_copy(msg){
		var $hint = $('.wallet-refresh-hint');
		var orig = $hint.html();
		$hint.html('<span class="glyphicon glyphicon-ok" style="color:#62e6a6"></span> ' + msg);
		setTimeout(function(){ $hint.html(orig); }, 2000);
	}

	$(document).on('click', '.walletCoinSelect', function(e){
		e.preventDefault();
		setActiveCoin($(this).data('coin'));
	});

	$("#walletConfirmSend").click(function(){
  if(!captchaPassed()){
    return;
  }
  var thisbtn = $(this);
  var tx = coinjs.transaction();
  var txfee = $("#txFee");
		var devaddr = coinjs.developer;
		var devamount = $("#developerDonation");

		if((devamount.val()*1)>0 && devaddr){
			tx.addoutput(devaddr, devamount.val()*1);
		}

		var total = (devamount.val()*1) + (txfee.val()*1);

		$.each($("#walletSpendTo .output"), function(i,o){
			var addr = $('.addressTo',o);
			var amount = $('.amount',o);
			if(amount.val()*1>0){
				total += amount.val()*1;
				tx.addoutput(addr.val(), amount.val()*1);
			}
		});

		thisbtn.attr('disabled',true);

		var script = false;
		if($("#walletSegwit").is(":checked")){
			if($("#walletSegwitBech32").is(":checked")){
				var sw = coinjs.bech32Address($("#walletKeys .pubkey").val());
			} else {
				var sw = coinjs.segwitAddress($("#walletKeys .pubkey").val());
			}
			script = sw.redeemscript;
		}

		var sequence = 0xffffffff-1;
		if($("#walletRBF").is(":checked")){
			sequence = 0xffffffff-2;
		}

		$("#walletLoader").removeClass("hidden");
		tx.addUnspent($("#walletAddress").html(), function(data){
			if(!data || typeof data.value == 'undefined'){
				$("#walletSendConfirmStatus").removeClass("hidden alert-success").addClass('alert-danger').html('<span class="glyphicon glyphicon-exclamation-sign"></span> Unable to load spendable wallet inputs.');
				thisbtn.attr('disabled',false);
				$("#walletLoader").addClass("hidden");
				return;
			}

			var dvalue = (data.value/100000000).toFixed(8) * 1;
			total = (total*1).toFixed(8) * 1;

			if(dvalue>=total){
				var change = dvalue-total;
				if((change*1)>0){
					tx.addoutput($("#walletAddress").html(), change);
				}

				var tx2 = coinjs.transaction();
				var txunspent = tx2.deserialize(tx.serialize());
				var signed = txunspent.sign($("#walletKeys .privkey").val());

				tx2.broadcast(function(data){
					$("#walletLoader").addClass("hidden");
					if(data && data.success){
						$("#walletSendConfirmStatus").removeClass('hidden alert-danger').addClass('alert-success').html('Transaction broadcast successfully.<br>txid: <a href="'+explorer_tx+data.txid+'" target="_blank">'+data.txid+'</a>');
						$("#walletSendFailTransaction").addClass('hidden');
						thisbtn.addClass('hidden').attr('disabled',true);
						$("#walletSendBtn").attr('disabled',true);
					} else {
						var errorMessage = (data && data.response) ? data.response : 'Broadcast failed';
						$("#walletSendConfirmStatus").removeClass('hidden alert-success').addClass('alert-danger').html('<span class="glyphicon glyphicon-exclamation-sign"></span> Broadcast failed: '+errorMessage);
						$("#walletSendFailTransaction").removeClass('hidden');
						$("#walletSendFailTransaction textarea").val(signed);
						thisbtn.attr('disabled',false);
						$("#modalWalletConfirm").modal('hide');
						$("#walletSendBtn").attr('disabled',false);
					}

					walletBalance();

				}, signed);
			} else {
				var unit = (coinjs.getNetwork && coinjs.getNetwork().unit) || 'ROD';
				$("#walletSendConfirmStatus").removeClass("hidden alert-success").addClass('alert-danger').html("You have a confirmed balance of "+dvalue+" "+unit+", unable to send "+total+" "+unit).fadeOut().fadeIn();
				thisbtn.attr('disabled',false);
				$("#walletLoader").addClass("hidden");
			}

		}, script, script, sequence);
	});

	function getWalletActiveOutputCount(){
		var outputCount = 0;
		$.each($("#walletSpendTo .output"), function(i,o){
			var amountValue = $('.amount',o).val()*1;
			if(amountValue>0){
				outputCount++;
			}
		});

		if(($("#developerDonation").val()*1)>0 && coinjs.developer){
			outputCount++;
		}

		return outputCount;
	}

	function getWalletEstimatedOutputBytes(address){
		var decodedAddress = coinjs.addressDecode(address);

		if(decodedAddress && decodedAddress.type == 'bech32'){
			return 31;
		}

		if(decodedAddress && decodedAddress.version == coinjs.multisig){
			return 32;
		}

		return 34;
	}

	function getWalletEstimatedTotalOutputBytes(){
		var totalOutputBytes = getWalletEstimatedOutputBytes($("#walletAddress").html());

		$.each($("#walletSpendTo .output"), function(i,o){
			var amountValue = $('.amount',o).val()*1;
			var recipientAddress = $('.addressTo',o).val();
			if(amountValue>0 && recipientAddress){
				totalOutputBytes += getWalletEstimatedOutputBytes(recipientAddress);
			}
		});

		if(($("#developerDonation").val()*1)>0 && coinjs.developer){
			totalOutputBytes += getWalletEstimatedOutputBytes(coinjs.developer);
		}

		return totalOutputBytes;
	}

	function getWalletEstimatedInputBytes(){
		if($("#walletSegwit").is(":checked")){
			return $("#walletSegwitBech32").is(":checked") ? 41 : 91;
		}

		return 148;
	}

	function estimateWalletTransactionBytes(estimatedInputCount){
		var transactionInputCount = Math.max(1, estimatedInputCount || 1);
		var estimatedInputBytes = getWalletEstimatedInputBytes();
		var estimatedOutputBytes = getWalletEstimatedTotalOutputBytes();
		var baseBytes = 10;
		return baseBytes + (transactionInputCount * estimatedInputBytes) + estimatedOutputBytes;
	}

	var walletFeeWasManuallyEdited = false;

	function ensureWalletFeeMeetsRelayFloor(forceMinimumFee, estimatedInputCount){
		var minimumSatPerByte = 100;
		var estimatedBytes = estimateWalletTransactionBytes(estimatedInputCount);
		var minimumFeeSat = estimatedBytes * minimumSatPerByte;
		var minimumFeeRod = (minimumFeeSat / 100000000);
		var txFeeField = $("#txFee");
		var currentFeeRod = txFeeField.val()*1;
		var shouldForceMinimumFee = forceMinimumFee === true;

		if(!isNaN(currentFeeRod) && currentFeeRod < minimumFeeRod && (shouldForceMinimumFee || !walletFeeWasManuallyEdited)){
			txFeeField.val(minimumFeeRod.toFixed(8));
			walletFeeWasManuallyEdited = false;
			return {
				updated: true,
				minimumFeeRod: minimumFeeRod,
				estimatedBytes: estimatedBytes,
				minimumSatPerByte: minimumSatPerByte
			};
		}

		return {
			updated: false,
			minimumFeeRod: minimumFeeRod,
			estimatedBytes: estimatedBytes,
			minimumSatPerByte: minimumSatPerByte
		};
	}

	$("#txFee").on('input', function(){
		walletFeeWasManuallyEdited = true;
	});

	$("#developerDonation, #walletSpendTo").on('change keyup', '.amount', function(){
		walletFeeWasManuallyEdited = false;
		ensureWalletFeeMeetsRelayFloor();
	});

	$("#developerDonation").on('change keyup', function(){
		walletFeeWasManuallyEdited = false;
		ensureWalletFeeMeetsRelayFloor();
	});

	$("#walletShowSpend").on('click', function(){
		walletFeeWasManuallyEdited = false;
		ensureWalletFeeMeetsRelayFloor();
	});

	ensureWalletFeeMeetsRelayFloor();

	$("#modalWalletConfirm").on('hidden.bs.modal', function(){
		$("#walletSendBtn").attr('disabled',false);
		$("#walletConfirmSend").removeClass('hidden').attr('disabled',false);
	});

	$("#walletSendResetBtn").click(function(){
		$("#walletSpendTo .output:gt(0)").remove();
		$("#walletSpendTo .output:first .addressTo").val('');
		$("#walletSpendTo .output:first .amount").val('');
		$("#walletSendStatus").addClass("hidden").html("");
		$("#walletSendConfirmStatus").addClass("hidden").removeClass('alert-success').removeClass('alert-danger').removeClass('alert-info').html("");
		$("#walletSendFailTransaction").addClass('hidden');
		$("#walletSendBtn").attr('disabled',false);
		$("#walletConfirmSend").removeClass('hidden').attr('disabled',false);
		walletFeeWasManuallyEdited = false;
		ensureWalletFeeMeetsRelayFloor();
	});

	$("#walletSendBtn").click(function(){

		$("#walletSendFailTransaction").addClass('hidden');
		$("#walletSendStatus").addClass("hidden").html("");
		walletFeeWasManuallyEdited = false;

		var thisbtn = $(this);
		var txfee = $("#txFee");
		var devamount = $("#developerDonation");

		if((!isNaN(devamount.val())) && devamount.val()>=0){
			$(devamount).parent().removeClass('has-error');
		} else {
			$(devamount).parent().addClass('has-error')
		}

		if((!isNaN(txfee.val())) && txfee.val()>=0){
			$(txfee).parent().removeClass('has-error');
		} else {
			$(txfee).parent().addClass('has-error');
		}

		var total = (devamount.val()*1) + (txfee.val()*1);

		$.each($("#walletSpendTo .output"), function(i,o){
			var amount = $('.amount',o);
			var address = $('.addressTo',o);

			total += amount.val()*1;

			if((!isNaN($(amount).val())) && $(amount).val()>0){
				$(amount).parent().removeClass('has-error');
			} else {
				$(amount).parent().addClass('has-error');			
			}

			if(coinjs.addressDecode($(address).val())){
				$(address).parent().removeClass('has-error');
			} else {
				$(address).parent().addClass('has-error');
			}
		});

		total = total.toFixed(8);

		if($("#walletSpend .has-error").length==0){
			var balance = ($("#walletBalance").html()).replace(/[^0-9\.]+/g,'')*1;
			if(total<=balance){
				var reviewTx = coinjs.transaction();
				$("#walletLoader").removeClass("hidden");
				reviewTx.listUnspent($("#walletAddress").html(), function(unspentData){
					$("#walletLoader").addClass("hidden");
					if(!unspentData || !unspentData.success || !unspentData.data){
						$("#walletSendStatus").removeClass("hidden").html('<span class="glyphicon glyphicon-exclamation-sign"></span> Unable to estimate wallet fee from current UTXOs.');
						return;
					}

					var inputCount = Math.max(1, unspentData.data.length);
					var feeFloorResult = ensureWalletFeeMeetsRelayFloor(true, inputCount);
					var updatedTotal = (devamount.val()*1) + (txfee.val()*1);

					$.each($("#walletSpendTo .output"), function(i,o){
						updatedTotal += $('.amount',o).val()*1;
					});

					updatedTotal = updatedTotal.toFixed(8);
					if(updatedTotal>balance){
						$("#walletSendStatus").removeClass("hidden").html("You are trying to spend "+updatedTotal+' but have a balance of '+balance);
						return;
					}

					if(feeFloorResult.updated){
						var feeUnit = (coinjs.getNetwork && coinjs.getNetwork().unit) || 'coin';
						$("#walletSendConfirmStatus").removeClass("hidden alert-danger alert-success").addClass('alert-info').html('Network fee adjusted to the relay minimum of '+feeFloorResult.minimumFeeRod.toFixed(8)+' '+feeUnit+' for an estimated '+feeFloorResult.estimatedBytes+' byte transaction using '+inputCount+' input(s).');
					} else {
						$("#walletSendConfirmStatus").addClass("hidden").removeClass('alert-success alert-danger alert-info').html("");
					}

					$("#spendAmount").html(updatedTotal);
					$("#modalWalletConfirm").modal("show");
					$("#walletConfirmSend").removeClass('hidden').attr('disabled',false);
					$("#walletSendBtn").attr('disabled',false);
				});
			} else {
				$("#walletSendStatus").removeClass("hidden").html("You are trying to spend "+total+' but have a balance of '+balance);
			}
		} else {
			$("#walletSpend .has-error").fadeOut().fadeIn();
			$("#walletSendStatus").removeClass("hidden").html('<span class="glyphicon glyphicon-exclamation-sign"></span> One or more input has an error');
		}
	});

	$("#walletShowSpend").click(function(){
		$(".walletOptions").removeClass("hidden").addClass("hidden");
		$("#walletActionPlaceholder").addClass("hidden");
		$("#walletSpend").removeClass("hidden");
		scrollToWalletActionPanel();
	});

	$("#walletSpendTo .addressAdd").click(function(){
		var clone = '<div class="form-horizontal output">'+$(this).parent().html()+'</div>';
		$("#walletSpendTo").append(clone);
		$("#walletSpendTo .glyphicon-plus:last").removeClass('glyphicon-plus').addClass('glyphicon-minus');
		$("#walletSpendTo .glyphicon-minus:last").parent().removeClass('addressAdd').addClass('addressRemove');
		$("#walletSpendTo .addressRemove").unbind("");
		$("#walletSpendTo .addressRemove").click(function(){
			$(this).parent().fadeOut().remove();
		});
	});

	function walletBalance(){
		var network = coinjs.getNetwork ? coinjs.getNetwork() : null;
		var networkCode = (network && network.code) || getActiveCoin();
		var unit = (network && network.unit) || networkCode;
		var addr = $("#walletAddress").html() || (openWalletData && openWalletData.address) || '';
		if(!addr){
			$("#walletBalance").html('0.00000000 '+unit).attr('rel', 0);
			return;
		}
		var request = walletBalanceRequests.begin(networkCode, addr);
		if(!request){
			return;
		}
		$("#walletLoader").removeClass("hidden");
		coinjs.addressBalance(addr, function(data){
			var activeNetwork = coinjs.getNetwork ? coinjs.getNetwork() : null;
			var activeNetworkCode = (activeNetwork && activeNetwork.code) || getActiveCoin();
			var activeAddress = $("#walletAddress").html() || (openWalletData && openWalletData.address) || '';
			if(!walletBalanceRequests.finish(request, activeNetworkCode, activeAddress)){
				return;
			}

			if(data["success"]){
				const v = data["data"][0]["balance"];
				$("#walletBalance").html(v+" "+unit).attr('rel',v).fadeOut().fadeIn();
			} else {
				var previousBalance = $("#walletBalance").attr('rel');
				var fallbackBalance = (!isNaN(previousBalance*1)) ? (previousBalance*1).toFixed(8) : '0.00000000';
				$("#walletBalance").html(fallbackBalance+" "+unit).attr('rel', previousBalance || 0).fadeOut().fadeIn();
				$("#walletSendStatus").removeClass("hidden").html('<span class="glyphicon glyphicon-exclamation-sign"></span> Unable to refresh wallet balance: '+(data["error"] || (unit+' API error')));
			}

			$("#walletLoader").addClass("hidden");
		});
	}

	/* new -> address code */

	$("#newKeysBtn").click(function(){
		coinjs.compressed = false;
		if($("#newCompressed").is(":checked")){
			coinjs.compressed = true;
		}
		if(!brainwalletWarningsAcknowledged("#newBrainwallet")){
			alert('Acknowledge the brain-wallet warning before generating a custom-seed wallet.');
			return;
		}
		var s = ($("#newBrainwallet").is(":checked")) ? $("#brainwallet").val() : null;
		var coin = coinjs.newKeys(s);
		$("#newBitcoinAddress").val(coin.address);
		$("#newPubKey").val(coin.pubkey);
		$("#newPrivKey").val(coin.wif);

		/* encrypted key code */
		if($("#encryptKey").is(":checked")){
			var encryptionPassword = $("#aes256pass").val();
			var encryptionPasswordConfirm = $("#aes256pass_confirm").val();

			var minimumEncryptionPasswordLength = 16;
			var hasLowercase = /[a-z]/.test(encryptionPassword);
			var hasUppercase = /[A-Z]/.test(encryptionPassword);
			var hasNumber = /[0-9]/.test(encryptionPassword);
			var hasSymbol = /[^A-Za-z0-9]/.test(encryptionPassword);
			var isStrongEncryptionPassword = (
				encryptionPassword.length >= minimumEncryptionPasswordLength &&
				hasLowercase &&
				hasUppercase &&
				hasNumber &&
				hasSymbol
			);

			if(encryptionPassword !== encryptionPasswordConfirm){
				$("#aes256passStatus").removeClass("hidden");
				$("#aes256passStatus .alert").html('<span class="glyphicon glyphicon-exclamation-sign"></span> Password mismatch. This encryption password protects only the exported private key text and is not recoverable.');
				$("#aes256wifkey").addClass("hidden");
				$("#newPrivKeyEnc").val('');
				return;
			}

			if(!isStrongEncryptionPassword){
				$("#aes256passStatus").removeClass("hidden");
				$("#aes256passStatus .alert").html('<span class="glyphicon glyphicon-exclamation-sign"></span> Weak encryption password. Use at least 16 characters with upper/lowercase, number, and symbol. Easy passwords are vulnerable to brute-force attacks.');
				$("#aes256wifkey").addClass("hidden");
				$("#newPrivKeyEnc").val('');
				return;
			}

			$("#aes256passStatus").addClass("hidden");
			$("#aes256wifkey").removeClass("hidden");
			$("#newPrivKeyEnc").val(CryptoJS.AES.encrypt(coin.wif, encryptionPassword)+'');
		} else {
			$("#aes256passStatus").addClass("hidden");
			$("#aes256wifkey").addClass("hidden");
			$("#newPrivKeyEnc").val('');
		}
	});
	
	$("#newPaperwalletBtn").click(function(){
		if($("#newBitcoinAddress").val()==""){
			$("#newKeysBtn").click();
		}

		var paperwallet = window.open();
		var paperUnit = (coinjs.getNetwork && coinjs.getNetwork().unit) || 'Coin';
		paperwallet.document.write('<h2>'+paperUnit+' Paper Wallet</h2><hr><div style="margin-top: 5px; margin-bottom: 5px"><div><h3 style="margin-top: 0">Address (Share)</h3></div><div style="text-align: center;"><div id="qraddress"></div><p>'+$("#newBitcoinAddress").val()+'</p></div></div><hr><div style="margin-top: 5px; margin-bottom: 5px"><div><h3 style="margin-top: 0">Public Key</h3></div><div style="text-align: center;"><div id="qrpubkey"></div><p>'+$("#newPubKey").val()+'</p></div></div><hr><div style="margin-top: 5px; margin-bottom: 5px"><div><h3 style="margin-top: 0">Private Key (KEEP SECRET!)</h3></div><div style="text-align: center;"><div id="qrprivkey"></div><p>'+$("#newPrivKey").val()+'</p></div></div>');
		paperwallet.document.close();
		paperwallet.focus();
		new QRCode(paperwallet.document.getElementById("qraddress"), {text: $("#newBitcoinAddress").val(), width: 125, height: 125});
		new QRCode(paperwallet.document.getElementById("qrpubkey"), {text: $("#newPubKey").val(), width: 125, height: 125});
		new QRCode(paperwallet.document.getElementById("qrprivkey"), {text: $("#newPrivKey").val(), width: 125, height: 125});
		paperwallet.print();
		paperwallet.close();
	});

	$("#newBrainwallet").click(function(){
		if($(this).is(":checked")){
			$("#brainwallet").removeClass("hidden");
			$("#brainwalletAckWrap").removeClass("hidden");
		} else {
			$("#brainwallet").addClass("hidden");
			$("#brainwalletAckWrap").addClass("hidden");
			$("#newBrainwalletAck").prop('checked', false);
		}
	});

	$("#newSegWitBrainwallet").click(function(){
		if($(this).is(":checked")){
			$("#brainwalletSegWit").removeClass("hidden");
			$("#brainwalletSegWitAckWrap").removeClass("hidden");
		} else {
			$("#brainwalletSegWit").addClass("hidden");
			$("#brainwalletSegWitAckWrap").addClass("hidden");
			$("#newSegWitBrainwalletAck").prop('checked', false);
		}
	});

	$("#encryptKey").click(function(){
		if($(this).is(":checked")){
			$("#encryptKeyWarning").removeClass("hidden");
			$("#aes256passform").removeClass("hidden");
		} else {
			$("#aes256wifkey, #aes256passform, #aes256passStatus, #encryptKeyWarning").addClass("hidden");
		}
	});

	/* new -> segwit code */
	$("#newSegWitKeysBtn").click(function(){
		var compressed = coinjs.compressed;
		coinjs.compressed = true;
		if(!brainwalletWarningsAcknowledged("#newSegWitBrainwallet")){
			alert('Acknowledge the brain-wallet warning before generating a custom-seed wallet.');
			return;
		}

		var s = ($("#newSegWitBrainwallet").is(":checked")) ? $("#brainwalletSegWit").val() : null;
		var coin = coinjs.newKeys(s);

		if($("#newSegWitBech32addr").is(":checked")){
			var sw = coinjs.bech32Address(coin.pubkey);
		} else {
			var sw = coinjs.segwitAddress(coin.pubkey);
		}

		$("#newSegWitAddress").val(sw.address);
		$("#newSegWitRedeemScript").val(sw.redeemscript);
		$("#newSegWitPubKey").val(coin.pubkey);
		$("#newSegWitPrivKey").val(coin.wif);
		coinjs.compressed = compressed;
	});

	$("#newSegwitPaperwalletBtn").click(function(){
		if($("#newSegWitAddress").val()==""){
			$("#newSegWitKeysBtn").click();
		}

		var paperwallet = window.open();
		var segwitPaperUnit = (coinjs.getNetwork && coinjs.getNetwork().unit) || 'Coin';
		paperwallet.document.write('<h2>'+segwitPaperUnit+' SegWit Paper Wallet</h2><hr><div style="margin-top: 5px; margin-bottom: 5px"><div><h3 style="margin-top: 0">Address (Share)</h3></div><div style="text-align: center;"><div id="qraddress"></div><p>'+$("#newSegWitAddress").val()+'</p></div></div><hr><div style="margin-top: 5px; margin-bottom: 5px"><div><h3 style="margin-top: 0">Public Key</h3></div><div style="text-align: center;"><div id="qrpubkey"></div><p>'+$("#newSegWitPubKey").val()+'</p></div></div><hr><div style="margin-top: 5px; margin-bottom: 5px"><div><h3 style="margin-top: 0">Redeem Script</h3></div><div style="text-align: center;"><div id="qrredeem"></div><p>'+$("#newSegWitRedeemScript").val()+'</p></div></div><hr><div style="margin-top: 5px; margin-bottom: 5px"><div><h3 style="margin-top: 0">Private Key (KEEP SECRET!)</h3></div><div style="text-align: center;"><div id="qrprivkey"></div><p>'+$("#newSegWitPrivKey").val()+'</p></div></div>');
		paperwallet.document.close();
		paperwallet.focus();
		new QRCode(paperwallet.document.getElementById("qraddress"), {text: $("#newSegWitAddress").val(), width: 110, height: 110});
		new QRCode(paperwallet.document.getElementById("qrpubkey"), {text: $("#newSegWitPubKey").val(), width: 110, height: 110});
		new QRCode(paperwallet.document.getElementById("qrredeem"), {text: $("#newSegWitRedeemScript").val(), width: 110, height: 110});
		new QRCode(paperwallet.document.getElementById("qrprivkey"), {text: $("#newSegWitPrivKey").val(), width: 110, height: 110});
		paperwallet.print();
		paperwallet.close();
	});

	/* new -> multisig code */

	$("#newMultiSigAddress").click(function(){

		$("#multiSigData").removeClass('show').addClass('hidden').fadeOut();
		$("#multisigPubKeys .pubkey").parent().removeClass('has-error');
		$("#releaseCoins").parent().removeClass('has-error');
		$("#multiSigErrorMsg").hide();

		if((isNaN($("#releaseCoins option:selected").html())) || ((!isNaN($("#releaseCoins option:selected").html())) && ($("#releaseCoins option:selected").html()>$("#multisigPubKeys .pubkey").length || $("#releaseCoins option:selected").html()*1<=0 || $("#releaseCoins option:selected").html()*1>8))){
			$("#releaseCoins").parent().addClass('has-error');
			$("#multiSigErrorMsg").html('<span class="glyphicon glyphicon-exclamation-sign"></span> Minimum signatures required is greater than the amount of public keys provided').fadeIn();
			return false;
		}

		var keys = [];
		$.each($("#multisigPubKeys .pubkey"), function(i,o){
			if(coinjs.pubkeydecompress($(o).val())){
				keys.push($(o).val());
				$(o).parent().removeClass('has-error');
			} else {
				$(o).parent().addClass('has-error');
			}
		});

		if(($("#multisigPubKeys .pubkey").parent().hasClass('has-error')==false) && $("#releaseCoins").parent().hasClass('has-error')==false){
			var sigsNeeded = $("#releaseCoins option:selected").html();
			var multisig =  coinjs.pubkeys2MultisigAddress(keys, sigsNeeded);
			if(multisig.size <= 520){
				$("#multiSigData .address").val(multisig['address']);
				$("#multiSigData .script").val(multisig['redeemScript']);
				$("#multiSigData .scriptUrl").val(document.location.origin+''+document.location.pathname+'?verify='+multisig['redeemScript']+'#verify');
				$("#multiSigData").removeClass('hidden').addClass('show').fadeIn();
				$("#releaseCoins").removeClass('has-error');
			} else {
				$("#multiSigErrorMsg").html('<span class="glyphicon glyphicon-exclamation-sign"></span> Your generated redeemscript is too large (>520 bytes) it can not be used safely').fadeIn();
			}
		} else {
			$("#multiSigErrorMsg").html('<span class="glyphicon glyphicon-exclamation-sign"></span> One or more public key is invalid!').fadeIn();
		}
	});

	$("#multisigPubKeys .pubkeyAdd").click(function(){
		if($("#multisigPubKeys .pubkeyRemove").length<14){
			var clone = '<div class="form-horizontal">'+$(this).parent().html()+'</div>';
			$("#multisigPubKeys").append(clone);
			$("#multisigPubKeys .glyphicon-plus:last").removeClass('glyphicon-plus').addClass('glyphicon-minus');
			$("#multisigPubKeys .glyphicon-minus:last").parent().removeClass('pubkeyAdd').addClass('pubkeyRemove');
			$("#multisigPubKeys .pubkeyRemove").unbind("");
			$("#multisigPubKeys .pubkeyRemove").click(function(){
				$(this).parent().fadeOut().remove();
			});
		}
	});

	$("#mediatorList").change(function(){
		var data = ($(this).val()).split(";");
		$("#mediatorPubkey").val(data[0]);
		$("#mediatorEmail").val(data[1]);
		$("#mediatorFee").val(data[2]);
	}).change();

	$("#mediatorAddKey").click(function(){
		var count = 0;
		var len = $(".pubkeyRemove").length;
		if(len<14){
			$.each($("#multisigPubKeys .pubkey"),function(i,o){
				if($(o).val()==''){
					$(o).val($("#mediatorPubkey").val()).fadeOut().fadeIn();
					$("#mediatorClose").click();
					return false;
				} else if(count==len){
					$("#multisigPubKeys .pubkeyAdd").click();
					$("#mediatorAddKey").click();
					return false;
				}
				count++;
			});

			$("#mediatorClose").click();
		}
	});

	/* new -> time locked code */

	$('#timeLockedDateTimePicker').datetimepicker({
		format: "MM/DD/YYYY HH:mm",
	});
	
	$('#timeLockedRbTypeBox input').change(function(){
		if ($('#timeLockedRbTypeDate').is(':checked')){
			$('#timeLockedDateTimePicker').show();
			$('#timeLockedBlockHeight').hide();
		} else {
			$('#timeLockedDateTimePicker').hide();
			$('#timeLockedBlockHeight').removeClass('hidden').show();
		}
	});

    $("#newTimeLockedAddress").click(function(){

        $("#timeLockedData").removeClass('show').addClass('hidden').fadeOut();
        $("#timeLockedPubKey").parent().removeClass('has-error');
        $("#timeLockedDateTimePicker").parent().removeClass('has-error');
        $("#timeLockedErrorMsg").hide();

        if(!coinjs.pubkeydecompress($("#timeLockedPubKey").val())) {
        	$('#timeLockedPubKey').parent().addClass('has-error');
        }

        var nLockTime = -1;

        if ($('#timeLockedRbTypeDate').is(':checked')){
        	// by date
	        var date = $('#timeLockedDateTimePicker').data("DateTimePicker").date();
	        if(!date || !date.isValid()) {
	        	$('#timeLockedDateTimePicker').parent().addClass('has-error');
	        }
	        nLockTime = date.unix()
	        if (nLockTime < 500000000) {
	        	$('#timeLockedDateTimePicker').parent().addClass('has-error');
	        }
        } else {
			nLockTime = parseInt($('#timeLockedBlockHeightVal').val(), 10);
	        if (nLockTime >= 500000000) {
	        	$('#timeLockedDateTimePicker').parent().addClass('has-error');
	        }
        }

        if(($("#timeLockedPubKey").parent().hasClass('has-error')==false) && $("#timeLockedDateTimePicker").parent().hasClass('has-error')==false){
        	try {
	            var hodl = coinjs.simpleHodlAddress($("#timeLockedPubKey").val(), nLockTime);
	            $("#timeLockedData .address").val(hodl['address']);
	            $("#timeLockedData .script").val(hodl['redeemScript']);
	            $("#timeLockedData .scriptUrl").val(document.location.origin+''+document.location.pathname+'?verify='+hodl['redeemScript']+'#verify');
	            $("#timeLockedData").removeClass('hidden').addClass('show').fadeIn();
	        } catch(e) {
	        	$("#timeLockedErrorMsg").html('<span class="glyphicon glyphicon-exclamation-sign"></span> ' + e).fadeIn();
	        }
        } else {
            $("#timeLockedErrorMsg").html('<span class="glyphicon glyphicon-exclamation-sign"></span> Public key and/or date is invalid!').fadeIn();
        }
    });

	/* new -> Hd address code */

	$(".deriveHDbtn").click(function(){
		$("#verifyScript").val($("input[type='text']",$(this).parent().parent()).val());
		window.location = "#verify";
		$("#verifyBtn").click();
	});

	$("#newHDKeysBtn").click(function(){
		coinjs.compressed = true;
		if(!brainwalletWarningsAcknowledged("#newHDBrainwallet")){
			alert('Acknowledge the brain-wallet warning before generating a custom-seed wallet.');
			return;
		}
		var s = ($("#newHDBrainwallet").is(":checked")) ? $("#HDBrainwallet").val() : null;
		var hd = coinjs.hd();
		var pair = hd.master(s);
		$("#newHDxpub").val(pair.pubkey);
		$("#newHDxprv").val(pair.privkey);

	});

	$("#newHDBrainwallet").click(function(){
		if($(this).is(":checked")){
			$("#HDBrainwallet").removeClass("hidden");
			$("#HDBrainwalletAckWrap").removeClass("hidden");
		} else {
			$("#HDBrainwallet").addClass("hidden");
			$("#HDBrainwalletAckWrap").addClass("hidden");
			$("#newHDBrainwalletAck").prop('checked', false);
		}
	});

	/* new -> transaction code */

	$("#recipients .addressAddTo").click(function(){
		if($("#recipients .addressRemoveTo").length<19){
			var clone = '<div class="row recipient"><br>'+$(this).parent().parent().html()+'</div>';
			$("#recipients").append(clone);
			$("#recipients .glyphicon-plus:last").removeClass('glyphicon-plus').addClass('glyphicon-minus');
			$("#recipients .glyphicon-minus:last").parent().removeClass('addressAdd').addClass('addressRemoveTo');
			$("#recipients .addressRemoveTo").unbind("");
			$("#recipients .addressRemoveTo").click(function(){
				$(this).parent().parent().fadeOut().remove();
				validateOutputAmount();
			});
			validateOutputAmount();
		}
	});

	$("#inputs .txidAdd").click(function(){
		var clone = '<div class="row inputs"><br>'+$(this).parent().parent().html()+'</div>';
		$("#inputs").append(clone);
		$("#inputs .txidClear:last").remove();
		$("#inputs .glyphicon-plus:last").removeClass('glyphicon-plus').addClass('glyphicon-minus');
		$("#inputs .glyphicon-minus:last").parent().removeClass('txidAdd').addClass('txidRemove');
		$("#inputs .txidRemove").unbind("");
		$("#inputs .txidRemove").click(function(){
			$(this).parent().parent().fadeOut().remove();
			totalInputAmount();
		});
		$("#inputs .row:last input").attr('disabled',false);

		$("#inputs .txIdAmount").unbind("").change(function(){
			totalInputAmount();
		}).keyup(function(){
			totalInputAmount();
		});

	});

	$("#transactionBtn").click(function(){
		var tx = coinjs.transaction();
		var estimatedTxSize = 10; // <4:version><1:txInCount><1:txOutCount><4:nLockTime>

		$("#transactionCreate, #transactionCreateStatus").addClass("hidden");

		if(($("#nLockTime").val()).match(/^[0-9]+$/g)){
			tx.lock_time = $("#nLockTime").val()*1;
		}

		$("#inputs .row").removeClass('has-error');

		$('#putTabs a[href="#txinputs"], #putTabs a[href="#txoutputs"]').attr('style','');

		$.each($("#inputs .row"), function(i,o){
			if(!($(".txId",o).val()).match(/^[a-f0-9]+$/i)){
				$(o).addClass("has-error");
			} else if((!($(".txIdScript",o).val()).match(/^[a-f0-9]+$/i)) && $(".txIdScript",o).val()!=""){
				$(o).addClass("has-error");
			} else if (!($(".txIdN",o).val()).match(/^[0-9]+$/i)){
				$(o).addClass("has-error");
			}

			if(!$(o).hasClass("has-error")){
				var seq = 0xffffffff-1;
				if($("#txRBF").is(":checked")){
					seq = 0xffffffff-2;
				}

				var currentScript = $(".txIdScript",o).val();
				if (currentScript.match(/^76a914[0-9a-f]{40}88ac$/)) {
					estimatedTxSize += 147
				} else if (currentScript.match(/^5[1-9a-f](?:210[23][0-9a-f]{64}){1,15}5[1-9a-f]ae$/)) {
					// <74:persig <1:push><72:sig><1:sighash> ><34:perpubkey <1:push><33:pubkey> > <32:prevhash><4:index><4:nSequence><1:m><1:n><1:OP>
					var scriptSigSize = (parseInt(currentScript.slice(1,2),16) * 74) + (parseInt(currentScript.slice(-3,-2),16) * 34) + 43
					// varint 2 bytes if scriptSig is > 252
					estimatedTxSize += scriptSigSize + (scriptSigSize > 252 ? 2 : 1)
				} else {
					// underestimating won't hurt. Just showing a warning window anyways.
					estimatedTxSize += 147
				}

				tx.addinput($(".txId",o).val(), $(".txIdN",o).val(), $(".txIdScript",o).val(), seq);
			} else {
				$('#putTabs a[href="#txinputs"]').attr('style','color:#a94442;');
			}
		});

		$("#recipients .row").removeClass('has-error');

		$.each($("#recipients .row"), function(i,o){
			var a = ($(".address",o).val());
			var ad = coinjs.addressDecode(a);
			if(((a!="") && (ad.version == coinjs.pub || ad.version == coinjs.multisig || ad.type=="bech32")) && $(".amount",o).val()!=""){ // address
				// P2SH output is 32, P2PKH is 34
				estimatedTxSize += (ad.version == coinjs.pub ? 34 : 32)
				tx.addoutput(a, $(".amount",o).val());
			} else if (((a!="") && ad.version === 42) && $(".amount",o).val()!=""){ // stealth address
				// 1 P2PKH and 1 OP_RETURN with 36 bytes, OP byte, and 8 byte value
				estimatedTxSize += 78
				tx.addstealth(ad, $(".amount",o).val());
			} else if (((($("#opReturn").is(":checked")) && a.match(/^[a-f0-9]+$/ig)) && a.length<160) && (a.length%2)==0) { // data
				estimatedTxSize += (a.length / 2) + 1 + 8
				tx.adddata(a);
			} else { // neither address nor data
				$(o).addClass('has-error');
				$('#putTabs a[href="#txoutputs"]').attr('style','color:#a94442;');
			}
		});


		if(!$("#recipients .row, #inputs .row").hasClass('has-error')){
			
			$("#transactionCreate textarea").val(tx.serialize());
			$("#transactionCreate .txSize").html(tx.size());

			if($("#feesestnewtx").attr('est')=='y'){
				$("#fees .txhex").val($("#transactionCreate textarea").val());
				$("#feesAnalyseBtn").click();
				$("#fees .txhex").val("");
				window.location = "#fees";
			} else {

				$("#transactionCreate").removeClass("hidden");

				// Check fee against hard 0.01 as well as fluid 200 satoshis per byte calculation.
				if($("#transactionFee").val()>=0.01 || $("#transactionFee").val()>= estimatedTxSize * 200 * 1e-8){
					$("#modalWarningFeeAmount").html($("#transactionFee").val());
					$("#modalWarningFee").modal("show");
				}
			}
			$("#feesestnewtx").attr('est','');
		} else {
			$("#transactionCreateStatus").removeClass("hidden").html("One or more input or output is invalid").fadeOut().fadeIn();
		}
	});

	$("#feesestnewtx").click(function(){
		$(this).attr('est','y');
		$("#transactionBtn").click();
	});

	$("#feesestwallet").click(function(){
		$(this).attr('est','y');
		var outputs = $("#walletSpendTo .output").length;

		$("#fees .inputno, #fees .outputno, #fees .bytes").html(0);
		$("#fees .slider").val(0);

		var tx = coinjs.transaction();
		tx.listUnspent($("#walletAddress").html(), function(data){
			var inputs = $(data).find("unspent").children().length;
			if($("#walletSegwit").is(":checked")){	
				$("#fees .txi_segwit").val(inputs);
				$("#fees .txi_segwit").trigger('input');
			} else {
				$("#fees .txi_regular").val(inputs);
				$("#fees .txi_regular").trigger('input');
			}

			$.each($("#walletSpendTo .output"), function(i,o){
				var addr = $('.addressTo',o);
				var ad = coinjs.addressDecode(addr.val());
				if (ad.version == coinjs.pub){ // p2pkh
					$("#fees .txo_p2pkh").val(($("#fees .txo_p2pkh").val()*1)+1);
					$("#fees .txo_p2pkh").trigger('input');					
				} else { // p2psh
					$("#fees .txo_p2sh").val(($("#fees .txo_p2sh").val()*1)+1);
					$("#fees .txo_p2sh").trigger('input');
				}
			});

			if(($("#developerDonation").val()*1)>0 && coinjs.developer){
				var addr = coinjs.developer;
				var ad = coinjs.addressDecode(addr);
				if (ad.version == coinjs.pub){ // p2pkh
					$("#fees .txo_p2pkh").val(($("#fees .txo_p2pkh").val()*1)+1);
					$("#fees .txo_p2pkh").trigger('input');	
				} else { // p2psh
					$("#fees .txo_p2sh").val(($("#fees .txo_p2sh").val()*1)+1);
					$("#fees .txo_p2sh").trigger('input');
				}
			}

		});

		//feeStats();
		window.location = "#fees";
	});

	$(".txidClear").click(function(){
		$("#inputs .row:first input").attr('disabled',false);
		$("#inputs .row:first input").val("");
		totalInputAmount();
	});

	$("#inputs .txIdAmount").unbind("").change(function(){
		totalInputAmount();
	}).keyup(function(){
		totalInputAmount();
	});

	$("#donateTxBtn").click(function(){

		var exists = false;

		$.each($("#recipients .address"), function(i,o){
			if($(o).val() == coinjs.developer){
				exists = true;
				$(o).fadeOut().fadeIn();
				return true;
			}
		});

		if(!exists){
			if($("#recipients .recipient:last .address:last").val() != ""){
				$("#recipients .addressAddTo:first").click();
			};

			$("#recipients .recipient:last .address:last").val(coinjs.developer).fadeOut().fadeIn();

			return true;
		}
	});

	/* code for the qr code scanner */

	$(".qrcodeScanner").click(function(){
		if ((typeof MediaStreamTrack === 'function') && typeof MediaStreamTrack.getSources === 'function'){
			MediaStreamTrack.getSources(function(sourceInfos){
				var f = 0;
				$("select#videoSource").html("");
				for (var i = 0; i !== sourceInfos.length; ++i) {
					var sourceInfo = sourceInfos[i];
					var option = document.createElement('option');
					option.value = sourceInfo.id;
					if (sourceInfo.kind === 'video') {
						option.text = sourceInfo.label || 'camera ' + ($("select#videoSource options").length + 1);
						$(option).appendTo("select#videoSource");
 					}
				}
			});

			$("#videoSource").unbind("change").change(function(){
				scannerStart()
			});

		} else {
			$("#videoSource").addClass("hidden");
		}
		scannerStart();
		$("#qrcode-scanner-callback-to").html($(this).attr('forward-result'));
	});

	function scannerStart(){
		navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || false;
		if(navigator.getUserMedia){
			if (!!window.stream) {
				$("video").attr('src',null);
  			}

			var videoSource = $("select#videoSource").val();
			var constraints = {
				video: {
					optional: [{sourceId: videoSource}]
				}
			};

			navigator.getUserMedia(constraints, function(stream){
				window.stream = stream; // make stream available to console
				var videoElement = document.querySelector('video');
				try {
					videoElement.srcObject = stream;
				} catch {
					videoElement.src = window.URL.createObjectURL(stream);
				}
				videoElement.play();
			}, function(error){ });


			QCodeDecoder().decodeFromVideo(document.getElementById('videoReader'), function(er,data){
				if(!er){
					var match = data.match(/^rod\:([a-z0-9]{25,90})/i);
					var result = match ? match[1] : data;
					$(""+$("#qrcode-scanner-callback-to").html()).val(result);
					$("#qrScanClose").click();
				}
			});

		} else {
			$("#videoReaderError").removeClass("hidden");
			$("#videoReader, #videoSource").addClass("hidden");
		}
	}

	/* redeem from button code */

	$("#redeemFromBtn").click(function(){
		var redeem = redeemingFrom($("#redeemFrom").val());	

		$("#redeemFromStatus, #redeemFromAddress").addClass('hidden');

		if(redeem.from=='multisigAddress'){
			$("#redeemFromStatus").removeClass('hidden').html('<span class="glyphicon glyphicon-exclamation-sign"></span> You should use the redeem script, not its address!');
			return false;
		}

		if(redeem.from=='other'){
			$("#redeemFromStatus").removeClass('hidden').html('<span class="glyphicon glyphicon-exclamation-sign"></span> The address or redeem script you have entered is invalid');
			return false;
		}

		if($("#clearInputsOnLoad").is(":checked")){
			$("#inputs .txidRemove, #inputs .txidClear").click();
		}

		$("#redeemFromBtn").html("Please wait, loading...").attr('disabled',true);

		var host = $(this).attr('rel');

		listUnspentDefault(redeem);

		if($("#redeemFromStatus").hasClass("hidden")) {
			// An ethical dilemma: Should we automatically set nLockTime?
			if(redeem.from == 'redeemScript' && redeem.type == "hodl__") {
				$("#nLockTime").val(redeem.decodescript.checklocktimeverify);
			} else {
				$("#nLockTime").val(0);
			}
		}
	});

	/* function to determine what we are redeeming from */
	function redeemingFrom(string){
		var r = {};
		var decode = coinjs.addressDecode(string);
		if(decode.version == coinjs.pub){ // regular address
			r.addr = string;
			r.from = 'address';
			r.redeemscript = false;
		} else if (decode.version == coinjs.priv){ // wif key
			var a = coinjs.wif2address(string);
			r.addr = a['address'];
			r.from = 'wif';
			r.redeemscript = false;
		} else if (decode.version == coinjs.multisig){ // mulisig address
			r.addr = '';
			r.from = 'multisigAddress';
			r.redeemscript = false;
		} else if(decode.type == 'bech32'){
			r.addr = string;
			r.from = 'bech32';
			r.decodedRs = decode.redeemscript;
			r.redeemscript = true;
		} else {
			var script = coinjs.script();
			var decodeRs = script.decodeRedeemScript(string);
			if(decodeRs){ // redeem script
				r.addr = decodeRs['address'];
				r.from = 'redeemScript';
				r.decodedRs = decodeRs.redeemscript;
				r.type = decodeRs['type'];
				r.redeemscript = true;
				r.decodescript = decodeRs;
			} else { // something else
				if(string.match(/^[a-f0-9]{64}$/i)){
					r.addr = string;
					r.from = 'txid';
					r.redeemscript = false;
				} else {
					r.addr = '';
					r.from = 'other';
					r.redeemscript = false;
				}
			}
		}
		return r;
	}

	/* mediator payment code for when you used a public key */
	function mediatorPayment(redeem){

		if(redeem.from=="redeemScript"){

			$('#recipients .row[rel="'+redeem.addr+'"]').parent().remove();

			if (redeem.decodedRs.pubkeys) {
				$.each(redeem.decodedRs.pubkeys, function(i, o){
					$.each($("#mediatorList option"), function(mi, mo){

						var ms = ($(mo).val()).split(";");

						var pubkey = ms[0]; // mediators pubkey
						var fee = ms[2]*1; // fee in a percentage
						var payto = coinjs.pubkey2address(pubkey); // pay to mediators address

						if(o==pubkey){ // matched a mediators pubkey?

							var clone = '<span><div class="row recipients mediator mediator_'+pubkey+'" rel="'+redeem.addr+'">'+$("#recipients .addressAddTo").parent().parent().html()+'</div><br></span>';
							$("#recipients").prepend(clone);

							$("#recipients .mediator_"+pubkey+" .glyphicon-plus:first").removeClass('glyphicon-plus');
							$("#recipients .mediator_"+pubkey+" .address:first").val(payto).attr('disabled', true).attr('readonly',true).attr('title','Medation fee for '+$(mo).html());

							var amount = ((fee*$("#totalInput").html())/100).toFixed(8);
							$("#recipients .mediator_"+pubkey+" .amount:first").attr('disabled',(((amount*1)==0)?false:true)).val(amount).attr('title','Medation fee for '+$(mo).html());
						}
					});
				});
			}

			validateOutputAmount();
		}
	}

	/* global function to add outputs to page */
	function addOutput(tx, n, script, amount) {
		if(tx){
			if($("#inputs .txId:last").val()!=""){
				$("#inputs .txidAdd").click();
			}

			$("#inputs .row:last input").attr('disabled',true);

			var txid = ((tx).match(/.{1,2}/g).reverse()).join("")+'';

			$("#inputs .txId:last").val(txid);
			$("#inputs .txIdN:last").val(n);
			$("#inputs .txIdAmount:last").val(amount);

			if(((script.match(/^00/) && script.length==44)) || (script.length==40 && script.match(/^[a-f0-9]+$/gi))){
				s = coinjs.script();
				s.writeBytes(Crypto.util.hexToBytes(script));
				s.writeOp(0);
				s.writeBytes(coinjs.numToBytes((amount*100000000).toFixed(0), 8));
				script = Crypto.util.bytesToHex(s.buffer);
			}

			$("#inputs .txIdScript:last").val(script);
		}
	}

	/* global function to add inputs to page */
	function addInput(address, amount) {
		if($("#recipients .recipient:last .address:last").val() != ""){
			$("#recipients .addressAddTo:first").click();
		};

		$("#recipients .address:last").val(address);
		$("#recipients .amount:last").val(amount);
	}


	/* default function to retreive unspent outputs*/	
	function listUnspentDefault(redeem){

		var tx = coinjs.transaction();

		// unspent from transaction; double spend and RBF.

		if(redeem.from == 'txid'){
			tx.getTransaction(redeem.addr, function(data){
				if (data["error"]) {
					$("#redeemFromStatus").removeClass('hidden').html('<span class="glyphicon glyphicon-exclamation-sign"></span> Unexpected error, unable to retrieve unspent outputs. '+data["error"]);
					$("#redeemFromBtn").html("Load").attr('disabled',false);
					return;
				}

				$("#redeemFromAddress").removeClass('hidden').html('<span class="glyphicon glyphicon-info-sign"></span> Attempted to rebuild transaction id <a href="'+explorer_tx+redeem.addr+'" target="_blank">'+redeem.addr+'</a>');

				$.each(data["data"], function(i,o){
					var tx = o["transaction_hash"];
					var n = o["vout"];
					var script = (redeem.redeemscript==true) ? redeem.decodedRs : o["script_pub_key_hex"];
					var amount = o["value"];

					addOutput(tx, n, script, amount);
				});

				$("#recipients .addressRemoveTo").click();
				$("#recipients .address").val("");
				$("#recipients .amount").val("");

				$.each($(data).find("outputs").children(), function(i,o){
					addInput($(o).find("address").text(), $(o).find("value").text());
				});

				$("#redeemFromBtn").html("Load").attr('disabled',false);
				totalInputAmount();
				validateOutputAmount();

			});

			return;
		}

		// unspent from address

		tx.listUnspent(redeem.addr, function(data){
			if (data["error"]) {
				$("#redeemFromStatus").removeClass('hidden').html('<span class="glyphicon glyphicon-exclamation-sign"></span> Unexpected error, unable to retrieve unspent outputs. '+data["error"]);
				$("#redeemFromBtn").html("Load").attr('disabled',false);
				return;
			}

			if(redeem.addr) {
				$("#redeemFromAddress").removeClass('hidden').html('<span class="glyphicon glyphicon-info-sign"></span> Retrieved unspent inputs from address <a href="'+explorer_addr+redeem.addr+'" target="_blank">'+redeem.addr+'</a>');

				$.each(data["data"], function(i,o){
					var tx = o["transaction_hash"];
					var n = o["vout"];
					var script = (redeem.redeemscript==true) ? redeem.decodedRs : o["script_pub_key_hex"];
					var amount = o["value"];

					addOutput(tx, n, script, amount);
				});
			}

			$("#redeemFromBtn").html("Load").attr('disabled',false);
			totalInputAmount();

			mediatorPayment(redeem);
		});
	}



	/* math to calculate the inputs and outputs */

	function totalInputAmount(){
		$("#totalInput").html('0.00');
		$.each($("#inputs .txIdAmount"), function(i,o){
			if(isNaN($(o).val())){
				$(o).parent().addClass('has-error');
			} else {
				$(o).parent().removeClass('has-error');
				var f = 0;
				if(!isNaN($(o).val())){
					f += $(o).val()*1;
				}
				$("#totalInput").html((($("#totalInput").html()*1) + (f*1)).toFixed(8));
			}
		});
		totalFee();
	}

	function validateOutputAmount(){
		$("#recipients .amount").unbind('');
		$("#recipients .amount").keyup(function(){
			if(isNaN($(this).val())){
				$(this).parent().addClass('has-error');
			} else {
				$(this).parent().removeClass('has-error');
				var f = 0;
				$.each($("#recipients .amount"),function(i,o){
					if(!isNaN($(o).val())){
						f += $(o).val()*1;
					}
				});
				$("#totalOutput").html((f).toFixed(8));
			}
			totalFee();
		}).keyup();
	}

	function totalFee(){
		var fee = (($("#totalInput").html()*1) - ($("#totalOutput").html()*1)).toFixed(8);
		$("#transactionFee").val((fee>0)?fee:'0.00');
	}

	$(".optionsCollapse").click(function(){
		if($(".optionsAdvanced",$(this).parent()).hasClass('hidden')){
			$(".glyphcollapse",$(this).parent()).removeClass('glyphicon-collapse-down').addClass('glyphicon-collapse-up');
			$(".optionsAdvanced",$(this).parent()).removeClass("hidden");
		} else {
			$(".glyphcollapse",$(this).parent()).removeClass('glyphicon-collapse-up').addClass('glyphicon-collapse-down');
			$(".optionsAdvanced",$(this).parent()).addClass("hidden");
		}
	});

	/* broadcast a transaction */

	$("#rawSubmitBtn").click(function(){
		rawSubmitDefault(this);
	});

	// broadcast transaction via coinbin (default)
function rawSubmitDefault(btn){
  if(!captchaPassed()){
    return;
  }
  var thisbtn = btn;		
		$(thisbtn).val('Please wait, loading...').attr('disabled',true);
		var tx = coinjs.transaction();
		tx.broadcast(function(data) {
			if(data && data.success){
				$("#rawTransactionStatus").addClass('alert-success').removeClass('alert-danger').removeClass("hidden").html(' TXID: ' + data.txid + '<br> <a href="https://explorer.rod.spacexpanse.org/tx/' + data.txid + '" target="_blank">View on Blockchain</a>');
			} else {
				var errorMessage = (data && data.response) ? data.response : 'There was an error submitting your request, please try again';
				$("#rawTransactionStatus").addClass('alert-danger').removeClass('alert-success').removeClass("hidden").html('<span class="glyphicon glyphicon-exclamation-sign"></span> '+errorMessage);
			}

			$("#rawTransactionStatus").fadeOut().fadeIn();
			$(thisbtn).val('Submit').attr('disabled',false);
		}, $("#rawTransaction").val());
	}





	/* verify script code */

	$("#verifyBtn").click(function(){
		$(".verifyData").addClass("hidden");
		$("#verifyStatus").hide();
		if(!decodeRedeemScript()){
			if(!decodeTransactionScript()){
				if(!decodePrivKey()){
					if(!decodePubKey()){
						if(!decodeHDaddress()){
							$("#verifyStatus").removeClass('hidden').fadeOut().fadeIn();
						}
					}
				}
			}
		}

	});

	function decodeRedeemScript(){
		var script = coinjs.script();
		var decode = script.decodeRedeemScript($("#verifyScript").val());
		if(decode){
			$("#verifyRsDataMultisig").addClass('hidden');
			$("#verifyRsDataHodl").addClass('hidden');
			$("#verifyRsDataSegWit").addClass('hidden');
			$("#verifyRsData").addClass("hidden");


			if(decode.type == "multisig__") {
				$("#verifyRsDataMultisig .multisigAddress").val(decode['address']);
				$("#verifyRsDataMultisig .signaturesRequired").html(decode['signaturesRequired']);
				$("#verifyRsDataMultisig table tbody").html("");
				for(var i=0;i<decode.pubkeys.length;i++){
					var pubkey = decode.pubkeys[i];
					var address = coinjs.pubkey2address(pubkey);
					$('<tr><td width="30%"><input type="text" class="form-control" value="'+address+'" readonly></td><td><input type="text" class="form-control" value="'+pubkey+'" readonly></td></tr>').appendTo("#verifyRsDataMultisig table tbody");
				}
				$("#verifyRsData").removeClass("hidden");
				$("#verifyRsDataMultisig").removeClass('hidden');
				$(".verifyLink").attr('href','?verify='+$("#verifyScript").val());
				return true;
			} else if(decode.type == "segwit__"){
				$("#verifyRsData").removeClass("hidden");
				$("#verifyRsDataSegWit .segWitAddress").val(decode['address']);
				$("#verifyRsDataSegWit").removeClass('hidden');
				return true;
			} else if(decode.type == "hodl__") {
				var d = $("#verifyRsDataHodl .date").data("DateTimePicker");
				$("#verifyRsDataHodl .address").val(decode['address']);
				$("#verifyRsDataHodl .pubkey").val(coinjs.pubkey2address(decode['pubkey']));
				$("#verifyRsDataHodl .date").val(decode['checklocktimeverify'] >= 500000000? moment.unix(decode['checklocktimeverify']).format("MM/DD/YYYY HH:mm") : decode['checklocktimeverify']);
				$("#verifyRsData").removeClass("hidden");
				$("#verifyRsDataHodl").removeClass('hidden');
				$(".verifyLink").attr('href','?verify='+$("#verifyScript").val());
				return true;
			}
		}
		return false;
	}

	function decodeTransactionScript(){
		var tx = coinjs.transaction();
		try {
			var decode = tx.deserialize($("#verifyScript").val());
			$("#verifyTransactionData .transactionVersion").html(decode['version']);
			$("#verifyTransactionData .transactionSize").html(decode.size()+' <i>bytes</i>');
			$("#verifyTransactionData .transactionLockTime").html(decode['lock_time']);
			$("#verifyTransactionData .transactionRBF").hide();
			$("#verifyTransactionData .transactionSegWit").hide();
			if (decode.witness.length>=1) {
				$("#verifyTransactionData .transactionSegWit").show();
			}
			$("#verifyTransactionData").removeClass("hidden");
			$("#verifyTransactionData tbody").html("");

			var h = '';
			$.each(decode.ins, function(i,o){
				var s = decode.extractScriptKey(i);
				h += '<tr>';
				h += '<td><input class="form-control" type="text" value="'+o.outpoint.hash+'" readonly></td>';
				h += '<td class="col-xs-1">'+o.outpoint.index+'</td>';
				h += '<td class="col-xs-2"><input class="form-control" type="text" value="'+Crypto.util.bytesToHex(o.script.buffer)+'" readonly></td>';
				h += '<td class="col-xs-1"> <span class="glyphicon glyphicon-'+((s.signed=='true' || (decode.witness[i] && decode.witness[i].length==2))?'ok':'remove')+'-circle"></span>';
				if(s['type']=='multisig' && s['signatures']>=1){
					h += ' '+s['signatures'];
				}
				h += '</td>';
				h += '<td class="col-xs-1">';
				if(s['type']=='multisig'){
					var script = coinjs.script();
					var rs = script.decodeRedeemScript(s.script);
					h += rs['signaturesRequired']+' of '+rs['pubkeys'].length;
				} else {
					h += '<span class="glyphicon glyphicon-remove-circle"></span>';
				}
				h += '</td>';
				h += '</tr>';

				//debug
				if(parseInt(o.sequence)<(0xFFFFFFFF-1)){
					$("#verifyTransactionData .transactionRBF").show();
				}
			});

			$(h).appendTo("#verifyTransactionData .ins tbody");

			h = '';
			$.each(decode.outs, function(i,o){

				if(o.script.chunks.length==2 && o.script.chunks[0]==106){ // OP_RETURN

					var data = Crypto.util.bytesToHex(o.script.chunks[1]);
					var dataascii = hex2ascii(data);

					if(dataascii.match(/^[\s\d\w]+$/ig)){
						data = dataascii;
					}

					h += '<tr>';
					h += '<td><input type="text" class="form-control" value="(OP_RETURN) '+data+'" readonly></td>';
					h += '<td class="col-xs-1">'+(o.value/100000000).toFixed(8)+'</td>';
					h += '<td class="col-xs-2"><input class="form-control" type="text" value="'+Crypto.util.bytesToHex(o.script.buffer)+'" readonly></td>';
					h += '</tr>';
				} else {

					var addr = '';
					if(o.script.chunks.length==5){
						addr = coinjs.scripthash2address(Crypto.util.bytesToHex(o.script.chunks[2]));
					} else if((o.script.chunks.length==2) && o.script.chunks[0]==0){
						addr = coinjs.bech32_encode(coinjs.bech32.hrp, [coinjs.bech32.version].concat(coinjs.bech32_convert(o.script.chunks[1], 8, 5, true)));
					} else {
						var pub = coinjs.pub;
						coinjs.pub = coinjs.multisig;
						addr = coinjs.scripthash2address(Crypto.util.bytesToHex(o.script.chunks[1]));
						coinjs.pub = pub;
					}

					h += '<tr>';
					h += '<td><input class="form-control" type="text" value="'+addr+'" readonly></td>';
					h += '<td class="col-xs-1">'+(o.value/100000000).toFixed(8)+'</td>';
					h += '<td class="col-xs-2"><input class="form-control" type="text" value="'+Crypto.util.bytesToHex(o.script.buffer)+'" readonly></td>';
					h += '</tr>';
				}
			});
			$(h).appendTo("#verifyTransactionData .outs tbody");

			$(".verifyLink").attr('href','?verify='+$("#verifyScript").val());
			return true;
		} catch(e) {
			return false;
		}
	}

	function hex2ascii(hex) {
		var str = '';
		for (var i = 0; i < hex.length; i += 2)
			str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
		return str;
	}

	function decodePrivKey(){
		var wif = $("#verifyScript").val();
		if(wif.length==51 || wif.length==52){
			try {
				var w2address = coinjs.wif2address(wif);
				var w2pubkey = coinjs.wif2pubkey(wif);
				var w2privkey = coinjs.wif2privkey(wif);

				$("#verifyPrivKey .address").val(w2address['address']);
				$("#verifyPrivKey .pubkey").val(w2pubkey['pubkey']);
				$("#verifyPrivKey .privkey").val(w2privkey['privkey']);
				$("#verifyPrivKey .iscompressed").html(w2address['compressed']?'true':'false');

				$("#verifyPrivKey").removeClass("hidden");
				return true;
			} catch (e) {
				return false;
			}
		} else {
			return false;
		}
	}

	function decodePubKey(){
		var pubkey = $("#verifyScript").val();
		if(pubkey.length==66 || pubkey.length==130){
			try {
				$("#verifyPubKey .verifyDataSw").addClass('hidden');
				$("#verifyPubKey .address").val(coinjs.pubkey2address(pubkey));
				if(pubkey.length == 66){
					var sw = coinjs.segwitAddress(pubkey);
					$("#verifyPubKey .addressSegWit").val(sw.address);
					$("#verifyPubKey .addressSegWitRedeemScript").val(sw.redeemscript);

					var b32 = coinjs.bech32Address(pubkey);
					$("#verifyPubKey .addressBech32").val(b32.address);
					$("#verifyPubKey .addressBech32RedeemScript").val(b32.redeemscript);

					$("#verifyPubKey .verifyDataSw").removeClass('hidden');
				}
				$("#verifyPubKey").removeClass("hidden");
				$(".verifyLink").attr('href','?verify='+$("#verifyScript").val());
				return true;
			} catch (e) {
				return false;
			}
		} else {
			return false;
		}
	}

	function decodeHDaddress(){
		coinjs.compressed = true;
		var s = $("#verifyScript").val();
		try {
			var hex = Crypto.util.bytesToHex((coinjs.base58decode(s)).slice(0,4));
			var hex_cmp_prv = Crypto.util.bytesToHex((coinjs.numToBytes(coinjs.hdkey.prv,4)).reverse());
			var hex_cmp_pub = Crypto.util.bytesToHex((coinjs.numToBytes(coinjs.hdkey.pub,4)).reverse());
			if(hex == hex_cmp_prv || hex == hex_cmp_pub){
				var hd = coinjs.hd(s);
				$("#verifyHDaddress .hdKey").html(s);
				$("#verifyHDaddress .chain_code").val(Crypto.util.bytesToHex(hd.chain_code));
				$("#verifyHDaddress .depth").val(hd.depth);
				$("#verifyHDaddress .version").val('0x'+(hd.version).toString(16));
				$("#verifyHDaddress .child_index").val(hd.child_index);
				$("#verifyHDaddress .hdwifkey").val((hd.keys.wif)?hd.keys.wif:'');
				$("#verifyHDaddress .key_type").html((((hd.depth==0 && hd.child_index==0)?'Master':'Derived')+' '+hd.type).toLowerCase());
				$("#verifyHDaddress .parent_fingerprint").val(Crypto.util.bytesToHex(hd.parent_fingerprint));
				$("#verifyHDaddress .derived_data table tbody").html("");
				deriveHDaddress();
				$(".verifyLink").attr('href','?verify='+$("#verifyScript").val());
				$("#verifyHDaddress").removeClass("hidden");
				return true;
			}
		} catch (e) {
			return false;
		}
	}

	function deriveHDaddress() {
		var hd = coinjs.hd($("#verifyHDaddress .hdKey").html());
		var index_start = $("#verifyHDaddress .derivation_index_start").val()*1;
		var index_end = $("#verifyHDaddress .derivation_index_end").val()*1;
		var html = '';
		$("#verifyHDaddress .derived_data table tbody").html("");
		for(var i=index_start;i<=index_end;i++){
			if($("#hdpathtype option:selected").val()=='simple'){
				var derived = hd.derive(i);
			} else {
				var derived = hd.derive_path(($("#hdpath input").val().replace(/\/+$/, ""))+'/'+i);
			}
			html += '<tr>';
			html += '<td>'+i+'</td>';
			html += '<td><input type="text" class="form-control" value="'+derived.keys.address+'" readonly></td>';
			html += '<td><input type="text" class="form-control" value="'+((derived.keys.wif)?derived.keys.wif:'')+'" readonly></td>';
			html += '<td><input type="text" class="form-control" value="'+derived.keys_extended.pubkey+'" readonly></td>';
			html += '<td><input type="text" class="form-control" value="'+((derived.keys_extended.privkey)?derived.keys_extended.privkey:'')+'" readonly></td>';
			html += '</tr>';
		}
		$(html).appendTo("#verifyHDaddress .derived_data table tbody");
	}


	$("#hdpathtype").change(function(){
		if($(this).val()=='simple'){
			$("#hdpath").removeClass().addClass("hidden");
		} else {
			$("#hdpath").removeClass();
		}
	});


	/* sign code */

	$("#signBtn").click(function(){
		var wifkey = $("#signPrivateKey");
		var script = $("#signTransaction");

		if(coinjs.addressDecode(wifkey.val())){
			$(wifkey).parent().removeClass('has-error');
		} else {
			$(wifkey).parent().addClass('has-error');
		}

		if((script.val()).match(/^[a-f0-9]+$/ig)){
			$(script).parent().removeClass('has-error');
		} else {
			$(script).parent().addClass('has-error');
		}

		if($("#sign .has-error").length==0){
			$("#signedDataError").addClass('hidden');
			try {
				var tx = coinjs.transaction();
				var t = tx.deserialize(script.val());

				var signed = t.sign(wifkey.val(), $("#sighashType option:selected").val());
				$("#signedData textarea").val(signed);
				$("#signedData .txSize").html(t.size());
				$("#signedData").removeClass('hidden').fadeIn();
			} catch(e) {
				// console.log(e);
			}
		} else {
			$("#signedDataError").removeClass('hidden');
			$("#signedData").addClass('hidden');
		}
	});

	$("#sighashType").change(function(){
		$("#sighashTypeInfo").html($("option:selected",this).attr('rel')).fadeOut().fadeIn();
	});

	$("#signAdvancedCollapse").click(function(){
		if($("#signAdvanced").hasClass('hidden')){
			$("span",this).removeClass('glyphicon-collapse-down').addClass('glyphicon-collapse-up');
			$("#signAdvanced").removeClass("hidden");
		} else {
			$("span",this).removeClass('glyphicon-collapse-up').addClass('glyphicon-collapse-down');
			$("#signAdvanced").addClass("hidden");
		}
	});

	/* page load code */

	function _get(value) {
		var dataArray = (document.location.search).match(/(([a-z0-9\_\[\]]+\=[a-z0-9\_\.\%\@]+))/gi);
		var r = [];
		if(dataArray) {
			for(var x in dataArray) {
				if((dataArray[x]) && typeof(dataArray[x])=='string') {
					if((dataArray[x].split('=')[0].toLowerCase()).replace(/\[\]$/ig,'') == value.toLowerCase()) {
						r.push(unescape(dataArray[x].split('=')[1]));
					}
				}
			}
		}
		return r;
	}

	var _getBroadcast = _get("broadcast");
	if(_getBroadcast[0]){
		$("#rawTransaction").val(_getBroadcast[0]);
		$("#rawSubmitBtn").click();
		window.location.hash = "#broadcast";
	}

	var _getVerify = _get("verify");
	if(_getVerify[0]){
		$("#verifyScript").val(_getVerify[0]);
		$("#verifyBtn").click();
		window.location.hash = "#verify";
	}

	$('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
		if(e.target.hash == "#fees"){
			feeStats();
		}
	})

	$(".qrcodeBtn").click(function(){
		$("#qrcode").html("");
		var thisbtn = $(this).parent().parent();
		var qrstr = false;
		var ta = $("textarea",thisbtn);

		if(ta.length>0){
			var w = (screen.availWidth > screen.availHeight ? screen.availWidth : screen.availHeight)/3;
			var qrcode = new QRCode("qrcode", {width:w, height:w});
			qrstr = $(ta).val();
			if(qrstr.length > 1024){
				$("#qrcode").html("<p>Sorry the data is too long for the QR generator.</p>");
			}
		} else {
			var qrcode = new QRCode("qrcode");
			qrstr = "rod:"+$('.address',thisbtn).val();
		}

		if(qrstr){
			qrcode.makeCode(qrstr);
		}
	});

	$('input[title!=""], abbr[title!=""]').tooltip({'placement':'bottom'});

	if (location.hash !== ''){
		$('a[href="' + location.hash + '"]').tab('show');
	}

	$(".showKey").click(function(){
		$("input[type='password']",$(this).parent().parent()).attr('type','text');
	});

	$("#homeBtn").click(function(e){
		e.preventDefault();
		history.pushState(null, null, '#home');
		$("#header .active, #content .tab-content").removeClass("active");
		$("#home").addClass("active");
	});

	$('a[data-toggle="tab"]').on('click', function(e) {
		e.preventDefault();
		var tabTarget = $(this).attr('href');
		if(tabTarget){
			$(this).tab('show');
			history.pushState(null, null, tabTarget);
		}
	});

	window.addEventListener("popstate", function(e) {
		var activeTab = $('[href=' + location.hash + ']');
		if (activeTab.length) {
			activeTab.tab('show');
		} else {
			$('.nav-tabs a:first').tab('show');
		}
	});

	for(i=1;i<3;i++){
		$(".pubkeyAdd").click();
	}

	validateOutputAmount();

	if(window.rodOtc && window.rodOtc.swap && window.rodOtc.swap.ui){
		window.rodOtc.swap.ui.init();
	}

	/* settings page code */

	/* Mainnet Settings entries are compiled from coinjs.networks, which itself
	   is compiled from chain-registry.js. ROD testnet remains an explicit
	   developer-only preset because it is not a mainnet chain profile. */
	var networks = [];
	var dropdownCodeMap = {};
	var registryNetworkCodes = Object.keys(coinjs.networks || {}).sort();
	for(var registryIndex = 0; registryIndex < registryNetworkCodes.length; registryIndex++){
		var registryCode = registryNetworkCodes[registryIndex];
		var registryNetwork = coinjs.networks[registryCode];
		var registryValue = registryCode.toLowerCase() + '-mainnet';
		networks.push({
			name: (registryNetwork.name || registryCode) + ' Mainnet',
			value: registryValue,
			rel: '0x' + registryNetwork.pub.toString(16) + ';0x' + registryNetwork.priv.toString(16) +
				';0x' + registryNetwork.multisig.toString(16) + ';0x' + registryNetwork.hdkey.pub.toString(16) +
				';0x' + registryNetwork.hdkey.prv.toString(16) + ';true;true;' + (registryNetwork.bech32.hrp || '')
		});
		dropdownCodeMap[registryValue] = registryCode;
	}
	networks.push({
		name: 'SpaceXpanse ROD Testnet',
		value: 'rod-testnet',
		rel: '0x73;0xc6;0x89;0x43587cf;0x4358394;true;true;trod'
	});

	/* Map network dropdown value prefixes to coinjs.activeNetwork codes so
	   the dropdown can be matched by code, not just by pub/multisig bytes
	   (BTC and BCH share the same pub 0x00 and multisig 0x05). */
	dropdownCodeMap['rod-testnet'] = 'ROD';

	// Function to populate the network dropdown
	function populateNetworkDropdown() {
		var $dropdown = $('#coinjs_coin');
		$dropdown.empty(); // Clear existing options

		// Determine current network — prefer activeNetwork code over pub/multisig
		var activeCode = (coinjs.activeNetwork || '').toUpperCase();
		var currentPub = coinjs.pub;
		var currentMultisig = coinjs.multisig;
		var selectedFound = false;

		for(var i = 0; i < networks.length; i++) {
			var network = networks[i];
			var networkValues = network.rel.split(';');
			var networkPub = parseInt(networkValues[0]);
			var networkMultisig = parseInt(networkValues[2]);
			var networkCode = dropdownCodeMap[network.value] || '';

			// Create option element
			var $option = $('<option>', {
				value: network.value,
				text: network.name,
				rel: network.rel
			});

			// Match by active network code first, fall back to pub/multisig
			var isMatch = false;
			if(activeCode && networkCode) {
				isMatch = (activeCode === networkCode);
			} else if(!selectedFound) {
				isMatch = (currentPub === networkPub && currentMultisig === networkMultisig);
			}

			if(isMatch && !selectedFound) {
				$option.prop('selected', true);
				selectedFound = true;
			}

			$dropdown.append($option);
		}

		// Add custom option last
		var $customOption = $('<option>', {
			value: 'custom',
			text: 'Custom',
			rel: '0x3c;0x4e;0x4b;0x488e4ad;0x4881eb2;false;false;rod'
		});

		// If no match found, select custom
		if(!selectedFound) {
			$customOption.prop('selected', true);
		}

		$dropdown.append($customOption);
	}

	// Populate the dropdown on page load
	populateNetworkDropdown();

	/* ---- API server fields for each network ---- */
	var API_SETTINGS_KEY = 'rodWalletApiSettings';

	function loadApiSettings() {
		try {
			var raw = window.localStorage.getItem(API_SETTINGS_KEY);
			return raw ? JSON.parse(raw) : {};
		} catch (e) { return {}; }
	}

	function saveApiSettings(settings) {
		try { window.localStorage.setItem(API_SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
	}

	function populateApiServerFields() {
		var $container = $('#settingsApiServers');
		if (!$container.length) return;
		$container.empty();
		var saved = loadApiSettings();
		var driverOptions = [];
		if (coinjs.explorer && coinjs.explorer.drivers) {
			for (var d in coinjs.explorer.drivers) {
				if (coinjs.explorer.drivers.hasOwnProperty(d)) driverOptions.push(d);
			}
		}
		for (var code in coinjs.networks) {
			if (!coinjs.networks.hasOwnProperty(code)) continue;
			var net = coinjs.networks[code];
			var apiUrl = (saved[code] && saved[code].apiUrl) || net.apiBase || '';
			var apiType = (saved[code] && saved[code].apiType) || net.apiType || '';
			var typeSelects = [];
			for (var di = 0; di < driverOptions.length; di++) {
				typeSelects.push('<option value="' + driverOptions[di] + '"' + (apiType === driverOptions[di] ? ' selected' : '') + '>' + driverOptions[di] + '</option>');
			}
			$container.append(
				'<div class="row" style="margin-bottom:6px">' +
				'<div class="col-xs-2" style="padding-top:6px;font-weight:bold;font-size:12px">' + code + '</div>' +
				'<div class="col-xs-7"><input class="form-control input-sm js-net-api-url" data-chain="' + code + '" value="' + (apiUrl || '').replace(/"/g, '&quot;') + '" placeholder="API base URL"></div>' +
				'<div class="col-xs-3"><select class="form-control input-sm js-net-api-type" data-chain="' + code + '">' + typeSelects.join('') + '</select></div>' +
				'</div>'
			);
		}
	}

	$('#settingsSaveApis').on('click', function () {
		var settings = {};
		$('.js-net-api-url').each(function () {
			var code = $(this).data('chain');
			settings[code] = settings[code] || {};
			settings[code].apiUrl = $.trim($(this).val());
		});
		$('.js-net-api-type').each(function () {
			var code = $(this).data('chain');
			settings[code] = settings[code] || {};
			settings[code].apiType = $.trim($(this).val());
		});
		/* Apply to live coinjs.networks */
		for (var code in settings) {
			if (settings.hasOwnProperty(code) && coinjs.networks[code]) {
				if (settings[code].apiUrl) coinjs.networks[code].apiBase = settings[code].apiUrl;
				if (settings[code].apiType) coinjs.networks[code].apiType = settings[code].apiType;
			}
		}
		/* Sync with OTC engine config if available */
		if (window.rodOtc && window.rodOtc.engine) {
			var ENGINE = window.rodOtc.engine;
			var c = ENGINE.loadConfig();
			c.chains = c.chains || {};
			for (var settlementCode in settings) {
				if (settings.hasOwnProperty(settlementCode) && c.chains[settlementCode]) {
					if (settings[settlementCode].apiUrl) c.chains[settlementCode].apiUrl = settings[settlementCode].apiUrl;
					if (settings[settlementCode].apiType) c.chains[settlementCode].apiType = settings[settlementCode].apiType;
				}
			}
			ENGINE.saveConfig(c);
		}
		saveApiSettings(settings);
		$('#settingsApiStatus').html('<span style="color:#62e6a6">Saved ✓</span>').fadeOut(3000).fadeIn(0);
	});

	/* Re-populate API fields when the network dropdown changes */
	$('#coinjs_coin').on('change.apifields', function () {
		/* no-op — fields stay for all networks; the dropdown only affects
		   key generation, not which API fields are shown */
	});

	/* On page load, apply any saved API settings to coinjs.networks.
	   Migrate stale entries: if a saved URL matches a known-broken default
	   from an earlier version, discard it so the current built-in default
	   takes effect instead. */
	(function applySavedApiSettings() {
		var saved = loadApiSettings();
		var dirty = false;

		/* URLs that shipped as defaults in prior versions but no longer work.
		   If the user never customised them, localStorage still holds these
		   stale values — silently drop them. */
		var staleDefaults = {
			'BCH': ['https://api.blockchair.com/bitcoin-cash'],
			'DGB': ['https://api.blockchair.com/digibyte', 'https://dgb1.trezor.io']
		};

		for (var code in staleDefaults) {
			if (saved[code] && staleDefaults[code]) {
				for (var si = 0; si < staleDefaults[code].length; si++) {
					if (saved[code].apiUrl === staleDefaults[code][si]) {
						delete saved[code];
						dirty = true;
						break;
					}
				}
			}
		}

		if (dirty) saveApiSettings(saved);

		for (var c in saved) {
			if (saved.hasOwnProperty(c) && coinjs.networks[c]) {
				if (saved[c].apiUrl) coinjs.networks[c].apiBase = saved[c].apiUrl;
				if (saved[c].apiType) coinjs.networks[c].apiType = saved[c].apiType;
			}
		}
	})();

	/* Populate only after stale shipped defaults have been removed, otherwise an
	   upgraded wallet would display the old DGB endpoint and save it again. */
	populateApiServerFields();

	$("#coinjs_pub").val('0x'+(coinjs.pub).toString(16));
	$("#coinjs_priv").val('0x'+(coinjs.priv).toString(16));
	$("#coinjs_multisig").val('0x'+(coinjs.multisig).toString(16));

	$("#coinjs_hdpub").val('0x'+(coinjs.hdkey.pub).toString(16));
	$("#coinjs_hdprv").val('0x'+(coinjs.hdkey.prv).toString(16));	

	$("#settingsBtn").click(function(){

		// log out of openwallet
		$("#walletLogout").click();

		$("#statusSettings").removeClass("alert-success").removeClass("alert-danger").addClass("hidden").html("");
		$("#settings .has-error").removeClass("has-error");

		$.each($(".coinjssetting"),function(i, o){
			if(!$(o).val().match(/^0x[0-9a-f]+$/)){
				$(o).parent().addClass("has-error");
			}
		});

		if($("#settings .has-error").length==0){

			coinjs.pub =  $("#coinjs_pub").val()*1;
			coinjs.priv =  $("#coinjs_priv").val()*1;
			coinjs.multisig =  $("#coinjs_multisig").val()*1;

			coinjs.hdkey.pub =  $("#coinjs_hdpub").val()*1;
			coinjs.hdkey.prv =  $("#coinjs_hdprv").val()*1;

			/* Resolve a known network by the selected registry-backed option, not
			   by a version byte. Different chains legitimately share P2PKH bytes
			   (DOGE/DGB and BTC/BCH), so byte-only dispatch selects the wrong coin. */
			var selectedNetworkCode = dropdownCodeMap[$('#coinjs_coin').val()] || '';
			if (selectedNetworkCode && coinjs.networks[selectedNetworkCode] && $('#coinjs_coin').val() !== 'rod-testnet'){
				applyActiveCoin(selectedNetworkCode, {skipWallet: true});
			} else {
				coinjs.bech32.hrp = coinjs.bech32.hrp || "rod";
			}

			configureBroadcast();
			configureGetUnspentTx();

			$("#statusSettings").addClass("alert-success").removeClass("hidden").html("<span class=\"glyphicon glyphicon-ok\"></span> Settings updates successfully").fadeOut().fadeIn();	
		} else {
			$("#statusSettings").addClass("alert-danger").removeClass("hidden").html("There is an error with one or more of your settings");	
		}
	});

	$("#coinjs_coin").change(function(){

		var o = ($("option:selected",this).attr("rel")).split(";");

		// apply selected network values to the settings inputs
		$("#coinjs_pub").val(o[0]);
		$("#coinjs_priv").val(o[1]);
		$("#coinjs_multisig").val(o[2]);
		$("#coinjs_hdpub").val(o[3]);
		$("#coinjs_hdprv").val(o[4]);

		// apply selected bech32 hrp immediately
		if(o[7]){
			coinjs.bech32.hrp = o[7];
		}

		// hide/show custom screen
		if($("option:selected",this).val()=="custom"){
			$("#settingsCustom").removeClass("hidden");
		} else {
			$("#settingsCustom").addClass("hidden");
		}
	});

	// reflect initial selected network in the settings fields
	$("#coinjs_coin").change();
	refreshSiteCoinLabels();

	function configureBroadcast(){
		$("#rawSubmitBtn").click(function(){
			rawSubmitDefault(this); // revert to default
		});
	}

	function configureGetUnspentTx(){
		$("#redeemFromBtn").attr('rel',$("#coinjs_utxo option:selected").val());
	}


	/* fees page code */

	$("#fees .slider").on('input', function(){
		$('.'+$(this).attr('rel')+' .inputno, .'+$(this).attr('rel')+' .outputno',$("#fees")).html($(this).val());
		$('.'+$(this).attr('rel')+' .estimate',$("#fees")).removeClass('hidden');
	});

	$("#fees .txo_p2pkh").on('input', function(){
		var outputno = $('.'+$(this).attr('rel')+' .outputno',$("#fees .txoutputs")).html();
		$('.'+$(this).attr('rel')+' .bytes',$("#fees .txoutputs")).html((outputno*$("#est_txo_p2pkh").val())+(outputno*9));
		mathFees();
	});

	$("#fees .txo_p2sh").on('input', function(){
		var outputno = $('.'+$(this).attr('rel')+' .outputno',$("#fees .txoutputs")).html();
		$('.'+$(this).attr('rel')+' .bytes',$("#fees .txoutputs")).html((outputno*$("#est_txo_p2sh").val())+(outputno*9));
		mathFees();
	});

	$("#fees .txi_regular").on('input', function(){
		var inputno = $('.'+$(this).attr('rel')+' .inputno',$("#fees .txinputs")).html();
		$('.'+$(this).attr('rel')+' .bytes',$("#fees .txinputs")).html((inputno*$("#est_txi_regular").val())+(inputno*41));
		mathFees();
	});

	$("#fees .txi_segwit").on('input', function(){
		var inputno = $('.'+$(this).attr('rel')+' .inputno',$("#fees .txinputs")).html();
		var bytes = 0;
		if(inputno >= 1){
			bytes = 2;
			bytes += (inputno*32);
			bytes += (inputno*$("#est_txi_segwit").val());
			bytes += (inputno*(41))
		}

		bytes = bytes.toFixed(0);
		$('.'+$(this).attr('rel')+' .bytes',$("#fees .txinputs")).html(bytes);
		mathFees();
	});

	$("#fees .txi_multisig").on('input', function(){
		var inputno = $('.'+$(this).attr('rel')+' .inputno',$("#fees .txinputs")).html();
		$('.'+$(this).attr('rel')+' .bytes',$("#fees .txinputs")).html((inputno*$("#est_txi_multisig").val())+(inputno*41));
		mathFees();
	});

	$("#fees .txi_hodl").on('input', function(){
		var inputno = $('.'+$(this).attr('rel')+' .inputno',$("#fees .txinputs")).html();
		$('.'+$(this).attr('rel')+' .bytes',$("#fees .txinputs")).html((inputno*$("#est_txi_hodl").val())+(inputno*41));
		mathFees();
	});

	$("#fees .txi_unknown").on('input', function(){
		var inputno = $('.'+$(this).attr('rel')+' .inputno',$("#fees .txinputs")).html();
		$('.'+$(this).attr('rel')+' .bytes',$("#fees .txinputs")).html((inputno*$("#est_txi_unknown").val())+(inputno*41));
		mathFees();
	});

	$("#fees .sliderbtn.down").click(function(){
		var val = $(".slider",$(this).parent().parent()).val()*1;
		if(val>($(".slider",$(this).parent().parent()).attr('min')*1)){
			$(".slider",$(this).parent().parent()).val(val-1);
			$(".slider",$(this).parent().parent()).trigger('input');
		}
	});

	$("#fees .sliderbtn.up").click(function(){
		var val = $(".slider",$(this).parent().parent()).val()*1;
		if(val<($(".slider",$(this).parent().parent()).attr('max')*1)){
			$(".slider",$(this).parent().parent()).val(val+1);
			$(".slider",$(this).parent().parent()).trigger('input');
		}
	});

	$("#advancedFeesCollapse").click(function(){
		if($("#advancedFees").hasClass('hidden')){
			$("span",this).removeClass('glyphicon-collapse-down').addClass('glyphicon-collapse-up');
			$("#advancedFees").removeClass("hidden");
		} else {
			$("span",this).removeClass('glyphicon-collapse-up').addClass('glyphicon-collapse-down');
			$("#advancedFees").addClass("hidden");
		}
	});

	$("#feesAnalyseBtn").click(function(){
		if(!$("#fees .txhex").val().match(/^[a-f0-9]+$/ig)){
			alert('You must provide a hex encoded transaction');
			return;
		}

		var tx = coinjs.transaction();
		var deserialized = tx.deserialize($("#fees .txhex").val());

		$("#fees .txoutputs .outputno, #fees .txinputs .inputno").html("0");
		$("#fees .txoutputs .bytes, #fees .txinputs .bytes").html("0");
		$("#fees .slider").val(0);

		for(var i = 0; i < deserialized.ins.length; i++){
			var script = deserialized.extractScriptKey(i);
			var size = 41;
			if(script.type == 'segwit'){
				if(deserialized.witness[i]){
					size += deserialized.ins[i].script.buffer.length / 2;
					for(w in deserialized.witness[i]){
						size += (deserialized.witness[i][w].length / 2) /4;
					}
				} else {
					size += $("#est_txi_segwit").val()*1;
				}
				$("#fees .segwit .inputno").html(($("#fees .segwit .inputno").html()*1)+1);
				$("#fees .txi_segwit").val(($("#fees .txi_segwit").val()*1)+1);
				$("#fees .segwit .bytes").html(($("#fees .segwit .bytes").html()*1)+size);
							
			} else if(script.type == 'multisig'){
				var s = coinjs.script();
				var rs = s.decodeRedeemScript(script.script);
				size += 4 + ((script.script.length / 2) + (73 * rs.signaturesRequired));
				$("#fees .multisig .inputno").html(($("#fees .multisig .inputno").html()*1)+1);
				$("#fees .txi_multisig").val(($("#fees .txi_multisig").val()*1)+1);
				$("#fees .multisig .bytes").html(($("#fees .multisig .bytes").html()*1)+size);

			} else if(script.type == 'hodl'){
				size += 78;
				$("#fees .hodl .inputno").html(($("#fees .hodl .inputno").html()*1)+1);
				$("#fees .txi_hodl").val(($("#fees .txi_hodl").val()*1)+1);
				$("#fees .hodl .bytes").html(($("#fees .hodl .bytes").html()*1)+size);

			} else if(script.type == 'empty' || script.type == 'scriptpubkey'){
				if(script.signatures == 1){
					size += script.script.length / 2;
				} else {
					size += $("#est_txi_regular").val()*1;
				}

				$("#fees .regular .inputno").html(($("#fees .regular .inputno").html()*1)+1);
				$("#fees .txi_regular").val(($("#fees .txi_regular").val()*1)+1);
				$("#fees .regular .bytes").html(($("#fees .regular .bytes").html()*1)+size);

			} else if(script.type == 'unknown'){
				size += script.script.length / 2;
				$("#fees .unknown .inputno").html(($("#fees .unknown .inputno").html()*1)+1);
				$("#fees .txi_unknown").val(($("#fees .txi_unknown").val()*1)+1);
				$("#fees .unknown .bytes").html(($("#fees .unknown .bytes").html()*1)+size);
			}
		}

		for(var i = 0; i < deserialized.outs.length; i++){
			if(deserialized.outs[i].script.buffer[0]==118){
				$("#fees .txoutputs .p2pkh .outputno").html(($("#fees .txoutputs .p2pkh .outputno").html()*1)+1);
				$("#fees .txoutputs .p2pkh .bytes").html(($("#fees .txoutputs .p2pkh .bytes").html()*1)+34);
				$("#fees .txo_p2pkh").val(($("#fees .txo_p2pkh").val()*1)+1);
			} else if (deserialized.outs[i].script.buffer[0]==169){
				$("#fees .txoutputs .p2sh .outputno").html(($("#fees .txoutputs .p2sh .outputno").html()*1)+1);
				$("#fees .txoutputs .p2sh .bytes").html(($("#fees .txoutputs .p2sh .bytes").html()*1)+32);
				$("#fees .txo_p2sh").val(($("#fees .txo_p2sh").val()*1)+1);
			} 
		}

		 feeStats();
	});

	$("#feeStatsReload").click(function(){
		feeStats();
	});

	function mathFees(){

		var inputsTotal = 0;
		var inputsBytes = 0;
		$.each($(".inputno"), function(i,o){
			inputsTotal += ($(o).html()*1);
			inputsBytes += ($(".bytes",$(o).parent()).html()*1);
		});
		
		$("#fees .txinputs .txsize").html(inputsBytes.toFixed(0));
		$("#fees .txinputs .txtotal").html(inputsTotal.toFixed(0));

		var outputsTotal = 0;
		var outputsBytes = 0;
		$.each($(".outputno"), function(i,o){
			outputsTotal += ($(o).html()*1);
			outputsBytes += ($(".bytes",$(o).parent()).html()*1);
		});
		
		$("#fees .txoutputs .txsize").html(outputsBytes.toFixed(0));
		$("#fees .txoutputs .txtotal").html(outputsTotal.toFixed(0));

		var totalBytes = 10 + outputsBytes + inputsBytes;
		if((!isNaN($("#fees .feeSatByte:first").html())) && totalBytes > 10){
			var recommendedFee = ((totalBytes * $(".feeSatByte").html())/100000000).toFixed(8);
			$(".recommendedFee").html(recommendedFee);
			$(".feeTxSize").html(totalBytes);
		} else {
			$(".recommendedFee").html((0).toFixed(8));
			$(".feeTxSize").html(0);
		}
	};

	function feeStats(){
		$("#feeStatsReload").attr('disabled',true);
		var localSatPerByte = 10;
		var localFeeRod = (localSatPerByte / 100000000).toFixed(8);
		var now = new Date();
		$("#fees .recommended .blockHeight").html('Local estimate (offline)');
		$("#fees .recommended .blockHash").html('N/A');
		$("#fees .recommended .blockTime").html('N/A');
		$("#fees .recommended .blockDateTime").html(now.toISOString());
		$("#fees .recommended .txId").html('N/A');
		$("#fees .recommended .txSize").html('N/A');
		var feeDisplayUnit = (coinjs.getNetwork && coinjs.getNetwork().unit) || 'coin';
		$("#fees .recommended .txFee").html(localFeeRod+' '+feeDisplayUnit+'/kB equivalent');
		$("#fees .feeSatByte").html(localSatPerByte);
		mathFees();
		$("#feeStatsReload").attr('disabled', false);
	}

	/* capture mouse movement to add entropy */
	var IE = document.all?true:false // Boolean, is browser IE?
	if (!IE) document.captureEvents(Event.MOUSEMOVE)
	document.onmousemove = getMouseXY;
	function getMouseXY(e) {
		var tempX = 0;
		var tempY = 0;
		if (IE) { // If browser is IE
			tempX = event.clientX + document.body.scrollLeft;
			tempY = event.clientY + document.body.scrollTop;
		} else {
			tempX = e.pageX;
			tempY = e.pageY;
		};

		if (tempX < 0){tempX = 0};
		if (tempY < 0){tempY = 0};
		var xEnt = Crypto.util.bytesToHex([tempX]).slice(-2);
		var yEnt = Crypto.util.bytesToHex([tempY]).slice(-2);
		var addEnt = xEnt.concat(yEnt);

		if ($("#entropybucket").html().indexOf(xEnt) == -1 && $("#entropybucket").html().indexOf(yEnt) == -1) {
			$("#entropybucket").html(addEnt + $("#entropybucket").html());
		};

		if ($("#entropybucket").html().length > 128) {
			$("#entropybucket").html($("#entropybucket").html().slice(0, 128))
		};

		return true;
	};

});
