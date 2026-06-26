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

# --- Skill symlink cleanup ---
SKILLS_DIR="$(cd "$(dirname "$0")/../skills" 2>/dev/null && pwd)"
COMMANDS_DIR="${HOME}/.claude/commands"

if [[ -n "$SKILLS_DIR" && -d "$COMMANDS_DIR" ]]; then
  for link in "$COMMANDS_DIR"/*.md; do
    [[ -L "$link" ]] || continue
    target="$(readlink "$link")"
    if [[ "$target" == "$SKILLS_DIR"/* ]]; then
      rm "$link"
      echo "Removed skill link: $(basename "$link")"
    fi
  done
fi

echo "Removed auto-start hook from $ZSHRC"
