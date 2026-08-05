# Formal Cryptographic Audit

## ROD Private ECDSA Adaptor Signature v1

**Audit type:** Experimental independent cryptographic review  
**Target:** `bellodox/rod-web-swap`  
**Commit:** `cb136d791c836c704a122278d00c7bfefde1a8b0`  
**Date:** 2026-07-31  
**Auditor posture:** No involvement in the protocol or wallet implementation  
**Accreditation:** None; this is not a attested commercial audit

## 1. Executive verdict

The private DLEQ variant is not merely an unexplained collection of equations anymore. This experiment supplies:

- a byte-level specification;
- a clean-room implementation on an unrelated secp256k1 stack;
- deterministic positive and negative vectors;
- exhaustive single-bit mutation tests;
- exact differential tests against the frozen wallet;
- algebraic proofs of correctness, adaptation, and extraction;
- a classical-ROM proof argument for the private DLEQ transcript; and
- an executable proof of the known CDH exposure.

### Sign-off decision

| Target | Decision |
|---|---|
| Private DLEQ transcript on canonical secp256k1 inputs | **Conditionally supported** |
| Core adaptor correctness and extraction | **Proven algebraically and tested independently** |
| Restricted adaptor unforgeability | **Plausible conditional transfer, not independently completed as a full reduction** |
| Broad adaptor/VES security | **Not satisfied** |
| Current JavaScript implementation | **Not approved** |
| Complete OTC swap protocol | **Not approved** |

The private transcript order itself is not the critical cryptographic weakness. Its Chaum-Pedersen proof properties survive the changed encoding. The release blockers are the implementation's failure to enforce the proof domain, known ECDSA-adaptor CDH exposure, missing version/domain controls, variable-time secret arithmetic, and unresolved protocol-composition findings.

## 2. Scope

### Included

- secp256k1 group and scalar domain
- point and scalar encodings
- main nonce derivation
- proof nonce derivation
- DLEQ statement, transcript, response, and attestation
- adaptor pre-signature generation and attestation
- serialization
- ECDSA completion and low-S handling
- adaptor-witness recovery
- strict DER requirements
- CDH exposure
- key reuse and cross-protocol composition
- independent vector and mutation testing

### Excluded

- full browser attack surface
- local storage and wallet-unlock security
- Nostr relay availability and privacy
- chain API trust and reorganization handling
- refund and state-machine correctness
- smart-contract or consensus validation on live networks
- constant-time binary analysis
- machine-checked proof assistants

Those excluded areas still affect whether the OTC swap is secure.

## 3. Methodology

1. Froze the exact repository commit.
2. Reconstructed the primitive from code without relying on repository test descriptions.
3. Compared it with Fournier's ECDSA one-time VES and `secp256k1-zkp`.
4. Studied the evolution of adaptor-signature security definitions through 2026.
5. Wrote an independent implementation using Node SHA-256 and `@noble/curves`.
6. Generated deterministic vectors before loading wallet code.
7. Differentially executed generation, attestation, completion, and recovery against the wallet.
8. Tested malformed inputs, every single-bit mutation of one serialized signature, proof extraction, proof simulation equations, final ECDSA validity, and CDH exposure.
9. Proved supported properties algebraically and identified false or conditional properties.
10. Audited whether the deployed implementation satisfies the proof assumptions.

## 4. Independent execution evidence

| Test | Result |
|---|---:|
| Clean-room assertions | 1,789 passed |
| Positive vectors | 16 passed |
| Targeted negative vectors | 23 rejected |
| Single-bit signature mutations | 1,296 rejected |
| DLEQ witness extractions | 128 passed |
| DLEQ simulator equation cases | 128 passed |
| Strict malformed-point classes | 4 rejected |
| Unrelated completed-signature recovery | 1 rejected |
| Trailing DER input | 1 rejected |
| Exact wallet generation comparisons | 16 matched |
| Wallet attestation comparisons | 16 matched |
| Wallet completion comparisons | 16 matched |
| Wallet recovery comparisons | 16 matched |
| CDH exposure equations | 16 matched |

No accepted forgery or algebraic inconsistency was found in the canonical-input model.

## 5. Formal result

The private proof hashes:

```text
G || Y || R' || R || A1 || A2
```

instead of the DLC transcript:

```text
R' || Y || R || A1 || A2
```

This change creates a different Fiat-Shamir protocol, but it does not change the underlying Sigma relation:

```text
R' = kG and R = kY
```

For canonical fixed-length encodings:

- completeness follows by substitution;
- special soundness extracts `k` from two challenges;
- honest-verifier zero knowledge follows from choosing `(c,z)` and reconstructing commitments;
- the classical forking argument gives Fiat-Shamir knowledge extraction in the random-oracle model.

