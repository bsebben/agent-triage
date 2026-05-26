# Session Refresh — Design Spec

**Date:** 2026-05-22
**Approach:** Server-orchestrated async refresh

## Summary

Add the ability to refresh Claude Code sessions from the Agent Triage dashboard. Refreshing exits a session and resumes it, causing Claude Code to reload plugins at startup. This lets users pick up plugin updates without losing conversation context.

## Problem

Sessions managed through Agent Triage tend to stay open for long periods. Claude Code loads plugins at session start (including resume). Users don't get plugin updates until they exit and restart. This feature makes that easy — one click per session or one click for all.

## Refresh Mechanics

The server handles the full exit → capture → resume cycle for a single session:

1. **Send `/exit`** to the session's terminal surface via `cmux.sendText()` + `cmux.sendKey()`.
2. **Poll `cmux.readScreen()`** on the surface until the session ID appears in the output. Claude Code prints the session ID on exit (e.g., `Session ID: <uuid>`).
3. **Parse the session ID** from the terminal output.
4. **Send `claude --resume <id>`** to the same surface, then Enter.

A 30-second timeout handles failure cases — if `/exit` doesn't produce a session ID within that window, the refresh fails and returns an error. The session is left as-is (at whatever state `/exit` left it in — likely a shell prompt).

### What gets skipped

- **Terminal-only workspaces** — only Claude Code sessions (identified by the `claude_code` workspace tag via `listAgentWorkspaceIds()`) are eligible.
- **Sessions already being refreshed** — if a refresh is in-flight for a workspace, a second request for the same workspace is rejected.

## Server API

### `POST /api/refresh-session`

Body: `{ "workspaceId": "<id>" }`

Refreshes one Claude Code session. **Async — awaits the full cycle and returns when done.**

Success: `{ "ok": true, "sessionId": "<resumed-session-id>" }`
Failure: `{ "ok": false, "error": "<reason>" }`

Possible errors:
- `"Not a Claude Code session"` — workspace doesn't have the `claude_code` tag
- `"Already refreshing"` — a refresh is already in-flight for this workspace
- `"Timeout waiting for session ID"` — `/exit` didn't produce a session ID within 30s
- `"Workspace not found"` — invalid workspace ID

### `POST /api/refresh-all`

No body. Refreshes all Claude Code sessions concurrently. **Awaits all and returns a summary.**

```json
{
  "ok": true,
  "results": [
    { "workspaceId": "workspace:1", "ok": true, "sessionId": "abc-123" },
    { "workspaceId": "workspace:3", "ok": false, "error": "Timeout waiting for session ID" }
  ]
}
```

## Server Module

Create `src/refresh.js`:

- `refreshSession(workspaceId)` — orchestrates the exit → capture → resume cycle. Needs access to `cmux.sendText()`, `cmux.sendKey()`, `cmux.readScreen()`, and `cmux.listAgentWorkspaceIds()`. Returns `{ ok, sessionId?, error? }`.
- `refreshAll()` — gets all Claude Code workspace IDs, calls `refreshSession()` for each concurrently via `Promise.allSettled()`. Returns array of results.

Internal state: a `Set` of workspace IDs currently being refreshed, used only to reject duplicate requests for the same workspace. This is not exposed to the frontend.

### Session ID Parsing

After sending `/exit`, poll `readScreen()` every 500ms (up to 30s). Look for a line matching a pattern like:

```
Session ID: <uuid>
```

or the session path that Claude Code prints. The exact format needs to be verified by testing — capture the actual exit output and match against it.

### Surface ID Resolution

The refresh function needs a surface reference to send text and read the screen. Resolution path: call `cmux.listTerminals()` which returns `{ workspaceId, paneId, paneRef }` per terminal. Match by `workspaceId` to get the `paneRef`, then use that as the `--surface` argument for `readScreen()` and as the `surface_id` for `sendText()` / `sendKey()`. If no terminal is found for the workspace, the refresh fails with "Workspace not found."

## Frontend

### Per-Card Refresh Button

Each Claude Code session card gets a refresh icon button, placed alongside the existing dismiss/close actions. Hidden for terminal-only workspaces (cards with `category: "terminal"`).

On click:
1. Disable this button, replace icon with a spinner.
2. `POST /api/refresh-session` with the workspace ID.
3. On success: re-enable button, remove spinner. The monitor will pick up the resumed session naturally.
4. On error: re-enable button, show a toast with the error message.

### Toolbar "Refresh All" Button

A button in the Workspaces tab toolbar, next to New Session / New Terminal. Icon: a circular arrow or similar.

On click:
1. Disable this button (spinner), and disable all per-card refresh buttons.
2. `POST /api/refresh-all`.
3. On response: re-enable all buttons. Show toast with summary (e.g., "Refreshed 3 sessions" or "Refreshed 2/3 sessions — 1 failed").

### Concurrent Per-Card Refreshes

Individual per-card refresh buttons operate independently. Clicking refresh on workspace A does **not** disable the refresh button on workspace B. Multiple per-card refreshes can run concurrently.

Only the "Refresh All" toolbar button disables all per-card buttons (since it's already handling every session).

## Scope Boundaries

**In scope:**
- `POST /api/refresh-session` — async exit → capture session ID → resume
- `POST /api/refresh-all` — concurrent refresh of all Claude Code sessions
- Per-card refresh button (Claude Code sessions only)
- Toolbar "Refresh All" button
- Spinner + disabled state on buttons while refresh is in-flight
- 30s timeout per session
- Error reporting via API response + toast

**Out of scope:**
- Plugin update detection / staleness indicators
- Automatic periodic refresh
- Terminal workspace refresh
- Session context preservation beyond `--resume`
- Confirmation dialogs before refresh
