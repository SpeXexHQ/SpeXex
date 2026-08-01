/*
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 SpaceXpanse
 * Fork-specific OTC storage helpers for the SpaceXpanse ROD wallet.
 */

(function(){
	var root = window.rodOtc = window.rodOtc || {};
	var storageModule = root.storage = root.storage || {};
	var STORAGE_KEY = 'spexSwapV2State';
	var STORAGE_VERSION = 2;
	var SENSITIVE_SESSION_FIELDS = {
		localChildPrivateKey: true,
		privateKeyHex: true,
		privateKeyWif: true,
		xprv: true
	};

	function stableStringify(value){
		if(value === null || typeof value !== 'object'){
			return JSON.stringify(value);
		}
		if(coinjs.isArray(value)){
			var arrayParts = [];
			for(var arrayIndex = 0; arrayIndex < value.length; arrayIndex++){
				arrayParts.push(stableStringify(value[arrayIndex]));
			}
			return '[' + arrayParts.join(',') + ']';
		}
		var keys = [];
		for(var keyName in value){
			if(value.hasOwnProperty(keyName)){
				keys.push(keyName);
			}
		}
		keys.sort();
		var objectParts = [];
		for(var keyIndex = 0; keyIndex < keys.length; keyIndex++){
			objectParts.push(JSON.stringify(keys[keyIndex]) + ':' + stableStringify(value[keys[keyIndex]]));
		}
		return '{' + objectParts.join(',') + '}';
	}

	function checksum(payload){
		return Crypto.util.bytesToHex(Crypto.SHA256(Crypto.charenc.UTF8.stringToBytes(stableStringify(payload)), {asBytes: true}));
	}

	function sanitizeSession(session){
		var sanitizedSession = {};
		for(var propertyName in (session || {})){
			if(session.hasOwnProperty(propertyName) && !SENSITIVE_SESSION_FIELDS[propertyName]){
				sanitizedSession[propertyName] = session[propertyName];
			}
		}
		return sanitizedSession;
	}

	function sanitizeState(state){
		var baseState = state || storageModule.newState();
		var sanitizedState = {
			sessions: {},
			config: baseState.config || storageModule.newState().config
		};
		for(var swapId in (baseState.sessions || {})){
			if(baseState.sessions.hasOwnProperty(swapId)){
				sanitizedState.sessions[swapId] = sanitizeSession(baseState.sessions[swapId]);
			}
		}
		return sanitizedState;
	}

	function makeEnvelope(data){
		var sanitizedPayload = sanitizeState(data);
		return {
			version: STORAGE_VERSION,
			updatedAt: new Date().toISOString(),
			payload: sanitizedPayload,
			checksum: checksum(sanitizedPayload)
		};
	}

	function validateEnvelope(envelope){
		if(!envelope || envelope.version !== STORAGE_VERSION || !envelope.payload || !envelope.checksum){
			throw new Error('Unsupported or incomplete OTC storage envelope');
		}
		if(checksum(envelope.payload) !== envelope.checksum){
			throw new Error('OTC storage checksum mismatch');
		}
		if(!envelope.payload.sessions || typeof envelope.payload.sessions !== 'object'){
			throw new Error('OTC storage payload is missing sessions');
		}
		return envelope;
	}

	storageModule.newState = function(){
		return {
			sessions: {},
			config: {
				nameHelperUrl: ''
			}
		};
	};

	storageModule.load = function(){
		var rawValue = window.localStorage.getItem(STORAGE_KEY);
		if(!rawValue){
			return storageModule.newState();
		}
		return sanitizeState(validateEnvelope(JSON.parse(rawValue)).payload);
	};

	storageModule.save = function(state){
		var envelope = makeEnvelope(state || storageModule.newState());
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
		return envelope;
	};

	storageModule.exportState = function(){
		var envelope = makeEnvelope(storageModule.load());
		return JSON.stringify(envelope, null, 2);
	};

	storageModule.importState = function(serializedValue){
		var envelope = validateEnvelope(JSON.parse(serializedValue));
		var resanitizedEnvelope = makeEnvelope(envelope.payload);
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(resanitizedEnvelope));
		return resanitizedEnvelope.payload;
	};

	storageModule.clear = function(){
		window.localStorage.removeItem(STORAGE_KEY);
	};

	storageModule.testPersistence = function(){
		var previousValue = window.localStorage.getItem(STORAGE_KEY);
		var fixtureState = storageModule.newState();
		fixtureState.sessions.fixture = {
			swapId: 'fixture',
			state: 'OPEN',
			localChildPrivateKey: 'super-secret-fixture-key'
		};
		fixtureState.config.nameHelperUrl = 'http://127.0.0.1:8123';
		storageModule.save(fixtureState);
		var reloadedState = storageModule.load();
		var exportedState = storageModule.exportState();
		var exportedPayload = JSON.parse(exportedState).payload;
		var corruptRejected = false;
		try {
			storageModule.importState('{"version":2,"payload":{"sessions":{}},"checksum":"deadbeef"}');
		} catch(error){
			corruptRejected = true;
		}
		if(previousValue === null){
			window.localStorage.removeItem(STORAGE_KEY);
		} else {
			window.localStorage.setItem(STORAGE_KEY, previousValue);
		}
		return {
			name: 'Versioned OTC storage',
			passed: reloadedState.config.nameHelperUrl === fixtureState.config.nameHelperUrl && !reloadedState.sessions.fixture.localChildPrivateKey && !exportedPayload.sessions.fixture.localChildPrivateKey && !!exportedState && corruptRejected,
			reloadedState: reloadedState,
			corruptRejected: corruptRejected
		};
	};
})();
