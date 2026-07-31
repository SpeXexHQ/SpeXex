<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) SpaceXpanse contributors -->

# SpeXex

Static browser-based SpaceXpanse ROD wallet with an integrated experimental OTC swap engine.

## Status

The current shipped release is [`2.9.1-beta.1`](CHANGELOG.md).

## Experimental disclaimer

> [!WARNING]
> **Do not treat this project as production-ready.**
> 
> The author is **not** a cryptographer, and this work has **not** been externally reviewed. That means there is very likely a fatal flaw somewhere.
> 
> This repository is still **highly experimental**, should be treated as a **proof of concept**, and should be used **only for testing**.
> 
> It has achieved the ability to perform **fully non-custodial swaps between two Bitcoin-derived blockchains** in its current proof-of-concept form, but it should **not** be used to swap serious amounts.
> 
> Proof artifacts and screenshots live under [`proof/`](proof).

## Overview

[`SpeXex`](README.md) is a static, browser-based, non-custodial SpaceXpanse ROD wallet with an integrated OTC swap engine. It settles **ROD ↔ LTC** and **ROD ↔ DOGE** atomic swaps; the counter chain is chosen per swap and is cryptographically bound into the negotiated terms. Key generation and signing remain inside the browser, while selected chain operations use the SpaceXpanse ROD API and OTC coordination uses the ROD blockchain, Nostr relay messaging, and browser-native adaptor-signature logic.

The OTC subsystem is implemented directly in the main wallet shell through [`js/otc-app-ui.js`](js/otc-app-ui.js), [`js/otc-engine.js`](js/otc-engine.js), [`js/otc-nostr.js`](js/otc-nostr.js), and [`js/otc-swap.js`](js/otc-swap.js). The current runtime includes planned funding txids, pre-signed timelocked refunds, `PREPARED` settlement gating, automated refund monitoring, and persistent in-browser swap recovery, including portable recovery exports that restore live sessions and signed transactions without exporting wallet WIFs or local RPC credentials, as tracked in [`CHANGELOG.md`](CHANGELOG.md).

## What is implemented

### Wallet

- Local key generation and transaction signing in the browser through [`js/coin.js`](js/coin.js) and [`js/coinbin.js`](js/coinbin.js)
- ROD wallet send/receive flows in [`index.html`](index.html) and [`js/coinbin.js`](js/coinbin.js)
- Offline transaction decode, verify, rebuild, and sign flows
- ROD API-backed balance, UTXO, transaction lookup, and broadcast handling through [`coinjs.addressBalance()`](js/coin.js:419), [`coinjs.transaction().listUnspent()`](js/coin.js:1197), [`coinjs.transaction().getTransaction()`](js/coin.js:1239), and [`coinjs.transaction().broadcast()`](js/coin.js:1322)
- Deterministic local fee guidance rather than remote fee estimation, centered on [`ensureWalletFeeMeetsRelayFloor()`](js/coinbin.js:463)
- PWA shell support through [`manifest.webmanifest`](manifest.webmanifest) and [`sw.js`](sw.js)

### OTC swap engine

- Serverless browser OTC runtime integrated into [`index.html`](index.html)
- On-chain order publication/discovery model using the ROD name/value database and optional local RPC/proxy support
- Nostr-based peer signaling through [`js/otc-nostr.js`](js/otc-nostr.js)
- Adaptor-signature-based claim flow using [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js)
- Planned funding txids before broadcast
- Multi-chain counter leg: Litecoin and Dogecoin, selected per swap
- Pre-signed timelocked refunds on both chains
- `REFUNDS_READY → SIGNATURES_EXCHANGED → PREPARED` gating before funding broadcast
- Confirmation-gated settlement progression
- Automated refund monitoring and refund terminal states
- Reload-resilient in-browser swap persistence
- Recovery export/import for live OTC sessions, signed refund transactions, portable settings, and history without wallet-secret or RPC-credential leakage
- End-to-end browser proof harness coverage in [`tests/README.md`](tests/README.md) and [`tests/harness/README.md`](tests/harness/README.md)

## Architecture at a glance

The project follows a three-layer model that matches the technical specification captured in [`docs/technical_specification_rod_web_swap.pdf`](docs/technical_specification_rod_web_swap.pdf):

- **Local browser sandbox / PWA client** — UI, state handling, wallet logic, and cryptographic execution run inside the browser
- **ROD blockchain layer** — used as the decentralized orderbook and settlement-adjacent coordination layer
- **Nostr signaling layer** — used for ephemeral peer-to-peer negotiation and swap message exchange

At repository level, the main entrypoints are:

