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
      <div class="config-field config-field-toggle">
        <label class="config-toggle" for="${id}">
          <input type="checkbox" id="${id}" data-key="${key}" data-type="boolean"
            ${checked ? "checked" : ""}>
          <span class="config-toggle-track"></span>
          <span class="config-toggle-label">${escapeHtml(label)}</span>
        </label>
      </div>`;
  }

  const inputType = entry.type === "number" ? "number" : "text";
  const value = rawValue !== null && rawValue !== undefined ? rawValue : "";
  const placeholder = resolvedValue !== null && resolvedValue !== undefined
    ? String(resolvedValue)
    : entry.default !== null ? String(entry.default) : "";

  return `
    <div class="config-field">
      <label class="config-field-label" for="${id}">${escapeHtml(label)}</label>
      <input type="${inputType}" id="${id}" data-key="${key}" data-type="${entry.type}"
        data-nullable="${!!entry.nullable}"
        value="${escapeHtml(String(value))}"
        placeholder="${escapeHtml(String(placeholder))}">
      <span class="config-field-desc">${entry.description}</span>
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
    <div class="modal-body">Loading\u2026</div>
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
  let loadedSchema = null;

  try {
    const res = await fetch("/api/config/schema");
    if (!res.ok) throw new Error(`status ${res.status}`);
    const { schema, raw, resolved } = await res.json();
    loadedSchema = schema;

    const groups = new Map();
    for (const [key, entry] of Object.entries(schema)) {
      if (!groups.has(entry.group)) groups.set(entry.group, []);
      groups.get(entry.group).push({ key, entry });
    }

    const topGroups = [];
    const tabGroups = [];
    for (const [group, fields] of groups) {
      if (group.startsWith("tabs.")) tabGroups.push({ group, fields });
      else topGroups.push({ group, fields });
    }

    let html = "";
    for (const { group, fields } of topGroups) {
      html += `<div class="config-group">`;
      html += `<h3 class="config-group-title">${escapeHtml(groupLabel(group))}</h3>`;
      for (const { key, entry } of fields) {
        const rawValue = getNestedValue(raw, key);
        const resolvedValue = getNestedValue(resolved, key);
        html += renderField(key, entry, rawValue, resolvedValue);
      }
      html += `</div>`;
    }

    if (tabGroups.length > 0) {
      html += `<div class="config-group">`;
      html += `<h3 class="config-group-title">Tabs</h3>`;
      for (const { group, fields } of tabGroups) {
        const tabName = group.split(".").pop();
        const tabLabel = tabName.charAt(0).toUpperCase() + tabName.slice(1);
        html += `<div class="config-tab-section">`;
        html += `<h4 class="config-tab-title">${escapeHtml(tabLabel)}</h4>`;
        for (const { key, entry } of fields) {
          const rawValue = getNestedValue(raw, key);
          const resolvedValue = getNestedValue(resolved, key);
          html += renderField(key, entry, rawValue, resolvedValue);
        }
        html += `</div>`;
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
    const configObj = collectFormValues(loadedSchema);
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
