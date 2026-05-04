# Agent Triage

A live dashboard for monitoring and triaging parallel Claude Code agents running in [cmux](https://cmux.dev). See all your agent workspaces at a glance, track long-running Claude Loop tasks, and monitor PR and ticket status — without switching contexts.

<img width="2448" height="1056" alt="image" src="https://github.com/user-attachments/assets/b5879792-a712-4c22-adac-e9db985aabf2" />


## Prerequisites

- [cmux](https://cmux.dev) installed and running — download from [cmux.dev](https://cmux.dev), open the app, and it starts automatically. cmux provides a Unix socket that the dashboard connects to for real-time workspace data.
- Node.js 20+
- [`gh` CLI](https://cli.github.com/) authenticated (for Pull Requests tab)

## Quick Start

```bash
git clone <repo-url> agent-triage
cd agent-triage
npm install
cp config.example.json config.json
bin/install.sh   # auto-start when cmux launches
npm start        # start now
```

Open `http://localhost:7777` in your browser. After the install, the server will start automatically whenever cmux launches — no manual `npm start` needed.

### Upgrading

Ask Claude Code:

> Pull the latest agent-triage changes, read the CHANGELOG for anything new, and run any setup steps needed.

Or manually:

```bash
git pull
bin/install.sh   # safe to re-run, idempotent
```

## Configuration

Edit `config.json` to customize. The defaults work out of the box if cmux is installed — the server auto-detects paths.

See [CONFIG.md](CONFIG.md) for the full reference of every field.

### Enabling Optional Features

**Claude Loops** — enabled by default if the plugin is installed. If not, the Loops tab shows an install link. Install via the [Claude Code marketplace](https://silver-adventure-o3qwg53.pages.github.io/plugin.html?name=claude-loops).

**Jira Tickets** — enabled by default. Automatically detects a running Jira MCP server at startup. If Jira isn't available, the tab shows a setup hint. Set `tickets.enabled` to `false` to hide the tab. See [CONFIG.md](CONFIG.md) for details.

## Tabs

| Tab | What it shows |
|-----|---------------|
| **Workspaces** | All cmux agent workspaces. Click to focus, dismiss, or close. |
| **Loops** | Long-running Claude Loop tasks. Shows schedule, run count, and whether each loop is running, idle, or errored. |
| **Pull Requests** | Your open PRs (with CI status) and incoming review requests, grouped by repo. Sub-tabs for "Mine" and "Reviews". |
| **Tickets** | Your assigned Jira tickets grouped by parent story, with status badges. |

## Recommended Layout

For the best experience, install the dashboard as a PWA and run it side-by-side with cmux:

### Install as a PWA (recommended)

Installing as a PWA removes the browser tab bar and address bar, giving you a clean full-screen dashboard.

1. Open `http://localhost:7777` in Chrome
2. Click the three-dot menu → **Cast, save, and share** → **Install page as app...**
3. Click Install

To reopen after closing: search **"Agent Triage"** in Spotlight, find it in Launchpad, or pin it to your Dock (right-click dock icon → Options → Keep in Dock).

For a completely clean full-screen view with no toolbar, uncheck **View → "Always Show Toolbar in Full Screen"** in the PWA window.

### Side-by-side with cmux

1. Open cmux and snap it to the **right half** of your screen
2. Open the dashboard (PWA or browser) and snap it to the **left half**

On macOS, use [Rectangle](https://rectangleapp.com/) or built-in window tiling (drag to screen edge) to snap each window. This gives you the dashboard for quick triage on the left, and the full cmux terminal for deep work on the right.

When you click a workspace card in the dashboard, it automatically focuses that workspace in cmux.

## Development

```bash
npm start      # Start the server (auto-reloads on file changes)
npm test       # Run tests
```

## Running the Server

The server must run from a terminal inside cmux (not as a launchd service) because it connects to cmux's Unix socket, which requires the calling process to be in cmux's session context.

Start it in a dedicated cmux workspace and leave it running:

```bash
npm start
```

## Installing via Claude Code

You can ask Claude Code to handle the entire setup:

> Clone agent-triage, install dependencies, copy the example config, start the server, and open localhost:7777 in my browser.
