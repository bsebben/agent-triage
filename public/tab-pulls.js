// public/tab-pulls.js

let pullsSubTab = "mine";
let pullsAuthorFilter = "";
let pullsStatusFilter = "";

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

function renderPulls() {
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
      html += filtered.map((g) => renderPullGroup(g, false)).join("");
    }
  } else {
    const authors = collectAuthors(pulls.reviews);
    const statuses = collectStatuses(pulls.reviews);
    const hasFilters = authors.length > 1 || statuses.length > 1;
    if (hasFilters) {
      html += `<div class="pulls-filter-bar">`;
      if (authors.length > 1) html += renderAuthorFilter(authors);
      if (statuses.length > 1) html += renderStatusFilter(statuses);
      html += `</div>`;
    }
    let filtered = filterGroupsByAuthor(pulls.reviews, pullsAuthorFilter);
    filtered = filterGroupsByStatus(filtered, pullsStatusFilter);
    const filteredCount = filtered.reduce((n, g) => n + g.prs.length, 0);
    if (filteredCount === 0) {
      html += `<div class="empty-state">No review requests</div>`;
    } else {
      html += filtered.map((g) => renderPullGroup(g, true)).join("");
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

function switchPullsTab(tab) {
  pullsSubTab = tab;
  pullsAuthorFilter = "";
  pullsStatusFilter = "";
  renderPulls();
}

function renderPullGroup(group, showAuthor) {
  return `<div class="pulls-repo-group">
    <div class="pulls-repo-name">${escapeHtml(group.repo)}</div>
    <table class="pulls-table">
      <thead><tr><th>PR</th>${showAuthor ? "<th>Author</th>" : ""}<th>Status</th><th></th></tr></thead>
      <tbody>${group.prs.map((pr) => renderPullRow(pr, showAuthor, group.repo)).join("")}</tbody>
    </table>
  </div>`;
}

function ciIndicator(ci) {
  if (ci === "failing") return ' <span class="ci-x">\u2717</span>';
  if (ci === "passing") return ' <span class="ci-check">\u2713</span>';
  return "";
}

function renderPullRow(pr, showAuthor, repo) {
  const prompt = `Give me a quick status update on this PR: ${pr.url}\n\nDon't review or analyze the code — just summarize the current state (open/draft/merged, CI, review status, recent activity, my role on it).\n\nThen ask what I'd like to do next. Suggest options based on my role: if I'm the author, I might want to update the description, push fixes, address review comments, or mark ready for review; if I'm a reviewer, I might want to leave comments or run a review skill from the review-artisan plugin (e.g. \`/review-artisan:polish\` for a guided review). Don't pick for me — list a few likely actions and wait.`;
  return `<tr class="pull-row" onclick="openExternal('${escapeHtml(pr.url)}')">
    <td class="pull-title"><span class="pull-number">#${pr.number}</span> ${escapeHtml(pr.title)}</td>
    ${showAuthor ? `<td class="pull-author">${escapeHtml(pr.author)}</td>` : ""}
    <td><span class="pull-badge status-${pr.status}">${pr.status}${ciIndicator(pr.ci)}</span></td>
    <td class="row-action"><button class="agent-btn" title="Open in new agent workspace" data-prompt="${escapeHtml(prompt)}" data-repo="${escapeHtml(repo)}" onclick="event.stopPropagation(); openInAgentFromBtn(this)">${claudeIcon()}</button></td>
  </tr>`;
}

async function openExternal(url) {
  await apiPost("open-external", { url });
}

async function openInAgent(prompt, repo) {
  await apiPost("agent-workspace", { prompt, repo });
}

function openInAgentFromBtn(btn) {
  openInAgent(btn.dataset.prompt, btn.dataset.repo || undefined);
}
