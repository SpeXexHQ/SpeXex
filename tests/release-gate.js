#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const chainRegistry = require(path.join(root, 'js', 'chain-registry.js'));
const results = [];
const releaseInventoryDirectories = new Set(['css', 'fonts', 'images', 'js', 'tools']);

function check(name, fn) {
	try {
		const detail = fn() || '';
		results.push({ name, ok: true, detail });
		console.log('PASS ' + name + (detail ? ' — ' + detail : ''));
	} catch (error) {
		results.push({ name, ok: false, detail: error.message });
		console.error('FAIL ' + name + ' — ' + error.message);
	}
}

function read(relativePath) {
	return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function localAsset(value) {
	if (!value || /^(?:[a-z]+:|#|javascript:|data:|\/\/)/i.test(value)) return null;
	return value.split(/[?#]/)[0].replace(/^\.\//, '');
}

function existing(relativePath) {
	assert(fs.existsSync(path.join(root, relativePath)), 'missing ' + relativePath);
}

function inReleaseInventory(relativePath) {
	const normalized = relativePath.replace(/\\/g, '/');
	if (!normalized.includes('/')) return true;
	return releaseInventoryDirectories.has(normalized.split('/')[0]);
}

function walk(directory, predicate) {
	const output = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.git') continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) output.push(...walk(absolute, predicate));
		else if (!predicate || predicate(absolute)) output.push(absolute);
	}
	return output;
}

function objectLiteralBody(source, marker) {
	const markerIndex = source.indexOf(marker);
	assert(markerIndex !== -1, 'missing registry marker ' + marker);
	const start = source.indexOf('{', markerIndex);
	assert(start !== -1, 'missing registry body for ' + marker);
	let depth = 0;
	for (let index = start; index < source.length; index += 1) {
		if (source[index] === '{') depth += 1;
		if (source[index] === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(start + 1, index);
		}
	}
	throw new Error('unterminated registry body for ' + marker);
}

function topLevelKeys(body) {
	const keys = [];
	let depth = 0;
	for (const line of body.split('\n')) {
		if (depth === 0) {
			const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*:/);
			if (match) keys.push(match[1]);
		}
		for (const character of line) {
			if (character === '{') depth += 1;
			if (character === '}') depth -= 1;
		}
	}
	return keys.sort();
}

function objectLiteral(source, marker) {
	const context = { result: null };
	new vm.Script('result = ({' + objectLiteralBody(source, marker) + '});')
		.runInNewContext(context);
	return context.result;
}

function numericConstant(source, name) {
	const match = source.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)'));
	assert(match, 'missing numeric harness constant ' + name);
	return Number(match[1]);
}

function decimalToBaseUnits(value) {
	const parts = String(value).split('.');
	return Number(parts[0]) * 1e8 + Number(((parts[1] || '') + '00000000').slice(0, 8));
}

check('required release and proof-harness files exist', () => {
	[
		'index.html', '_headers', 'manifest.webmanifest', 'sw.js',
		'SHA256SUMS', 'tests/update-checksums.js',
		'tests/security-regression.js', 'tests/wallet-balance-race.js',
		'tests/explorer-contract.js', 'tests/mutation-gate.js',
		'tests/harness/package.json', 'tests/harness/package-lock.json',
		'tests/harness/unit-browser-test.js', 'tests/harness/e2e-swap-test.js',
		'tests/harness/mock-infra.js', 'tests/harness/run-all.sh'
	].forEach(existing);
	return 'application, fast gates, browser unit gate, mock chains, and e2e runner';
});

if (process.env.SKIP_RELEASE_INTEGRITY !== '1') {
	check('SHA-256 release manifest is complete and valid', () => {
		assert(!fs.existsSync(path.join(root, 'sha1sum')),
			'obsolete SHA-1 manifest is still present');
		const manifestPath = path.join(root, 'SHA256SUMS');
		const entries = new Map();
		for (const line of fs.readFileSync(manifestPath, 'utf8').trim().split('\n')) {
			const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/);
			assert(match, 'malformed SHA256SUMS line: ' + line);
			assert(!entries.has(match[2]), 'duplicate SHA256SUMS entry: ' + match[2]);
			entries.set(match[2], match[1]);
		}

		const files = walk(root, (file) => {
			const relative = path.relative(root, file).replace(/\\/g, '/');
			return inReleaseInventory(relative) &&
				relative !== 'SHA256SUMS' &&
				relative !== 'sha1sum' &&
				!/^tests\/harness\/e2e-report-.*\.json$/.test(relative);
		}).map((file) => path.relative(root, file).replace(/\\/g, '/')).sort();
		assert.deepStrictEqual([...entries.keys()].sort(), files,
			'SHA256SUMS file inventory differs from the release tree');

		for (const relative of files) {
			const digest = crypto.createHash('sha256')
				.update(fs.readFileSync(path.join(root, relative)))
				.digest('hex');
			assert.strictEqual(entries.get(relative), digest,
				'SHA-256 mismatch for ' + relative);
		}
		return files.length + ' files';
	});
}

check('first-party JavaScript parses', () => {
	const files = walk(path.join(root, 'js'), (file) =>
		file.endsWith('.js') && !/\.min\.js$/i.test(file)
	);
	for (const file of files) {
		new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(root, file) });
	}
	return files.length + ' files';
});

