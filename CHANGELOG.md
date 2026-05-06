# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.13.3] - 2026-05-06

### Fixed

- Claude sessions are now detected via cmux process tags instead of notification history, fixing workspaces showing as "terminal" after dashboard restart
- Workspaces correctly revert to "terminal" when Claude exits

## [1.13.2] - 2026-05-06

### Fixed

- New Session and New Terminal buttons now only appear on group headers (on hover), not on individual cards

## [1.13.1] - 2026-05-06

### Fixed

- Dismissed cards now show a "close" button alongside "restore" so workspaces can be closed directly

## [1.13.0] - 2026-05-06

### Added

- New Session and New Terminal buttons in the toolbar, per-group headers, and per-card actions
- Session buttons launch Claude Code in the target directory; terminal buttons open a plain shell
- CSS tooltips (`data-tip`) for instant hover labels on all new buttons

## [1.12.2] - 2026-05-06

### Fixed

- Workspace group collapse/expand state is now preserved across polling cycles

## [1.12.1] - 2026-05-05

### Fixed

- PRs from archived repositories are now silently excluded from the Mine and Reviews tabs — archived repos are read-only and can never be acted on

## [1.12.0] - 2026-05-05

### Added

- PR repo groups are now collapsible — click any repo header to fold it. Collapsed state persists across poll cycles and is tracked per sub-tab.

## [1.11.0] - 2026-05-05

### Added

- Settings panel with live server logs, resolved config display, and restart button
- Backdrop overlays on all drawers/panels — click outside or press Escape to close

## [1.10.0] - 2026-05-05

### Added

- Refresh button on Loops, Pulls, and Tickets tabs to trigger an immediate poll
- Button shows inline status feedback (green/red)

## [1.9.0] - 2026-05-05

### Added

- "Assigned to me" toggle button on the Reviews tab — filters to PRs where you are a direct, named reviewer rather than a team member

## [1.8.2] - 2026-05-05

### Fixed

- Jira detection now retries on each poll instead of failing permanently at startup
- Ticket fetch errors (rate limits, timeouts) shown in the tab instead of "No assigned tickets"
- Tab status (hints, availability) streams via WebSocket for real-time updates
- Poll errors show friendly one-line messages instead of raw mcpproxy stderr

## [1.8.1] - 2026-05-04

### Fixed

- Replaced N+1 GitHub API calls with single GraphQL query per PR section (authored + review-requested)

## [1.8.0] - 2026-05-04

### Changed

- All optional tabs (Loops, Pulls, Tickets) are now enabled by default with auto-detection; missing dependencies show a setup hint instead of hiding the tab
- Jira tickets are zero-config: auto-detected at startup when a Jira MCP server is available

## [1.7.1] - 2026-04-29

### Changed

- `npm start` now runs the server with `node --watch`, so backend changes pulled from master take effect on the next file change without a manual restart. The redundant `npm run dev` script was removed.

## [1.7.0] - 2026-04-29

### Changed

- Workspace groups on the Workspaces tab now sort alphabetically by directory and stay in that order — previously they reordered as item categories changed.

## [1.6.0] - 2026-04-29

### Added

- Clicking the version number in the header opens a modal displaying the project's changelog
- `GET /api/changelog` endpoint that serves `CHANGELOG.md` as plain text

## [1.5.0] - 2026-04-28

### Added

- Per-row action drawer on Pull Requests and Tickets tabs — clicking the Claude icon opens a side drawer with item metadata and a vertical action menu (status, review, address comments, update description for PRs; investigate, start work for tickets)
- Skill-backed actions fall back to plain-language instructions when the relevant plugin or skill isn't installed

## [1.4.0] - 2026-04-28

### Added

- Per-row Claude-icon button on Pull Requests and Tickets tabs that opens a new cmux workspace and launches Claude with the PR or ticket as initial context
- For PR rows, the new workspace opens in `~/workspace/<repo>` if cloned locally, falling back to `~/workspace` then `~`
- New workspaces are auto-selected and focused after creation

### Fixed

- Dismiss button on workspace cards no longer un-dismisses items on the next poll (`Queue.upsert` was unconditionally resetting `dismissed: false`)

## [1.3.1] - 2026-04-28

### Fixed

- `runCli` no longer passes `execFile`'s `timeout` option, which was sending SIGTERM to the cmux helper mid-write and causing it to crash with an unhandled `NSFileHandleOperationException` (SIGABRT). A JS-level timer rejects on slow invocations without killing the child process.

## [1.3.0] - 2026-04-27

### Added

- Author filter dropdown on the PR Reviews tab, auto-populated from review request authors
- Status filter dropdown on both Mine and Reviews PR tabs (open, draft, comments, approved)

## [1.3.0] - 2026-04-27

### Added

- "Terminal" category for plain shell workspaces — dimmed gray cards with `>_` icon, sorted below running agents
- Notification history tracking to distinguish Claude Code sessions from plain terminals

### Fixed

- Workspace tab badge now only counts items needing attention (excludes running and terminal)

## [1.2.1] - 2026-04-23

### Fixed

- Auto-start shell hook now uses zsh `precmd` instead of running during shell init, fixing broken-pipe failures when cmux socket isn't ready yet
- Replaced env-var guard (`_AGENT_TRIAGE_CHECKED`) with file-based marker keyed to cmux socket birth time, so the hook reliably fires after cmux restarts
- Stale lockfile detection — autostart now checks if the lock holder PID is alive and reclaims dead locks
- Stale server cleanup — detects and kills orphaned servers from previous cmux sessions before starting a new one

### Changed

- Dashboard now runs in a dedicated cmux workspace ("Agent Triage Dashboard Host") instead of a background `nohup` process
- Autostart reads port from `config.json` instead of hardcoding 7777
- Monitor filters out the dashboard's own workspace from notification cards

## [1.2.0] - 2026-04-23

### Added

- Auto-start via `bin/install.sh` shell hook (launches dashboard when cmux opens)
- `bin/uninstall.sh` to remove the shell hook
- Changelog guidelines in CLAUDE.md
- Dynamic version reading from package.json at runtime

### Fixed

- Race condition where multiple cmux shells could each create a Dashboard workspace

### Removed

- cmux `set-hook` based auto-start (hooks were stored but never fired by cmux)

## [1.1.0] - 2025-04-22

### Added

- Semver version check script (`npm run version-check`)
- CLAUDE.md with setup instructions and architecture reference

### Changed

- Right-aligned version display in header
- Simplified README auto-start instructions

### Fixed

- Loops detection reliability
- Socket RPC connection handling

## [1.0.0] - 2025-04-21

### Added

- HTTP + WebSocket server with polling data sources
- cmux workspace and notification monitoring
- Claude Loops plugin data integration
- GitHub PR fetching via `gh` CLI
- Jira ticket fetching via MCP
- In-memory notification queue with dismiss/restore
- Vanilla JS frontend dashboard (no build step)
- PWA support for full-screen installation
