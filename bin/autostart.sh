#!/bin/bash
# Auto-start Agent Triage dashboard in a cmux workspace.
# Called from ~/.zshrc when a shell opens inside cmux.
# Idempotent: skips if the server is already responding.

# Check if the server is already running
if curl -sf --connect-timeout 1 http://localhost:7777/api/config >/dev/null 2>&1; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Remove stale Dashboard workspace if it exists but the server isn't running
if cmux list-workspaces 2>/dev/null | grep -q "Dashboard"; then
  cmux close-workspace --name "Dashboard" 2>/dev/null
  sleep 1
fi

cmux new-workspace \
  --name "Dashboard" \
  --cwd "$SCRIPT_DIR" \
  --command "npm start"
