#!/usr/bin/env bash
set -u
set -o pipefail
cd "$(dirname "$0")/harness"
FAST_ONLY=1 bash ./run-all.sh
