// public/app.js — shared core: state, websocket, tabs, utilities
const queue = document.getElementById("queue");
let activeTab = "workspaces";
let appConfig = {};

let ws;
let state = { groups: [], dismissed: [], stats: { total: 0, pending: 0, completed: 0, dismissed: 0 } };
let renaming = false;
const recentRenames = new Map();
const recentCloses = new Map();

async function loadAppConfig() {
  try {
    const res = await fetch("/api/config");
    appConfig = await res.json();
    document.querySelector("header h1").textContent = "Agent Triage";
    if (appConfig.version) {
      document.querySelector(".app-version").textContent = `v${appConfig.version}`;
    }
    for (const tab of ["loops", "tickets", "pulls"]) {
      const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
      if (btn) btn.style.display = appConfig[tab]?.enabled === false ? "none" : "";
    }
  } catch {}
}

function connect() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "update") {
      state = msg.data;
      applyRenames();
      applyCloses();
      if (!renaming) render();
      if (typeof renderUpdateIndicator === "function") renderUpdateIndicator();
    } else if (msg.type === "log" || msg.type === "logs") {
      if (typeof handleLogMessage === "function") handleLogMessage(msg);
    }
  };
  ws.onopen = () => {
    loadAppConfig();
    if (sessionStorage.getItem("configSaved")) {
      sessionStorage.removeItem("configSaved");
      showToast("Configuration updated");
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
}

function applyCloses() {
  const now = Date.now();
  for (const [wsId, expiresAt] of recentCloses) {
    if (now > expiresAt) { recentCloses.delete(wsId); continue; }
    for (const g of state.groups) {
      g.items = g.items.filter((item) => item.workspaceId !== wsId);
    }
    state.groups = state.groups.filter((g) => g.items.length > 0);
    if (state.dismissed) {
      state.dismissed = state.dismissed.filter((item) => item.workspaceId !== wsId);
    }
  }
}

function applyRenames() {
  const now = Date.now();
  for (const [wsId, { title, expiresAt }] of recentRenames) {
    if (now > expiresAt) { recentRenames.delete(wsId); continue; }
    for (const g of state.groups) {
      for (const item of g.items) {
        if (item.workspaceId === wsId) item.workspaceTitle = title;
      }
    }
    for (const item of (state.dismissed || [])) {
      if (item.workspaceId === wsId) item.workspaceTitle = title;
    }
  }
}

// --- Render dispatch ---

function render() {
  if (activeTab === "workspaces") renderWorkspaces();
  else if (activeTab === "loops") renderLoops();
  else if (activeTab === "pulls") renderPulls();
  else if (activeTab === "tickets") renderTickets();

  if (activeTab !== "workspaces") {
    const rs = refreshStates[activeTab] || {};
    const cls = rs.cls ? ` ${rs.cls}` : "";
    const text = rs.text || "\u21bb Refresh";
    queue.insertAdjacentHTML("afterbegin",
      `<button class="refresh-btn${cls}" title="Refresh" onclick="refreshTab()">${text}</button>`);
  }

  selectedIndex = -1;
  updateTabBadges();
}

const refreshStates = {};

async function refreshTab() {
  if (refreshStates[activeTab]?.cls === "refreshing") return;
  const tab = activeTab;
  refreshStates[tab] = { cls: "refreshing", text: "\u21bb Refreshing\u2026" };
  render();
  try {
    const res = await fetch(`/api/refresh/${tab}`, { method: "POST" });
    refreshStates[tab] = res.ok
      ? { cls: "refresh-ok", text: "\u2713 Refreshed" }
      : { cls: "refresh-err", text: "\u2717 Failed" };
  } catch {
    refreshStates[tab] = { cls: "refresh-err", text: "\u2717 Failed" };
  }
  render();
  setTimeout(() => { delete refreshStates[tab]; render(); }, 1500);
}

function updateTabBadges() {
  const { stats } = state;
  const loops = state.loops || [];
  const pulls = state.pulls || { mine: [], reviews: [] };

  // Workspaces: count items waiting on input (not running/completion)
  const waitingCount = stats.pending > 0 ? stats.pending : null;
  setBadge("workspaces", waitingCount, null);

  // Loops: show status indicator (loops may be an array or { enabled: false })
  const loopsArray = Array.isArray(loops) ? loops : [];
  const enabledLoops = loopsArray.filter((l) => l.enabled !== false);
  const runningCount = enabledLoops.filter((l) => l.session === "running").length;
  const hasFailed = enabledLoops.some((l) => l.loopState === "errored" || l.loopState === "failed");
  if (hasFailed) setBadge("loops", "!", "error");
  else if (runningCount > 0) setBadge("loops", runningCount, "running");
  else setBadge("loops", null, null);

  // PRs: count actionable across both sections
  const allGroups = [...pulls.mine, ...pulls.reviews];
  const actionable = allGroups.reduce((n, g) =>
    n + g.prs.filter((p) => p.status === "approved" || p.status === "comments" || p.ci === "failing").length, 0);
  setBadge("pulls", actionable || null, actionable > 0 ? "attention" : null);

  // Tickets: show total count
  const ticketGroups = state.tickets || [];
  const ticketCount = ticketGroups.reduce((n, g) => n + g.tickets.length, 0);
  setBadge("tickets", ticketCount || null, null);
}

function setBadge(tab, count, variant) {
  const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
  if (!btn) return;
  let badge = btn.querySelector(".tab-badge");
  if (count === null) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "tab-badge";
    btn.appendChild(badge);
  }
  badge.textContent = count;
  badge.className = "tab-badge" + (variant ? ` tab-badge-${variant}` : "");
}


