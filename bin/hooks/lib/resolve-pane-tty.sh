#!/bin/bash
# Resolves the tty of the cmux pane a Claude Code hook is running in.
#
# A hook process has no controlling terminal (`/dev/tty` fails with ENXIO), so
# the pane's tty has to come from the nearest ancestor process running claude
# and its tty column — that value stays a real ttysNNN even though the hook
# process's own tty column shows "??". Must use `command=` (full command line),
# not `comm=`: macOS `ps` truncates `comm=` to ~16 chars, which cuts
# "/opt/homebrew/bin/claude" down to "/opt/homebrew/bi" and never matches.
#
# Sourced by the hooks in this directory (each needs the same walk, and getting
# it subtly wrong is silent). Prints the tty name ("ttys012") or nothing.
resolve_pane_tty() {
  local pid="${1:-$PPID}"
  local tty="" line next_pid tty_col comm
  for _ in 1 2 3 4 5 6; do
    if [ -z "$pid" ] || [ "$pid" -le 1 ]; then break; fi
    line=$(ps -o ppid=,tty=,command= -p "$pid" 2>/dev/null || true)
    if [ -z "$line" ]; then break; fi
    read -r next_pid tty_col comm <<< "$line"
    if [[ "$comm" == *claude* ]] && [ "$tty_col" != "??" ] && [ -n "$tty_col" ]; then
      tty="$tty_col"
      break
    fi
    pid="$next_pid"
  done
  printf '%s' "$tty"
}
