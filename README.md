# Agent Triage

A live dashboard for monitoring parallel Claude Code agents running in [cmux](https://cmux.dev). See all your workspaces at a glance, track Claude Loop tasks, and monitor PR and ticket status — without switching contexts.

<img width="2448" height="1056" alt="image" src="https://github.com/user-attachments/assets/b5879792-a712-4c22-adac-e9db985aabf2" />


## Prerequisites

- [cmux](https://cmux.dev) installed and running
- Node.js 20+
- [`gh` CLI](https://cli.github.com/) authenticated (for Pull Requests tab)

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

## Configuration

Open the Settings panel in the dashboard to customize config, view live server logs, and manage plugin settings — no file editing required.

## Development

If the server is already running, just make changes and refresh the browser — there's no build step. The server auto-reloads on backend file changes.

```bash
npm test       # Run tests
```
