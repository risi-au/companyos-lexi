#!/usr/bin/env bash
# verify-card.sh — the "gate hook" at the orchestration layer. Run after every implementer
# card before treating it as done. Fails (exit 1) if the implementer left a required change
# out (conformance) OR the gate is red — so a card can never be "done" on a red/incomplete state.
#
# Usage:
#   V2\ -\ LEXI/tools/verify-card.sh <checklist.txt> [gate command...]
# If no gate command is given, runs the full gate: pnpm typecheck && pnpm lint && pnpm test.
# Example (scoped gate for a fast loop):
#   verify-card.sh checklist.txt pnpm --filter @companyos/mcp typecheck
set -uo pipefail

checklist="${1:?usage: verify-card.sh <checklist> [gate cmd...]}"; shift || true
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

echo "===== CONFORMANCE ====="
node "V2 - LEXI/tools/conformance-check.mjs" "$checklist"
conf=$?

echo ""
echo "===== GATE ====="
if [ "$#" -gt 0 ]; then
  "$@"; gate=$?
else
  pnpm typecheck && pnpm lint && pnpm test; gate=$?
fi

echo ""
echo "===== VERDICT ====="
if [ "$conf" -eq 0 ] && [ "$gate" -eq 0 ]; then
  echo "CARD GREEN — conformance + gate both pass."
  exit 0
fi
echo "CARD RED — conformance=$conf gate=$gate. Do not mark this card done."
exit 1
