<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) SpaceXpanse contributors -->

# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog and follows Semantic Versioning principles where practical.

## [Unreleased]

### Added
- **Canonical public chain-information pages.** A new **Chain Info** navigation entry immediately after **Coins** exposes a deep-linkable `#chain/<CODE>` page for every registry profile. Each page is rendered directly from `js/chain-registry.js` and shows the chain description, address/HD parameters, SegWit and Bech32 capabilities, API and explorer endpoints, official website/documentation/repositories, wallet or swap-certification status, fee/dust policy, and every verified bidirectional OTC route. No second chain table or `chain-info.js` data file was added.
- **Route-ownership marks in the Coins and Chain Info menus.** Certified chains use a green check when their configured route endpoint is hosted by SpeXex and a blue check when it is community-run on external infrastructure. The active website coin is identified only by a distinct menu background; the former chevron indicator is removed.

### Changed
- **SpeXex homepage/navbar/PWA branding refresh.** The homepage, navbar, title/meta text, web manifest, and service-worker cache identity now present SpeXex branding consistently. [`images/spexex_logo.png`](images/spexex_logo.png) is the active homepage/navbar wordmark, while the existing PWA icons were intentionally kept because they already match the SpeXex rocket style.
- **One canonical market is shown for each unordered certified pair.** Reverse protocol orientations such as `DOGE/ROD` and `ROD/DOGE` now share one canonical orderbook/filter market, while each offer retains its original directional `assetChain` / `paymentChain`, side, amounts, signatures, and refund policy for settlement.
- **The active website coin now controls new-swap asset selection.** The OTC New swap asset is read-only and follows the same site-wide coin switch used by the Coins menu and Chain Info pages. Its payment choices exclude the active asset, and wallet-only active coins disable swap creation instead of silently selecting another settlement chain.
- **Release identity bumped to `2.6.1-beta.0`.** The next patch beta now marks the shipped UI, manifest, service-worker cache identity, and Electron wrapper consistently for release packaging.

## [2.6.1-beta.0] - 2026-08-01

### Changed
- **Release identity bumped to `2.6.0-alpha.3`.** The service-worker cache is invalidated for the reviewed registry, identity, Settings, and pair-matrix fixes.
- **The browser settlement matrix now proves the architecture it advertises.** It discovers every ordered pair of distinct certified chains and runs happy settlement, asset refund, payment refund, and reload recovery for each pair. ROD remains a separate control plane when neither settlement leg is ROD.
- **A single authoritative chain registry now controls onboarding.** [`js/chain-registry.js`](js/chain-registry.js) is the only shipped source for wallet parameters, explorer/API defaults, swap certification, refund timing, confirmation rules, canonical fees, relay/dust policy, and certification vectors. `coin.js`, `otc-chains.js`, the wallet menu, mock-chain validation, the end-to-end harness, and the full matrix derive their inputs from it. Adding another compatible chain no longer requires synchronized constants or chain lists across those consumers.
- **Certified profiles fail closed.** Registry compilation rejects incomplete or incompatible settlement profiles before the wallet starts, including unsupported transaction/signature/sighash/timelock semantics, missing fees, unsafe timing, missing relay/dust rules, and missing P2PKH/P2SH vectors. Wallet-only remains a certification status, not an architectural chain class; every certified chain can still occupy either swap role.
- **Release identity bumped to `2.6.0-alpha.2`.** The service-worker cache is invalidated so deployed clients cannot mix the new registry with old wallet or settlement scripts.
- **Protocol v2 removes settlement-side privilege.** ROD, Litecoin, and Dogecoin now live in one registry with one profile shape and can occupy either `assetChain` or `paymentChain`. Canonical terms, states, Nostr messages, storage, recovery, history, UI selectors, automation, claims, and refunds use those economic roles instead of hard-coded `ROD`/`alt` settlement fields. Every coin profile supplies both a four-hour asset-role refund window and one-hour payment-role window, so reversed registered pairs remain safe by default. ROD remains explicitly central for identity, reputation, name ownership, authoritative order discovery, and release-height coordination.
- **Testing-only protocol v1 is retired rather than migrated.** New Nostr kinds (`7341` swap, `31341` order) and isolated `spexSwapV2*` storage/config/history/blob namespaces prevent old ROD/LTC or ROD/DOGE sessions from being read, displayed, imported, tracked, or resumed. Old on-chain order values fail the v2 version gate.
- **Release identity bumped to `2.6.0-alpha.1`.** The service-worker cache is invalidated so deployed clients cannot mix v1 and v2 scripts.

### Added
- **Layered production proof harness.** Fast release gates now verify syntax, local-asset closure, service-worker precache completeness, CSP/API compatibility, version identity, unique scripted DOM IDs, and agreement between wallet, explorer, OTC, UI, and scenario-matrix support registries. Deterministic explorer-contract tests cover success, empty, malformed, overflow, broadcast, prevout, coalescing, and failure-isolation behavior across Esplora, BlockCypher, Blockchair, and Blockbook response shapes. Seven mutation checks prove that the security, balance-race, API-policy, and prevout regressions fail when their production guards are deliberately removed.
- **Restored independent browser and mock-chain harness plus CI.** Pull requests run the fast gates first, then real Chromium integration and LTC/DOGE happy-path, ROD-refund, counter-refund, and reload settlement scenarios. Failed browser runs retain their diagnostic reports as CI artifacts.
- **Order detail travels over Nostr, anchored by the ROD name record.** The ROD name DB remains the **only** source of truth for what is on offer: an order exists because a name record exists, and nothing a relay says can add one to the book. The record names a Nostr event id and signing key, and the fuller payload is published as a signed event on the relay pool the swap protocol already maintains. Detail is accepted only when the event id matches the id named on chain and its signature verifies under the key named on chain. The tradable pair, price, size, side, and settlement window come from the chain record. Protocol-v2 order events use kind `31341`.
- **"My orders" panel**, sourced from the name-DB scan, listing your own published orders with live/expired status and the blocks remaining in their release window. Own orders are hidden from the takeable book, so without this view there was no confirmation that an order had been published.
- **Chain filter and refresh controls** for the book, plus a per-offer badge showing whether anchored detail has been resolved from the relays or is still pending.

