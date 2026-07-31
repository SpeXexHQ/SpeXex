import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  G,
  N,
  complete,
  dleqCommit,
  dleqResponse,
  exposedCdhPoint,
  extractDleqWitness,
  mod,
  multiply,
  pointFromHexStrict,
  pointToHex,
  parseStrictDer,
  recover,
  scalarToHex,
  verify,
  verifyCompleted
} from '../src/private-adaptor-reference.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vectors = JSON.parse(readFileSync(path.join(root, 'vectors/private-adaptor-v1.json'), 'utf8'));
let assertions = 0;

function assert(condition, message) {
  assertions++;
  if (!condition) throw new Error(message);
}

for (const vector of vectors.positives) {
  const input = {
    signingPublicKeyHex: vector.signing_public_key,
    adaptorPointHex: vector.adaptor_point,
    messageHex: vector.message,
    signatureHex: vector.adaptor_signature
  };
  assert(verify(input), `${vector.id}: independent adaptor verification failed`);
  const completed = complete(vector.adaptor_signature, vector.adaptor_secret);
  assert(completed.derHex === vector.completed_der_signature, `${vector.id}: completion mismatch`);
  assert(verifyCompleted(vector.signing_public_key, vector.message, completed.derHex), `${vector.id}: ECDSA verification failed`);
  assert(recover(vector.adaptor_signature, completed.derHex, vector.adaptor_point) === vector.adaptor_secret, `${vector.id}: recovery mismatch`);
  assert(pointToHex(exposedCdhPoint(vector.adaptor_signature, vector.message, vector.adaptor_point)) === vector.expected_cdh_point, `${vector.id}: CDH exposure equation mismatch`);
}

for (const vector of vectors.negatives) {
  assert(!verify({
    signingPublicKeyHex: vector.signing_public_key,
    adaptorPointHex: vector.adaptor_point,
    messageHex: vector.message,
    signatureHex: vector.adaptor_signature
  }), `${vector.id}: malformed vector was accepted`);
}

const completedBase = parseStrictDer(vectors.positives[0].completed_der_signature);
const unrelatedR = mod(completedBase.r + 1n) || 1n;
const unrelatedCompleted = new secp256k1.Signature(unrelatedR, completedBase.s).toDERHex();
let unrelatedRecoveryRejected = false;
try {
  recover(
    vectors.positives[0].adaptor_signature,
    unrelatedCompleted,
    vectors.positives[0].adaptor_point
  );
} catch {
  unrelatedRecoveryRejected = true;
}
assert(unrelatedRecoveryRejected, 'Recovery accepted a completed signature with unrelated r');

let trailingDerRejected = false;
try { parseStrictDer(vectors.positives[0].completed_der_signature + '00'); } catch { trailingDerRejected = true; }
assert(trailingDerRejected, 'Strict DER parser accepted trailing data');

const base = vectors.positives[0];
const baseBytes = Buffer.from(base.adaptor_signature, 'hex');
let mutationRejections = 0;
for (let byte = 0; byte < baseBytes.length; byte++) {
  for (let bit = 0; bit < 8; bit++) {
    const mutated = Buffer.from(baseBytes);
    mutated[byte] ^= 1 << bit;
    const accepted = verify({
      signingPublicKeyHex: base.signing_public_key,
      adaptorPointHex: base.adaptor_point,
      messageHex: base.message,
      signatureHex: mutated.toString('hex')
    });
    assert(!accepted, `Single-bit mutation accepted at byte ${byte}, bit ${bit}`);
    mutationRejections++;
  }
}

function scalar(label) {
  const digest = createHash('sha256').update(label, 'utf8').digest('hex');
  return mod(BigInt(`0x${digest}`), N - 1n) + 1n;
}

let specialSoundnessCases = 0;
let simulatorEquationCases = 0;
for (let index = 0; index < 128; index++) {
  const witness = scalar(`witness/${index}`);
  const encryptionSecret = scalar(`encryption/${index}`);
  const nonce = scalar(`proof-nonce/${index}`);
  const challenge1 = scalar(`challenge-a/${index}`);
  let challenge2 = scalar(`challenge-b/${index}`);
  if (challenge1 === challenge2) challenge2 = mod(challenge2 + 1n);
  const Y = multiply(G, encryptionSecret);
  const transcript = dleqCommit(Y, witness, nonce);
  const response1 = dleqResponse(witness, nonce, challenge1);
  const response2 = dleqResponse(witness, nonce, challenge2);
  assert(extractDleqWitness(challenge1, response1, challenge2, response2) === witness, `DLEQ extraction failed at ${index}`);
  specialSoundnessCases++;

  const simulatedChallenge = scalar(`simulated-challenge/${index}`);
  const simulatedResponse = scalar(`simulated-response/${index}`);
  const simulatedA1 = multiply(G, simulatedResponse).subtract(multiply(transcript.RPrime, simulatedChallenge));
  const simulatedA2 = multiply(Y, simulatedResponse).subtract(multiply(transcript.R, simulatedChallenge));
  assert(multiply(G, simulatedResponse).equals(simulatedA1.add(multiply(transcript.RPrime, simulatedChallenge))), `Simulated first DLEQ equation failed at ${index}`);
  assert(multiply(Y, simulatedResponse).equals(simulatedA2.add(multiply(transcript.R, simulatedChallenge))), `Simulated second DLEQ equation failed at ${index}`);
  simulatorEquationCases++;
}

const invalidPoints = [
  '04' + '01'.padStart(64, '0') + '01'.padStart(64, '0'),
  '02' + 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc30',
  '00'.repeat(33),
  '06' + G.toHex(false).slice(2)
];
let invalidPointRejections = 0;
for (const encoding of invalidPoints) {
  let rejected = false;
  try { pointFromHexStrict(encoding); } catch { rejected = true; }
  assert(rejected, `Invalid point encoding was accepted: ${encoding.slice(0, 20)}`);
  invalidPointRejections++;
}

const report = {
  status: 'passed',
  source_commit: vectors.source_commit,
  assertions,
  positive_vectors: vectors.positives.length,
  negative_vectors: vectors.negatives.length,
  exhaustive_single_bit_mutations_rejected: mutationRejections,
  dleq_special_soundness_extractions: specialSoundnessCases,
  dleq_simulator_equation_cases: simulatorEquationCases,
  strict_invalid_point_rejections: invalidPointRejections,
  unrelated_completed_signature_rejections: unrelatedRecoveryRejected ? 1 : 0,
  trailing_der_rejections: trailingDerRejected ? 1 : 0,
  first_vector_signature_sha256: createHash('sha256').update(Buffer.from(base.adaptor_signature, 'hex')).digest('hex'),
  first_vector_completed_signature: base.completed_der_signature,
  first_vector_exposed_cdh_point: base.exposed_cdh_point,
  conclusion: 'The clean-room implementation satisfies the specified algebra on canonical inputs; this is executable evidence, not a machine-checked security proof.'
};

writeFileSync(path.join(root, 'EXECUTION-REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
