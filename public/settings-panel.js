// public/settings-panel.js — Settings panel with server logs and restart

let closeSettings = null;
let settingsPanel = null;
let logLines = [];
const MAX_DISPLAY_LINES = 200;

function toggleSettingsPanel() {
  if (closeSettings) {
    closeSettings();
    return;
  }

  settingsPanel = document.createElement("div");
  settingsPanel.id = "settings-panel";
  renderSettings();

  closeSettings = openOverlay(settingsPanel, {
    onClose: () => { settingsPanel.remove(); settingsPanel = null; closeSettings = null; },
  });
}

function renderSettings() {
  if (!settingsPanel) return;

  const tabStatuses = state.tabStatus || {};
  const tabRows = Object.entries(tabStatuses).map(([name, s]) => {
    const status = s.available ? '<span class="log-info">available</span>' : `<span class="log-error">unavailable</span>`;
    const hint = s.hint ? ` — ${escapeHtml(s.hint)}` : "";
    return `<div class="settings-config-row">${escapeHtml(name)}: ${status}${hint}</div>`;
  }).join("");

  const resolved = appConfig.resolved || {};
  const configJson = JSON.stringify(resolved, null, 2);
  const version = appConfig.version ? `v${appConfig.version}` : "";

  settingsPanel.innerHTML = `
    <div class="settings-header">
      <h2>Settings</h2>
      <button class="settings-close" onclick="closeSettings?.()">&times;</button>
    </div>
    <div class="settings-section">
      <div class="settings-section-header">
        <h3>Server ${version}</h3>
        <button class="settings-restart-btn" onclick="restartServer()">Restart</button>
      </div>
      <div class="settings-config">${tabRows}</div>
    </div>
    <div class="settings-section">
      <div class="settings-section-header">
        <h3>Resolved Config</h3>
        <button class="settings-edit-btn" onclick="editSettings()">Edit</button>
      </div>
      <pre class="settings-config-json">${escapeHtml(configJson)}</pre>
    </div>
    <div class="settings-section settings-logs-section">
      <h3>Server Logs</h3>
      <div class="settings-logs" id="settings-log-output">${renderLogLines()}</div>
    </div>
  `;

  scrollLogsToBottom();
}

function renderLogLines() {
  const visible = logLines.slice(-MAX_DISPLAY_LINES);
  if (visible.length === 0) return '<div class="log-empty">No logs yet</div>';
  return visible.map((entry) => {
    const time = new Date(entry.ts).toLocaleTimeString();
    const cls = entry.level === "error" ? "log-error" : entry.level === "warn" ? "log-warn" : "log-info";
    return `<div class="log-line ${cls}"><span class="log-time">${time}</span> ${escapeHtml(entry.text)}</div>`;
  }).join("");
}

function scrollLogsToBottom() {
  const el = document.getElementById("settings-log-output");
  if (el) el.scrollTop = el.scrollHeight;
}

function handleLogMessage(msg) {
  if (msg.type === "logs") {
    logLines = msg.lines || [];
    if (closeSettings) renderSettings();
  } else if (msg.type === "log") {
    logLines.push(msg.entry);
    if (logLines.length > MAX_DISPLAY_LINES * 2) {
      logLines = logLines.slice(-MAX_DISPLAY_LINES);
    }
    if (closeSettings) {
      const el = document.getElementById("settings-log-output");
      if (el) {
        const time = new Date(msg.entry.ts).toLocaleTimeString();
        const cls = msg.entry.level === "error" ? "log-error" : msg.entry.level === "warn" ? "log-warn" : "log-info";
        el.insertAdjacentHTML("beforeend",
          `<div class="log-line ${cls}"><span class="log-time">${time}</span> ${escapeHtml(msg.entry.text)}</div>`);
        el.scrollTop = el.scrollHeight;
      }
    }
  }
}

async function editSettings() {
  if (closeSettings) closeSettings();
  openConfigModal();
}

async function restartServer() {
  const btn = document.querySelector(".settings-restart-btn");
  if (btn) { btn.textContent = "Restarting..."; btn.disabled = true; }
  try {
    await fetch("/api/restart", { method: "POST" });
  } catch {}
}