### Fixed
- **Opening SpeXex from a non-ROD wallet network used that network's visible address as the ROD trader identity.** The control-plane identity is now always re-derived under ROD from the local wallet key, while settlement payout and funding addresses remain chain-specific. A real-browser regression proves LTC-active wallet state still produces the correct ROD identity.
- **Wallet Settings still duplicated every mainnet profile and dispatched by P2PKH version byte.** The dropdown now derives from the registry and dispatches by chain code, preventing DGB from being mistaken for DOGE and BTC from being ambiguous with BCH. Wallet-only notices, paper-wallet headings, and fee units are registry-driven as well.
- **A newly certified chain could expose unusable pairs.** Registry compilation now rejects any profile set whose default asset/payment refund windows fail the runtime's cross-pair wall-clock safety margin, before the chain reaches either swap selector.
- **OTC backup/restore exported the obsolete storage layer rather than the active swap engine.** Recovery now exports the real protocol-v2 live sessions plus offloaded funding/refund transaction blobs, public endpoint preferences, and history. Raw wallet/adaptor/Nostr secrets and machine-local RPC credentials are excluded; sealed session material remains recoverable with the same wallet. Import validates the complete envelope and blob allowlist before writing, merges non-conflicting sessions, refuses stale-backup overwrite, rolls back atomically on storage failure, reconnects relay tracking, and resumes only when the open wallet matches the session's role-bound swap xpub. Engine regressions and a real-browser Settings-button round trip cover the path.
- **Release inventory and browser-harness drift.** `SHA256SUMS` now covers direct root files plus all files under `css/`, `fonts/`, `images/`, `js/`, and `tools/` exactly as packaged, including tool package metadata. Generated replacement ZIPs are kept outside the release root. The single-context browser/PWA gate can run on serverless Chromium, while the two-peer settlement runner still rejects `--single-process`; repeated reports validate their suffix, and deliberate reloads may suppress only the exact local `/info` request aborted by navigation.
- **The restored browser matrix could not prove the release it described.** It configured an unsafe 15-minute ROD refund against a 100-minute LTC refund, used the obsolete `alice` role value and a placeholder counterparty identity, treated asynchronous acceptance as synchronous, expected retired state names and fees, silently reduced DOGE from six confirmations to one, suppressed browser errors, and emitted no report on early failure. The matrix now uses the shipped policy and identities, waits for persisted acceptance, fails on unexpected browser/network errors, writes failure diagnostics, and is pinned to production defaults by a fast release gate.
- **The release integrity manifest was obsolete and misleading.** The stale SHA-1 inventory referenced removed harness/tools paths and disagreed with current production files. It is replaced by a complete reproducible SHA-256 manifest that the release gate verifies byte-for-byte.
- **Wallet-only networks could enter the OTC flow.** Both role selectors now derive from the same complete swap registry, currently ROD/LTC/DOGE. BTC, BCH, and DGB remain wallet-only until each has a complete certified settlement profile; release and browser gates enforce the boundary.
- **Blockchair prevouts pointed to the spending transaction itself.** Input normalization used `spending_transaction_hash`/`spending_index` instead of the previous output's `transaction_hash`/`index`, corrupting transaction evidence. The explorer-contract gate pins the correct mapping.
- **Default APIs and the offline shell could be blocked by deployment policy.** CSP now permits the shipped BTC/BCH API origins; the service worker precaches the loader, background, and local font files; and the web manifest, UI, and cache identity agree on the release version.
- **Switching away from DGB could leave wallet balance checks blocked until the abandoned explorer request completed or timed out.** The wallet no longer treats `#walletLoader` visibility as global request state: balance lookups now carry a network-and-address epoch, a coin switch immediately releases the loader, and callbacks from an older network are ignored. DGB now defaults to the Esplora-compatible `https://digiexplorer.info/api`; the deployment CSP permits that host, the exact Blockchair default saved by earlier builds is migrated without overwriting custom endpoints, and the service-worker cache identity is bumped so deployed clients receive the corrected configuration.
- **Incoming refund deadlines were trusted without enforcing cross-chain ordering.** Both lock heights are checked against fresh asset/payment tips in wall-clock seconds before session creation, acceptance, refund signing, and funding. The asset refund must remain later than the payment refund by at least 30 minutes (or the larger confirmation window), while the independent ROD control-plane release window must leave enough time before the payment refund.
- **A canonical `termsHash` mismatch could be accepted after only the local child public key matched.** The locally reconstructed terms are now authoritative and any missing or unequal 32-byte hash hard-rejects and removes the incoming session; remote terms are never copied over local amounts, addresses, fees, chain or deadlines. Both peers reconstruct from the canonical xpub strings actually advertised in the offer and terms, avoiding benign xprv→xpub metadata reserialization differences without weakening the exact-hash invariant.
- **OTC Nostr messages could be unsigned.** Every swap event now requires a valid NIP-01/BIP340 signature at creation and receipt. Before any payload is processed, the event's x-only signer key must also reproduce the counterparty ROD address committed in the canonical terms, preventing an arbitrary first signed event from pinning an attacker's key.
- **Focused security regressions** in [`tests/security-regression.js`](tests/security-regression.js) prove unsigned-event rejection, signer-to-ROD-identity binding, hard terms-hash rejection, and safe/unsafe refund ordering for both LTC and DOGE.
- **A listed order could be shown as takeable while it was not yet actionable.** Taking one needs the counterparty swap xpub; if the name record left that to relay detail which had not arrived, the take died deep in the create path with `Take an order on the Dashboard first` — a message describing nothing the user did wrong. Such lots are now dimmed with their Take disabled and the real reason stated inline, and the "can fill" summary no longer counts a lot that cannot actually be taken. An order with no release height reads **no window** rather than rendering a blank settlement cell.
- **Relay detail could supply an order's settlement window.** Hydration filled any field the name record left empty, and `normalizeOffer()` validates `give`/`want`/`side`/`pair`/`altChain` but *not* `releaseRodHeight` — so a record omitting it inherited the window from whatever the relay served, and that window drives expiry, the settlement clock and the refund-slack warning. The tradable terms are now read from the chain record only and can never be filled from detail. Proven by negative control: with the guard removed the order picks up the relay's `releaseRodHeight=600000`; with it in place the record reports no window.
- **Broadcast, claim and refund failures retried on every 30-second tick** with no backoff, the same pattern that caused the explorer rate-limiting fixed earlier — only on the paths that move coin. They now use the same classified backoff as the verify paths, so a transient error still retries in seconds while a genuine HTTP 429 backs off instead of hammering.
- **Your own offers were listed as takeable.** Taking one was already refused at swap creation (`Counterparty xpub must differ from your swap xpub`), so this was never a fund-safety issue — but the book still advertised orders that could only ever produce an error, with no indication which ones were yours. Offers are now matched against the local swap xpub and the ROD address derived from it and moved out of the takeable book into a "My orders" panel, turning a dead end into a visible, managed listing.
- **The headline price averaged unrelated markets.** The mid-price took the best ask and best bid across *all* counter chains, so a Dogecoin ask and a Litecoin bid were averaged into a single number describing no tradable market. The quote is now computed per chain, labelled with that chain, and states whether it is a true mid or a one-sided book.

