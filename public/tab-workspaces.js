// public/tab-workspaces.js

const collapsedGroups = new Set(["Dismissed"]);
const recentDefaultCollapsed = new Set();
const refreshingWorkspaces = new Set();
let refreshAllInFlight = false;

function saveCollapseState() {
  const headers = queue.querySelectorAll(".group-header");
  headers.forEach((header) => {
    const title = header.querySelector("span:nth-child(2)")?.textContent || "";
    const items = header.nextElementSibling;
    if (items && items.classList.contains("collapsed")) {
      collapsedGroups.add(title);
    } else {
      collapsedGroups.delete(title);
    }
  });
}

function renderWorkspaces() {
  const { groups, dismissed, recentGroups } = state;
  const atLimit = state.maxSessions !== null && state.sessionCount >= state.maxSessions;

  saveCollapseState();

  let html = "";
  if (atLimit) {
    html += `<div class="session-limit-toast">Session limit reached (${state.sessionCount}/${state.maxSessions})</div>`;
  }

  const disabledAttr = atLimit ? " disabled" : "";
  const refreshAllDisabled = refreshAllInFlight ? " disabled" : "";
  const refreshAllLabel = refreshAllInFlight ? "&#x21bb; Refreshing&hellip;" : "&#x21bb; Refresh All";
  html += `<div class="tab-toolbar">
    <button class="btn-new-workspace" onclick="newSession()" data-tip="New Session"${disabledAttr}>${claudeIcon()}</button>
    <button class="btn-new-workspace" onclick="newWorkspace()" data-tip="New Terminal"${disabledAttr}>&gt;_</button>
    <button class="btn-new-workspace btn-refresh-all" onclick="refreshAllSessions()" data-tip="Refresh All Sessions"${refreshAllDisabled}>${refreshAllLabel}</button>
  </div>`;

  if (groups.length === 0 && (!recentGroups || recentGroups.length === 0) && (!dismissed || dismissed.length === 0)) {
    queue.innerHTML = html + `<div class="empty-state">No agent activity detected</div>`;
    return;
  }

  html += groups
    .map(
      (g) => {
        const title = g.title || "Unknown";
        const isCollapsed = collapsedGroups.has(title);
        const dir = g.directory || "";
        return `<div class="group">
      <div class="group-header" onclick="toggleGroup(this)">
        <span class="chevron${isCollapsed ? " collapsed" : ""}">\u25bc</span> <span>${escapeHtml(title)}</span>
        <span class="count">(${g.items.length})</span>
        <span class="group-actions" onclick="event.stopPropagation()">
          <button class="btn-group-add" data-cwd="${escapeHtml(dir)}" onclick="newSession(this.dataset.cwd)" data-tip="New Session"${disabledAttr}>${claudeIcon()}</button>
          <button class="btn-group-add" data-cwd="${escapeHtml(dir)}" onclick="newWorkspace(this.dataset.cwd)" data-tip="New Terminal"${disabledAttr}>&gt;_</button>
        </span>
      </div>
      <div class="group-items${isCollapsed ? " collapsed" : ""}">${g.items.map((i) => renderCard(i)).join("")}</div>
    </div>`;
      }
    )
    .join("");

  if (recentGroups && recentGroups.length > 0) {
    if (groups.length > 0) {
      html += `<div class="recent-divider"><span>Recent directories</span></div>`;
    }
    for (const g of recentGroups) {
      const title = g.title || "Unknown";
      if (!recentDefaultCollapsed.has(title)) {
        recentDefaultCollapsed.add(title);
        collapsedGroups.add(title);
      }
    }
    html += recentGroups
      .map((g) => {
        const title = g.title || "Unknown";
        const isCollapsed = collapsedGroups.has(title);
        const dir = g.directory || "";
        return `<div class="group recent-group">
        <div class="group-header" onclick="toggleGroup(this)">
          <span class="chevron${isCollapsed ? " collapsed" : ""}">\u25bc</span> <span>${escapeHtml(title)}</span>
          <span class="count">(0)</span>
          <span class="group-actions" onclick="event.stopPropagation()">
            <button class="btn-group-add" data-cwd="${escapeHtml(dir)}" onclick="newSession(this.dataset.cwd)" data-tip="New Session"${disabledAttr}>${claudeIcon()}</button>
            <button class="btn-group-add" data-cwd="${escapeHtml(dir)}" onclick="newWorkspace(this.dataset.cwd)" data-tip="New Terminal"${disabledAttr}>&gt;_</button>
          </span>
        </div>
        <div class="group-items${isCollapsed ? " collapsed" : ""}"></div>
      </div>`;
      })
      .join("");
  }

  if (dismissed && dismissed.length > 0) {
    const dismissedCollapsed = collapsedGroups.has("Dismissed");
    html += `<div class="group dismissed-group">
      <div class="group-header" onclick="toggleGroup(this)">
        <span class="chevron${dismissedCollapsed ? " collapsed" : ""}">\u25bc</span> <span>Dismissed</span>
        <span class="count">(${dismissed.length})</span>
      </div>
      <div class="group-items${dismissedCollapsed ? " collapsed" : ""}">${dismissed.map((i) => renderCard(i, { isDismissed: true })).join("")}</div>
    </div>`;
  }

  queue.innerHTML = html;
}

