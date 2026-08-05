# Execution Report

## Environment

```text
Target commit: cb136d791c836c704a122278d00c7bfefde1a8b0
Execution date: 2026-07-31
Independent curve library: @noble/curves 1.9.7
Hash implementation: Node.js SHA-256
Wallet curve stack: jsbn/ellipticcurve.js, used only by differential test
```

## Commands

```bash
npm install
npm run vectors
npm test
for offset in 0 2 4 6 8 10 12 14; do
  CROSS_CHECK_OFFSET=$offset CROSS_CHECK_LIMIT=2 node test/cross-check-wallet.mjs
done
```

## Clean-room result

```json
{
  "status": "passed",
  "assertions": 1789,
  "positive_vectors": 16,
  "negative_vectors": 23,
  "exhaustive_single_bit_mutations_rejected": 1296,
  "dleq_special_soundness_extractions": 128,
  "dleq_simulator_equation_cases": 128,
  "strict_invalid_point_rejections": 4,
  "unrelated_completed_signature_rejections": 1,
  "trailing_der_rejections": 1,
  "first_vector_signature_sha256": "3917b4a1cced0f00f39f8f74e7cb69cf6db9eb4ba750b7096c103ec50f0e8db8"
}
```

## Differential result

All 16 vectors were executed against the frozen wallet in batches of two:

```text
exact wallet generation matches: 16/16
wallet attestation matches:      16/16
wallet completion matches:        16/16
wallet recovery matches:          16/16
```

The first clean-room vector exactly reproduces the repository's existing deterministic fixture:

```text
adaptor signature SHA-256:
3917b4a1cced0f00f39f8f74e7cb69cf6db9eb4ba750b7096c103ec50f0e8db8

completed DER signature:
3045022100cab4d4dd287fe36a0df16b77f67f2d2b640543c2dd98ceb80403617f2ecd2de2022041a4ac72eb9b6cf2ab7a6f8fc7aa70847e8fc296c661c23a41eab9f7dde86424

publicly exposed CDH point xY:
025e7c1c7d9b4f8ecb70f307b955e75124caaad275c2555d511e8c6751e928a196
```

## Mutation strategy

For the first 162-byte positive pre-signature, the test flips each bit independently:

```text
162 bytes * 8 bits = 1,296 malformed signatures
```

Every mutation was rejected by the strict clean-room verifier.

Targeted negatives additionally cover:

- wrong message;
- wrong signing key;
- wrong adaptor point;
- truncated and extended signatures;
- invalid point prefixes;
- zero or out-of-range `s'`;
- out-of-range challenge and response; and
- mutations at every serialized field boundary.

## Proof-property execution

The test does not merely round-trip signatures:

- It extracts the DLEQ witness from two accepting Sigma transcripts in 128 cases.
- It constructs simulated `(c,z)` transcripts and verifies both group equations in 128 cases.
- It completes every positive pre-signature and verifies the result as strict low-S ECDSA.
- It recovers every adaptor witness.
- It computes the public CDH expression `r^(-1)(s'R-mY)` and confirms equality to `xY` on every positive vector.

## Interpretation

These results provide strong executable evidence of conformance, algebraic correctness, mutation sensitivity, and the negative CDH property. They do not supply a machine-checked security reduction, constant-time evidence, or a proof of the complete OTC state machine.
