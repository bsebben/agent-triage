#!/bin/bash
# Auto-start Agent Triage server in a cmux workspace.
# Called from the precmd hook in ~/.zshrc when a shell opens inside cmux.
# Idempotent: uses a lockfile to prevent races across multiple shells.

LOCKFILE="/tmp/agent-triage-autostart.lock"
PIDFILE="$LOCKFILE/pid"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CMUX_BIN="${CMUX_BUNDLED_CLI_PATH:-cmux}"
WS_NAME="Agent Triage Dashboard Host"
PORT=$(jq -r '.port // 7777' "$SCRIPT_DIR/config.json" 2>/dev/null || echo 7777)

# Atomic lock: mkdir is atomic on all POSIX systems
if ! mkdir "$LOCKFILE" 2>/dev/null; then
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    exit 0
  fi
  rm -rf "$LOCKFILE"
  mkdir "$LOCKFILE" 2>/dev/null || exit 0
fi
echo $$ > "$PIDFILE"
trap 'rm -rf "$LOCKFILE" 2>/dev/null' EXIT

# If the server is already running in a live workspace, leave it alone
if curl -sf --connect-timeout 1 "http://localhost:${PORT}/api/config" >/dev/null 2>&1; then
  if "$CMUX_BIN" list-workspaces 2>/dev/null | grep -q "$WS_NAME"; then
    exit 0
  fi
  # Stale server from a previous session
  lsof -ti ":${PORT}" | xargs kill 2>/dev/null
  for i in 1 2 3 4 5; do
    sleep 1
    lsof -ti ":${PORT}" >/dev/null 2>&1 || break
    [[ $i -eq 2 ]] && lsof -ti ":${PORT}" | xargs kill -9 2>/dev/null
  done
fi

# Remove stale Dashboard workspace if it exists but the server isn't running
if "$CMUX_BIN" list-workspaces 2>/dev/null | grep -q "$WS_NAME"; then
  "$CMUX_BIN" close-workspace --name "$WS_NAME" 2>/dev/null
fi

"$CMUX_BIN" new-workspace \
  --name "$WS_NAME" \
  --cwd "$SCRIPT_DIR" \
  --command "echo '--- Agent Triage Dashboard ---'; echo 'This workspace runs the dashboard server.'; echo 'Do not close it while the dashboard is in use.'; echo ''; npm start"
