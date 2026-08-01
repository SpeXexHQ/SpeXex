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
			const assetOptions = Array.from(document.querySelectorAll('#nsAssetChain option'))
				.map((node) => node.value).filter(Boolean).sort();
			const paymentOptions = Array.from(document.querySelectorAll('#nsPaymentChain option'))
				.map((node) => node.value).filter(Boolean).sort();
			return { walletNetworks, otcChains, registryNetworks, registrySwapChains, explorerSupport, menuCoins, assetOptions, paymentOptions };
		});
		step(
			'wallet menu and registered wallet networks agree',
			JSON.stringify(scope.walletNetworks) === JSON.stringify(scope.registryNetworks) &&
				JSON.stringify(scope.menuCoins) === JSON.stringify(scope.registryNetworks),
			'networks=' + scope.walletNetworks.join(',') + ' menu=' + scope.menuCoins.join(',')
		);
		step(
			'one settlement registry drives both role selectors and excludes wallet-only BTC/BCH/DGB',
			JSON.stringify(scope.otcChains) === JSON.stringify(scope.registrySwapChains) &&
				JSON.stringify(scope.assetOptions) === JSON.stringify(scope.otcChains) &&
				JSON.stringify(scope.paymentOptions) === JSON.stringify(scope.otcChains),
			'definitions=' + scope.otcChains.join(',') + ' asset=' + scope.assetOptions.join(',') +
				' payment=' + scope.paymentOptions.join(',')
		);
		step(
			'every wallet-only explorer backend has a registered driver',
			Object.values(scope.explorerSupport).every(Boolean),
			JSON.stringify(scope.explorerSupport)
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
