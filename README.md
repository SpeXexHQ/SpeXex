<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) SpaceXpanse contributors -->

# SpeXex

Static browser-based web wallet, PWA shell, and experimental OTC swap client.

## Experimental disclaimer

> [!WARNING]
> **Do not treat SpeXex as production-ready.**
>> The author is **not** a cryptographer, and this work has **not** been externally reviewed. That means it can contain a fatal flaw somewhere.
> The wallet and OTC runtime remain experimental. This repository should be used for testing, research, and protocol iteration rather than real trading of meaningful value.
>
> The swap flow demonstrates fully non-custodial execution across Bitcoin-derived chains, but the overall system is still a proof of concept with important cryptographic, networking, and operational caveats.
>
> Historical screenshots and proof artifacts live under [`proof/`](proof).

## What SpeXex is

[`SpeXex`](README.md) is the current project identity for this repository. It is a static browser wallet centered on SpaceXpanse ROD, extended with an integrated OTC swap runtime that can coordinate trust-minimized swaps between certified Bitcoin-derived chains.

The codebase is intentionally build-free at the repository root:

- the main application is loaded directly from [`index.html`](index.html);
- wallet, OTC, and explorer logic live in plain browser JavaScript under [`js/`](js/);
- the PWA shell is defined by [`manifest.webmanifest`](manifest.webmanifest) and [`sw.js`](sw.js);
- verification is performed by deterministic Node-based gates in [`tests/`](tests/) and the real-browser settlement harness in [`tests/harness/`](tests/harness/).

## Core capabilities

### Wallet runtime

- local key generation, address derivation, signing, and transaction assembly in [`js/coin.js`](js/coin.js) and [`js/coinbin.js`](js/coinbin.js)
- browser UI and wallet flows wired from [`index.html`](index.html)
- send, receive, transaction decode, verify, rebuild, and sign tooling in the wallet shell
- offline-first signing, with live chain access only for balance, UTXO, lookup, health, and broadcast operations
- per-chain API configuration propagated through the registry-derived wallet runtime
- deterministic fee-floor guidance centered on [`ensureWalletFeeMeetsRelayFloor()`](js/coinbin.js:463)
- progressive web app support through [`manifest.webmanifest`](manifest.webmanifest) and [`sw.js`](sw.js)

### OTC swap runtime

- integrated OTC dashboard and workflow in [`js/otc-app-ui.js`](js/otc-app-ui.js)
- session orchestration, persistence, and storage glue in [`js/otc-engine.js`](js/otc-engine.js)
- deterministic protocol state construction and transitions in [`js/otc-swap.js`](js/otc-swap.js)
- Nostr-based peer messaging in [`js/otc-nostr.js`](js/otc-nostr.js)
- adaptor-signature settlement flow in [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js)
- pre-signed, timelocked refunds on both settlement legs
- `REFUNDS_READY → SIGNATURES_EXCHANGED → PREPARED` funding gate before any funding broadcast
- refund monitoring, recovery, and reload-resilient browser persistence
- ROD name/value order publication and discovery, with optional local RPC helper support from [`tools/README.md`](tools/README.md)

### Supported chain model

- one authoritative registry in [`js/chain-registry.js`](js/chain-registry.js)
- certified settlement chains currently include ROD, Litecoin, and Dogecoin
- wallet-only chains remain available for wallet functionality without being certified for settlement
- a chain can serve as either `assetChain` or `paymentChain`; role is selected per swap, not by separate codepaths

## Current architecture

SpeXex currently operates as three cooperating layers:

1. **Browser wallet and PWA shell** — the user-facing application loaded by [`index.html`](index.html)
2. **ROD control plane** — identity, order ownership, name-based publication/discovery, reputation, and release-height coordination
3. **Nostr signaling layer** — peer-to-peer swap negotiation and state message transport

Repository-level entrypoints reflect those layers:

