#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(root, 'js', 'coinbin.js'), 'utf8');

function extractFunction(functionName) {
	const marker = 'function ' + functionName + '(';
	const start = source.indexOf(marker);
	assert(start !== -1, functionName + ' must exist in coinbin.js');
	const bodyStart = source.indexOf('{', start);
	let depth = 0;
	for (let i = bodyStart; i < source.length; i += 1) {
		if (source[i] === '{') depth += 1;
		if (source[i] === '}') {
			depth -= 1;
			if (depth === 0) {
				return source.slice(start, i + 1);
			}
		}
	}
	throw new Error('Unable to extract ' + functionName);
}

const factorySource = extractFunction('createWalletBalanceRequestEpoch');
const createEpoch = vm.runInNewContext('(' + factorySource + ')');
const sanitizeApiSettingsSource = extractFunction('sanitizeSavedApiSettings');
const sanitizeSavedApiSettings = vm.runInNewContext('(' + sanitizeApiSettingsSource + ')', {
	window: { spexChainRegistry: require(path.join(root, 'js', 'chain-registry.js')) },
	coinjs: { networks: require(path.join(root, 'js', 'chain-registry.js')).walletNetworks() },
	$: {
		extend(target) {
			for (let i = 1; i < arguments.length; i++) {
				if (arguments[i]) Object.assign(target, arguments[i]);
			}
			return target;
		}
	}
});

function testDgbToRodRace() {
	const requests = createEpoch();
	const dgb = requests.begin('DGB', 'DGB-address');
	assert(dgb, 'DGB request must start');

	/* A network switch invalidates DGB before the ROD render starts. */
	requests.reset();
	const rod = requests.begin('ROD', 'ROD-address');
	assert(rod, 'ROD request must start immediately after DGB');

	assert.strictEqual(
		requests.finish(dgb, 'ROD', 'ROD-address'),
		false,
		'late DGB callback must not own the ROD balance UI'
	);
	assert.strictEqual(
		requests.finish(rod, 'ROD', 'ROD-address'),
		true,
		'current ROD callback must update and release the balance UI'
	);
}

function testLateRequestCannotHideNewLoader() {
	const requests = createEpoch();
	const dgb = requests.begin('DGB', 'DGB-address');
	requests.reset();
	const ltc = requests.begin('LTC', 'LTC-address');

	assert.strictEqual(requests.finish(dgb, 'LTC', 'LTC-address'), false);
	assert.strictEqual(
		requests.begin('LTC', 'LTC-address'),
		false,
		'a duplicate current lookup remains coalesced after the stale callback'
	);
	assert.strictEqual(requests.finish(ltc, 'LTC', 'LTC-address'), true);
}

function testAddressChangeInvalidatesOldCallback() {
	const requests = createEpoch();
	const legacy = requests.begin('DGB', 'legacy-address');
	const segwit = requests.begin('DGB', 'segwit-address');

	assert(segwit, 'a new address on the same network must start immediately');
	assert.strictEqual(requests.finish(legacy, 'DGB', 'segwit-address'), false);
	assert.strictEqual(requests.finish(segwit, 'DGB', 'segwit-address'), true);
}

