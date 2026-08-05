#!/usr/bin/env node
'use strict';

/*
 * Fast real-browser integration gate.
 *
 * Node-only tests cover pure contracts and mutations. This file proves those
 * modules are actually wired into the unmodified index.html, jQuery runtime,
 * DOM, localStorage, and service-worker shell.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { staticServer } = require('./mock-infra');

const APP_DIR = process.env.APP_DIR || path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.UNIT_PORT || 9400);
const results = [];

function step(name, ok, detail) {
	results.push({ name, ok, detail: detail || '' });
	console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

function launchOptions() {
	const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
		process.env.PW_CHROMIUM_EXECUTABLE_PATH;
	let args;
	if (process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON) {
		args = JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON);
		if (!Array.isArray(args)) throw new Error('PLAYWRIGHT_CHROMIUM_ARGS_JSON must be a JSON array');
	}
	/* This gate uses only one browser context at a time. The two-peer e2e
	   runner separately rejects --single-process because Alice/Bob isolation
	   is protocol evidence there; applying that restriction here needlessly
	   prevents the shell/PWA wiring checks on serverless Chromium. */
	if (configured) return { executablePath: configured, args };
	if (fs.existsSync('/opt/pw-browsers/chromium')) {
		return { executablePath: '/opt/pw-browsers/chromium', args };
	}
	return args ? { args } : {};
}

async function loadApp(browser, serviceWorkers) {
	const context = await browser.newContext({ serviceWorkers: serviceWorkers || 'block' });
	const page = await context.newPage();
	const pageErrors = [];
	const consoleErrors = [];
	page.on('pageerror', (error) => pageErrors.push(String(error)));
	page.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text());
	});
	await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load' });
	await page.waitForFunction(
		() => window.coinjs && window.rodOtc && window.rodOtc.engine &&
			window.rodOtc.swap && window.rodOtc.chains && window.rodOtc.validation,
		null,
		{ timeout: 30000 }
	);
	return { context, page, pageErrors, consoleErrors };
}

