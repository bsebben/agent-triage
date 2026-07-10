# Agent Triage

A live dashboard for monitoring parallel Claude Code agents running in [cmux](https://cmux.dev). See all your workspaces at a glance, track Claude Loop tasks, and monitor PR and ticket status — without switching contexts.

<img width="2448" height="1056" alt="image" src="https://github.com/user-attachments/assets/b5879792-a712-4c22-adac-e9db985aabf2" />


## Prerequisites

- [cmux](https://cmux.dev) installed and running
- Node.js 20+
- [`gh` CLI](https://cli.github.com/) authenticated (for Pull Requests tab)

## Setup

```bash
git clone <repo-url> agent-triage
cd agent-triage
npm install
cp config.example.json config.json
bin/install.sh   # auto-start when cmux launches
npm start        # start now (first time only)
```

After install, the server starts automatically in a dedicated cmux workspace every time cmux launches — no manual `npm start` needed.

## Recommended Layout

Install as a PWA and split-screen with cmux for the best experience.

### Install as a PWA

Installing as a PWA removes the browser chrome for a clean full-screen dashboard.

1. Open `http://localhost:7777` in Chrome
2. Three-dot menu → **Cast, save, and share** → **Install page as app...**
3. Click Install

To reopen: search **"Agent Triage"** in Spotlight, find it in Launchpad, or pin it to your Dock.

### Split screen with cmux (macOS)

1. Enter fullscreen on the Agent Triage PWA
2. Long-press the green button → **Tile Window to Left of Screen**
3. Pick cmux as the right-side app

This gives you a clean full-display split with no desktop chrome.

**Tip:** Hide the cmux sidebar — the dashboard replaces it as your primary agent view. Right-click the sidebar toggle in cmux and set it to auto-hide, or drag the divider closed.

For non-fullscreen side-by-side, use [Rectangle](https://rectangleapp.com/) to snap each window to half the screen.

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

## Configuration

Edit `config.json` to customize. The defaults work out of the box if cmux is installed — the server auto-detects paths. See [CONFIG.md](CONFIG.md) for the full field reference.

The in-dashboard Settings panel also lets you edit config, view live server logs, and manage plugin configs without touching files directly.

## Development

```bash
npm start      # Start the server (auto-reloads on file changes)
npm test       # Run tests
```
