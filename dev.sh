#!/usr/bin/env bash
# dev.sh - One-command dev startup for Elenchus GUI
# Starts backend sidecar + frontend Vite dev server concurrently.
# Ctrl+C shuts down both processes cleanly.
#
# Usage:
#   ELENCHUS_API_KEY=sk-... ./dev.sh
#   ANTHROPIC_API_KEY=sk-... ./dev.sh            # provider-specific key also works
#   ELENCHUS_PROVIDER=openai ELENCHUS_API_KEY=... ./dev.sh
#
# Environment variables (all optional):
#   ELENCHUS_PROVIDER       LLM provider (default: anthropic)
#   ELENCHUS_MODEL          Model name (default: claude-sonnet-4-20250514)
#   ELENCHUS_API_KEY        API key (or use provider-specific env like ANTHROPIC_API_KEY)
#   ELENCHUS_BASE_URL       Base URL for third-party providers
#   ELENCHUS_PROJECT_ROOT   Agent working directory (default: cwd)
#   ELENCHUS_LEVEL          Agent level: L0, L1, L2
#   ELENCHUS_WORKSPACE_ROOT Workspace storage directory (default: ~/Elenchus)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Config from env vars ──────────────────────────────────────────────
PROVIDER="${ELENCHUS_PROVIDER:-anthropic}"
MODEL="${ELENCHUS_MODEL:-claude-sonnet-4-20250514}"
API_KEY="${ELENCHUS_API_KEY:-}"
BASE_URL="${ELENCHUS_BASE_URL:-}"
PROJECT_ROOT="${ELENCHUS_PROJECT_ROOT:-$(pwd)}"
LEVEL="${ELENCHUS_LEVEL:-}"
WORKSPACE_ROOT="${ELENCHUS_WORKSPACE_ROOT:-}"

# ── Build sidecar args ────────────────────────────────────────────────
SIDECAR_ARGS="--serve --provider $PROVIDER --model $MODEL"
[ -n "$API_KEY" ]      && SIDECAR_ARGS="$SIDECAR_ARGS --api-key $API_KEY"
[ -n "$BASE_URL" ]     && SIDECAR_ARGS="$SIDECAR_ARGS --base-url $BASE_URL"
[ -n "$LEVEL" ]        && SIDECAR_ARGS="$SIDECAR_ARGS --level $LEVEL"
SIDECAR_ARGS="$SIDECAR_ARGS --project-root $PROJECT_ROOT"
[ -n "$WORKSPACE_ROOT" ] && SIDECAR_ARGS="$SIDECAR_ARGS --workspace-root $WORKSPACE_ROOT"

# ── Start sidecar, capture port ───────────────────────────────────────
SIDECAR_LOG=$(mktemp /tmp/elenchus-sidecar-XXXXXX.log)

npx tsx "$SCRIPT_DIR/src/interfaces/web/main.ts" $SIDECAR_ARGS > "$SIDECAR_LOG" 2>&1 &
SIDECAR_PID=$!

SIDECAR_PORT=""
for i in $(seq 1 15); do
  # Check if sidecar process is still alive
  if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
    echo "✗ Sidecar process exited unexpectedly. Output:"
    cat "$SIDECAR_LOG" >&2
    rm -f "$SIDECAR_LOG"
    exit 1
  fi
  PORT_LINE=$(grep "^ELENCHUS_PORT=" "$SIDECAR_LOG" 2>/dev/null || true)
  if [ -n "$PORT_LINE" ]; then
    SIDECAR_PORT="${PORT_LINE#ELENCHUS_PORT=}"
    break
  fi
  sleep 1
done

if [ -z "$SIDECAR_PORT" ]; then
  echo "✗ Sidecar failed to start within 15s. Output:"
  cat "$SIDECAR_LOG" >&2
  kill "$SIDECAR_PID" 2>/dev/null || true
  rm -f "$SIDECAR_LOG"
  exit 1
fi

echo "✓ Sidecar started on port $SIDECAR_PORT (PID $SIDECAR_PID)"
echo "  Log file: $SIDECAR_LOG"

# ── Cleanup on exit ───────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$SIDECAR_PID" 2>/dev/null || true
  wait "$SIDECAR_PID" 2>/dev/null || true
  rm -f "$SIDECAR_LOG"
  exit 0
}
trap cleanup EXIT INT TERM

# ── Start Vite with sidecar port ──────────────────────────────────────
cd "$SCRIPT_DIR/gui"
VITE_SIDECAR_PORT=$SIDECAR_PORT npx vite
