#!/bin/bash
# Install Agent Triage auto-start hook into ~/.zshrc.
# Adds a block that launches the dashboard when the first cmux shell opens.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AUTOSTART="$SCRIPT_DIR/autostart.sh"
ZSHRC="${HOME}/.zshrc"
MARKER="# agent-triage auto-start"

ALREADY_INSTALLED=0
if grep -qF "$MARKER" "$ZSHRC" 2>/dev/null; then
  if grep -q 'CMUX_WORKSPACE_ID.*\] && return' "$ZSHRC" 2>/dev/null && \
     ! grep -q '__CFBundleIdentifier' "$ZSHRC" 2>/dev/null; then
    echo "Upgrading outdated hook in $ZSHRC..."
    sed -i '' "/$MARKER/,/^precmd_functions+=.*$/d" "$ZSHRC"
  else
    echo "Already installed in $ZSHRC"
    ALREADY_INSTALLED=1
  fi
fi

# The rest of this script (skill symlinks, the worktree hook prompt below) still
# needs to run on a re-run even when the auto-start block itself is already in
# place — e.g. the documented `git pull && bin/install.sh` upgrade path.
if [[ "$ALREADY_INSTALLED" -eq 0 ]]; then

cat >> "$ZSHRC" << 'HOOK'

# agent-triage auto-start (runs via precmd so cmux socket is ready)
_agent_triage_precmd() {
  [[ "$__CFBundleIdentifier" != "com.cmuxterm.app" && -z "$CMUX_WORKSPACE_ID" ]] && return
  local sock="${CMUX_SOCKET_PATH:-$HOME/Library/Application Support/cmux/cmux.sock}"
  local marker="/tmp/agent-triage-started.$(stat -f%B "$sock" 2>/dev/null)"
  if [[ -f "$marker" ]]; then
    precmd_functions=(${precmd_functions:#_agent_triage_precmd})
    return
  fi
  cmux list-workspaces &>/dev/null || return
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

fi

# --- Skill symlink ---
# Outside the ALREADY_INSTALLED guard above: needs to re-run on a re-run too,
# so a skill added after the auto-start hook was first installed still gets linked.
SKILLS_DIR="$SCRIPT_DIR/../skills"
COMMANDS_DIR="${HOME}/.claude/commands"

if [[ -d "$SKILLS_DIR" ]]; then
  mkdir -p "$COMMANDS_DIR"
  for skill in "$SKILLS_DIR"/*.md; do
    [[ -f "$skill" ]] || continue
    name="$(basename "$skill")"
    target="$COMMANDS_DIR/$name"
    if [[ -L "$target" ]]; then
      rm "$target"
    fi
    ln -s "$skill" "$target"
    echo "Linked skill: $name -> $COMMANDS_DIR/"
  done
fi

# --- Worktree indicator hook (optional) ---
WORKTREE_HOOK="$SCRIPT_DIR/install-worktree-hook.sh"
if [[ -x "$WORKTREE_HOOK" ]] && ! "$WORKTREE_HOOK" --check; then
  if [[ -t 0 ]]; then
    echo
    read -r -p "Enable the worktree indicator hook? Keeps the worktree pill accurate when an agent enters/exits a worktree mid-session (global Claude Code hook, off by default) [y/N] " REPLY
    if [[ "$REPLY" =~ ^[Yy]$ ]]; then
      "$WORKTREE_HOOK" || echo "Worktree hook install failed (see above) — retry anytime with bin/install-worktree-hook.sh."
    else
      echo "Skipped. Run bin/install-worktree-hook.sh anytime to enable it."
    fi
  else
    echo "Optional: run bin/install-worktree-hook.sh to keep the worktree pill accurate for in-place EnterWorktree moves."
  fi
fi
