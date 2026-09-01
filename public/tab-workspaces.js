// public/tab-workspaces.js

const collapsedGroups = new Set(["Dismissed"]);
// Groups we force-opened because they hold the active tab, so we know to
// collapse them back once the active tab moves elsewhere. A group the user
// expanded manually is never added here, so tabbing away leaves it alone.
const autoExpandedGroups = new Set();
// Groups the user collapsed after we auto-expanded them. Suppresses further
// auto-expanding while they still hold the active tab, so the click sticks.
const userCollapsedActiveGroups = new Set();
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

// Expands the group containing the active tab if it's collapsed, and
// collapses back any group we auto-expanded for a now-inactive tab.
function expandActiveGroup() {
  // The Dismissed drawer is collapsed by default and stays that way —
  // dismissing the card you're focused on shouldn't pop it open.
  const activeGroup = state.groups.find((g) => g.items.some((i) => i.workspaceSelected));
  const activeTitle = activeGroup ? activeGroup.title || "Unknown" : null;

  // A group we opened that now reads as collapsed was collapsed by the user:
  // honor it and stop tracking it as ours.
  for (const title of [...autoExpandedGroups]) {
    if (collapsedGroups.has(title)) {
      autoExpandedGroups.delete(title);
      userCollapsedActiveGroups.add(title);
    }
  }

  for (const title of [...userCollapsedActiveGroups]) {
    if (title !== activeTitle) userCollapsedActiveGroups.delete(title);
  }

  for (const title of [...autoExpandedGroups]) {
    if (title === activeTitle) continue;
    collapsedGroups.add(title);
    autoExpandedGroups.delete(title);
  }

  if (activeTitle && collapsedGroups.has(activeTitle) && !userCollapsedActiveGroups.has(activeTitle)) {
    collapsedGroups.delete(activeTitle);
    autoExpandedGroups.add(activeTitle);
  }
}