- [`index.html`](index.html) — single-page wallet and OTC shell
- [`js/coin.js`](js/coin.js) — network constants, signing helpers, transaction logic, and API wrappers
- [`js/coinbin.js`](js/coinbin.js) — wallet UI controller and transaction flows
- [`js/otc-app-ui.js`](js/otc-app-ui.js) — OTC dashboard, swap UI, and operator flows
- [`js/otc-engine.js`](js/otc-engine.js) — OTC orchestration, live session state, API access, and relay/runtime glue
- [`js/otc-swap.js`](js/otc-swap.js) — deterministic swap/session construction and state transitions
- [`js/otc-chains.js`](js/otc-chains.js) — immutable per-chain version bytes and relay/fee/dust policy
- [`js/otc-explorer.js`](js/otc-explorer.js) — pluggable block-explorer adapter (Esplora / BlockCypher)

A durable maintainer summary of the runtime architecture lives in [`docs/maintainer-wiki/concept-architecture-overview.md`](docs/maintainer-wiki/concept-architecture-overview.md).

## Counter chains

Every swap is ROD against one "alt" leg. Which chain that is lives in
`terms.altChain`, which is part of the hashed canonical terms — a counterparty
cannot announce one chain and obtain signatures for another, because each side
rebuilds the terms locally from that field and rejects a `termsHash` mismatch
before any key material or coin is committed.

| | Litecoin | Dogecoin |
|---|---|---|
| P2PKH / P2SH / WIF version | `0x30` / `0x32` / `0xb0` | `0x1e` / `0x16` / `0x9e` |
| BIP32 extended keys | `Ltub` / `Ltpv` | `dgub` (`0x02facafd`) / `dgpv` (`0x02fac398`) |
| SegWit / bech32 | available (unused by the swap escrow) | **does not exist** — permanently disabled in Dogecoin Core |
| Escrow | 2-of-2 P2SH `OP_CHECKMULTISIG` | same |
| Settlement fee | 0.00001 LTC | 0.01 DOGE (1000 koinu/B mining floor) |
| Dust | 546 sat | **absolute**: 0.001 DOGE hard, 0.01 DOGE soft (+0.01 DOGE per soft-dust output) |
| Refund window | 24 blocks × 2.5 min ≈ 1 h | 60 blocks × 1 min ≈ 1 h |
| Confirmations before settling | 1 (~2.5 min) | 6 (~6 min) |
| Default backend | Esplora (`litecoinspace.org`) | BlockCypher |

Three details drove the Dogecoin work and are worth knowing before changing it:

Dogecoin has **no SegWit and no `OP_CHECKSEQUENCEVERIFY`**. CSV's activation
window closed unsignalled in 2017 and remains inactive, so relative timelocks
are mempool policy rather than consensus there. This protocol never needed
CSV — its refunds are absolute `nLockTime` with input sequence `0xfffffffe`,
which behaves exactly as on Bitcoin — but any future change that reaches for
CSV would be unsafe on Dogecoin.

Dogecoin dust is an **absolute amount**, not a fee-rate derivation. An output
below 0.001 DOGE makes the whole transaction non-standard no matter how much
fee is attached, and an output below 0.01 DOGE adds a flat 0.01 DOGE surcharge
to the relay minimum. Both rules are encoded in
[`js/otc-chains.js`](js/otc-chains.js) and enforced before any sighash is
signed.

There is **no public Dogecoin Esplora instance**. The default backend is
therefore BlockCypher, reached through the adapter in
[`js/otc-explorer.js`](js/otc-explorer.js), which normalises every backend into
the Esplora response shape the rest of the code already consumes. BlockCypher's
keyless tier is rate limited per source IP. The adapter coalesces concurrent
identical GETs into one request, which is a real saving when several sessions
poll the same chain on the same tick — but it deliberately keeps no time-based
cache, because serving a swap a value that was already stale can cost it the
window in which it had to act. Sustained use on Dogecoin therefore wants a
self-hosted `electrs-doge`: switch the backend to `esplora` in OTC Settings and
point it at your own node.

## Trust and security model

This repository aims for **non-custodial execution**, not production-grade safety.

- Private keys are intended to remain in local browser execution paths
- The wallet is offline-first for signing, but **not fully offline** for balance lookup, UTXO discovery, transaction lookup, broadcast, and OTC coordination
- OTC coordination is separated from custody, but still depends on chain APIs, Nostr delivery, and optional local RPC/proxy flows for some name/orderbook operations
- The OTC design is a proof of concept for fully non-custodial swaps across two Bitcoin-derived chains, not a finished protocol product

The technical specification in [`docs/technical_specification_rod_web_swap.pdf`](docs/technical_specification_rod_web_swap.pdf) also highlights important caution areas:

