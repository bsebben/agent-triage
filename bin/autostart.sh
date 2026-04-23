#!/bin/bash
# Auto-start Agent Triage server in the background.
# Called from ~/.zshrc when a shell opens inside cmux.
# Idempotent: uses a lockfile to prevent races across multiple shells.

LOCKFILE="/tmp/agent-triage-autostart.lock"

# Atomic lock: mkdir is atomic on all POSIX systems
if ! mkdir "$LOCKFILE" 2>/dev/null; then
  exit 0
fi
trap 'rmdir "$LOCKFILE" 2>/dev/null' EXIT

# Check if the server is already running
if curl -sf --connect-timeout 1 http://localhost:7777/api/config >/dev/null 2>&1; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGFILE="/tmp/agent-triage.log"

cd "$SCRIPT_DIR"
nohup node src/server.js > "$LOGFILE" 2>&1 &