check('release contains no unresolved merge markers', () => {
	const files = walk(root, (file) =>
		/\.(?:js|html|css|json|md|webmanifest)$/.test(file) &&
		!file.includes(path.sep + 'node_modules' + path.sep)
	);
	const offenders = [];
	for (const file of files) {
		const text = fs.readFileSync(file, 'utf8');
		if (/^(?:<{7}|={7}|>{7})(?:\s|$)/m.test(text)) {
			offenders.push(path.relative(root, file));
		}
	}
	assert.deepStrictEqual(offenders, [], 'merge markers in ' + offenders.join(', '));
	return files.length + ' text files';
});

check('all local HTML, manifest, and CSS assets exist', () => {
	const index = read('index.html');
	const assets = new Set();
	for (const match of index.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
		const asset = localAsset(match[1]);
		if (asset) assets.add(asset);
	}
	const manifest = JSON.parse(read('manifest.webmanifest'));
	for (const icon of manifest.icons || []) assets.add(localAsset(icon.src));
	for (const cssPath of [...assets].filter((asset) => asset && asset.endsWith('.css'))) {
		const css = read(cssPath);
		for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
			const raw = match[1].split(/[?#]/)[0];
			if (/^(?:data:|[a-z]+:|\/\/)/i.test(raw)) continue;
			assets.add(path.normalize(path.join(path.dirname(cssPath), raw)).replace(/\\/g, '/'));
		}
	}
	for (const asset of assets) if (asset) existing(asset);
	return assets.size + ' referenced local assets';
});

check('runtime script order preserves global dependencies', () => {
	const scripts = [...read('index.html').matchAll(/<script[^>]+\bsrc=["']([^"']+)["']/gi)]
		.map((match) => match[1]);
	const requiredOrder = [
		'js/jquery-1.9.1.min.js',
		'js/crypto-min.js',
		'js/jsbn.js',
		'js/ellipticcurve.js',
		'js/chain-registry.js',
		'js/coin.js',
		'js/otc-explorer.js',
		'js/ecdsa-adaptor.js',
		'js/otc-chains.js',
		'js/otc-storage.js',
		'js/otc-nostr.js',
		'js/otc-swap.js',
		'js/otc-engine.js',
		'js/otc-app-ui.js',
		'js/coinbin.js'
	];
	let previous = -1;
	for (const script of requiredOrder) {
		const position = scripts.indexOf(script);
		assert(position !== -1, 'index.html does not load ' + script);
		assert(position > previous, script + ' is loaded out of order');
		previous = position;
	}
	return requiredOrder.length + ' dependency-sensitive scripts';
});

check('service-worker precache is complete and contains no missing entry', () => {
	const sw = read('sw.js');
	const match = sw.match(/const\s+STATIC_ASSET_URLS\s*=\s*(\[[\s\S]*?\]);/);
	assert(match, 'STATIC_ASSET_URLS was not found');
	const cached = JSON.parse(match[1]).map((asset) => asset.replace(/^\.\//, ''));
	for (const asset of cached) {
		if (!asset) continue;
		existing(asset);
	}

	const required = new Set(['index.html', 'manifest.webmanifest']);
	const index = read('index.html');
	for (const htmlMatch of index.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
		const asset = localAsset(htmlMatch[1]);
		if (asset && /\.(?:js|css|png|gif|webmanifest)$/i.test(asset)) required.add(asset);
	}
	for (const cssPath of [...required].filter((asset) => asset.endsWith('.css'))) {
		for (const cssMatch of read(cssPath).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
			const raw = cssMatch[1].split(/[?#]/)[0];
			if (/^(?:data:|[a-z]+:|\/\/)/i.test(raw)) continue;
			required.add(path.normalize(path.join(path.dirname(cssPath), raw)).replace(/\\/g, '/'));
		}
	}
	const missing = [...required].filter((asset) => !cached.includes(asset));
	assert.deepStrictEqual(missing, [], 'offline shell omits ' + missing.join(', '));
	return cached.length + ' precached assets';
});

check('default API origins are permitted by deployed CSP', () => {
	const headers = read('_headers');
	const cspMatch = headers.match(/Content-Security-Policy:\s*([^\n\r]+)/i);
	assert(cspMatch, 'Content-Security-Policy header is missing');
	const connectMatch = cspMatch[1].match(/connect-src\s+([^;]+)/i);
	assert(connectMatch, 'connect-src directive is missing');
	const allowlist = connectMatch[1].split(/\s+/);
	const origins = new Set(chainRegistry.codes().map((code) =>
		new URL(chainRegistry.getProfile(code).api.base).origin
	));
	const blocked = [...origins].filter((origin) => !allowlist.includes(origin));
	assert.deepStrictEqual(blocked, [], 'CSP blocks default API origin(s): ' + blocked.join(', '));
	return origins.size + ' default API origins';
});

check('wallet, explorer, and OTC support registries cannot drift', () => {
	const coinSource = read('js/coin.js');
	const explorerSource = read('js/otc-explorer.js');
	const chainSource = read('js/otc-chains.js');
	const engineSource = read('js/otc-engine.js');
	const uiSource = read('js/otc-app-ui.js');
	const walletUiSource = read('js/coinbin.js');
	const e2eSource = read('tests/harness/e2e-swap-test.js');
	const mockSource = read('tests/harness/mock-infra.js');
	const runnerSource = read('tests/harness/run-all.sh');

	const networkTypes = chainRegistry.codes().map((code) => chainRegistry.getProfile(code).api.type)
		.filter((type) => type !== 'rod');
	const drivers = topLevelKeys(objectLiteralBody(explorerSource, 'explorer.drivers ='))
		.map((key) => key.toLowerCase());
	for (const type of networkTypes) {
		assert(drivers.includes(type), 'wallet network references unregistered explorer driver ' + type);
	}

	const definitions = chainRegistry.swapCodes();
	assert(coinSource.includes('spexChainRegistry.walletNetworks()'),
		'wallet runtime must compile networks from the authoritative registry');
	assert(chainSource.includes('spexChainRegistry.swapDefinitions()') && chainSource.includes('spexChainRegistry.swapPolicies()'),
		'swap runtime must compile definitions and policy from the authoritative registry');
	assert(engineSource.includes('CHAINS.codes().forEach'), 'engine defaults must derive from the unified chain registry');
	assert(e2eSource.includes('CHAIN_REGISTRY.swapCodes()') && e2eSource.includes('process.env.ASSET_CHAIN') &&
		e2eSource.includes('process.env.PAYMENT_CHAIN') && !/SUPPORTED_ALT_CHAINS\s*=\s*\[/.test(e2eSource),
		'e2e pair roles must be discovered from the authoritative registry');
	assert(runnerSource.includes("require('../../js/chain-registry.js').swapCodes()") &&
		runnerSource.includes('if(asset!==payment)') && runnerSource.includes('SUPPORTED_SWAP_PAIRS'),
		'full matrix runner must discover every ordered pair of certified chains');
	assert(mockSource.includes('CHAIN_REGISTRY.codes()') && mockSource.includes('CHAIN_REGISTRY.swapCodes()'),
		'mock chain versions and policy must derive from the authoritative registry');
	const uiRegistry = uiSource.match(/function chainCodes\(\)\s*\{([\s\S]*?)\n\t\}/);
	assert(uiRegistry, 'OTC UI chain registry function is missing');
	assert(uiRegistry[1].includes('CHAINS.codes()'),
		'OTC UI must derive both selectors from the unified chain registry');
	assert(!uiRegistry[1].includes('for (var code in coinjs.networks)'),
		'OTC UI exposes every wallet network as a swap network');
	assert(walletUiSource.includes('function renderWalletCoinMenu()') && walletUiSource.includes('for(var code in coinjs.networks)'),
		'wallet Coins menu must be generated from the authoritative registry');
	assert(walletUiSource.includes('Object.keys(coinjs.networks || {}).sort()'),
		'wallet Settings network dropdown must be generated from the authoritative registry');
	assert(!walletUiSource.includes('Currently supported chains for OTC trading: ROD, LTC, DOGE'),
		'wallet-only notice contains a copied swap-support list');
	assert(!/if\s*\(coinjs\.pub\s*==/.test(walletUiSource),
		'wallet Settings still dispatches networks by colliding version bytes');
	return 'wallet drivers=' + [...new Set(networkTypes)].sort().join(',') +
		'; swap registry=' + definitions.join(',');
});

check('profile-only onboarding compiles every consumer and rejects incomplete certification', () => {
	const profiles = chainRegistry.profiles();
	const fixture = JSON.parse(JSON.stringify(profiles.LTC));
	fixture.code = 'TST';
	fixture.name = 'Registry Test Chain';
	fixture.shortName = 'Test Chain';
	fixture.unit = 'TST';
	fixture.uriPrefix = 'testchain';
	profiles.TST = fixture;
	const extended = chainRegistry.compile(profiles);
	assert(extended.codes().includes('TST'), 'fixture did not enter wallet registry');
	assert(extended.swapCodes().includes('TST'), 'fixture did not enter swap registry');
	assert(extended.walletNetworks().TST.apiBase === fixture.api.base, 'fixture did not enter API settings');
	assert(extended.swapDefinitions().TST.fees.claim === fixture.swap.fees.claim, 'fixture did not enter settlement defaults');
	assert(extended.swapPolicies().TST.blockSeconds === fixture.swap.blockSeconds, 'fixture did not enter timing policy');

	const broken = chainRegistry.profiles();
	broken.LTC.swap.policy = null;
	assert.throws(() => chainRegistry.compile(broken), /relay policy is missing/,
		'incomplete certified profile was accepted');
	const collision = chainRegistry.profiles();
	collision.LTC.address.multisig = collision.LTC.address.pub;
	assert.throws(() => chainRegistry.compile(collision), /P2PKH and P2SH version bytes must differ/,
		'same-chain address-prefix collision was accepted');
	const unsafePair = chainRegistry.profiles();
	unsafePair.LTC.swap.refundBlocks.asset = 25;
	assert.throws(() => chainRegistry.compile(unsafePair), /LTC\/(?:DOGE|ROD) default refund windows are unsafe/,
		'profile that exposes unsafe cross-chain defaults was accepted');
	return 'one TST profile reached wallet, swap, API, timing, fee, and policy consumers';
});

check('settlement harness consumes production registry without copied chain constants', () => {
	const e2eSource = read('tests/harness/e2e-swap-test.js');
	assert(e2eSource.includes("const CONTROL_PROFILE = harnessProfile('ROD')"), 'ROD control-plane harness profile is not registry-derived');
	assert(e2eSource.includes('const ROD_PROFILE = harnessProfile(ASSET)'), 'asset harness profile is not registry-derived');
	assert(e2eSource.includes('const ALT_PROFILE = harnessProfile(ALT)'), 'counter-chain harness profile is not registry-derived');
	assert(!/const\s+ALT_PROFILES\s*=/.test(e2eSource), 'copied e2e chain profiles remain');
	assert(!/const\s+(?:REFUND_ROD_BLOCKS|ROD_CLAIM_FEE|ASSET_REFUND_FEE)\s*=\s*\d+/.test(e2eSource),
		'copied settlement constants remain in e2e harness');
	return chainRegistry.swapCodes().join(',') + ' profiles and all ordered pairs derived at runtime';
});

check('UI, manifest, and service-worker release identities agree', () => {
	const indexMatch = read('index.html').match(/Version\s+([0-9]+\.[0-9]+\.[0-9]+-[A-Za-z0-9.-]+)/);
	assert(indexMatch, 'UI version was not found');
	const version = indexMatch[1];
	const manifest = JSON.parse(read('manifest.webmanifest'));
	assert(String(manifest.name || '').includes(version), 'manifest name does not contain ' + version);
	assert(String(manifest.description || '').includes(version), 'manifest description does not contain ' + version);
	assert(read('sw.js').includes(version), 'service-worker cache key does not contain ' + version);
	return version;
});

check('DOM IDs used as selectors are unique', () => {
	const html = read('index.html');
	const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
	const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
	const selectorSources = read('js/coinbin.js') + '\n' + read('js/otc-app-ui.js');
	const dangerous = duplicates.filter((id) =>
		selectorSources.includes('#' + id) || selectorSources.includes('getElementById("' + id)
	);
	assert.deepStrictEqual(dangerous, [], 'duplicate selector ID(s): ' + dangerous.join(', '));
	return duplicates.length ? 'non-scripted duplicate(s): ' + duplicates.join(', ') : ids.length + ' unique IDs';
});

const failed = results.filter((result) => !result.ok);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' release gates passed');
process.exitCode = failed.length ? 1 : 0;
