import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1';

export const N = secp256k1.CURVE.n;
export const P = secp256k1.CURVE.Fp.ORDER;
export const G = secp256k1.ProjectivePoint.BASE;
export const ZERO = secp256k1.ProjectivePoint.ZERO;

export function mod(value, modulus = N) {
  const result = value % modulus;
  return result >= 0n ? result : result + modulus;
}

export function invert(value, modulus = N) {
  let a = mod(value, modulus);
  if (a === 0n) throw new Error('Cannot invert zero');
  let b = modulus;
  let x = 0n;
  let y = 1n;
  let u = 1n;
  let v = 0n;
  while (a !== 0n) {
    const q = b / a;
    [x, u] = [u, x - q * u];
    [y, v] = [v, y - q * v];
    [b, a] = [a, b - q * a];
  }
  if (b !== 1n) throw new Error('Scalar is not invertible');
  return mod(x, modulus);
}

export function hexToBytes(hex, expectedLength) {
  if (typeof hex !== 'string' || !/^[0-9a-f]*$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error('Expected even-length hexadecimal');
  }
  const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`Expected ${expectedLength} bytes, received ${bytes.length}`);
  }
  return bytes;
}

export function bytesToHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

export function bytesToNumber(bytes) {
  const hex = bytesToHex(bytes);
  return hex ? BigInt(`0x${hex}`) : 0n;
}

export function numberToBytes(value, length = 32) {
  if (value < 0n || value >= (1n << BigInt(length * 8))) {
    throw new Error(`Integer does not fit in ${length} bytes`);
  }
  return hexToBytes(value.toString(16).padStart(length * 2, '0'), length);
}

export function concatBytes(...arrays) {
  const total = arrays.reduce((sum, item) => sum + item.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const item of arrays) {
    output.set(item, offset);
    offset += item.length;
  }
  return output;
}

export function sha256(bytes) {
  return Uint8Array.from(createHash('sha256').update(bytes).digest());
}

export function taggedHash(tag, message) {
  const tagHash = sha256(Buffer.from(tag, 'utf8'));
  return sha256(concatBytes(tagHash, tagHash, message));
}

export function scalarFromHex(hex, allowZero = false) {
  const value = bytesToNumber(hexToBytes(hex, 32));
  const minimum = allowZero ? 0n : 1n;
  if (value < minimum || value >= N) throw new Error('Non-canonical secp256k1 scalar');
  return value;
}

export function scalarToHex(value) {
  return bytesToHex(numberToBytes(value, 32));
}

export function pointToHex(point) {
  if (point.is0()) throw new Error('Point at infinity has no compressed encoding');
  return point.toHex(true);
}

export function pointFromHexStrict(hex) {
  const bytes = hexToBytes(hex, 33);
  if (bytes[0] !== 0x02 && bytes[0] !== 0x03) throw new Error('Compressed point prefix required');
  if (bytesToNumber(bytes.slice(1)) >= P) throw new Error('Point x-coordinate is out of range');
  const point = secp256k1.ProjectivePoint.fromHex(bytes);
  point.assertValidity();
  if (point.is0() || point.toHex(true) !== hex.toLowerCase()) throw new Error('Non-canonical point encoding');
  return point;
}

export function multiply(point, scalar) {
  const reduced = mod(scalar);
  return reduced === 0n ? ZERO : point.multiply(reduced);
}

export function publicKey(secretHex) {
  return pointToHex(multiply(G, scalarFromHex(secretHex)));
}

function challengeInput(Y, RPrime, R, A1, A2) {
  return concatBytes(
    G.toRawBytes(true),
    Y.toRawBytes(true),
    RPrime.toRawBytes(true),
    R.toRawBytes(true),
    A1.toRawBytes(true),
    A2.toRawBytes(true)
  );
}

