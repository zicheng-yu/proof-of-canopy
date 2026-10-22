#!/usr/bin/env bash
# Starts a throwaway anvil node, deploys the contracts and runs the demo against it.
# KEEP_ANVIL=1 leaves the node running afterwards (e.g. for frontend work).
# SNAPSHOT=1 also records the run as the website's replay.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8545}"
RPC_URL="http://127.0.0.1:${PORT}"
# anvil's first default account (public test key, local use only)
ANVIL_KEY_0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

export PATH="$PATH:$HOME/.foundry/bin"

if cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1; then
  echo "something is already listening on $RPC_URL; stop it or set PORT" >&2
  exit 1
fi

anvil --port "$PORT" --silent &
ANVIL_PID=$!
if [[ "${KEEP_ANVIL:-0}" != "1" ]]; then
  trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
fi

for _ in $(seq 1 50); do
  cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 && break
  sleep 0.1
done

echo "Deploying to anvil at $RPC_URL…"
(cd "$ROOT/contracts" && DEPLOYER_KEY="$ANVIL_KEY_0" forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --broadcast --silent)

RPC_URL="$RPC_URL" node "$ROOT/scripts/demo.ts"

# SNAPSHOT=1 records the run for the website's replay mode (data/replay/demo-31337.json)
if [[ "${SNAPSHOT:-0}" == "1" ]]; then
  RPC_URL="$RPC_URL" node "$ROOT/scripts/snapshot-events.ts"
fi

if [[ "${KEEP_ANVIL:-0}" == "1" ]]; then
  echo "anvil still running on $RPC_URL (pid $ANVIL_PID)"
fi
