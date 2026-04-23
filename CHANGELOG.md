# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- Jira ticket fetching via mcpproxy CLI
- In-memory notification queue with dismiss/restore
- Vanilla JS frontend dashboard (no build step)
- PWA support for full-screen installation
