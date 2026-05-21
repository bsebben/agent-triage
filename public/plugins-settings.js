// public/plugins-settings.js — Plugin config editor for settings panel

let pluginsData = [];
const expandedPlugins = new Set();

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
    const expanded = expandedPlugins.has(p.id);
    const chevron = expanded ? "\u25BC" : "\u25B6";
    const badge = p.marketplace ? `<span class="plugin-marketplace">${escapeHtml(p.marketplace)}</span>` : "";
    const modified = p.hasOverride ? '<span class="plugin-modified">modified</span>' : "";
    const version = p.version ? `<span class="plugin-version">${escapeHtml(p.version)}</span>` : "";
    const editorId = `plugin-editor-${CSS.escape(p.id)}`;

    let editor = "";
    if (expanded) {
      editor = `
        <div class="plugin-editor" id="${editorId}">
          <textarea class="plugin-config-textarea" id="plugin-textarea-${CSS.escape(p.id)}"
            placeholder="Loading..."></textarea>
          <div class="plugin-editor-actions">
            <span class="plugin-error" id="plugin-error-${CSS.escape(p.id)}"></span>
            <button class="settings-edit-btn plugin-reset-btn" onclick="resetPluginConfig('${escapeHtml(p.id)}')">Reset to Defaults</button>
            <button class="settings-restart-btn plugin-save-btn" style="border-color: var(--clr-completion); color: var(--clr-completion);"
              onclick="savePluginConfig('${escapeHtml(p.id)}')">Save</button>
          </div>
        </div>`;
    }

    return `
      <div class="plugin-row">
        <div class="plugin-header" onclick="togglePluginExpand('${escapeHtml(p.id)}')">
          <span class="plugin-chevron">${chevron}</span>
          <span class="plugin-name">${escapeHtml(p.name)}</span>
          ${version}${badge}${modified}
        </div>
        ${editor}
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

async function togglePluginExpand(id) {
  if (expandedPlugins.has(id)) {
    expandedPlugins.delete(id);
  } else {
    expandedPlugins.add(id);
  }
  renderSettings();

  if (expandedPlugins.has(id)) {
    const config = await fetchPluginConfig(id);
    const textarea = document.getElementById(`plugin-textarea-${CSS.escape(id)}`);
    if (textarea && config) {
      textarea.value = JSON.stringify(config.resolved, null, 2);
    } else if (textarea) {
      textarea.value = "// Could not load config";
    }
  }
}

async function savePluginConfig(id) {
  const textarea = document.getElementById(`plugin-textarea-${CSS.escape(id)}`);
  const errorEl = document.getElementById(`plugin-error-${CSS.escape(id)}`);
  if (!textarea) return;

  let parsed;
  try {
    parsed = JSON.parse(textarea.value);
  } catch (e) {
    if (errorEl) {
      errorEl.textContent = `Invalid JSON: ${e.message}`;
      errorEl.style.display = "inline";
    }
    return;
  }
  if (errorEl) { errorEl.textContent = ""; errorEl.style.display = "none"; }

  try {
    const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    showToast("Plugin config saved");
    await refreshPlugins();
  } catch (e) {
    if (errorEl) {
      errorEl.textContent = `Save failed: ${e.message}`;
      errorEl.style.display = "inline";
    }
  }
}

async function resetPluginConfig(id) {
  if (!confirm("Reset to bundled defaults? This will remove your override.")) return;

  const errorEl = document.getElementById(`plugin-error-${CSS.escape(id)}`);
  try {
    const res = await fetch(`/api/plugins/${encodeURIComponent(id)}/config`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    showToast("Plugin config reset to defaults");
    await refreshPlugins();
    if (expandedPlugins.has(id)) {
      const config = await fetchPluginConfig(id);
      const textarea = document.getElementById(`plugin-textarea-${CSS.escape(id)}`);
      if (textarea && config) {
        textarea.value = JSON.stringify(config.resolved, null, 2);
      }
    }
  } catch (e) {
    if (errorEl) {
      errorEl.textContent = `Reset failed: ${e.message}`;
      errorEl.style.display = "inline";
    }
  }
}

async function refreshPlugins() {
  pluginsData = await fetchPlugins(true);
  renderSettings();
}

async function initPlugins() {
  pluginsData = await fetchPlugins(false);
}
