#!/bin/bash
# Remove Agent Triage auto-start hook from ~/.zshrc.

set -e

ZSHRC="${HOME}/.zshrc"
MARKER="# agent-triage auto-start"

if ! grep -qF "$MARKER" "$ZSHRC" 2>/dev/null; then
  echo "No auto-start hook found in $ZSHRC"
  exit 0
fi

# Remove the full block: marker comment through precmd_functions+=(...) line
sed -i '' "/$MARKER/,/^precmd_functions+=.*$/d" "$ZSHRC"

# Remove trailing blank lines left behind
sed -i '' -e :a -e '/^\n*$/{$d;N;ba' -e '}' "$ZSHRC"

echo "Removed auto-start hook from $ZSHRC"
