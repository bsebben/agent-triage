#!/bin/bash
# Install the cross-session address reporting hooks into ~/.claude/settings.json.
#
# These are what let a workspace card copy a real SendMessage address: the
# session reports its own name once per session (the dashboard cannot read it
# from anywhere else), refreshes it while it works, and unregisters on exit.
# Off by default — opt in by running this, or via Settings → Integrations.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/hooks/session-address.sh"
# Overridable so tests (and anyone with Claude Code settings somewhere unusual)
# can point this at a different file. Pointing HOME elsewhere instead would work
# too, but breaks any HOME-dependent tooling this script shells out to.
SETTINGS="${CLAUDE_SETTINGS_PATH:-${HOME}/.claude/settings.json}"

# event:command pairs, one per mode. The mode flag is part of the command, so a
# single script serves all three hook events.
EVENTS=("SessionStart" "UserPromptSubmit" "SessionEnd")
MODES=("--announce" "--heartbeat" "--end")
MATCHER=""

installed_count() {
  local count=0 i cmd
  for i in "${!EVENTS[@]}"; do
    cmd="$HOOK_SCRIPT ${MODES[$i]}"
    if jq -e --arg event "${EVENTS[$i]}" --arg cmd "$cmd" --arg matcher "$MATCHER" \
        '(.hooks[$event] // []) | any(.matcher == $matcher and (.hooks[]?.command == $cmd))' \
        "$SETTINGS" >/dev/null 2>&1; then
      count=$((count + 1))
    fi
  done
  echo "$count"
}

# --check: exit 0 only when all three hooks are registered, 1 otherwise. No side
# effects — lets the Integrations settings UI read live status without
# duplicating these jq queries. A partial install reads as not installed, which
# is the honest answer: the feature needs all three to behave.
if [[ "${1:-}" == "--check" ]]; then
  command -v jq >/dev/null 2>&1 || exit 1
  [[ -f "$SETTINGS" ]] || exit 1
  [[ "$(installed_count)" == "${#EVENTS[@]}" ]] || exit 1
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to install these hooks (safely merges into ~/.claude/settings.json)." >&2
  echo "Install it (e.g. \`brew install jq\`) and re-run this script." >&2
  exit 1
fi

chmod +x "$HOOK_SCRIPT" "$SCRIPT_DIR/hooks/lib/resolve-pane-tty.sh"

if [[ ! -f "$SETTINGS" ]]; then
  mkdir -p "$(dirname "$SETTINGS")"
  echo '{}' > "$SETTINGS"
fi

if [[ "$(installed_count)" == "${#EVENTS[@]}" ]]; then
  echo "Already installed in $SETTINGS"
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak-$(date +%Y%m%d%H%M%S)"

for i in "${!EVENTS[@]}"; do
  EVENT="${EVENTS[$i]}"
  CMD="$HOOK_SCRIPT ${MODES[$i]}"
  TMP="$(mktemp)"
  # Merges into whatever the user already has for this event rather than
  # replacing it: appends to the existing empty-matcher entry when there is one,
  # otherwise adds a new entry.
  jq --arg event "$EVENT" --arg cmd "$CMD" --arg matcher "$MATCHER" '
    .hooks //= {} |
    .hooks[$event] //= [] |
    if ((.hooks[$event] | any(.hooks[]?.command == $cmd)) | not) then
      (.hooks[$event] | map(.matcher == $matcher) | index(true)) as $idx |
      if $idx != null then
        .hooks[$event][$idx].hooks += [{"type": "command", "command": $cmd}]
      else
        .hooks[$event] += [{"matcher": $matcher, "hooks": [{"type": "command", "command": $cmd}]}]
      end
    else . end
  ' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"
done

echo "Installed session address hooks into $SETTINGS"
echo "(backup saved alongside it as $(basename "$SETTINGS").bak-*)"
echo "Note: these point at $HOOK_SCRIPT — if you move or delete this checkout,"
echo "they silently stop firing. Re-run this script after moving the repo."
echo "Remove with: bin/uninstall-session-address-hook.sh"
