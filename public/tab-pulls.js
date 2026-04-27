// public/tab-pulls.js

let pullsSubTab = "mine";
let pullsAuthorFilter = "";

function collectAuthors(groups) {
  const authors = new Set();
  for (const g of groups) {
    for (const pr of g.prs) {
      if (pr.author) authors.add(pr.author);
    }
  }
  return [...authors].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function filterGroupsByAuthor(groups, author) {
  if (!author) return groups;
  return groups
    .map((g) => ({ ...g, prs: g.prs.filter((pr) => pr.author === author) }))
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
    if (mineCount === 0) {
      html += `<div class="empty-state">No open pull requests</div>`;
    } else {
      html += pulls.mine.map((g) => renderPullGroup(g, false)).join("");
    }
  } else {
    const authors = collectAuthors(pulls.reviews);
    if (authors.length > 1) {
      html += renderAuthorFilter(authors);
    }
    const filtered = filterGroupsByAuthor(pulls.reviews, pullsAuthorFilter);
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
  return `<div class="pulls-filter-bar">
    <select class="pulls-filter-select" onchange="setPullsAuthorFilter(this.value)">
      <option value="">All authors</option>
      ${options}
    </select>
  </div>`;
}

function setPullsAuthorFilter(author) {
  pullsAuthorFilter = author;
  renderPulls();
}

function switchPullsTab(tab) {
  pullsSubTab = tab;
  renderPulls();
}

function renderPullGroup(group, showAuthor) {
  return `<div class="pulls-repo-group">
    <div class="pulls-repo-name">${escapeHtml(group.repo)}</div>
    <table class="pulls-table">
      <thead><tr><th>PR</th>${showAuthor ? "<th>Author</th>" : ""}<th>Status</th></tr></thead>
      <tbody>${group.prs.map((pr) => renderPullRow(pr, showAuthor)).join("")}</tbody>
    </table>
  </div>`;
}

function ciIndicator(ci) {
  if (ci === "failing") return ' <span class="ci-x">\u2717</span>';
  if (ci === "passing") return ' <span class="ci-check">\u2713</span>';
  return "";
}

function renderPullRow(pr, showAuthor) {
  return `<tr class="pull-row" onclick="openExternal('${escapeHtml(pr.url)}')">
    <td class="pull-title"><span class="pull-number">#${pr.number}</span> ${escapeHtml(pr.title)}</td>
    ${showAuthor ? `<td class="pull-author">${escapeHtml(pr.author)}</td>` : ""}
    <td><span class="pull-badge status-${pr.status}">${pr.status}${ciIndicator(pr.ci)}</span></td>
  </tr>`;
}

async function openExternal(url) {
  await apiPost("open-external", { url });
}
