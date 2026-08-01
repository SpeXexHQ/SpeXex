#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const manifestName = 'SHA256SUMS';
const releaseDirectories = new Set(['css', 'fonts', 'images', 'js', 'tools']);

function inReleaseInventory(relativePath) {
	const normalized = relativePath.replace(/\\/g, '/');
	if (!normalized.includes('/')) return true;
	return releaseDirectories.has(normalized.split('/')[0]);
}

function excluded(relativePath) {
	const normalized = relativePath.replace(/\\/g, '/');
	return !inReleaseInventory(normalized) ||
		normalized === manifestName ||
		normalized === 'sha1sum' ||
		normalized.startsWith('.git/') ||
		normalized.includes('/node_modules/') ||
		/^tests\/harness\/e2e-report-.*\.json$/.test(normalized);
}

function walk(directory) {
	const files = [];
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		const relative = path.relative(root, absolute).replace(/\\/g, '/');
		if (excluded(relative)) continue;
		if (entry.isDirectory()) files.push(...walk(absolute));
		else if (entry.isFile()) files.push(relative);
	}
	return files;
}

const lines = walk(root).sort().map((relativePath) => {
	const digest = crypto.createHash('sha256')
		.update(fs.readFileSync(path.join(root, relativePath)))
		.digest('hex');
	return `${digest}  ${relativePath}`;
});

fs.writeFileSync(path.join(root, manifestName), lines.join('\n') + '\n');
console.log(`Wrote ${manifestName} with ${lines.length} files`);
