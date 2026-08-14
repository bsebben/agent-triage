#!/bin/bash
# Install the OSC 7 worktree cwd-reporting hook into ~/.claude/settings.json.
#
# This is what lets the dashboard's worktree pill stay accurate when an agent
# calls EnterWorktree/ExitWorktree in place, instead of only when a new pane is
# opened directly at a worktree path. Off by default — opt in by running this.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/hooks/report-worktree-cwd.sh"
MATCHER="EnterWorktree|ExitWorktree"
SETTINGS="${HOME}/.claude/settings.json"

# --check: exit 0 if already installed, 1 otherwise. No side effects — lets
# bin/install.sh decide whether to prompt without duplicating this query.
if [[ "$1" == "--check" ]]; then
  command -v jq >/dev/null 2>&1 || exit 1
  jq -e --arg cmd "$HOOK_SCRIPT" --arg matcher "$MATCHER" \
    '(.hooks.PostToolUse // []) | any(.matcher == $matcher and (.hooks[]?.command == $cmd))' \
    "$SETTINGS" >/dev/null 2>&1
  exit $?
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to install this hook (safely merges into ~/.claude/settings.json)." >&2
  echo "Install it (e.g. \`brew install jq\`) and re-run this script." >&2
  exit 1
fi

chmod +x "$HOOK_SCRIPT"

if [[ ! -f "$SETTINGS" ]]; then
  mkdir -p "$(dirname "$SETTINGS")"
  echo '{}' > "$SETTINGS"
fi

if jq -e --arg cmd "$HOOK_SCRIPT" --arg matcher "$MATCHER" \
    '(.hooks.PostToolUse // []) | any(.matcher == $matcher and (.hooks[]?.command == $cmd))' \
    "$SETTINGS" >/dev/null 2>&1; then
  echo "Already installed in $SETTINGS"
  exit 0
fi

cp "$SETTINGS" "$SETTINGS.bak-$(date +%Y%m%d%H%M%S)"

TMP="$(mktemp)"
jq --arg cmd "$HOOK_SCRIPT" --arg matcher "$MATCHER" '
  .hooks //= {} |
  .hooks.PostToolUse //= [] |
  (.hooks.PostToolUse | map(.matcher == $matcher) | index(true)) as $idx |
  if $idx != null then
    .hooks.PostToolUse[$idx].hooks += [{"type": "command", "command": $cmd}]
  else
    .hooks.PostToolUse += [{"matcher": $matcher, "hooks": [{"type": "command", "command": $cmd}]}]
  end
' "$SETTINGS" > "$TMP" && mv "$TMP" "$SETTINGS"

echo "Installed worktree cwd hook into $SETTINGS"
echo "(backup saved alongside it as $(basename "$SETTINGS").bak-*)"
echo "Note: this points at $HOOK_SCRIPT — if you move or delete this checkout,"
echo "the hook silently stops firing. Re-run this script after moving the repo."
echo "Remove with: bin/uninstall-worktree-hook.sh"
