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
| `loops.enabled` | boolean | `true` | Show the Loops tab. When true, auto-detects the plugin data directory. When false, shows an install prompt linking to `installUrl`. |
| `loops.dataDir` | string or null | Auto-detect | Path to the claude-loops plugin data directory. When null, searches `~/.claude/plugins/data/` for a directory matching `claude-loops-*`. Set this if you have multiple loop plugins or a non-standard location. |
| `loops.installUrl` | string | *(marketplace link)* | URL shown when loops is not installed, linking to the claude-loops plugin installer. |

### tickets

Jira integration — shows your assigned tickets grouped by parent story. Auto-detected at startup via mcpproxy: if a healthy Jira MCP server is found, tickets are enabled with no configuration needed.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tickets.enabled` | boolean or null | `null` (auto) | Set `false` to explicitly disable. When null or omitted, auto-detects via mcpproxy. Set `true` with manual overrides to skip auto-detection. |
| `tickets.jql` | string or null | `null` | JQL query override. When null, uses `assignee = currentUser() AND status != Done ORDER BY status ASC`. |
| `tickets.cloudId` | string or null | `null` (auto) | Atlassian Cloud ID. Auto-detected from mcpproxy. Only set for manual override. |
| `tickets.jiraSite` | string or null | `null` (auto) | Jira site URL. Auto-detected from mcpproxy. Only set for manual override. |
| `tickets.mcpTool` | string or null | `null` (auto) | mcpproxy tool name for Jira search. Auto-detected from mcpproxy. Only set for manual override. |

### pulls

GitHub PR monitoring — shows your open PRs and incoming review requests.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pulls.enabled` | boolean | `true` | Show the Pull Requests tab. Requires the `gh` CLI, authenticated. |
| `pulls.orgFilter` | string[] or null | `null` (all orgs) | Limit PR search to specific GitHub organizations. Example: `["MyCompany"]`. When null, searches all orgs you have access to. |

## Auto-Detection

When a field is set to `null`, the server resolves it at startup and logs the result:

```
Config: cmux binary = /Applications/cmux.app/Contents/Resources/bin/cmux
Config: cmux socket = /Users/you/Library/Application Support/cmux/cmux.sock
Config: loops enabled (/Users/you/.claude/plugins/data/claude-loops-my-plugin)
Config: pulls enabled
Config: tickets enabled (auto-detected — https://yourcompany.atlassian.net)
```

Ticket auto-detection runs `mcpproxy upstream list --json` to find a healthy Jira MCP server, then calls `getAccessibleResources` to resolve the Atlassian Cloud ID and site URL. If mcpproxy isn't available or no Jira server is found, tickets are silently disabled.

If auto-detection fails for a required field (e.g., cmux not found), the server exits with a clear message telling you which config field to set.
