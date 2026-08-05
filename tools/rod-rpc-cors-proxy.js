#!/usr/bin/env node
/**
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 * Fork-specific helper for the SpaceXpanse ROD wallet.
 *
 * ROD Core RPC CORS proxy (Node.js)
 *
 * Browser static wallet → http://127.0.0.1:18080/... → ROD Core http://127.0.0.1:11999/...
 *
 * Usage:
 *   node rod-rpc-cors-proxy.js
 *   rod-rpc-cors-proxy.exe
 *   rod-rpc-cors-proxy.exe --listen 18080 --target http://127.0.0.1:11999
 *
 * Wallet settings URL example:
 *   http://USER:PASS@127.0.0.1:18080/wallet/ROD
 *
 * Default listen port is 18080 (avoids Windows reserved/excluded ranges near 119xx).
 */

'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_LISTEN = 18080;
const DEFAULT_BIND = '127.0.0.1';
const DEFAULT_TARGET = 'http://127.0.0.1:11999';
const HEALTH_PATH = '/__health';

function parseArgs(argv) {
	const opts = {
		listen: DEFAULT_LISTEN,
		bind: DEFAULT_BIND,
		target: DEFAULT_TARGET,
		allowOrigins: []
	};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--listen' && argv[i + 1]) opts.listen = parseInt(argv[++i], 10);
		else if (a === '--bind' && argv[i + 1]) opts.bind = argv[++i];
		else if (a === '--target' && argv[i + 1]) opts.target = argv[++i];
		else if (a === '--allow-origin' && argv[i + 1]) opts.allowOrigins.push(argv[++i]);
		else if (a === '--help' || a === '-h') {
			console.log('Usage: rod-rpc-cors-proxy [--listen 18080] [--bind 127.0.0.1] [--target http://127.0.0.1:11999] [--allow-origin null]');
			process.exit(0);
		}
	}
	if (!opts.listen || Number.isNaN(opts.listen)) {
		console.error('Invalid --listen port');
		process.exit(1);
	}
	return opts;
}

function normalizeAllowOrigins(allowOrigins) {
	const normalized = {};
	(allowOrigins || []).forEach((origin) => {
		const value = String(origin || '').trim();
		if (value) normalized[value] = true;
	});
	return normalized;
}

function setCors(res, req, corsPolicy) {
	const origin = String(req.headers.origin || '').trim();
	const allowedOrigins = corsPolicy && corsPolicy.allowedOrigins ? corsPolicy.allowedOrigins : null;
	const allowAnyOrigin = !allowedOrigins || !Object.keys(allowedOrigins).length;
	const allowOriginValue = allowAnyOrigin ? (origin || '*') : (allowedOrigins[origin] ? origin : '');
	if (allowOriginValue) {
		res.setHeader('Access-Control-Allow-Origin', allowOriginValue);
	}
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader(
		'Access-Control-Allow-Headers',
		req.headers['access-control-request-headers'] || 'Content-Type, Authorization'
	);
	res.setHeader('Access-Control-Allow-Credentials', 'true');
	if (!allowAnyOrigin) {
		res.setHeader('Vary', 'Origin');
	}
}

function hopByHop(name) {
	return (
		name === 'connection' ||
		name === 'keep-alive' ||
		name === 'proxy-authenticate' ||
		name === 'proxy-authorization' ||
		name === 'te' ||
		name === 'trailers' ||
		name === 'transfer-encoding' ||
		name === 'upgrade' ||
		name === 'host' ||
		name === 'content-length'
	);
}