### Fixed
- **Settlement could be permanently broken by reopening a swap without its wallet** — the cause of the repeating `Secret recovery failed for all candidate signatures` in the field. `restoreLive()` decrypts the adaptor secret with the wallet WIF as the key; when the wallet is closed the key is empty, and when the *wrong* wallet is open `CryptoJS.AES.decrypt().toString(Utf8)` returns an **empty string rather than throwing**. Both cases left `adaptorSecret` falsy, which the pre-funding pipeline read as "no secret yet" and satisfied by minting a **new** `y` and publishing a **new** adaptor point. The counterparty's adaptor signature was already encrypted to the *old* point, so `recover()` then failed against every candidate signature for the remainder of the swap and both legs stranded until refund. The seller now only generates a secret when no commitment exists (`_ea` and `adaptorPoint` both absent) and otherwise surfaces an actionable error telling the operator to reopen the originating wallet. Proven by a negative-control regression test: with the guard reverted the new suite reports `CHANGED 02e2099f5cef -> 02ab55fb8263` and `DESYNC seller … vs buyer …`; with the guard in place the point is stable and the swap settles.
- **The adaptor point was treated as a mutable field.** `swap_adaptor_point` is re-published on every tick until the peer is PREPARED, and the handler overwrote the stored point unconditionally — so a counterparty running the buggy path above could silently move the point out from under signatures that were already committed to it. The point is now pinned once the local side holds any adaptor signature or has reached PREPARED; a conflicting value is logged and surfaced as a settlement-unsafe warning instead of being adopted, leaving the timelocked refund as the safe exit.
- **Explorer retries used a single flat 120-second lock**, which is wrong in both directions: it throttles a rate-limited explorer too little to recover while stalling the far more common "broadcast succeeded but the transaction is not indexed yet" case for two full minutes. Retries are now classified (`ratelimit` / `notfound` / `network` / `other`) with per-class exponential backoff and caps — 5 s initial for a not-yet-indexed transaction, 120 s growing to 15 min for an HTTP 429 — reset on success. The pending log line now states the reason and the next retry interval.
- **`coinjs.ajax` reported every failure as "ROD API server is unreachable"** regardless of which host actually failed, so a BlockCypher or Esplora outage was misattributed to the ROD API and flipped its health indicator. Errors now name the real host, HTTP 429 is reported as rate limiting rather than unreachability, and `reportApiStatus` is only consulted for ROD API URLs.
- **`rodOtcLive` could exceed the localStorage quota** (`Failed to execute 'setItem' on 'Storage'`). Raw funding hex and signed refund hex are offloaded to per-swap keys and re-merged on restore; on quota exhaustion the writer prunes COMPLETE sessions and retries before falling back to persisting the active session alone.

### Changed
- **Protocol roles are named for their economics: `alice` → `seller`, `bob` → `buyer`.** Protocol v2 carries this through to generic asset/payment states and fields. Both peers must run v2; v1 sessions are deliberately isolated instead of migrated because they were test-only.

### Added
- **`ADAPTOR_DESYNC_TEST=1` scenario** reloading the seller mid-negotiation with the wallet closed, asserting the adaptor point is stable on both sides and that the secret decrypts again once the correct wallet is reopened. Included in `run-all.sh` for LTC and DOGE.
- **Unit regressions** prove protocol-v1 storage/order/event isolation and the adaptor invariant that motivates pinning: a secret recovers only under the point it was encrypted to, and a swapped point is rejected.

## [2.5.0-alpha.0] - 2026-07-26

Dogecoin is now a first-class counter chain: the swap engine settles **ROD ↔ DOGE**
alongside ROD ↔ LTC, and the counter chain is chosen per swap rather than compiled in.

### Added
- **Dogecoin mainnet support.** Version bytes verified against `dogecoin/dogecoin` `src/chainparams.cpp`: P2PKH `0x1e`, P2SH `0x16`, WIF `0x9e`, BIP32 `dgub` (`0x02facafd`) / `dgpv` (`0x02fac398`), SLIP-44 coin type 3. Registered in [`coinjs.networks`](js/coin.js), [`js/otc-chains.js`](js/otc-chains.js), the wallet Coins menu, the OTC counter-chain selector, and the `connect-src` allowlist in [`_headers`](_headers). Address, multisig and WIF derivation are pinned by test vectors generated independently with bitcoinjs-lib + `@noble/curves`.
- **Generic "alt leg".** The counter leg is no longer hard-wired to Litecoin. `terms.altChain` is part of the hashed canonical terms, so the chain is cryptographically bound to every signature: each side rebuilds terms locally from that field and rejects a `termsHash` mismatch before any key material or coin is committed. An unknown alt chain is rejected explicitly rather than silently falling back.
- **Per-chain relay policy table** in [`js/otc-chains.js`](js/otc-chains.js) — construction fee rate, relay floor, hard/soft dust, dust surcharge, change threshold and block spacing — plus `minRelayFeeSats()`, which mirrors `GetDogecoinMinRelayFee()` (size component **plus a flat surcharge per soft-dust output**). Dogecoin dust is an *absolute* amount, not a fee-rate derivation, so it cannot be paid away by bidding higher; `engine.assertSettlementPolicy()` now rejects an underpriced or dust settlement transaction before its sighash is ever signed.
- **Pluggable block-explorer adapter** [`js/otc-explorer.js`](js/otc-explorer.js), normalising Esplora and BlockCypher into the single Esplora-shaped response the rest of the code already consumed (`utxos`, `balance`, `tx`, `txHex`, `outspend`, `tipHeight`, `broadcast`). There is no public Dogecoin mainnet Esplora, so DOGE defaults to BlockCypher — the only keyless backend serving permissive CORS, raw transaction hex *and* a spending-transaction lookup, all three of which this protocol requires. Concurrent identical GETs are coalesced into one request; there is deliberately no time-based cache, since serving a swap a stale confirmation count or a stale spend status can cost it the window it had to act in.
- **Per-chain configuration** (`altChains` in the engine config): API base URL, backend driver, refund block count and confirmation gate, each editable per chain in OTC Settings. Legacy flat `altApiUrl` / `altRefundBlocks` / `altConfirmations` keys are still honoured, but only for the default alt chain — applying them to Dogecoin would have pointed it at a Litecoin API.
- **Test harness, substantially extended.** `ALT_CHAIN` parameterises every scenario; a BlockCypher-shaped mock backend proves the adapter translates a genuinely non-Esplora API end to end; a new `SCENARIO=altrefund` proves the counter-leg timelocked refund; [`tests/harness/unit-browser-test.js`](tests/harness/unit-browser-test.js) adds a fast in-browser gate for chain constants, policy arithmetic and protocol invariants; [`tests/harness/run-all.sh`](tests/harness/run-all.sh) runs the full matrix. The mocks now enforce **low-S canonicality** (policy on both Litecoin and Dogecoin) and Dogecoin's `-blockmintxfee`, so every broadcast in the suite is proven mineable, not merely relayable.

