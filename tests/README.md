# Wallet and OTC proof gates

The test system has two layers. Both are release gates; neither contacts a live
chain or spends funds.

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
validated settlement matrix for every ordered pair of distinct certified
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