function categoryIcon(cat) {
  const icons = { error: "!", permission: "\u{1f512}", question: "?", waiting: "\u{26a1}", completion: "\u{2713}", running: "\u{27f3}", refreshing: "\u{21bb}", terminal: ">_" };
  return icons[cat] || "?";
}

const GENERIC_BODIES = [
  "claude is waiting for your input",
  "claude code needs your approval",
];

function isGenericBody(body) {
  return GENERIC_BODIES.includes(body.toLowerCase().trim());
}

function renderCard(item, { isDismissed = false } = {}) {
  const hasQuestion = item.parsedQuestion?.question;
  const options = item.parsedQuestion?.options || [];
  const selectedClass = item.workspaceSelected ? " selected" : "";

  let optionsHtml = "";
  if (!isDismissed && options.length > 0) {
    optionsHtml = `<div class="card-options">
      ${options.map((o, i) => `<button class="btn primary" onclick="respond('${item.workspaceId}','${item.surfaceId}','${i + 1}')">${escapeHtml(o)}</button>`).join("")}
    </div>`;
  }

  const approveButtons = !isDismissed && item.category === "permission"
    ? `<button class="btn primary" onclick="respond('${item.workspaceId}','${item.surfaceId}','y')">Approve</button>
       <button class="btn danger" onclick="respond('${item.workspaceId}','${item.surfaceId}','n')">Deny</button>`
    : "";

  const cardTitle = item.workspaceTitle || "Unknown";
  const subtitle = item.gitBranch || null;

  const dismissBtn = isDismissed
    ? `<a class="card-dismiss" onclick="event.stopPropagation();restore('${item.id}')">restore</a>`
    : `<a class="card-dismiss" onclick="event.stopPropagation();dismiss('${item.id}')">dismiss</a>`;

  const closeBtn = `<a class="card-close" onclick="event.stopPropagation();closeWorkspace('${item.workspaceId}')">close</a>`;

  const serverRefreshing = (state.refreshing || []).includes(item.workspaceId);
  const isRefreshable = !isDismissed && item.category !== "terminal";
  const refreshing = refreshingWorkspaces.has(item.workspaceId) || refreshAllInFlight || serverRefreshing;
  const refreshBtn = isRefreshable
    ? `<a class="card-refresh${refreshing ? " refreshing" : ""}" data-tip="Refresh session" onclick="event.stopPropagation();refreshOneSession('${item.workspaceId}')"${refreshing ? " style=\"pointer-events:none\"" : ""}>&#x21bb;</a>`
    : "";

  const displayCategory = refreshing ? "refreshing" : item.category;
  return `<div class="card${selectedClass} cat-${escapeHtml(displayCategory)}" data-workspace-id="${item.workspaceId}" onclick="cardClick(event,'${item.workspaceId}')">
    <div class="card-title-row"><span class="card-title-group"><span class="card-title">${escapeHtml(cardTitle)}</span><a class="card-edit" onclick="event.stopPropagation();startRename(this,'${item.workspaceId}','${escapeHtml(cardTitle)}')">&#9998;</a></span><span class="card-actions-col"><span class="card-actions-right">${refreshBtn}${dismissBtn}${closeBtn}</span>${item.createdAt ? `<span class="card-time">\u{1f559} ${timeAgo(item.createdAt)}</span>` : ""}</span></div>
    <div class="card-content">
      <div class="card-header">
        <span class="card-category ${escapeHtml(displayCategory)}"><span class="card-icon">${categoryIcon(displayCategory)}</span> ${escapeHtml(displayCategory)}</span>
      </div>
    ${subtitle ? `<div class="card-subtitle">${escapeHtml(subtitle)}</div>` : ""}
    ${hasQuestion ? `<div class="card-question">"${escapeHtml(item.parsedQuestion.question)}"</div>` : ""}
    ${!hasQuestion && item.body && !isGenericBody(item.body) ? `<div class="card-body">${escapeHtml(item.body)}</div>` : ""}
    ${optionsHtml}
    ${approveButtons}
    </div>
  </div>`;
}