export function adaptorNonce(signingSecretHex, adaptorPointHex, messageHex, auxiliaryHex) {
  const secret = hexToBytes(signingSecretHex, 32);
  scalarFromHex(signingSecretHex);
  const Y = pointFromHexStrict(adaptorPointHex);
  const message = hexToBytes(messageHex, 32);
  const auxiliary = hexToBytes(auxiliaryHex, 32);
  const auxiliaryHash = taggedHash('ECDSAadaptor/aux', auxiliary);
  const maskedSecret = Uint8Array.from(secret, (byte, index) => byte ^ auxiliaryHash[index]);
  let nonce = mod(bytesToNumber(taggedHash(
    'ECDSAadaptor/non',
    concatBytes(maskedSecret, Y.toRawBytes(true), message)
  )));
  if (nonce === 0n) nonce = 1n;
  return nonce;
}

export function proofNonce(nonce, Y, RPrime, R, auxiliaryHex) {
  const auxiliary = hexToBytes(auxiliaryHex, 32);
  let value = mod(bytesToNumber(taggedHash(
    'DLEQ',
    concatBytes(numberToBytes(nonce), Y.toRawBytes(true), RPrime.toRawBytes(true), R.toRawBytes(true), auxiliary)
  )));
  if (value === 0n) value = 1n;
  return value;
}

export function dleqChallenge(Y, RPrime, R, A1, A2) {
  return mod(bytesToNumber(taggedHash('DLEQ', challengeInput(Y, RPrime, R, A1, A2))));
}

export function encodeAdaptorSignature({ R, RPrime, sPrime, challenge, response }) {
  return bytesToHex(concatBytes(
    R.toRawBytes(true),
    RPrime.toRawBytes(true),
    numberToBytes(sPrime),
    numberToBytes(challenge),
    numberToBytes(response)
  ));
}

export function decodeAdaptorSignature(signatureHex) {
  const bytes = hexToBytes(signatureHex, 162);
  const R = pointFromHexStrict(bytesToHex(bytes.slice(0, 33)));
  const RPrime = pointFromHexStrict(bytesToHex(bytes.slice(33, 66)));
  const sPrime = bytesToNumber(bytes.slice(66, 98));
  const challenge = bytesToNumber(bytes.slice(98, 130));
  const response = bytesToNumber(bytes.slice(130, 162));
  if (sPrime < 1n || sPrime >= N) throw new Error('Invalid sPrime scalar');
  if (challenge >= N) throw new Error('Invalid challenge scalar');
  if (response >= N) throw new Error('Invalid response scalar');
  return { R, RPrime, sPrime, challenge, response };
}

export function encrypt({ signingSecretHex, adaptorSecretHex, adaptorPointHex, messageHex, auxiliaryHex }) {
  const x = scalarFromHex(signingSecretHex);
  const Y = adaptorSecretHex
    ? multiply(G, scalarFromHex(adaptorSecretHex))
    : pointFromHexStrict(adaptorPointHex);
  const resolvedAdaptorPointHex = pointToHex(Y);
  const messageBytes = hexToBytes(messageHex, 32);
  const m = bytesToNumber(messageBytes);
  const k = adaptorNonce(signingSecretHex, resolvedAdaptorPointHex, messageHex, auxiliaryHex);
  const RPrime = multiply(G, k);
  const R = multiply(Y, k);
  const r = mod(R.toAffine().x);
  if (r === 0n) throw new Error('Degenerate ECDSA r value');
  const sPrime = mod(invert(k) * mod(m + r * x));
  if (sPrime === 0n) throw new Error('Degenerate ECDSA sPrime value');
  const w = proofNonce(k, Y, RPrime, R, auxiliaryHex);
  const A1 = multiply(G, w);
  const A2 = multiply(Y, w);
  const challenge = dleqChallenge(Y, RPrime, R, A1, A2);
  const response = mod(w + challenge * k);
  const signatureHex = encodeAdaptorSignature({ R, RPrime, sPrime, challenge, response });
  return {
    signatureHex,
    signingPublicKeyHex: publicKey(signingSecretHex),
    adaptorPointHex: resolvedAdaptorPointHex,
    internals: { k, w, r, sPrime, challenge, response, R, RPrime, A1, A2 }
  };
}

