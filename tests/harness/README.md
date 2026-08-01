# Real-browser settlement harness

The harness runs the actual static wallet in isolated Chromium contexts against
local mock settlement-chain APIs, a separate ROD control-plane API when needed,
and a local NIP-01 relay. Production application files are not replaced by test
doubles. The full runner discovers every ordered pair of distinct certified
chains from the production registry.

## Folder contents

- [`package.json`](package.json) — pinned Playwright and verifier dependencies plus `test`, `test:fast`, and `test:full` scripts
- [`run-all.sh`](run-all.sh) — sequential top-level runner for the full matrix
- [`unit-browser-test.js`](unit-browser-test.js) — fast browser/registry invariants gate reused by release validation
- [`e2e-swap-test.js`](e2e-swap-test.js) — one end-to-end settlement or refund scenario between two peers
- [`mock-infra.js`](mock-infra.js) — local mock chain APIs, relay helpers, and scenario infrastructure
- [`e2e-report.json`](e2e-report.json) — sample/latest harness summary artifact checked into the folder
- generated `e2e-report-<asset>-<payment>-<scenario>.json` files — scenario-level diagnostics emitted by [`run-all.sh`](run-all.sh:1) or direct single-scenario runs

Every broadcast is parsed and independently checked with `bitcoinjs-lib` and
`@noble/curves`: prevouts, signatures, sighash type, 2-of-2 CHECKMULTISIG
ordering, value conservation, dust, relay/mining fee, `nLockTime`, and
pre-finality rejection are verified outside the wallet code that created the
transaction.

The matrix uses the same refund delays, confirmation counts, and canonical
fees as the shipped production defaults. The fast release gate fails if those
values drift. Unexpected page errors, failed requests, and HTTP failures fail
the scenario; the only allowed 404 is the deliberate pre-index transaction
probe used by settlement polling.

Before a settlement scenario starts, the harness proves that Alice and Bob
have independent browser storage, wallet identities, swap xpubs, Nostr keys,
and empty session stores. Chromium `--single-process` mode is rejected by the
two-peer settlement runner because it invalidates that isolation; the
single-context shell/PWA gate can still run in that mode. The pre-funding handshake uses separate,
role-aware deadlines for readiness, adaptor commitment, funding plans, refund
signatures, adaptor signatures, local PREPARED, and remote PREPARED. A timeout
report names the exact missing prerequisites and includes pending signature
slots plus relay event counts grouped by message type and signer.

## Run

```bash
npm ci
npx playwright install --with-deps chromium
bash run-all.sh
```

Run those commands from [`tests/harness/`](./). This folder is the only part of the repository with its own [`package.json`](package.json); the main wallet stays build-free and static.

Useful controls:

- `FAST_ONLY=1 bash run-all.sh` — Node-only contracts and mutations.
- `SKIP_MUTATIONS=1 bash run-all.sh` — avoid repeating mutations after a
  separate fast-gate job.
- `ASSET_CHAIN=LTC PAYMENT_CHAIN=DOGE SCENARIO=happy node e2e-swap-test.js` — one scenario.
- `ASSET_CHAIN=DOGE PAYMENT_CHAIN=ROD SCENARIO=altrefund node e2e-swap-test.js` — payment-side refund with reversed roles.
- `ALT_CHAIN=LTC` remains a compatibility alias for `PAYMENT_CHAIN=LTC` when
  the asset chain is the default ROD.
- `RELOAD_TEST=1` with `SCENARIO=happy` — mid-swap persistence/replay.
- `DOGE_ROD_REFUND_REPEATS=5 bash run-all.sh` — run the complete matrix and
  require five total passes of the historically flaky ROD/DOGE asset-refund case
  (default: 3, maximum: 20).
- `PROTOCOL_STAGE_TIMEOUT_MS=60000` — change each pre-funding stage deadline
  without returning to one opaque aggregate timeout.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium` — use a preinstalled
  browser.
- `PLAYWRIGHT_CHROMIUM_ARGS_JSON='["--flag"]'` — pass host-specific launch
  flags when a custom browser binary requires them. `--single-process` is
  intentionally forbidden.

`run-all.sh` is deliberately sequential. The mock servers use fixed ports and
the swap automation is timing-sensitive; parallel cases would create harness
contention rather than useful product load.

## Expected artifacts and usage notes

- Use [`node e2e-swap-test.js`](e2e-swap-test.js:1) with environment variables for focused investigation, but do not treat a single scenario as a release substitute for [`bash run-all.sh`](run-all.sh:1).
- Treat checked-in JSON reports as evidence artifacts, not as the authoritative source of current certification status; the current certification source of truth is the shipped registry plus the latest rerun of the harness.
- If this folder changes, refresh [`SHA256SUMS`](../../SHA256SUMS) with [`node tests/update-checksums.js`](../update-checksums.js:1) from the repository root and rerun [`bash tests/run-fast.sh`](../run-fast.sh:1).
