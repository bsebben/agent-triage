#!/bin/bash
# Remove the OSC 7 worktree cwd-reporting hook from ~/.claude/settings.json.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/hooks/report-worktree-cwd.sh"
SETTINGS="${HOME}/.claude/settings.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to uninstall this hook (safely edits ~/.claude/settings.json)." >&2
  exit 1
fi

if [[ ! -f "$SETTINGS" ]]; then
  echo "No $SETTINGS found — nothing to remove"
  exit 0
fi

if ! jq -e --arg cmd "$HOOK_SCRIPT" \
    '(.hooks.PostToolUse // []) | any(.hooks[]?.command == $cmd)' \
    "$SETTINGS" >/dev/null 2>&1; then
  echo "Hook not found in $SETTINGS"
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak-$(date +%Y%m%d%H%M%S)"

TMP="$(mktemp)"
jq --arg cmd "$HOOK_SCRIPT" '
  .hooks.PostToolUse = (
    (.hooks.PostToolUse // [])
    | map(.hooks = (.hooks | map(select(.command != $cmd))))
    | map(select((.hooks | length) > 0))
  )
' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"

echo "Removed worktree cwd hook from $SETTINGS"
echo "(backup saved alongside it as $(basename "$SETTINGS").bak-*)"
