# Cryptographic Correctness Addendum

## bellodox/rod-web-swap OTC swap

**Repository commit:** `cb136d791c836c704a122278d00c7bfefde1a8b0`  
**Assessment date:** 2026-07-31  
**Scope:** secp256k1 arithmetic use, ECDSA adaptor signatures, DLEQ proof, BIP340/Nostr signatures, nonce generation, public-key parsing, DER parsing, transaction sighashes, completion, and secret extraction.

## Bottom line

**I would not sign off that the cryptographic implementation is production-sound.**

The important nuance is that the **core adaptor-signature algebra is correct** and several adjacent operations agree with independent implementations. The production assurance claim still fails because:

1. The adaptor/DLEQ layer is custom JavaScript, not `secp256k1-zkp`.
2. Its DLEQ transcript is not compatible with the published DLC/Blockstream construction even though it uses the same 162-byte layout.
3. Attacker-controlled elliptic-curve inputs are not strictly validated or canonically encoded.
4. Secret-scalar operations run in legacy, variable-time JavaScript arithmetic.
5. The repository's tests are primarily self-consistency tests rather than independent conformance tests.

This is therefore a **conditional no-go**: the equations are promising, but the implementation and evidence are not strong enough for an OTC system carrying real value.

## What the repo actually uses

The repo uses a legacy JavaScript implementation of ordinary **secp256k1 curve arithmetic** in `js/ellipticcurve.js` and `js/coin.js`. It implements the adaptor signature and DLEQ proof itself in `js/ecdsa-adaptor.js`.

`secp256k1-zkp` is not a different curve. It is an extended, hardened C implementation that adds modules such as ECDSA adaptor signatures and their proofs. I used its adaptor module as an **independent reference oracle**. The repo does not import or execute it.

## Decision matrix

| Area | Result | Confidence | Meaning |
|---|---:|---:|---|
| Core adaptor equations | Pass | High | The pre-sign, complete, verify, and recover equations are internally correct. |
| Final ECDSA signature | Pass | High | Repo fixture is accepted by independent `@noble/curves`; low-S handling is correct. |
| Legacy `SIGHASH_ALL` | Pass, sampled | High for tested path | A constructed 2-of-2 claim digest exactly matched `bitcoinjs-lib`. |
| BIP340 for Nostr event IDs | Pass | High | All 15 official 32-byte-message attestation cases matched; all 8 signing vectors matched byte-for-byte. |
| Generic BIP340 API | Partial | High | Four valid official arbitrary-length-message vectors are rejected. NIP-01 signs a 32-byte event ID, so this does not break the current Nostr use. |
| DLC/`secp256k1-zkp` adaptor compatibility | Fail | High | Each implementation rejects the other's valid 162-byte fixture. |
| Public-key and point validation | Fail | High | Off-curve uncompressed points and non-canonical compressed encodings are accepted by the shared parser. |
| Scalar and DER canonicality | Fail | Medium | Adaptor scalar ranges and DER lengths/minimality are incompletely enforced. |
| Constant-time behavior | Fail | High | Secret arithmetic uses JS `BigInteger`, inversion, and multiplication with no constant-time guarantee. |
| Overall protocol composition | Fail | High | The separate full assessment found critical settlement/state/oracle issues outside the primitive equations. |

## Algebra review

The repo uses the standard one-time verifiably encrypted ECDSA shape:

\[
Y = yG,\quad R' = kG,\quad R = kY,\quad r = x(R) \bmod n
\]

\[
s' = k^{-1}(m + rx) \bmod n
\]

The verifier checks:

\[
R' \stackrel{?}{=} (s')^{-1}(mG + rX)
\]

Completion and extraction are:

\[
s = s'y^{-1} \bmod n,\qquad y = s's^{-1} \bmod n
\]

The implementation also handles ECDSA low-S normalization by checking both `y` and `n-y` during recovery. These equations match the `secp256k1-zkp` implementation.

Relevant code:

- `js/ecdsa-adaptor.js:148-246`
- `js/coin.js:394-418`
- `js/otc-engine.js:1206-1237`

## Independent test results

### 1. Repository fixture

The repository's deterministic adaptor fixture verifies internally, completes to a DER ECDSA signature, and recovers the expected adaptor secret.

**Result:** pass, but this only proves internal consistency because generation and attestation share the same code and custom transcript.

