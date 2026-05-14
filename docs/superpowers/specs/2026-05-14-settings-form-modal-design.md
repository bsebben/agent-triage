# Settings Form Modal

**Date:** 2026-05-14
**Status:** Draft

## Context

The dashboard's settings panel currently displays config as read-only JSON. The only editable field is `maxSessions`, which has a dedicated toggle/input and API endpoint. All other config changes require manually editing `config.json` — or the "Edit" button launches a Claude Code session to assist.

This spec adds a schema-driven modal form that lets users edit all config fields directly in the dashboard UI.

## Design Decisions

- **Schema-driven form**: The server derives the full config schema from `DEFAULTS` + tab module `defaults` exports. The frontend renders the form dynamically from this schema. Adding a new tab or config field automatically appears in the form with no frontend changes.
- **Full replacement writes**: `POST /api/config` writes the entire config object to `config.json`. Safe because this is a single-user local app with no concurrent writers.
- **Null = use default/auto-detect**: Fields left empty in the form are written as `null`. The server's `resolve()` function fills in defaults and auto-detected values at startup, same as today.
- **Placeholder display for null fields**: When a field's raw value is `null`, the form shows the resolved (runtime) value as grayed-out placeholder text. The input itself is empty, communicating "this will be auto-detected."
- **Auto-restart on save**: Every save writes config.json and triggers a server restart. No hot-reload machinery, no distinguishing restart-required vs hot-reloadable fields. The server restarts in under a second, WebSocket clients auto-reconnect, and the queue persists to disk.
- **Toast notification on reconnect**: After save, a sessionStorage flag is set. On WebSocket reconnect, the frontend checks the flag and shows a "Configuration updated" toast. This confirms to the user that the restart completed and their changes are live.
- **Side panel + modal coexistence**: The settings side panel remains for viewing config, tab status, and logs. The existing "Edit" button is rewired to open the modal instead of launching Claude Code.

## Schema System

### Schema shape

Each config field gets a schema entry:

```json
{
  "port":                  { "type": "number",  "default": 7777, "group": "server",       "description": "Dashboard port" },
  "maxSessions":           { "type": "number",  "default": null, "group": "server",       "description": "Max concurrent workspaces (null = unlimited)", "nullable": true },
  "defaultDirectory":      { "type": "string",  "default": null, "group": "server",       "description": "Default working directory (null = home)", "nullable": true },
  "cmux.binary":           { "type": "string",  "default": null, "group": "cmux",         "description": "cmux binary path (null = auto-detect)", "nullable": true },
  "cmux.socket":           { "type": "string",  "default": null, "group": "cmux",         "description": "cmux socket path (null = auto-detect)", "nullable": true },
  "tabs.loops.enabled":    { "type": "boolean", "default": true, "group": "tabs.loops",   "description": "Enable Loops tab" },
  "tabs.pulls.enabled":    { "type": "boolean", "default": true, "group": "tabs.pulls",   "description": "Enable PRs tab" },
  "tabs.tickets.enabled":  { "type": "boolean", "default": true, "group": "tabs.tickets", "description": "Enable Tickets tab" }
}
```

Additional tab-specific fields (e.g., Jira JQL, poll intervals) are included automatically from each tab's `defaults` export.

### Schema derivation

A new `buildSchema()` function in `src/config.js`:

1. Walks `DEFAULTS` to generate top-level and `cmux.*` entries
2. Accepts tab defaults from `server.js` (where tabs are registered) to generate `tabs.*` entries
3. Infers `type` from the default value using `typeof` when the default is non-null
4. For nullable fields (default is `null`), type must be specified explicitly in `FIELD_META`

`FIELD_META` is a map of dotted field paths to `{ type, description, nullable }`, co-located with `DEFAULTS`. Non-nullable fields with non-null defaults only need `description` (type is inferred). Nullable fields need all three. Example:

```js
const FIELD_META = {
  port:             { description: "Dashboard port" },
  maxSessions:      { type: "number", nullable: true, description: "Max concurrent workspaces (null = unlimited)" },
  defaultDirectory: { type: "string", nullable: true, description: "Default working directory (null = home)" },
  "cmux.binary":    { type: "string", nullable: true, description: "cmux binary path (null = auto-detect)" },
  "cmux.socket":    { type: "string", nullable: true, description: "cmux socket path (null = auto-detect)" },
};
```

Tab fields follow the same pattern — tab modules can optionally export a `fieldMeta` alongside `defaults`.

### API endpoint

`GET /api/config/schema` returns:

```json
{
  "schema": { ... },
  "raw": { "port": 7777, "maxSessions": 8, ... },
  "resolved": { "port": 7777, "cmux": { "binary": "/Applications/cmux.app/..." }, ... }
}
```

- `schema` — field definitions for rendering the form
- `raw` — current config.json values (what the form edits)
- `resolved` — runtime values after defaults/auto-detection (for placeholders)

## Modal UI

### Layout

