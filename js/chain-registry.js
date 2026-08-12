/*
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 *
 * SpeXex authoritative chain registry.
 *
 * This file is intentionally usable both as a browser global and as a Node
 * module. Runtime wallet networks, swap profiles, mock-chain policy and the
 * release matrix are derived from the same reviewed records.
 */

(function(root, factory){
	var registry = factory();
	if(typeof module === 'object' && module.exports){
		module.exports = registry;
	}
	if(root){
		root.spexChainRegistry = registry;
	}
})(typeof window !== 'undefined' ? window : null, function(){
	'use strict';

	var BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

	/* A chain has one profile. `swap.status` is an attestation state, not a
	   different chain type or protocol role. An attested chain can occupy
	   either side of a swap. */
	var PROFILES = {
		ROD: {
			code: 'ROD',
			name: 'SpaceXpanse ROD',
			shortName: 'SpaceXpanse',
			unit: 'ROD',
			uriPrefix: 'rod',
			description: 'SpaceXpanse ROD is the native utility coin and settlement/data layer of the SpaceXpanse Multiverse. Its UTXO blockchain supports payments, arbitrary names and data, digital identities, tokens, NFTs and trustless atomic trading.',
			website: 'https://rod.spacexpanse.org',
			documentation: 'https://docs.spacexpanse.org',
			repositories: [
				{ label: 'ROD Core wallet', url: 'https://github.com/SpaceXpanse/rod-core-wallet' },
				{ label: 'SpaceXpanse documentation', url: 'https://github.com/SpaceXpanse/Documentation/wiki' }
			],
			address: { pub: 0x3c, priv: 0x4e, multisig: 0x4b },
			hdkey: { prv: 0x04881eb2, pub: 0x0488e4ad },
			bech32: { charset: BECH32_CHARSET, version: 0, hrp: 'rod' },
			segwit: true,
			explorer: {
				tx: 'https://explorer.rod.spacexpanse.org/tx/',
				addr: 'https://explorer.rod.spacexpanse.org/address/',
				block: 'https://explorer.rod.spacexpanse.org/blocks/'
			},
			api: { type: 'rod', base: 'https://api.spacexpanse.org:1234', operator: 'spexex' },
			swap: {
				status: 'attested',
				transactionModel: 'bitcoin-utxo',
				curve: 'secp256k1',
				signature: 'ecdsa',
				transactionFormat: 'bitcoin',
				escrow: 'p2sh-2of2',
				sighash: 'legacy-all',
				timelock: 'nlocktime-height',
				decimals: 8,
				blockSeconds: 30,
				refundBlocks: { asset: 480, payment: 120 },
				confirmations: 1,
				fees: { claim: '0.00051900', refund: '0.00051900', funding: '0.00051900' },
				policy: {
					feeRatePerByte: 0,
					relayFloorPerByte: 0,
					hardDustSats: 546,
					softDustSats: 0,
					dustSurchargeSats: 0,
					changeThresholdSats: 546
				},
				attestation: {
					testAmount: '100.00000000',
					p2pkhVector: 'RKxTdfmtxtfLDKZBgx6SvNkBtNu9jRYnLh',
					p2sh2of2Vector: 'XD5dhagVPqXzKE7ud5jPWpFAgjV9NeWaNY'
				}
			}
		},
		LTC: {
			code: 'LTC',
			name: 'Litecoin',
			shortName: 'Litecoin',
			unit: 'LTC',
			uriPrefix: 'litecoin',
			description: 'Litecoin is a peer-to-peer UTXO cryptocurrency designed for fast, low-cost payments. It uses Scrypt proof of work and remains closely compatible with Bitcoin-style transaction and scripting primitives.',
			website: 'https://litecoin.org',
			documentation: 'https://github.com/litecoin-project/litecoin/tree/master/doc',
			repositories: [
				{ label: 'Litecoin Core', url: 'https://github.com/litecoin-project/litecoin' }
			],
			address: { pub: 0x30, priv: 0xb0, multisig: 0x32 },
			hdkey: { prv: 0x019d9cfe, pub: 0x019da462 },
			bech32: { charset: BECH32_CHARSET, version: 0, hrp: 'ltc' },
			segwit: true,
			explorer: {
				tx: 'https://litecoinspace.org/tx/',
				addr: 'https://litecoinspace.org/address/',
				block: 'https://litecoinspace.org/block/'
			},
			api: { type: 'esplora', base: 'https://litecoinspace.org/api', operator: 'community' },
			swap: {
				status: 'attested',
				transactionModel: 'bitcoin-utxo',
				curve: 'secp256k1',
				signature: 'ecdsa',
				transactionFormat: 'bitcoin',
				escrow: 'p2sh-2of2',
				sighash: 'legacy-all',
				timelock: 'nlocktime-height',
				decimals: 8,
				blockSeconds: 150,
				refundBlocks: { asset: 96, payment: 24 },
				confirmations: 1,
				fees: { claim: '0.00001000', refund: '0.00001000', funding: '0.00001000' },
				policy: {
					feeRatePerByte: 2,
					relayFloorPerByte: 1,
					hardDustSats: 546,
					softDustSats: 0,
					dustSurchargeSats: 0,
					changeThresholdSats: 546
				},
				/* This fixture deliberately stays below the historical
				   satoshi/coin ambiguity threshold covered by the e2e suite. */
				attestation: {
					testAmount: '0.05000000',
					p2pkhVector: 'LVuDpNCSSj6pQ7t9Pv6d6sUkLKoqDEVUnJ',
					p2sh2of2Vector: 'M9dZ5sEHeKx5sPdk1bQRPgSVx83ZhNrdm6'
				}
			}
		},
		DOGE: {
			code: 'DOGE',
			name: 'Dogecoin',
			shortName: 'Dogecoin',
			unit: 'DOGE',
			uriPrefix: 'dogecoin',
			description: 'Dogecoin is a community-driven peer-to-peer UTXO cryptocurrency using Scrypt proof of work. Its current settlement profile uses legacy Bitcoin-style transactions and deliberately does not expose SegWit addresses.',
			website: 'https://dogecoin.com',
			documentation: 'https://dogecoin.com/dogepedia/',
			repositories: [
				{ label: 'Dogecoin Core', url: 'https://github.com/dogecoin/dogecoin' }
			],
			address: { pub: 0x1e, priv: 0x9e, multisig: 0x16 },
			hdkey: { prv: 0x02fac398, pub: 0x02facafd },
			/* Dogecoin has no SegWit/bech32, but the shared charset remains
			   present because Nostr npub encoding uses it. */
			bech32: { charset: BECH32_CHARSET, version: 0, hrp: '' },
			segwit: false,
			explorer: {
				tx: 'https://blockchair.com/dogecoin/transaction/',
				addr: 'https://blockchair.com/dogecoin/address/',
				block: 'https://blockchair.com/dogecoin/block/'
			},
			api: { type: 'blockcypher', base: 'https://api.blockcypher.com/v1/doge/main', operator: 'community' },
			swap: {
				status: 'attested',
				transactionModel: 'bitcoin-utxo',
				curve: 'secp256k1',
				signature: 'ecdsa',
				transactionFormat: 'bitcoin',
				escrow: 'p2sh-2of2',
				sighash: 'legacy-all',
				timelock: 'nlocktime-height',
				decimals: 8,
				blockSeconds: 60,
				refundBlocks: { asset: 240, payment: 60 },
				confirmations: 6,
				fees: { claim: '0.01000000', refund: '0.01000000', funding: '0.01000000' },
				policy: {
					feeRatePerByte: 1000,
					relayFloorPerByte: 100,
					hardDustSats: 100000,
					softDustSats: 1000000,
					dustSurchargeSats: 1000000,
					changeThresholdSats: 3000000
				},
				attestation: {
					testAmount: '500.00000000',
					p2pkhVector: 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE',
					p2sh2of2Vector: '9tAfWptDmGyYyFjKKr5VpApUKzq9hFpBJ1'
				}
			}
		},
		STONE: {
			code: 'STONE',
			name: 'Bloodstone',
			shortName: 'Bloodstone',
			unit: 'STONE',
			uriPrefix: 'bloodstone',
			description: 'Bloodstone is a Bitcoin-derived UTXO cryptocurrency with public wallet API support at bloodstone.rocks. This build currently exposes wallet, explorer, and transaction tooling only.',
			website: 'https://bloodstone.rocks',
			documentation: 'https://bloodstone.rocks/stone-wallet-api',
			repositories: [
				{ label: 'Bloodstone source repository', url: 'https://github.com/TheBloodStone/bloodstone' }
			],
			address: { pub: 0x3f, priv: 0xbf, multisig: 0x7d },
			/* The current public integration source proves the wallet-visible
			   address/WIF/Bech32 surface and API contract, but not custom BIP32
			   version bytes. Use the standard xpub/xprv serialization until an
			   authoritative upstream source is reviewed in-repo. */
			hdkey: { prv: 0x0488ade4, pub: 0x0488b21e },
			bech32: { charset: BECH32_CHARSET, version: 0, hrp: 'stone' },
			segwit: true,
			explorer: {
				tx: 'https://bloodstone.rocks/explorer/tx/',
				addr: 'https://bloodstone.rocks/explorer/address/',
				block: 'https://bloodstone.rocks/explorer/block/'
			},
			api: { type: 'stoneapi', base: 'https://bloodstone.rocks/stone-wallet-api', operator: 'community' },
			swap: { status: 'wallet-only' }
		},
		BTC: {
			code: 'BTC',
			name: 'Bitcoin',
			shortName: 'Bitcoin',
			unit: 'BTC',
			uriPrefix: 'bitcoin',
			description: 'Bitcoin is the original decentralized UTXO cryptocurrency and the reference design for Bitcoin-style transactions, scripts, keys and address formats used throughout this wallet.',
			website: 'https://bitcoin.org',
			documentation: 'https://developer.bitcoin.org',
			repositories: [
				{ label: 'Bitcoin Core', url: 'https://github.com/bitcoin/bitcoin' }
			],
			address: { pub: 0x00, priv: 0x80, multisig: 0x05 },
			hdkey: { prv: 0x0488ade4, pub: 0x0488b21e },
			bech32: { charset: BECH32_CHARSET, version: 0, hrp: 'bc' },
			segwit: true,
			explorer: {
				tx: 'https://mempool.space/tx/',
				addr: 'https://mempool.space/address/',
				block: 'https://mempool.space/block/'
			},
			api: { type: 'esplora', base: 'https://mempool.space/api', operator: 'community' },
			swap: { status: 'wallet-only' }
		},
		BCH: {
			code: 'BCH',
			name: 'Bitcoin Cash',
			shortName: 'Bitcoin Cash',
			unit: 'BCH',
			uriPrefix: 'bitcoincash',
			description: 'Bitcoin Cash is a peer-to-peer UTXO cryptocurrency derived from Bitcoin, focused on on-chain payments and larger block capacity. This build currently exposes wallet and explorer functionality only.',
			website: 'https://bitcoincash.org',
			documentation: 'https://documentation.cash',
			repositories: [
				{ label: 'Bitcoin Cash Node', url: 'https://gitlab.com/bitcoin-cash-node/bitcoin-cash-node' }
			],
			address: { pub: 0x00, priv: 0x80, multisig: 0x05 },
			hdkey: { prv: 0x0488ade4, pub: 0x0488b21e },
			bech32: { charset: BECH32_CHARSET, version: 0, hrp: '' },
			segwit: false,
			explorer: {
				tx: 'https://blockchair.com/bitcoin-cash/transaction/',
				addr: 'https://blockchair.com/bitcoin-cash/address/',
				block: 'https://blockchair.com/bitcoin-cash/block/'
			},
			api: { type: 'blockbook', base: 'https://bch1.trezor.io', operator: 'community' },
			swap: { status: 'wallet-only' }
		},
		DGB: {
			code: 'DGB',
			name: 'DigiByte',
			shortName: 'DigiByte',
			unit: 'DGB',
			uriPrefix: 'digibyte',
			description: 'DigiByte is a multi-algorithm proof-of-work UTXO blockchain designed for fast block production and broad mining participation. This build currently exposes wallet and explorer functionality only.',
			website: 'https://digibyte.org',
			documentation: 'https://docs.digibyte.org',
			repositories: [
				{ label: 'DigiByte Core', url: 'https://github.com/DigiByte-Core/digibyte' }
			],
			address: { pub: 0x1e, priv: 0x80, multisig: 0x3f },
			hdkey: { prv: 0x0488ade4, pub: 0x0488b21e },
			bech32: { charset: BECH32_CHARSET, version: 0, hrp: 'dgb' },
			segwit: true,
			explorer: {
				tx: 'https://digiexplorer.info/tx/',
				addr: 'https://digiexplorer.info/address/',
				block: 'https://digiexplorer.info/block/'
			},
			api: { type: 'esplora', base: 'https://digiexplorer.info/api', operator: 'community' },
			swap: { status: 'wallet-only' }
		}
	};

	function clone(value){
		return JSON.parse(JSON.stringify(value));
	}

	function positiveInteger(value){
		return typeof value === 'number' && isFinite(value) && value > 0 && Math.floor(value) === value;
	}

	function nonNegativeInteger(value){
		return typeof value === 'number' && isFinite(value) && value >= 0 && Math.floor(value) === value;
	}

	function validDecimal(value, decimals){
		var pattern = new RegExp('^\\d+(?:\\.\\d{1,' + decimals + '})?$');
		return typeof value === 'string' && pattern.test(value);
	}

	function requireValue(ok, message){
		if(!ok) throw new Error('Invalid chain registry: ' + message);
	}

	function validateProfile(code, profile){
		requireValue(/^[A-Z0-9]{2,10}$/.test(code), 'invalid code ' + code);
		requireValue(profile && profile.code === code, code + ' code does not match its registry key');
		requireValue(typeof profile.name === 'string' && profile.name.length > 0, code + ' name is missing');
		requireValue(typeof profile.shortName === 'string' && profile.shortName.length > 0, code + ' shortName is missing');
		requireValue(typeof profile.unit === 'string' && profile.unit.length > 0, code + ' unit is missing');
		requireValue(typeof profile.uriPrefix === 'string' && /^[a-z][a-z0-9+.-]*$/.test(profile.uriPrefix),
			code + ' URI prefix is missing or invalid');
		requireValue(typeof profile.description === 'string' && profile.description.length >= 40,
			code + ' description is missing or too short');
		['website', 'documentation'].forEach(function(field){
			requireValue(typeof profile[field] === 'string' && /^https:\/\//.test(profile[field]),
				code + ' ' + field + ' URL is missing or invalid');
		});
		requireValue(Array.isArray(profile.repositories) && profile.repositories.length > 0,
			code + ' repositories are missing');
		profile.repositories.forEach(function(repository, index){
			requireValue(repository && typeof repository.label === 'string' && repository.label.length > 0,
				code + ' repository ' + index + ' label is missing');
			requireValue(typeof repository.url === 'string' && /^https:\/\//.test(repository.url),
				code + ' repository ' + index + ' URL is invalid');
		});
		requireValue(profile.address, code + ' address versions are missing');
		['pub', 'priv', 'multisig'].forEach(function(field){
			requireValue(nonNegativeInteger(profile.address[field]) && profile.address[field] <= 255,
				code + ' address.' + field + ' must be one byte');
		});
		requireValue(profile.address.pub !== profile.address.multisig,
			code + ' P2PKH and P2SH version bytes must differ');
		requireValue(profile.hdkey && nonNegativeInteger(profile.hdkey.prv) && profile.hdkey.prv <= 0xffffffff &&
			nonNegativeInteger(profile.hdkey.pub) && profile.hdkey.pub <= 0xffffffff,
			code + ' HD key versions are missing');
		requireValue(profile.bech32 && profile.bech32.charset === BECH32_CHARSET,
			code + ' bech32 charset is missing');
		requireValue(nonNegativeInteger(profile.bech32.version) && profile.bech32.version <= 16,
			code + ' bech32 witness version is invalid');
		requireValue(typeof profile.segwit === 'boolean', code + ' segwit capability must be explicit');
		requireValue(!profile.segwit || !!profile.bech32.hrp, code + ' SegWit profile requires a bech32 HRP');
		requireValue(profile.explorer && profile.explorer.tx && profile.explorer.addr && profile.explorer.block,
			code + ' explorer links are incomplete');
		requireValue(profile.api && profile.api.type && /^https?:\/\//.test(profile.api.base),
			code + ' API profile is incomplete');
		requireValue(profile.api.operator === 'spexex' || profile.api.operator === 'community',
			code + ' API operator must be spexex or community');
		requireValue(profile.swap && ((profile.swap.status === 'attested' || profile.swap.status === 'certified') || profile.swap.status === 'wallet-only'),
			code + ' swap status must be attested/certified or wallet-only');

		if(profile.swap.status !== 'attested' && profile.swap.status !== 'certified') return;
		var swap = profile.swap;
		requireValue(swap.transactionModel === 'bitcoin-utxo', code + ' is not a Bitcoin-style UTXO profile');
		requireValue(swap.curve === 'secp256k1' && swap.signature === 'ecdsa', code + ' signature scheme is incompatible');
		requireValue(swap.transactionFormat === 'bitcoin' && swap.escrow === 'p2sh-2of2', code + ' escrow format is incompatible');
		requireValue(swap.sighash === 'legacy-all', code + ' sighash adapter is not attested');
		requireValue(swap.timelock === 'nlocktime-height', code + ' absolute-height refund support is not attested');
		requireValue(swap.decimals === 8, code + ' must use eight base-unit decimals in the current engine');
		requireValue(positiveInteger(swap.blockSeconds), code + ' target block time is invalid');
		requireValue(swap.refundBlocks && positiveInteger(swap.refundBlocks.asset) && positiveInteger(swap.refundBlocks.payment),
			code + ' refund windows are incomplete');
		requireValue(swap.refundBlocks.asset * swap.blockSeconds > swap.refundBlocks.payment * swap.blockSeconds,
			code + ' asset refund must mature after its payment refund');
		requireValue(positiveInteger(swap.confirmations), code + ' confirmation policy is invalid');
		requireValue(swap.fees && validDecimal(swap.fees.claim, 8) && validDecimal(swap.fees.refund, 8) && validDecimal(swap.fees.funding, 8),
			code + ' canonical fees are incomplete');
		var policy = swap.policy;
		requireValue(policy, code + ' relay policy is missing');
		['feeRatePerByte', 'relayFloorPerByte', 'hardDustSats', 'softDustSats', 'dustSurchargeSats', 'changeThresholdSats'].forEach(function(field){
			requireValue(nonNegativeInteger(policy[field]), code + ' policy.' + field + ' is invalid');
		});
		requireValue(policy.hardDustSats > 0 && policy.changeThresholdSats >= policy.hardDustSats,
			code + ' dust/change policy is unsafe');
		requireValue((swap.attestation || swap.certification) && validDecimal((swap.attestation || swap.certification).testAmount, 8),
			code + ' attestation testAmount is missing');
		requireValue(typeof (swap.attestation || swap.certification).p2pkhVector === 'string' && (swap.attestation || swap.certification).p2pkhVector.length >= 26,
			code + ' independent P2PKH vector is missing');
		requireValue(typeof (swap.attestation || swap.certification).p2sh2of2Vector === 'string' && (swap.attestation || swap.certification).p2sh2of2Vector.length >= 26,
			code + ' independent P2SH 2-of-2 vector is missing');
	}

	function buildRegistry(sourceProfiles){
		var stored = clone(sourceProfiles);
		var codes = Object.keys(stored).sort();
		requireValue(codes.length > 0, 'no chain profiles');
		codes.forEach(function(code){ validateProfile(code, stored[code]); });

		/* An attested profile is exposed on either side of every pair. Validate
		   that its shipped role defaults are safe against every other attested
		   profile now, rather than allowing an apparently supported pair to fail
		   only when a user creates it. This mirrors the runtime's 30-minute (or
		   larger confirmation-window) action margin. */
		var attestedCodes = codes.filter(function(code){
			return stored[code].swap.status === 'attested' || stored[code].swap.status === 'certified';
		});
		attestedCodes.forEach(function(assetCode){
			attestedCodes.forEach(function(paymentCode){
				if(assetCode === paymentCode) return;
				var asset = stored[assetCode].swap;
				var payment = stored[paymentCode].swap;
				var assetSeconds = asset.refundBlocks.asset * asset.blockSeconds;
				var paymentSeconds = payment.refundBlocks.payment * payment.blockSeconds;
				var confirmationMargin = Math.max(
					asset.confirmations * asset.blockSeconds,
					payment.confirmations * payment.blockSeconds
				);
				var safetyMargin = Math.max(30 * 60, confirmationMargin);
				requireValue(assetSeconds > paymentSeconds + safetyMargin,
					assetCode + '/' + paymentCode + ' default refund windows are unsafe');
			});
		});

		function getProfile(code){
			var normalized = String(code || '').toUpperCase();
			if(!stored[normalized]) throw new Error('Unknown chain profile: ' + normalized);
			return clone(stored[normalized]);
		}

		function swapCodes(){
			return attestedCodes.slice(0);
		}

		function canonicalMarketKey(firstCode, secondCode){
			var first = String(firstCode || '').toUpperCase();
			var second = String(secondCode || '').toUpperCase();
			if(!stored[first] || !stored[second]) throw new Error('Unknown chain in market: ' + first + '/' + second);
			if(first === second) throw new Error('A market requires two distinct chains');
			return [first, second].sort().join('/');
		}

		function routeStatusForChain(code){
			var normalized = String(code || '').toUpperCase();
			if(!stored[normalized]) throw new Error('Unknown chain profile: ' + normalized);
			var operator = stored[normalized].api.operator;
			return {
				code: normalized,
				operator: operator,
				status: operator === 'spexex' ? 'attested-hosted' : 'community-run',
				label: operator === 'spexex' ? 'Attested route · SpeXex-hosted' : 'Community-run route · external server'
			};
		}

		function attestedRoutes(code){
			var normalized = String(code || '').toUpperCase();
			if(!stored[normalized]) throw new Error('Unknown chain profile: ' + normalized);
			if(stored[normalized].swap.status !== 'attested' && stored[normalized].swap.status !== 'certified') return [];
			return attestedCodes.filter(function(other){ return other !== normalized; }).map(function(other){
				var market = canonicalMarketKey(normalized, other);
				var parts = market.split('/');
				return {
					market: market,
					routes: [normalized + '/' + other, other + '/' + normalized],
					status: 'attested',
					legs: [routeStatusForChain(parts[0]), routeStatusForChain(parts[1])]
				};
			});
		}

		function walletNetworks(){
			var output = {};
			codes.forEach(function(code){
				var profile = stored[code];
				output[code] = {
					code: code,
					name: profile.name,
					shortName: profile.shortName,
					pub: profile.address.pub,
					priv: profile.address.priv,
					multisig: profile.address.multisig,
					hdkey: clone(profile.hdkey),
					bech32: clone(profile.bech32),
					segwit: profile.segwit !== false,
					uriPrefix: profile.uriPrefix,
					unit: profile.unit,
					explorer: clone(profile.explorer),
					apiType: profile.api.type,
					apiBase: profile.api.base,
					apiOperator: profile.api.operator,
					routeStatus: routeStatusForChain(code),
					swapStatus: profile.swap.status
				};
			});
			return output;
		}

		function swapDefinitions(){
			var output = {};
			swapCodes().forEach(function(code){
				var profile = stored[code];
				var swap = profile.swap;
				output[code] = {
					code: code,
					pub: profile.address.pub,
					priv: profile.address.priv,
					multisig: profile.address.multisig,
					bech32Hrp: profile.bech32.hrp,
					segwit: profile.segwit !== false,
					decimals: swap.decimals,
					apiUrl: profile.api.base,
					apiType: profile.api.type,
					refundBlocks: clone(swap.refundBlocks),
					confirmations: swap.confirmations,
					fees: clone(swap.fees)
				};
			});
			return output;
		}

		function swapPolicies(){
			var output = {};
			swapCodes().forEach(function(code){
				output[code] = clone(stored[code].swap.policy);
				output[code].blockSeconds = stored[code].swap.blockSeconds;
			});
			return output;
		}

		return {
			codes: function(){ return codes.slice(0); },
			swapCodes: swapCodes,
			getProfile: getProfile,
			profiles: function(){ return clone(stored); },
			canonicalMarketKey: canonicalMarketKey,
			routeStatusForChain: routeStatusForChain,
			attestedRoutes: attestedRoutes,
			verifiedRoutes: attestedRoutes,
			walletNetworks: walletNetworks,
			swapDefinitions: swapDefinitions,
			swapPolicies: swapPolicies,
			compile: buildRegistry
		};
	}

	return buildRegistry(PROFILES);
});
