#!/bin/bash
# Remove Agent Triage auto-start hook from ~/.zshrc.

set -e

ZSHRC="${HOME}/.zshrc"
MARKER="# agent-triage auto-start"

if ! grep -qF "$MARKER" "$ZSHRC" 2>/dev/null; then
  echo "No auto-start hook found in $ZSHRC"
  exit 0
fi

# Remove the marker line and the following 4 lines (if/export/script/fi)
sed -i '' "/$MARKER/,+4d" "$ZSHRC"

# Remove trailing blank line left behind
sed -i '' -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$ZSHRC"

echo "Removed auto-start hook from $ZSHRC"
