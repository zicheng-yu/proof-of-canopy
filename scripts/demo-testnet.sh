#!/usr/bin/env bash
# Deploys a fresh set of contracts to Base Sepolia (verifying source on Basescan when
# ETHERSCAN_API_KEY is set) and runs the demo against it. Reads keys from .env.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$PATH:$HOME/.foundry/bin"

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
RPC_URL="${RPC_URL:-https://sepolia.base.org}"

VERIFY=()
if [[ -n "${ETHERSCAN_API_KEY:-}" ]]; then
  VERIFY=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
fi

(cd "$ROOT/contracts" && forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --broadcast ${VERIFY[@]+"${VERIFY[@]}"})

RPC_URL="$RPC_URL" node "$ROOT/scripts/demo.ts"
