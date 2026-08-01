/*
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 * Fork-specific OTC multi-chain helpers for the SpaceXpanse ROD wallet.
 */

(function(){
	var root = window.rodOtc = window.rodOtc || {};
	var chainsModule = root.chains = root.chains || {};

	if(!window.spexChainRegistry){
		throw new Error('SpeXex chain registry must load before otc-chains.js');
	}
	chainsModule.definitions = window.spexChainRegistry.swapDefinitions();

	/* One registry, one adapter contract. A coin can occupy either settlement
	   role in a swap; the offer decides the role, not a separate package. */
	chainsModule.codes = function(){
		var codes = [];
		for(var code in chainsModule.definitions){
			if(chainsModule.definitions.hasOwnProperty(code)) codes.push(code);
		}
		return codes.sort();
	};

	chainsModule.getDefinition = function(chainCode){
		return getDefinition(String(chainCode || '').toUpperCase());
	};

	chainsModule.getFees = function(chainCode){
		var definition = getDefinition(String(chainCode || '').toUpperCase());
		if(!definition.fees || !definition.fees.claim || !definition.fees.refund || !definition.fees.funding){
			throw new Error('No settlement fees registered for chain: ' + chainCode);
		}
		return definition.fees;
	};

	chainsModule.getRefundBlocks = function(chainCode, role){
		var definition = getDefinition(String(chainCode || '').toUpperCase());
		var settlementRole = String(role || '').toLowerCase();
		if(settlementRole !== 'asset' && settlementRole !== 'payment'){
			throw new Error('Refund role must be asset or payment');
		}
		var blocks = definition.refundBlocks && parseInt(definition.refundBlocks[settlementRole], 10);
		if(!(blocks > 0)) throw new Error('No ' + settlementRole + ' refund window registered for chain: ' + chainCode);
		return blocks;
	};

	/* ------------------------------------------------------------------
	   Per-chain relay / mining policy.

	   All values are in the chain's base unit (satoshi for ROD and LTC, koinu
	   for DOGE — both 1e-8 of a coin, so the arithmetic stays uniform).

	     feeRatePerByte       rate used to CONSTRUCT transactions
	     relayFloorPerByte    absolute minimum a node relays; used to VALIDATE
	     hardDustSats         an output below this makes the tx non-standard
	     softDustSats         legal but attracts a per-output surcharge (DOGE)
	     dustSurchargeSats    the surcharge added per soft-dust output
	     changeThresholdSats  change below this is dropped into the fee
	     blockSeconds         target spacing, to convert a wall-clock refund
	                          timeout into a block count

	   Dogecoin's values come from src/policy/policy.h, src/validation.h and
	   src/dogecoin-fees.cpp at v1.14.6+:
	     RECOMMENDED_MIN_TX_FEE   = COIN/100 = 0.01  DOGE/kB = 1000 koinu/B
	     DEFAULT_MIN_RELAY_TX_FEE = REC/10   = 0.001 DOGE/kB =  100 koinu/B
	     DEFAULT_BLOCK_MIN_TX_FEE = REC      = 0.01  DOGE/kB
	     DEFAULT_HARD_DUST_LIMIT  = 100000 koinu  (0.001 DOGE)
	     DEFAULT_DUST_LIMIT(soft) = 1000000 koinu (0.01 DOGE)

	   We CONSTRUCT at the block-min rate (1000 koinu/B) rather than the relay
	   floor: a transaction paying only the floor still propagates, but every
	   miner running the default -blockmintxfee skips it, so it can sit
	   unconfirmed past a swap's refund deadline — which is a fund-loss risk,
	   not merely a delay.

	   Unlike Bitcoin, Dogecoin dust is an ABSOLUTE amount — see
	   CTxOut::IsDust(dustLimit) in src/primitives/transaction.h. It is not
	   derived from a fee rate, so it cannot be paid away by bidding higher.

	   ROD keeps feeRatePerByte 0, meaning "use the caller-supplied fee
	   verbatim". The ROD default term fees already clear its ~232 sat/B
	   mainnet relay floor, and 0 preserves existing ROD behaviour exactly. */
	chainsModule.policy = window.spexChainRegistry.swapPolicies();

	/* Throws rather than defaulting. Falling back to ROD's policy would mean a
	   newly registered chain silently inherits "no fee floor, 546-unit dust",
	   turning every relay and dust check below into a no-op — the exact failure
	   the policy table exists to prevent. */
	chainsModule.getPolicy = function(chainCode){
		var policy = chainsModule.policy[chainCode];
		if(!policy){
			throw new Error('No relay policy registered for chain: ' + chainCode);
		}
		return policy;
	};

	/* Smallest output worth creating on a chain. Above the hard dust limit an
	   output is merely legal; above the SOFT limit it is also free of the flat
	   per-output surcharge Dogecoin adds to the relay minimum. Settlement fees
	   are canonical and fixed, so an output between the two limits can make the
	   required fee exceed the fee the terms already committed to — the swap
	   would then be unsignable. Gate swap creation on this, not on hard dust. */
	chainsModule.minEconomicalOutputSats = function(chainCode){
		var policy = chainsModule.getPolicy(chainCode);
		return Math.max(policy.hardDustSats, policy.softDustSats);
	};

	/* Minimum fee a node accepts for a transaction of the given size with the
	   given output values, in base units. Mirrors GetDogecoinMinRelayFee(): a
	   size-proportional component plus a flat surcharge per soft-dust output.
	   Returns 0 for chains with no configured floor (ROD). */
	chainsModule.minRelayFeeSats = function(chainCode, sizeBytes, outputValuesSats){
		var policy = chainsModule.getPolicy(chainCode);
		var fee = Math.ceil((parseInt(sizeBytes, 10) || 0) * policy.relayFloorPerByte);
		if(policy.dustSurchargeSats > 0 && outputValuesSats && outputValuesSats.length){
			for(var index = 0; index < outputValuesSats.length; index++){
				if(outputValuesSats[index] < policy.softDustSats){
					fee += policy.dustSurchargeSats;
				}
			}
		}
		return fee;
	};

	/* An output below the hard dust limit makes the whole transaction
	   non-standard, so it can never relay. Checked before every broadcast. */
	chainsModule.isHardDust = function(chainCode, valueSats){
		return (parseInt(valueSats, 10) || 0) < chainsModule.getPolicy(chainCode).hardDustSats;
	};

	chainsModule.supportsSegwit = function(chainCode){
		var definition = chainsModule.definitions[chainCode];
		return !!definition && definition.segwit !== false;
	};

	function getDefinition(chainCode){
		var definition = chainsModule.definitions[chainCode];
		if(!definition){
			throw new Error('Unsupported OTC chain: ' + chainCode);
		}
		return definition;
	}

	chainsModule.withChain = function(chainCode, callback){
		var previousNetworkCode = coinjs.activeNetwork || 'ROD';
		try {
			coinjs.setNetwork(chainCode);
			return callback(getDefinition(chainCode));
		} finally {
			coinjs.setNetwork(previousNetworkCode);
		}
	};

	chainsModule.decimalToSats = function(amount){
		var text = String(amount == null ? '0' : amount).replace(/^\s+|\s+$/g, '');
		if(!/^\d+(\.\d{0,8})?$/.test(text)){
			throw new Error('Invalid decimal amount: ' + text);
		}
		var parts = text.split('.');
		var whole = parts[0].replace(/^0+(?=\d)/, '') || '0';
		var fraction = (parts[1] || '').slice(0, 8);
		while(fraction.length < 8){
			fraction += '0';
		}
		var sats = parseInt(whole, 10) * 100000000 + parseInt(fraction || '0', 10);
		if(!isFinite(sats) || sats < 0 || Math.floor(sats) !== sats || sats > 9007199254740991){
			throw new Error('Amount is outside safe integer range: ' + text);
		}
		return sats;
	};

	chainsModule.satsToDecimal = function(sats){
		var value = parseInt(sats, 10);
		if(!isFinite(value) || value < 0){
			throw new Error('Invalid satoshi amount: ' + sats);
		}
		var whole = Math.floor(value / 100000000);
		var fraction = String(value % 100000000);
		while(fraction.length < 8){
			fraction = '0' + fraction;
		}
		return whole + '.' + fraction;
	};

	chainsModule.getWalletMaterialForChain = function(wif, chainCode){
		return chainsModule.withChain(chainCode, function(){
			var privateKey = coinjs.wif2privkey(wif);
			var publicKey = coinjs.wif2pubkey(wif);
			var address = coinjs.wif2address(wif);
			return {
				chainCode: chainCode,
				wif: wif,
				privkey: privateKey.privkey,
				pubkey: publicKey.pubkey,
				address: address.address
			};
		});
	};

	function hash160(hexValue){
		return ripemd160(Crypto.SHA256(Crypto.util.hexToBytes(hexValue), {asBytes: true}), {asBytes: true});
	}

	function base58WithVersion(versionByte, payloadBytes){
		var addressBytes = [versionByte].concat(payloadBytes);
		var checksum = Crypto.SHA256(Crypto.SHA256(addressBytes, {asBytes: true}), {asBytes: true}).slice(0, 4);
		return coinjs.base58encode(addressBytes.concat(checksum));
	}

	function bech32Address(chainDefinition, publicKeyHex){
		var witnessProgram = hash160(publicKeyHex);
		return coinjs.bech32_encode(chainDefinition.bech32Hrp, [coinjs.bech32.version].concat(coinjs.bech32_convert(witnessProgram, 8, 5, true)));
	}

	chainsModule.publicKeyToAddress = function(chainCode, publicKeyHex, addressType){
		var chainDefinition = getDefinition(chainCode);
		var normalizedType = addressType || 'legacy';
		if(normalizedType === 'bech32'){
			/* Dogecoin has no SegWit and no bech32 — a "doge1…" address would
			   encode cleanly here but nothing on mainnet would ever accept it,
			   so fail loudly rather than hand back unspendable funds. */
			if(chainDefinition.segwit === false){
				throw new Error(chainCode + ' does not support bech32/SegWit addresses');
			}
			return bech32Address(chainDefinition, publicKeyHex);
		}
		return base58WithVersion(chainDefinition.pub, hash160(publicKeyHex));
	};

	chainsModule.publicKeysToMultisig = function(chainCode, publicKeys, requiredSignatures){
		var chainDefinition = getDefinition(chainCode);
		var script = coinjs.script();
		script.writeOp(81 + (requiredSignatures * 1) - 1);
		for(var index = 0; index < publicKeys.length; index++){
			script.writeBytes(Crypto.util.hexToBytes(publicKeys[index]));
		}
		script.writeOp(81 + publicKeys.length - 1);
		script.writeOp(174);
		var scriptHash = ripemd160(Crypto.SHA256(script.buffer, {asBytes: true}), {asBytes: true});
		return {
			address: base58WithVersion(chainDefinition.multisig, scriptHash),
			redeemScript: Crypto.util.bytesToHex(script.buffer),
			scriptHashHex: Crypto.util.bytesToHex(scriptHash),
			required: requiredSignatures,
			pubkeys: publicKeys.slice(0)
		};
	};

	chainsModule.amountToBaseUnits = function(amountString){
		return String(chainsModule.decimalToSats(amountString));
	};

	chainsModule.planFunding = function(chainCode, publicKeys, requiredSignatures, amountString){
		var multisig = chainsModule.publicKeysToMultisig(chainCode, publicKeys, requiredSignatures);
		return {
			chainCode: chainCode,
			amount: amountString,
			amountBaseUnits: chainsModule.amountToBaseUnits(amountString),
			multisigAddress: multisig.address,
			redeemScript: multisig.redeemScript,
			scriptHashHex: multisig.scriptHashHex,
			proofId: Crypto.util.bytesToHex(Crypto.SHA256(Crypto.util.hexToBytes(multisig.redeemScript + Crypto.util.bytesToHex(Crypto.charenc.UTF8.stringToBytes(amountString))), {asBytes: true}))
		};
	};

	chainsModule.planClaim = function(chainCode, sourceMultisig, destinationAddress, amountString, feeString){
		var summary = [chainCode, sourceMultisig.redeemScript, destinationAddress, amountString, feeString || '0'].join('|');
		return {
			chainCode: chainCode,
			sourceAddress: sourceMultisig.multisigAddress,
			sourceRedeemScript: sourceMultisig.redeemScript,
			destinationAddress: destinationAddress,
			amount: amountString,
			fee: feeString || '0',
			planningHash: Crypto.util.bytesToHex(Crypto.SHA256(Crypto.charenc.UTF8.stringToBytes(summary), {asBytes: true}))
		};
	};

	chainsModule.testAgainstRodGlobals = function(){
		/* Save and restore the active network so this test works regardless of
		   which coin the user has selected in the Settings tab. */
		var previousNetwork = coinjs.activeNetwork || 'ROD';
		coinjs.setNetwork('ROD');

		var fixturePublicKey = '02cc2d342f2e3e6d013e19f9e5c1637e7e64d07d8a0caa13a4509198e882afb1f3';
		var rodAddress = chainsModule.publicKeyToAddress('ROD', fixturePublicKey, 'legacy');
		var expectedRodAddress = coinjs.pubkey2address(fixturePublicKey);
		var beforeGlobals = JSON.stringify({pub: coinjs.pub, priv: coinjs.priv, multisig: coinjs.multisig, hrp: coinjs.bech32.hrp});
		var ltcAddress = chainsModule.publicKeyToAddress('LTC', fixturePublicKey, 'legacy');
		var dogeAddress = chainsModule.publicKeyToAddress('DOGE', fixturePublicKey, 'legacy');
		var afterGlobals = JSON.stringify({pub: coinjs.pub, priv: coinjs.priv, multisig: coinjs.multisig, hrp: coinjs.bech32.hrp});

		/* Dogecoin vectors generated independently with bitcoinjs-lib +
		   @noble/curves against dogecoin/dogecoin chainparams (pubKeyHash 0x1e,
		   scriptHash 0x16) from the well-known secp256k1 scalars 1 and 2. If
		   these ever stop matching, the DOGE version bytes have drifted and
		   every DOGE address the wallet produces would be unspendable. */
		var vectorKey1 = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
		var vectorKey2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
		var vectorP2pkh = chainsModule.publicKeyToAddress('DOGE', vectorKey1, 'legacy');
		var vectorMultisig = chainsModule.publicKeysToMultisig('DOGE', [vectorKey1, vectorKey2], 2);
		var vectorsMatch = vectorP2pkh === 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE'
			&& vectorMultisig.address === '9tAfWptDmGyYyFjKKr5VpApUKzq9hFpBJ1'
			&& vectorMultisig.redeemScript === '52210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f817982102c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee552ae';
		var registryVectorsMatch = true;
		var failedRegistryVector = '';
		chainsModule.codes().forEach(function(code){
			var certification = window.spexChainRegistry.getProfile(code).swap.certification;
			var p2pkh = chainsModule.publicKeyToAddress(code, vectorKey1, 'legacy');
			var p2sh = chainsModule.publicKeysToMultisig(code, [vectorKey1, vectorKey2], 2).address;
			if(p2pkh !== certification.p2pkhVector || p2sh !== certification.p2sh2of2Vector){
				registryVectorsMatch = false;
				failedRegistryVector = code;
			}
		});

		/* Dogecoin has no SegWit, so requesting a bech32 address must fail
		   rather than silently mint an address no node will ever accept. */
		var dogeBech32Rejected = false;
		try {
			chainsModule.publicKeyToAddress('DOGE', fixturePublicKey, 'bech32');
		} catch(bech32Error){
			dogeBech32Rejected = true;
		}

		var policySane = chainsModule.getPolicy('DOGE').hardDustSats === 100000
			&& chainsModule.minRelayFeeSats('DOGE', 300, [50000000]) === 30000
			/* one soft-dust output adds exactly one 0.01 DOGE surcharge */
			&& chainsModule.minRelayFeeSats('DOGE', 300, [500000]) === 1030000
			&& chainsModule.minRelayFeeSats('LTC', 300, [500000]) === 300;

		/* Restore the original network before returning */
		coinjs.setNetwork(previousNetwork);

		return {
			name: 'Immutable chain helpers',
			passed: rodAddress === expectedRodAddress && beforeGlobals === afterGlobals
				&& ltcAddress !== rodAddress && dogeAddress !== rodAddress && dogeAddress !== ltcAddress
				&& dogeAddress.charAt(0) === 'D'
				&& vectorsMatch && registryVectorsMatch && dogeBech32Rejected && policySane,
			rodAddress: rodAddress,
			expectedRodAddress: expectedRodAddress,
			ltcAddress: ltcAddress,
			dogeAddress: dogeAddress,
			dogeVectorsMatch: vectorsMatch,
			registryVectorsMatch: registryVectorsMatch,
			failedRegistryVector: failedRegistryVector,
			dogeBech32Rejected: dogeBech32Rejected,
			dogePolicySane: policySane,
			globalsStable: beforeGlobals === afterGlobals
		};
	};
})();
