# Configuration Reference

Agent Triage is configured via a `config.json` file in the project root. Copy the example to get started:

```bash
cp config.example.json config.json
```

## Defaults

Most fields have sensible defaults. A minimal config only needs cmux paths (auto-detected on macOS):

```json
{
  "port": 7777,
  "defaultDirectory": null,
  "cmux": { "binary": null, "socket": null },
  "tabs": {
    "loops": { "enabled": true },
    "tickets": { "enabled": true },
    "pulls": { "enabled": true }
  }
}
```

Fields set to `null` are auto-detected at startup. The server logs what it found so you can verify.

## Max Sessions

The `maxSessions` field sets a hard cap on the number of concurrent workspaces. When set to `null` (default), there is no limit. Set it to a positive integer to enforce a maximum:

```json
{
  "maxSessions": 6
}
```

When the limit is reached:
- "New Session" and "New Terminal" buttons are disabled in the UI
- The server returns `429 Too Many Requests` on workspace creation endpoints
- A toast notification appears at the top of the Workspaces tab

The count is based on unique active (non-dismissed) workspaces.

## Default Directory

The `defaultDirectory` field controls where the "New Session" and "New Terminal" toolbar buttons open. When set to `null` (default), new workspaces open in your home directory. Set it to an absolute path to always start in a specific location:

```json
{
  "defaultDirectory": "/Users/you/workspace"
}
```

Per-group buttons (inside workspace groups) still open in that group's directory regardless of this setting.

## Tabs

All tabs live under the `tabs` key and are enabled by default. Each tab auto-detects its dependencies at startup. If a dependency is missing, the tab stays visible with a helpful message. Set `enabled: false` to hide a tab entirely.

| Tab | Dependency | What happens when missing |
|-----|-----------|--------------------------|
| Loops | claude-loops plugin | Shows install link |
| Pulls | `gh` CLI | Shows install instructions |
| Tickets | mcpproxy or Runlayer Jira MCP | Shows setup hint |

Each tab module defines its own defaults. See the `defaults` export in each `src/tabs/*.js` file for available options.

### Tickets Tab

The tickets tab is optional. Without a Jira connection it shows a setup hint and the rest of the dashboard works normally.

Two transports are supported, tried in order:

1. **mcpproxy** (auto-detected) — No config needed. If `mcpproxy` is installed with a healthy Jira upstream, it is used automatically.

2. **Runlayer** (auto-detected URL, key required) — Connects directly to a Runlayer-hosted Jira MCP server. The server URL is auto-detected from your Claude Code MCP config (`~/.claude.json`). You only need to supply a **user API key**.

#### Runlayer setup (if not using mcpproxy)

**Step 1** — Add the Jira MCP server to Claude Code (if you haven't already):

```bash
claude mcp add --transport http --scope user jiraconfluencegusto \
  https://<your-org>.runlayer.com/api/v1/proxy/<jira-server-uuid>/mcp
```

**Step 2** — Add your Runlayer user API key to `config.json`:

```json
{
  "runlayerUserApiKey": "rl_..."
}
```

Or set it as an environment variable instead:

```bash
export RUNLAYER_USER_KEY="rl_..."
```

> **Note:** Use a *user* API key, not an org key (`rl_org_...`). Org keys are not supported for individual user context.

If you need to override the auto-detected URL (e.g. you have multiple Runlayer Jira servers), set it explicitly:

```json
{
  "tabs": {
    "tickets": {
      "runlayerUrl": "https://<your-org>.runlayer.com/api/v1/proxy/<uuid>/mcp"
    }
  }
}
```

If auto-detection fails for cmux (required for the dashboard itself), the server exits with a clear message telling you which config field to set.