### Fixed
- **`checkRefunds()` polled the wrong chain's tip height.** The counter-leg refund monitor called `engine.getAltHeight()` unqualified, which resolves to the default alt chain. On a non-Litecoin swap it therefore queried the Litecoin endpoint, so the height gate never opened and **Bob's pre-signed refund was never broadcast** — a fund-recovery failure if the counterparty disappeared. Found by the new `altrefund` scenario; `getAltHeight()`, `altChainConfig()` and `getChainHeight()` now all take an explicit chain code.
- **`claimFee('ROD')` passed the chain as the session argument**, leaving `chainCode` undefined so the ROD branch never fired and the ROD dust pre-check was validated against the counter leg's claim fee. Now `claimFee(null, 'ROD')`.
- **`engine.getChainHeight()` dispatched on `cc === 'LTC'`**, routing every non-Litecoin counter chain to the ROD height endpoint.
- **Funding change output used a hard-coded 546-satoshi threshold.** Change is now compared against the chain's own threshold and, below it, added to the fee instead of emitted — on Dogecoin a 546-koinu change output is far below the 100,000-koinu hard dust limit and would have made the entire funding transaction non-standard.
- **Esplora-specific confirmation derivation** was gated on `apiType === 'esplora'`, so confirmations stayed at 0/1 on any other backend and the confirmation gate could not be satisfied.
- Recurring `404` console errors during swap execution no longer occur on either chain (verified with `TRACE_404=1`).
- **The swap-creation dust gate disagreed with the gate applied at signing.** Creation validated the counter amount against the *hard* dust limit, but `assertSettlementPolicy` requires the claim output to clear the *soft* limit — below it, Dogecoin's flat 0.01 DOGE per-output surcharge pushes the relay minimum above the canonical settlement fee already fixed in the terms. A Dogecoin swap of 0.011-0.02 DOGE therefore passed creation and then stalled permanently at refund signing, retrying every tick with the real cause visible only in the per-swap log. Creation now gates on `CHAINS.minEconomicalOutputSats()`, and the unit harness asserts the two gates agree on every registered chain.
- **The explorer GET cache could pin a failed response.** `coinjs.ajax` has no error channel — it invokes its success callback with the body of a 4xx, a 5xx or a timeout — so the cache stored error bodies and its `promise.fail()` eviction guard was unreachable. A single rate-limit response would have been replayed for the full TTL, exactly when Bob is polling for Alice's claim. Replaced with in-flight coalescing (see Removed).
- **`explorer.scriptForAddress()` read the mutable global network from inside an async callback**, after `withChain()` had already restored it, so a P2SH address was encoded against ROD's version byte and yielded a P2PKH script. Latent rather than live, since the only consumer read just `txid`/`vout` — but it is the wrong-chain-context class this refactor exists to eliminate. Removed entirely: `coin.js` already computes the same fallback synchronously, in the correct network context.
- **`CHAINS.getPolicy()` silently returned ROD's policy for an unregistered chain** — no fee floor, 546-unit dust — which would have turned every relay and dust check into a no-op for a chain added to the definitions table but forgotten in the policy table. It now throws, as does `SWAP.altFees()`.
- **`buildFundingTx()` never validated what it built.** Its fee-convergence loop is bounded at five passes and funding was the one transaction with no post-construction policy check, so a wallet of many small UTXOs could produce a funding transaction paying under the mining floor. It now runs the same `assertSettlementPolicy()` check as claims and refunds, against the finally-selected inputs and outputs.
- **The UI showed `LTC` while operating a Dogecoin swap** — the active-swap detail table (multisig address, refund height, funding and claim txids), swap cards, orderbook headings and ~30 log and timeline entries. A user could have gone looking for Dogecoin funds on a Litecoin explorer. All are now driven from `altChainOf(session)`.
- **The orderbook merged counter chains into one price ladder.** Offers were grouped on price alone, so a ROD/DOGE and a ROD/LTC offer at the same ratio collapsed into a single row with summed volume, and taking it silently switched the counter asset. Rows are now keyed on (chain, price), depth accumulates per chain, and the chain is shown in both the ladder and the offer detail.

