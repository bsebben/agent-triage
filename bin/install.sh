#!/bin/bash
# Install Agent Triage auto-start hook into ~/.zshrc.
# Adds a block that launches the dashboard when the first cmux shell opens.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOSTART="$SCRIPT_DIR/autostart.sh"
ZSHRC="${HOME}/.zshrc"
MARKER="# agent-triage auto-start"

if grep -qF "$MARKER" "$ZSHRC" 2>/dev/null; then
  echo "Already installed in $ZSHRC"
  exit 0
fi

cat >> "$ZSHRC" << 'HOOK'

# agent-triage auto-start (runs via precmd so cmux socket is ready)
_agent_triage_precmd() {
  [[ -z "$CMUX_WORKSPACE_ID" ]] && return
  local marker="/tmp/agent-triage-started.$(stat -f%B "$CMUX_SOCKET" 2>/dev/null)"
  if [[ -f "$marker" ]]; then
    precmd_functions=(${precmd_functions:#_agent_triage_precmd})
    return
  fi
  # Only attempt once cmux is actually responsive
  "${CMUX_BUNDLED_CLI_PATH:-cmux}" list-workspaces &>/dev/null || return
  command rm -f /tmp/agent-triage-started.*(N) 2>/dev/null
  touch "$marker"
  AUTOSTART_SCRIPT &>/dev/null &
  precmd_functions=(${precmd_functions:#_agent_triage_precmd})
}
precmd_functions+=(_agent_triage_precmd)
HOOK

# Patch in the actual path (can't use $AUTOSTART inside a quoted heredoc)
sed -i '' "s|AUTOSTART_SCRIPT|$AUTOSTART|" "$ZSHRC"

echo "Installed auto-start hook in $ZSHRC"
echo "The dashboard will start automatically the next time cmux launches."
