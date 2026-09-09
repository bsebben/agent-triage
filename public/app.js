// public/app.js — shared core: state, websocket, tabs, utilities
const queue = document.getElementById("queue");
let activeTab = "workspaces";
let appConfig = {};

let ws = null;
let reconnectTimer = null;
let livenessTimer = null;
let lastMessageAt = 0;
const RECONNECT_DELAY_MS = 2000;
// The server broadcasts an update every poll cycle (5s) and pings every
// heartbeat period (30s), so silence this long means the connection is gone
// even if the browser hasn't noticed.
const STALE_AFTER_MS = 60000;
const LIVENESS_CHECK_MS = 10000;
let state = { groups: [], recentGroups: [], dismissed: [], stats: { total: 0, pending: 0, completed: 0, dismissed: 0 } };
let renaming = false;
let pendingReload = false;
let serverBootId = null;
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
    if (typeof renderCmuxCompatIndicator === "function") renderCmuxCompatIndicator();
    for (const tab of ["loops", "tickets", "pulls", "tasks"]) {
      const btn = document.querySelector(`.tab[data-tab="${tab}"]`);
      if (btn) btn.style.display = appConfig[tab]?.enabled === false ? "none" : "";
    }
  } catch {}
}

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function connect() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Detach and close whatever socket this call replaces. checkLiveness() can
  // call in while the old socket is still CONNECTING or OPEN (that is the
  // whole point — a half-open socket never fires onclose), and leaving it
  // attached would hold a per-host connection slot for a socket nothing reads
  // from, plus let its eventual close schedule a competing reconnect.
  if (ws) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}`);
  ws = socket;
  lastMessageAt = Date.now();
  startLivenessWatchdog();
  socket.onmessage = (e) => {
    lastMessageAt = Date.now();
    const msg = JSON.parse(e.data);
    if (msg.type === "update") {
      // The websocket reconnects transparently across a plain server
      // restart (not just the explicit self-update flow pendingReload
      // covers) — without this, a tab left open keeps running whatever
      // HTML/JS it loaded before the restart, indefinitely.
      if (msg.data.bootId && serverBootId && msg.data.bootId !== serverBootId) {
        return location.reload();
      }
      serverBootId = msg.data.bootId || serverBootId;
      state = msg.data;
      applyRenames();
      applyCloses();
      if (!renaming) render();
      if (typeof renderCmuxCompatIndicator === "function") renderCmuxCompatIndicator();
      if (typeof renderWindowCountIndicator === "function") renderWindowCountIndicator();
      if (typeof renderUpdateIndicator === "function") renderUpdateIndicator();
    } else if (msg.type === "log" || msg.type === "logs") {
      if (typeof handleLogMessage === "function") handleLogMessage(msg);
    }
  };
  socket.onopen = () => {
    if (pendingReload) return location.reload();
    loadAppConfig();
    if (typeof initIntegrationNudge === "function") initIntegrationNudge();
    if (sessionStorage.getItem("configSaved")) {
      sessionStorage.removeItem("configSaved");
      showToast("Configuration updated");
    }
  };
  // Only the socket that is still the live one may drive a reconnect.
  socket.onclose = () => {
    if (ws === socket) scheduleReconnect();
  };
}

// A socket whose network path dies without a TCP close (laptop sleep, VPN
// drop, partition) never fires onclose, so onclose alone can leave the tab
// sitting on stale data forever. The server's own heartbeat can't rescue it
// either: it terminates the half-open socket without a close frame the client
// will ever see, and its pings are answered by the browser's network stack
// rather than by this page. So detect the silence here instead.
function checkLiveness() {
  if (!ws) return;
  if (Date.now() - lastMessageAt < STALE_AFTER_MS) return;
  connect();
}

function startLivenessWatchdog() {
  if (livenessTimer !== null) return;
  livenessTimer = setInterval(checkLiveness, LIVENESS_CHECK_MS);
}

// A backgrounded tab's timers are throttled, and a machine that just woke or
// rejoined the network won't have run the interval at all — so re-check at the
// moments the user is about to look at the data.
window.addEventListener("focus", checkLiveness);
window.addEventListener("online", checkLiveness);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkLiveness();
});

function applyCloses() {
  const now = Date.now();
  for (const [wsId, expiresAt] of recentCloses) {
    if (now > expiresAt) { recentCloses.delete(wsId); continue; }
    for (const g of state.groups) {
      g.items = g.items.filter((item) => item.workspaceId !== wsId);
    }
    const emptied = state.groups.filter((g) => g.items.length === 0);
    state.groups = state.groups.filter((g) => g.items.length > 0);
    for (const g of emptied) {
      if (!state.recentGroups.some((r) => r.title === g.title)) {
        state.recentGroups.push({ title: g.title, directory: g.directory, items: [], recent: true });
      }
    }
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
  else if (activeTab === "tasks") renderTasks();

  if (activeTab !== "workspaces" && activeTab !== "tasks") {
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
  const pulls = state.pulls || { mine: [], reviews: [], assigned: [] };

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

  // PRs: what the badge counts is configurable (tabs.pulls.badgeCount).
  const pullsCfg = getPullsConfig();
  const countReviews = pullsCfg.badgeCount === "reviews";
  // "reviews" mode counts only the `assigned` search (requests addressed to the user
  // personally). That is the bucket the Reviews sub-tab shows by default, so badge and
  // list agree, and unlike the team-inclusive `reviews` list it fits well inside the
  // fetch row ceiling — so the number is exact rather than silently truncated at the cap.
  // Every row of it is a request still waiting on the user: GitHub drops a PR from a
  // review-requested search once a review is submitted.
  // In "actionable" mode `assigned` is its own search rather than a subset of the
  // row-capped `reviews` list, so a direct request can appear only there — but the two
  // overlap heavily, hence the dedupe by url before counting.
  const pullGroups = countReviews
    ? [...(pulls.assigned || [])]
    : [...pulls.mine, ...pulls.reviews, ...(pulls.assigned || [])];
  const pullUrls = new Set();
  for (const g of pullGroups) {
    for (const p of g.prs) {
      if (countReviews || p.status === "approved" || p.status === "comments" || p.status === "queue_failed" || p.ci === "failing") {
        pullUrls.add(p.url);
      }
    }
  }
  const pullCount = pullUrls.size;
  setBadge("pulls", pullCount || null, pullCount > 0 ? "attention" : null);

  // Tickets: show total count
  const ticketGroups = state.tickets || [];
  const ticketCount = ticketGroups.reduce((n, g) => n + g.tickets.length, 0);
  setBadge("tickets", ticketCount || null, null);

  // Tasks: count of incomplete tasks
  const taskItems = state.tasks || [];
  const incompleteTasks = taskItems.filter((t) => !t.done).length;
  setBadge("tasks", incompleteTasks || null, null);
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
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 604800)}w ago`;
}

