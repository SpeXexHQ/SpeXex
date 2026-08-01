#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const testRoot = __dirname;

function copyProject() {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), 'rod-wallet-mutant-'));
	const skippedPaths = [
		path.join('tests', 'harness', 'node_modules'),
		path.join('electron', 'dist')
	];
	fs.cpSync(root, target, {
		recursive: true,
		filter(source) {
			return !skippedPaths.some(function(skippedPath) {
				return source.includes(skippedPath);
			});
		}
	});
	return target;
}

function replaceOnce(file, before, after) {
	const source = fs.readFileSync(file, 'utf8');
	const normalizedSource = source.replace(/\r\n/g, '\n');
	const normalizedBefore = before.replace(/\r\n/g, '\n');
	assert(normalizedSource.includes(normalizedBefore), 'mutation target not found in ' + file + ': ' + before);
	fs.writeFileSync(file, normalizedSource.replace(normalizedBefore, after.replace(/\r\n/g, '\n')));
}

function runTest(script, appDir) {
	const extraEnv = script === 'release-gate.js'
		? { SKIP_RELEASE_INTEGRITY: '1' }
		: {};
	return spawnSync(process.execPath, [path.join(testRoot, script)], {
		env: Object.assign({}, process.env, { APP_DIR: appDir }, extraEnv),
		encoding: 'utf8',
		timeout: 60000
	});
}

const mutants = [
	{
		name: 'unsigned swap events become optional',
		script: 'security-regression.js',
		mutate(appDir) {
			replaceOnce(
				path.join(appDir, 'js', 'otc-nostr.js'),
				"\t\tif(!eventObject.sig || !schnorrVerify(eventObject.id, eventObject.pubkey, eventObject.sig)){\n\t\t\tthrow new Error('OTC Nostr event signature mismatch');",
				"\t\tif(eventObject.sig && !schnorrVerify(eventObject.id, eventObject.pubkey, eventObject.sig)){\n\t\t\tthrow new Error('OTC Nostr event signature mismatch');"
			);
		}
	},
	{
		name: 'unsigned order events become optional',
		script: 'security-regression.js',
		mutate(appDir) {
			replaceOnce(
				path.join(appDir, 'js', 'otc-nostr.js'),
				"\t\tif(!eventObject.sig || !schnorrVerify(eventObject.id, eventObject.pubkey, eventObject.sig)){\n\t\t\tthrow new Error('Order event signature mismatch');",
				"\t\tif(eventObject.sig && !schnorrVerify(eventObject.id, eventObject.pubkey, eventObject.sig)){\n\t\t\tthrow new Error('Order event signature mismatch');"
			);
		}
	},
	{
		name: 'terms hash equality is bypassed',
		script: 'security-regression.js',
		mutate(appDir) {
			replaceOnce(
				path.join(appDir, 'js', 'otc-swap.js'),
				" || localHash !== remoteHash){",
				"){"
			);
		}
	},
	{
		name: 'refund ordering guard is disabled',
		script: 'security-regression.js',
		mutate(appDir) {
			replaceOnce(
				path.join(appDir, 'js', 'otc-swap.js'),
				'if(!(rodRemainingSeconds > altRemainingSeconds + safetyMarginSeconds)){',
				'if(false){'
			);
		}
	},
	{
		name: 'stale wallet callback takes ownership',
		script: 'wallet-balance-race.js',
		mutate(appDir) {
			replaceOnce(
				path.join(appDir, 'js', 'coinbin.js'),
				"finish: function(request, networkCode, address){\n\t\t\t\tif(!matches(request, networkCode, address)){\n\t\t\t\t\treturn false;\n\t\t\t\t}",
				"finish: function(request, networkCode, address){\n\t\t\t\tif(false){\n\t\t\t\t\treturn false;\n\t\t\t\t}"
			);
		}
	},
	{
		name: 'DGB default is removed from CSP',
		script: 'release-gate.js',
		mutate(appDir) {
			replaceOnce(path.join(appDir, '_headers'), ' https://digiexplorer.info', '');
		}
	},
	{
		name: 'Blockchair input points to its spending transaction',
		script: 'explorer-contract.js',
		mutate(appDir) {
			replaceOnce(
				path.join(appDir, 'js', 'otc-explorer.js'),
				"txid: inputs[i].transaction_hash || '',\n\t\t\t\t\t\tvout: toInt(inputs[i].index, 0),",
				"txid: inputs[i].spending_transaction_hash || '',\n\t\t\t\t\t\tvout: toInt(inputs[i].spending_index, 0),"
			);
		}
	}
];

let killed = 0;
for (const mutant of mutants) {
	const appDir = copyProject();
	try {
		mutant.mutate(appDir);
		const result = runTest(mutant.script, appDir);
		const wasKilled = result.status !== 0;
		if (!wasKilled) {
			console.error('FAIL mutation survived: ' + mutant.name);
		} else {
			killed += 1;
			console.log('PASS mutation killed: ' + mutant.name);
		}
	} finally {
		fs.rmSync(appDir, { recursive: true, force: true });
	}
}

console.log(killed + '/' + mutants.length + ' blocker mutations killed');
process.exitCode = killed === mutants.length ? 0 : 1;