### 2. Final ECDSA signature

The completed DER signature from the repository fixture was independently attested with `@noble/curves` against the expected secp256k1 public key and 32-byte message hash.

**Result:** pass.

### 3. Transaction sighash

A version-2 transaction with one 2-of-2 redeem-script input, one output, non-final sequence, and locktime was hashed by both implementations:

```text
repo:          ffe52419f3f0f8187c715c3c24e70994cb1f8ec1e30c6e80ba041e1acdadb631
bitcoinjs-lib: ffe52419f3f0f8187c715c3c24e70994cb1f8ec1e30c6e80ba041e1acdadb631
```

**Result:** pass for the tested legacy `SIGHASH_ALL` path. This is not exhaustive coverage of every chain or sighash branch.

### 4. BIP340

The implementation was run against the official [BIP340 test vectors](https://github.com/bitcoin/bips/blob/master/bip-0340/test-vectors.csv):

- All 15 vectors with 32-byte messages produced the expected attestation result.
- All 8 vectors containing secret keys produced the exact expected signature.
- Four valid vectors using messages of length 0, 1, 17, and 100 bytes were rejected because the implementation requires exactly 32 bytes.

Nostr [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) signs the 32-byte SHA-256 event ID, so the restricted behavior is correct for this repo's current Nostr workflow. The function should still be documented as a Nostr-specific BIP340 profile, not a general BIP340 implementation.

### 5. Published DLC adaptor vector

The repo was tested with the valid DLC vector embedded in `secp256k1-zkp` and sourced from the DLC specifications:

- Serialized length: 162 bytes
- ECDSA pre-signature equation: **pass**
- Repo DLEQ attestation: **fail**
- Overall repo adaptor attestation: **fail**

The reverse test also failed: compiled `secp256k1-zkp` rejected the repo's deterministic 162-byte fixture.

**Result:** confirmed two-way incompatibility.

## Why the adaptor formats differ

Both formats serialize the same fields:

```text
R (33) || R' (33) || s' (32) || challenge (32) || response (32)
```

The Fiat-Shamir challenge transcript differs:

| Implementation | DLEQ challenge input after the `DLEQ` tag |
|---|---|
| DLC / `secp256k1-zkp` | `R' || Y || R || A1 || A2` |
| This repo | `G || Y || R' || R || A1 || A2` |

The proof nonce derivation also differs. The repo's variant is internally coherent and adding a fixed generator to the transcript is not, by itself, an algebraic break. The problem is assurance and specification: it is a custom protocol variant with no included proof, external vector set, version identifier, or interoperability marker.

The reference implementation explicitly says its challenge follows the DLC specification in [`dleq_impl.h`](https://github.com/BlockstreamResearch/secp256k1-zkp/blob/master/src/modules/ecdsa_adaptor/dleq_impl.h). A 2026 paper, [Practical Adaptor Signatures: Security and Applications](https://eprint.iacr.org/2026/1482), emphasizes that deployed ECDSA adaptor constructions require careful security definitions and composition reasoning. Internal round trips are not enough evidence.

### Finding CRYPTO-1: Custom, non-standard DLEQ transcript

**Severity:** High  
**Issue:** The repo uses the standard 162-byte envelope but a private proof transcript and nonce derivation.

**Why it matters:** A peer or future implementation can parse the message but reject the proof. More importantly, the repo inherits neither the exact published vectors nor the implementation assurance of the reference construction.

**Exploitation scenario:** This is not a demonstrated forgery. The practical immediate failure is settlement incompatibility or forced refund when implementations differ. The deeper risk is an undiscovered proof/composition flaw in a custom variant.

**Remediation:** Use the exact `secp256k1-zkp` adaptor construction through a reviewed WASM/native binding, or match its transcript byte-for-byte and import its positive and negative vectors. Add an explicit protocol version and algorithm identifier before any format change.

**Residual risk:** Even a conformant primitive still needs a protocol-level atomicity proof and independent audit.

## Point-validation failure

`coinjs.ecdsa.pointFromHex()` delegates to `decodePointHex()` without strict validation. The parser:

- Accepts uncompressed and hybrid encodings without checking that the point is on secp256k1.
- Does not reject compressed `x >= p`; field construction reduces it modulo `p`.
- Does not require canonical reserialization to equal the input.
- Contains a `validate()` helper whose subgroup logic uses the field prime rather than the subgroup order, and the helper is not called at these trust boundaries.

The audit harness confirmed:

- `04 || x=1 || y=1` is accepted as a point even though it is off-curve.
- A compressed encoding with `x = p + 1` is accepted and canonicalized to the point with `x = 1`.

The remote seller supplies `adaptorPoint`, and the receiver stores it without cryptographic validation in `js/otc-app-ui.js:3236-3255`. Before signing, `js/otc-engine.js:1212` checks only that its string length is at least 60 characters. Thus the parser defect is reachable from an authenticated but malicious counterparty.

[SEC 1 section 3.2.2.1](https://www.secg.org/sec1-v2.pdf) defines elliptic-curve public-key validation. BIP340 similarly requires `lift_x` to fail when `x >= p` or no square root exists.

### Finding CRYPTO-2: Attacker-controlled curve points are not strictly validated

**Severity:** High  
**Issue:** The adaptor point and other public points can reach secret-scalar multiplication without exact encoding and curve validation.

**Why it matters:** At minimum this enables deterministic protocol failure and forced refund after work has progressed. Invalid-curve inputs are also a classical key-leakage surface whenever secret scalars are multiplied by attacker-chosen points. I did not demonstrate full private-key recovery in this two-signature workflow, so that stronger impact remains unproven.

**Exploitation scenario:** A malicious authenticated seller publishes an off-curve 65-byte adaptor point. The buyer accepts and uses it to construct an adaptor signature. The peer cannot validate it under the canonical curve representation, stalling settlement. The resulting alternate-curve multiplication output also exposes information that should never be released without a dedicated invalid-curve analysis.

**Remediation:** At every external point boundary require:

1. Exactly 33 bytes.
2. Prefix `0x02` or `0x03` only.
3. `0 <= x < p`.
4. Successful square-root/decompression and on-curve check.
5. Non-infinity.
6. Canonical compressed reserialization identical to the input.
7. Scalar range checks before every multiplication.

Apply this to `Y`, `R`, `R'`, child signing keys, and all terms/redeem-script pubkeys before any secret operation or state transition.

**Residual risk:** Strict validation removes this input class, but JavaScript timing and memory-exposure risks remain.

## Parsing and canonicality

### Finding CRYPTO-3: Adaptor scalar and DER parsing is incomplete

**Severity:** Medium  
**Issue:** `deserialize()` does not explicitly enforce canonical ranges for every scalar. `parseDER()` does not enforce sequence length, minimal positive integer encoding, complete consumption, or BIP66 strictness.

**Why it matters:** Multiple encodings of the same mathematical value create cross-implementation disagreement. Lax local acceptance can also defer failure until chain broadcast.

**Exploitation scenario:** A peer sends a non-minimal or length-inconsistent signature that local parsing treats as usable but a strict node rejects. In the recovery path, matching the recovered point limits arbitrary-secret injection, but malformed encodings still create denial-of-service and divergent-state risk.

**Remediation:** Enforce `1 <= s' < n`, `0 <= c < n`, and `0 <= z < n`. Replace ad hoc DER parsing with strict BIP66 parsing, separately consume and validate the one-byte sighash type, and reject trailing bytes in bare-signature APIs.

**Residual risk:** Canonical parsing does not validate protocol intent; the exact sighash, transaction template, and peer identity must still be bound.

## Side-channel and key-separation review

### Finding CRYPTO-4: Secret arithmetic is variable-time JavaScript

**Severity:** Medium  
**Issue:** Signing, inversion, and scalar multiplication use legacy JavaScript `BigInteger` operations. Browser JITs and these algorithms do not provide a constant-time contract.

**Why it matters:** XSS, compromised dependencies, malicious extensions, shared-origin code, or sufficiently capable local observation can turn timing and memory behavior into key exposure. The same browser context also holds raw swap keys.

**Remediation:** Move secret operations into a small reviewed module built from hardened secp256k1 code, preferably isolated in a Worker with a narrow message API. Enforce a strict CSP, remove inline execution, pin dependencies, zero transient buffers where practical, and keep long-lived wallet material outside the swap UI process.

**Residual risk:** WebAssembly improves implementation reuse but does not automatically guarantee browser side-channel resistance or secure memory erasure.

### Finding CRYPTO-5: Adaptor signing keys need explicit purpose separation

**Severity:** Low, currently; High if the same child key is later used for ECDH/ElGamal  
**Issue:** One per-swap child key signs adaptor messages on both chains and also participates in ordinary ECDSA flows.

The [`secp256k1-zkp` adaptor API warning](https://github.com/BlockstreamResearch/secp256k1-zkp/blob/master/include/secp256k1_ecdsa_adaptor.h) states that an adaptor signature exposes the ECDH shared point between signing key `X` and encryption key `Y`. This does not reveal `x` by itself and the current repo does not visibly use that child key for ECDH, so no current break is established.

**Remediation:** Redesign the terms to derive separate hardened signing children for the ROD and alternate-chain scripts, plus an independent Nostr identity key. If claim and refund paths share a script key on one chain, keep that key signing-only. Never use an adaptor-signing child in ECDH, ElGamal, or encryption.

## What is done well

- Browser randomness fails closed when `crypto.getRandomValues` is unavailable.
- Private-key generation uses rejection sampling over the secp256k1 order.
- Adaptor nonce derivation masks the signing key with auxiliary randomness and uses distinct tagged hashes.
- A fresh 32-byte auxiliary value is supplied by the engine for each adaptor signature.
- The DLEQ proof binds both nonce points and the adaptor point in its own transcript.
- Received adaptor signatures are checked against the exact claim transaction sighash and expected signer public key.
- Claim signatures are attested locally in redeem-script key order before broadcast.
- ECDSA completion enforces low-S, and extraction handles the low-S sign ambiguity.
- Nostr event signing matches the BIP340 vectors relevant to NIP-01.
- The tested legacy transaction sighash matches an independent Bitcoin implementation.

## Required release gate

Before real-value use, CI should fail unless all of these pass:

1. Every positive and negative DLC/`secp256k1-zkp` adaptor vector.
2. Two-way cross-implementation generation, attestation, completion, and recovery.
3. Every official BIP340 vector with an explicit statement that the app profile signs only 32-byte Nostr IDs.
4. SEC 1 malformed-point corpus: infinity, off-curve, hybrid, wrong length, `x >= p`, non-residue, and non-canonical encodings.
5. Scalar boundaries: `0`, `n`, `n+1`, maximum 256-bit value, truncated values, and overflow encodings.
6. Strict DER/BIP66 positive and negative vectors.
7. Differential sighash tests against an independent implementation for claim and refund transactions on every supported chain.
8. Mutation tests proving any changed input, output, amount, fee, locktime, sequence, redeem script, sighash type, signer key, or adaptor point invalidates the relevant signature.
9. Browser tests showing malformed remote values are rejected before persistence and before any secret-scalar operation.
10. A third-party cryptographic implementation audit and a separate protocol/composition review.

## Priority remediation order

1. **Stop treating the current custom adaptor format as production-ready.** Pick exact DLC/`secp256k1-zkp` compatibility or publish and review a versioned custom specification.
2. **Implement strict canonical point and scalar parsing before all curve operations.**
3. **Move secret arithmetic out of legacy JavaScript into a reviewed hardened implementation.**
4. **Add independent vectors and differential tests to the release gate.**
5. **Use purpose- and chain-specific hardened child keys.**
6. **Resolve the protocol-level critical findings from the full applied-cryptography assessment before funding can be enabled.**

## Final professional opinion

The implementation is better than a superficial "custom crypto" label suggests: the adaptor equations, nonce structure, low-S completion, extraction logic, Nostr signatures, and tested transaction digest are all technically coherent.

That is not enough for a positive cryptographic sign-off. The custom DLEQ transcript, confirmed failure against the established adaptor vectors in both directions, externally reachable point-validation defects, permissive parsers, and variable-time secret arithmetic leave too much unproven behavior at the exact boundary where OTC funds depend on correctness.

**Current verdict: core math conditionally sound; cryptographic implementation assurance unsound for production.**

## Test limitations

- Review was performed against the exact commit listed above.
- The differential sighash test sampled the legacy `SIGHASH_ALL` path; it was not exhaustive for every chain-specific rule.
- No mainnet transaction was created or broadcast.
- No browser microarchitectural side-channel experiment was attempted.
- No full invalid-curve private-key extraction was demonstrated; the point-validation finding is based on confirmed parser reachability plus established validation requirements.
- This addendum does not replace a formal proof or an independent professional implementation audit.