// --- Shared utilities ---

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function claudeIcon() {
  return `<svg class="claude-icon" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 1c.3 1.7 1.4 5.2 6 7-4.6 1.8-5.7 5.3-6 7-.3-1.7-1.4-5.2-6-7 4.6-1.8 5.7-5.3 6-7z"/></svg>`;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

async function apiPost(endpoint, body) {
  const res = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function newSession(cwd) {
  const body = { command: "claude" };
  if (cwd) body.cwd = cwd;
  const res = await apiPost("new-workspace", body);
  if (res.error && res.limit) showSessionLimitAlert(res);
}

async function newWorkspace(cwd) {
  const res = await apiPost("new-workspace", cwd ? { cwd } : {});
  if (res.error && res.limit) showSessionLimitAlert(res);
}

function showSessionLimitAlert(res) {
  const existing = document.querySelector(".session-limit-toast");
  if (existing) return;
  const toast = document.createElement("div");
  toast.className = "session-limit-toast";
  toast.textContent = `Session limit reached (${res.current}/${res.limit})`;
  queue.prepend(toast);
  setTimeout(() => toast.remove(), 3000);
}

function toggleGroup(header) {
  header.nextElementSibling.classList.toggle("collapsed");
  header.querySelector(".chevron").classList.toggle("collapsed");
}

// --- Keyboard navigation ---

let selectedIndex = -1;

function getVisibleCards() {
  return [...document.querySelectorAll(".group:not(.dismissed-group) .card")];
}

function clearKeyboardFocus() {
  getVisibleCards().forEach((c) => c.classList.remove("keyboard-focus"));
  selectedIndex = -1;
}

function updateKeyboardSelection(index) {
  const cards = getVisibleCards();
  if (cards.length === 0) return;

  cards.forEach((c) => c.classList.remove("keyboard-focus"));
  selectedIndex = Math.max(0, Math.min(index, cards.length - 1));
  const card = cards[selectedIndex];
  card.classList.add("keyboard-focus");
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;

  const cards = getVisibleCards();
  if (cards.length === 0) return;

  if (e.key === "ArrowDown" || e.key === "j") {
    e.preventDefault();
    updateKeyboardSelection(selectedIndex + 1);
  } else if (e.key === "ArrowUp" || e.key === "k") {
    e.preventDefault();
    updateKeyboardSelection(selectedIndex - 1);
  } else if (e.key === "Enter" && selectedIndex >= 0) {
    e.preventDefault();
    const card = cards[selectedIndex];
    const wsId = card.dataset.workspaceId;
    if (wsId) focusAgent(wsId);
    clearKeyboardFocus();
  } else if (e.key === "Escape") {
    clearKeyboardFocus();
  }
});

// --- Tab switching ---

document.querySelector(".tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  activeTab = btn.dataset.tab;
  render();
});

loadAppConfig();
connect();