function proxyRequest(req, res, targetBase, corsPolicy) {
	const chunks = [];
	req.on('data', (c) => chunks.push(c));
	req.on('end', () => {
		const body = Buffer.concat(chunks);
		let targetUrl;
		try {
			targetUrl = new URL(req.url || '/', targetBase);
		} catch (e) {
			setCors(res, req, corsPolicy);
			res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Bad request URL');
			return;
		}

		const isTls = targetUrl.protocol === 'https:';
		const lib = isTls ? https : http;
		const headers = {};
		for (const [key, value] of Object.entries(req.headers)) {
			if (hopByHop(key.toLowerCase())) continue;
			headers[key] = value;
		}
		headers.host = targetUrl.host;
		headers['content-length'] = body.length;

		const upstream = lib.request(
			{
				protocol: targetUrl.protocol,
				hostname: targetUrl.hostname,
				port: targetUrl.port || (isTls ? 443 : 80),
				path: targetUrl.pathname + targetUrl.search,
				method: req.method,
				headers,
				timeout: 30000
			},
			(upRes) => {
				const outHeaders = {};
				for (const [key, value] of Object.entries(upRes.headers)) {
					const lk = key.toLowerCase();
					if (
						lk === 'transfer-encoding' ||
						lk === 'connection' ||
						lk === 'content-length' ||
						lk === 'access-control-allow-origin'
					) {
						continue;
					}
					outHeaders[key] = value;
				}
				setCors(res, req, corsPolicy);
				const upChunks = [];
				upRes.on('data', (c) => upChunks.push(c));
				upRes.on('end', () => {
					const payload = Buffer.concat(upChunks);
					outHeaders['content-length'] = payload.length;
					res.writeHead(upRes.statusCode || 502, outHeaders);
					res.end(payload);
				});
			}
		);

		upstream.on('timeout', () => {
			upstream.destroy();
			if (!res.headersSent) {
				setCors(res, req, corsPolicy);
				res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
				res.end('Upstream RPC timeout');
			}
		});

		upstream.on('error', (err) => {
			if (!res.headersSent) {
				setCors(res, req, corsPolicy);
				res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
				res.end('Upstream RPC error: ' + (err && err.message ? err.message : String(err)));
			}
		});

		upstream.end(body);
	});

	req.on('error', () => {
		if (!res.headersSent) {
			setCors(res, req, corsPolicy);
			res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Request error');
		}
	});
}

function writeHealthResponse(res, opts, targetBase) {
	const payload = JSON.stringify({
		ok: true,
		listen: opts.listen,
		bind: opts.bind,
		target: targetBase,
		allowOrigins: opts.allowOrigins.slice()
	});
	res.writeHead(200, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': Buffer.byteLength(payload)
	});
	res.end(payload);
}

function main() {
	const opts = parseArgs(process.argv);
	const corsPolicy = { allowedOrigins: normalizeAllowOrigins(opts.allowOrigins) };
	let targetBase = opts.target;
	if (!/^https?:\/\//i.test(targetBase)) {
		targetBase = 'http://' + targetBase;
	}
	// Ensure trailing structure for URL resolution
	if (!targetBase.endsWith('/')) {
		// keep as base origin+path without forcing slash issues
	}

	try {
		// validate target
		// eslint-disable-next-line no-new
		new URL(targetBase);
	} catch (e) {
		console.error('Invalid --target URL:', targetBase);
		process.exit(1);
	}

	const server = http.createServer((req, res) => {
		if (req.method === 'OPTIONS') {
			setCors(res, req, corsPolicy);
			res.writeHead(204);
			res.end();
			return;
		}
		if ((req.url || '').split('?')[0] === HEALTH_PATH) {
			setCors(res, req, corsPolicy);
			writeHealthResponse(res, opts, targetBase);
			return;
		}
		if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
			setCors(res, req, corsPolicy);
			res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Method not allowed');
			return;
		}
		proxyRequest(req, res, targetBase, corsPolicy);
	});

	server.on('error', (err) => {
		console.error('Listen error:', err.message);
		process.exit(1);
	});

	server.listen(opts.listen, opts.bind, () => {
		console.log('ROD RPC CORS proxy listening on http://%s:%s', opts.bind, opts.listen);
		console.log('Forwarding to %s', targetBase);
		console.log('Wallet URL example: http://USER:PASS@%s:%s/wallet/ROD', opts.bind, opts.listen);
		console.log('Press Ctrl+C to stop.');
	});
}

main();
