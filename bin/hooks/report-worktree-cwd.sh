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

# The hook process has no controlling terminal (`/dev/tty` fails with ENXIO), so
# find the pane's tty by walking up to the nearest ancestor process running claude
# and reading its tty column — that value stays a real ttysNNN even though this
# process's own tty column shows "??". Must use `command=` (full command line),
# not `comm=` — macOS `ps` truncates `comm=` to ~16 chars, which cuts
# "/opt/homebrew/bin/claude" down to "/opt/homebrew/bi" and never matches.
TTY=""
PID=$PPID
for _ in 1 2 3 4 5 6; do
  [ -z "$PID" ] || [ "$PID" -le 1 ] && break
  LINE=$(ps -o ppid=,tty=,command= -p "$PID" 2>/dev/null || true)
  [ -z "$LINE" ] && break
  read -r NEXT_PID TTY_COL COMM <<< "$LINE"
  if [[ "$COMM" == *claude* ]] && [ "$TTY_COL" != "??" ] && [ -n "$TTY_COL" ]; then
    TTY="$TTY_COL"
    break
  fi
  PID="$NEXT_PID"
done

if [ -z "$TTY" ]; then
  echo '{}'
  exit 0
fi

DEV="/dev/$TTY"
if [ -w "$DEV" ]; then
  printf '\033]7;file://%s%s\007' "$(hostname)" "$CWD" > "$DEV" 2>/dev/null || true
fi

echo '{}'
