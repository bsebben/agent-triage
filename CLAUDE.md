# Agent Triage

Dashboard for monitoring parallel Claude Code agents in cmux.

## Setup

```bash
npm install
cp config.example.json config.json
```

Edit `config.json` as needed. See CONFIG.md for field reference. The server auto-detects cmux paths and loops data directory when fields are set to `null`.

## Running

The server must run from a terminal inside cmux — it connects to cmux's Unix socket which requires the process to be in cmux's session context. A launchd service will not work.

Start in a dedicated cmux workspace:

```bash
npm start
```

Verify: `curl -s http://localhost:7777/api/config` should return JSON.

## Installing as a PWA

For a clean full-screen experience (no tab bar or address bar), install as a Chrome PWA:

1. Open `http://localhost:7777` in Chrome
2. Three-dot menu → **Cast, save, and share** → **Install page as app...**
3. Click Install

After installing, the user can reopen it from Spotlight (search "Agent Triage"), Launchpad, or the Dock. Suggest they pin it to the Dock for quick access.

## Versioning

This project uses semantic versioning. **Before pushing, run `npm run version-check`** to verify the version was bumped.

- **Patch** (x.y.Z): bug fixes, config tweaks, docs-only changes to code files
- **Minor** (x.Y.0): new features, new tabs, new config fields
- **Major** (X.0.0): breaking config changes, removed features, incompatible API changes

The check compares `package.json` version against `origin/master`. If code in `src/`, `public/`, or `test/` changed without a version bump, it fails.

When bumping, update the version in `package.json`. The server reads it at startup and exposes it via `/api/config`.

## Development

```bash
npm run dev           # Start with auto-reload on file changes
npm test              # Run tests
npm run version-check # Verify version bump before pushing
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