function testDgbRoutingAndCsp() {
	const registrySource = fs.readFileSync(path.join(root, 'js', 'chain-registry.js'), 'utf8');
	const coinSource = fs.readFileSync(path.join(root, 'js', 'coin.js'), 'utf8');
	const coinbinSource = fs.readFileSync(path.join(root, 'js', 'coinbin.js'), 'utf8');
	const engineSource = fs.readFileSync(path.join(root, 'js', 'otc-engine.js'), 'utf8');
	const explorerSource = fs.readFileSync(path.join(root, 'js', 'otc-explorer.js'), 'utf8');
	const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');
	const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

	const registry = require(path.join(root, 'js', 'chain-registry.js'));
	assert.strictEqual(registry.getProfile('DGB').api.type, 'esplora',
		'DGB must default to Digiexplorer through the Esplora driver');
	assert.strictEqual(registry.getProfile('DGB').api.base, 'https://digiexplorer.info/api',
		'DGB must use the reviewed default API base');

	const browser = {
		console,
		document: { location: { protocol: 'http:', hostname: 'localhost' } },
		window: null
	};
	browser.window = browser;
	vm.createContext(browser);
	vm.runInContext(registrySource, browser, { filename: 'js/chain-registry.js' });
	vm.runInContext(coinSource, browser, { filename: 'js/coin.js' });
	vm.runInContext(explorerSource, browser, { filename: 'js/otc-explorer.js' });
	browser.coinjs.setNetwork('DGB');
	assert.strictEqual(browser.coinjs.explorer.isSupported(browser.coinjs.getNetwork()), true,
		'coinjs.explorer.isSupported() must accept DGB');

	let routedToDgbExplorer = false;
	let normalizedBalance = null;
	browser.coinjs.explorer.balance = function(network, address) {
		return {
			then(resolve) {
				routedToDgbExplorer = network.code === 'DGB' && address === 'DGB-test-address';
				resolve(123456789);
			}
		};
	};
	browser.coinjs.addressBalance('DGB-test-address', function(result) {
		normalizedBalance = result;
	});
	assert.strictEqual(routedToDgbExplorer, true,
		'coinjs.addressBalance() must dispatch DGB through the explorer adapter');
	assert.strictEqual(normalizedBalance.data[0].balance, '1.23456789',
		'DGB explorer base units must be normalized for the wallet display');

	assert(/connect-src[^;\n]*https:\/\/digiexplorer\.info/.test(headers),
		'CSP must permit the default DGB backend');
	assert(/'DGB'\s*:\s*\[[^\]]*https:\/\/api\.blockchair\.com\/digibyte/.test(coinbinSource),
		'wallet API settings must migrate the old shipped DGB default');
	assert(!/rodOtcEngineConfig|altChains|rodApiUrl/.test(engineSource),
		'v2 OTC engine must not read or migrate the old configuration schema');
	assert(/STATIC_CACHE_VERSION\s*=\s*"[^"]*2\.7\.1-beta\.0/.test(serviceWorker),
		'service-worker cache must carry the current release identity');
}

