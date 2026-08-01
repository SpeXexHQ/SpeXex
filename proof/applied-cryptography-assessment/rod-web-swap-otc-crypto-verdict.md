# Cryptographic Verdict for the ROD OTC Swap Protocol

## Short verdict

The current protocol can be used for its intended purpose: a narrow, purpose-built OTC swap that uses an ECDSA adaptor signature on secp256k1.

The core cryptographic flow works. A party can verify the pre-signature, the holder of the adaptor secret can complete it into a valid ECDSA signature, and the completed signature reveals the adaptor secret to the other party. Independent test vectors and checks confirmed that these parts are mathematically consistent with the current implementation.

This verdict is deliberately narrow. The protocol should not be described as a general encrypted-signature system, as universally private, or as safe to combine with arbitrary cryptographic protocols.

## What is acceptable in this specific OTC use

For the one defined OTC workflow, the protocol provides the properties that matter:

- The recipient can check a pre-signature before relying on it.
- A valid completed signature requires knowledge of the agreed adaptor secret.
- Once that signature appears, the counterparty can recover the adaptor secret and use that fact in the swap workflow.
- The protocol is based on ordinary secp256k1 ECDSA and does not require adopting `secp256k1-zkp`, an external service, an oracle, or additional network rounds.

The fact that the implementation is a private variant does not make it automatically unsound. Its DLEQ proof transcript has a custom hash layout, so it is its own protocol format and must be maintained as such. The independent specification and vector corpus are the basis for doing that safely.

## Boundaries that must remain true

The signing key used in this protocol must not also be used for ECDH, ECIES, ElGamal, or another protocol that expects the shared point between the signing key and adaptor public key to remain secret. This is a known property of practical ECDSA adaptor signatures, not a weakness unique to ROD.

The protocol also deliberately makes a pre-signature linkable to the final signature. That is acceptable for this OTC flow if the participants and product design accept it.

These are not requests to add an external system. A wallet can derive a local, swap-only key from its existing seed using a separate derivation path. The key separation is a local design rule.

## Required implementation controls

Before the protocol carries meaningful production value, the current code should enforce the following:

- Reject malformed, off-curve, non-canonical, and wrong-length points and scalars.
- Strictly parse DER signatures and reject trailing or ambiguous encodings.
- Verify every generated pre-signature locally before it is sent.
- Verify that a completed signature has the expected nonce-derived `r` value before attempting secret recovery.
- Freeze and version the private 162-byte encoding and DLEQ transcript.
- Run the independent vectors and negative tests in continuous integration.

These are implementation hardening requirements. They do not change the OTC protocol's intended user flow or introduce an outside dependency.

## What is not claimed

The protocol does not claim that a pre-signature reveals no useful information in every possible setting. In particular, an ECDSA adaptor transcript exposes a shared curve point between the signing key and adaptor key. That is harmless for the defined OTC use when the key-separation rule is followed, but it prevents a broad claim of universal privacy or general composability.

The protocol also does not yet have the confidence level of a mature, independently reviewed, broadly deployed cryptographic library. The construction has an independent specification, vectors, and an audit argument, but a focused external cryptographic and implementation review remains the appropriate final gate for large-value production use.

## Decision

Use is reasonable for the defined, single-purpose OTC adaptor-signature workflow after the listed validation and format hardening is in place. Keep the protocol scope narrow, keep its signing key local and dedicated to this role, and do not market it as a universal privacy or encryption primitive.