function renderWorkspaces() {
  const { groups, dismissed, recentGroups } = state;
  const atLimit = isAtWorkspaceLimit();

  saveCollapseState();
  expandActiveGroup();

  let html = workspaceLimitBanner();

  const disabledAttr = atLimit ? " disabled" : "";
  const refreshAllDisabled = refreshAllInFlight ? " disabled" : "";
  const refreshAllLabel = refreshAllInFlight ? "&#x21bb; Refreshing&hellip;" : "&#x21bb; Refresh All";
  html += `<div class="tab-toolbar">
    <button class="btn-new-workspace btn-new-session" onclick="newSession(undefined, event.shiftKey)" data-tip="New Session" data-tip-dangerous="New Session (dangerously)"${disabledAttr}>${claudeIcon()}</button>
    <button class="btn-new-workspace" onclick="newWorkspace()" data-tip="New Terminal"${disabledAttr}>&gt;_</button>
    <button class="btn-new-workspace btn-refresh-all" onclick="refreshAllSessions(event.shiftKey)" data-tip="Refresh All Sessions" data-tip-dangerous="Refresh All Sessions (dangerously)"${refreshAllDisabled}>${refreshAllLabel}</button>
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
        // The host's dedicated group is always exactly one item \u2014 no new
        // session/terminal affordance for it, same reasoning as its card:
        // this group represents the dashboard's own tab, not a project.
        const isHostGroup = g.items.some((i) => i.isHost);
        const actions = isHostGroup
          ? ""
          : `<span class="group-actions" onclick="event.stopPropagation()">
          <button class="btn-group-add btn-new-session" data-cwd="${escapeHtml(dir)}" onclick="newSession(this.dataset.cwd, event.shiftKey)" data-tip="New Session" data-tip-dangerous="New Session (dangerously)"${disabledAttr}>${claudeIcon()}</button>
          <button class="btn-group-add" data-cwd="${escapeHtml(dir)}" onclick="newWorkspace(this.dataset.cwd)" data-tip="New Terminal"${disabledAttr}>&gt;_</button>
        </span>`;
        return `<div class="group">
      <div class="group-header" onclick="toggleGroup(this)">
        <span class="chevron${isCollapsed ? " collapsed" : ""}">\u25bc</span> <span>${escapeHtml(title)}</span>
        <span class="count">(${g.items.length})</span>
        ${actions}
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
    html += recentGroups
      .map((g) => {
        const title = g.title || "Unknown";
        const dir = g.directory || "";
        const ago = g.lastSeenAt ? ` (${timeAgo(g.lastSeenAt)})` : "";
        return `<div class="group recent-group">
        <div class="group-header">
          <span>${escapeHtml(title)}<span class="recent-ago">${ago}</span></span>
          <span class="group-actions">
            <button class="btn-group-add btn-new-session" data-cwd="${escapeHtml(dir)}" onclick="newSession(this.dataset.cwd, event.shiftKey)" data-tip="New Session" data-tip-dangerous="New Session (dangerously)"${disabledAttr}>${claudeIcon()}</button>
            <button class="btn-group-add" data-cwd="${escapeHtml(dir)}" onclick="newWorkspace(this.dataset.cwd)" data-tip="New Terminal"${disabledAttr}>&gt;_</button>
          </span>
        </div>
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
  const icons = { error: "!", permission: "\u{1f512}", waiting: "\u{26a1}", completion: "\u{2713}", running: "\u{27f3}", refreshing: "\u{21bb}", terminal: ">_" };
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
  const selectedClass = item.workspaceSelected ? " selected" : "";

  const cardTitle = item.workspaceTitle || "Unknown";
  const subtitle = item.gitBranch || null;

  // The host is where this dashboard's own server is running — closing,
  // dismissing, refreshing, or renaming it from here doesn't make sense (in
  // close's case, it'd kill the terminal serving this page). Focus-to-select
  // is the only action that stays.
  const editLink = item.isHost
    ? ""
    : `<a class="card-edit" data-workspace-id="${escapeHtml(item.workspaceId)}" data-title="${escapeHtml(cardTitle)}" onclick="event.stopPropagation();startRename(this,this.dataset.workspaceId,this.dataset.title)">&#9998;</a>`;

  const dismissBtn = item.isHost
    ? ""
    : isDismissed
      ? `<a class="card-dismiss" onclick="event.stopPropagation();restore('${item.id}')">restore</a>`
      : `<a class="card-dismiss" onclick="event.stopPropagation();dismiss('${item.id}')">dismiss</a>`;

  const closeBtn = item.isHost
    ? ""
    : `<a class="card-close" onclick="event.stopPropagation();closeWorkspace('${item.workspaceId}')">close</a>`;

  const serverRefreshing = (state.refreshing || []).includes(item.workspaceId);
  const isRefreshable = !item.isHost && !isDismissed && item.category !== "terminal";
  const refreshing = refreshingWorkspaces.has(item.workspaceId) || refreshAllInFlight || serverRefreshing;
  const refreshBtn = isRefreshable
    ? `<a class="card-refresh${refreshing ? " refreshing" : ""}" data-tip="Refresh session" data-tip-dangerous="Refresh session (dangerously)" onclick="event.stopPropagation();refreshOneSession('${item.workspaceId}', event.shiftKey)"${refreshing ? " style=\"pointer-events:none\"" : ""}>&#x21bb;</a>`
    : "";

  const displayCategory = refreshing ? "refreshing" : item.category;
  const bypassClass = item.bypassPermissions ? " bypass" : "";
  const bypassTip = item.bypassPermissions ? ` title="Running with --dangerously-skip-permissions"` : "";
  const worktreePill = item.isWorktree
    ? `<span class="card-worktree" title="Worktree of ${escapeHtml(item.repoRoot || "")}">&#9095; ${escapeHtml(item.worktreeName || "")}</span>`
    : "";
  return `<div class="card${selectedClass}${bypassClass} cat-${escapeHtml(displayCategory)}" data-workspace-id="${item.workspaceId}"${bypassTip} onclick="cardClick(event,'${item.workspaceId}')">
    <div class="card-title-row"><span class="card-title-group"><span class="card-title">${escapeHtml(cardTitle)}</span>${editLink}</span><span class="card-actions-col"><span class="card-actions-right">${refreshBtn}${dismissBtn}${closeBtn}</span>${item.createdAt ? `<span class="card-time">\u{1f559} ${timeAgo(item.createdAt)}</span>` : ""}</span></div>
    <div class="card-content">
      <div class="card-header">
        <span class="card-category ${escapeHtml(displayCategory)}"><span class="card-icon">${categoryIcon(displayCategory)}</span> ${escapeHtml(displayCategory)}</span>
      </div>
    ${subtitle || worktreePill ? `<div class="card-subtitle">${worktreePill}${worktreePill && subtitle ? " / " : ""}${subtitle ? escapeHtml(subtitle) : ""}</div>` : ""}
    ${item.body && !isGenericBody(item.body) ? `<div class="card-body">${escapeHtml(item.body)}</div>` : ""}
    </div>
  </div>`;
}

async function closeWorkspace(workspaceId) {
  recentCloses.set(workspaceId, Date.now() + 15000);
  applyCloses();
  render();
  await apiPost("close", { workspaceId });
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

async function refreshOneSession(workspaceId, dangerous) {
  if (refreshingWorkspaces.has(workspaceId) || refreshAllInFlight) return;
  refreshingWorkspaces.add(workspaceId);
  render();
  const body = { workspaceId };
  if (dangerous) body.dangerous = true;
  try {
    const result = await apiPost("refresh-session", body);
    if (!result.ok) showToast(result.error || "Refresh failed");
  } catch {
    showToast("Refresh failed");
  } finally {
    refreshingWorkspaces.delete(workspaceId);
    render();
  }
}

async function refreshAllSessions(dangerous) {
  if (refreshAllInFlight) return;
  refreshAllInFlight = true;
  render();
  try {
    const result = await apiPost("refresh-all", dangerous ? { dangerous: true } : {});
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
