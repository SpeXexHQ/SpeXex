#!/usr/bin/env bash
# Complete release gate:
#   1. deterministic Node contract/security/release/mutation checks
#   2. real-browser integration + offline PWA check
#   3. independently validated settlement matrix for every ordered pair of
#      distinct attested chains
set -u
set -o pipefail
cd "$(dirname "$0")"

FAILED=0
RESULTS=()
NODE_BIN="${NODE_BIN:-}"
DOGE_ROD_REFUND_REPEATS="${DOGE_ROD_REFUND_REPEATS:-3}"

if [ -z "$NODE_BIN" ]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  elif command -v node.exe >/dev/null 2>&1; then
    NODE_BIN="$(command -v node.exe)"
  else
    echo "node not found in PATH; set NODE_BIN to a Node executable"
    exit 127
  fi
fi

mapfile -t SUPPORTED_SWAP_PAIRS < <(
  "$NODE_BIN" -e "const codes=require('../../js/chain-registry.js').swapCodes(); for(const asset of codes) for(const payment of codes) if(asset!==payment) console.log(asset+':'+payment)"
)
if [ "${#SUPPORTED_SWAP_PAIRS[@]}" -eq 0 ]; then
  echo "chain registry must contain at least two attested chains"
  exit 65
fi

if ! [[ "$DOGE_ROD_REFUND_REPEATS" =~ ^[1-9][0-9]*$ ]] || [ "$DOGE_ROD_REFUND_REPEATS" -gt 20 ]; then
  echo "DOGE_ROD_REFUND_REPEATS must be an integer from 1 through 20"
  exit 64
fi

record() {
  local label="$1" code="$2"
  if [ "$code" -eq 0 ]; then
    RESULTS+=("PASS  $label")
  else
    RESULTS+=("FAIL  $label")
    FAILED=1
  fi
}

run_node() {
  local label="$1" script="$2"
  shift 2
  echo ""
  echo "=============================================================="
  echo ">>> $label"
  echo "=============================================================="
  env "$@" "$NODE_BIN" "$script"
  record "$label" "$?"
}

run_e2e() {
  local label="$1"
  shift
  echo ""
  echo "=============================================================="
  echo ">>> $label"
  echo "=============================================================="
  env "$@" "$NODE_BIN" e2e-swap-test.js
  record "$label" "$?"
}

run_node "release/package integration contracts" ../release-gate.js
run_node "explorer API contracts and failure isolation" ../explorer-contract.js
run_node "security and protocol adversarial regressions" ../security-regression.js
run_node "wallet balance/network-switch races" ../wallet-balance-race.js
if [ "${SKIP_MUTATIONS:-0}" != "1" ]; then
  run_node "negative controls: blocker mutations must be killed" ../mutation-gate.js
fi

if [ "${FAST_ONLY:-0}" = "1" ]; then
  echo ""
  echo "FAST_ONLY=1: browser and settlement matrix skipped"
else
  if [ ! -d node_modules ]; then
    echo ""
    echo "tests/harness/node_modules is missing; run npm ci in tests/harness"
    record "browser dependency preflight" 1
  else
    run_node "real-browser wiring + offline PWA shell" unit-browser-test.js

    if [[ "${PLAYWRIGHT_CHROMIUM_ARGS_JSON:-}" == *"--single-process"* ]]; then
      echo ""
      echo "PLAYWRIGHT_CHROMIUM_ARGS_JSON contains --single-process."
      echo "The single-context browser gate ran, but that mode invalidates Alice/Bob settlement isolation."
      record "two-peer browser isolation preflight" 1
    else
      for PAIR in "${SUPPORTED_SWAP_PAIRS[@]}"; do
        ASSET_CHAIN="${PAIR%%:*}"
        PAYMENT_CHAIN="${PAIR#*:}"
        run_e2e "e2e $ASSET_CHAIN/$PAYMENT_CHAIN happy path"       ASSET_CHAIN="$ASSET_CHAIN" PAYMENT_CHAIN="$PAYMENT_CHAIN" SCENARIO=happy
        run_e2e "e2e $ASSET_CHAIN/$PAYMENT_CHAIN asset refund"     ASSET_CHAIN="$ASSET_CHAIN" PAYMENT_CHAIN="$PAYMENT_CHAIN" SCENARIO=refund
        run_e2e "e2e $ASSET_CHAIN/$PAYMENT_CHAIN payment refund"   ASSET_CHAIN="$ASSET_CHAIN" PAYMENT_CHAIN="$PAYMENT_CHAIN" SCENARIO=altrefund
        run_e2e "e2e $ASSET_CHAIN/$PAYMENT_CHAIN reload recovery"  ASSET_CHAIN="$ASSET_CHAIN" PAYMENT_CHAIN="$PAYMENT_CHAIN" SCENARIO=happy RELOAD_TEST=1
      done

      if [[ " ${SUPPORTED_SWAP_PAIRS[*]} " == *" ROD:DOGE "* ]] && [ "$DOGE_ROD_REFUND_REPEATS" -gt 1 ]; then
        for ((RUN=2; RUN<=DOGE_ROD_REFUND_REPEATS; RUN++)); do
          run_e2e "stress ROD/DOGE asset refund $RUN/$DOGE_ROD_REFUND_REPEATS" \
            ASSET_CHAIN=ROD PAYMENT_CHAIN=DOGE SCENARIO=refund HARNESS_REPEAT_INDEX="$RUN"
        done
      fi
    fi
  fi
fi

echo ""
echo "=============================================================="
echo ">>> PROOF MATRIX"
echo "=============================================================="
for result in "${RESULTS[@]}"; do echo "$result"; done
echo "--------------------------------------------------------------"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL REQUESTED SUITES PASSED"
else
  echo "ONE OR MORE REQUIRED SUITES FAILED"
fi
exit "$FAILED"