export function verify({ signingPublicKeyHex, adaptorPointHex, messageHex, signatureHex }) {
  try {
    const X = pointFromHexStrict(signingPublicKeyHex);
    const Y = pointFromHexStrict(adaptorPointHex);
    const message = bytesToNumber(hexToBytes(messageHex, 32));
    const { R, RPrime, sPrime, challenge, response } = decodeAdaptorSignature(signatureHex);
    const A1 = multiply(G, response).subtract(multiply(RPrime, challenge));
    const A2 = multiply(Y, response).subtract(multiply(R, challenge));
    if (A1.is0() || A2.is0()) return false;
    if (dleqChallenge(Y, RPrime, R, A1, A2) !== challenge) return false;
    const r = mod(R.toAffine().x);
    if (r === 0n) return false;
    const inverseSPrime = invert(sPrime);
    const expectedRPrime = multiply(G, mod(message * inverseSPrime))
      .add(multiply(X, mod(r * inverseSPrime)));
    return expectedRPrime.equals(RPrime);
  } catch {
    return false;
  }
}

export function complete(signatureHex, adaptorSecretHex) {
  const y = scalarFromHex(adaptorSecretHex);
  const { R, sPrime } = decodeAdaptorSignature(signatureHex);
  const r = mod(R.toAffine().x);
  let s = mod(sPrime * invert(y));
  if (s > N / 2n) s = N - s;
  const signature = new secp256k1.Signature(r, s);
  return { derHex: signature.toDERHex(), compactHex: signature.toCompactHex(), r, s };
}

export function parseStrictDer(derHex) {
  const bytes = hexToBytes(derHex);
  const signature = secp256k1.Signature.fromDER(bytes);
  if (signature.toDERHex() !== derHex.toLowerCase()) throw new Error('Non-canonical DER signature');
  signature.assertValidity();
  return signature;
}

export function recover(signatureHex, completedDerHex, adaptorPointHex) {
  const { R, sPrime } = decodeAdaptorSignature(signatureHex);
  const completed = parseStrictDer(completedDerHex);
  const Y = pointFromHexStrict(adaptorPointHex);
  const expectedR = mod(R.toAffine().x);
  if (completed.r !== expectedR) throw new Error('Completed signature r does not match the pre-signature');
  const candidate = mod(sPrime * invert(completed.s));
  if (candidate !== 0n && multiply(G, candidate).equals(Y)) return scalarToHex(candidate);
  const alternate = mod(-candidate);
  if (alternate !== 0n && multiply(G, alternate).equals(Y)) return scalarToHex(alternate);
  throw new Error('Completed signature does not reveal the expected adaptor secret');
}

export function verifyCompleted(signingPublicKeyHex, messageHex, completedDerHex) {
  const signature = parseStrictDer(completedDerHex);
  return secp256k1.verify(signature, hexToBytes(messageHex, 32), hexToBytes(signingPublicKeyHex, 33), { lowS: true });
}

export function exposedCdhPoint(signatureHex, messageHex, adaptorPointHex) {
  const { R, sPrime } = decodeAdaptorSignature(signatureHex);
  const Y = pointFromHexStrict(adaptorPointHex);
  const m = bytesToNumber(hexToBytes(messageHex, 32));
  const r = mod(R.toAffine().x);
  const numerator = multiply(R, sPrime).subtract(multiply(Y, m));
  return multiply(numerator, invert(r));
}

export function dleqCommit(Y, witness, nonce) {
  return {
    RPrime: multiply(G, witness),
    R: multiply(Y, witness),
    A1: multiply(G, nonce),
    A2: multiply(Y, nonce)
  };
}

export function dleqResponse(witness, nonce, challenge) {
  return mod(nonce + challenge * witness);
}

export function extractDleqWitness(challenge1, response1, challenge2, response2) {
  if (challenge1 === challenge2) throw new Error('Distinct challenges are required');
  return mod((response1 - response2) * invert(challenge1 - challenge2));
}
