# Plugin Config Editor — Design Spec

**Date:** 2026-05-20
**Approach:** Server-side discovery + REST API (Approach A)

## Summary

Add a "Plugin Configs" section to the Settings panel that auto-discovers Claude Code plugins with `config.json` files and lets the user view/edit them via a raw JSON editor. The server handles discovery and file I/O; the frontend renders a collapsible editor per plugin.

## Discovery Logic

The server scans the Claude Code plugin ecosystem at startup and on-demand (`/api/plugins` refresh):

1. Read `~/.claude/plugins/installed_plugins.json` to get the list of installed plugins and their install paths.
2. For each plugin, check whether a `config.json` exists in the install path (bundled defaults).
3. Check `~/.claude/plugins/data/{name}-{marketplace}/config.json` for a user override.
4. Also check `~/.claude/plugins/data/{name}/config.json` (local plugins without marketplace suffix).
5. If a plugin has a `CONFIG.md` in its install path, note it as documentation-available.

A plugin is "configurable" if it has a `config.json` in either location. The server returns both the bundled defaults and the user override (if any).

## Server API

### `GET /api/plugins`

Returns the list of discovered configurable plugins:

```json
[
  {
    "id": "breather@usp-shared",
    "name": "breather",
    "marketplace": "usp-shared",
    "version": "0.9.0",
    "hasOverride": true,
    "hasConfigDoc": true,
    "configPath": "~/.claude/plugins/data/breather/config.json",
    "bundledPath": "~/.claude/plugins/cache/usp-shared/breather/0.9.0/config.json"
  }
]
```

### `GET /api/plugins/:id/config`

Returns the config for a specific plugin. `:id` is the `name@marketplace` identifier (URL-encoded).

```json
{
  "bundled": { "session_warn_threshold": 3, ... },
  "override": { "session_warn_threshold": 10, ... },
  "resolved": { "session_warn_threshold": 10, ... },
  "configDocUrl": null
}
```

- `bundled`: The plugin's default config.json (read-only reference).
- `override`: The user's override in the data directory (null if no override exists).
- `resolved`: If an override exists, it IS the resolved config (plugins treat overrides as full replacements, not partial patches). If no override exists, bundled is the resolved config.

### `POST /api/plugins/:id/config`

Writes the user's override config. Body is the full JSON object to write to the data directory. Creates the data directory if needed.

```json
{ "session_warn_threshold": 10, "nudge_cooldown": 3 }
```

Returns `{ "ok": true }`.

### `DELETE /api/plugins/:id/config`

Removes the user override, reverting to bundled defaults. Deletes the override file from the data directory.

Returns `{ "ok": true }`.

## Frontend — Settings Panel Integration

### Layout

A new "Plugin Configs" section appears in the settings panel between the Server section and Server Logs. It contains:

1. A section header: "Plugin Configs" with a refresh button.
2. For each discovered plugin, a collapsible row showing:
   - Plugin name, version, and marketplace badge.
   - "Modified" indicator if a user override exists.
   - Expand/collapse toggle.
3. When expanded, shows:
   - A `<textarea>` with the resolved config JSON (pretty-printed).
   - "Save" button — POSTs the textarea content to the server.
   - "Reset to Defaults" button — DELETEs the override.
   - Validation: parse the JSON before saving, show inline error if invalid.

### Empty State

If no configurable plugins are found, show: "No configurable plugins found. Plugins with a config.json will appear here automatically."

### Styling

Reuse existing settings panel CSS patterns (`.settings-section`, `.settings-section-header`). The JSON textarea uses monospace font, similar to the server logs area. Collapsible rows use a chevron indicator.

## File Write Safety

- The server only writes to `~/.claude/plugins/data/{name}/config.json` or `~/.claude/plugins/data/{name}-{marketplace}/config.json`.
- The server validates that the body is parseable JSON before writing.
- The server creates the data directory if it doesn't exist (`mkdir -p` equivalent).
- No writes to the bundled plugin directory (install path is read-only).

## Server Module

Create `src/plugins.js` (not a tab module — this is a settings-panel feature, not a tab):

- `discover()` — scans installed_plugins.json + filesystem, returns plugin list.
- `getConfig(id)` — returns bundled + override + resolved for a plugin.
- `writeConfig(id, configObj)` — writes override to data dir.
- `deleteConfig(id)` — removes override file.

Cache the discovery result at startup; refresh on `GET /api/plugins` with a `?refresh=1` query param or when the settings panel opens.

## Frontend Module

Create `public/plugins-settings.js`:

- `renderPluginsSection()` — returns HTML for the settings panel section.
- `togglePluginExpand(id)` — expand/collapse a plugin's editor.
- `savePluginConfig(id)` — validate JSON, POST to server.
- `resetPluginConfig(id)` — confirm, then DELETE override.
- `refreshPlugins()` — re-fetch plugin list from server.

Loaded in `index.html` alongside `settings-panel.js` and `config-modal.js`.

## Scope Boundaries

**In scope:**
- Auto-discovery of plugins with config.json
- Raw JSON editor in settings panel
- Read/write user overrides in data directory
- Reset to defaults
- JSON validation before save

**Out of scope (future):**
- Schema-driven form fields (like the existing config modal) — planned follow-up
- CONFIG.md rendering in the UI
- Live reload when config files change externally
- Plugin enable/disable toggles
- Editing `.local.md` frontmatter configs (personas, cheat-overlay)
- Editing `config.yml` files (claude-loops)