```
┌─────────────────────────────────────┐
│  Edit Configuration            [×]  │
├─────────────────────────────────────┤
│  Server                             │
│  ┌─────────────────────────────┐    │
│  │ Port          [      7777 ] │    │
│  │ Max Sessions  [         8 ] │    │
│  │ Default Dir   [ ~/worksp.. ] │   │
│  └─────────────────────────────┘    │
│                                     │
│  cmux                               │
│  ┌─────────────────────────────┐    │
│  │ Binary        [ /Applicat.] │    │
│  │ Socket        [ ~/Library.] │    │
│  └─────────────────────────────┘    │
│                                     │
│  Loops                              │
│  ┌─────────────────────────────┐    │
│  │ Enabled       [✓]           │    │
│  └─────────────────────────────┘    │
│                                     │
│  PRs                                │
│  ┌─────────────────────────────┐    │
│  │ Enabled       [✓]           │    │
│  └─────────────────────────────┘    │
│                                     │
│  Tickets                            │
│  ┌─────────────────────────────┐    │
│  │ Enabled       [✓]           │    │
│  └─────────────────────────────┘    │
│                                     │
│         [Cancel]  [Save]            │
└─────────────────────────────────────┘
```

### Rendering rules

- `number` → `<input type="number">`
- `string` → `<input type="text">`
- `boolean` → `<input type="checkbox">`
- Nullable fields: input is empty when raw value is null, placeholder shows the resolved value
- Groups render as labeled sections, derived from the `group` field (dot-separated: `tabs.loops` → "Loops")
- Section headers use the last segment of the group, title-cased: `server` → "Server", `cmux` → "cmux", `tabs.loops` → "Loops", `tabs.pulls` → "Pulls", `tabs.tickets` → "Tickets"

### Interactions

- **Cancel**: Close modal, discard all changes. Uses existing `openOverlay()` escape/backdrop behavior.
- **Save**: POST full config object → server writes config.json → server restarts → WebSocket reconnects → toast appears.
- **Overlay**: Reuses `openOverlay()` from `overlay.js` and `.modal-panel` pattern from `changelog-modal.js`.

## Save Flow

1. User clicks Save
2. Frontend collects form values, converting empty nullable fields to `null`
3. Frontend sets `sessionStorage.setItem("configSaved", "1")`
4. Frontend POSTs to `/api/config` with the full config object
5. Server validates types against schema
6. Server writes config.json via `writeConfigFile()`
7. Server calls the existing restart mechanism (`POST /api/restart` logic internally)
8. Server process restarts, WebSocket drops
9. Frontend auto-reconnects WebSocket
10. On reconnect, frontend checks sessionStorage flag → shows toast "Configuration updated" → clears flag

## Toast System

A lightweight toast component (no library). A fixed-position container at the bottom-center of the viewport. Toasts fade in, display for 3 seconds, fade out. Single CSS class + a `showToast(message)` function.

Used initially for the config save confirmation, but available for future use (e.g., "Workspace closed", "PR updated").

## Server Changes

### New endpoints

**`GET /api/config/schema`**
- Returns `{ schema, raw, resolved }` as described above
- `raw` is re-read from config.json at request time (not cached) so it reflects the file's current state

**`POST /api/config`**
- Accepts JSON body: the full config object
- Validates field types against schema (returns 400 on mismatch)
- Writes to config.json via `writeConfigFile()`
- Triggers server restart
- Returns `{ ok: true }` (client may not receive this if restart is fast)

### Config module changes

New exports from `src/config.js`:
- `buildSchema(tabDefaults)` — derives schema from DEFAULTS + tab defaults
- `writeConfigFile(configObj)` — writes full config.json (replaces `updateConfigFile` which only does single keys)
- `FIELD_META` — map of field paths to description strings
- `loadRawConfig()` — reads config.json without resolving (for the schema endpoint)

The existing `updateConfigFile(key, value)` and the `POST /api/config/max-sessions` endpoint can be removed once the modal is in place, since the new `POST /api/config` supersedes them.

## Files

| File | Change | Est. lines |
|------|--------|------------|
| `src/config.js` | Add `buildSchema()`, `FIELD_META`, `writeConfigFile()`, `loadRawConfig()` | +60 |
| `src/server.js` | Add `GET /api/config/schema`, `POST /api/config` endpoints; pass tab defaults to schema builder | +40 |
| `public/config-modal.js` (new) | Dynamic form renderer from schema, save/cancel logic | ~200 |
| `public/toast.js` (new) | `showToast(message)` function + auto-fade | ~30 |
| `public/settings-panel.js` | Rewire `editSettings()` to open config modal instead of launching Claude Code | ~5 |
| `public/style.css` | Modal form styles (inputs, labels, groups, placeholders) + toast styles | +80 |
| `public/index.html` | Add `<script>` tags for config-modal.js and toast.js | +2 |
| `test/config.test.js` | Tests for `buildSchema()`, `writeConfigFile()`, schema type validation | +60 |

**Estimated total: ~480 new/changed lines across 8 files.**

## Testing

- `buildSchema()` returns correct types, defaults, and groups for all fields
- `buildSchema()` includes tab-specific fields from tab module defaults
- `writeConfigFile()` writes valid JSON and preserves structure
- `POST /api/config` validates types and rejects mismatches
- `POST /api/config` writes to disk and triggers restart
- Frontend: form renders all schema fields grouped correctly
- Frontend: nullable fields show placeholder, save as null when empty
- Frontend: toast appears on WebSocket reconnect after save
