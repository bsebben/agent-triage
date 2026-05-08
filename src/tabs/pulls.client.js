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
  const order = ["open", "draft", "comments", "approved"];
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
  const pulls = state.pulls || { mine: [], reviews: [] };
  const mineCount = pulls.mine.reduce((n, g) => n + g.prs.length, 0);
  const reviewCount = pulls.reviews.reduce((n, g) => n + g.prs.length, 0);

  const mineActive = pullsSubTab === "mine" ? " active" : "";
  const reviewsActive = pullsSubTab === "reviews" ? " active" : "";

  let html = `<div class="sub-tabs">
    <button class="sub-tab${mineActive}" onclick="switchPullsTab('mine')">Mine (${mineCount})</button>
    <button class="sub-tab${reviewsActive}" onclick="switchPullsTab('reviews')">Reviews (${reviewCount})</button>
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
    .map((s) => `<option value="${escapeHtml(s)}"${s === pullsStatusFilter ? " selected" : ""}>${escapeHtml(s)}</option>`)
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

function renderPullGroup(group, showAuthor, subTab) {
  const key = `${subTab}:${group.repo}`;
  const isCollapsed = collapsedPullRepos.has(key);
  return `<div class="pulls-repo-group">
    <div class="pulls-repo-group-header" data-repo-key="${escapeHtml(key)}" onclick="togglePullRepo('${escapeHtml(key)}', this)">
      <span class="chevron${isCollapsed ? " collapsed" : ""}">▼</span>
      ${escapeHtml(group.repo)}
      <span class="pulls-repo-count">(${group.prs.length})</span>
    </div>
    <div class="group-items${isCollapsed ? " collapsed" : ""}">
      <table class="pulls-table">
        <thead><tr><th>PR</th>${showAuthor ? "<th>Author</th>" : ""}<th>Status</th><th>CI</th><th></th></tr></thead>
        <tbody>${group.prs.map((pr) => renderPullRow(pr, showAuthor, group.repo)).join("")}</tbody>
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

function renderPullRow(pr, showAuthor, repo) {
  return `<tr class="pull-row" onclick="openExternal('${escapeHtml(pr.url)}')">
    <td class="pull-title"><span class="pull-number">#${pr.number}</span> ${escapeHtml(pr.title)}</td>
    ${showAuthor ? `<td class="pull-author">${escapeHtml(pr.author)}</td>` : ""}
    <td class="pull-status"><span class="pull-badge status-${pr.status}">${pr.status}</span></td>
    <td class="pull-ci">${ciCell(pr.ci)}</td>
    <td class="row-action"><button class="agent-btn" title="Actions" data-pr-url="${escapeHtml(pr.url)}" onclick="event.stopPropagation(); openActionDrawerFromBtn(this)">${claudeIcon()}</button></td>
  </tr>`;
}

async function openExternal(url) {
  await apiPost("open-external", { url });
}