- browser-native adaptor-signature math is intentionally implemented without relying on a compiled `libsecp256k1-zkp` fork
- legacy big-number code paths may expose timing-side-channel risk in browser environments
- public coordination/indexing choices create privacy and linkability tradeoffs

These are reasons to keep this project in the **experimental / testing-only** category.

## Quick start

## Run the wallet

This repository has **no root [`package.json`](package.json)** and no build step for the main application.

To run the wallet:

1. Open [`index.html`](index.html) directly in a browser, or
2. Serve the repository as static files and load [`index.html`](index.html)

Default wallet runtime assumptions:

- ROD API endpoint defaults to `https://api.spacexpanse.org:1234`
- Donation output is disabled by default
- Script-tag ordering in [`index.html`](index.html) is a compatibility requirement

## Electron desktop wrapper

> [!WARNING]
> The Electron desktop wrapper under [`electron/`](electron) is still **experimental** and should be treated as **testing-only**, just like the browser wallet itself.

Install wrapper dependencies from [`electron/`](electron):

```bash
cd electron && npm ci
```

Run the wrapper locally:

```bash
cd electron && npm run start:win
```

On Linux or macOS, use the platform-specific scripts from [`electron/package.json`](electron/package.json):

```bash
cd electron && npm run start:linux
cd electron && npm run start:mac
```

Run the smoke proof:

```bash
cd electron && npm run test:smoke
```

The smoke run regenerates [`electron/app/wallet/`](electron/app/wallet), launches the packaged wallet entrypoint, and writes a local proof artifact to [`electron/test-results/electron-smoke-test.json`](electron/test-results/electron-smoke-test.json). That JSON file is intentionally ignored by [`electron/test-results/.gitignore`](electron/test-results/.gitignore) and should be treated as a local validation artifact rather than a committed release file.

Build desktop targets:

```bash
cd electron && npm run package:dir
cd electron && npm run package:win
cd electron && npm run package:linux
cd electron && npm run package:mac
```

Repository automation now mirrors that manual workflow through [`.github/workflows/electron-build.yml`](.github/workflows/electron-build.yml) and [`.github/workflows/release-desktop.yml`](.github/workflows/release-desktop.yml). The build workflow runs the native Windows/Ubuntu/macOS Electron matrix, executes [`npm run test:smoke`](electron/package.json), packages unsigned desktop artifacts, and uploads them for inspection without publishing a release. The release workflow first re-proves [`bash tests/run-fast.sh`](tests/run-fast.sh:1) and the current [`SHA256SUMS`](SHA256SUMS), then builds all three native desktop targets and publishes a GitHub Release that attaches the desktop artifacts plus [`SHA256SUMS`](SHA256SUMS). Draft mode remains the default, and alpha/beta/rc tags publish as prereleases.

Current validation status:

- Windows-local wrapper launch was validated with [`npm run start:win`](electron/package.json)
- Smoke verification passed with [`npm run test:smoke`](electron/package.json)
- Directory packaging passed with [`npm run package:dir`](electron/package.json)
- Windows packaging passed with [`npm run package:win`](electron/package.json)
- Linux/macOS packaging scripts were validated for configuration with [`npm run package:linux`](electron/package.json) `-- --help` and [`npm run package:mac`](electron/package.json) `-- --help`

Windows builds were validated on this host. Linux and macOS targets are configured in [`electron/package.json`](electron/package.json), but final distributables should be produced on native hosts or CI runners for those platforms. Public macOS distribution also requires normal signing and notarization outside this repository.

## Use OTC mode

1. Open the OTC tab inside [`index.html`](index.html)
2. Configure ROD/LTC API endpoints if your environment differs from the defaults
3. If you want name operations or on-chain orderbook publication through local ROD Core RPC, run the helper described in [`tools/README.md`](tools/README.md)

### OTC recovery backups

The OTC Settings panel can now export a recoverable backup that includes live
swap sessions, signed transaction blobs, relay/API preferences, and trade
history. It intentionally excludes wallet WIF material, raw adaptor/Nostr
secrets, and machine-local ROD Core RPC credentials.

To resume an active imported swap, reopen the same wallet that originally
created that swap. Recovery import is additive: it refuses to overwrite an
already-live local session with the same swap id.

For the optional helper flow, use [`tools/rod-rpc-cors-proxy.exe`](tools/rod-rpc-cors-proxy.exe) as documented in [`tools/README.md`](tools/README.md).

## Verification and proofs

### Fast proof gate

Run from the repository root:

```bash
bash tests/run-fast.sh
```

This deterministic gate checks release wiring, local asset closure, service-worker
coverage, CSP/API alignment, explorer contract normalization, wallet race
regressions, adversarial protocol cases, and deliberate mutation failures.

