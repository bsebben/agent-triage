#!/bin/bash
# Install Agent Triage auto-start hook into ~/.zshrc.
# Adds a block that launches the dashboard when the first cmux shell opens.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOSTART="$SCRIPT_DIR/autostart.sh"
ZSHRC="${HOME}/.zshrc"
MARKER="# agent-triage auto-start"

if grep -qF "$MARKER" "$ZSHRC" 2>/dev/null; then
  echo "Already installed in $ZSHRC"
  exit 0
fi

cat >> "$ZSHRC" << EOF

$MARKER
if [[ -n "\$CMUX_WORKSPACE_ID" && -z "\$_AGENT_TRIAGE_CHECKED" ]]; then
  export _AGENT_TRIAGE_CHECKED=1
  ( $AUTOSTART &>/dev/null & )
fi
EOF

echo "Installed auto-start hook in $ZSHRC"
echo "The dashboard will start automatically the next time cmux launches."