function testStoneRoutingAndCsp() {
	const registrySource = fs.readFileSync(path.join(root, 'js', 'chain-registry.js'), 'utf8');
	const coinSource = fs.readFileSync(path.join(root, 'js', 'coin.js'), 'utf8');
	const coinbinSource = fs.readFileSync(path.join(root, 'js', 'coinbin.js'), 'utf8');
	const explorerSource = fs.readFileSync(path.join(root, 'js', 'otc-explorer.js'), 'utf8');
	const headers = fs.readFileSync(path.join(root, '_headers'), 'utf8');

	const registry = require(path.join(root, 'js', 'chain-registry.js'));
	assert.strictEqual(registry.getProfile('STONE').swap.status, 'wallet-only',
		'STONE must remain wallet-only without settlement attestation');
	assert.strictEqual(registry.getProfile('STONE').api.type, 'stoneapi',
		'STONE must use the reviewed Bloodstone wallet API adapter');
	assert.strictEqual(registry.getProfile('STONE').api.base, 'https://bloodstone.rocks/stone-wallet-api',
		'STONE must use the reviewed Bloodstone wallet API base');
	assert.strictEqual(registry.walletNetworks().STONE.walletFeeRatePerByte, 150,
		'STONE wallet sends must honor the Bloodstone relay floor');

	const browser = {
		console,
		document: { location: { protocol: 'http:', hostname: 'localhost' } },
		window: null
	};
	browser.window = browser;
	vm.createContext(browser);
	vm.runInContext(registrySource, browser, { filename: 'js/chain-registry.js' });
	vm.runInContext(coinSource, browser, { filename: 'js/coin.js' });
	vm.runInContext(explorerSource, browser, { filename: 'js/otc-explorer.js' });
	browser.coinjs.setNetwork('STONE');
	assert.strictEqual(browser.coinjs.explorer.isSupported(browser.coinjs.getNetwork()), true,
		'coinjs.explorer.isSupported() must accept STONE');
	assert.strictEqual(browser.coinjs.getNetwork().walletFeeRatePerByte, 150,
		'compiled wallet network must expose the STONE relay floor');

	let routedToStoneExplorer = false;
	let normalizedBalance = null;
	browser.coinjs.explorer.balance = function(network, address) {
		return {
			then(resolve) {
				routedToStoneExplorer = network.code === 'STONE' && address === 'STONE-test-address';
				resolve(500000000);
			}
		};
	};
	browser.coinjs.addressBalance('STONE-test-address', function(result) {
		normalizedBalance = result;
	});
	assert.strictEqual(routedToStoneExplorer, true,
		'coinjs.addressBalance() must dispatch STONE through the explorer adapter');
	assert.strictEqual(normalizedBalance.data[0].balance, '5.00000000',
		'STONE explorer base units must be normalized for the wallet display');

	assert(/connect-src[^;\n]*https:\/\/bloodstone\.rocks/.test(headers),
		'CSP must permit the Bloodstone wallet API host');
	assert(/id="spendAmountUnit"/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8')),
		'wallet confirmation modal must render the active coin unit dynamically');
	assert(!/\$\("#modalWalletConfirm"\)\.modal\('hide'\);/.test(coinbinSource),
		'broadcast failures must keep the wallet confirmation modal open');
	assert(!/updateApiServerStatus\(\{online: true, url: ''\}\);/.test(coinbinSource),
		'network switching must not clear unrelated API outage warnings');
	assert(/var rodApiBase = \(rodNetwork && rodNetwork\.apiBase\) \|\| coinjs\.rodApi;/.test(coinSource),
		'ROD health checks must resolve the canonical ROD API base explicitly');
	assert(/else if\(coinjs\.networks && coinjs\.networks\.ROD && coinjs\.networks\.ROD\.apiBase\)\{/.test(coinSource),
		'non-ROD network switches must restore the canonical ROD API base for health checks');
}

function testSavedApiSettingsSanitization() {
	const registry = require(path.join(root, 'js', 'chain-registry.js'));
	const cleaned = sanitizeSavedApiSettings({
		STONE: { apiUrl: 'https://api.spacexpanse.org:1234', apiType: 'stoneapi' },
		ROD: { apiUrl: 'https://bloodstone.rocks/stone-wallet-api/api/v1', apiType: 'esplora' }
	});
	const staleRodApiPath = sanitizeSavedApiSettings({
		ROD: { apiUrl: 'https://api.spacexpanse.org:1234/api', apiType: 'rod' }
	});
	assert.strictEqual(cleaned.STONE.apiType, 'stoneapi',
		'STONE must keep the stoneapi driver even with stale saved settings');
	assert.strictEqual(cleaned.STONE.apiUrl, registry.getProfile('STONE').api.base,
		'STONE must discard a saved ROD API base that would trigger method-not-found errors');
	assert.strictEqual(cleaned.ROD.apiType, 'rod',
		'ROD must keep the rod driver even with stale saved settings');
	assert.strictEqual(cleaned.ROD.apiUrl, registry.getProfile('ROD').api.base,
		'ROD must discard a saved STONE API base or subpath that would trigger method-not-found errors');
	assert.strictEqual(staleRodApiPath.ROD.apiUrl, registry.getProfile('ROD').api.base,
		'ROD must discard a saved /api subpath that would turn /balance into method-not-found');
	const explorerSource = fs.readFileSync(path.join(root, 'js', 'otc-explorer.js'), 'utf8');
	assert(/postRaw\(base \+ '\/api\/v1\/broadcast', txhex, 'text\/plain'\)/.test(explorerSource),
		'STONE broadcast must avoid the broken JSON preflight by posting raw tx hex as text/plain');
}

function runEngineWithSavedConfig(savedConfig, legacyConfig) {
	const engineSource = fs.readFileSync(path.join(root, 'js', 'otc-engine.js'), 'utf8');
	const values = {};
	if (savedConfig) values.spexSwapV2Config = JSON.stringify(savedConfig);
	if (legacyConfig) values.rodOtcEngineConfig = JSON.stringify(legacyConfig);
	const definitions = {
		ROD: { apiUrl: 'https://api.spacexpanse.org:1234', apiType: 'rod', refundBlocks: { asset: 480, payment: 120 }, confirmations: 1 },
		LTC: { apiUrl: 'https://litecoinspace.org/api', apiType: 'esplora', refundBlocks: { asset: 96, payment: 24 }, confirmations: 1 },
		DOGE: { apiUrl: 'https://api.blockcypher.com/v1/doge/main', apiType: 'blockcypher', refundBlocks: { asset: 240, payment: 60 }, confirmations: 6 }
	};
	const browser = {
		console,
		window: null,
		localStorage: {
			getItem(key) { return values[key] || null; },
			setItem(key, value) { values[key] = value; }
		},
		coinjs: {
			networks: {
				ROD: { apiBase: 'https://api.spacexpanse.org:1234' },
				DGB: { apiBase: 'https://digiexplorer.info/api', apiType: 'esplora' },
				STONE: { apiBase: 'https://bloodstone.rocks/stone-wallet-api', apiType: 'stoneapi' },
				LTC: { apiBase: 'https://litecoinspace.org/api', apiType: 'esplora' },
				DOGE: { apiBase: 'https://api.blockcypher.com/v1/doge/main', apiType: 'blockcypher' }
			},
			explorer: { drivers: { rod: {}, esplora: {}, blockcypher: {}, blockchair: {}, stoneapi: {} } }
		}
	};
	browser.window = browser;
	browser.$ = browser.jQuery = {
		extend(target) {
			for (let i = 1; i < arguments.length; i++) {
				if (arguments[i]) Object.assign(target, arguments[i]);
			}
			return target;
		},
		isArray: Array.isArray,
		trim(value) { return String(value).trim(); }
	};
	browser.rodOtc = {
		swap: { DEFAULT_PAYMENT_CHAIN: 'LTC' },
		storage: {},
		chains: {
			codes() { return Object.keys(definitions); },
			getDefinition(code) { return definitions[code]; },
			getRefundBlocks(code, role) { return definitions[code].refundBlocks[role]; }
		},
		nostr: {}
	};
	vm.createContext(browser);
	vm.runInContext(engineSource, browser, { filename: 'js/otc-engine.js' });
	return { browser, values };
}

function testV1ConfigIsolation() {
	const result = runEngineWithSavedConfig(null, {
		rodApiUrl: 'https://legacy.invalid/rod',
		altApiUrl: 'https://legacy.invalid/ltc',
		altChains: { DOGE: { apiUrl: 'https://legacy.invalid/doge' } }
	});
	const config = result.browser.rodOtc.engine.loadConfig();
	assert.strictEqual(config.chains.ROD.apiUrl, 'https://api.spacexpanse.org:1234');
	assert.strictEqual(config.chains.LTC.apiUrl, 'https://litecoinspace.org/api');
	assert.strictEqual(config.chains.DOGE.apiUrl, 'https://api.blockcypher.com/v1/doge/main');
	assert.strictEqual(result.values.spexSwapV2Config, undefined,
		'reading defaults must not convert or overwrite a v1 configuration');
	const unknown = runEngineWithSavedConfig({ chains: { DGB: { apiUrl: 'https://unsupported.invalid' } } });
	assert.strictEqual(unknown.browser.rodOtc.engine.loadConfig().chains.DGB, undefined,
		'wallet-only chains must not enter the v2 settlement registry through saved settings');
	const staleRod = runEngineWithSavedConfig({ chains: { ROD: { apiUrl: 'https://api.spacexpanse.org:1234/api', apiType: 'rod' } } });
	assert.strictEqual(staleRod.browser.rodOtc.engine.loadConfig().chains.ROD.apiUrl, 'https://api.spacexpanse.org:1234',
		'v2 engine must ignore stale ROD /api subpaths and keep the canonical API base');
}

testDgbToRodRace();
testLateRequestCannotHideNewLoader();
testAddressChangeInvalidatesOldCallback();
testDgbRoutingAndCsp();
testStoneRoutingAndCsp();
testSavedApiSettingsSanitization();
testV1ConfigIsolation();

console.log('wallet balance, explorer, and v1-isolation regressions: 7/7 passed');
