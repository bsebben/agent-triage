#!/bin/bash
# Reports a Claude Code session's cross-session address — the name another
# session passes to SendMessage's `to` field — to the Agent Triage dashboard, so
# a workspace card can hand it to the user with one click.
#
# The address lives in the Claude Code harness and is readable nowhere else (see
# src/session-addresses.js), so the session itself has to report it: --announce
# asks the model to read its own name out of ListAgents once and POST it, and
# every mode after that is shell-only.
#
# Modes (one Claude Code hook each, registered by
# bin/install-session-address-hook.sh):
#
#   --announce    SessionStart      Ask the session to report its address.
#   --heartbeat   UserPromptSubmit  Keep the registration alive; re-ask only if
#                                   the dashboard says it has no address (server
#                                   restart, TTL expiry), and only while the
#                                   per-tty attempt budget lasts.
#   --end         SessionEnd        Unregister on clean exit.
#
# The liveness mode rides UserPromptSubmit rather than Stop because that is
# where `additionalContext` is honored, which is what makes recovery possible
# without the user doing anything. It costs one localhost request per prompt and
# injects nothing while the address is already known.
#
# Deliberately scoped to the top-level interactive session: a Task-tool
# subagent has its own ListAgents view and no card of its own.
set -euo pipefail

MODE="${1:---announce}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/resolve-pane-tty.sh
source "$SCRIPT_DIR/lib/resolve-pane-tty.sh"
CONFIG="$SCRIPT_DIR/../../config.json"

INPUT=$(cat)

TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
if [[ "$TRANSCRIPT" == */subagents/* ]]; then
  echo '{}'
  exit 0
fi

TTY=$(resolve_pane_tty)
if [ -z "$TTY" ]; then
  echo '{}'
  exit 0
fi

# The model has to cooperate for an announce to land (it runs the curl, and the
# user has to allow it), so the ask has to give up rather than repeat on every
# prompt forever. Attempts are counted per tty in a state file; a successful
# registration resets the count, as does a new session in the same pane.
MAX_ANNOUNCE_ATTEMPTS=3
ATTEMPTS_DIR="${TMPDIR:-/tmp}/agent-triage-session-address"
ATTEMPTS_FILE="$ATTEMPTS_DIR/${TTY//\//_}.attempts"

announce_attempts() {
  local count
  count=$(cat "$ATTEMPTS_FILE" 2>/dev/null || true)
  [[ "$count" =~ ^[0-9]+$ ]] || count=0
  printf '%s' "$count"
}

record_announce_attempt() {
  mkdir -p "$ATTEMPTS_DIR" 2>/dev/null || return 0
  printf '%s' "$(( $(announce_attempts) + 1 ))" >"$ATTEMPTS_FILE" 2>/dev/null || true
}

reset_announce_attempts() {
  rm -f "$ATTEMPTS_FILE" 2>/dev/null || true
}

PORT=7777
if [ -f "$CONFIG" ]; then
  PORT=$(jq -r '.port // 7777' "$CONFIG" 2>/dev/null || echo 7777)
fi
BASE="http://127.0.0.1:$PORT"
ENDPOINT="$BASE/api/session-address"

# Pre-fills the tty and endpoint so the model only has to substitute its own
# name — the one thing it alone can see.
announce_context() {
  cat <<EOF
Agent Triage wants this session's cross-session address so its dashboard card
can offer it for SendMessage. Call ListAgents, read this session's own name from
the self line (e.g. "agent-triage-b7 [40e5ca]"), then run exactly:

curl -sS -X POST $ENDPOINT -H 'Content-Type: application/json' -d '{"tty":"$TTY","address":"<NAME> [<REF>]"}'

Keep the bracketed ref — two live sessions can share a name, and the ref is what
disambiguates them. Do this once, without narrating it, then carry on with the
actual task.
EOF
}

emit_announce() {
  record_announce_attempt
  jq -n --arg event "$1" --arg ctx "$(announce_context)" \
    '{hookSpecificOutput: {hookEventName: $event, additionalContext: $ctx}}'
}

case "$MODE" in
  --announce)
    # A pane can outlive the session that was in it, so a new session starts
    # from a clean attempt count even on a tty that already exhausted one.
    reset_announce_attempts
    # Nothing to report to when the dashboard isn't running, and asking the
    # model to curl a dead port is worse than staying quiet.
    if ! curl -sS --max-time 1 "$BASE/api/config" >/dev/null 2>&1; then
      echo '{}'
      exit 0
    fi
    emit_announce SessionStart
    ;;
  --heartbeat)
    RESPONSE=$(curl -sS --max-time 1 -X POST "$ENDPOINT/heartbeat" \
      -H 'Content-Type: application/json' -d "{\"tty\":\"$TTY\"}" 2>/dev/null || true)
    if [ -z "$RESPONSE" ]; then
      echo '{}'
      exit 0
    fi
    KNOWN=$(echo "$RESPONSE" | jq -r '.known // false' 2>/dev/null || echo "false")
    if [ "$KNOWN" = "true" ]; then
      reset_announce_attempts
      echo '{}'
      exit 0
    fi
    # Out of attempts: the model isn't going to report this session's address
    # (declined, forgot, or curl was denied), so stop asking. The card falls
    # back to copying the pane's details, which is the designed-for outcome for
    # a session with no address — better than an instruction block and a
    # permission prompt on every turn for the life of the session.
    if [ "$(announce_attempts)" -ge "$MAX_ANNOUNCE_ATTEMPTS" ]; then
      echo '{}'
      exit 0
    fi
    emit_announce UserPromptSubmit
    ;;
  --end)
    reset_announce_attempts
    curl -sS --max-time 1 -X DELETE "$ENDPOINT" \
      -H 'Content-Type: application/json' -d "{\"tty\":\"$TTY\"}" >/dev/null 2>&1 || true
    echo '{}'
    ;;
  *)
    echo "usage: $(basename "$0") [--announce|--heartbeat|--end]" >&2
    exit 2
    ;;
esac
