# Agent Triage

A live dashboard for monitoring and triaging parallel Claude Code agents running in [cmux](https://cmux.dev). See all your agent workspaces at a glance, track long-running Claude Loop tasks, and monitor PR and ticket status — without switching contexts.

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
npm start
```

Open `http://localhost:7777` in your browser.

## Configuration

Edit `config.json` to customize. The defaults work out of the box if cmux is installed — the server auto-detects paths.

See [CONFIG.md](CONFIG.md) for the full reference of every field.

### Enabling Optional Features

**Claude Loops** — enabled by default if the plugin is installed. If not, the Loops tab shows an install link. Install via the [Claude Code marketplace](https://silver-adventure-o3qwg53.pages.github.io/plugin.html?name=claude-loops).

**Jira Tickets** — disabled by default. Requires [mcpproxy](https://github.com/anthropics/mcpproxy) with a Jira MCP server. Set `tickets.enabled` to `true` and fill in your Jira cloud ID, site URL, JQL query, and MCP tool name. See [CONFIG.md](CONFIG.md) for details.

## Tabs

| Tab | What it shows |
|-----|---------------|
| **Workspaces** | All cmux agent workspaces. Click to focus, dismiss, or close. |
| **Loops** | Long-running Claude Loop tasks. Shows schedule, run count, and whether each loop is running, idle, or errored. |
| **Pull Requests** | Your open PRs (with CI status) and incoming review requests, grouped by repo. Sub-tabs for "Mine" and "Reviews". |
| **Tickets** | Your assigned Jira tickets grouped by parent story, with status badges. |

## Recommended Layout

For the best experience, run cmux and the dashboard side-by-side on the same monitor:

1. Open cmux and full-screen it on the **right half** of your screen
2. Open `http://localhost:7777` in a browser and full-screen it on the **left half**

On macOS, use [Rectangle](https://rectangleapp.com/) or the built-in window tiling (drag to screen edge) to snap each window to half the screen. This gives you the dashboard for quick triage on the left, and the full cmux terminal for deep work on the right.

When you click a workspace card in the dashboard, it automatically focuses that workspace in cmux.

## Development

```bash
npm run dev    # Start with auto-reload on file changes
npm test       # Run tests
```

## Auto-Start (macOS)

The dashboard can run as a launchd service that starts at login and restarts on crash. Ask Claude Code to set it up:

> Set up agent-triage as a launchd service for auto-start.

See [CLAUDE.md](CLAUDE.md) for the full setup instructions Claude Code follows.

## Installing via Claude Code

You can ask Claude Code to handle the entire setup:

> Clone agent-triage, install dependencies, copy the example config, set up the launchd service for auto-start, and open localhost:7777 in my browser.
