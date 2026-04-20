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

## Auto-Start as a Service (macOS)

To keep the dashboard running automatically across reboots, set up a launchd service:

1. Create `~/Library/LaunchAgents/com.agent-triage.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agent-triage</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/agent-triage/src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/path/to/agent-triage</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/agent-triage.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/agent-triage.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
```

2. Update the paths: replace `/usr/local/bin/node` with your Node.js path (`which node`) and `/path/to/agent-triage` with your clone location.

3. Load the service:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.agent-triage.plist
```

The dashboard will now start automatically at login and restart if it crashes. Logs go to `/tmp/agent-triage.log`.

To stop or restart:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.agent-triage.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.agent-triage.plist
```

## Installing via Claude Code

You can ask Claude Code to set this up for you:

> Clone agent-triage, install dependencies, copy the example config, set up the launchd service for auto-start, and open localhost:7777 in my browser.
