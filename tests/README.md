# Wallet and OTC proof gates

The test system has two layers. Both are release gates; neither contacts a live
chain or spends funds.

## Folder contents

- [`run-fast.sh`](run-fast.sh) — convenience wrapper that runs the fast deterministic gate from the repository root
- [`release-gate.js`](release-gate.js) — release wiring, asset inventory, script-order, CSP, and static-shell checks
- [`explorer-contract.js`](explorer-contract.js) — explorer backend normalization and retry/coalescing coverage
- [`security-regression.js`](security-regression.js) — OTC protocol adversarial and regression cases
- [`wallet-balance-race.js`](wallet-balance-race.js) — wallet API switching, stale callback, and configuration-isolation checks
- [`mutation-gate.js`](mutation-gate.js) — negative-control mutations that prove key tests can actually fail
- [`update-checksums.js`](update-checksums.js) — regenerates [`SHA256SUMS`](../SHA256SUMS)
- [`harness/`](harness/) — full Playwright/browser settlement harness and independent broadcast verifier

## Fast deterministic gate

Run from the repository root:

```bash
bash tests/run-fast.sh
```

This needs Node.js only and covers:

- release integrity: missing assets, JavaScript syntax, script order, merge
  markers, SHA-256 inventory, version identity, service-worker completeness,
  CSP/API alignment, duplicate selector IDs, support-registry drift, and
  agreement between production refund/confirmation/fee policy and the browser
  settlement matrix;
- explorer contracts: Esplora, BlockCypher, Blockchair, and Blockbook response
  normalization, malformed responses, broadcast shapes, request coalescing,
  and retry isolation after failure;
- protocol adversarial cases: unsigned/tampered Nostr events, signer-to-ROD
  binding, canonical terms mismatch, refund-order timing and boundary cases,
  and bilateral DOGE reconstruction;
- wallet races: DGB → ROD/LTC switching, address changes, late callbacks,
  DGB wallet routing, service-worker identity, and protocol-v1 config isolation;
- negative controls: seven deliberate blocker mutations must make the relevant
  tests fail. A suite that still passes after its guard is removed is itself
  considered broken.

Use `SKIP_MUTATIONS=1` only for a quick local edit loop. CI runs mutations.

This layer is the right default after documentation edits because repository rules treat [`SHA256SUMS`](../SHA256SUMS) as release inventory and require the fast gate after final source or durable-doc changes.

## Full browser and settlement gate

Install the pinned dependencies and Chromium:

```bash
cd tests/harness
npm ci
npx playwright install --with-deps chromium
bash run-all.sh
```

In addition to the fast gate, this loads the unmodified `index.html` in real
Chromium, checks browser globals and DOM wiring, installs the service worker,
reloads the full shell offline, and runs two peers through the independently
validated settlement matrix for every ordered pair of distinct attested
chains in the shipped OTC registry.

For each current ROD/LTC/DOGE ordered pair, the matrix runs:

- happy settlement;
- seller/asset-leg refund;
- buyer/payment-leg refund;
- mid-swap reload and recovery.

BTC, BCH, and DGB remain wallet-only in this release. The release gate requires
the OTC definitions, fee table, engine defaults, e2e registry, UI selector, and
matrix runner to agree, so a future chain cannot be half-added.

Reports are written as `tests/harness/e2e-report-<asset>-<payment>-<scenario>.json`.
Failed scenarios write the same report before exiting, including page/session
diagnostics and unexpected browser console, request, and HTTP errors.

## Typical workflow for this folder

1. From the repository root, refresh [`SHA256SUMS`](../SHA256SUMS) with [`node tests/update-checksums.js`](update-checksums.js:1) after final documentation or source edits.
2. Run [`bash tests/run-fast.sh`](run-fast.sh:1) for the required local release gate.
3. Before shipping a release, move into [`tests/harness/`](harness/) and run the sequential browser matrix documented in [`tests/harness/README.md`](harness/README.md).
