# Agent Triage

Dashboard for monitoring parallel Claude Code agents in cmux.

## ⚠️ This is a PUBLIC repository — no internal or company data

This repo is public. Never commit company-internal or confidential information — in code, comments, tests, config, changelog, or PR descriptions. Specifically:

- **No internal hostnames or URLs** (e.g. anything on an internal/VPN-only domain). Read them from an environment variable or the user-owned `config.json` (which is gitignored) — never hardcode them. `config.example.json` ships such fields as `null`.
- **No internal service names, project codenames, or team names.** Use generic placeholders in examples and tests (e.g. `my-project`, `my-service`, `https://deploy-status.example.com`).
- **No secrets** — API keys, tokens, passwords, connection strings. Reference env vars or the user config, never commit the value.
- **No PII or business-confidential data** (employee names/emails, customer data, revenue, roadmap).

When a feature needs an internal endpoint, the pattern is: resolve it from `process.env.<NAME>` first, then `config.json`, and disable the feature gracefully when neither is set. If unsure whether something is safe to publish, treat it as confidential and leave it out.

## Setup

```bash
npm install
cp config.example.json config.json
bin/install.sh   # adds auto-start hook to ~/.zshrc
```

Edit `config.json` as needed. See CONFIG.md for field reference. The server auto-detects cmux paths and loops data directory when fields are set to `null`.

## Running

The server must run from a terminal inside cmux — it connects to cmux's Unix socket which requires the process to be in cmux's session context. A launchd service will not work.

Start in a dedicated cmux workspace:

```bash
npm start
```

Verify: `curl -s http://localhost:7777/api/config` should return JSON.

## Chrome dependency

`/api/open-external` (PR/ticket links, deploy dots) drives **Google Chrome specifically** via AppleScript/`osascript` to open links in a dedicated window — macOS Automation permission for the terminal/process running the server must be granted. There's no equivalent for other browsers. If `osascript` fails (Chrome not installed/running, permission not granted), the client falls back to `window.open()` in whatever browser the dashboard is running in — see `openExternal()` in `src/tabs/pulls.client.js`.

## Auto-start with cmux

Install the shell hook so the dashboard starts automatically when cmux launches:

```bash
bin/install.sh
```

This adds a block to `~/.zshrc` that creates an "Agent Triage Dashboard Host" cmux workspace the first time a shell opens inside cmux. The check is idempotent and uses a lockfile to prevent races. Logs go to `/tmp/agent-triage.log`.

To remove:

```bash
bin/uninstall.sh
```

## Integrations

Consent-gated integrations — optional features that change state outside this app's own footprint (a global Claude Code hook, for example) — live in a dedicated **Integrations** section of the Settings panel, not the regular config form. Enabling one always shows a confirm dialog with what it does and what it touches before making any change; disabling rolls it back immediately with no re-confirmation. Status shown in the UI is always read live from the actual system state (never cached in `config.json`), so it can't drift from reality.

`src/integrations.js` holds the registry — each entry pairs an `id`/`name`/`description`/`warning` with its own `installScript`/`uninstallScript` (a plain shell script pair, following the same contract as `bin/install-worktree-hook.sh`/`bin/uninstall-worktree-hook.sh`: no-arg to install/uninstall, `--check` to report status with no side effects). `src/server.js` exposes this generically via `GET /api/integrations` and `POST /api/integrations/:id/enable`/`disable` — adding a new integration is a new registry entry plus its own install/uninstall scripts, no server or UI changes needed.

The worktree indicator hook is the first entry: it registers a `PostToolUse` hook (`EnterWorktree`/`ExitWorktree`) in `~/.claude/settings.json` that reports the new directory directly to cmux, closing the one gap in the worktree pill (see `README.md`): without it, an agent that calls `EnterWorktree` in place — without the pane's directory ever changing — won't show the pill. Deliberately scoped to the top-level interactive session, not project-wide, because it needs to fire while working in *any* repo. `bin/install-worktree-hook.sh` merges into the user's existing `hooks.PostToolUse` array via `jq` rather than overwriting it, is idempotent, and backs up `settings.json` before each change; `bin/uninstall-worktree-hook.sh` reverses it, restoring any other hooks that shared the same matcher. Both remain directly runnable outside the UI too — the Settings toggle just shells out to them, so there's one source of truth either way. The hook command references an absolute path inside this checkout — moving or deleting it means re-enabling.

**Best practice:** switch worktrees mid-session with `EnterWorktree`/`ExitWorktree`, not `cd` — a shell `cd` only moves that tool's own subprocess, not the session's actual working context, so it won't show up here regardless of whether the worktree hook above is enabled. See `README.md`'s Worktree indicator section for the full rationale.

## Installing as a PWA

For a clean full-screen experience (no tab bar or address bar), install as a Chrome PWA:

1. Open `http://localhost:7777` in Chrome
2. Three-dot menu → **Cast, save, and share** → **Install page as app...**
3. Click Install

