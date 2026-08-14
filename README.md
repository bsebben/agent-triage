# Agent Triage

A live dashboard for monitoring parallel Claude Code agents running in [cmux](https://cmux.dev). See all your workspaces at a glance, track Claude Loop tasks, and monitor PR and ticket status — without switching contexts.

<img width="2448" height="1056" alt="image" src="https://github.com/user-attachments/assets/b5879792-a712-4c22-adac-e9db985aabf2" />


## Prerequisites

- macOS
- [cmux](https://cmux.dev) installed and running
- Node.js 20+
- [`gh` CLI](https://cli.github.com/) authenticated (for Pull Requests tab)
- **Google Chrome**, with Automation permission granted to the terminal/process running the server — clicking a PR/ticket link or deploy dot drives Chrome via AppleScript to open it in a dedicated window. Without Chrome or that permission, links fall back to `window.open()` in whatever browser the dashboard itself is running in.

## Setup

```bash
git clone https://github.com/bsebben/agent-triage.git agent-triage
cd agent-triage
npm install
cp config.example.json config.json
bin/install.sh   # auto-start when cmux launches
npm start        # start now (first time only)
```

After install, the server starts automatically in a dedicated cmux workspace every time cmux launches — no manual `npm start` needed.

## Recommended Layout

Run Agent Triage on the **left**, cmux on the **right**, with the cmux sidebar hidden. The dashboard is your control plane — cmux is where you go for deep work on a specific agent.

**Hide the cmux sidebar:** in cmux, right-click the sidebar toggle and set it to auto-hide, or drag the divider fully closed. The dashboard replaces the sidebar as your agent overview.

### Go further: install as a PWA

A PWA (Progressive Web App) is a website installed as a standalone app — it opens in its own window with no browser tab bar or address bar, making it feel like a native app. This gives Agent Triage a clean, minimal look with no browser chrome cluttering the view.

To install:

1. Open `http://localhost:7777` in Chrome
2. Three-dot menu → **Cast, save, and share** → **Install page as app...**
3. Click Install

To reopen: search **"Agent Triage"** in Spotlight, find it in Launchpad, or pin it to your Dock.

### Go further: fullscreen split (macOS)

For a completely immersive setup with no desktop visible:

1. Open both Agent Triage (PWA) and cmux
2. On the Agent Triage window, long-press the green traffic light button → **Tile Window to Left of Screen**
3. Pick cmux as the right-side app

Both apps fill the entire display. Switch to this Space with a three-finger swipe or Mission Control. Use [Rectangle](https://rectangleapp.com/) if you prefer non-fullscreen tiling.

## Upgrading

The dashboard checks for updates automatically every 30 minutes. When a new version is available, an indicator appears in the header — click it to see what changed and apply the update in place.

To update manually:

```bash
git pull
bin/install.sh   # safe to re-run, idempotent
```

## Tabs

| Tab | What it shows |
|-----|---------------|
| **Workspaces** | All cmux agent workspaces. Click to focus, dismiss, or close. |
| **Loops** | Long-running Claude Loop tasks with schedule, run count, and status. |
| **Pull Requests** | Your open PRs with CI status and incoming review requests, grouped by repo. |
| **Tickets** | Your assigned Jira tickets grouped by parent story. Auto-detected at startup. |
| **Tasks** | Persistent todo list that survives server restarts. Disabled by default — enable in `config.json`. |

## Features

### Session refresh

Each Workspaces card for a Claude Code session has a refresh button (&#x21bb;). Click it to restart the Claude Code session in that workspace — the dashboard kills the running Claude process and respawns it in place, preserving the session. Use it when a session gets stuck or you want a clean restart without leaving the dashboard.

### Shift-click danger mode

Hold **Shift** when clicking an action (starting a new session, refreshing a session, or a PR/ticket action) to spawn the Claude session with `--dangerously-skip-permissions`. While Shift is held, the buttons turn red as a visual warning that the next click will run in danger mode.

### Opening links

Clicking a PR/ticket title, the parent-key chip, a "more →" link, or a Buildkite deploy dot drives **Google Chrome** via AppleScript to open the link in its own dedicated window, separate from wherever you clicked from — so it never dumps new tabs into whatever window you happen to be using. Cmd/ctrl/shift/opt-click bypass this and use the browser's native new-tab/new-window behavior instead. Requires Chrome and macOS Automation permission for the terminal/process running the server; without it, links fall back to opening in the dashboard's own browser window.

### Worktree indicator

Workspace groups are keyed by repo, so a repo's main checkout and all its git worktrees share one group instead of appearing as unrelated siblings. A card whose pane is in a linked worktree shows a small pill with the worktree's name (hover for the full paths); the main checkout's own card shows no pill.

This is detected from the pane's working directory, which only reliably tracks a worktree the pane was *opened* into (directly, or via `cd` before launching an agent). An agent that calls `EnterWorktree` and moves in place, without the pane's directory ever changing, won't show the pill — the card falls back to showing the main repo, silently rather than incorrectly.

To close that gap, enable **Worktree indicator hook** under Settings → Integrations. It registers a `PostToolUse` hook (`EnterWorktree`/`ExitWorktree`) in `~/.claude/settings.json` that reports the new directory directly to cmux, so the card stays accurate even when an agent enters a worktree mid-session. It's additive — merges into your existing hooks rather than overwriting them — and off by default; enabling it shows exactly what it does and what it touches before you confirm. Deliberately scoped to the top-level interactive session: a Task-tool subagent that enters a worktree on its own doesn't affect the parent workspace's card. Disabling it in Settings rolls the change back the same way. Requires `jq`. `bin/install-worktree-hook.sh`/`bin/uninstall-worktree-hook.sh` remain directly runnable too, for scripting — the Settings toggle just shells out to the same scripts, so there's one source of truth either way. If you move or delete this checkout after enabling, re-enable it — the hook command points at a path inside it.

**Best practice:** `cd` is only reliably tracked before a session starts (open the pane there, or `cd` before launching the agent) — treat it as a launch-time decision, not a mid-session one. Once a session is running, use `EnterWorktree`/`ExitWorktree` to switch worktrees, not `cd`. A `cd` run through the agent's shell tool only moves that tool's own subprocess; it doesn't relocate the session's actual working context (file resolution, memory/plans, and worktree registration all stay where they were), so the dashboard correctly ignores it rather than showing a move that didn't really happen. If the goal is working in a different, unrelated directory rather than isolating within the same repo, open a new pane or session there instead of asking a running one to relocate.

## Configuration

Open the Settings panel in the dashboard to customize config, view live server logs, manage plugin settings, and enable/disable integrations — no file editing required.

## Development

If the server is already running, just make changes and refresh the browser — there's no build step. The server auto-reloads on backend file changes.

```bash
npm test       # Run tests
```
