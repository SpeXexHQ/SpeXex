import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  N,
  bytesToHex,
  complete,
  encrypt,
  exposedCdhPoint,
  hexToBytes,
  mod,
  pointFromHexStrict,
  pointToHex,
  publicKey,
  recover,
  scalarToHex,
  verify,
  verifyCompleted
} from '../src/private-adaptor-reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function digest(label) {
  return createHash('sha256').update(label, 'utf8').digest('hex');
}

function derivedScalar(label) {
  return scalarToHex(mod(BigInt(`0x${digest(label)}`), N - 1n) + 1n);
}

function makeVector(id, signingSecretHex, adaptorSecretHex, messageHex, auxiliaryHex) {
  const encrypted = encrypt({ signingSecretHex, adaptorSecretHex, messageHex, auxiliaryHex });
  const completed = complete(encrypted.signatureHex, adaptorSecretHex);
  const recovered = recover(encrypted.signatureHex, completed.derHex, encrypted.adaptorPointHex);
  const cdh = exposedCdhPoint(encrypted.signatureHex, messageHex, encrypted.adaptorPointHex);
  const expectedCdh = pointToHex(
    pointFromHexStrict(encrypted.adaptorPointHex).multiply(BigInt(`0x${signingSecretHex}`))
  );
  const internals = encrypted.internals;
  const vector = {
    id,
    signing_secret: signingSecretHex,
    signing_public_key: encrypted.signingPublicKeyHex,
    adaptor_secret: adaptorSecretHex,
    adaptor_point: encrypted.adaptorPointHex,
    message: messageHex,
    auxiliary_randomness: auxiliaryHex,
    adaptor_signature: encrypted.signatureHex,
    completed_der_signature: completed.derHex,
    recovered_secret: recovered,
    exposed_cdh_point: pointToHex(cdh),
    expected_cdh_point: expectedCdh,
    internals: {
      nonce: scalarToHex(internals.k),
      proof_nonce: scalarToHex(internals.w),
      r: scalarToHex(internals.r),
      s_prime: scalarToHex(internals.sPrime),
      challenge: scalarToHex(internals.challenge),
      response: scalarToHex(internals.response),
      R: pointToHex(internals.R),
      R_prime: pointToHex(internals.RPrime),
      A1: pointToHex(internals.A1),
      A2: pointToHex(internals.A2)
    }
  };
  if (!verify({
    signingPublicKeyHex: vector.signing_public_key,
    adaptorPointHex: vector.adaptor_point,
    messageHex: vector.message,
    signatureHex: vector.adaptor_signature
  })) throw new Error(`Generated vector ${id} did not verify`);
  if (!verifyCompleted(vector.signing_public_key, vector.message, vector.completed_der_signature)) {
    throw new Error(`Completed ECDSA signature for ${id} did not verify`);
  }
  if (recovered !== adaptorSecretHex || vector.exposed_cdh_point !== expectedCdh) {
    throw new Error(`Extraction invariant failed for ${id}`);
  }
  return vector;
}

const positives = [];
positives.push(makeVector(
  'wallet-deterministic-fixture',
  '1f1e1d1c1b1a19181716151413121110112233445566778899aabbccddeeff00',
  '0f0e0d0c0b0a09080706050403020100ffeeddccbbaa99887766554433221111',
  digest('rod-otc-deterministic-fixture'),
  '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
));
positives.push(makeVector('boundary-one', scalarToHex(1n), scalarToHex(1n), '00'.repeat(32), '00'.repeat(32)));
positives.push(makeVector('boundary-n-minus-one', scalarToHex(N - 1n), scalarToHex(N - 1n), 'ff'.repeat(32), 'ff'.repeat(32)));
for (let index = 0; index < 13; index++) {
  positives.push(makeVector(
    `derived-${String(index).padStart(2, '0')}`,
    derivedScalar(`signing/${index}`),
    derivedScalar(`adaptor/${index}`),
    digest(`message/${index}`),
    digest(`auxiliary/${index}`)
  ));
}

function replaceBytes(hex, offset, replacementHex) {
  return hex.slice(0, offset * 2) + replacementHex + hex.slice((offset * 2) + replacementHex.length);
}

function flipByte(hex, offset, mask) {
  const bytes = hexToBytes(hex);
  bytes[offset] ^= mask;
  return bytesToHex(bytes);
}

const base = positives[0];
const other = positives[1];
const negatives = [
  { id: 'wrong-message', ...base, message: flipByte(base.message, 31, 1) },
  { id: 'wrong-signing-key', ...base, signing_public_key: other.signing_public_key },
  { id: 'wrong-adaptor-point', ...base, adaptor_point: other.adaptor_point },
  { id: 'truncated-signature', ...base, adaptor_signature: base.adaptor_signature.slice(0, -2) },
  { id: 'extended-signature', ...base, adaptor_signature: base.adaptor_signature + '00' },
  { id: 'bad-R-prefix', ...base, adaptor_signature: '04' + base.adaptor_signature.slice(2) },
  { id: 'bad-R-prime-prefix', ...base, adaptor_signature: replaceBytes(base.adaptor_signature, 33, '04') },
  { id: 'zero-s-prime', ...base, adaptor_signature: replaceBytes(base.adaptor_signature, 66, '00'.repeat(32)) },
  { id: 'n-s-prime', ...base, adaptor_signature: replaceBytes(base.adaptor_signature, 66, scalarToHex(N)) },
  { id: 'n-challenge', ...base, adaptor_signature: replaceBytes(base.adaptor_signature, 98, scalarToHex(N)) },
  { id: 'n-response', ...base, adaptor_signature: replaceBytes(base.adaptor_signature, 130, scalarToHex(N)) },
  ...[0, 1, 32, 33, 34, 65, 66, 97, 98, 129, 130, 161].map((offset) => ({
    id: `signature-byte-${offset}-bit-0`,
    ...base,
    adaptor_signature: flipByte(base.adaptor_signature, offset, 1)
  }))
].map((vector) => ({
  id: vector.id,
  signing_public_key: vector.signing_public_key,
  adaptor_point: vector.adaptor_point,
  message: vector.message,
  adaptor_signature: vector.adaptor_signature,
  expected_verification: false
}));

const corpus = {
  schema: 'rod-private-adaptor-v1-test-vectors',
  version: 1,
  generated_by: 'clean-room @noble/curves implementation',
  source_commit: 'cb136d791c836c704a122278d00c7bfefde1a8b0',
  positive_count: positives.length,
  negative_count: negatives.length,
  exhaustive_mutation_policy: 'The verifier test flips each of 8 bits in all 162 bytes of the first positive signature.',
  positives,
  negatives
};

mkdirSync(path.join(root, 'vectors'), { recursive: true });
writeFileSync(path.join(root, 'vectors/private-adaptor-v1.json'), `${JSON.stringify(corpus, null, 2)}\n`);
console.log(JSON.stringify({ positives: positives.length, negatives: negatives.length }, null, 2));