async function main() {
	const server = await staticServer(APP_DIR, PORT);
	let browser = await chromium.launch(launchOptions());
	try {
		const loaded = await loadApp(browser, 'block');
		const page = loaded.page;

		step('app loads without uncaught JavaScript errors', loaded.pageErrors.length === 0, loaded.pageErrors.join(' | '));

		const validation = await page.evaluate(() => window.rodOtc.validation.runAll());
		step(
			'in-page cryptography, chain, storage, Nostr, and swap fixtures pass',
			validation.passed === true,
			validation.results.map((result) => result.name + ':' + (result.passed ? 'ok' : 'FAIL')).join(', ')
		);

		const scope = await page.evaluate(() => {
			const walletNetworks = Object.keys(window.coinjs.networks).sort();
			const otcChains = window.rodOtc.chains.codes();
			const registryNetworks = window.spexChainRegistry.codes();
			const registrySwapChains = window.spexChainRegistry.swapCodes();
			const explorerSupport = {};
			for (const code of walletNetworks) {
				if (code === 'ROD') continue;
				explorerSupport[code] = window.coinjs.explorer.isSupported(window.coinjs.networks[code]);
			}
			const menuCoins = Array.from(document.querySelectorAll('.walletCoinSelect'))
				.map((node) => node.getAttribute('data-coin')).sort();
			const assetNode = document.querySelector('#nsAssetChain');
			const assetControl = assetNode ? { tag: assetNode.tagName, readOnly: assetNode.readOnly, value: assetNode.value } : null;
			const paymentOptions = Array.from(document.querySelectorAll('#nsPaymentChain option'))
				.map((node) => node.value).filter(Boolean).sort();
			const marketOptions = Array.from(document.querySelectorAll('#otcBookChainFilter option'))
				.map((node) => node.value).filter(Boolean);
			return { walletNetworks, otcChains, registryNetworks, registrySwapChains, explorerSupport, menuCoins, assetControl, paymentOptions, marketOptions };
		});
		step(
			'wallet menu and registered wallet networks agree',
			JSON.stringify(scope.walletNetworks) === JSON.stringify(scope.registryNetworks) &&
				JSON.stringify(scope.menuCoins) === JSON.stringify(scope.registryNetworks),
			'networks=' + scope.walletNetworks.join(',') + ' menu=' + scope.menuCoins.join(',')
		);
		step(
			'active website coin is the locked OTC asset and canonical markets are unique',
			JSON.stringify(scope.otcChains) === JSON.stringify(scope.registrySwapChains) &&
				scope.assetControl && scope.assetControl.tag === 'INPUT' && scope.assetControl.readOnly === true && scope.assetControl.value === 'ROD' &&
				JSON.stringify(scope.paymentOptions) === JSON.stringify(scope.otcChains.filter((code) => code !== 'ROD').sort()) &&
				new Set(scope.marketOptions).size === scope.marketOptions.length && scope.marketOptions.length === (scope.otcChains.length * (scope.otcChains.length - 1)) / 2 &&
				scope.marketOptions.includes('DOGE/ROD') && !scope.marketOptions.includes('ROD/DOGE'),
			JSON.stringify({ definitions: scope.otcChains, asset: scope.assetControl, payment: scope.paymentOptions, markets: scope.marketOptions })
		);
		step(
			'every wallet-only explorer backend has a registered driver',
			Object.values(scope.explorerSupport).every(Boolean),
			JSON.stringify(scope.explorerSupport)
		);

		const chainInfo = await page.evaluate(() => {
			const registry = window.spexChainRegistry;
			const codes = registry.codes();
			const pages = {};
			for (const code of codes) {
				const profile = registry.getProfile(code);
				$('.chainInfoSelect[data-chain="' + code + '"]').trigger('click');
				const article = document.querySelector('#chainInfoContent .chain-info-page');
				pages[code] = {
					renderedCode: article && article.getAttribute('data-chain'),
					hasDescription: !!(article && article.textContent.includes(profile.description)),
					endpointLinks: article ? article.querySelectorAll('section a[href^="https://"]').length : 0,
					routeCards: article ? article.querySelectorAll('.chain-route-card').length : 0,
					expectedRoutes: registry.attestedRoutes(code).length,
					metadataComplete: typeof profile.description === 'string' && profile.description.length >= 40 &&
						/^https:\/\//.test(profile.website) && /^https:\/\//.test(profile.documentation) &&
						Array.isArray(profile.repositories) && profile.repositories.length > 0
				};
			}
			const coinsMenu = document.getElementById('coinsMenu');
			const infoMenu = document.getElementById('chainInfoNavItem');
			const attestedMenuCodes = Array.from(document.querySelectorAll('.walletCoinSelect')).filter((link) =>
				!!link.querySelector('.coin-attested')
			).map((link) => link.getAttribute('data-coin')).sort();
			const hostedMenuCodes = Array.from(document.querySelectorAll('.walletCoinSelect .coin-route-hosted')).map((node) => node.closest('.walletCoinSelect').getAttribute('data-coin')).sort();
			const communityMenuCodes = Array.from(document.querySelectorAll('.walletCoinSelect .coin-route-community')).map((node) => node.closest('.walletCoinSelect').getAttribute('data-coin')).sort();
			const mainWalletOnlyCodes = Array.from(document.querySelectorAll('.walletCoinSelect .coin-wallet-only')).map((node) => node.closest('.walletCoinSelect').getAttribute('data-coin')).sort();
			const chainWalletOnlyCodes = Array.from(document.querySelectorAll('.chainInfoSelect .chain-info-wallet-only')).map((node) => node.closest('.chainInfoSelect').getAttribute('data-chain')).sort();
			const communityMainColors = Array.from(document.querySelectorAll('.walletCoinSelect .coin-route-community')).map((node) => getComputedStyle(node).color);
			const communityChainColors = Array.from(document.querySelectorAll('.chainInfoSelect .chain-route-community')).map((node) => getComputedStyle(node).color);
			const hostedMainColors = Array.from(document.querySelectorAll('.walletCoinSelect .coin-route-hosted')).map((node) => getComputedStyle(node).color);
			const hostedChainColors = Array.from(document.querySelectorAll('.chainInfoSelect .chain-route-hosted')).map((node) => getComputedStyle(node).color);
			const activeMenuCodes = Array.from(document.querySelectorAll('#walletCoinMenu .wallet-coin-item.active-coin')).map((item) => item.getAttribute('data-coin'));
			const arrowCount = document.querySelectorAll('#walletCoinMenu .coin-active, #walletCoinMenu .glyphicon-chevron-right').length;
			$('.chainInfoSelect[data-chain="DOGE"]').trigger('click');
			const chainClickState = {
				activeNetwork: coinjs.activeNetwork,
				asset: $('#nsAssetChain').val(),
				paymentOptions: Array.from(document.querySelectorAll('#nsPaymentChain option')).map((node) => node.value),
				activeMenu: document.querySelector('#walletCoinMenu .wallet-coin-item.active-coin') && document.querySelector('#walletCoinMenu .wallet-coin-item.active-coin').getAttribute('data-coin'),
				hash: window.location.hash
			};
			window.spexSetActiveCoin('ROD');
			return {
				codes,
				pages,
				menuImmediatelyAfterCoins: !!(coinsMenu && infoMenu && coinsMenu.nextElementSibling === infoMenu),
				attestedMenuCodes,
				expectedAttestedMenuCodes: registry.swapCodes().slice().sort(),
				hostedMenuCodes,
				communityMenuCodes,
				mainWalletOnlyCodes,
				chainWalletOnlyCodes,
				communityMainColors,
				communityChainColors,
				hostedMainColors,
				hostedChainColors,
				activeMenuCodes,
				arrowCount,
				chainClickState,
				canonicalMarket: registry.canonicalMarketKey('ROD', 'DOGE'),
				hash: window.location.hash
			};
		});
		step(
			'canonical chain pages are registry-driven for every supported blockchain',
			chainInfo.codes.every((code) => {
				const pageInfo = chainInfo.pages[code];
				return pageInfo.renderedCode === code && pageInfo.hasDescription && pageInfo.endpointLinks >= 5 &&
					pageInfo.routeCards === pageInfo.expectedRoutes && pageInfo.metadataComplete;
			}),
			JSON.stringify(chainInfo.pages)
		);
		step(
			'Chain Info sits after Coins and exposes canonical deep links',
			chainInfo.menuImmediatelyAfterCoins && /^#chain\/[A-Z0-9]+$/.test(chainInfo.hash) &&
				chainInfo.canonicalMarket === 'DOGE/ROD',
			JSON.stringify({ afterCoins: chainInfo.menuImmediatelyAfterCoins, hash: chainInfo.hash, market: chainInfo.canonicalMarket })
		);
		step(
			'route ownership colors, wallet-only icons, and background-only active state are distinct',
			JSON.stringify(chainInfo.attestedMenuCodes) === JSON.stringify(chainInfo.expectedAttestedMenuCodes) &&
				JSON.stringify(chainInfo.hostedMenuCodes) === JSON.stringify(['ROD']) &&
				JSON.stringify(chainInfo.communityMenuCodes) === JSON.stringify(['DOGE', 'LTC']) &&
				JSON.stringify(chainInfo.mainWalletOnlyCodes) === JSON.stringify(['BCH', 'BTC', 'DGB']) &&
				JSON.stringify(chainInfo.chainWalletOnlyCodes) === JSON.stringify(['BCH', 'BTC', 'DGB']) &&
				chainInfo.communityMainColors.every((color) => color === 'rgb(57, 169, 255)') &&
				chainInfo.communityChainColors.every((color) => color === 'rgb(57, 169, 255)') &&
				chainInfo.hostedMainColors.every((color) => color === 'rgb(71, 209, 108)') &&
				chainInfo.hostedChainColors.every((color) => color === 'rgb(71, 209, 108)') &&
				chainInfo.activeMenuCodes.length === 1 && chainInfo.arrowCount === 0,
			JSON.stringify({ attested: chainInfo.attestedMenuCodes, hosted: chainInfo.hostedMenuCodes, community: chainInfo.communityMenuCodes, mainWalletOnly: chainInfo.mainWalletOnlyCodes, chainWalletOnly: chainInfo.chainWalletOnlyCodes, communityMainColors: chainInfo.communityMainColors, communityChainColors: chainInfo.communityChainColors, hostedMainColors: chainInfo.hostedMainColors, hostedChainColors: chainInfo.hostedChainColors, active: chainInfo.activeMenuCodes, arrows: chainInfo.arrowCount })
		);
		step(
			'clicking a Chain Info coin switches the active network and locked OTC asset website-wide',
			chainInfo.chainClickState.activeNetwork === 'DOGE' && chainInfo.chainClickState.asset === 'DOGE' &&
				chainInfo.chainClickState.activeMenu === 'DOGE' && chainInfo.chainClickState.paymentOptions.indexOf('DOGE') === -1 &&
				chainInfo.chainClickState.hash === '#chain/DOGE',
			JSON.stringify(chainInfo.chainClickState)
		);

		const activeWalletIdentity = await page.evaluate(() => {
			window.spexSetActiveCoin('ROD');
			$('#captcha').val('2');
			$('#openEmail').val('browser-gate@example.com');
			$('#openPass, #openPassConfirm').val('StrongBrowserGate1!');
			$('#openWalletRiskAcknowledgement').prop('checked', true);
			$('#openBtn').trigger('click');
			const rodAddress = $.trim($('#walletAddress').text());
			window.spexSetActiveCoin('LTC');
			const ltcAddress = $.trim($('#walletAddress').text());
			const ltcIdentity = $('#nsMyAddr').val();
			$('.chainInfoSelect[data-chain="DOGE"]').trigger('click');
			const dogeAddress = $.trim($('#walletAddress').text());
			const dogeIdentity = $('#nsMyAddr').val();
			const engineIdentity = rodOtc.engine.getWalletIdentity();
			const result = {
				rodAddress, ltcAddress, ltcIdentity, dogeAddress, dogeIdentity,
				activeChain: engineIdentity && engineIdentity.activeChain,
				activeAddress: engineIdentity && engineIdentity.activeAddress,
				rodControlAddress: engineIdentity && engineIdentity.rodAddress
			};
			$('#walletLogout').trigger('click');
			window.spexSetActiveCoin('ROD');
			return result;
		});
		step(
			'wallet address and visible OTC identity re-derive immediately with the active coin',
			activeWalletIdentity.rodAddress && activeWalletIdentity.ltcAddress && activeWalletIdentity.dogeAddress &&
				activeWalletIdentity.rodAddress !== activeWalletIdentity.ltcAddress &&
				activeWalletIdentity.ltcAddress !== activeWalletIdentity.dogeAddress &&
				activeWalletIdentity.ltcIdentity === activeWalletIdentity.ltcAddress &&
				activeWalletIdentity.dogeIdentity === activeWalletIdentity.dogeAddress &&
				activeWalletIdentity.activeChain === 'DOGE' &&
				activeWalletIdentity.activeAddress === activeWalletIdentity.dogeAddress &&
				activeWalletIdentity.rodControlAddress === activeWalletIdentity.rodAddress,
			JSON.stringify(activeWalletIdentity)
		);

		const settingsRegistry = await page.evaluate(() => {
			const expected = window.spexChainRegistry.codes().map((code) => code.toLowerCase() + '-mainnet').sort();
			const actual = Array.from(document.querySelectorAll('#coinjs_coin option'))
				.map((node) => node.value)
				.filter((value) => /-mainnet$/.test(value)).sort();
			$('#coinjs_coin').val('dgb-mainnet').trigger('change');
			$('#settingsBtn').trigger('click');
			const collisionDispatch = coinjs.activeNetwork;
			$('#coinjs_coin').val('rod-mainnet').trigger('change');
			$('#settingsBtn').trigger('click');
			return { expected, actual, collisionDispatch };
		});
		step(
			'Settings mainnet dropdown is registry-driven and resolves colliding address prefixes by code',
			JSON.stringify(settingsRegistry.actual) === JSON.stringify(settingsRegistry.expected) &&
				settingsRegistry.collisionDispatch === 'DGB',
			JSON.stringify(settingsRegistry)
		);

		const controlIdentity = await page.evaluate(() => {
			coinjs.setNetwork('LTC');
			const beforeCompressed = coinjs.compressed;
			coinjs.compressed = true;
			const keys = coinjs.newKeys();
			coinjs.compressed = beforeCompressed;
			$('#walletKeys .privkey').val(keys.wif);
			$('#walletKeys .pubkey').val(keys.pubkey);
			$('#walletAddress').text(keys.address);
			const identity = rodOtc.engine.getWalletIdentity();
			const expectedRod = rodOtc.chains.getWalletMaterialForChain(keys.wif, 'ROD').address;
			const result = {
				activeChain: identity && identity.activeChain,
				activeAddress: identity && identity.activeAddress,
				identityAddress: identity && identity.address,
				expectedRod,
				visibleLtc: keys.address
			};
			$('#walletKeys .privkey, #walletKeys .pubkey').val('');
			$('#walletAddress').text('');
			coinjs.setNetwork('ROD');
			return result;
		});
		step(
			'ROD control-plane identity remains ROD-bound while another wallet network is active',
			controlIdentity.activeChain === 'LTC' &&
				controlIdentity.identityAddress === controlIdentity.expectedRod &&
				controlIdentity.activeAddress === controlIdentity.visibleLtc &&
				controlIdentity.identityAddress !== controlIdentity.visibleLtc,
			JSON.stringify(controlIdentity)
		);

		const defaults = await page.evaluate(() => {
			const pick = (code) => {
				const network = window.coinjs.networks[code];
				return { apiType: network.apiType, apiBase: network.apiBase, segwit: network.segwit };
			};
			return {
				LTC: pick('LTC'), DOGE: pick('DOGE'), BTC: pick('BTC'),
				BCH: pick('BCH'), DGB: pick('DGB')
			};
		});
		step(
			'default explorer types and endpoints are chain-correct',
			defaults.LTC.apiType === 'esplora' && defaults.LTC.apiBase === 'https://litecoinspace.org/api' &&
				defaults.DOGE.apiType === 'blockcypher' && defaults.DOGE.apiBase === 'https://api.blockcypher.com/v1/doge/main' &&
				defaults.BTC.apiType === 'esplora' && defaults.BTC.apiBase === 'https://mempool.space/api' &&
				defaults.BCH.apiType === 'blockbook' && defaults.BCH.apiBase === 'https://bch1.trezor.io' &&
				defaults.DGB.apiType === 'esplora' && defaults.DGB.apiBase === 'https://digiexplorer.info/api',
			JSON.stringify(defaults)
		);

		const chainChecks = await page.evaluate(() => {
			const C = window.rodOtc.chains;
			const S = window.rodOtc.swap;
			const key1 = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
			const key2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
			const dogeMultisig = C.publicKeysToMultisig('DOGE', [key1, key2], 2);
			let dogeBech32Rejected = false;
			let walletOnlyRejected = false;
			try { C.publicKeyToAddress('DOGE', key1, 'bech32'); } catch (error) { dogeBech32Rejected = true; }
			try { C.getPolicy('DGB'); } catch (error) { walletOnlyRejected = true; }
			const ltcSafe = S.assertRefundOrdering({
				assetChain: 'ROD', paymentChain: 'LTC', releaseRodHeight: 100030,
				assetRefundLockHeight: 100480, paymentRefundLockHeight: 200024,
				assetConfirmations: 1, paymentConfirmations: 1
			}, 100000, 200000, 100000);
			const dogeSafe = S.assertRefundOrdering({
				assetChain: 'ROD', paymentChain: 'DOGE', releaseRodHeight: 100030,
				assetRefundLockHeight: 100480, paymentRefundLockHeight: 300060,
				assetConfirmations: 1, paymentConfirmations: 6
			}, 100000, 300000, 100000);
			let unsafeRejected = false;
			try {
				S.assertRefundOrdering({
					assetChain: 'ROD', paymentChain: 'DOGE', releaseRodHeight: 100030,
					assetRefundLockHeight: 100480, paymentRefundLockHeight: 300470,
					assetConfirmations: 1, paymentConfirmations: 6
				}, 100000, 300000, 100000);
			} catch (error) { unsafeRejected = true; }
			return {
				dogeAddress: C.publicKeyToAddress('DOGE', key1, 'legacy'),
				dogeMultisig: dogeMultisig.address,
				dogeBech32Rejected,
				walletOnlyRejected,
				dogePolicy: C.getPolicy('DOGE'),
				ltcSafe,
				dogeSafe,
				unsafeRejected
			};
		});
		step(
			'DOGE address, multisig, SegWit refusal, and relay policy match mainnet',
			chainChecks.dogeAddress === 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE' &&
				chainChecks.dogeMultisig === '9tAfWptDmGyYyFjKKr5VpApUKzq9hFpBJ1' &&
				chainChecks.dogeBech32Rejected &&
				chainChecks.dogePolicy.feeRatePerByte === 1000 &&
				chainChecks.dogePolicy.hardDustSats === 100000 &&
				chainChecks.dogePolicy.softDustSats === 1000000,
			chainChecks.dogeAddress + ' / ' + chainChecks.dogeMultisig
		);
		step(
			'wallet-only chains fail closed when passed into OTC policy',
			chainChecks.walletOnlyRejected === true
		);
		step(
			'refund wall-clock ordering accepts safe LTC/DOGE and rejects reversal',
			chainChecks.ltcSafe.assetRemainingSeconds > chainChecks.ltcSafe.paymentRemainingSeconds &&
				chainChecks.dogeSafe.assetRemainingSeconds > chainChecks.dogeSafe.paymentRemainingSeconds &&
				chainChecks.unsafeRejected === true
		);

		const recoveryUi = await page.evaluate(() => {
			const engine = window.rodOtc.engine;
			const swapId = 'a'.repeat(64);
			engine.saveLive({
				swapId,
				role: 'seller',
				state: 'COMPLETE',
				terms: {
					protocol: 2,
					termsHash: 'browser-recovery-terms',
					pair: 'ROD/DOGE',
					assetChain: 'ROD',
					paymentChain: 'DOGE',
					assetAmount: '1.00000000',
					paymentAmount: '2.00000000'
				},
				assetRefund: { signedHex: 'aa'.repeat(120) }
			});
			const backup = engine.exportRecoveryState();
			engine.removeLive(swapId);
			let tracked = '';
			const originalTrack = engine.trackSwapId;
			engine.trackSwapId = (id) => { tracked = id; return 'test-subscription'; };
			$('#cfgBackup').val(backup);
			$('#cfgImport').trigger('click');
			engine.trackSwapId = originalTrack;
			const restored = engine.restoreLive(swapId);
			const result = {
				tracked,
				state: restored && restored.state,
				refundHex: restored && restored.assetRefund && restored.assetRefund.signedHex,
				flash: $('#otcFlash').text(),
				rendered: $('#otcSwapList').text()
			};
			engine.removeLive(swapId);
			return result;
		});
		step(
			'Settings recovery buttons restore, track, and render the real live swap store',
			recoveryUi.tracked === 'a'.repeat(64) &&
				recoveryUi.state === 'COMPLETE' &&
				recoveryUi.refundHex === 'aa'.repeat(120) &&
				/Imported recoverable OTC backup/.test(recoveryUi.flash) &&
				/COMPLETE/.test(recoveryUi.rendered),
			JSON.stringify({
				tracked: recoveryUi.tracked.slice(0, 12),
				state: recoveryUi.state,
				hasRefund: recoveryUi.refundHex === 'aa'.repeat(120),
				flash: recoveryUi.flash
			})
		);

		await loaded.context.close();
		/* The PWA phase is independent. Relaunching also supports serverless
		   single-process builds, which exit when their only context closes. */
		await browser.close();
		browser = await chromium.launch(launchOptions());

		const pwa = await loadApp(browser, 'allow');
		const pwaReady = await pwa.page.evaluate(async () => {
			if (!('serviceWorker' in navigator)) return { supported: false };
			const registration = await Promise.race([
				navigator.serviceWorker.ready,
				new Promise((_, reject) => setTimeout(() => reject(new Error('service worker ready timeout')), 15000))
			]);
			return { supported: true, active: !!registration.active };
		});
		step('service worker installs and activates', pwaReady.supported && pwaReady.active, JSON.stringify(pwaReady));

		await pwa.context.setOffline(true);
		await pwa.page.reload({ waitUntil: 'load', timeout: 30000 });
		await pwa.page.waitForFunction(
			() => window.coinjs && window.rodOtc && window.rodOtc.engine,
			null,
			{ timeout: 30000 }
		);
		const offline = await pwa.page.evaluate(() => ({
			title: document.title,
			hasWallet: !!document.getElementById('wallet'),
			hasOtc: !!document.getElementById('otc'),
			styles: Array.from(document.styleSheets).length
		}));
		step(
			'PWA shell reloads offline with wallet, OTC UI, and styles',
			offline.hasWallet && offline.hasOtc && offline.styles >= 3,
			JSON.stringify(offline)
		);
		await pwa.context.setOffline(false);
		await pwa.context.close();
	} finally {
		await browser.close();
		await new Promise((resolve) => server.close(resolve));
	}

	const failed = results.filter((result) => !result.ok);
	console.log('\n' + (results.length - failed.length) + '/' + results.length + ' browser integration gates passed');
	process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
	console.error('BROWSER HARNESS ERROR: ' + (error.stack || error));
	process.exit(1);
});
