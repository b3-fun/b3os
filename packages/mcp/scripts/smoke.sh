#!/usr/bin/env bash
# Fast CLI-only sanity check: build, spin the server over stdio, pipe a
# tools/list request at it, and assert that the auto-generated
# "Call signature:" blocks appear in every tool description.
#
# Runs in a few seconds. No Claude Code involvement. Use this for tight
# iteration during development and as the release gate before shipping.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Building b3os-mcp..."
pnpm run build >/dev/null

echo "→ Requesting tools/list from dist/index.js over stdio..."
RESP="$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' | node dist/index.js 2>/dev/null)"

if [ -z "$RESP" ]; then
  echo "✗ Empty response from server. Build may be broken." >&2
  exit 1
fi

SIG_COUNT="$(printf '%s' "$RESP" | grep -o '"description":"Call signature:' | wc -l | tr -d ' ')"
TOOL_COUNT="$(printf '%s' "$RESP" | grep -o '"name":"b3os_' | wc -l | tr -d ' ')"

echo "  → $TOOL_COUNT tools registered"
echo "  → $SIG_COUNT tools have auto-generated 'Call signature:' blocks"

if [ "$SIG_COUNT" -eq 0 ]; then
  echo "✗ No 'Call signature:' blocks found — registerToolSafe wrapper is not active." >&2
  exit 1
fi

if [ "$SIG_COUNT" -ne "$TOOL_COUNT" ]; then
  echo "✗ $((TOOL_COUNT - SIG_COUNT)) tools are missing signature blocks — some are bypassing registerToolSafe." >&2
  exit 1
fi

echo "✓ All $TOOL_COUNT tools are wrapped and expose auto-generated signatures."