The detailed argument is in `SECURITY-PROOF.md`.

## 6. Findings

### AUD-01: The deployed implementation violates the proven input domain

**Severity:** High  
**Status:** Confirmed

**Issue.** The proof assumes every point is a canonical member of the prime-order secp256k1 group. The wallet's shared parser accepts uncompressed off-curve points without validation and reduces non-canonical compressed x-coordinates modulo the field prime. Remote `adaptorPoint` handling checks only a loose string length before secret-scalar multiplication.

**Evidence.** The previous audit executed both malformed cases against the wallet parser. The hardened clean-room parser rejects them.

**Impact.** The formal group proof is inapplicable to those executions. A malicious authenticated counterparty can at least force cryptographic failure and refunds. Invalid-curve multiplication is also a key-leakage class that must never be exposed to analysis by assumption.

**Remediation.** Enforce the point decoder in `SPECIFICATION.md` before persistence and before any multiplication. Require exact canonical reserialization. Apply it to `Y`, `R`, `R'`, signing keys, and redeem-script keys.

**Residual risk.** Strict parsing does not fix timing, faults, or protocol state.

### AUD-02: Broad confidentiality/composability security is impossible

**Severity:** High  
**Status:** Proven

**Issue.** Every valid pre-signature exposes:

```text
xY = r^(-1)(s'R - mY)
```

**Impact.** The same signing key cannot safely be used in ECDH, ElGamal, or any protocol requiring the CDH point between `X` and `Y` to remain hidden. The scheme cannot satisfy broad VES opacity. Reuse can turn this exposure into complete confidentiality failure in another protocol.

The holder of `y` can already compute `yX`, so the formula does not give that counterparty a new capability. It exposes the point to relay observers and other transcript recipients who know neither secret.

**Evidence.** The clean-room suite computes the public expression and compares it with test-secret `xY` on all 16 vectors.

**Remediation.** Derive hardened, signing-only, purpose- and chain-specific children. Enforce a key-usage registry or type boundary preventing adaptor-signing keys from entering ECDH or encryption APIs.

**Residual risk.** Public `xY` remains an inherent output of this ECDSA adaptor construction even with perfect key separation.

### AUD-03: The wire format is ambiguous across adaptor variants

**Severity:** High  
**Status:** Confirmed

**Issue.** The wallet uses the same 162-byte field layout as `secp256k1-zkp` but a different proof transcript. There is no version byte or algorithm identifier.

**Impact.** An implementation can parse a pre-signature while interpreting it under the wrong proof system. Mixed clients fail during settlement and may be forced into refund behavior. Silent future changes could create downgrade or confusion attacks.

**Remediation.** Assign an explicit protocol identifier in authenticated swap terms and include it in every message. A future wire revision should include a version byte and use versioned proof tags. Do not reinterpret deployed 162-byte objects as DLC signatures.

**Residual risk.** Existing stored sessions remain ambiguous and need migration handling.

### AUD-04: Secret arithmetic has no constant-time guarantee

**Severity:** Medium  
**Status:** Confirmed

**Issue.** The wallet uses legacy JavaScript `BigInteger`, modular inversion, and point multiplication for secret values.

**Impact.** Browser JIT behavior, same-origin malicious code, XSS, extensions, and local observation can invalidate the black-box cryptographic model.

**Remediation.** Use a reviewed hardened secp256k1 implementation through a narrow Worker/WASM boundary, strict CSP, pinned dependencies, and isolated key material. Treat WASM as implementation reuse, not automatic side-channel proof.

**Residual risk.** Browsers do not provide general constant-time or guaranteed memory-erasure contracts.

### AUD-05: No mandatory signer self-attestation

**Severity:** Medium  
**Status:** Confirmed

**Issue.** Generation returns the pre-signature without independently verifying the serialized object before release.

**Impact.** Transient faults, memory corruption, and implementation mistakes may emit malformed relationships involving a secret nonce. Fault behavior is outside the security proof and can be more dangerous than ordinary rejection.

**Remediation.** Serialize, strictly parse, and verify `(X,Y,m,pre)` before network publication. Fail closed and destroy the session signing child on any self-check failure.

**Residual risk.** Self-attestation catches output faults but does not guarantee fault-resistant scalar computation.

### AUD-06: Scalar, DER, and recovery parsing are not fully canonical

**Severity:** Medium  
**Status:** Confirmed

**Issue.** Wallet adaptor deserialization does not explicitly enforce every scalar range. Its DER parser does not enforce all sequence lengths, minimal positive integers, or complete consumption. Recovery does not first bind the completed signature's `r` to the encrypted `R`.

**Impact.** Implementations can disagree on malformed data, local recovery can act on an unrelated signature, and chain rejection may happen after local acceptance.