- [`index.html`](index.html) — single-page application shell
- [`js/chain-registry.js`](js/chain-registry.js) — authoritative chain, API, policy, and certification source
- [`js/coin.js`](js/coin.js) — transaction helpers, signing, wallet network data, and API wrappers
- [`js/coinbin.js`](js/coinbin.js) — wallet controller and page wiring
- [`js/otc-app-ui.js`](js/otc-app-ui.js) — OTC interface, orderbook, session views, and operator actions
- [`js/otc-engine.js`](js/otc-engine.js) — OTC runtime orchestration, storage, APIs, and recovery behavior
- [`js/otc-chains.js`](js/otc-chains.js) — address, fee, dust, relay, and multisig helpers derived from the registry
- [`js/otc-explorer.js`](js/otc-explorer.js) — explorer backend normalization into one common contract
- [`js/otc-swap.js`](js/otc-swap.js) — canonical swap/session state machine logic

Durable maintainer-facing architecture notes live in [`docs/maintainer-wiki/concept-architecture-overview.md`](docs/maintainer-wiki/concept-architecture-overview.md).

## Important runtime constraints

### No root build step

There is no root [`package.json`](package.json) and no repository-wide build pipeline for the main application. The shipped wallet is the checked-in static asset set rooted at [`index.html`](index.html).

### Script load order matters

Runtime behavior depends on script-tag ordering in [`index.html`](index.html). Crypto libraries must load before [`js/coin.js`](js/coin.js), and [`js/coin.js`](js/coin.js) must load before [`js/coinbin.js`](js/coinbin.js).

### Registry is the source of truth

All chain/network/API/policy defaults must derive from [`js/chain-registry.js`](js/chain-registry.js). Copied chain tables or duplicated swap-chain definitions are intentionally avoided.

### Browser-only does not mean fully offline

Key material stays local, but the runtime still depends on remote APIs for live chain state, broadcast, and OTC coordination. The wallet is offline-first, not chain-disconnected.

## Settlement-chain behavior

The current protocol version uses canonical `assetChain` and `paymentChain` terms, plus `spexSwapV2*` browser storage keys. Protocol-v1 state is intentionally retired and is not migrated or resumed.

The swap economic sequence is fixed:

1. the asset-side seller funds first;
2. the payment-side buyer funds second;
3. claiming the payment leg reveals the adaptor secret;
4. the revealed secret enables the asset claim;
5. the payment refund must therefore mature before the asset refund.

### Certified non-ROD chain details

| Property | Litecoin | Dogecoin |
|---|---|---|
| P2PKH / P2SH / WIF | `0x30` / `0x32` / `0xb0` | `0x1e` / `0x16` / `0x9e` |
| BIP32 extended keys | `Ltub` / `Ltpv` | `dgub` / `dgpv` |
| SegWit | available, but not used by escrow | unavailable |
| Escrow script form | 2-of-2 P2SH multisig | 2-of-2 P2SH multisig |
| Settlement fee default | `0.00001 LTC` | `0.01 DOGE` |
| Dust handling | standard satoshi-based floor | absolute Dogecoin hard/soft dust policy |
| Refund windows | 24 / 96 blocks | 60 / 240 blocks |
| Settlement confirmations | 1 | 6 |
| Default explorer backend | Esplora | BlockCypher |

Dogecoin-specific constraints are especially important:

- Dogecoin has no SegWit support in this runtime and no usable CSV-based consensus path for this protocol.
- Dogecoin dust policy is absolute and enforced before signatures are accepted.
- Public Dogecoin explorer access is rate-limited, so sustained use may require a self-hosted backend.

## Folder map

The repository currently breaks down as follows:

- [`js/`](js/) — browser runtime code for wallet, OTC, explorer adapters, crypto helpers, and chain registry data
- [`css/`](css/) — static stylesheets used by the wallet shell
- [`images/`](images/) — icons, branding, and PWA assets
- [`fonts/`](fonts/) — bundled font assets
- [`tests/`](tests/) — deterministic release and regression gates
- [`tests/harness/`](tests/harness/) — real-browser Playwright settlement harness and reports
- [`tools/`](tools/) — optional local helper for browser-safe ROD Core RPC access
- [`proof/`](proof/) — historical screenshots and proof artifacts
- [`docs/`](docs/) — specifications, maintainer wiki, and reference material
- [`electron/`](electron/) — Electron packaging/runtime wrapper for the static wallet assets

