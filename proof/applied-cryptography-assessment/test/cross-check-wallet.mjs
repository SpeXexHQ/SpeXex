import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walletRoot = path.resolve(root, '..', 'rod-web-swap');
const vectors = JSON.parse(readFileSync(path.join(root, 'vectors/private-adaptor-v1.json'), 'utf8'));
const context = {
  console,
  document: { location: { protocol: 'http:', hostname: 'localhost' } },
  navigator: {},
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  setTimeout,
  clearTimeout,
  Uint8Array,
  window: null,
  crypto: { getRandomValues(target) { crypto.randomFillSync(target); return target; } }
};
context.window = context;
vm.createContext(context);
for (const relativePath of [
  'js/crypto-min.js',
  'js/crypto-sha256.js',
  'js/crypto-sha256-hmac.js',
  'js/sha512.js',
  'js/ripemd160.js',
  'js/jsbn.js',
  'js/ellipticcurve.js',
  'js/coin.js',
  'js/ecdsa-adaptor.js'
]) {
  vm.runInContext(readFileSync(path.join(walletRoot, relativePath), 'utf8'), context, { filename: relativePath });
}

let exactGenerationMatches = 0;
let verificationMatches = 0;
let completionMatches = 0;
let recoveryMatches = 0;
const offset = Number.parseInt(process.env.CROSS_CHECK_OFFSET || '0', 10);
const limit = Number.parseInt(process.env.CROSS_CHECK_LIMIT || String(vectors.positives.length), 10);
const selectedVectors = vectors.positives.slice(offset, offset + limit);
for (const vector of selectedVectors) {
  const generated = context.coinjs.adaptor.encrypt({
    messageHash: vector.message,
    signingPrivateKey: vector.signing_secret,
    adaptorPublicKey: vector.adaptor_point,
    auxiliaryRandomness: vector.auxiliary_randomness
  });
  assert.equal(generated.hex, vector.adaptor_signature, `${vector.id}: wallet generation differs from clean-room vector`);
  exactGenerationMatches++;
  assert.equal(context.coinjs.adaptor.verify({
    messageHash: vector.message,
    signingPublicKey: vector.signing_public_key,
    adaptorPublicKey: vector.adaptor_point,
    adaptorSignature: vector.adaptor_signature
  }), true, `${vector.id}: wallet rejected clean-room vector`);
  verificationMatches++;
  const completed = context.coinjs.adaptor.complete({
    adaptorSignature: vector.adaptor_signature,
    adaptorSecret: vector.adaptor_secret
  });
  assert.equal(completed.hex, vector.completed_der_signature, `${vector.id}: wallet completion differs`);
  completionMatches++;
  const recovered = context.coinjs.adaptor.recover({
    adaptorSignature: vector.adaptor_signature,
    completedSignature: vector.completed_der_signature,
    adaptorPublicKey: vector.adaptor_point
  });
  assert.equal(recovered, vector.adaptor_secret, `${vector.id}: wallet recovery differs`);
  recoveryMatches++;
}

console.log(JSON.stringify({
  status: 'passed',
  offset,
  vectors_checked: selectedVectors.length,
  exact_generation_matches: exactGenerationMatches,
  verification_matches: verificationMatches,
  completion_matches: completionMatches,
  recovery_matches: recoveryMatches
}, null, 2));
