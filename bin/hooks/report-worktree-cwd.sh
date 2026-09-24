#!/bin/bash
# Emits an OSC 7 cwd report so cmux picks up EnterWorktree/ExitWorktree moves that
# happen without the shell ever running `cd` (cmux's own OSC 7 comes from zsh's
# precmd, which never fires while Claude holds the foreground). Feeds the
# agent-triage dashboard's worktree indicator on workspace cards.
#
# Deliberately scoped to the top-level interactive session only: a Task-tool
# subagent's transcript lives under <session>/subagents/<agent-id>.jsonl, and its
# cwd excursions should not be reflected on the parent workspace's card.
#
# Installed via bin/install-worktree-hook.sh — see that script for how this gets
# registered in ~/.claude/settings.json.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/resolve-pane-tty.sh
source "$SCRIPT_DIR/lib/resolve-pane-tty.sh"

INPUT=$(cat)

TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
if [[ "$TRANSCRIPT" == */subagents/* ]]; then
  echo '{}'
  exit 0
fi

CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
if [ -z "$CWD" ]; then
  echo '{}'
  exit 0
fi

TTY=$(resolve_pane_tty)

if [ -z "$TTY" ]; then
  echo '{}'
  exit 0
fi

DEV="/dev/$TTY"
if [ -w "$DEV" ]; then
  printf '\033]7;file://%s%s\007' "$(hostname)" "$CWD" > "$DEV" 2>/dev/null || true
fi

echo '{}'