## Quick start

### Open the wallet

Use either of these approaches:

1. open [`index.html`](index.html) directly in a browser; or
2. serve the repository as static files and open [`index.html`](index.html).

Default assumptions in the shipped wallet include:

- ROD API defaulting to `https://api.spacexpanse.org:1234`
- donation output disabled by default
- registry-derived API and chain defaults
- legacy wallet access compatibility retained for existing users

### Use OTC mode

1. Open the OTC section in [`index.html`](index.html).
2. Review or adjust chain API settings for your environment.
3. If you need local ROD Core RPC-backed name or order flows, use the optional helper described in [`tools/README.md`](tools/README.md).

For Windows helper usage, the checked-in executable is [`tools/rod-rpc-cors-proxy.exe`](tools/rod-rpc-cors-proxy.exe).

## Verification workflow

### Fast required gate

After final source or documentation edits, refresh [`SHA256SUMS`](SHA256SUMS) with [`tests/update-checksums.js`](tests/update-checksums.js:1) and run the fast gate in [`tests/run-fast.sh`](tests/run-fast.sh:1).

That gate covers:

- release wiring and static asset inventory
- script-order and PWA cache integrity
- explorer contract normalization
- OTC protocol adversarial cases
- wallet race regressions
- negative-control mutation checks

### Full browser certification gate

Before release, use the sequential harness in [`tests/harness/`](tests/harness/) as documented in [`tests/harness/README.md`](tests/harness/README.md). It drives the real app in headless Chromium, reloads the PWA shell offline, and verifies every ordered pair of distinct certified chains.

### Historical proof artifacts

[`proof/README.md`](proof/README.md) describes the checked-in screenshots and proof reports. Those files are evidence snapshots, not the authoritative source of current release truth.

## Security and operational caveats

- SpeXex is non-custodial in design, but not production-approved.
- Browser-local signing does not remove dependency on external explorers, APIs, and relay delivery.
- The adaptor-signature work remains experimental and has separate research material in [`proof/applied-cryptography-assessment/README.md`](proof/applied-cryptography-assessment/README.md).
- PWA correctness depends on keeping [`sw.js`](sw.js) and [`_headers`](_headers) aligned with actual shipped assets and backend hosts.
- Dogecoin settlement remains subject to its non-SegWit and explorer-availability constraints.

## Documentation entrypoints

- [`tests/README.md`](tests/README.md) — deterministic release and regression gates
- [`tests/harness/README.md`](tests/harness/README.md) — full settlement harness and scenario controls
- [`tools/README.md`](tools/README.md) — optional ROD RPC helper
- [`proof/README.md`](proof/README.md) — proof artifacts and screenshot archive
- [`proof/applied-cryptography-assessment/README.md`](proof/applied-cryptography-assessment/README.md) — clean-room adaptor-signature analysis bundle
- [`docs/maintainer-wiki/README.md`](docs/maintainer-wiki/README.md) — durable maintainer wiki overview
- [`docs/maintainer-wiki/index.md`](docs/maintainer-wiki/index.md) — maintainer wiki catalog
- [`CHANGELOG.md`](CHANGELOG.md) — release history and behavior changes

## Attribution and licensing

SpeXex descends from the browser-wallet lineage associated with Coinb.in, but the current repository behavior is defined by the SpaceXpanse ROD wallet runtime, the OTC modules, the registry-driven chain model, and the repository documentation linked above.

Licensing in this repository is mixed:

- original Coinb.in-derived material remains under [`LICENSE`](LICENSE)
- SpaceXpanse-specific additions are licensed under [`LICENSE-APACHE`](LICENSE-APACHE), unless a file states otherwise
- distributions should preserve both license files
- file-level SPDX headers remain authoritative where present
