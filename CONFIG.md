# Configuration Reference

Agent Triage is configured via a `config.json` file in the project root. Copy the example to get started:

```bash
cp config.example.json config.json
```

All fields are documented below. Fields set to `null` are auto-detected at startup. The server logs what it detected so you can verify without reading the config.

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | `7777` | HTTP server port for the dashboard. |

### cmux

Connection settings for the cmux terminal multiplexer.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cmux.binary` | string or null | Auto-detect | Path to the cmux binary. When null, tries `which cmux`, then checks `/Applications/cmux.app/Contents/Resources/bin/cmux`. Set this if cmux is installed in a non-standard location. |
| `cmux.socket` | string or null | Auto-detect | Path to the cmux Unix socket. When null, uses `~/Library/Application Support/cmux/cmux.sock`. |

### loops

Claude Loops integration — monitors autonomous loop agents running in the background.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `loops.enabled` | boolean | `true` | Show the Loops tab. When the tab is shown but the plugin isn't installed, displays an install prompt. |
| `loops.dataDir` | string or null | Auto-detect | Path to the claude-loops plugin data directory. When null, searches `~/.claude/plugins/data/` for a directory matching `claude-loops-*`. |
| `loops.installUrl` | string | *(marketplace link)* | URL shown when loops is not installed, linking to the claude-loops plugin installer. |

### tickets

Jira integration — shows your assigned tickets grouped by parent story.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tickets.enabled` | boolean | `true` | Show the Tickets tab. When the tab is shown but Jira isn't available, displays a setup hint. |

### pulls

GitHub PR monitoring — shows your open PRs and incoming review requests.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pulls.enabled` | boolean | `true` | Show the Pull Requests tab. When the tab is shown but `gh` isn't installed, displays a setup hint. |
| `pulls.orgFilter` | string[] or null | `null` (all orgs) | Limit PR search to specific GitHub organizations. Example: `["MyCompany"]`. When null, searches all orgs you have access to. |

## Auto-Detection

All tabs are enabled by default and auto-detect their dependencies at startup. If a dependency is missing, the tab stays visible with a helpful message explaining what to install. Set `enabled: false` to hide a tab entirely.

| Tab | Dependency | What happens when missing |
|-----|-----------|--------------------------|
| Loops | claude-loops plugin | Shows install link |
| Pulls | `gh` CLI | Shows install instructions |
| Tickets | mcpproxy + Jira MCP server | Shows setup hint |

If auto-detection fails for cmux (required for the dashboard itself), the server exits with a clear message telling you which config field to set.
