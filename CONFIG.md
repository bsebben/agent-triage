# Configuration Reference

Agent Triage is configured via a `config.json` file in the project root. Copy the example to get started:

```bash
cp config.example.json config.json
```

Add `"$schema": "./config.schema.json"` to your config for autocomplete and validation in VS Code.

## Defaults

Most fields have sensible defaults. A minimal config only needs cmux paths (auto-detected on macOS):

```json
{
  "$schema": "./config.schema.json",
  "port": 7777,
  "cmux": { "binary": null, "socket": null },
  "tabs": {
    "loops": { "enabled": true },
    "tickets": { "enabled": true },
    "pulls": { "enabled": true }
  }
}
```

Fields set to `null` are auto-detected at startup. The server logs what it found so you can verify.

## Tabs

All tabs live under the `tabs` key and are enabled by default. Each tab auto-detects its dependencies at startup. If a dependency is missing, the tab stays visible with a helpful message. Set `enabled: false` to hide a tab entirely.

| Tab | Dependency | What happens when missing |
|-----|-----------|--------------------------|
| Loops | claude-loops plugin | Shows install link |
| Pulls | `gh` CLI | Shows install instructions |
| Tickets | Jira MCP server | Shows setup hint |

## Schema

See [`config.schema.json`](config.schema.json) for the full field reference with types, defaults, and descriptions.

If auto-detection fails for cmux (required for the dashboard itself), the server exits with a clear message telling you which config field to set.