### Manual/browser verification

For ordinary wallet and shell changes, load [`index.html`](index.html) in a browser and exercise the affected flow.

### OTC proof harness

The strongest current OTC verification path is the real-browser harness documented in:

- [`tests/README.md`](tests/README.md)
- [`tests/harness/README.md`](tests/harness/README.md)

That harness runs the real app in two browser contexts against mock ROD/LTC backends and a local Nostr relay, and validates broadcast transactions independently.

The fast browser shell gate in [`tests/harness/unit-browser-test.js`](tests/harness/unit-browser-test.js) also covers OTC recovery-button wiring against the real live-session store. The full two-peer settlement runner tolerates only one deliberate reload-time request abort: the transient local ROD `/info` health probe that navigation cancels during the reload scenario.

### Release inventory

[`SHA256SUMS`](SHA256SUMS) is the canonical release manifest.
After the final source or documentation edit, refresh it with:

```bash
node tests/update-checksums.js
```

Then rerun the fast gate so the inventory and release wiring are proven together.

For GitHub-hosted desktop releases, [`.github/workflows/release-desktop.yml`](.github/workflows/release-desktop.yml) enforces the same invariant by failing if regenerating [`SHA256SUMS`](SHA256SUMS) would change the committed manifest before publishing release assets.

### Visual proof artifacts

Screenshots and proof artifacts are available under [`proof/`](proof), including:

- [`proof/active-swap-detail.jpg`](proof/active-swap-detail.jpg)
- [`proof/ltc-wallet.jpg`](proof/ltc-wallet.jpg)
- [`proof/rod-wallet.jpg`](proof/rod-wallet.jpg)

## Current limitations and caveats

- This work is a proof of concept and has **not** been cryptographically reviewed
- Live OTC success still depends on reliable API and relay behavior
- Some OTC orderbook/name operations depend on the optional local RPC/proxy path described in [`tools/README.md`](tools/README.md)
- Script-tag ordering in [`index.html`](index.html) must remain intact
- PWA shell integrity depends on keeping [`sw.js`](sw.js) aligned with actual cached assets
- ROD API response handling is tailored to the current `{result,error}` envelope behavior
- Dogecoin has no SegWit, so a funding transaction's txid is malleable at the consensus layer. In practice the standardness rules every relaying node applies (strict DER, low-S, minimal pushes, push-only scriptSigs) block all known third-party malleation, which is the same position Bitcoin was in before SegWit — but it is policy, not consensus. The same applies to the Litecoin leg, which also uses legacy P2SH escrow.
- The public Dogecoin backends are rate limited. A long-running Dogecoin swap on the keyless BlockCypher tier may need a self-hosted `electrs-doge` or an API key
- This project should be used for **testing**, not for real trading of meaningful value

## Repository structure

```text
.
├─ index.html
├─ js/
│  ├─ coin.js
│  ├─ coinbin.js
│  ├─ otc-app-ui.js
│  ├─ otc-chains.js
│  ├─ otc-engine.js
│  ├─ otc-explorer.js
│  ├─ otc-nostr.js
│  └─ otc-swap.js
├─ tests/
├─ tools/
├─ docs/
├─ electron/
├─ proof/
├─ sw.js
└─ manifest.webmanifest
```

## Further reading

- Release history and verified behavior: [`CHANGELOG.md`](CHANGELOG.md)
- Durable maintainer architecture notes: [`docs/maintainer-wiki/concept-architecture-overview.md`](docs/maintainer-wiki/concept-architecture-overview.md)
- Carbon Memory index: [`docs/maintainer-wiki/index.md`](docs/maintainer-wiki/index.md)
- Technical specification: [`docs/technical_specification_rod_web_swap.pdf`](docs/technical_specification_rod_web_swap.pdf)
- OTC proof harness: [`tests/README.md`](tests/README.md) and [`tests/harness/README.md`](tests/harness/README.md)
- Optional RPC helper: [`tools/README.md`](tools/README.md)

## Attribution

This project is derived from the browser-wallet lineage represented by [`coinbin`](README.md), but the current repository behavior should be understood through the SpaceXpanse ROD runtime, OTC modules, and repository-specific documentation linked above.

## Licensing

- Original Coinb.in-derived material in this repository remains under the MIT license in [`LICENSE`](LICENSE).
- SpaceXpanse/ROD fork-specific additions are licensed under Apache License 2.0 in [`LICENSE-APACHE`](LICENSE-APACHE), unless a file states otherwise.
- Repository distributions should preserve both [`LICENSE`](LICENSE) and [`LICENSE-APACHE`](LICENSE-APACHE) so the mixed licensing scope remains clear.
- File-level SPDX headers and notices control more specific cases where present.