async function closeWorkspace(workspaceId) {
  recentCloses.set(workspaceId, Date.now() + 15000);
  applyCloses();
  render();
  await apiPost("close", { workspaceId });
}

async function respond(workspaceId, surfaceId, text) {
  await apiPost("respond", { workspaceId, surfaceId, text: String(text) });
}

async function focusAgent(workspaceId) {
  document.querySelectorAll(".card").forEach((c) => c.classList.remove("selected"));
  const card = document.querySelector(`.card[data-workspace-id="${workspaceId}"]`);
  if (card) card.classList.add("selected");
  await apiPost("focus", { workspaceId });
}

function startRename(editLink, workspaceId, currentName) {
  const titleSpan = editLink.closest(".card-title-group").querySelector(".card-title");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.value = currentName;
  titleSpan.replaceWith(input);
  editLink.style.display = "none";
  renaming = true;
  input.focus();
  input.select();

  let done = false;
  async function finish(newName) {
    if (done) return;
    done = true;
    renaming = false;
    if (newName) {
      const res = await apiPost("rename", { workspaceId, title: newName });
      if (!res.error) {
        recentRenames.set(workspaceId, { title: newName, expiresAt: Date.now() + 15000 });
        applyRenames();
      }
    }
    render();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(input.value.trim()); }
    if (e.key === "Escape") { e.preventDefault(); finish(null); }
  });
  input.addEventListener("blur", () => finish(input.value.trim()));
}

function cardClick(event, workspaceId) {
  const tag = event.target.tagName;
  if (tag === "BUTTON" || tag === "INPUT") return;
  focusAgent(workspaceId);
}

async function dismiss(id) {
  await apiPost("dismiss", { id });
}

async function restore(id) {
  await apiPost("restore", { id });
}

async function refreshOneSession(workspaceId) {
  if (refreshingWorkspaces.has(workspaceId) || refreshAllInFlight) return;
  refreshingWorkspaces.add(workspaceId);
  render();
  try {
    const result = await apiPost("refresh-session", { workspaceId });
    if (!result.ok) showToast(result.error || "Refresh failed");
  } catch {
    showToast("Refresh failed");
  } finally {
    refreshingWorkspaces.delete(workspaceId);
    render();
  }
}

async function refreshAllSessions() {
  if (refreshAllInFlight) return;
  refreshAllInFlight = true;
  render();
  try {
    const result = await apiPost("refresh-all", {});
    const results = result.results || [];
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    if (failed === 0 && ok > 0) {
      showToast(`Refreshed ${ok} session${ok === 1 ? "" : "s"}`);
    } else if (failed > 0 && ok > 0) {
      showToast(`Refreshed ${ok}/${ok + failed} sessions \u2014 ${failed} failed`);
    } else if (failed > 0 && ok === 0) {
      showToast(`All ${failed} refresh${failed === 1 ? "" : "es"} failed`);
    } else {
      showToast("No sessions to refresh");
    }
  } catch {
    showToast("Refresh All failed");
  } finally {
    refreshAllInFlight = false;
    render();
  }
}
