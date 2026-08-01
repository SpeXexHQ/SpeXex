/*
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 * Fork-specific OTC swap-state helpers for the SpaceXpanse ROD wallet.
 */

(function(){
	var root = window.rodOtc = window.rodOtc || {};
	var swapModule = root.swap = root.swap || {};
	var STORAGE = root.storage;
	var CHAINS = root.chains;
	var NOSTR = root.nostr;
	var ADAPTOR = root.adaptor;
	var ALLOWED_TRANSITIONS = {
		OPEN: ['NEGOTIATING'],
		NEGOTIATING: ['TERMS_ACCEPTED'],
		TERMS_ACCEPTED: ['REFUNDS_READY'],
		REFUNDS_READY: ['SIGNATURES_EXCHANGED'],
		SIGNATURES_EXCHANGED: ['PREPARED'],
		PREPARED: ['ASSET_FUNDED'],
		ASSET_FUNDED: ['PAYMENT_FUNDED'],
		PAYMENT_FUNDED: ['READY'],
		READY: ['PAYMENT_CLAIMED'],
		PAYMENT_CLAIMED: ['SECRET_RECOVERED'],
		SECRET_RECOVERED: ['ASSET_CLAIMED'],
		ASSET_CLAIMED: ['COMPLETE'],
		COMPLETE: []
	};
	/* Refund outcomes sit outside the linear happy path: a swap can divert to
	   a refund from several states, so they are entered via markRefundState()
	   rather than advanceState(). PARTIALLY_SETTLED records one output claimed
	   while the other was refunded. */
	var REFUND_STATES = {
		ASSET_REFUND_BROADCAST: true,
		PAYMENT_REFUND_BROADCAST: true,
		ASSET_REFUNDED: true,
		PAYMENT_REFUNDED: true,
		REFUNDED: true,
		PARTIALLY_SETTLED: true
	};
	swapModule.REFUND_STATES = REFUND_STATES;
	swapModule.markRefundState = function(session, refundState, note){
		if(!REFUND_STATES[refundState]){
			throw new Error('Unknown refund state: ' + refundState);
		}
		if(session.state === 'COMPLETE') return session;
		session.state = refundState;
		session.timeline = session.timeline || [];
		session.timeline.push({ state: refundState, at: new Date().toISOString(), note: note || '' });
		var state = getState();
		state.sessions[session.swapId] = session;
		saveState(state);
		return session;
	};

	function stableStringify(value){
		if(value === null || typeof value !== 'object'){
			return JSON.stringify(value);
		}
		if(coinjs.isArray(value)){
			var arrayValues = [];
			for(var arrayIndex = 0; arrayIndex < value.length; arrayIndex++){
				arrayValues.push(stableStringify(value[arrayIndex]));
			}
			return '[' + arrayValues.join(',') + ']';
		}
		var keys = [];
		for(var propertyName in value){
			if(value.hasOwnProperty(propertyName)){
				keys.push(propertyName);
			}
		}
		keys.sort();
		var keyValuePairs = [];
		for(var keyIndex = 0; keyIndex < keys.length; keyIndex++){
			keyValuePairs.push(JSON.stringify(keys[keyIndex]) + ':' + stableStringify(value[keys[keyIndex]]));
		}
		return '{' + keyValuePairs.join(',') + '}';
	}

	function sha256Hex(value){
		return Crypto.util.bytesToHex(Crypto.SHA256(Crypto.charenc.UTF8.stringToBytes(value), {asBytes: true}));
	}

	function escapeHtml(value){
		return String(value || '').replace(/[&<>'"]/g, function(character){
			return {'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character];
		});
	}

	function getState(){
		return STORAGE.load();
	}

	function saveState(state){
		return STORAGE.save(state);
	}

	function sessionById(swapId){
		return getState().sessions[swapId] || null;
	}

	swapModule.createSwapAccount = function(passphrase){
		if(!passphrase){
			throw new Error('Swap account passphrase is required');
		}
		var master = coinjs.hd().master('rod-otc-swap|' + passphrase);
		return {
			xprv: master.privkey,
			xpub: master.pubkey
		};
	};

	/* 5-field swap identifier: order ID, offer revision, seller identity,
	   buyer identity, and a per-swap random nonce chosen by the initiator.
	   The nonce plays the role of the plan's "acceptance event ID" (the terms
	   are created before the acceptance event exists in the auto-negotiation
	   flow) and guarantees uniqueness across repeat trades of the same order. */
	swapModule.swapIdFromOrder = function(orderName, orderRevision, sellerIdentity, buyerIdentity, swapNonce){
		return sha256Hex([orderName || '', orderRevision || '', sellerIdentity || '', buyerIdentity || '', swapNonce || ''].join('|'));
	};

	swapModule.childIndexFromSwapId = function(swapId){
		var hashBytes = Crypto.SHA256(Crypto.util.hexToBytes(swapId), {asBytes: true});
		return ((hashBytes[0] << 24) | (hashBytes[1] << 16) | (hashBytes[2] << 8) | hashBytes[3]) & 0x7fffffff;
	};

	function hdNodeFromAccountKey(swapAccountKey){
		if(!swapAccountKey || typeof swapAccountKey !== 'string'){
			throw new Error('Swap account key is missing or invalid');
		}
		var node = coinjs.hd(swapAccountKey);
		if(!node || !node.keys || !node.keys.pubkey){
			throw new Error('Unable to parse swap account key (expected xprv/xpub)');
		}
		return node;
	}

	function accountXpub(swapAccountKey){
		var node = hdNodeFromAccountKey(swapAccountKey);
		if(node.type === 'public'){
			return swapAccountKey;
		}
		if(node.keys_extended && node.keys_extended.pubkey){
			return node.keys_extended.pubkey;
		}
		/* Rebuild xpub at same depth via make */
		var encoded = coinjs.hd().make({
			depth: node.depth,
			parent_fingerprint: node.parent_fingerprint,
			child_index: node.child_index,
			chain_code: node.chain_code,
			pubkey: node.keys.pubkey
		});
		if(!encoded || !encoded.pubkey){
			throw new Error('Unable to export swap account xpub');
		}
		return encoded.pubkey;
	}

	swapModule.deriveSwapKeys = function(swapAccountKey, childIndex){
		var account = hdNodeFromAccountKey(swapAccountKey);
		var derivedHd = account.derive(childIndex);
		if(!derivedHd || !derivedHd.keys || !derivedHd.keys.pubkey){
			throw new Error('HD child derivation failed for index ' + childIndex);
		}
		var ext = derivedHd.keys_extended || {};
		return {
			childIndex: childIndex,
			xpub: ext.pubkey || '',
			xprv: ext.privkey || '',
			publicKey: derivedHd.keys.pubkey,
			privateKeyWif: derivedHd.keys.wif || '',
			privateKeyHex: derivedHd.keys.privkey || ''
		};
	};

	/* Every settlement coin lives in the same chain registry. Asset/payment are
	   per-swap roles, not separate implementations or packages. */
	swapModule.PROTOCOL_VERSION = 2;
	swapModule.DEFAULT_ASSET_CHAIN = 'ROD';
	swapModule.DEFAULT_PAYMENT_CHAIN = 'LTC';
	swapModule.chainFees = function(chainCode){ return CHAINS.getFees(chainCode); };
	/* A block-height comparison across unrelated chains is meaningless. Convert
	   both remaining refund windows to target wall-clock seconds and retain a
	   minimum 30-minute action margin for confirmation variance, relay delay and
	   broadcasting the counter-claim. The shipped defaults retain roughly three
	   hours, so this rejects unsafe custom/incoming terms without changing them. */
	swapModule.MIN_REFUND_SAFETY_MARGIN_SECONDS = 30 * 60;
	swapModule.normalizeChain = function(chainCode, fallback){
		var code = String(chainCode || fallback || '').toUpperCase();
		if(!CHAINS.definitions[code]) throw new Error('Unsupported swap chain: ' + code);
		CHAINS.getPolicy(code);
		CHAINS.getFees(code);
		return code;
	};

	swapModule.assertRefundOrdering = function(terms, assetHeight, paymentHeight, controlRodHeight){
		if(!terms){
			throw new Error('Refund ordering check requires swap terms');
		}
		var assetChain = swapModule.normalizeChain(terms.assetChain, swapModule.DEFAULT_ASSET_CHAIN);
		var paymentChain = swapModule.normalizeChain(terms.paymentChain, swapModule.DEFAULT_PAYMENT_CHAIN);
		if(assetChain === paymentChain) throw new Error('Asset and payment chains must be different');
		var currentAssetHeight = parseInt(assetHeight, 10);
		var currentPaymentHeight = parseInt(paymentHeight, 10);
		var assetRefundLockHeight = parseInt(terms.assetRefundLockHeight, 10);
		var paymentRefundLockHeight = parseInt(terms.paymentRefundLockHeight, 10);
		if(!(currentAssetHeight >= 0) || !(currentPaymentHeight >= 0) ||
			!(assetRefundLockHeight > currentAssetHeight) || !(paymentRefundLockHeight > currentPaymentHeight)){
			throw new Error('Refund ordering check requires future lock heights and current chain tips');
		}
		var assetPolicy = CHAINS.getPolicy(assetChain);
		var paymentPolicy = CHAINS.getPolicy(paymentChain);
		var assetRemainingSeconds = (assetRefundLockHeight - currentAssetHeight) * assetPolicy.blockSeconds;
		var paymentRemainingSeconds = (paymentRefundLockHeight - currentPaymentHeight) * paymentPolicy.blockSeconds;
		var confirmationMargin = Math.max(
			(parseInt(terms.assetConfirmations, 10) || 1) * assetPolicy.blockSeconds,
			(parseInt(terms.paymentConfirmations, 10) || 1) * paymentPolicy.blockSeconds
		);
		var safetyMarginSeconds = Math.max(swapModule.MIN_REFUND_SAFETY_MARGIN_SECONDS, confirmationMargin);
		if(!(assetRemainingSeconds > paymentRemainingSeconds + safetyMarginSeconds)){
			throw new Error(
				'Unsafe refund ordering: ' + assetChain + ' has ' + assetRemainingSeconds +
				's remaining but ' + paymentChain + ' has ' + paymentRemainingSeconds +
				's; the asset refund must remain later by more than ' + safetyMarginSeconds + 's'
			);
		}
		var currentControlHeight = parseInt(controlRodHeight, 10);
		if (!(currentControlHeight >= 0) && assetChain === 'ROD') currentControlHeight = currentAssetHeight;
		var releaseRemainingSeconds = 0;
		if (currentControlHeight >= 0 && parseInt(terms.releaseRodHeight, 10) > currentControlHeight) {
			releaseRemainingSeconds = (parseInt(terms.releaseRodHeight, 10) - currentControlHeight) * CHAINS.getPolicy('ROD').blockSeconds;
			if (!(paymentRemainingSeconds > releaseRemainingSeconds + safetyMarginSeconds)) {
				throw new Error('Unsafe release schedule: payment refund may unlock before the ROD-controlled release window is safely settled');
			}
		}
		return {
			assetChain: assetChain,
			paymentChain: paymentChain,
			assetHeight: currentAssetHeight,
			paymentHeight: currentPaymentHeight,
			assetRemainingSeconds: assetRemainingSeconds,
			paymentRemainingSeconds: paymentRemainingSeconds,
			releaseRemainingSeconds: releaseRemainingSeconds,
			safetyMarginSeconds: safetyMarginSeconds
		};
	};

	swapModule.assertMatchingTermsHash = function(localTerms, remoteTerms){
		var localHash = localTerms && String(localTerms.termsHash || '').toLowerCase();
		var remoteHash = remoteTerms && String(remoteTerms.termsHash || '').toLowerCase();
		if(!/^[0-9a-f]{64}$/.test(localHash) || !/^[0-9a-f]{64}$/.test(remoteHash) || localHash !== remoteHash){
			throw new Error('Incoming swap terms hash does not match locally derived canonical terms');
		}
		return true;
	};

	/* Nostr uses an x-only BIP340 key. A ROD P2PKH identity commits to the full
	   compressed secp256k1 key, so try the two possible parity bytes; exactly
	   one matches the wallet that derived the Nostr identity. This prevents the
	   first arbitrary signed relay event from pinning an attacker's key. */
	swapModule.nostrPubkeyMatchesRodIdentity = function(nostrPubkey, rodAddress){
		var xOnly = String(nostrPubkey || '').toLowerCase().replace(/^0x/, '');
		var identity = String(rodAddress || '').replace(/\s+/g, '');
		if(!/^[0-9a-f]{64}$/.test(xOnly) || !identity) return false;
		try {
			return CHAINS.publicKeyToAddress('ROD', '02' + xOnly, 'legacy') === identity ||
				CHAINS.publicKeyToAddress('ROD', '03' + xOnly, 'legacy') === identity;
		} catch(error){
			return false;
		}
	};

	swapModule.buildTerms = function(input){
		var childIndex = input.childIndex;
		var sellerPublicKey = input.sellerChildPubKey;
		var buyerPublicKey = input.buyerChildPubKey;
		var assetChain = swapModule.normalizeChain(input.assetChain, swapModule.DEFAULT_ASSET_CHAIN);
		var paymentChain = swapModule.normalizeChain(input.paymentChain, swapModule.DEFAULT_PAYMENT_CHAIN);
		if(assetChain === paymentChain) throw new Error('Asset and payment chains must be different');
		var assetFees = swapModule.chainFees(assetChain);
		var paymentFees = swapModule.chainFees(paymentChain);
		var canonicalTerms = {
			protocol: swapModule.PROTOCOL_VERSION,
			swapId: input.swapId,
			orderId: input.orderId,
			assetChain: assetChain,
			paymentChain: paymentChain,
			pair: assetChain + '/' + paymentChain,
			assetAmount: input.assetAmount,
			paymentAmount: input.paymentAmount,
			sellerSwapXpub: input.sellerSwapXpub,
			buyerSwapXpub: input.buyerSwapXpub,
			childIndex: childIndex,
			releaseRodHeight: parseInt(input.releaseRodHeight, 10),
			sellerChildPubKey: sellerPublicKey,
			buyerChildPubKey: buyerPublicKey,
			sellerPaymentPayoutAddress: (input.sellerPaymentPayoutAddress || '').replace(/\s+/g, ''),
			buyerAssetPayoutAddress: (input.buyerAssetPayoutAddress || '').replace(/\s+/g, ''),
			/* Identity binding for the 5-field swapId */
			sellerIdentity: input.sellerIdentity || '',
			buyerIdentity: input.buyerIdentity || '',
			termsNonce: input.termsNonce || '',
			/* Refund protocol. Seller (secret holder, funds the asset first)
			   refunds LATE; Buyer (funds the payment chain second) refunds EARLY —
			   otherwise the secret holder could refund the asset and still claim payment. */
			assetRefundLockHeight: parseInt(input.assetRefundLockHeight, 10) || 0,
			paymentRefundLockHeight: parseInt(input.paymentRefundLockHeight, 10) || 0,
			/* Confirmation-count acceptance gates */
			assetConfirmations: parseInt(input.assetConfirmations, 10) || 1,
			paymentConfirmations: parseInt(input.paymentConfirmations, 10) || 1,
			/* Settlement fees — canonical so both sides construct identical
			   claim/refund sighashes */
			assetClaimFee: input.assetClaimFee || assetFees.claim,
			paymentClaimFee: input.paymentClaimFee || paymentFees.claim,
			assetRefundFee: input.assetRefundFee || assetFees.refund,
			paymentRefundFee: input.paymentRefundFee || paymentFees.refund
		};
		/* Refund destinations derive from the swap child keys so both sides can
		   compute them without extra message fields; each side's own wallet holds
		   the matching private child key. */
		/* Validate payout addresses are actual blockchain addresses, not leaked
		   order names or d-tags from the orderbook fallback. */
		if (!canonicalTerms.buyerAssetPayoutAddress || /\//.test(canonicalTerms.buyerAssetPayoutAddress)) {
			throw new Error('buyerAssetPayoutAddress is missing or invalid: "' + (canonicalTerms.buyerAssetPayoutAddress || '').substring(0, 30) + '"');
		}
		if (!canonicalTerms.sellerPaymentPayoutAddress || /\//.test(canonicalTerms.sellerPaymentPayoutAddress)) {
			throw new Error('sellerPaymentPayoutAddress is missing or invalid: "' + (canonicalTerms.sellerPaymentPayoutAddress || '').substring(0, 30) + '"');
		}
		canonicalTerms.sellerAssetRefundAddress = CHAINS.publicKeyToAddress(assetChain, sellerPublicKey, 'legacy');
		canonicalTerms.buyerPaymentRefundAddress = CHAINS.publicKeyToAddress(paymentChain, buyerPublicKey, 'legacy');
		canonicalTerms.termsHash = sha256Hex(stableStringify(canonicalTerms));
		canonicalTerms.assetFunding = CHAINS.planFunding(assetChain, [sellerPublicKey, buyerPublicKey], 2, canonicalTerms.assetAmount);
		canonicalTerms.paymentFunding = CHAINS.planFunding(paymentChain, [sellerPublicKey, buyerPublicKey], 2, canonicalTerms.paymentAmount);
		canonicalTerms.assetClaim = CHAINS.planClaim(assetChain, canonicalTerms.assetFunding, canonicalTerms.buyerAssetPayoutAddress, canonicalTerms.assetAmount, canonicalTerms.assetClaimFee);
		canonicalTerms.paymentClaim = CHAINS.planClaim(paymentChain, canonicalTerms.paymentFunding, canonicalTerms.sellerPaymentPayoutAddress, canonicalTerms.paymentAmount, canonicalTerms.paymentClaimFee);
		return canonicalTerms;
	};

	swapModule.advanceState = function(session, nextState, note){
		if(!session || !session.state){
			throw new Error('Swap session is missing state');
		}
		if(ALLOWED_TRANSITIONS[session.state].indexOf(nextState) === -1){
			throw new Error('Illegal OTC state transition from ' + session.state + ' to ' + nextState);
		}
		session.state = nextState;
		session.timeline = session.timeline || [];
		session.timeline.push({
			state: nextState,
			at: new Date().toISOString(),
			note: note || ''
		});
		var state = getState();
		state.sessions[session.swapId] = session;
		saveState(state);
		return session;
	};

	swapModule.safeAdvance = function(session, nextState, note){
		if(!session || !session.state){
			throw new Error('Swap session is missing state');
		}
		var stateOrder = ['OPEN', 'NEGOTIATING', 'TERMS_ACCEPTED', 'REFUNDS_READY', 'SIGNATURES_EXCHANGED', 'PREPARED', 'ASSET_FUNDED', 'PAYMENT_FUNDED', 'READY', 'PAYMENT_CLAIMED', 'SECRET_RECOVERED', 'ASSET_CLAIMED', 'COMPLETE'];
		if(REFUND_STATES[session.state]) return session; /* refund branch is terminal for auto-advance */
		var currentIndex = stateOrder.indexOf(session.state);
		var nextIndex = stateOrder.indexOf(nextState);
		if(nextIndex === -1){
			throw new Error('Unknown OTC state: ' + nextState);
		}
		if(currentIndex >= nextIndex){
			return session;
		}
		while(currentIndex + 1 < nextIndex){
			swapModule.advanceState(session, stateOrder[currentIndex + 1], 'Auto-advanced toward ' + nextState);
			currentIndex = stateOrder.indexOf(session.state);
		}
		return swapModule.advanceState(session, nextState, note);
	};

	swapModule.validateFundingEvidence = function(evidence, expected){
		if(!evidence || !evidence.txid){
			throw new Error('Funding txid is missing');
		}
		if(expected && evidence.address !== expected.multisigAddress){
			throw new Error('Funding address mismatch');
		}
		if(expected && String(evidence.amount) !== String(expected.amount)){
			throw new Error('Funding amount mismatch');
		}
		return evidence;
	};

	swapModule.createOfferSession = function(input){
		if(!input || !input.swapId){
			throw new Error('Swap session input is incomplete');
		}
		if(!input.sellerSwapAccountKey){
			throw new Error('Seller swap account key is required');
		}
		if(!input.buyerSwapAccountKey){
			throw new Error('Buyer swap account key is required');
		}
		var childIndex = swapModule.childIndexFromSwapId(input.swapId);
		var sellerSwapKeys = swapModule.deriveSwapKeys(input.sellerSwapAccountKey, childIndex);
		var buyerSwapKeys = swapModule.deriveSwapKeys(input.buyerSwapAccountKey, childIndex);
		var terms = swapModule.buildTerms({
			swapId: input.swapId,
			orderId: input.orderId,
			assetChain: input.assetChain,
			paymentChain: input.paymentChain,
			assetAmount: input.assetAmount,
			paymentAmount: input.paymentAmount,
			/* Hash the exact account xpubs each peer advertised. Re-serialising
			   an xprv as xpub can change BIP32 depth/parent-fingerprint metadata
			   even though it derives the identical child key, which previously
			   made two honest peers compute different terms hashes and forced an
			   unsafe "accept remote terms" fallback. Private account keys remain
			   local and are used only for child derivation above. */
			sellerSwapXpub: input.sellerSwapXpub || accountXpub(input.sellerSwapAccountKey),
			buyerSwapXpub: input.buyerSwapXpub || accountXpub(input.buyerSwapAccountKey),
			childIndex: sellerSwapKeys.childIndex,
			releaseRodHeight: input.releaseRodHeight,
			sellerChildPubKey: sellerSwapKeys.publicKey,
			buyerChildPubKey: buyerSwapKeys.publicKey,
			sellerPaymentPayoutAddress: input.sellerPaymentPayoutAddress,
			buyerAssetPayoutAddress: input.buyerAssetPayoutAddress,
			sellerIdentity: input.sellerIdentity,
			buyerIdentity: input.buyerIdentity,
			termsNonce: input.termsNonce,
			assetRefundLockHeight: input.assetRefundLockHeight,
			paymentRefundLockHeight: input.paymentRefundLockHeight,
			assetConfirmations: input.assetConfirmations,
			paymentConfirmations: input.paymentConfirmations,
			assetClaimFee: input.assetClaimFee,
			paymentClaimFee: input.paymentClaimFee,
			assetRefundFee: input.assetRefundFee,
			paymentRefundFee: input.paymentRefundFee
		});
		var session = {
			swapId: input.swapId,
			orderId: input.orderId,
			role: input.role,
			state: 'OPEN',
			terms: terms,
			childIndex: sellerSwapKeys.childIndex,
			sellerSwapXpub: terms.sellerSwapXpub,
			buyerSwapXpub: terms.buyerSwapXpub,
			localChildPrivateKey: input.role === 'seller' ? sellerSwapKeys.privateKeyHex : buyerSwapKeys.privateKeyHex,
			localChildPublicKey: input.role === 'seller' ? sellerSwapKeys.publicKey : buyerSwapKeys.publicKey,
			remoteChildPublicKey: input.role === 'seller' ? buyerSwapKeys.publicKey : sellerSwapKeys.publicKey,
			adaptorSecret: '',
			adaptorPoint: '',
			messages: [],
			timeline: [{ state: 'OPEN', at: new Date().toISOString(), note: 'Session created' }]
		};
		var state = getState();
		state.sessions[session.swapId] = session;
		saveState(state);
		return session;
	};

	swapModule.listSessions = function(){
		var state = getState();
		var sessions = [];
		for(var swapId in state.sessions){
			if(state.sessions.hasOwnProperty(swapId)){
				sessions.push(state.sessions[swapId]);
			}
		}
		return sessions;
	};

	swapModule.removeSession = function(swapId){
		var state = getState();
		if(state.sessions && state.sessions[swapId]){
			delete state.sessions[swapId];
			saveState(state);
		}
	};

	swapModule.addMessage = function(swapId, eventObject){
		var state = getState();
		var session = state.sessions[swapId];
		if(!session){
			throw new Error('Unknown swap session: ' + swapId);
		}
		NOSTR.validateEnvelope(eventObject);
		session.messages = session.messages || [];
		session.messages.push(eventObject);
		state.sessions[swapId] = session;
		saveState(state);
		return session;
	};

	swapModule.createEnvelopeForSession = function(session, type, payload, pubkey, privateKeyHex){
		var previousMessage = session.messages && session.messages.length ? session.messages[session.messages.length - 1] : null;
		return NOSTR.createEnvelope({
			swapId: session.swapId,
			type: type,
			sequence: previousMessage ? (JSON.parse(previousMessage.content).sequence + 1) : 1,
			previousEventId: previousMessage ? previousMessage.id : '',
			payload: payload,
			pubkey: pubkey,
			privateKeyHex: privateKeyHex
		});
	};

	swapModule.getConfig = function(){
		return getState().config || { nameHelperUrl: '' };
	};

	swapModule.setNameHelperUrl = function(helperUrl){
		var state = getState();
		state.config = state.config || {};
		state.config.nameHelperUrl = $.trim(helperUrl || '');
		saveState(state);
		return state.config.nameHelperUrl;
	};

	swapModule.validateRodNameRecord = function(nameValue){
		var parsedValue = (typeof nameValue === 'string') ? JSON.parse(nameValue) : nameValue;
		if(!parsedValue || typeof parsedValue !== 'object' || coinjs.isArray(parsedValue)){
			throw new Error('ROD name value must be a JSON object');
		}
		var serializedValue = stableStringify(parsedValue);
		if(Crypto.charenc.UTF8.stringToBytes(serializedValue).length > 2048){
			throw new Error('ROD name value exceeds 2048-byte limit');
		}
		return {
			object: parsedValue,
			serialized: serializedValue
		};
	};

	swapModule.nameAdapter = {
		request: function(action, requestBody, callback){
			var helperUrl = swapModule.getConfig().nameHelperUrl;
			if(!helperUrl){
				callback({ success: false, unavailable: true, error: 'ROD name helper endpoint is not configured' });
				return;
			}
			$.ajax({
				url: helperUrl,
				method: 'POST',
				contentType: 'application/json',
				data: JSON.stringify({ action: action, payload: requestBody }),
				success: function(response){
					callback({ success: true, data: response });
				},
				error: function(xhr){
					callback({ success: false, error: xhr && xhr.responseText ? xhr.responseText : 'ROD name helper request failed' });
				}
			});
		},
		lookup: function(name, callback){
			this.request('lookup', { name: name }, callback);
		},
		register: function(name, value, callback){
			var validated = swapModule.validateRodNameRecord(value);
			this.request('register', { name: name, value: validated.object }, callback);
		},
		update: function(name, value, callback){
			var validated = swapModule.validateRodNameRecord(value);
			this.request('update', { name: name, value: validated.object }, callback);
		},
		remove: function(name, callback){
			this.request('delete', { name: name }, callback);
		}
	};

	swapModule.validationFixtures = function(){
		var sellerAccount = swapModule.createSwapAccount('seller fixture passphrase');
		var buyerAccount = swapModule.createSwapAccount('buyer fixture passphrase');
		var swapId = swapModule.swapIdFromOrder('seller.rod/order-1', '1', 'seller.rod', 'buyer.rod', 'fixture-nonce-1');
		var childIndex = swapModule.childIndexFromSwapId(swapId);
		var sellerKeys = swapModule.deriveSwapKeys(sellerAccount.xprv, childIndex);
		var buyerKeys = swapModule.deriveSwapKeys(buyerAccount.xprv, childIndex);
		var terms = swapModule.buildTerms({
			swapId: swapId,
			orderId: 'seller.rod/order-1',
			assetChain: swapModule.DEFAULT_ASSET_CHAIN,
			paymentChain: swapModule.DEFAULT_PAYMENT_CHAIN,
			assetAmount: '1000.00000000',
			paymentAmount: '5.00000000',
			sellerSwapXpub: sellerAccount.xpub,
			buyerSwapXpub: buyerAccount.xpub,
			childIndex: childIndex,
			releaseRodHeight: 1500000,
			sellerChildPubKey: sellerKeys.publicKey,
			buyerChildPubKey: buyerKeys.publicKey,
			sellerPaymentPayoutAddress: CHAINS.publicKeyToAddress(swapModule.DEFAULT_PAYMENT_CHAIN, sellerKeys.publicKey, 'legacy'),
			buyerAssetPayoutAddress: CHAINS.publicKeyToAddress(swapModule.DEFAULT_ASSET_CHAIN, buyerKeys.publicKey, 'legacy'),
			sellerIdentity: 'seller.rod',
			buyerIdentity: 'buyer.rod',
			termsNonce: 'fixture-nonce-1',
			assetRefundLockHeight: 1500480,
			paymentRefundLockHeight: 3100024,
			assetConfirmations: 1,
			paymentConfirmations: 1
		});
		return {
			sellerAccount: sellerAccount,
			buyerAccount: buyerAccount,
			swapId: swapId,
			childIndex: childIndex,
			sellerKeys: sellerKeys,
			buyerKeys: buyerKeys,
			terms: terms
		};
	};

		swapModule.testFixtures = function(){
		var fixtures = swapModule.validationFixtures();
		var recomputedTerms = swapModule.buildTerms({
			swapId: fixtures.swapId,
			orderId: 'seller.rod/order-1',
			assetChain: swapModule.DEFAULT_ASSET_CHAIN,
			paymentChain: swapModule.DEFAULT_PAYMENT_CHAIN,
			assetAmount: '1000.00000000',
			paymentAmount: '5.00000000',
			sellerSwapXpub: fixtures.sellerAccount.xpub,
			buyerSwapXpub: fixtures.buyerAccount.xpub,
			childIndex: fixtures.childIndex,
			releaseRodHeight: 1500000,
			sellerChildPubKey: fixtures.sellerKeys.publicKey,
			buyerChildPubKey: fixtures.buyerKeys.publicKey,
			sellerPaymentPayoutAddress: fixtures.terms.sellerPaymentPayoutAddress,
			buyerAssetPayoutAddress: fixtures.terms.buyerAssetPayoutAddress,
			sellerIdentity: 'seller.rod',
			buyerIdentity: 'buyer.rod',
			termsNonce: 'fixture-nonce-1',
			assetRefundLockHeight: 1500480,
			paymentRefundLockHeight: 3100024,
			assetConfirmations: 1,
			paymentConfirmations: 1
		});
		var nameValidation = false;
		try {
			swapModule.validateRodNameRecord({ offer: true, pair: 'ROD/' + swapModule.DEFAULT_PAYMENT_CHAIN });
			nameValidation = true;
		} catch(error){
			nameValidation = false;
		}
		return {
			name: 'Swap account and terms fixtures',
			passed: fixtures.terms.termsHash === recomputedTerms.termsHash &&
				fixtures.sellerKeys.publicKey !== fixtures.buyerKeys.publicKey &&
				!!fixtures.terms.sellerAssetRefundAddress &&
				!!fixtures.terms.buyerPaymentRefundAddress &&
				fixtures.terms.assetRefundLockHeight > fixtures.terms.releaseRodHeight &&
				nameValidation,
			fixtures: fixtures
		};
	};

	swapModule.testNameAdapterUnconfigured = function(){
		var previousUrl = swapModule.getConfig().nameHelperUrl;
		swapModule.setNameHelperUrl('');
		var result = null;
		swapModule.nameAdapter.lookup('sf/seller', function(response){
			result = response;
		});
		swapModule.setNameHelperUrl(previousUrl);
		var jsonValidationPassed = false;
		try {
			swapModule.validateRodNameRecord({ profile: { handle: 'seller' } });
			jsonValidationPassed = true;
		} catch(error){
			jsonValidationPassed = false;
		}
		return {
			name: 'ROD name helper adapter',
			passed: result && result.unavailable === true && jsonValidationPassed,
			response: result
		};
	};

	swapModule.ui = {
		init: function(){
			if(!window.jQuery || !$('#otc').length){
				return;
			}
			var config = swapModule.getConfig();
			$('#otcNameHelperUrl').val(config.nameHelperUrl || '');
			this.renderSessions();
			this.bindEvents();
		},

		bindEvents: function(){
			var self = this;
			$('#otcSaveConfigBtn').off('click').on('click', function(){
				swapModule.setNameHelperUrl($('#otcNameHelperUrl').val());
				self.showStatus('Saved OTC helper configuration locally. Deployment CSP only permits same-origin or localhost/127.0.0.1 helper origins on port 11999.', 'success');
			});
			$('#otcGenerateSwapAccountsBtn').off('click').on('click', function(){
				try {
					var sellerAccount = swapModule.createSwapAccount($('#otcSellerSwapSeed').val());
					var buyerAccount = swapModule.createSwapAccount($('#otcBuyerSwapSeed').val());
					$('#otcSellerSwapXprv').val(sellerAccount.xprv);
					$('#otcSellerSwapXpub').val(sellerAccount.xpub);
					$('#otcBuyerSwapXprv').val(buyerAccount.xprv);
					$('#otcBuyerSwapXpub').val(buyerAccount.xpub);
					self.showStatus('Derived dedicated OTC swap accounts. Keep xprv values private and never send them to peers.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcCreateOfferBtn').off('click').on('click', function(){
				try {
					var orderId = $.trim($('#otcOrderId').val());
					var buyerIdentity = $.trim($('#otcBuyerIdentity').val());
					var swapId = swapModule.swapIdFromOrder(orderId, $('#otcOrderRevision').val(), buyerIdentity);
					var sellerSwapAccountKey = $.trim($('#otcSellerSwapXprv').val()) || $.trim($('#otcSellerSwapXpub').val());
					var buyerSwapAccountKey = $.trim($('#otcBuyerSwapXprv').val()) || $.trim($('#otcBuyerSwapXpub').val());
					var session = swapModule.createOfferSession({
						role: 'seller',
						swapId: swapId,
						orderId: orderId,
						assetChain: swapModule.DEFAULT_ASSET_CHAIN,
						paymentChain: swapModule.DEFAULT_PAYMENT_CHAIN,
						assetAmount: $('#otcAssetAmount').val(),
						paymentAmount: $('#otcPaymentAmount').val(),
						releaseRodHeight: $('#otcReleaseHeight').val(),
						sellerSwapAccountKey: sellerSwapAccountKey,
						buyerSwapAccountKey: buyerSwapAccountKey
					});
					var offerPayload = {
						version: swapModule.PROTOCOL_VERSION,
						type: 'otc-order',
						seller: $('#otcSellerName').val(),
						assetChain: swapModule.DEFAULT_ASSET_CHAIN,
						paymentChain: swapModule.DEFAULT_PAYMENT_CHAIN,
						pair: swapModule.DEFAULT_ASSET_CHAIN + '/' + swapModule.DEFAULT_PAYMENT_CHAIN,
						give: $('#otcAssetAmount').val(),
						want: $('#otcPaymentAmount').val(),
						sellerSwapXpub: session.sellerSwapXpub,
						buyerSwapXpub: session.buyerSwapXpub,
						releaseRodHeight: parseInt($('#otcReleaseHeight').val(), 10),
						termsHash: session.terms.termsHash
					};
					$('#otcOfferJson').val(JSON.stringify(offerPayload, null, 2));
					$('#otcCurrentSwapId').val(session.swapId);
					$('#otcTermsJson').val(JSON.stringify(session.terms, null, 2));
					$('#otcFundingEvidence').val(JSON.stringify({ assetFunding: session.terms.assetFunding, paymentFunding: session.terms.paymentFunding, assetClaim: session.terms.assetClaim, paymentClaim: session.terms.paymentClaim }, null, 2));
					self.renderSessions();
					self.showStatus('Created OTC offer session with deterministic swap terms and planning evidence. The derived child private key stays only in this live page state and is stripped from local backups.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcExportMessageBtn').off('click').on('click', function(){
				try {
					var session = sessionById($('#otcCurrentSwapId').val());
					if(!session){
						throw new Error('Create or select an OTC session first');
					}
					var event = swapModule.createEnvelopeForSession(session, $('#otcMessageType').val(), JSON.parse($('#otcMessagePayload').val() || '{}'));
					swapModule.addMessage(session.swapId, event);
					$('#otcMessageEnvelope').val(NOSTR.exportEnvelope(event));
					self.renderSessions();
					self.showStatus('Exported manual OTC Nostr envelope. Review before sharing; never include private keys or adaptor secrets.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcImportMessageBtn').off('click').on('click', function(){
				try {
					var event = NOSTR.importEnvelope($('#otcMessageEnvelope').val());
					swapModule.addMessage(JSON.parse(event.content).swapId, event);
					self.renderSessions();
					self.showStatus('Imported OTC Nostr envelope after validation.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcValidateAdaptorBtn').off('click').on('click', function(){
				var result = ADAPTOR.runValidation();
				$('#otcValidationOutput').val(JSON.stringify(result, null, 2));
				self.showStatus(result.passed ? 'Adaptor validation passed.' : 'Adaptor validation failed.', result.passed ? 'success' : 'danger');
			});
			$('#otcRunValidationBtn').off('click').on('click', function(){
				var result = root.validation.runAll();
				$('#otcValidationOutput').val(JSON.stringify(result, null, 2));
				self.showStatus(result.passed ? 'OTC validation suite passed.' : 'OTC validation suite reported failures.', result.passed ? 'success' : 'danger');
			});
			$('#otcBackupBtn').off('click').on('click', function(){
				$('#otcBackupJson').val(STORAGE.exportState());
				self.showStatus('Exported OTC storage backup without private signing material.', 'success');
			});
			$('#otcRestoreBtn').off('click').on('click', function(){
				try {
					STORAGE.importState($('#otcBackupJson').val());
					self.renderSessions();
					self.showStatus('Restored OTC backup from validated local JSON.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcNameLookupBtn').off('click').on('click', function(){
				swapModule.nameAdapter.lookup($('#otcRodName').val(), function(response){
					$('#otcNameAdapterOutput').val(JSON.stringify(response, null, 2));
					self.showStatus(response.success ? 'Name lookup request completed.' : (response.unavailable ? 'ROD name helper is not configured.' : 'Name lookup request failed.'), response.success ? 'success' : 'warning');
				});
			});
			$('#otcNameRegisterBtn').off('click').on('click', function(){
				try {
					var record = JSON.parse($('#otcRodNameValue').val());
					swapModule.nameAdapter.register($('#otcRodName').val(), record, function(response){
						$('#otcNameAdapterOutput').val(JSON.stringify(response, null, 2));
						self.showStatus(response.success ? 'Name register request completed.' : (response.unavailable ? 'ROD name helper is not configured.' : 'Name register request failed.'), response.success ? 'success' : 'warning');
					});
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
			$('#otcAdvanceStateBtn').off('click').on('click', function(){
				try {
					var session = sessionById($('#otcCurrentSwapId').val());
					if(!session){
						throw new Error('Select an OTC session first');
					}
					swapModule.advanceState(session, $('#otcNextState').val(), 'Manual UI smoke advance');
					self.renderSessions();
					self.showStatus('Advanced OTC state to ' + $('#otcNextState').val() + '.', 'success');
				} catch(error){
					self.showStatus(error.message, 'danger');
				}
			});
		},

		showStatus: function(message, type){
			var statusBox = $('#otcStatus');
			statusBox.removeClass('hidden alert-success alert-danger alert-warning alert-info').addClass('alert-' + (type || 'info')).text(message);
		},

		renderSessions: function(){
			var sessions = swapModule.listSessions();
			var rows = [];
			for(var index = 0; index < sessions.length; index++){
				rows.push('<tr><td><button type="button" class="btn btn-xs btn-default otcSelectSessionBtn" data-swap-id="' + escapeHtml(sessions[index].swapId) + '">Use</button></td><td>' + escapeHtml(sessions[index].swapId) + '</td><td>' + escapeHtml(sessions[index].role) + '</td><td>' + escapeHtml(sessions[index].state) + '</td><td>' + escapeHtml(sessions[index].terms.termsHash) + '</td></tr>');
			}
			$('#otcSessionTable tbody').html(rows.join('') || '<tr><td colspan="5" class="text-muted">No OTC sessions saved yet.</td></tr>');
			$('.otcSelectSessionBtn').off('click').on('click', function(){
				var session = sessionById($(this).data('swap-id'));
				if(!session){
					return;
				}
				$('#otcCurrentSwapId').val(session.swapId);
				$('#otcTermsJson').val(JSON.stringify(session.terms, null, 2));
				$('#otcFundingEvidence').val(JSON.stringify({ assetFunding: session.terms.assetFunding, paymentFunding: session.terms.paymentFunding, assetClaim: session.terms.assetClaim, paymentClaim: session.terms.paymentClaim, timeline: session.timeline || [] }, null, 2));
				$('#otcMessageEnvelope').val(session.messages && session.messages.length ? NOSTR.exportEnvelope(session.messages[session.messages.length - 1]) : '');
			});
		}
	};

	root.validation = root.validation || {};
	root.validation.runAll = function(){
		var results = [
			ADAPTOR.runValidation(),
			CHAINS.testAgainstRodGlobals(),
			STORAGE.testPersistence(),
			NOSTR.testValidation(),
			swapModule.testNameAdapterUnconfigured(),
			swapModule.testFixtures()
		];
		var passed = true;
		for(var index = 0; index < results.length; index++){
			if(!results[index].passed){
				passed = false;
			}
		}
		return {
			passed: passed,
			results: results,
			completedAt: new Date().toISOString()
		};
	};
})();
