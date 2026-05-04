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

Claude Loops integration — monitors autonomous loop agents running in the background. Auto-detected at startup: enabled if the claude-loops plugin data directory is found.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `loops.enabled` | boolean or null | `null` (auto) | Set `false` to explicitly disable. When null or omitted, enabled if claude-loops plugin is installed. |
| `loops.dataDir` | string or null | Auto-detect | Path to the claude-loops plugin data directory. When null, searches `~/.claude/plugins/data/` for a directory matching `claude-loops-*`. |
| `loops.installUrl` | string | *(marketplace link)* | URL shown when loops is not installed, linking to the claude-loops plugin installer. |

### tickets

Jira integration — shows your assigned tickets grouped by parent story. Auto-detected at startup via mcpproxy: enabled if a healthy Jira MCP server is found.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tickets.enabled` | boolean or null | `null` (auto) | Set `false` to explicitly disable. When null or omitted, auto-detects via mcpproxy. |

### pulls

GitHub PR monitoring — shows your open PRs and incoming review requests. Auto-detected at startup: enabled if the `gh` CLI is installed.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pulls.enabled` | boolean or null | `null` (auto) | Set `false` to explicitly disable. When null or omitted, enabled if `gh` CLI is found. |
| `pulls.orgFilter` | string[] or null | `null` (all orgs) | Limit PR search to specific GitHub organizations. Example: `["MyCompany"]`. When null, searches all orgs you have access to. |

## Auto-Detection

All tabs (except Workspaces) are auto-detected at startup. Each tab checks for its dependency — if found, the tab is enabled; if not, it's silently disabled. Set `enabled: false` in any section to explicitly disable a tab.

```
Config: loops enabled (/Users/you/.claude/plugins/data/claude-loops-my-plugin)
Config: pulls enabled
Config: tickets enabled (auto-detected — https://yourcompany.atlassian.net)
Config: cmux binary = /Applications/cmux.app/Contents/Resources/bin/cmux
Config: cmux socket = /Users/you/Library/Application Support/cmux/cmux.sock
```

| Tab | Dependency | Detection |
|-----|-----------|-----------|
| Loops | claude-loops plugin | Searches `~/.claude/plugins/data/` for `claude-loops-*` directory |
| Pulls | `gh` CLI | Checks `which gh` |
| Tickets | mcpproxy + Jira MCP | Runs `mcpproxy upstream list --json`, finds a healthy Jira server, resolves Atlassian Cloud ID |

If auto-detection fails for cmux (required for the dashboard itself), the server exits with a clear message telling you which config field to set.
