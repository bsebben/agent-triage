// public/settings-panel.js — Settings panel with server logs and restart

let settingsOpen = false;
let logLines = [];
const MAX_DISPLAY_LINES = 200;

function toggleSettingsPanel() {
  settingsOpen = !settingsOpen;
  let panel = document.getElementById("settings-panel");
  if (settingsOpen) {
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "settings-panel";
      document.body.appendChild(panel);
    }
    renderSettings();
    panel.classList.add("open");
  } else if (panel) {
    panel.classList.remove("open");
  }
}

function renderSettings() {
  const panel = document.getElementById("settings-panel");
  if (!panel) return;

  const tabStatuses = state.tabStatus || {};
  const configSections = Object.entries(tabStatuses).map(([name, s]) => {
    const status = s.available ? '<span class="log-info">available</span>' : `<span class="log-error">unavailable</span>`;
    const hint = s.hint ? ` — ${escapeHtml(s.hint)}` : "";
    return `<div class="settings-config-row">${escapeHtml(name)}: ${status}${hint}</div>`;
  }).join("");

  const version = appConfig.version ? `v${appConfig.version}` : "";

  panel.innerHTML = `
    <div class="settings-header">
      <h2>Settings</h2>
      <button class="settings-close" onclick="toggleSettingsPanel()">&times;</button>
    </div>
    <div class="settings-section">
      <div class="settings-section-header">
        <h3>Server ${version}</h3>
        <button class="settings-restart-btn" onclick="restartServer()">Restart</button>
      </div>
      <div class="settings-config">${configSections}</div>
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
    if (settingsOpen) renderSettings();
  } else if (msg.type === "log") {
    logLines.push(msg.entry);
    if (logLines.length > MAX_DISPLAY_LINES * 2) {
      logLines = logLines.slice(-MAX_DISPLAY_LINES);
    }
    if (settingsOpen) {
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

async function restartServer() {
  const btn = document.querySelector(".settings-restart-btn");
  if (btn) { btn.textContent = "Restarting..."; btn.disabled = true; }
  try {
    await fetch("/api/restart", { method: "POST" });
  } catch {}
}
