#!/usr/bin/env bash
# Elenchus - Sidecar Build Script
# Delegates to the Node.js build script (build-sidecar.mjs) which uses
# esbuild with plugins + pkg to produce the standalone sidecar binary.
# The output binary is placed where Tauri's externalBin can find it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Rebuild better-sqlite3 for Node 18 ABI if nvm is available
# (pkg embeds Node 18; native addons must match its ABI version)
if [ -n "${NVM_DIR:-}" ] && [ -s "${NVM_DIR:-}/nvm.sh" ]; then
  source "$NVM_DIR/nvm.sh"
  CURRENT_NODE="$(node -v 2>/dev/null || echo 'unknown')"
  if [[ ! "$CURRENT_NODE" =~ ^v18\. ]]; then
    echo "→ Rebuilding better-sqlite3 for Node 18 ABI..."
    nvm use 18 >/dev/null 2>&1
    npm rebuild better-sqlite3 --silent 2>/dev/null || true
    nvm use node >/dev/null 2>&1  # restore original
  fi
fi

node "$SCRIPT_DIR/build-sidecar.mjs"
