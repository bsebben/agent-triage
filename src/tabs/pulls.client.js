// public/tab-pulls.js

let pullsSubTab = "mine";
let pullsAuthorFilter = "";
let pullsStatusFilter = "";
let pullsDirectFilter = true;
const collapsedPullRepos = new Set();

function collectAuthors(groups) {
  const authors = new Set();
  for (const g of groups) {
    for (const pr of g.prs) {
      if (pr.author) authors.add(pr.author);
    }
  }
  return [...authors].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function collectStatuses(groups) {
  const statuses = new Set();
  for (const g of groups) {
    for (const pr of g.prs) {
      if (pr.status) statuses.add(pr.status);
    }
  }
  const order = ["open", "draft", "comments", "approved", "queued", "queue_failed"];
  return order.filter((s) => statuses.has(s));
}

function filterGroupsByAuthor(groups, author) {
  if (!author) return groups;
  return groups
    .map((g) => ({ ...g, prs: g.prs.filter((pr) => pr.author === author) }))
    .filter((g) => g.prs.length > 0);
}

function filterGroupsByStatus(groups, status) {
  if (!status) return groups;
  return groups
    .map((g) => ({ ...g, prs: g.prs.filter((pr) => pr.status === status) }))
    .filter((g) => g.prs.length > 0);
}

function filterGroupsByDirect(groups) {
  return groups
    .map((g) => ({ ...g, prs: g.prs.filter((pr) => pr.directReview) }))
    .filter((g) => g.prs.length > 0);
}

function renderPulls() {
  const pullsCfg = state.tabStatus?.pulls || appConfig.pulls || {};
  if (!pullsCfg.available) {
    const hint = escapeHtml(pullsCfg.hint || "GitHub CLI (gh) not found.");
    queue.innerHTML = `<div class="empty-state">${hint}</div>`;
    return;
  }
  const pulls = state.pulls || { mine: [], reviews: [], merged: [] };
  const mineCount = pulls.mine.reduce((n, g) => n + g.prs.length, 0);
  const reviewCount = pulls.reviews.reduce((n, g) => n + g.prs.length, 0);
  const mergedCount = (pulls.merged || []).reduce((n, g) => n + g.prs.length, 0);

  const mineActive = pullsSubTab === "mine" ? " active" : "";
  const reviewsActive = pullsSubTab === "reviews" ? " active" : "";
  const mergedActive = pullsSubTab === "merged" ? " active" : "";

  let html = workspaceLimitBanner();
  html += `<div class="sub-tabs">
    <button class="sub-tab${mineActive}" onclick="switchPullsTab('mine')">Mine (${mineCount})</button>
    <button class="sub-tab${reviewsActive}" onclick="switchPullsTab('reviews')">Reviews (${reviewCount})</button>
    <button class="sub-tab${mergedActive}" onclick="switchPullsTab('merged')">Merged (${mergedCount})</button>
  </div>`;

  if (pullsSubTab === "mine") {
    const statuses = collectStatuses(pulls.mine);
    if (statuses.length > 1) {
      html += `<div class="pulls-filter-bar">${renderStatusFilter(statuses)}</div>`;
    }
    const filtered = filterGroupsByStatus(pulls.mine, pullsStatusFilter);
    const filteredCount = filtered.reduce((n, g) => n + g.prs.length, 0);
    if (filteredCount === 0) {
      html += `<div class="empty-state">No open pull requests</div>`;
    } else {
      html += filtered.map((g) => renderPullGroup(g, false, "mine")).join("");
    }
  } else if (pullsSubTab === "merged") {
    const merged = pulls.merged || [];
    const filteredCount = merged.reduce((n, g) => n + g.prs.length, 0);
    if (filteredCount === 0) {
      html += `<div class="empty-state">No recently merged pull requests</div>`;
    } else {
      html += merged.map((g) => renderPullGroup(g, false, "merged")).join("");
    }
  } else {
    const authors = collectAuthors(pulls.reviews);
    const statuses = collectStatuses(pulls.reviews);
    html += `<div class="pulls-filter-bar">`;
    if (authors.length > 1) html += renderAuthorFilter(authors);
    if (statuses.length > 1) html += renderStatusFilter(statuses);
    html += `<button class="pulls-filter-btn${pullsDirectFilter ? " active" : ""}" onclick="togglePullsDirectFilter()">Assigned to me</button>`;
    html += `</div>`;
    let filtered = filterGroupsByAuthor(pulls.reviews, pullsAuthorFilter);
    filtered = filterGroupsByStatus(filtered, pullsStatusFilter);
    if (pullsDirectFilter) filtered = filterGroupsByDirect(filtered);
    const filteredCount = filtered.reduce((n, g) => n + g.prs.length, 0);
    if (filteredCount === 0) {
      html += `<div class="empty-state">No review requests</div>`;
    } else {
      html += filtered.map((g) => renderPullGroup(g, true, "reviews")).join("");
    }
  }

  queue.innerHTML = html;
}

const STATUS_LABELS = {
  queue_failed: "queue failed",
};

function renderAuthorFilter(authors) {
  const options = authors
    .map((a) => `<option value="${escapeHtml(a)}"${a === pullsAuthorFilter ? " selected" : ""}>${escapeHtml(a)}</option>`)
    .join("");
  return `<select class="pulls-filter-select" onchange="setPullsAuthorFilter(this.value)">
    <option value="">All authors</option>
    ${options}
  </select>`;
}

function renderStatusFilter(statuses) {
  const options = statuses
    .map((s) => `<option value="${escapeHtml(s)}"${s === pullsStatusFilter ? " selected" : ""}>${escapeHtml(STATUS_LABELS[s] || s)}</option>`)
    .join("");
  return `<select class="pulls-filter-select" onchange="setPullsStatusFilter(this.value)">
    <option value="">All statuses</option>
    ${options}
  </select>`;
}

function setPullsStatusFilter(status) {
  pullsStatusFilter = status;
  renderPulls();
}

function setPullsAuthorFilter(author) {
  pullsAuthorFilter = author;
  renderPulls();
}

function togglePullsDirectFilter() {
  pullsDirectFilter = !pullsDirectFilter;
  renderPulls();
}

function switchPullsTab(tab) {
  pullsSubTab = tab;
  pullsAuthorFilter = "";
  pullsStatusFilter = "";
  pullsDirectFilter = true;
  renderPulls();
}

function togglePullRepo(key, header) {
  if (collapsedPullRepos.has(key)) {
    collapsedPullRepos.delete(key);
  } else {
    collapsedPullRepos.add(key);
  }
  toggleGroup(header);
}

// "more" link (merged tab only) → this repo's merged PRs for the author on GitHub.
function repoMergedLink(group) {
  const pr = group.prs[0];
  if (!pr || !pr.repoWithOwner || !pr.author) return "";
  const q = encodeURIComponent(`is:pr is:merged author:${pr.author}`);
  const url = `https://github.com/${pr.repoWithOwner}/pulls?q=${q}`;
  return `<a class="pulls-repo-more" href="${escapeHtml(url)}" title="View all merged PRs for this repo on GitHub" onclick="event.stopPropagation(); openExternal('${escapeHtml(url)}'); return false;">more →</a>`;
}

function renderPullGroup(group, showAuthor, subTab) {
  const key = `${subTab}:${group.repo}`;
  const isCollapsed = collapsedPullRepos.has(key);
  return `<div class="pulls-repo-group">
    <div class="pulls-repo-group-header" data-repo-key="${escapeHtml(key)}" onclick="togglePullRepo('${escapeHtml(key)}', this)">
      <span class="chevron${isCollapsed ? " collapsed" : ""}">▼</span>
      ${escapeHtml(group.repo)}
      <span class="pulls-repo-count">(${group.prs.length})</span>
      ${subTab === "merged" ? repoMergedLink(group) : ""}
    </div>
    <div class="group-items${isCollapsed ? " collapsed" : ""}">
      <table class="pulls-table">
        <tbody>${group.prs.map((pr) => renderPullRow(pr, showAuthor, group.repo, subTab)).join("")}</tbody>
      </table>
    </div>
  </div>`;
}

function ciCell(ci) {
  if (ci === "failing") return '<span class="ci-badge ci-failing">\u2717</span>';
  if (ci === "passing") return '<span class="ci-badge ci-passing">\u2713</span>';
  if (ci === "running") return '<span class="ci-badge ci-running">\u25CB</span>';
  return '<span class="ci-badge ci-none">\u2014</span>';
}

const DEPLOY_LABELS = {
  deployed: "deployed",
  errored: "errored",
  in_progress: "in progress",
  none: "not deployed",
  unknown: "unknown (deploy-status API unreachable?)",
};

function deployDot(letter, envLabel, state) {
  const s = state || "unknown";
  const label = DEPLOY_LABELS[s];
  return `<span class="deploy-dot deploy-${s}" title="${envLabel}: ${label}">${letter}</span>`;
}

// Mirror of shouldShowDeployDots in src/tabs/pulls.js (kept in lockstep — that copy is the
// unit-tested source of truth; this browser script has no build step to import it).
// No dots when the feature is unconfigured / enrichment hasn't run yet / the sha 404'd
// (deploy is null). An all-"none" or all-"unknown" result hides for untracked repos —
// both mean no real deployment state has been observed. Tracked repos show in both cases
// (waiting to deploy, or API temporarily unreachable).
function shouldShowDeployDots(deploy, repoTracked) {
  if (!deploy) return false;
  if (!repoTracked && !Object.values(deploy).some((v) => v !== "none" && v !== "unknown")) {
    return false;
  }
  return true;
}

function deployDots(deploy, repoTracked) {
  if (!shouldShowDeployDots(deploy, repoTracked)) return "";
  return `<span class="deploy-dots">${
    deployDot("P", "Production", deploy.prod)
  }${deployDot("S", "Staging", deploy.stage)}${deployDot("D", "Demo", deploy.demo)}</span>`;
}

function renderPullRow(pr, showAuthor, repo, subTab) {
  const atLimit = isAtWorkspaceLimit();
  const actionBtn = atLimit
    ? `<button class="agent-btn" title="Workspace limit reached" disabled>${claudeIcon()}</button>`
    : `<button class="agent-btn" title="Actions" data-pr-url="${escapeHtml(pr.url)}" onclick="event.stopPropagation(); openActionDrawerFromBtn(this)">${claudeIcon()}</button>`;
  const statusCells = subTab === "merged"
    ? `<td class="pull-deploy">${deployDots(pr.deploy, pr.repoTracked)}</td>`
    : `<td class="pull-status"><span class="pull-badge status-${pr.status}">${STATUS_LABELS[pr.status] || pr.status}</span></td>
    <td class="pull-ci">${ciCell(pr.ci)}</td>`;
  return `<tr class="pull-row" onclick="openExternal('${escapeHtml(pr.url)}')">
    <td class="pull-title"><span class="pull-number">#${pr.number}</span> <span class="pull-title-text">${escapeHtml(pr.title)}</span></td>
    ${showAuthor ? `<td class="pull-author">${escapeHtml(pr.author)}</td>` : ""}
    ${statusCells}
    <td class="row-action">${actionBtn}</td>
  </tr>`;
}

async function openExternal(url) {
  await apiPost("open-external", { url });
}
