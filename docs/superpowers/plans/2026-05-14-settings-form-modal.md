# Settings Form Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a schema-driven modal form for editing all config fields, with auto-restart on save and a toast confirmation.

**Architecture:** The server derives a config schema from `DEFAULTS` + tab module `defaults` exports and exposes it via `GET /api/config/schema`. A new modal renders the form dynamically from this schema. Save writes the full config.json and auto-restarts the server. A toast on WebSocket reconnect confirms the change.

**Tech Stack:** Vanilla JS frontend (no framework), Node.js HTTP server, existing `openOverlay()` modal pattern.

**Spec:** `docs/superpowers/specs/2026-05-14-settings-form-modal-design.md`

---

### Task 1: Schema Builder in config.js

**Files:**
- Modify: `src/config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Write tests for `buildSchema`**

Add to `test/config.test.js`:

```js
import { buildSchema, loadRawConfig, writeConfigFile, FIELD_META } from "../src/config.js";

describe("buildSchema", () => {
  it("includes top-level fields with correct types", () => {
    const schema = buildSchema({});
    assert.equal(schema.port.type, "number");
    assert.equal(schema.port.default, 7777);
    assert.equal(schema.port.group, "server");
    assert.equal(schema.port.nullable, undefined);
  });

  it("marks nullable fields explicitly", () => {
    const schema = buildSchema({});
    assert.equal(schema.maxSessions.nullable, true);
    assert.equal(schema.maxSessions.type, "number");
    assert.equal(schema.defaultDirectory.nullable, true);
    assert.equal(schema.defaultDirectory.type, "string");
  });

  it("includes cmux fields in cmux group", () => {
    const schema = buildSchema({});
    assert.equal(schema["cmux.binary"].group, "cmux");
    assert.equal(schema["cmux.binary"].nullable, true);
    assert.equal(schema["cmux.socket"].group, "cmux");
  });

  it("includes tab defaults with correct groups", () => {
    const tabDefaults = {
      loops: { enabled: true, dataDir: null },
      pulls: { enabled: true, orgFilter: null },
    };
    const schema = buildSchema(tabDefaults);
    assert.equal(schema["tabs.loops.enabled"].type, "boolean");
    assert.equal(schema["tabs.loops.enabled"].group, "tabs.loops");
    assert.equal(schema["tabs.loops.dataDir"].nullable, true);
    assert.equal(schema["tabs.pulls.orgFilter"].nullable, true);
  });

  it("every field has a description", () => {
    const schema = buildSchema({});
    for (const [key, entry] of Object.entries(schema)) {
      assert.ok(entry.description, `${key} missing description`);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `buildSchema` is not exported yet.

- [ ] **Step 3: Implement `FIELD_META` and `buildSchema`**

In `src/config.js`, add after the `DEFAULTS` declaration:

```js
export const FIELD_META = {
  port:             { description: "Dashboard port" },
  maxSessions:      { type: "number", nullable: true, description: "Max concurrent workspaces (null = unlimited)" },
  defaultDirectory: { type: "string", nullable: true, description: "Default working directory (null = home)" },
  "cmux.binary":    { type: "string", nullable: true, description: "cmux binary path (null = auto-detect)" },
  "cmux.socket":    { type: "string", nullable: true, description: "cmux socket path (null = auto-detect)" },
};

function inferType(value) {
  if (value === null || value === undefined) return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

export function buildSchema(tabDefaults) {
  const schema = {};

  // Top-level fields (skip cmux and tabs — handled separately)
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (key === "cmux" || key === "tabs") continue;
    const meta = FIELD_META[key] || {};
    schema[key] = {
      type: meta.type || inferType(value),
      default: value,
      group: "server",
      description: meta.description || key,
      ...(meta.nullable && { nullable: true }),
    };
  }

  // cmux fields
  for (const [key, value] of Object.entries(DEFAULTS.cmux)) {
    const path = `cmux.${key}`;
    const meta = FIELD_META[path] || {};
    schema[path] = {
      type: meta.type || inferType(value),
      default: value,
      group: "cmux",
      description: meta.description || key,
      ...(meta.nullable && { nullable: true }),
    };
  }

  // Tab fields
  for (const [tabName, defaults] of Object.entries(tabDefaults)) {
    for (const [key, value] of Object.entries(defaults)) {
      const path = `tabs.${tabName}.${key}`;
      const meta = FIELD_META[path] || {};
      const isNullDefault = value === null;
      schema[path] = {
        type: meta.type || (isNullDefault ? "string" : inferType(value)),
        default: value,
        group: `tabs.${tabName}`,
        description: meta.description || key,
        ...(( meta.nullable || isNullDefault) && { nullable: true }),
      };
    }
  }

  return schema;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: add buildSchema for config schema derivation"
```

---

### Task 2: Config Read/Write Helpers

**Files:**
- Modify: `src/config.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Write tests for `loadRawConfig` and `writeConfigFile`**

Add to `test/config.test.js`:

```js
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("loadRawConfig", () => {
  it("returns the raw config.json contents without resolving", () => {
    const raw = loadRawConfig();
    assert.equal(typeof raw, "object");
    assert.ok("port" in raw || "maxSessions" in raw || "tabs" in raw);
  });
});

describe("writeConfigFile", () => {
  let tmpDir;
  let origPath;

  // writeConfigFile writes to PROJECT_ROOT/config.json which we can't
  // easily redirect, so we test the serialization logic by round-tripping
  // through loadRawConfig after a write.
  it("round-trips config through write and read", () => {
    const before = loadRawConfig();
    const testValue = before.maxSessions === 99 ? 100 : 99;
    writeConfigFile({ ...before, maxSessions: testValue });
    const after = loadRawConfig();
    assert.equal(after.maxSessions, testValue);
    // Restore original
    writeConfigFile(before);
  });

  it("preserves JSON formatting with 2-space indent", () => {
    const raw = loadRawConfig();
    writeConfigFile(raw);
    const content = readFileSync(join(process.cwd(), "config.json"), "utf-8");
    assert.ok(content.includes("\n  "), "should have 2-space indentation");
    assert.ok(content.endsWith("\n"), "should end with newline");
    writeConfigFile(raw);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `loadRawConfig` and `writeConfigFile` not exported.

- [ ] **Step 3: Implement `loadRawConfig` and `writeConfigFile`**

In `src/config.js`, add/modify:

```js
export function loadRawConfig() {
  const configPath = join(PROJECT_ROOT, "config.json");
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

export function writeConfigFile(configObj) {
  const configPath = join(PROJECT_ROOT, "config.json");
  writeFileSync(configPath, JSON.stringify(configObj, null, 2) + "\n");
}
```

Update the existing `loadConfigFile` to use `loadRawConfig`:

```js
function loadConfigFile() {
  const configPath = join(PROJECT_ROOT, "config.json");
  if (!existsSync(configPath)) {
    console.error("Missing config.json — copy config.example.json to config.json and edit it.");
    console.error("  cp config.example.json config.json");
    process.exit(1);
  }
  return loadRawConfig();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: add loadRawConfig and writeConfigFile helpers"
```

---

### Task 3: Server API Endpoints

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add the schema endpoint**

In `src/server.js`, update the import from config.js:

```js
import config, { HOME, updateConfigFile, buildSchema, loadRawConfig, writeConfigFile } from "./config.js";
```

Import tab defaults:

```js
import { defaults as loopsDefaults } from "./tabs/loops.js";
import { defaults as pullsDefaults } from "./tabs/pulls.js";
import { defaults as ticketsDefaults } from "./tabs/tickets.js";
```

Build the schema once at startup, after the tab imports:

```js
const tabDefaults = { loops: loopsDefaults, pulls: pullsDefaults, tickets: ticketsDefaults };
const configSchema = buildSchema(tabDefaults);
```

Add the `GET /api/config/schema` endpoint after the existing `GET /api/config`:

```js
    if (req.url === "/api/config/schema" && req.method === "GET") {
      return jsonResponse(res, {
        schema: configSchema,
        raw: loadRawConfig(),
        resolved: config,
      });
    }
```

- [ ] **Step 2: Add the POST /api/config endpoint**

Add after the schema endpoint:

```js
    if (req.url === "/api/config" && req.method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        return jsonResponse(res, { error: "Invalid config object" }, 400);
      }
      writeConfigFile(body);
      jsonResponse(res, { ok: true });
      setTimeout(() => {
        const now = new Date();
        utimesSync(join(__dirname, "server.js"), now, now);
      }, 100);
      return;
    }
```

- [ ] **Step 3: Verify server starts and endpoints work**

Run: `npm start &`
Then:
```bash
curl -s http://localhost:7777/api/config/schema | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); console.log('schema keys:', Object.keys(j.schema).length); console.log('has raw:', !!j.raw); console.log('has resolved:', !!j.resolved)"
```
Expected: `schema keys: <number>`, `has raw: true`, `has resolved: true`

Kill the test server.

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "feat: add config schema and write API endpoints"
```

---

### Task 4: Toast Component

**Files:**
- Create: `public/toast.js`
- Modify: `public/style.css`
- Modify: `public/index.html`

- [ ] **Step 1: Create `public/toast.js`**

```js
// public/toast.js — Lightweight toast notifications

function showToast(message, durationMs = 3000) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, durationMs);
}
```

- [ ] **Step 2: Add toast styles to `public/style.css`**

Append to the end of `style.css`:

```css
/* Toast notifications */
#toast-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.toast {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.3s, transform 0.3s;
  pointer-events: auto;
}

.toast.show {
  opacity: 1;
  transform: translateY(0);
}
```

- [ ] **Step 3: Add script tag to `public/index.html`**

Add before the `settings-panel.js` script tag:

```html
  <script src="toast.js"></script>
```

- [ ] **Step 4: Commit**

```bash
git add public/toast.js public/style.css public/index.html
git commit -m "feat: add lightweight toast notification component"
```

---

### Task 5: Config Form Modal

**Files:**
- Create: `public/config-modal.js`
- Modify: `public/style.css`
- Modify: `public/index.html`

- [ ] **Step 1: Create `public/config-modal.js`**

```js
// public/config-modal.js — Schema-driven config editing modal

let closeConfigModal = null;

function groupLabel(group) {
  if (group === "server") return "Server";
  if (group === "cmux") return "cmux";
  if (group.startsWith("tabs.")) {
    const name = group.split(".").pop();
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return group;
}

function renderField(key, entry, rawValue, resolvedValue) {
  const id = `config-field-${key.replace(/\./g, "-")}`;
  const displayName = key.split(".").pop();
  const label = displayName.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());

  if (entry.type === "boolean") {
    const checked = rawValue !== null && rawValue !== undefined ? rawValue : entry.default;
    return `
      <div class="config-field">
        <label class="config-field-label" for="${id}">${escapeHtml(label)}</label>
        <input type="checkbox" id="${id}" data-key="${key}" data-type="boolean"
          ${checked ? "checked" : ""}>
        <span class="config-field-desc">${escapeHtml(entry.description)}</span>
      </div>`;
  }

  const inputType = entry.type === "number" ? "number" : "text";
  const value = rawValue !== null && rawValue !== undefined ? rawValue : "";
  const placeholder = resolvedValue !== null && resolvedValue !== undefined ? String(resolvedValue) : entry.default !== null ? String(entry.default) : "";

  return `
    <div class="config-field">
      <label class="config-field-label" for="${id}">${escapeHtml(label)}</label>
      <input type="${inputType}" id="${id}" data-key="${key}" data-type="${entry.type}"
        data-nullable="${!!entry.nullable}"
        value="${escapeHtml(String(value))}"
        placeholder="${escapeHtml(String(placeholder))}">
      <span class="config-field-desc">${escapeHtml(entry.description)}</span>
    </div>`;
}

function getNestedValue(obj, dottedKey) {
  return dottedKey.split(".").reduce((o, k) => o?.[k], obj);
}

function setNestedValue(obj, dottedKey, value) {
  const parts = dottedKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in cur)) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function collectFormValues(schema) {
  const config = {};
  for (const [key, entry] of Object.entries(schema)) {
    const el = document.querySelector(`[data-key="${key}"]`);
    if (!el) continue;

    if (entry.type === "boolean") {
      setNestedValue(config, key, el.checked);
      continue;
    }

    const raw = el.value.trim();
    if (raw === "" && entry.nullable) {
      setNestedValue(config, key, null);
    } else if (entry.type === "number") {
      const num = Number(raw);
      setNestedValue(config, key, raw === "" ? entry.default : num);
    } else {
      setNestedValue(config, key, raw || entry.default);
    }
  }
  return config;
}

async function openConfigModal() {
  if (closeConfigModal) return;

  const panel = document.createElement("div");
  panel.className = "modal-panel config-modal";
  panel.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Edit Configuration</span>
      <button class="modal-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">Loading…</div>
    <div class="modal-footer">
      <button class="btn" type="button" id="config-cancel">Cancel</button>
      <button class="btn primary" type="button" id="config-save">Save</button>
    </div>
  `;

  panel.querySelector(".modal-close").addEventListener("click", () => closeConfigModal?.());

  closeConfigModal = openOverlay(panel, {
    onClose: () => { panel.remove(); closeConfigModal = null; },
  });

  const body = panel.querySelector(".modal-body");

  try {
    const res = await fetch("/api/config/schema");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const { schema, raw, resolved } = await res.json();

    // Group fields by their group
    const groups = new Map();
    for (const [key, entry] of Object.entries(schema)) {
      if (!groups.has(entry.group)) groups.set(entry.group, []);
      groups.get(entry.group).push({ key, entry });
    }

    let html = "";
    for (const [group, fields] of groups) {
      html += `<div class="config-group">`;
      html += `<h3 class="config-group-title">${escapeHtml(groupLabel(group))}</h3>`;
      for (const { key, entry } of fields) {
        const rawValue = getNestedValue(raw, key);
        const resolvedValue = getNestedValue(resolved, key);
        html += renderField(key, entry, rawValue, resolvedValue);
      }
      html += `</div>`;
    }
    body.innerHTML = html;
  } catch {
    body.textContent = "Could not load config schema";
    return;
  }

  panel.querySelector("#config-cancel").addEventListener("click", () => closeConfigModal?.());
  panel.querySelector("#config-save").addEventListener("click", async () => {
    const res = await fetch("/api/config/schema");
    const { schema } = await res.json();
    const configObj = collectFormValues(schema);

    sessionStorage.setItem("configSaved", "1");
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configObj),
      });
    } catch {}
    closeConfigModal?.();
  });
}
```

- [ ] **Step 2: Add modal form styles to `public/style.css`**

Append to `style.css`:

```css
/* Config modal form */
.config-modal { max-width: 520px; }

.config-modal .modal-body {
  max-height: 60vh;
  overflow-y: auto;
  padding: 16px 20px;
}

.config-modal .modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border);
}

.config-group { margin-bottom: 16px; }

.config-group-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-dim);
  margin: 0 0 8px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.config-field {
  display: grid;
  grid-template-columns: 120px 1fr;
  grid-template-rows: auto auto;
  gap: 2px 12px;
  align-items: center;
  margin-bottom: 8px;
}

.config-field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  grid-row: 1;
  grid-column: 1;
}

.config-field input[type="text"],
.config-field input[type="number"] {
  grid-row: 1;
  grid-column: 2;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text);
  font-size: 13px;
  padding: 4px 8px;
  width: 100%;
  box-sizing: border-box;
}

.config-field input[type="text"]:focus,
.config-field input[type="number"]:focus {
  border-color: var(--text-dim);
  outline: none;
}

.config-field input[type="text"]::placeholder,
.config-field input[type="number"]::placeholder {
  color: var(--text-dim);
  opacity: 0.5;
}

.config-field input[type="checkbox"] {
  grid-row: 1;
  grid-column: 2;
  justify-self: start;
}

.config-field-desc {
  grid-row: 2;
  grid-column: 2;
  font-size: 11px;
  color: var(--text-dim);
  opacity: 0.7;
}
```

- [ ] **Step 3: Add script tag to `public/index.html`**

Add before the `settings-panel.js` script tag:

```html
  <script src="config-modal.js"></script>
```

- [ ] **Step 4: Commit**

```bash
git add public/config-modal.js public/style.css public/index.html
git commit -m "feat: add schema-driven config editing modal"
```

---

### Task 6: Wire Edit Button and Toast on Reconnect

**Files:**
- Modify: `public/settings-panel.js`
- Modify: `public/app.js`

- [ ] **Step 1: Rewire the Edit button in settings-panel.js**

Replace the `editSettings()` function in `public/settings-panel.js`:

```js
async function editSettings() {
  if (closeSettings) closeSettings();
  openConfigModal();
}
```

This replaces the old implementation that launched a Claude Code session.

- [ ] **Step 2: Add toast on WebSocket reconnect in app.js**

In `public/app.js`, in the `ws.onopen` callback (currently line 42), add the toast check:

```js
  ws.onopen = () => {
    loadAppConfig();
    if (sessionStorage.getItem("configSaved")) {
      sessionStorage.removeItem("configSaved");
      showToast("Configuration updated");
    }
  };
```

- [ ] **Step 3: Test the full flow manually**

1. Start the server: `npm start`
2. Open `http://localhost:7777` in a browser
3. Click the gear icon to open settings panel
4. Click "Edit" — the config modal should open
5. Change `maxSessions` to a different value
6. Click Save — the modal closes, server restarts, toast appears
7. Open settings panel again — "Resolved Config" JSON should show the new value
8. Click "Edit" again — the form should show the current value

- [ ] **Step 4: Commit**

```bash
git add public/settings-panel.js public/app.js
git commit -m "feat: wire edit button to config modal with save toast"
```

---

### Task 7: Clean Up Legacy Max Sessions Endpoint

**Files:**
- Modify: `src/server.js`
- Modify: `src/config.js`
- Modify: `public/settings-panel.js`
- Modify: `public/style.css`

- [ ] **Step 1: Remove the dedicated max sessions UI from settings panel**

In `public/settings-panel.js`, remove the entire "Max Sessions" section from the `renderSettings()` HTML template (the `<div class="settings-section">` containing `<h3>Max Sessions</h3>` and the toggle/input). Also remove the `toggleMaxSessions()` and `saveMaxSessions()` functions.

- [ ] **Step 2: Remove the `POST /api/config/max-sessions` endpoint from server.js**

Delete the block at lines 286-295 in `src/server.js` (the `if (req.url === "/api/config/max-sessions"` block).

- [ ] **Step 3: Remove `updateConfigFile` from config.js**

Delete the `updateConfigFile` function and update the export line:

```js
export { HOME, PROJECT_ROOT };
```

Update the import in `server.js`:

```js
import config, { HOME, buildSchema, loadRawConfig, writeConfigFile } from "./config.js";
```

- [ ] **Step 4: Remove max-sessions CSS**

Delete the `.settings-max-sessions`, `.settings-max-sessions-input`, and `.settings-toggle-row` CSS blocks from `style.css`.

- [ ] **Step 5: Run tests to verify nothing broke**

Run: `npm test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server.js src/config.js public/settings-panel.js public/style.css
git commit -m "refactor: remove dedicated max-sessions endpoint, superseded by config modal"
```

---

### Task 8: Version Bump and Changelog

**Files:**
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump minor version in package.json**

This is a new feature, so bump minor: `1.17.1` → `1.18.0` (check current version first with `node -p "require('./package.json').version"`).

- [ ] **Step 2: Add changelog entry**

Add under a new `## [1.18.0] - 2026-05-14` heading in `CHANGELOG.md`:

```markdown
### Added
- Schema-driven config editing modal — click "Edit" in settings to modify all config fields in a form
- Toast notification system for confirming actions (config save, etc.)
- `GET /api/config/schema` endpoint exposing config schema, raw values, and resolved values
- `POST /api/config` endpoint for writing full config.json with auto-restart

### Removed
- Dedicated `POST /api/config/max-sessions` endpoint (superseded by `POST /api/config`)
- Max sessions toggle in settings panel (now part of the config modal form)
```

- [ ] **Step 3: Run version check**

Run: `npm run version-check`
Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump to 1.18.0, update changelog"
```

---

### Task 9: Final Integration Test

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Manual smoke test**

1. `npm start`
2. Open dashboard, verify settings panel still shows resolved config and logs
3. Click "Edit" — modal opens with all fields grouped by section
4. Verify nullable fields show resolved values as placeholders
5. Change a value, click Save — toast confirms, settings panel shows new value
6. Change value back, Save again — confirm round-trip works
7. Click Cancel without saving — verify no changes written
8. Press Escape to close modal — verify no changes written

- [ ] **Step 3: Verify tab field descriptions populate for all tab defaults**

Check `GET /api/config/schema` returns entries for loops (`dataDir`, `installUrl`), pulls (`orgFilter`), and tickets fields.

```bash
curl -s http://localhost:7777/api/config/schema | node -p "Object.keys(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).schema).filter(k => k.startsWith('tabs.')).join('\n')"
```

Expected: Lists tab-specific fields for all three tab modules.
