#!/usr/bin/env bash
# Remove the local-scope b3os-mcp override created by dev-link.sh.
# User-scope entry is left untouched.
set -euo pipefail

if ! claude mcp remove b3os-mcp -s local 2>/dev/null; then
  echo "No local-scope b3os-mcp entry to remove."
  exit 0
fi

echo "✓ Local-scope b3os-mcp removed. User-scope entry is back in effect."
echo "  Restart Claude Code in this directory to reload."