**Remediation.** Implement strict scalar ranges, BIP66 DER, an explicit sighash-byte layer, and an `r` equality check before recovery.

**Residual risk.** Canonical parsing cannot compensate for a wrong transaction digest or peer identity.

### AUD-07: DLEQ hash roles lack explicit domain tags

**Severity:** Low  
**Status:** Confirmed

**Issue.** Both proof nonce and challenge use the `DLEQ` tag.

**Analysis.** Their fixed input lengths differ, so current inputs cannot collide literally across roles. No attack was found from this reuse.

**Remediation.** In a versioned revision use distinct tags such as:

```text
ROD/OTC/adaptor/v2/proof-nonce
ROD/OTC/adaptor/v2/challenge
```

**Residual risk.** Changing tags breaks byte compatibility and requires explicit version negotiation.

### AUD-08: The scheme is linkable by design

**Severity:** Informational  
**Status:** Proven

**Issue.** The pre-signature's `R` and final ECDSA signature share the same x-derived `r`.

**Impact.** Anyone who obtains the off-chain pre-signature can link it to the chain signature. This may conflict with privacy expectations but does not break atomic extraction.

**Remediation.** Document this property, minimize transcript disclosure, and avoid plaintext archival. Do not advertise unlinkability.

## 7. Threat perspectives

| Viewpoint | Main concern | Audit result |
|---|---|---|
| Malicious seller | Chosen adaptor point, terminal-message manipulation | Strict point validation missing; broader state issues remain |
| Malicious buyer | Forged or mismatched pre-signature | Canonical-domain verifier is sound under stated assumptions |
| Relay observer | Linkage and CDH point collection | Both are possible by design |
| Browser attacker | Timing, memory, and injected script | Outside proof; current architecture exposed |
| Cross-chain attacker | Key and message-domain reuse | Chain-specific keys and explicit protocol IDs absent |
| Implementer | Confusing private and DLC 162-byte formats | Confirmed two-way incompatibility |
| Formal methods reviewer | Security-definition mismatch | Only restricted modern claim is plausible |
| Operations team | Recovery after partial failure | Primitive proof does not cover state/oracle failures |

## 8. Required remediation gate

Production funding should remain disabled until:

1. Strict point, scalar, DER, and recovery parsing is implemented.
2. All bundle vectors run in CI against the production implementation.
3. Every 1-bit mutation remains rejected by the production verifier.
4. Signing output is self-verified before release.
5. Purpose- and chain-specific signing-only children are deployed.
6. A protocol/version identifier is authenticated in terms and messages.
7. Secret operations move to a hardened implementation boundary.
8. The complete swap protocol receives a separate chain/state proof and adversarial integration audit.
9. A human cryptographer independently checks the full 2026 relaxed-security reduction against this DLEQ substitution.
10. Live-chain claim and refund transactions are differentially attested on every supported network.

## 9. Final professional opinion

The experiment successfully upgrades the private variant from "only internally self-tested" to "specified, independently reproduced, and conditionally argued." It also narrows the uncertainty: the non-standard ordering of the DLEQ transcript is not an evident mathematical break.

It does not upgrade the wallet to production-safe. The strongest honest conclusion is:

> **The core private adaptor construction is algebraically correct and its DLEQ substitution is conditionally sound in the classical random-oracle model. The deployed implementation violates proof preconditions, and the construction has inherent CDH-exposure and linkability limits. Production approval is denied pending remediation and an independent check of the complete modern reduction and OTC composition.**

## 10. Sources

- [Fournier, One-Time Verifiably Encrypted Signatures](https://github.com/LLFourn/one-time-VES/blob/master/main.pdf)
- [Aumayr et al., Generalized Channels and Adaptor Signatures](https://eprint.iacr.org/2020/476)
- [Dai, Okamoto, and Yamamoto, Stronger Security and Generic Constructions](https://eprint.iacr.org/2022/1687)
- [Gerhart et al., Foundations of Adaptor Signatures](https://eprint.iacr.org/2024/1809)
- [Hubacek, Maskova, and Richterova, Practical Adaptor Signatures](https://eprint.iacr.org/2026/1482)
- [`secp256k1-zkp` adaptor interface and composition warning](https://github.com/BlockstreamResearch/secp256k1-zkp/blob/master/include/secp256k1_ecdsa_adaptor.h)
- [`secp256k1-zkp` DLEQ implementation](https://github.com/BlockstreamResearch/secp256k1-zkp/blob/master/src/modules/ecdsa_adaptor/dleq_impl.h)
- [BIP340 exact transcript and encoding rationale](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki)
- [SEC 1 public-key validation](https://www.secg.org/sec1-v2.pdf)
- [BIP66 strict DER](https://github.com/bitcoin/bips/blob/master/bip-0066.mediawiki)