### Changed
- Settlement fees are per chain: Litecoin keeps 0.00001 LTC; Dogecoin uses 0.01 DOGE. A ~305-byte 2-of-2 P2SH spend needs ~305,000 koinu at Dogecoin's 1000 koinu/byte mining floor, and paying only the 100 koinu/byte *relay* floor would propagate but be skipped by miners running the default `-blockmintxfee` — on a swap that is not a delay but a fund-loss risk, since a claim that misses its refund deadline hands the counterparty both legs.
- Refund windows are expressed per chain so the protection is the same **wall-clock** duration everywhere (LTC 24 blocks × 2.5 min, DOGE 60 blocks × 1 min, both ≈ 1 h against ROD's 480 × 30 s ≈ 4 h). The unit harness now asserts this ordering in seconds — the safety property is that the alt leg expires *before* the ROD leg, and a block count copied between chains would silently break it.
- Dogecoin's confirmation gate defaults to 6 (~6 min) rather than Litecoin's 1 (~2.5 min): Dogecoin blocks arrive 2.5× faster and carry less independent security, its Scrypt hashrate being supplied almost entirely by Litecoin merge-miners.
- Nostr protocol messages renamed `swap_ltc_*` → `swap_alt_*`. The legacy names are not accepted: they were briefly whitelisted, but no handler matched them, so an older peer's messages were parsed and then silently dropped. Such a swap cannot complete in any case — `altChain` is part of the hashed terms, so the two sides derive different `termsHash` values and negotiation is refused before anything is committed — and an explicit envelope-validation failure is a better diagnostic than silence.
- SegWit is hidden and forced off for Dogecoin throughout the wallet, and `publicKeyToAddress(..., 'bech32')` throws for it. Dogecoin Core permanently disables SegWit (`DEPLOYMENT_SEGWIT.nTimeout = 0`, `IsWitnessEnabled()` hard-returns `false`) and contains no bech32 implementation, so a `doge1…` address would be unspendable.

### Removed
- The Blockchair driver and the multi-backend failover loop. `apiFallbacks` was reset to `[]` on every `applyApiConfig()` and no default or settings control ever populated it, so the failover path could not execute and the driver was unreachable. Its response shape had also never been verified against a live endpoint — shipping unverified code that only ever runs in a failure path is worse than not shipping it. Backends remain switchable per chain in OTC Settings.
- The time-based explorer GET cache, replaced by in-flight request coalescing: concurrent identical GETs share one HTTP request, but a response is never reused after its request completes. This keeps the real saving (several sessions polling the same chain on one tick) while removing any possibility of acting on a stale confirmation count or spend status. A 12-second TTL was in any case shorter than the 30-second automation tick, so it bought little.
- Dead symbols left by the refactor: `explorer.addressBalanceSats`, `chains.blocksForSeconds`, `engine.altGet`, `nostr.isLegacyMessageType` / `canonicalMessageType`, and the `altUnit` UI helper.

### Notes
- Dogecoin has **no `OP_CHECKSEQUENCEVERIFY`**: the BIP68/112/113 deployment window closed unsignalled in 2017 and remains inactive, so relative timelocks are mempool policy rather than consensus there. This protocol is unaffected — its refunds are absolute `nLockTime` with input sequence `0xfffffffe`, which behaves exactly as on Bitcoin — but any future change that reaches for CSV would be unsafe on Dogecoin. BIP65 (CLTV) *is* active, since block 3,464,751.
- Without SegWit, a Dogecoin funding transaction's txid is malleable at the consensus layer. The standardness rules every relaying node applies (strict DER, low-S, minimal pushes, push-only scriptSigs) block all known third-party malleation, which is the position Bitcoin was in before SegWit — but it is policy, not consensus. The Litecoin leg shares this exposure, as it also uses legacy P2SH escrow.

## [2.4.0-alpha.0] - 2026-07-24

### Documentation
- Added concise Apache 2.0 SPDX/copyright notices to fork-specific safe-to-edit project files, while intentionally skipping original Coinb.in sources, vendored/minified or generated assets, binaries/media/fonts/PDFs, lockfiles, JSON artifacts without a safe comment strategy, and other comment-unsafe paths.
- Added project-level mixed-license documentation with root [`LICENSE`](LICENSE) for inherited MIT material, root [`LICENSE-APACHE`](LICENSE-APACHE) for SpaceXpanse fork additions, and clarified repository licensing scope in [`README.md`](README.md).

### Fixed (2026-07-18 — LTC tx creation/validation & swap workflow hardening)
- **Satoshi/coin unit handling (critical, LTC-breaking):** [`js/otc-engine.js`](js/otc-engine.js) treated any numeric amount ≤ 21,000,000 as coin-denominated and multiplied by 1e8. Esplora (litecoinspace.org) returns satoshis, so every LTC UTXO/output below 0.21 LTC was inflated 1e8-fold — LTC funding construction produced `bad-txns-in-belowout` transactions, funding verification reported "output not found", and claim amounts were astronomically wrong. Units are now explicit: UTXO and evidence values are always satoshis; `findFundingOutput()` decides by `apiType` (esplora = sats, ROD `/transaction` = Core-style coin floats); `buildClaimTxFromFunding()` prefers satoshi `value` evidence over the decimal `amount` string.
- **Nostr self-echo overwrote counterparty signatures (claim-breaking):** relays replay a client's own events (always after a reload, when the in-memory dedup cache is empty). The `swap_*_normal_signature` handlers stored the echoed local signature in the `remote*` slots, assembling a 2-of-2 scriptSig with the same signature twice — guaranteed `OP_CHECKMULTISIG` failure at broadcast. Own event IDs are now marked seen at publish time in `publishSwapMessage()`, and all signature/claim/complete handlers ignore events authored by the local Nostr pubkey.
- **Local CHECKMULTISIG pre-broadcast verification:** `buildClaim()` now verifies both claim signatures against the redeem-script pubkeys (in order) before broadcasting, and clears a stored invalid counterparty signature instead of broadcasting a transaction the network must reject.
- **Configured API endpoints were ignored:** the OTC Settings ROD/LTC API URLs were saved but never propagated to `coinjs.networks`, so all real chain calls (balance/UTXO/tx/broadcast) kept using compile-time defaults. `engine.applyApiConfig()` now applies them at engine load and on save.
- **LTC funding fee floor:** the fixed 1000-litoshi funding fee sat at Litecoin's relay floor once the tx grew past ~2 inputs. `buildFundingTx()` now estimates size and enforces ≥ 2 lit/byte (never lowering a caller-provided fee); ROD fees are unchanged.
- **Swap liveness:** each side now self-verifies its own funding output (Alice/ROD, Bob/LTC) instead of waiting for the counterparty's verified-evidence message, and a 30-second automation tick re-drives in-flight sessions, so one failed API call or missed relay message no longer strands a swap. Bob additionally funds LTC only after locally verifying the ROD funding output (`verifiedLocally` flag; remote evidence can no longer masquerade as local verification).
- **CSP blocked all Nostr relays:** `connect-src` in [`_headers`](_headers) had no `wss:` entry, so the deployed site could never open a relay WebSocket. Added `wss:`.
- **Service worker never installed:** [`sw.js`](sw.js) `cache.addAll()` referenced the removed `otc-test.html` (any 404 rejects the whole install) and omitted `js/otc-engine.js`/`js/otc-app-ui.js`. Asset list fixed, cache bumped to `v2.2.1-beta`.

### Verification (2026-07-18)
- End-to-end proof harness (Playwright, two real browser contexts as Alice/Bob, local NIP-01 relay, mock ROD API + mock esplora that fully validate every broadcast transaction with independent bitcoinjs-lib sighashes + noble secp256k1): 24/24 checks pass, including a 0.05 LTC swap (below the old 0.21 LTC unit-bug threshold), 2-of-2 P2SH CHECKMULTISIG claim validation on both chains, mid-swap page-reload resilience, and both sessions reaching `COMPLETE`. Regression run against the pre-fix code reproduces the LTC failure (`bad-txns-in-belowout (20000000 < 1999999999999000)`).

### Documentation
- Carbon Memory was refreshed after OTC codebase analysis; volatile memory now records the current OTC integration surface, indexed-source refresh inputs, follow-up verification for the missing [`otc-test.html`](otc-test.html) reference, and the latest blast-radius review across [`js/otc-engine.js`](js/otc-engine.js), [`js/otc-app-ui.js`](js/otc-app-ui.js), [`js/otc-swap.js`](js/otc-swap.js), [`sw.js`](sw.js), and [`_headers`](_headers).

### Added
- Browser OTC runtime implementation:
  - ECDSA adaptor signature helpers in [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js).
  - Immutable ROD/LTC chain parameters in [`js/otc-chains.js`](js/otc-chains.js).
  - Versioned local storage management in [`js/otc-storage.js`](js/otc-storage.js).
  - Manual Nostr envelope handling in [`js/otc-nostr.js`](js/otc-nostr.js).
  - Swap construction, state machine, and settlement logic in [`js/otc-swap.js`](js/otc-swap.js).
  - OTC UI tab and validation harness in [`otc-test.html`](otc-test.html).
- Security hardening: OTC state persistence now automatically strips sensitive private keys (`localChildPrivateKey`, `privateKeyHex`, `privateKeyWif`, `xprv`) from backups/exports.
- PWA cache update to include new OTC assets.

### Changed
- Integrated OTC UI into [`index.html`](index.html) and updated [`css/style.css`](css/style.css) for swap-specific layouts.
- Updated [`sw.js`](sw.js) and [`_headers`](_headers) to support OTC runtime and narrow CSP helper origins.

### Verification
- OTC runtime validated via [`otc-test.html`](otc-test.html) (6/6 suites passed) and smoke-checked in main wallet UI.

### Added
- Durable maintainer-wiki ingest of the OTC swap planning documents in [`docs/maintainer-wiki/concept-otc-swap-plan.md`](docs/maintainer-wiki/concept-otc-swap-plan.md), including the Phase 1 boundary that routes ROD name operations through local ROD Core RPC while preserving ordinary chain queries and broadcasting on `api.spacexpanse.org:1234`.
- Browser OTC runtime scaffolding in [`index.html`](index.html) with new OTC modules [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js), [`js/otc-chains.js`](js/otc-chains.js), [`js/otc-storage.js`](js/otc-storage.js), [`js/otc-nostr.js`](js/otc-nostr.js), and [`js/otc-swap.js`](js/otc-swap.js), plus the static validation harness [`otc-test.html`](otc-test.html).
- Dedicated OTC swap account derivation, deterministic terms hashing, immutable ROD/LTC chain helpers, manual Nostr envelope import/export, helper-mediated Phase 1 ROD name-operation adapter handling, strict swap-state persistence, and browser validation flows for the straight OTC implementation plan.

### Changed
- Expanded the architecture overview in [`docs/maintainer-wiki/concept-architecture-overview.md`](docs/maintainer-wiki/concept-architecture-overview.md) to distinguish current wallet runtime behavior from forward-looking OTC swap planning content in [`docs/rod-web-swap-v0.3.2.md`](docs/rod-web-swap-v0.3.2.md) and [`docs/rod-web-swap-v0.3.3.md`](docs/rod-web-swap-v0.3.3.md).
- Extended [`js/coin.js`](js/coin.js) with reusable [`coinjs.ecdsa`](js/coin.js) helpers, tagged hashing, and adaptor nonce derivation while preserving ordinary transaction-signing output paths through the existing signer.
- Updated [`sw.js`](sw.js) to cache the OTC scripts and validation harness for offline-first static testing.
- Narrowed OTC helper deployment expectations in [`_headers`](_headers) and [`index.html`](index.html:505) so the documented Phase 1 helper flow works only for same-origin or explicit local helper origins on port `11999`.

### Security
- OTC storage sanitization now strips derived child private keys and similar private signing material from [`localStorage`](js/otc-storage.js:75) backups/exports while keeping only live-page session memory in [`js/otc-swap.js`](js/otc-swap.js:161).

## [2.3.0-beta] - 2026-07-19 — Trustless settlement: timelocked refunds + adaptor signatures

### Added (Critical — refund path)
- **Pre-signed timelocked refund transactions on both chains** ([`js/otc-engine.js`](js/otc-engine.js) `buildRefundTxFromFunding`, [`js/otc-app-ui.js`](js/otc-app-ui.js)): each side now PLANS its funding transaction (signs it locally, does **not** broadcast), announces the planned txid, and both parties exchange verified signatures on nLockTime refund transactions (`sequence 0xfffffffe`) **before any coin touches a chain**. Alice's ROD refund locks late (`refundRodHeight`, default +480 ROD blocks), Bob's LTC refund locks early (`ltcRefundLockHeight`, default +24 LTC blocks) — the standard atomic-swap ordering that prevents the secret holder refunding one side and claiming the other. Refund destinations derive deterministically from the swap child keys.
- **PREPARED gate**: funding broadcast is blocked until the local side holds its fully-signed refund, has countersigned the peer's refund, and has sent + verified both claim adaptor signatures. The timeline records `REFUNDS_READY → SIGNATURES_EXCHANGED → PREPARED` strictly before `ALICE_ROD_FUNDED`.
- **Automated refund monitoring**: the automation tick checks lock heights and outpoint spend status and broadcasts the pre-signed refund when a stalled swap's lock height passes. New states: `ROD_REFUND_BROADCAST`, `LTC_REFUND_BROADCAST`, `ROD_REFUNDED`, `LTC_REFUNDED`, `REFUNDED`, `PARTIALLY_SETTLED`; new messages: `swap_rod/ltc_funding_planned`, `swap_rod/ltc_refund_signature`, `swap_prepared`, `swap_rod/ltc_refund_broadcast`, `swap_refunded`. A manual "Attempt refund" button complements the automation.

### Changed (Critical — atomic settlement)
- **Settlement is now adaptor-signature based end to end** (the normal-signature exchange path is removed): Bob adaptor-signs the LTC claim and Alice adaptor-signs the ROD claim (both encrypted to Alice's adaptor point `Y`, DLEQ-verified by the receiver against a self-built claim sighash). Alice claims LTC with her signature plus Bob's **completed** adaptor signature — mathematically revealing the secret `y` on-chain. Bob recovers `y` from the real broadcast signature (Nostr evidence or, as a chain fallback, esplora `outspend`/`hex` polling), verifies `yG == Y`, completes Alice's ROD adaptor signature, and claims ROD. No party can claim without enabling the counterparty's claim.
- **Confirmation gating** (High): Bob broadcasts LTC funding only after the on-chain ROD funding **matches the planned txid** and reaches `terms.rodConfirmations`; Alice claims only after LTC funding reaches `terms.ltcConfirmations`. Esplora confirmations are now computed from the real chain tip (`/blocks/tip/height`).
- **5-field swap ID** (Medium): `swapId = SHA256(orderId | revision | sellerIdentity | buyerIdentity | termsNonce)`; the receiver verifies the binding before creating a session. Terms additionally carry identities, nonce, refund heights, confirmation counts and canonical claim/refund fees (so both sides build byte-identical sighashes).

### Fixed
- **Ghost automation locks**: per-attempt locks were persisted inside the session object, so async callbacks saving stale copies resurrected cleared locks and could stall the refund monitor for the full staleness window. Locks are now in-memory per page run; `saveExecution` merges into the freshest stored session copy.
- Out-of-order relay delivery of refund/adaptor messages can no longer deadlock the handshake: payloads are stashed and consumed by `processPendingProtocol()` from both handlers and the automation tick.
- Completed adaptor signatures now carry the SIGHASH_ALL byte required in a scriptSig.

### Verification (2026-07-19)
- E2E harness (`tests/harness/`), three scenarios against fully-validating mock chains (bitcoinjs-lib sighash + noble secp256k1, **nLockTime finality**, min-relay fee, dust):
  - **Happy path 27/27**: PREPARED before any broadcast (timeline-proven), funding txids match planned txids, pre-signed refund REJECTED as `non-final` before its lock height, LTC claim carries the completed adaptor signature, Bob's recovered secret satisfies `yG == Y`, both multisigs swept, zero normal-signature messages on the relay, zero invalid broadcasts.
  - **Refund path 21/21**: confirmation gate holds (Bob never funds at 1/3 confs), Bob disappears, chain passes `refundRodHeight`, automation broadcasts the pre-signed refund (locktime + both CHECKMULTISIG signatures independently validated), funds return to Alice, state `REFUNDED`.
  - **Reload resilience**: Alice reloads mid-swap after PREPARED; adaptor signature, signed refund and secret persist and the swap still completes.

## [2.1.0-beta] - 2026-06-13

### Documentation
- Added concise Apache 2.0 SPDX/copyright notices to fork-specific safe-to-edit project files, while intentionally skipping original Coinb.in sources, vendored/minified or generated assets, binaries/media/fonts/PDFs, lockfiles, JSON artifacts without a safe comment strategy, and other comment-unsafe paths.
- Added project-level mixed-license documentation with root [`LICENSE`](LICENSE) for inherited MIT material, root [`LICENSE-APACHE`](LICENSE-APACHE) for SpaceXpanse fork additions, and clarified repository licensing scope in [`README.md`](README.md).

### Fixed (2026-07-18 — LTC tx creation/validation & swap workflow hardening)
- **Satoshi/coin unit handling (critical, LTC-breaking):** [`js/otc-engine.js`](js/otc-engine.js) treated any numeric amount ≤ 21,000,000 as coin-denominated and multiplied by 1e8. Esplora (litecoinspace.org) returns satoshis, so every LTC UTXO/output below 0.21 LTC was inflated 1e8-fold — LTC funding construction produced `bad-txns-in-belowout` transactions, funding verification reported "output not found", and claim amounts were astronomically wrong. Units are now explicit: UTXO and evidence values are always satoshis; `findFundingOutput()` decides by `apiType` (esplora = sats, ROD `/transaction` = Core-style coin floats); `buildClaimTxFromFunding()` prefers satoshi `value` evidence over the decimal `amount` string.
- **Nostr self-echo overwrote counterparty signatures (claim-breaking):** relays replay a client's own events (always after a reload, when the in-memory dedup cache is empty). The `swap_*_normal_signature` handlers stored the echoed local signature in the `remote*` slots, assembling a 2-of-2 scriptSig with the same signature twice — guaranteed `OP_CHECKMULTISIG` failure at broadcast. Own event IDs are now marked seen at publish time in `publishSwapMessage()`, and all signature/claim/complete handlers ignore events authored by the local Nostr pubkey.
- **Local CHECKMULTISIG pre-broadcast verification:** `buildClaim()` now verifies both claim signatures against the redeem-script pubkeys (in order) before broadcasting, and clears a stored invalid counterparty signature instead of broadcasting a transaction the network must reject.
- **Configured API endpoints were ignored:** the OTC Settings ROD/LTC API URLs were saved but never propagated to `coinjs.networks`, so all real chain calls (balance/UTXO/tx/broadcast) kept using compile-time defaults. `engine.applyApiConfig()` now applies them at engine load and on save.
- **LTC funding fee floor:** the fixed 1000-litoshi funding fee sat at Litecoin's relay floor once the tx grew past ~2 inputs. `buildFundingTx()` now estimates size and enforces ≥ 2 lit/byte (never lowering a caller-provided fee); ROD fees are unchanged.
- **Swap liveness:** each side now self-verifies its own funding output (Alice/ROD, Bob/LTC) instead of waiting for the counterparty's verified-evidence message, and a 30-second automation tick re-drives in-flight sessions, so one failed API call or missed relay message no longer strands a swap. Bob additionally funds LTC only after locally verifying the ROD funding output (`verifiedLocally` flag; remote evidence can no longer masquerade as local verification).
- **CSP blocked all Nostr relays:** `connect-src` in [`_headers`](_headers) had no `wss:` entry, so the deployed site could never open a relay WebSocket. Added `wss:`.
- **Service worker never installed:** [`sw.js`](sw.js) `cache.addAll()` referenced the removed `otc-test.html` (any 404 rejects the whole install) and omitted `js/otc-engine.js`/`js/otc-app-ui.js`. Asset list fixed, cache bumped to `v2.2.1-beta`.

### Verification (2026-07-18)
- End-to-end proof harness (Playwright, two real browser contexts as Alice/Bob, local NIP-01 relay, mock ROD API + mock esplora that fully validate every broadcast transaction with independent bitcoinjs-lib sighashes + noble secp256k1): 24/24 checks pass, including a 0.05 LTC swap (below the old 0.21 LTC unit-bug threshold), 2-of-2 P2SH CHECKMULTISIG claim validation on both chains, mid-swap page-reload resilience, and both sessions reaching `COMPLETE`. Regression run against the pre-fix code reproduces the LTC failure (`bad-txns-in-belowout (20000000 < 1999999999999000)`).

### Documentation
- Carbon Memory was refreshed after OTC codebase analysis; volatile memory now records the current OTC integration surface, indexed-source refresh inputs, follow-up verification for the missing [`otc-test.html`](otc-test.html) reference, and the latest blast-radius review across [`js/otc-engine.js`](js/otc-engine.js), [`js/otc-app-ui.js`](js/otc-app-ui.js), [`js/otc-swap.js`](js/otc-swap.js), [`sw.js`](sw.js), and [`_headers`](_headers).

### Added
- Browser OTC runtime implementation:
  - ECDSA adaptor signature helpers in [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js).
  - Immutable ROD/LTC chain parameters in [`js/otc-chains.js`](js/otc-chains.js).
  - Versioned local storage management in [`js/otc-storage.js`](js/otc-storage.js).
  - Manual Nostr envelope handling in [`js/otc-nostr.js`](js/otc-nostr.js).
  - Swap construction, state machine, and settlement logic in [`js/otc-swap.js`](js/otc-swap.js).
  - OTC UI tab and validation harness in [`otc-test.html`](otc-test.html).
- Security hardening: OTC state persistence now automatically strips sensitive private keys (`localChildPrivateKey`, `privateKeyHex`, `privateKeyWif`, `xprv`) from backups/exports.
- PWA cache update to include new OTC assets.

### Changed
- Integrated OTC UI into [`index.html`](index.html) and updated [`css/style.css`](css/style.css) for swap-specific layouts.
- Updated [`sw.js`](sw.js) and [`_headers`](_headers) to support OTC runtime and narrow CSP helper origins.

### Verification
- OTC runtime validated via [`otc-test.html`](otc-test.html) (6/6 suites passed) and smoke-checked in main wallet UI.

### Added
- Durable maintainer-wiki ingest of the OTC swap planning documents in [`docs/maintainer-wiki/concept-otc-swap-plan.md`](docs/maintainer-wiki/concept-otc-swap-plan.md), including the Phase 1 boundary that routes ROD name operations through local ROD Core RPC while preserving ordinary chain queries and broadcasting on `api.spacexpanse.org:1234`.
- Browser OTC runtime scaffolding in [`index.html`](index.html) with new OTC modules [`js/ecdsa-adaptor.js`](js/ecdsa-adaptor.js), [`js/otc-chains.js`](js/otc-chains.js), [`js/otc-storage.js`](js/otc-storage.js), [`js/otc-nostr.js`](js/otc-nostr.js), and [`js/otc-swap.js`](js/otc-swap.js), plus the static validation harness [`otc-test.html`](otc-test.html).
- Dedicated OTC swap account derivation, deterministic terms hashing, immutable ROD/LTC chain helpers, manual Nostr envelope import/export, helper-mediated Phase 1 ROD name-operation adapter handling, strict swap-state persistence, and browser validation flows for the straight OTC implementation plan.

### Changed
- Expanded the architecture overview in [`docs/maintainer-wiki/concept-architecture-overview.md`](docs/maintainer-wiki/concept-architecture-overview.md) to distinguish current wallet runtime behavior from forward-looking OTC swap planning content in [`docs/rod-web-swap-v0.3.2.md`](docs/rod-web-swap-v0.3.2.md) and [`docs/rod-web-swap-v0.3.3.md`](docs/rod-web-swap-v0.3.3.md).
- Extended [`js/coin.js`](js/coin.js) with reusable [`coinjs.ecdsa`](js/coin.js) helpers, tagged hashing, and adaptor nonce derivation while preserving ordinary transaction-signing output paths through the existing signer.
- Updated [`sw.js`](sw.js) to cache the OTC scripts and validation harness for offline-first static testing.
- Narrowed OTC helper deployment expectations in [`_headers`](_headers) and [`index.html`](index.html:505) so the documented Phase 1 helper flow works only for same-origin or explicit local helper origins on port `11999`.

### Security
- OTC storage sanitization now strips derived child private keys and similar private signing material from [`localStorage`](js/otc-storage.js:75) backups/exports while keeping only live-page session memory in [`js/otc-swap.js`](js/otc-swap.js:161).

## [2.1.0-beta] - 2026-06-13

### Added
- Wallet tab WIF import support now lets users paste a ROD WIF private key, decode it locally, open the wallet dashboard, and use the existing balance/send/sign workflow through [`index.html`](index.html:196) and [`js/coinbin.js`](js/coinbin.js:35).

### Security
- Hardened browser entropy generation in [`js/coin.js`](js/coin.js) to rely on the CSPRNG-backed path used by the wallet runtime, preserving existing wallet compatibility while tightening client-side randomness handling.
- Added explicit risk acknowledgments in [`index.html`](index.html:204) and [`index.html`](index.html:533) for legacy Open Wallet credentials and brain-wallet style custom seeds, with enforcement in [`js/coinbin.js`](js/coinbin.js) to require user acknowledgment before sensitive deterministic wallet flows proceed.

### Changed
- Wallet send review/confirm flow now reapplies [`ensureWalletFeeMeetsRelayFloor()`](js/coinbin.js:381) before modal review and final send, prefilling the relay-minimum fee earlier and surfacing the adjustment in the confirmation modal.

### Fixed
- Wallet send confirmation modal alert colors now use readable light-surface variants for fee-floor and broadcast failure messages in [`css/style.css`](css/style.css:690).

## [2.0.2-beta] - 2026-05-28

### Added
- Wallet send reset control now has a stable selector [`#walletSendResetBtn`](index.html:375), enabling reliable reset wiring for spend-flow state restoration.

### Changed
- Wallet send-confirm modal flow now hides/disables modal send action after successful broadcast to prevent accidental duplicate submissions in [`js/coinbin.js`](js/coinbin.js:261).
- Wallet modal lifecycle now restores send controls on modal close (`hidden.bs.modal`) so a new intentional send flow can be started cleanly in [`js/coinbin.js`](js/coinbin.js:345).
- Wallet send flow now enforces a local relay-fee floor pre-check using [`estimateWalletTransactionBytes()`](js/coinbin.js:287) and [`ensureWalletFeeMeetsRelayFloor()`](js/coinbin.js:311).

### Fixed
- ROD API JSON-RPC envelope parsing now consistently unwraps `result` for balance/unspent/transaction paths in [`js/coin.js`](js/coin.js:386), [`js/coin.js`](js/coin.js:1170), and [`js/coin.js`](js/coin.js:1212).
- Broadcast error rendering now stringifies object-form API errors (e.g. `error.message`) instead of showing `[object Object]` in [`js/coin.js`](js/coin.js:1271).
- Wallet send-confirm status now differentiates success vs failure and surfaces failed signed tx recovery data in [`js/coinbin.js`](js/coinbin.js:263).
- Wallet reset action now clears spend/status state and restores send controls in [`js/coinbin.js`](js/coinbin.js:351).

## [2.0.1] - 2026-05-28

### Changed
- Wallet open flow now defaults to Legacy addresses by disabling default SegWit selection in [`index.html`](index.html:222) and [`js/coinbin.js`](js/coinbin.js:164).
- Wallet "Modern SegWit address" controls are now hidden in wallet access options in [`index.html`](index.html:221).
- Wallet receive-card address type chooser dropdown is now hidden in [`index.html`](index.html:278).

### Notes
- This release is a temporary compatibility adjustment for current API behavior that does not accept Bech32 addresses in wallet lookup flows.
- New-address generation behavior remains unchanged, including Bech32 generation controls in [`index.html`](index.html:491).

### Added
- Phase 1 PWA installability assets: [`manifest.webmanifest`](manifest.webmanifest), [`images/icon-192.png`](images/icon-192.png), [`images/icon-512.png`](images/icon-512.png), and [`images/icon-512-maskable.png`](images/icon-512-maskable.png).
- Cross-device install metadata in [`index.html`](index.html:12), including manifest link, theme color, icon links, and Apple mobile web app tags.
- ROD API server health/error checking with a visible warning cue in [`index.html`](index.html:114), [`css/style.css`](css/style.css:169), [`js/coinbin.js`](js/coinbin.js:11), and [`js/coin.js`](js/coin.js:31).

## [2.0.0] - 2026-05-27

### Added (ROD Integration)
- Wallet dashboard refresh guidance in [`index.html`](index.html:245) with supporting styles in [`css/style.css`](css/style.css:484).
- Wallet action workspace placeholder to clarify where action flows open in [`index.html`](index.html:279).

### Changed
- Major wallet UX redesign shipped across [`index.html`](index.html:168), [`css/style.css`](css/style.css:290), and [`js/coinbin.js`](js/coinbin.js:121).
- Wallet page copy now clarifies deterministic behavior: different email/passphrase combinations derive different wallets in [`index.html`](index.html:178).
- Wallet actions now anchor/scroll to the action workspace area for clearer flow in [`js/coinbin.js`](js/coinbin.js:129).
- Tab click behavior now explicitly activates Bootstrap tabs before hash updates to keep navigation state consistent in [`js/coinbin.js`](js/coinbin.js:1661).

### Fixed
- SegWit default option now remains enabled at runtime (no startup override conflict) in [`js/coinbin.js`](js/coinbin.js:133).
- Wallet label presentation now uses normal capitalization (no forced all-caps) in [`css/style.css`](css/style.css:332).
- "Need an offline address? Create one instead." now correctly switches active tab state from wallet to New Address in [`js/coinbin.js`](js/coinbin.js:1661).
- Active tab readability/contrast issues resolved in navbar/tab styling in [`css/style.css`](css/style.css:58).
- Mediator modal readability fixed by high-contrast modal surface/text/button styling in [`css/style.css`](css/style.css:105).

### Verification
- Browser verification completed for wallet open flow, action anchoring, modal readability, active tab readability, and wallet-to-New Address navigation behavior.

### ROD Migration
- Canonical chain parameter snapshot at [`docs/chainparams.0.6.9.cpp`](docs/chainparams.0.6.9.cpp).
- ROD API reference snapshot at [`docs/rod-api-root.html`](docs/rod-api-root.html).
- Persistent ROD compatibility assertions in [`test.html`](test.html).
- Memory bank documentation for project state in [`.kilocode/rules/memory-bank/`](.kilocode/rules/memory-bank/).

### Changed
- Migrated wallet network constants and behavior to SpaceXpanse ROD in [`js/coin.js`](js/coin.js).
- Updated explorer integrations to SpaceXpanse ROD Explorer in [`js/coinbin.js`](js/coinbin.js).
- Updated UI branding/content for SpaceXpanse ROD in [`index.html`](index.html) and [`README.md`](README.md).
- Updated QR/payment URI handling from `bitcoin:` to `rod:` in [`js/coinbin.js`](js/coinbin.js).
- Replaced legacy remote fee-stat dependency with local/offline deterministic fee guidance in [`js/coinbin.js`](js/coinbin.js).

### Fixed
- Normalized broadcast response handling for `{result,error,id}` API format in [`coinjs.transaction().broadcast()`](js/coin.js:1221).
- Corrected settings-reset behavior so ROD HD/network parameters are preserved in [`js/coinbin.js`](js/coinbin.js).
- Guarded donation output paths to avoid invalid/default address usage in [`js/coin.js`](js/coin.js) and [`js/coinbin.js`](js/coinbin.js).
- Fixed stale explorer link targets to official ROD explorer in [`js/coinbin.js`](js/coinbin.js).
- Removed debug artifact from test flow in [`test.html`](test.html).

### Security
- Removed active legacy Chainquery SQL request construction from runtime wallet API flow by moving to direct ROD API integration in [`js/coin.js`](js/coin.js).

### Verification
- Browser-compatible ROD validation matrix completed (16/16 passing).
- Final smoke verification after cleanup completed (13/13 passing).

### Notes
- Public API endpoint now uses `https://api.spacexpanse.org:1234` in [`js/coin.js`](js/coin.js).
