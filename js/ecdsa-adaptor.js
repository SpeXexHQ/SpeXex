/*
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 * Fork-specific OTC adaptor-signature module for SpeXex.
 */

(function(){
	var root = window.rodOtc = window.rodOtc || {};
	var ecdsaHelpers = coinjs.ecdsa;
	var adaptorModule = root.adaptor = root.adaptor || {};
	var curve = ecdsaHelpers.getCurve();
	var order = ecdsaHelpers.getOrder();
	var generatorPoint = curve.getG();

	function asBytes(value){
		if(coinjs.isArray(value)){
			return value.slice(0);
		}
		return ecdsaHelpers.hexToBytes(value || '');
	}

	function asPoint(value){
		return (typeof value === 'string') ? ecdsaHelpers.pointFromHex(value) : value;
	}

	function asScalar(value){
		if(value instanceof BigInteger){
			return value;
		}
		if(typeof value === 'string'){
			return ecdsaHelpers.scalarFromHex(value);
		}
		return BigInteger.fromByteArrayUnsigned(value || []);
	}

	function scalarBytes(scalarValue){
		return ecdsaHelpers.fixedBytes(scalarValue.toByteArrayUnsigned(), 32);
	}

	function pointBytes(pointValue){
		return pointValue.getEncoded(true);
	}

	function bytesEqual(leftBytes, rightBytes){
		if(leftBytes.length !== rightBytes.length){
			return false;
		}
		for(var index = 0; index < leftBytes.length; index++){
			if(leftBytes[index] !== rightBytes[index]){
				return false;
			}
		}
		return true;
	}

	function sha256Hex(value){
		return Crypto.util.bytesToHex(coinjs.sha256(Crypto.charenc.UTF8.stringToBytes(value)));
	}

	function nonceChallengeBytes(adaptorPoint, noncePoint, encryptedNoncePoint, firstProofPoint, secondProofPoint){
		return pointBytes(generatorPoint)
			.concat(pointBytes(adaptorPoint))
			.concat(pointBytes(noncePoint))
			.concat(pointBytes(encryptedNoncePoint))
			.concat(pointBytes(firstProofPoint))
			.concat(pointBytes(secondProofPoint));
	}

	function deterministicProofNonce(options){
		var proofSeedBytes = scalarBytes(options.nonce)
			.concat(pointBytes(options.adaptorPoint))
			.concat(pointBytes(options.noncePoint))
			.concat(pointBytes(options.encryptedNoncePoint))
			.concat(asBytes(options.auxiliaryRandomness || coinjs.newPrivkey()));
		var proofNonce = BigInteger.fromByteArrayUnsigned(coinjs.taggedHash('DLEQ', proofSeedBytes)).mod(order);
		return proofNonce.compareTo(BigInteger.ZERO) <= 0 ? BigInteger.ONE : proofNonce;
	}

	coinjs.dleq = coinjs.dleq || {};
	coinjs.adaptor = coinjs.adaptor || {};

	coinjs.dleq.prove = function(options){
		var adaptorPoint = asPoint(options.adaptorPoint);
		var noncePoint = asPoint(options.noncePoint);
		var encryptedNoncePoint = asPoint(options.encryptedNoncePoint);
		var nonceScalar = asScalar(options.nonce);
		var proofNonce = deterministicProofNonce({
			nonce: nonceScalar,
			adaptorPoint: adaptorPoint,
			noncePoint: noncePoint,
			encryptedNoncePoint: encryptedNoncePoint,
			auxiliaryRandomness: options.auxiliaryRandomness
		});
		var firstProofPoint = generatorPoint.multiply(proofNonce);
		var secondProofPoint = adaptorPoint.multiply(proofNonce);
		var challenge = BigInteger.fromByteArrayUnsigned(coinjs.taggedHash('DLEQ', nonceChallengeBytes(adaptorPoint, noncePoint, encryptedNoncePoint, firstProofPoint, secondProofPoint))).mod(order);
		var response = proofNonce.add(challenge.multiply(nonceScalar)).mod(order);
		return {
			challenge: challenge,
			response: response,
			challengeHex: ecdsaHelpers.scalarToHex(challenge),
			responseHex: ecdsaHelpers.scalarToHex(response)
		};
	};

	coinjs.dleq.verify = function(options){
		var adaptorPoint = asPoint(options.adaptorPoint);
		var noncePoint = asPoint(options.noncePoint);
		var encryptedNoncePoint = asPoint(options.encryptedNoncePoint);
		var challenge = asScalar(options.challenge);
		var response = asScalar(options.response);
		var firstProofPoint = generatorPoint.multiply(response).add(noncePoint.multiply(challenge).negate());
		var secondProofPoint = adaptorPoint.multiply(response).add(encryptedNoncePoint.multiply(challenge).negate());
		var expectedChallenge = BigInteger.fromByteArrayUnsigned(coinjs.taggedHash('DLEQ', nonceChallengeBytes(adaptorPoint, noncePoint, encryptedNoncePoint, firstProofPoint, secondProofPoint))).mod(order);
		return expectedChallenge.equals(challenge);
	};

	coinjs.adaptor.serialize = function(signatureObject){
		return pointBytes(signatureObject.R)
			.concat(pointBytes(signatureObject.RPrime))
			.concat(scalarBytes(signatureObject.sPrime))
			.concat(scalarBytes(signatureObject.challenge))
			.concat(scalarBytes(signatureObject.response));
	};

	coinjs.adaptor.deserialize = function(signatureBytes){
		var normalizedBytes = coinjs.isArray(signatureBytes) ? signatureBytes.slice(0) : ecdsaHelpers.hexToBytes(signatureBytes);
		if(normalizedBytes.length !== 162){
			throw new Error('Adaptor signature must be exactly 162 bytes');
		}
		return {
			R: ecdsaHelpers.pointFromHex(Crypto.util.bytesToHex(normalizedBytes.slice(0, 33))),
			RPrime: ecdsaHelpers.pointFromHex(Crypto.util.bytesToHex(normalizedBytes.slice(33, 66))),
			sPrime: BigInteger.fromByteArrayUnsigned(normalizedBytes.slice(66, 98)),
			challenge: BigInteger.fromByteArrayUnsigned(normalizedBytes.slice(98, 130)),
			response: BigInteger.fromByteArrayUnsigned(normalizedBytes.slice(130, 162))
		};
	};

	coinjs.adaptor.generateSecret = function(){
		return coinjs.newPrivkey();
	};

	coinjs.adaptor.publicKey = function(secretHex){
		return ecdsaHelpers.publicKeyFromPrivate(secretHex, true);
	};

	coinjs.adaptor.encrypt = function(options){
		var messageHashBytes = asBytes(options.messageHash);
		var signingPrivateKeyHex = options.signingPrivateKey;
		var adaptorPoint = asPoint(options.adaptorPublicKey);
		var nonceScalar = coinjs.adaptorNonce({
			signingPrivateKey: signingPrivateKeyHex,
			adaptorPublicKey: ecdsaHelpers.pointToHex(adaptorPoint),
			messageHash: messageHashBytes,
			auxiliaryRandomness: options.auxiliaryRandomness || coinjs.newPrivkey()
		});
		var noncePoint = generatorPoint.multiply(nonceScalar);
		var encryptedNoncePoint = adaptorPoint.multiply(nonceScalar);
		var signingScalar = ecdsaHelpers.scalarFromHex(signingPrivateKeyHex);
		var messageScalar = ecdsaHelpers.hashToScalar(messageHashBytes);
		var rValue = encryptedNoncePoint.getX().toBigInteger().mod(order);
		if(rValue.compareTo(BigInteger.ZERO) <= 0){
			throw new Error('Invalid adaptor signature r value');
		}
		var sPrime = nonceScalar.modInverse(order).multiply(messageScalar.add(rValue.multiply(signingScalar))).mod(order);
		if(sPrime.compareTo(BigInteger.ZERO) <= 0){
			throw new Error('Invalid adaptor signature sPrime value');
		}
		var proof = coinjs.dleq.prove({
			nonce: nonceScalar,
			noncePoint: noncePoint,
			adaptorPoint: adaptorPoint,
			encryptedNoncePoint: encryptedNoncePoint,
			auxiliaryRandomness: options.auxiliaryRandomness || coinjs.newPrivkey()
		});
		var adaptorSignatureObject = {
			R: encryptedNoncePoint,
			RPrime: noncePoint,
			sPrime: sPrime,
			challenge: proof.challenge,
			response: proof.response
		};
		var serializedBytes = coinjs.adaptor.serialize(adaptorSignatureObject);
		return {
			bytes: serializedBytes,
			hex: Crypto.util.bytesToHex(serializedBytes),
			object: adaptorSignatureObject
		};
	};

	coinjs.adaptor.verify = function(options){
		var messageHashBytes = asBytes(options.messageHash);
		var adaptorPoint = asPoint(options.adaptorPublicKey);
		var signingPublicPoint = asPoint(options.signingPublicKey);
		var adaptorSignatureObject = (options.adaptorSignature && options.adaptorSignature.R) ? options.adaptorSignature : coinjs.adaptor.deserialize(options.adaptorSignature);
		if(!coinjs.dleq.verify({
			noncePoint: adaptorSignatureObject.RPrime,
			adaptorPoint: adaptorPoint,
			encryptedNoncePoint: adaptorSignatureObject.R,
			challenge: adaptorSignatureObject.challenge,
			response: adaptorSignatureObject.response
		})){
			return false;
		}
		var rValue = adaptorSignatureObject.R.getX().toBigInteger().mod(order);
		if(rValue.compareTo(BigInteger.ZERO) <= 0 || adaptorSignatureObject.sPrime.compareTo(BigInteger.ZERO) <= 0){
			return false;
		}
		var inverseSPrime = adaptorSignatureObject.sPrime.modInverse(order);
		var messageScalar = ecdsaHelpers.hashToScalar(messageHashBytes);
		var u1 = messageScalar.multiply(inverseSPrime).mod(order);
		var u2 = rValue.multiply(inverseSPrime).mod(order);
		var verificationPoint = generatorPoint.multiply(u1).add(signingPublicPoint.multiply(u2));
		return verificationPoint.equals(adaptorSignatureObject.RPrime);
	};

	coinjs.adaptor.complete = function(options){
		var adaptorSignatureObject = (options.adaptorSignature && options.adaptorSignature.R) ? options.adaptorSignature : coinjs.adaptor.deserialize(options.adaptorSignature);
		var adaptorSecret = asScalar(options.adaptorSecret);
		var rValue = adaptorSignatureObject.R.getX().toBigInteger().mod(order);
		var sValue = adaptorSignatureObject.sPrime.multiply(adaptorSecret.modInverse(order)).mod(order);
		sValue = ecdsaHelpers.normalizeLowS(sValue);
		return {
			bytes: ecdsaHelpers.serializeDER(rValue, sValue),
			hex: Crypto.util.bytesToHex(ecdsaHelpers.serializeDER(rValue, sValue)),
			r: rValue,
			s: sValue
		};
	};

	coinjs.adaptor.recover = function(options){
		var adaptorSignatureObject = (options.adaptorSignature && options.adaptorSignature.R) ? options.adaptorSignature : coinjs.adaptor.deserialize(options.adaptorSignature);
		var completedSignature = ecdsaHelpers.parseDER(options.completedSignature);
		var adaptorPoint = asPoint(options.adaptorPublicKey);
		var recoveredCandidate = adaptorSignatureObject.sPrime.multiply(completedSignature.s.modInverse(order)).mod(order);
		var alternateCandidate = order.subtract(recoveredCandidate).mod(order);
		var recoveredPoint = generatorPoint.multiply(recoveredCandidate);
		if(recoveredPoint.equals(adaptorPoint)){
			return ecdsaHelpers.scalarToHex(recoveredCandidate);
		}
		var alternatePoint = generatorPoint.multiply(alternateCandidate);
		if(alternatePoint.equals(adaptorPoint)){
			return ecdsaHelpers.scalarToHex(alternateCandidate);
		}
		throw new Error('Unable to recover adaptor secret for the provided public key');
	};

	adaptorModule.testVectors = function(){
		var signingPrivateKey = '1f1e1d1c1b1a19181716151413121110112233445566778899aabbccddeeff00';
		var adaptorSecret = '0f0e0d0c0b0a09080706050403020100ffeeddccbbaa99887766554433221111';
		var adaptorPoint = coinjs.adaptor.publicKey(adaptorSecret);
		var signingPublicKey = ecdsaHelpers.publicKeyFromPrivate(signingPrivateKey, true);
		var messageHash = sha256Hex('rod-otc-deterministic-fixture');
		var auxiliaryRandomness = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
		var encrypted = coinjs.adaptor.encrypt({
			messageHash: messageHash,
			signingPrivateKey: signingPrivateKey,
			adaptorPublicKey: adaptorPoint,
			auxiliaryRandomness: auxiliaryRandomness
		});
		var verified = coinjs.adaptor.verify({
			messageHash: messageHash,
			signingPublicKey: signingPublicKey,
			adaptorPublicKey: adaptorPoint,
			adaptorSignature: encrypted.bytes
		});
		var completed = coinjs.adaptor.complete({
			adaptorSignature: encrypted.bytes,
			adaptorSecret: adaptorSecret
		});
		var recovered = coinjs.adaptor.recover({
			adaptorSignature: encrypted.bytes,
			completedSignature: completed.bytes,
			adaptorPublicKey: adaptorPoint
		});
		return {
			encryptedHex: encrypted.hex,
			verified: verified,
			completedHex: completed.hex,
			recoveredSecret: recovered,
			expectedSecret: adaptorSecret,
			passed: verified && recovered === adaptorSecret
		};
	};

	adaptorModule.randomizedValidation = function(iterations){
		var totalIterations = iterations || 3;
		var results = [];
		for(var index = 0; index < totalIterations; index++){
			var signingPrivateKey = coinjs.newPrivkey();
			var adaptorSecret = coinjs.newPrivkey();
			var adaptorPoint = coinjs.adaptor.publicKey(adaptorSecret);
			var signingPublicKey = ecdsaHelpers.publicKeyFromPrivate(signingPrivateKey, true);
			var messageHash = sha256Hex('rod-otc-random-fixture-' + index + '-' + coinjs.random(8));
			var encrypted = coinjs.adaptor.encrypt({
				messageHash: messageHash,
				signingPrivateKey: signingPrivateKey,
				adaptorPublicKey: adaptorPoint,
				auxiliaryRandomness: coinjs.newPrivkey()
			});
			var verified = coinjs.adaptor.verify({
				messageHash: messageHash,
				signingPublicKey: signingPublicKey,
				adaptorPublicKey: adaptorPoint,
				adaptorSignature: encrypted.bytes
			});
			var completed = coinjs.adaptor.complete({
				adaptorSignature: encrypted.bytes,
				adaptorSecret: adaptorSecret
			});
			var recovered = coinjs.adaptor.recover({
				adaptorSignature: encrypted.bytes,
				completedSignature: completed.bytes,
				adaptorPublicKey: adaptorPoint
			});
			results.push({
				verified: verified,
				recoveredMatches: recovered === adaptorSecret,
				completedHex: completed.hex
			});
		}
		return results;
	};

	adaptorModule.runValidation = function(){
		var deterministic = adaptorModule.testVectors();
		var randomized = adaptorModule.randomizedValidation(4);
		var randomizedPassed = true;
		for(var index = 0; index < randomized.length; index++){
			if(!randomized[index].verified || !randomized[index].recoveredMatches){
				randomizedPassed = false;
			}
		}
		return {
			name: 'ECDSA adaptor primitives',
			passed: deterministic.passed && randomizedPassed,
			deterministic: deterministic,
			randomized: randomized
		};
	};
})();