async function apiPost(endpoint, body) {
  const res = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function newSession(cwd, dangerous) {
  const body = { command: "claude" };
  if (cwd) body.cwd = cwd;
  if (dangerous) body.dangerous = true;
  const res = await apiPost("new-workspace", body);
  if (res.error && res.limit) showWorkspaceLimitAlert(res);
}

async function newWorkspace(cwd) {
  const res = await apiPost("new-workspace", cwd ? { cwd } : {});
  if (res.error && res.limit) showWorkspaceLimitAlert(res);
}

function isAtWorkspaceLimit() {
  return state.maxSessions !== null && state.sessionCount >= state.maxSessions;
}

function workspaceLimitBanner() {
  if (!isAtWorkspaceLimit()) return "";
  return `<div class="workspace-limit-banner">Workspace limit reached (${state.sessionCount}/${state.maxSessions})</div>`;
}

function showWorkspaceLimitAlert(res) {
  const existing = document.querySelector(".workspace-limit-banner");
  if (existing) return;
  const toast = document.createElement("div");
  toast.className = "workspace-limit-banner";
  toast.textContent = `Workspace limit reached (${res.current}/${res.limit})`;
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

function syncShiftKey(e) {
  document.body.classList.toggle("shift-held", e.shiftKey);
}
document.addEventListener("keydown", syncShiftKey);
document.addEventListener("keyup", syncShiftKey);
window.addEventListener("blur", () => {
  document.body.classList.remove("shift-held");
});

// --- Focus warning: dictation lands here, not cmux, while this window has focus ---

function syncWindowFocus() {
  document.body.classList.toggle("window-focused", document.hasFocus());
}
window.addEventListener("focus", syncWindowFocus);
window.addEventListener("blur", syncWindowFocus);
syncWindowFocus();

// Finds the workspace adjacent to the currently cmux-selected card in the
// dashboard's own displayed order (not cmux's tab order, which can differ).
// Falls back to the first card if nothing is marked selected yet.
function adjacentWorkspaceId(direction) {
  const cards = getVisibleCards();
  if (cards.length === 0) return null;
  const currentIndex = cards.findIndex((c) => c.classList.contains("selected"));
  if (currentIndex === -1) return cards[0].dataset.workspaceId || null;
  const offset = direction === "previous" ? -1 : 1;
  const targetIndex = (currentIndex + offset + cards.length) % cards.length;
  return cards[targetIndex].dataset.workspaceId || null;
}

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;

  // Cmd+↑/↓ mirrors cmux's own workspace-switch shortcut instead of moving
  // the dashboard's local keyboard-focus highlight below — but walks the
  // dashboard's own displayed order, not cmux's tab order.
  if (e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const workspaceId = adjacentWorkspaceId(e.key === "ArrowDown" ? "next" : "previous");
    if (workspaceId) apiPost("focus", { workspaceId, activate: true });
    return;
  }

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
