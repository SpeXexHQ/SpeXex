# ROD Private Adaptor Protocol Proof Experiment

This bundle is a clean-room experiment against `bellodox/rod-web-swap` commit:

```text
cb136d791c836c704a122278d00c7bfefde1a8b0
```

It specifies and independently implements the repository's private ECDSA adaptor-signature variant. It then generates vectors, cross-checks them against the wallet, and records a conditional cryptographic proof and audit.

## Folder contents

| Path | Purpose |
|---|---|
| [`README.md`](README.md) | entrypoint for the assessment bundle |
| [`SPECIFICATION.md`](SPECIFICATION.md) | byte-level normative specification of the private variant |
| [`SECURITY-PROOF.md`](SECURITY-PROOF.md) | assumptions, lemmas, theorem scope, and negative results |
| [`AUDIT.md`](AUDIT.md) | audit verdict and remediation guidance |
| [`EXECUTION-REPORT.md`](EXECUTION-REPORT.md) / [`EXECUTION-REPORT.json`](EXECUTION-REPORT.json) | human-readable and machine-readable run outputs |
| [`rod-web-swap-applied-cryptography-assessment.md`](rod-web-swap-applied-cryptography-assessment.md) | long-form assessment write-up |
| [`rod-web-swap-cryptographic-correctness-addendum.md`](rod-web-swap-cryptographic-correctness-addendum.md) | follow-up correctness notes |
| [`rod-web-swap-otc-crypto-verdict.md`](rod-web-swap-otc-crypto-verdict.md) | short verdict summary |
| [`src/private-adaptor-reference.mjs`](src/private-adaptor-reference.mjs) | clean-room implementation using `@noble/curves` |
| [`test/`](test/) | vector generation, attestation, and wallet cross-check scripts |
| [`vectors/private-adaptor-v1.json`](vectors/private-adaptor-v1.json) | deterministic positive and negative vectors |
| [`MANIFEST.sha256`](MANIFEST.sha256) | bundle-local integrity manifest |
| [`package.json`](package.json) and [`package-lock.json`](package-lock.json) | pinned Node dependency metadata for the assessment scripts |

## Result

The experiment establishes all of the following for **strictly validated, canonical secp256k1 inputs**:

- The adaptor pre-signature equations are correct.
- Completion always produces a valid low-S ECDSA signature.
- Recovery returns the adaptor witness, including low-S sign handling.
- The private DLEQ transcript is a valid Fiat-Shamir transform of the Chaum-Pedersen equality-of-discrete-logs proof.
- The extra generator and changed transcript order do not invalidate completeness, special soundness, or honest-verifier zero knowledge.
- The clean-room implementation reproduces the wallet byte-for-byte on all 16 deterministic vectors.

The experiment does **not** prove the deployed wallet production-secure:

- The wallet does not enforce the strict point-validation domain required by the proof.
- The construction publicly exposes the CDH point `xY` from `X`, `Y`, the message, and a valid pre-signature.
- The proof is conditional on random-oracle and base-signature assumptions and is not machine checked.
- The protocol remains linkable and unsafe to compose with ECDH or ElGamal under the same signing key.
- Protocol atomicity, chain observation, storage, and remote state transitions are outside the primitive theorem.

The final audit classification is:

> **Private DLEQ variant: conditionally proven. Full wallet implementation and OTC composition: not proven and not approved for production.**

## Files

| File | Purpose |
|---|---|
| `SPECIFICATION.md` | Byte-level normative specification of the private variant |
| `SECURITY-PROOF.md` | Assumptions, lemmas, conditional theorem, and negative results |
| `AUDIT.md` | Formal cryptographic audit report and remediation decision |
| `EXECUTION-REPORT.json` | Machine-readable test execution results |
| `vectors/private-adaptor-v1.json` | 16 positive and 23 targeted negative vectors |
| `src/private-adaptor-reference.mjs` | Clean-room implementation using `@noble/curves` |
| `test/generate-vectors.mjs` | Deterministic vector generator |
| `test/verify-vectors.mjs` | Independent, mutation, extraction, and malformed-input tests |
| `test/cross-check-wallet.mjs` | Differential checker against the frozen wallet code |
| `MANIFEST.sha256` | Bundle integrity manifest |

## Reproduce

Requirements: Node.js 18 or later and npm.

```bash
npm ci
npm run vectors
npm test
```

The default `npm test` cross-checks two wallet vectors because the wallet's legacy JavaScript curve arithmetic is slow. Execute all 16 in batches:

```bash
for offset in 0 2 4 6 8 10 12 14; do
  CROSS_CHECK_OFFSET=$offset CROSS_CHECK_LIMIT=2 node test/cross-check-wallet.mjs
done
```

Run those commands from [`proof/applied-cryptography-assessment/`](./). This bundle has its own isolated Node metadata and does not change the repository-wide no-build rule for the main wallet.

## Executed coverage

- 1,789 clean-room assertions
- 16 positive vectors
- 23 targeted negative vectors
- 1,296 rejected single-bit mutations, covering every bit of one 162-byte signature
- 128 DLEQ special-soundness witness extractions
- 128 simulated DLEQ transcript equation checks
- 4 strict malformed-point rejection classes
- 1 unrelated completed-signature recovery rejection
- 1 trailing-DER rejection
- 16 exact wallet generation matches
- 16 wallet attestation matches
- 16 wallet completion matches
- 16 wallet recovery matches
- 16 executable CDH-exposure checks

## Independence statement

The reference implementation:

- does not import wallet code;
- uses Node's SHA-256 and `@noble/curves` rather than the wallet's CryptoJS/jsbn/ellipticcurve stack;
- implements parsing, scalar arithmetic, nonces, DLEQ, completion, recovery, and CDH exposure separately;
- uses the wallet only in a separate differential test after vectors have been generated.

This is implementation independence, not institutional independence or accreditation.

## Research basis

- [One-Time Verifiably Encrypted Signatures, Fournier](https://github.com/LLFourn/one-time-VES/blob/master/main.pdf)
- [Generalized Channels and Adaptor Signatures, Aumayr et al.](https://eprint.iacr.org/2020/476)
- [Stronger Security and Generic Constructions, Dai et al.](https://eprint.iacr.org/2022/1687)
- [Foundations of Adaptor Signatures, Gerhart et al.](https://eprint.iacr.org/2024/1809)
- [Practical Adaptor Signatures, Hubacek, Maskova, and Richterova](https://eprint.iacr.org/2026/1482)
- [`secp256k1-zkp` ECDSA adaptor API](https://github.com/BlockstreamResearch/secp256k1-zkp/blob/master/include/secp256k1_ecdsa_adaptor.h)
- [SEC 1 version 2](https://www.secg.org/sec1-v2.pdf)

## Important interpretation

Passing the vectors proves conformance to the specification. The algebraic lemmas prove correctness on the specified domain. Neither activity alone proves security against every protocol adversary. The security document identifies exactly which claims follow from which assumptions and which desired properties are false.

## Relationship to the rest of the repository

- This folder is a documentation-and-evidence bundle, not part of the wallet runtime loaded by [`index.html`](../../index.html).
- Its local [`MANIFEST.sha256`](MANIFEST.sha256) complements, but does not replace, the repository-wide [`SHA256SUMS`](../../SHA256SUMS).
- If files in this bundle change, also refresh the repository inventory with [`node tests/update-checksums.js`](../../tests/update-checksums.js:1) and rerun [`bash tests/run-fast.sh`](../../tests/run-fast.sh:1).
