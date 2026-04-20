# Agent Triage

Dashboard for monitoring parallel Claude Code agents in cmux.

## Setup

```bash
npm install
cp config.example.json config.json
```

Edit `config.json` as needed. See CONFIG.md for field reference. The server auto-detects cmux paths and loops data directory when fields are set to `null`.

## Auto-Start (macOS launchd)

To set up the dashboard as a persistent service that starts at login and restarts on crash:

1. Find the user's Node.js path: `which node`
2. Find the user's PATH that includes `gh` and `cmux`: check `dirname $(which gh)` and `dirname $(which cmux)`, then build a PATH string including those directories plus `/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`
3. Write a plist to `~/Library/LaunchAgents/com.agent-triage.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agent-triage</string>
  <key>ProgramArguments</key>
  <array>
    <string>NODE_PATH</string>
    <string>REPO_PATH/src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>REPO_PATH</string>
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
    <string>CONSTRUCTED_PATH</string>
  </dict>
</dict>
</plist>
```

Replace `NODE_PATH` with the result of `which node`, `REPO_PATH` with the absolute path to this repo, and `CONSTRUCTED_PATH` with the PATH built in step 2.

4. Load the service:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.agent-triage.plist
```

5. Verify it started: `curl -s http://localhost:7777/api/config` should return JSON. If not, check `/tmp/agent-triage.log`.

To restart the service:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.agent-triage.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.agent-triage.plist
```

## Development

```bash
npm run dev    # Start with auto-reload on file changes
npm test       # Run tests
```

## Architecture

- `src/server.js` - HTTP + WebSocket server, polls data sources on intervals
- `src/config.js` - Config loader with auto-detection
- `src/cmux.js` - Persistent socket RPC to cmux
- `src/monitor.js` - Polls cmux for workspace/notification state
- `src/queue.js` - In-memory queue with dismiss/restore
- `src/loops.js` - Reads Claude Loops plugin data directory
- `src/pulls.js` - Fetches PRs via `gh` CLI
- `src/tickets.js` - Fetches Jira tickets via mcpproxy CLI
- `public/` - Vanilla JS frontend, no build step
