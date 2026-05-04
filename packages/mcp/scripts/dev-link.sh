#!/usr/bin/env bash
# Build the package and register it as a local-scope override in Claude Code.
#
# Local-scope MCP servers in Claude Code shadow user-scope servers of the same
# name WHEN you start a Claude Code session inside this directory. This lets
# you test a dev build against Claude Code without touching the user-scope
# entry that `b3os-mcp-setup` installed — no swap/restore dance.
#
# Environment variables:
#   B3OS_API_KEY       Required. Falls back to the value stored in the
#                      existing user-scope `b3os-mcp` entry if present.
#   B3OS_SERVER_URL    Optional. Defaults to the value from user-scope, or
#                      https://api.b3os.org if no user-scope entry exists.
set -euo pipefail

# Run from the b3os-mcp package root (this script lives in scripts/).
cd "$(dirname "$0")/.."

echo "→ Building b3os-mcp..."
pnpm run build >/dev/null

DIST_PATH="$(pwd)/dist/index.js"

# Fall back to values from the existing user-scope entry if env vars aren't set.
if [ -z "${B3OS_API_KEY:-}" ] || [ -z "${B3OS_SERVER_URL:-}" ]; then
  EXISTING="$(claude mcp get b3os-mcp 2>/dev/null || true)"
  if [ -n "$EXISTING" ]; then
    : "${B3OS_API_KEY:=$(printf '%s\n' "$EXISTING" | grep -oE 'B3OS_API_KEY=[^[:space:]]+' | head -1 | cut -d= -f2-)}"
    : "${B3OS_SERVER_URL:=$(printf '%s\n' "$EXISTING" | grep -oE 'B3OS_SERVER_URL=[^[:space:]]+' | head -1 | cut -d= -f2-)}"
  fi
fi

if [ -z "${B3OS_API_KEY:-}" ]; then
  cat >&2 <<EOF
✗ B3OS_API_KEY not set and no existing user-scope entry to inherit from.

Options:
  1. Run b3os-mcp-setup first to install a user-scope entry with your key.
  2. Or export the key manually: B3OS_API_KEY=b3sk_... pnpm dev:link
EOF
  exit 1
fi

# Resolve B3OS_ENV shorthand → B3OS_SERVER_URL if not already set.
if [ -z "${B3OS_SERVER_URL:-}" ] && [ -n "${B3OS_ENV:-}" ]; then
  case "$B3OS_ENV" in
    dev)   B3OS_SERVER_URL="https://dev-api.b3os.org" ;;
    local) B3OS_SERVER_URL="http://localhost:8080" ;;
    prod)  B3OS_SERVER_URL="https://api.b3os.org" ;;
    *)     echo "✗ Unknown B3OS_ENV='$B3OS_ENV'. Use dev, local, or prod." >&2; exit 1 ;;
  esac
fi
: "${B3OS_SERVER_URL:=https://api.b3os.org}"

# Remove any stale local-scope entry so we always overwrite cleanly.
claude mcp remove b3os-mcp -s local 2>/dev/null || true

# On macOS/Windows the key should come from the OS keystore, not the env var.
# Only pass B3OS_API_KEY when the keystore isn't available (Linux / fallback).
case "$(uname -s)" in
  Darwin|MINGW*|MSYS*|CYGWIN*)
    # macOS or Windows — keystore is active. Store the key in the keychain
    # if it isn't already there, then omit B3OS_API_KEY from the env block
    # so the dev server exercises the keystore read path.
    if command -v security &>/dev/null; then
      # Try to read existing entry — if missing, store the key now.
      if ! security find-generic-password -s b3os-mcp -w &>/dev/null 2>&1; then
        echo "→ Storing API key in macOS Keychain (service: b3os-mcp)..."
        security add-generic-password -U \
          -a "$(whoami)" -s b3os-mcp \
          -w "$B3OS_API_KEY" \
          -D "b3os-mcp API key" \
          -j "Created by dev-link.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "  ✓ Stored in Keychain"
      else
        echo "→ API key already in macOS Keychain (service: b3os-mcp)"
      fi
    fi
    claude mcp add b3os-mcp node "$DIST_PATH" \
      -e "B3OS_SERVER_URL=$B3OS_SERVER_URL" \
      >/dev/null
    KEYSTORE_MODE="keychain"
    ;;
  *)
    # Linux / other — no keystore, pass the key via env.
    claude mcp add b3os-mcp node "$DIST_PATH" \
      -e "B3OS_API_KEY=$B3OS_API_KEY" \
      -e "B3OS_SERVER_URL=$B3OS_SERVER_URL" \
      >/dev/null
    KEYSTORE_MODE="env-var"
    ;;
esac

cat <<EOF
✓ Local-scope b3os-mcp linked
  command: node $DIST_PATH
  server:  $B3OS_SERVER_URL
  api key: $KEYSTORE_MODE

Next: restart Claude Code in this directory to pick up the dev build.
Undo: pnpm dev:unlink
EOF
