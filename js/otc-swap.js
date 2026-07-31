/*
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 * Fork-specific OTC swap-state helpers for SpeXex.
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
		PREPARED: ['SELLER_ROD_FUNDED'],
		SELLER_ROD_FUNDED: ['BUYER_ALT_FUNDED'],
		BUYER_ALT_FUNDED: ['READY'],
		READY: ['ALT_CLAIMED'],
		ALT_CLAIMED: ['SECRET_RECOVERED'],
		SECRET_RECOVERED: ['ROD_CLAIMED'],
		ROD_CLAIMED: ['COMPLETE'],
		COMPLETE: []
	};
	/* Refund outcomes sit outside the linear happy path: a swap can divert to
	   a refund from several states, so they are entered via markRefundState()
	   rather than advanceState(). PARTIALLY_SETTLED records one output claimed
	   while the other was refunded. */
	var REFUND_STATES = {
		ROD_REFUND_BROADCAST: true,
		ALT_REFUND_BROADCAST: true,
		ROD_REFUNDED: true,
		ALT_REFUNDED: true,
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

	/* Default settlement fees (decimal strings). ROD relays at a much higher
	   fee floor than LTC (observed ~232 sat/B on mainnet). */
	swapModule.DEFAULT_FEES = {
		rodClaimFee: '0.00051900',
		altClaimFee: '0.00001000',
		rodRefundFee: '0.00051900',
		altRefundFee: '0.00001000'
	};

	/* Per-alt-chain settlement fees.

	   These are CANONICAL: both sides put them in the hashed terms and build
	   byte-identical claim and refund transactions from them, so a mismatch
	   does not merely overpay — it produces divergent sighashes and every
	   exchanged signature becomes worthless.

	   Litecoin keeps its historical 0.00001 LTC (~1 lit/vB over a ~300-byte
	   settlement transaction, above Litecoin Core's relay floor).

	   Dogecoin needs three orders of magnitude more. A 2-of-2 P2SH settlement
	   transaction is ~305 bytes; at Dogecoin's recommended/mining rate of 1000
	   koinu per byte that is ~305,000 koinu. We charge a flat 0.01 DOGE
	   (1,000,000 koinu), which is Dogecoin Core's own RECOMMENDED_MIN_TX_FEE
	   per kB and leaves ~3x headroom for signature-length variation. Paying the
	   bare relay floor instead (100 koinu/B) would relay but be skipped by
	   miners running the default -blockmintxfee, which on a swap is not a delay
	   but a fund-loss risk: a claim that misses its refund deadline lets the
	   counterparty take both legs. In fiat this is a fraction of a cent. */
	swapModule.ALT_CHAIN_FEES = {
		LTC: { claimFee: '0.00001000', refundFee: '0.00001000', fundingFee: '0.00001000' },
		DOGE: { claimFee: '0.01000000', refundFee: '0.01000000', fundingFee: '0.01000000' }
	};

	/* Fees for an alt chain. Throws rather than deriving a plausible-looking
	   default: these values are canonical — both sides build byte-identical
	   settlement transactions from them — so a guessed fee is not a small
	   overpayment but a chain whose swaps may be unminable. Adding a chain must
	   be a deliberate entry here, exactly as it must be in the policy table. */
	swapModule.altFees = function(chainCode){
		var code = chainCode || swapModule.DEFAULT_ALT_CHAIN;
		var fees = swapModule.ALT_CHAIN_FEES[code];
		if(!fees){
			throw new Error('No settlement fees registered for chain: ' + code);
		}
		return fees;
	};
	/* The alt leg may run on any supported non-ROD chain. It is pinned into the
	   canonical (hashed) terms so a counterparty cannot swap the chain out from
	   under a signature: every funding address, refund address, claim plan and
	   sighash below is derived from this one field. */
	swapModule.DEFAULT_ALT_CHAIN = 'LTC';
	/* A block-height comparison across unrelated chains is meaningless. Convert
	   both remaining refund windows to target wall-clock seconds and retain a
	   minimum 30-minute action margin for confirmation variance, relay delay and
	   broadcasting the counter-claim. The shipped defaults retain roughly three
	   hours, so this rejects unsafe custom/incoming terms without changing them. */
	swapModule.MIN_REFUND_SAFETY_MARGIN_SECONDS = 30 * 60;
	swapModule.normalizeAltChain = function(chainCode){
		var code = String(chainCode || '').toUpperCase();
		if(code === 'ROD' || !CHAINS.definitions[code]){
			return swapModule.DEFAULT_ALT_CHAIN;
		}
		return code;
	};

	swapModule.assertRefundOrdering = function(terms, rodHeight, altHeight){
		if(!terms){
			throw new Error('Refund ordering check requires swap terms');
		}
		var altChain = String(terms.altChain || swapModule.DEFAULT_ALT_CHAIN).toUpperCase();
		if(altChain === 'ROD' || !CHAINS.definitions[altChain]){
			throw new Error('Refund ordering check has unsupported alt chain ' + altChain);
		}
		var currentRodHeight = parseInt(rodHeight, 10);
		var currentAltHeight = parseInt(altHeight, 10);
		var refundRodHeight = parseInt(terms.refundRodHeight, 10);
		var altRefundLockHeight = parseInt(terms.altRefundLockHeight, 10);
		if(!(currentRodHeight >= 0) || !(currentAltHeight >= 0) ||
			!(refundRodHeight > currentRodHeight) || !(altRefundLockHeight > currentAltHeight)){
			throw new Error('Refund ordering check requires future lock heights and current chain tips');
		}
		var rodPolicy = CHAINS.getPolicy('ROD');
		var altPolicy = CHAINS.getPolicy(altChain);
		var rodRemainingSeconds = (refundRodHeight - currentRodHeight) * rodPolicy.blockSeconds;
		var altRemainingSeconds = (altRefundLockHeight - currentAltHeight) * altPolicy.blockSeconds;
		var confirmationMargin = Math.max(
			(parseInt(terms.rodConfirmations, 10) || 1) * rodPolicy.blockSeconds,
			(parseInt(terms.altConfirmations, 10) || 1) * altPolicy.blockSeconds
		);
		var safetyMarginSeconds = Math.max(swapModule.MIN_REFUND_SAFETY_MARGIN_SECONDS, confirmationMargin);
		if(!(rodRemainingSeconds > altRemainingSeconds + safetyMarginSeconds)){
			throw new Error(
				'Unsafe refund ordering: ROD has ' + rodRemainingSeconds +
				's remaining but ' + altChain + ' has ' + altRemainingSeconds +
				's; ROD must remain later by more than ' + safetyMarginSeconds + 's'
			);
		}
		return {
			altChain: altChain,
			rodHeight: currentRodHeight,
			altHeight: currentAltHeight,
			rodRemainingSeconds: rodRemainingSeconds,
			altRemainingSeconds: altRemainingSeconds,
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
		var altChain = swapModule.normalizeAltChain(input.altChain);
		var canonicalTerms = {
			swapId: input.swapId,
			orderId: input.orderId,
			altChain: altChain,
			pair: 'ROD/' + altChain,
			rodAmount: input.rodAmount,
			altAmount: input.altAmount,
			sellerSwapXpub: input.sellerSwapXpub,
			buyerSwapXpub: input.buyerSwapXpub,
			childIndex: childIndex,
			releaseRodHeight: parseInt(input.releaseRodHeight, 10),
			sellerChildPubKey: sellerPublicKey,
			buyerChildPubKey: buyerPublicKey,
			sellerAltPayoutAddress: (input.sellerAltPayoutAddress || '').replace(/\s+/g, ''),
			buyerRodPayoutAddress: (input.buyerRodPayoutAddress || '').replace(/\s+/g, ''),
			/* Identity binding for the 5-field swapId */
			sellerIdentity: input.sellerIdentity || '',
			buyerIdentity: input.buyerIdentity || '',
			termsNonce: input.termsNonce || '',
			/* Refund protocol. Seller (secret holder, funds ROD first) refunds
			   LATE; Buyer (funds LTC second) refunds EARLY — otherwise the secret
			   holder could refund ROD and still claim LTC. */
			refundRodHeight: parseInt(input.refundRodHeight, 10) || 0,
			altRefundLockHeight: parseInt(input.altRefundLockHeight, 10) || 0,
			/* Confirmation-count acceptance gates */
			rodConfirmations: parseInt(input.rodConfirmations, 10) || 1,
			altConfirmations: parseInt(input.altConfirmations, 10) || 1,
			/* Settlement fees — canonical so both sides construct identical
			   claim/refund sighashes */
			rodClaimFee: input.rodClaimFee || swapModule.DEFAULT_FEES.rodClaimFee,
			altClaimFee: input.altClaimFee || swapModule.altFees(altChain).claimFee,
			rodRefundFee: input.rodRefundFee || swapModule.DEFAULT_FEES.rodRefundFee,
			altRefundFee: input.altRefundFee || swapModule.altFees(altChain).refundFee
		};
		/* Refund destinations derive from the swap child keys so both sides can
		   compute them without extra message fields; each side's own wallet holds
		   the matching private child key. */
		/* Validate payout addresses are actual blockchain addresses, not leaked
		   order names or d-tags from the orderbook fallback. */
		if (!canonicalTerms.buyerRodPayoutAddress || /\//.test(canonicalTerms.buyerRodPayoutAddress)) {
			throw new Error('buyerRodPayoutAddress is missing or invalid: "' + (canonicalTerms.buyerRodPayoutAddress || '').substring(0, 30) + '"');
		}
		if (!canonicalTerms.sellerAltPayoutAddress || /\//.test(canonicalTerms.sellerAltPayoutAddress)) {
			throw new Error('sellerAltPayoutAddress is missing or invalid: "' + (canonicalTerms.sellerAltPayoutAddress || '').substring(0, 30) + '"');
		}
		canonicalTerms.sellerRodRefundAddress = CHAINS.publicKeyToAddress('ROD', sellerPublicKey, 'legacy');
		canonicalTerms.buyerAltRefundAddress = CHAINS.publicKeyToAddress(altChain, buyerPublicKey, 'legacy');
		canonicalTerms.termsHash = sha256Hex(stableStringify(canonicalTerms));
		canonicalTerms.rodFunding = CHAINS.planFunding('ROD', [sellerPublicKey, buyerPublicKey], 2, canonicalTerms.rodAmount);
		canonicalTerms.altFunding = CHAINS.planFunding(altChain, [sellerPublicKey, buyerPublicKey], 2, canonicalTerms.altAmount);
		canonicalTerms.rodClaim = CHAINS.planClaim('ROD', canonicalTerms.rodFunding, canonicalTerms.buyerRodPayoutAddress, canonicalTerms.rodAmount, canonicalTerms.rodClaimFee);
		canonicalTerms.altClaim = CHAINS.planClaim(altChain, canonicalTerms.altFunding, canonicalTerms.sellerAltPayoutAddress, canonicalTerms.altAmount, canonicalTerms.altClaimFee);
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
		var stateOrder = ['OPEN', 'NEGOTIATING', 'TERMS_ACCEPTED', 'REFUNDS_READY', 'SIGNATURES_EXCHANGED', 'PREPARED', 'SELLER_ROD_FUNDED', 'BUYER_ALT_FUNDED', 'READY', 'ALT_CLAIMED', 'SECRET_RECOVERED', 'ROD_CLAIMED', 'COMPLETE'];
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
			altChain: input.altChain,
			rodAmount: input.rodAmount,
			altAmount: input.altAmount,
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
			sellerAltPayoutAddress: input.sellerAltPayoutAddress,
			buyerRodPayoutAddress: input.buyerRodPayoutAddress,
			sellerIdentity: input.sellerIdentity,
			buyerIdentity: input.buyerIdentity,
			termsNonce: input.termsNonce,
			refundRodHeight: input.refundRodHeight,
			altRefundLockHeight: input.altRefundLockHeight,
			rodConfirmations: input.rodConfirmations,
			altConfirmations: input.altConfirmations,
			rodClaimFee: input.rodClaimFee,
			altClaimFee: input.altClaimFee,
			rodRefundFee: input.rodRefundFee,
			altRefundFee: input.altRefundFee
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
			rodAmount: '1000.00000000',
			altAmount: '5.00000000',
			sellerSwapXpub: sellerAccount.xpub,
			buyerSwapXpub: buyerAccount.xpub,
			childIndex: childIndex,
			releaseRodHeight: 1500000,
			sellerChildPubKey: sellerKeys.publicKey,
			buyerChildPubKey: buyerKeys.publicKey,
			sellerAltPayoutAddress: CHAINS.publicKeyToAddress(swapModule.DEFAULT_ALT_CHAIN, sellerKeys.publicKey, 'legacy'),
			buyerRodPayoutAddress: CHAINS.publicKeyToAddress('ROD', buyerKeys.publicKey, 'legacy'),
			sellerIdentity: 'seller.rod',
			buyerIdentity: 'buyer.rod',
			termsNonce: 'fixture-nonce-1',
			refundRodHeight: 1500480,
			altRefundLockHeight: 3100024,
			rodConfirmations: 1,
			altConfirmations: 1
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
			rodAmount: '1000.00000000',
			altAmount: '5.00000000',
			sellerSwapXpub: fixtures.sellerAccount.xpub,
			buyerSwapXpub: fixtures.buyerAccount.xpub,
			childIndex: fixtures.childIndex,
			releaseRodHeight: 1500000,
			sellerChildPubKey: fixtures.sellerKeys.publicKey,
			buyerChildPubKey: fixtures.buyerKeys.publicKey,
			sellerAltPayoutAddress: fixtures.terms.sellerAltPayoutAddress,
			buyerRodPayoutAddress: fixtures.terms.buyerRodPayoutAddress,
			sellerIdentity: 'seller.rod',
			buyerIdentity: 'buyer.rod',
			termsNonce: 'fixture-nonce-1',
			refundRodHeight: 1500480,
			altRefundLockHeight: 3100024,
			rodConfirmations: 1,
			altConfirmations: 1
		});
		var nameValidation = false;
		try {
			swapModule.validateRodNameRecord({ offer: true, pair: 'ROD/' + swapModule.DEFAULT_ALT_CHAIN });
			nameValidation = true;
		} catch(error){
			nameValidation = false;
		}
		return {
			name: 'Swap account and terms fixtures',
			passed: fixtures.terms.termsHash === recomputedTerms.termsHash &&
				fixtures.sellerKeys.publicKey !== fixtures.buyerKeys.publicKey &&
				!!fixtures.terms.sellerRodRefundAddress &&
				!!fixtures.terms.buyerAltRefundAddress &&
				fixtures.terms.refundRodHeight > fixtures.terms.releaseRodHeight &&
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
						rodAmount: $('#otcRodAmount').val(),
						altAmount: $('#otcAltAmount').val(),
						releaseRodHeight: $('#otcReleaseHeight').val(),
						sellerSwapAccountKey: sellerSwapAccountKey,
						buyerSwapAccountKey: buyerSwapAccountKey
					});
					var offerPayload = {
						version: 1,
						type: 'otc-order',
						seller: $('#otcSellerName').val(),
						pair: 'ROD/' + swapModule.DEFAULT_ALT_CHAIN,
						give: $('#otcRodAmount').val(),
						want: $('#otcAltAmount').val(),
						sellerSwapXpub: session.sellerSwapXpub,
						buyerSwapXpub: session.buyerSwapXpub,
						releaseRodHeight: parseInt($('#otcReleaseHeight').val(), 10),
						termsHash: session.terms.termsHash
					};
					$('#otcOfferJson').val(JSON.stringify(offerPayload, null, 2));
					$('#otcCurrentSwapId').val(session.swapId);
					$('#otcTermsJson').val(JSON.stringify(session.terms, null, 2));
					$('#otcFundingEvidence').val(JSON.stringify({ rodFunding: session.terms.rodFunding, altFunding: session.terms.altFunding, rodClaim: session.terms.rodClaim, altClaim: session.terms.altClaim }, null, 2));
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
				$('#otcFundingEvidence').val(JSON.stringify({ rodFunding: session.terms.rodFunding, altFunding: session.terms.altFunding, rodClaim: session.terms.rodClaim, altClaim: session.terms.altClaim, timeline: session.timeline || [] }, null, 2));
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
