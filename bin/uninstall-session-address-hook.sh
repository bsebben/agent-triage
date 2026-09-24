#!/bin/bash
# Remove the cross-session address reporting hooks from ~/.claude/settings.json.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/hooks/session-address.sh"
SETTINGS="${CLAUDE_SETTINGS_PATH:-${HOME}/.claude/settings.json}"

EVENTS=("SessionStart" "UserPromptSubmit" "SessionEnd")

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to uninstall these hooks (safely edits ~/.claude/settings.json)." >&2
  exit 1
fi

if [[ ! -f "$SETTINGS" ]]; then
  echo "No $SETTINGS found — nothing to remove"
  exit 0
fi

if ! jq -e --arg script "$HOOK_SCRIPT" \
    '[.hooks // {} | to_entries[] | .value[]? | .hooks[]? | .command // ""]
     | any(startswith($script))' \
    "$SETTINGS" >/dev/null 2>&1; then
  echo "Hooks not found in $SETTINGS"
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak-$(date +%Y%m%d%H%M%S)"

for EVENT in "${EVENTS[@]}"; do
  TMP="$(mktemp)"
  # Drops only this script's commands, then prunes entries left with no hooks —
  # any co-resident hook that shared the same matcher stays put. An event left
  # with no entries at all loses its key too, so uninstalling doesn't leave
  # behind event names the user never had.
  jq --arg event "$EVENT" --arg script "$HOOK_SCRIPT" '
    if (.hooks | type) == "object" and (.hooks | has($event)) then
      .hooks[$event] = (
        (.hooks[$event] // [])
        | map(.hooks = ((.hooks // []) | map(select(((.command // "") | startswith($script)) | not))))
        | map(select(((.hooks // []) | length) > 0))
      )
      | if (.hooks[$event] | length) == 0 then del(.hooks[$event]) else . end
    else . end
  ' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"
done

echo "Removed session address hooks from $SETTINGS"
echo "(backup saved alongside it as $(basename "$SETTINGS").bak-*)"