After installing, the user can reopen it from Spotlight (search "Agent Triage"), Launchpad, or the Dock. Suggest they pin it to the Dock for quick access.

## Versioning

This project uses semantic versioning. **Every PR must bump the version** — the auto-update feature relies on version changes to notify users. Before pushing, run `npm run version-check` to verify the version was bumped.

- **Patch** (x.y.Z): bug fixes, config tweaks, docs-only changes to code files
- **Minor** (x.Y.0): new features, new tabs, new config fields
- **Major** (X.0.0): breaking config changes, removed features, incompatible API changes

The check compares `package.json` version against `origin/master`. If code in `src/`, `public/`, or `test/` changed without a version bump, it fails.

Bump versions using `npm version` to keep `package.json` and `package-lock.json` in sync:

```bash
npm version patch --no-git-tag-version   # bug fix
npm version minor --no-git-tag-version   # new feature
npm version major --no-git-tag-version   # breaking change
```

Do **not** edit the version in `package.json` by hand — that leaves `package-lock.json` out of sync. The version-check script will catch this before you push.

### Config migrations

`config.json` is user-owned and never touched by `git pull`, so additive config changes are safe but **renames, moves, type/enum changes, and removals** orphan the user's value unless a migration carries it forward. Config carries an integer `configVersion` (absent ⇒ `0`); `src/migrations.js` holds an ordered `migrations` array and `CURRENT_CONFIG_VERSION = migrations.length`. On load, `src/config.js` backs up and migrates any stale config.

`config.shape.json` is a checked-in fingerprint of the config shape (sorted schema keys + version). `npm run version-check` regenerates the live shape and **fails** if the shape changed without a `configVersion` bump, if the committed snapshot is stale, or if `config.example.json`'s `configVersion` doesn't match `CURRENT_CONFIG_VERSION`. Any PR that changes the config shape must add a migration — run the `/config-migration` skill (`skills/config-migration.md`), then `npm run config-snapshot` and commit `config.shape.json`.

Add a corresponding entry in `CHANGELOG.md`. The server reads the version at startup and exposes it via `/api/config`.

## Changelog

Maintain `CHANGELOG.md` using [Keep a Changelog](https://keepachangelog.com/) format. Update the changelog per **pull request**, not per commit.

- Add an `## [Unreleased]` section at the top for in-progress work
- When bumping the version for a PR, move unreleased entries under a new `## [x.y.z] - YYYY-MM-DD` heading
- Group changes under: `Added`, `Changed`, `Fixed`, `Removed` (only include sections that apply)
- Each entry should be a concise one-liner describing the user-visible change

## Development

```bash
npm start             # Start the server (auto-reloads on file changes via --watch)
npm test              # Run tests
npm run version-check # Verify version bump before pushing
```

## cmux Version Compatibility

The dashboard checks the installed cmux version at startup against a supported range defined in `src/cmux-version.js` as `CMUX_VERSION_RANGE` (`{ min, max }`). An orange header pill warns users when their version is outside this range.

When updating the supported range:
1. Edit `CMUX_VERSION_RANGE` in `src/cmux-version.js`
2. Bump the package version and add a changelog entry
3. Test both "too old" and "too new" pill states by temporarily narrowing the range

## Architecture

- `src/server.js` - HTTP + WebSocket server, tab registry, polling; also drives Chrome via AppleScript for `/api/open-external` (see [Chrome dependency](#chrome-dependency))
- `src/config.js` - Config loader (DEFAULTS + cmux detection, passes `config.tabs` to modules)
- `src/utils.js` - Shared utilities (startPolling)
- `src/cmux.js` - Persistent socket RPC to cmux
- `src/monitor.js` - Polls cmux for workspace/notification state
- `src/queue.js` - In-memory queue with dismiss/restore
- `src/worktree.js` - Resolves a directory's git worktree/repo identity, for the workspace-card worktree pill
- `src/integrations.js` - Registry of consent-gated integrations (see [Integrations](#integrations))
- `src/tabs/loops.js` - Tab module: Claude Loops integration
- `src/tabs/pulls.js` - Tab module: GitHub PR monitoring via `gh` CLI
- `src/tabs/tickets.js` - Tab module: Jira tickets via MCP (auto-detected)
- `public/` - Vanilla JS frontend, no build step

### Tab Module Interface

Each tab module in `src/tabs/` exports:
- `defaults` — named export, the tab's default config values
- `default` — the tab object with: `enabled`, `available`, `hint`, `data` (getter), `init(tabConfig, onUpdate)`

Modules define their own defaults, merge them with the config passed to `init()`, detect dependencies, and manage their own polling. Config.js has no tab-specific knowledge.

To add a new tab: create a module in `src/tabs/`, import it in `server.js`, add it to the `tabs` object, and add its config defaults to the tab module's `defaults` export. The config schema is derived at runtime by `buildSchema` (`src/config.js`) from `DEFAULTS`, `FIELD_META`, and the tab defaults — there is no static schema file. A checked-in `config.shape.json` snapshot fingerprints the resulting shape for the PR-time gate.
