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

find_dashboard_workspace() {
  "$CMUX_BIN" find-window "$WS_NAME" 2>/dev/null \
    | grep -F "\"$WS_NAME\"" \
    | head -1 \
    | awk '{print $1}'
}

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
  ws_ref=$(find_dashboard_workspace)
  if [[ -n "$ws_ref" ]]; then
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

# Close all stale Dashboard workspaces (there may be duplicates)
while true; do
  ws_ref=$(find_dashboard_workspace)
  [[ -z "$ws_ref" ]] && break
  "$CMUX_BIN" close-workspace --workspace "$ws_ref" 2>/dev/null
  sleep 0.5
done

"$CMUX_BIN" new-workspace \
  --name "$WS_NAME" \
  --cwd "$SCRIPT_DIR" \
  --command "echo '--- Agent Triage Dashboard ---'; echo 'This workspace runs the dashboard server.'; echo 'Do not close it while the dashboard is in use.'; echo ''; npm start"
