// public/plugins-settings.js — Plugin config editor for settings panel

let pluginsData = [];
let closePluginModal = null;

async function fetchPlugins(refresh) {
  try {
    const url = refresh ? "/api/plugins?refresh=1" : "/api/plugins";
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function fetchPluginConfig(id) {
  try {
    const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/config`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function inferFieldType(value) {
  if (value === null || value === undefined) return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

function flattenConfig(obj, prefix) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenConfig(value, path));
    } else {
      result[path] = value;
    }
  }
  return result;
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

function renderPluginField(key, value) {
  const id = `plugin-field-${key.replace(/\./g, "-")}`;
  const label = key.split(".").pop().replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
  const type = inferFieldType(value);

  if (type === "boolean") {
    return `
      <div class="config-field config-field-toggle">
        <label class="config-toggle" for="${id}">
          <input type="checkbox" id="${id}" data-key="${key}" data-type="boolean"
            ${value ? "checked" : ""}>
          <span class="config-toggle-track"></span>
          <span class="config-toggle-label">${escapeHtml(label)}</span>
        </label>
      </div>`;
  }

  if (Array.isArray(value)) {
    return `
      <div class="config-field">
        <label class="config-field-label" for="${id}">${escapeHtml(label)}</label>
        <input type="text" id="${id}" data-key="${key}" data-type="array"
          value="${escapeHtml(JSON.stringify(value))}"
          placeholder="JSON array">
        <span class="config-field-desc">JSON array — e.g. ["a", "b"]</span>
      </div>`;
  }

  const inputType = type === "number" ? "number" : "text";
  const displayValue = value !== null && value !== undefined ? String(value) : "";

  return `
    <div class="config-field">
      <label class="config-field-label" for="${id}">${escapeHtml(label)}</label>
      <input type="${inputType}" id="${id}" data-key="${key}" data-type="${type}"
        value="${escapeHtml(displayValue)}"
        placeholder="${escapeHtml(displayValue)}">
    </div>`;
}

function collectPluginFormValues(flatConfig) {
  const result = {};
  for (const [key, originalValue] of Object.entries(flatConfig)) {
    const el = document.querySelector(`[data-key="${key}"]`);
    if (!el) continue;

    const type = el.dataset.type;
    if (type === "boolean") {
      setNestedValue(result, key, el.checked);
    } else if (type === "array") {
      try {
        setNestedValue(result, key, JSON.parse(el.value));
      } catch {
        setNestedValue(result, key, originalValue);
      }
    } else if (type === "number") {
      const num = Number(el.value);
      setNestedValue(result, key, el.value === "" ? originalValue : num);
    } else {
      setNestedValue(result, key, el.value || originalValue);
    }
  }
  return result;
}

function renderPluginsSection() {
  if (pluginsData.length === 0) {
    return `
      <div class="settings-section">
        <div class="settings-section-header">
          <h3>Plugin Configs</h3>
          <button class="settings-edit-btn" onclick="refreshPlugins()">Refresh</button>
        </div>
        <div class="plugins-empty">No configurable plugins found. Plugins with a config.json will appear here automatically.</div>
      </div>`;
  }

  const rows = pluginsData.map((p) => {
    const badge = p.marketplace ? `<span class="plugin-marketplace">${escapeHtml(p.marketplace)}</span>` : "";
    const modified = p.hasOverride ? '<span class="plugin-modified">modified</span>' : "";
    const version = p.version ? `<span class="plugin-version">${escapeHtml(p.version)}</span>` : "";

    return `
      <div class="plugin-row">
        <div class="plugin-header">
          <span class="plugin-name">${escapeHtml(p.name)}</span>
          ${version}${badge}${modified}
          <span class="plugin-actions">
            <button class="settings-edit-btn" onclick="openPluginConfigModal('${escapeHtml(p.id)}')">Edit</button>
            ${p.hasOverride ? `<button class="settings-edit-btn" onclick="resetPluginConfig('${escapeHtml(p.id)}')">Reset</button>` : ""}
          </span>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="settings-section">
      <div class="settings-section-header">
        <h3>Plugin Configs</h3>
        <button class="settings-edit-btn" onclick="refreshPlugins()">Refresh</button>
      </div>
      ${rows}
    </div>`;
}

async function openPluginConfigModal(id) {
  if (closePluginModal) return;

  const plugin = pluginsData.find((p) => p.id === id);
  const displayName = plugin ? plugin.name : id;

  const panel = document.createElement("div");
  panel.className = "modal-panel config-modal";
  panel.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${escapeHtml(displayName)} — Config</span>
      <button class="modal-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">Loading\u2026</div>
    <div class="modal-footer">
      <button class="btn" type="button" id="plugin-config-cancel">Cancel</button>
      <button class="btn primary" type="button" id="plugin-config-save">Save</button>
    </div>
  `;

  panel.querySelector(".modal-close").addEventListener("click", () => closePluginModal?.());

  closePluginModal = openOverlay(panel, {
    onClose: () => { panel.remove(); closePluginModal = null; },
  });

  const body = panel.querySelector(".modal-body");
  const config = await fetchPluginConfig(id);

  if (!config || !config.resolved) {
    body.textContent = "Could not load plugin config";
    return;
  }

  const flat = flattenConfig(config.resolved, "");
  const groups = new Map();
  for (const [key, value] of Object.entries(flat)) {
    const group = key.includes(".") ? key.split(".").slice(0, -1).join(".") : "general";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ key, value });
  }

  let html = "";
  for (const [group, fields] of groups) {
    const label = group === "general"
      ? "General"
      : group.split(".").pop().replace(/_/g, " ").replace(/^./, (s) => s.toUpperCase());
    html += `<div class="config-group">`;
    html += `<h3 class="config-group-title">${escapeHtml(label)}</h3>`;
    for (const { key, value } of fields) {
      html += renderPluginField(key, value);
    }
    html += `</div>`;
  }
  body.innerHTML = html;

  panel.querySelector("#plugin-config-cancel").addEventListener("click", () => closePluginModal?.());
  panel.querySelector("#plugin-config-save").addEventListener("click", async () => {
    const configObj = collectPluginFormValues(flat);
    try {
      const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(configObj),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      showToast("Plugin config saved");
      closePluginModal?.();
      await refreshPlugins();
    } catch (e) {
      showToast(`Save failed: ${e.message}`);
    }
  });
}

async function resetPluginConfig(id) {
  if (!confirm("Reset to bundled defaults? This will remove your override.")) return;
  try {
    const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/config`, { method: "DELETE" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    showToast("Plugin config reset to defaults");
    await refreshPlugins();
  } catch (e) {
    showToast(`Reset failed: ${e.message}`);
  }
}

async function refreshPlugins() {
  pluginsData = await fetchPlugins(true);
  renderSettings();
}

async function initPlugins() {
  pluginsData = await fetchPlugins(false);
}
