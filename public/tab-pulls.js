// public/tab-pulls.js

let pullsSubTab = "mine";

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
    if (reviewCount === 0) {
      html += `<div class="empty-state">No review requests</div>`;
    } else {
      html += pulls.reviews.map((g) => renderPullGroup(g, true)).join("");
    }
  }

  queue.innerHTML = html;
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
