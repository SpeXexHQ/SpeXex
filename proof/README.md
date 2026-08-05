# Proof artifacts

This directory contains checked-in visual and report artifacts related to wallet and OTC attestation work. The main entry point is [`proof/proofreport.html`](proof/proofreport.html), while the images capture wallet UI states observed during proof generation.

## What is in this directory

- [`proof/proofreport.html`](proof/proofreport.html) — self-contained proof matrix generated from the browser harness. It summarizes all scenarios, checks, validated broadcasts, and observed relay message types.
- [`proof/orderbook.jpg`](proof/orderbook.jpg) — screenshot of the OTC orderbook UI.
- [`proof/rod-wallet.jpg`](proof/rod-wallet.jpg) — screenshot of the ROD wallet used in the proof set.
- [`proof/ltc-wallet.jpg`](proof/ltc-wallet.jpg) — screenshot of the Litecoin wallet used in the proof set.
- [`proof/doge-wallet.jpg`](proof/doge-wallet.jpg) — screenshot of the Dogecoin wallet used in the proof set.
- [`proof/active-swap-detail.jpg`](proof/active-swap-detail.jpg) — active-swap detail screenshot for a completed ROD ↔ LTC session.
- [`proof/active-swap-detail1.jpg`](proof/active-swap-detail1.jpg) — active-swap detail screenshot for a completed ROD ↔ DOGE session.
- [`proof/applied-cryptography-assessment/`](applied-cryptography-assessment/) — separate clean-room adaptor-signature assessment bundle with its own documentation and manifests.

## Role of this folder

This folder is an evidence archive, not executable runtime code and not the authoritative source of current release attestation. Current release validation still comes from rerunning [`bash tests/run-fast.sh`](../tests/run-fast.sh:1) and, before release, [`bash tests/harness/run-all.sh`](../tests/harness/run-all.sh:1).

## What the proof report proves

The report title and summary state that it was generated from harness runs of the unmodified wallet in headless Chromium and that every broadcast was independently re-parsed and re-attested outside the wallet code itself in [`proof/proofreport.html`](proof/proofreport.html:54).

At the current snapshot, the matrix records:

- `408/408` checks passed in [`proof/proofreport.html`](proof/proofreport.html:61)
- `16` scenarios in [`proof/proofreport.html`](proof/proofreport.html:62)
- `52` validated broadcasts in [`proof/proofreport.html`](proof/proofreport.html:63)
- `4` counter chains in [`proof/proofreport.html`](proof/proofreport.html:64)

Those numbers describe this checked-in artifact only. They should be read as historical evidence for one proof run, not as a promise that the current shipping registry still certifies the same chain set.

## How it works

1. The browser harness drives the live wallet UI and executes swap scenarios.
2. Each scenario emits a section into [`proof/proofreport.html`](proof/proofreport.html) with:
   - the scenario label and chain pair
   - the full swap ID
   - check-by-check assertions
   - independently validated broadcast transactions
   - relay message types observed during the session
3. The report then records whether the expected settlement or refund path completed, plus the payout or refund addresses and amounts.
4. The screenshots in this directory provide visual evidence of the same flows from the wallet UI.

The proof report itself explains the validation model in the opening summary at [`proof/proofreport.html`](proof/proofreport.html:55) and the chain-specific attestation notes at [`proof/proofreport.html`](proof/proofreport.html:2804).

## Active swap detail screenshots

### [`proof/active-swap-detail.jpg`](proof/active-swap-detail.jpg)

This screenshot shows a completed **ROD ↔ LTC OTC Swap** from the buyer side.

Key extracted details:

- Swap ID: `0661ef59c08e14b5ddfcef15e04634683402fe6e99f8a319c8f4a30a18a5718b`
- State: `COMPLETE`
- Role: `Buyer (Bob)`
- Decision: local accepted, remote accepted
- ROD amount: `150.00000000`
- LTC amount: `0.00011100`
- Rate: `0.00000074 LTC/ROD`
- Bilateral ready: `yes`
- Release height: `3987506`
- ROD refund height: `3987972` with `refund pending`

Timeline items visible in the screenshot:

- `SIGNATURES_EXCHANGED`
- `PREPARED`
- `ALICE_ROD_FUNDED`
- `BOB_LTC_FUNDED`
- `READY`
- `LTC_CLAIMED`
- `SECRET_RECOVERED`
- `ROD_CLAIMED`
- `COMPLETE`

What this image shows operationally:

- both parties reached prepared state before funding
- the LTC leg was funded and claimed first
- the adaptor secret was recovered from the LTC claim
- the ROD leg was then claimed and the swap completed

### [`proof/active-swap-detail1.jpg`](proof/active-swap-detail1.jpg)

This screenshot shows a completed **ROD ↔ DOGE OTC Swap** from the seller side.

Key extracted details:

- State: `COMPLETE`
- Role: `Seller (Seller)`
- Decision: local accepted, remote accepted
- ROD amount: `202.00000000`
- DOGE amount: `2.02000000`
- Rate: `0.01000000 DOGE/ROD`
- Bilateral ready: `yes`
- Release height: `4015580`
- ROD refund height: `4016046` with `refund signed`
- DOGE refund height: `6309652` with `refund pending`
- Prepared flags: local and remote
- Adaptor signatures: local sent, remote verified
- Messages: `94 events`

Settlement artifacts visible in the screenshot:

- ROD funding tx present with `conf 54`
- DOGE funding tx present with `conf 70`
- DOGE claim tx present
- ROD claim tx present
- both redeem entries are shown
- adaptor point, seller pubkey, buyer pubkey, seller xpub, and buyer xpub are displayed in the detail panel

Timeline items visible in the screenshot:

- `TERMS_ACCEPTED`
- `REFUNDS_READY`
- `SIGNATURES_EXCHANGED`
- `PREPARED`
- `SELLER_ROD_FUNDED`
- `BUYER_ALT_FUNDED`
- `READY`
- `ALT_CLAIMED`
- `SECRET_RECOVERED`
- `ROD_CLAIMED`

Execution log details visible in the screenshot:

- repeated DOGE funding verification retries while `api.blockcypher.com` was unreachable
- eventual DOGE funding verification at `69/6 confs`
- DOGE claim broadcast
- adaptor secret revealed on-chain during DOGE claim
- final `COMPLETE` state

What this image shows operationally:

- the swap remained safe while external DOGE explorer checks retried
- completion depended on both refunds and adaptor signatures being ready before funding
- the DOGE claim revealed the secret needed to complete the ROD claim

## Relationship between the screenshots and the HTML report

The screenshots are UI evidence, while [`proof/proofreport.html`](proof/proofreport.html) is the structured attestation artifact. The screenshots show what a participant saw in the wallet. The HTML report records the machine-checked outcome, including tx validation and relay message sequencing.

If a reader wants the strongest evidence, start with [`proof/proofreport.html`](proof/proofreport.html), then use the screenshots as visual confirmation of the wallet state that the harness exercised.

## Refresh workflow

When proof artifacts are intentionally regenerated:

1. rerun the relevant harness flows from [`tests/`](../tests/) and [`tests/harness/`](../tests/harness/),
2. replace or add the resulting artifacts in this folder,
3. refresh [`SHA256SUMS`](../SHA256SUMS) with [`node tests/update-checksums.js`](../tests/update-checksums.js:1), and
4. rerun [`bash tests/run-fast.sh`](../tests/run-fast.sh:1).
