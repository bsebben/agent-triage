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

function prNeedsAction(pr) {
  return pr.status === "approved" || pr.status === "comments"
    || pr.status === "queue_failed" || pr.ci === "failing";
}

function countUrls(groups, predicate) {
  const urls = new Set();
  for (const g of groups || []) {
    for (const pr of g.prs) if (predicate(pr)) urls.add(pr.url);
  }
  return urls.size;
}

// The nav badge: up to two pills, your own PRs needing action then review requests
// addressed to you personally. A pill is omitted entirely when its count is zero.
//
// Both counts come from searches that fit inside the fetch row ceiling, so both are
// exact. The team-inclusive `reviews` search is deliberately excluded: it matches
// several hundred PRs against a 100-row ceiling, so any count drawn from it is
// silently truncated, and it is dominated by PRs a teammate will pick up instead.
//
// GitHub drops a PR from the direct-review search once a review is submitted, and
// re-adds it if that review is later dismissed, so that pill tracks what is genuinely
// outstanding without extra filtering.
function pullsBadge(pulls) {
  const mine = countUrls(pulls.mine, prNeedsAction);
  const reviews = countUrls(pulls.assigned, () => true);
  const parts = [];

  if (mine) {
    parts.push({
      text: String(mine),
      variant: "mine",
      title: mine === 1 ? "1 of your PRs needs action" : `${mine} of your PRs need action`,
    });
  }
  if (reviews) {
    parts.push({
      text: String(reviews),
      variant: "reviews",
      title: reviews === 1
        ? "1 PR where you're assigned directly as a reviewer"
        : `${reviews} PRs where you're assigned directly as a reviewer`,
    });
  }

  return {
    total: mine + reviews,
    title: parts.map((part) => part.title).join(" \u00b7 "),
    parts,
  };
}

function renderPulls() {
  const pullsCfg = state.tabStatus?.pulls || appConfig.pulls || {};
  if (!pullsCfg.available) {
    const hint = escapeHtml(pullsCfg.hint || "GitHub CLI (gh) not found.");
    queue.innerHTML = `<div class="empty-state">${hint}</div>`;
    return;
  }
  const pulls = state.pulls || { mine: [], reviews: [], merged: [], assigned: [] };
  // "Assigned to me" is its own server-side search (requests addressed to me personally,
  // complete), not a filter over the team-inclusive list — so the toggle picks a bucket.
  const source = pullsDirectFilter ? (pulls.assigned || []) : pulls.reviews;
  const mineGroups = pulls.mine;
  const mineCount = mineGroups.reduce((n, g) => n + g.prs.length, 0);
  const reviewCount = source.reduce((n, g) => n + g.prs.length, 0);
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
    const statuses = collectStatuses(mineGroups);
    if (statuses.length > 1) {
      html += `<div class="pulls-filter-bar">${renderStatusFilter(statuses)}</div>`;
    }
    const filtered = filterGroupsByStatus(mineGroups, pullsStatusFilter);
    const filteredCount = filtered.reduce((n, g) => n + g.prs.length, 0);
    if (filteredCount === 0) {
      html += `<div class="empty-state">No open pull requests</div>`;
    } else {
      html += filtered.map((g) => renderPullGroup(g, false, "mine", pullsCfg.slaDays)).join("");
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
    const authors = collectAuthors(source);
    const statuses = collectStatuses(source);
    // The toggle swaps which bucket feeds the list, so the options change with it. Drop a
    // selected author/status that the new bucket doesn't contain — otherwise the dropdown
    // renders without it and the user is stuck on an empty list they can't clear.
    if (pullsAuthorFilter && !authors.includes(pullsAuthorFilter)) pullsAuthorFilter = "";
    if (pullsStatusFilter && !statuses.includes(pullsStatusFilter)) pullsStatusFilter = "";
    html += `<div class="pulls-filter-bar">`;
    if (authors.length > 1) html += renderAuthorFilter(authors);
    if (statuses.length > 1) html += renderStatusFilter(statuses);
    html += `<button class="pulls-filter-btn${pullsDirectFilter ? " active" : ""}" onclick="togglePullsDirectFilter()">Assigned to me</button>`;
    html += `</div>`;
    let filtered = filterGroupsByAuthor(source, pullsAuthorFilter);
    filtered = filterGroupsByStatus(filtered, pullsStatusFilter);
    const filteredCount = filtered.reduce((n, g) => n + g.prs.length, 0);
    if (filteredCount === 0) {
      html += `<div class="empty-state">No review requests</div>`;
    } else {
      html += filtered.map((g) => renderPullGroup(g, true, "reviews", pullsCfg.slaDays)).join("");
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

// "more" link (merged tab only) → this repo's merged PRs for the viewer on GitHub.
// Searches for both authored and assigned PRs: merged groups include PRs the viewer
// authored as well as those assigned to the viewer that someone else created.
function repoMergedLink(group) {
  const pr = group.prs[0];
  if (!pr || !pr.repoWithOwner) return "";
  const q = encodeURIComponent("is:pr is:merged (author:@me OR assignee:@me)");
  const url = `https://github.com/${pr.repoWithOwner}/pulls?q=${q}`;
  return `<a class="pulls-repo-more" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="View all merged PRs for this repo on GitHub" onclick="openExternalClick(event, '${escapeHtml(url)}')">more →</a>`;
}

function renderPullGroup(group, showAuthor, subTab, slaDays) {
  const key = `${subTab}:${group.repo}`;
  const isCollapsed = collapsedPullRepos.has(key);
  return `<div class="pulls-repo-group">
    <div class="pulls-repo-group-header" data-repo-key="${escapeHtml(key)}" onclick="togglePullRepo('${escapeHtml(key)}', this)">
      <span class="chevron${isCollapsed ? " collapsed" : ""}">▼</span>
      ${escapeHtml(group.repo)}
      <span class="pulls-repo-count">(${group.prs.length})</span>
      ${subTab === "merged" ? repoMergedLink(group) : ""}
    </div>
    <div class="group-items pull-group-items${isCollapsed ? " collapsed" : ""}">
      <table class="pulls-table">
        <tbody>${group.prs.map((pr) => renderPullRow(pr, showAuthor, group.repo, subTab, slaDays)).join("")}</tbody>
      </table>
    </div>
  </div>`;
}

// Mirror of slaLevel in src/tabs/pulls.js (kept in lockstep — same rationale as
// shouldShowDeployDots above: this browser script has no build step to import it).
// Drafts and PRs with no slaDays configured are never colored.
function slaLevel(pr, slaDays, now = Date.now()) {
  if (slaDays == null || pr.isDraft || pr.mergedAt) return null;
  const since = pr.readyForReviewAt || pr.createdAt;
  if (!since) return null;
  if (slaDays <= 0) return "red";
  const pct = (now - new Date(since).getTime()) / (slaDays * 24 * 60 * 60 * 1000);
  if (pct >= 1) return "red";
  if (pct >= 0.75) return "orange";
  if (pct >= 0.5) return "yellow";
  return null;
}

function slaTooltip(pr, slaDays, now = Date.now()) {
  const since = pr.readyForReviewAt || pr.createdAt;
  if (!since) return "";
  const ageDays = (now - new Date(since).getTime()) / (24 * 60 * 60 * 1000);
  if (!slaDays || slaDays <= 0) return `${ageDays.toFixed(1)}d old`;
  const pct = Math.round((ageDays / slaDays) * 100);
  return `${ageDays.toFixed(1)}d old — ${pct}% of ${slaDays}d SLA`;
}

function ciPill(state, title, icon) {
  return `<span class="ci-badge pull-ci-pill ci-${state}" title="${title}" aria-label="${title}"><span class="pull-ci-label">CI</span>${icon}</span>`;
}

function ciCell(ci) {
  if (ci === "failing") return ciPill("failing", "CI failing", iconBlocked());
  if (ci === "passing") return ciPill("passing", "CI passing", iconCheckCircle());
  if (ci === "running") return ciPill("running", "CI running", iconHalfCircle());
  return ciPill("none", "No CI", iconDash());
}

// Resolved at render time, not load time: pull-icons.js is a separate script.
function statusIcon(status) {
  switch (status) {
    case "open": return iconPullRequest();
    case "draft": return iconPullDraft();
    case "comments": return iconComment();
    case "blocked": return iconCommentBlocked();
    case "approved": return iconCheckCircle();
    case "queued":
    case "queue_failed": return iconMergeQueue();
    default: return "";
  }
}

// pr.status stays "comments" so filters, sorting, and the nav badge keep working.
function isBlocked(pr) {
  const r = pr.reviewers;
  return pr.status === "comments" && !!r && (r.human.blocked.length > 0 || r.bot.blocked.length > 0);
}

function statusCell(pr) {
  const key = isBlocked(pr) ? "blocked" : pr.status;
  const label = key === "blocked" ? "changes requested" : (STATUS_LABELS[key] || key);
  const body = statusIcon(key) || escapeHtml(label);
  return `<td class="pull-status"><span class="pull-status-icon status-${key}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${body}</span></td>`;
}

const DEPLOY_LABELS = {
  deployed: "deployed",
  errored: "errored",
  in_progress: "in progress",
  none: "not deployed",
  unknown: "unknown (deploy-status API unreachable?)",
};

// Shared by every real <a href> link that opens externally (deploy dots, PR/ticket
// titles, the tickets tab's parent-key chip, action-drawer links): a plain left-click
// routes through openExternal() so the link lands in a separate Chrome window rather
// than the dashboard's own. Modifier-clicks keep the browser's native behaviour —
// preventDefault would swallow cmd/ctrl-click's background tab and route it through the
// Chrome-only openExternal path instead. stopPropagation keeps the click from also
// firing a parent row's own click handler.
function openExternalClick(event, url) {
  event.stopPropagation();
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  openExternal(url);
}

function deployDot(letter, envLabel, state, url) {
  const s = state || "unknown";
  const label = DEPLOY_LABELS[s];
  const title = `${envLabel}: ${label}`;
  if (url) {
    return `<a class="deploy-dot deploy-${s}" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="${title} — view Buildkite build" onclick="openExternalClick(event, '${escapeHtml(url)}')">${letter}</a>`;
  }
  return `<span class="deploy-dot deploy-${s}" title="${title}">${letter}</span>`;
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

function deployDots(deploy, repoTracked, links) {
  if (!shouldShowDeployDots(deploy, repoTracked)) return "";
  return `<span class="deploy-dots">${
    deployDot("P", "Production", deploy.prod, links?.prod)
  }${deployDot("S", "Staging", deploy.stage, links?.stage)}${deployDot("D", "Demo", deploy.demo, links?.demo)}</span>`;
}

// Mirror of formatThreadCount in src/tabs/pulls.js (kept in lockstep — that copy is the
// unit-tested source of truth; this browser script has no build step to import it).
function formatThreadCount(count, truncated) {
  if (count > 9) return "9+";
  return truncated ? `${count}+` : String(count);
}

// `unknownThreads`: only the first few threads were fetched and none of them were unresolved,
// so an unresolved one may still be hiding past the cutoff. A muted 0+ says so instead of
// showing nothing.
function reviewerGroup(kind, group, truncated, unknownThreads = false) {
  const indicators = [];
  if (group.unresolvedThreads > 0) {
    const text = formatThreadCount(group.unresolvedThreads, truncated);
    const n = group.unresolvedThreads;
    const title = `${text.endsWith("+") ? "At least " : ""}${n} unresolved thread${n === 1 ? "" : "s"}`;
    indicators.push(`<span class="pull-rev-ind pull-rev-comments" title="${escapeHtml(title)}">${iconComment()}${text}</span>`);
  } else if (unknownThreads) {
    const title = "No unresolved threads among the first 10; there may be more";
    indicators.push(`<span class="pull-rev-ind pull-rev-unknown" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${iconComment()}0+</span>`);
  }
  if (group.approved.length > 0) {
    const title = `Approved by ${group.approved.join(", ")}`;
    indicators.push(`<span class="pull-rev-ind pull-rev-approved" title="${escapeHtml(title)}">${iconCheck()}</span>`);
  }
  if (group.blocked.length > 0) {
    const title = `Changes requested by ${group.blocked.join(", ")}`;
    indicators.push(`<span class="pull-rev-ind pull-rev-blocked" title="${escapeHtml(title)}">${iconBlocked()}</span>`);
  }
  if (indicators.length === 0) return "";
  const lead = kind === "bot" ? iconBot() : iconHuman();
  return `<span class="pull-rev-group pull-rev-${kind}" title="${kind === "bot" ? "Bots" : "People"}">${lead}${indicators.join("")}</span>`;
}

function reviewerGroupsHtml(reviewers) {
  if (!reviewers) return "";
  const t = reviewers.threadsTruncated;
  const unknownThreads = t && reviewers.human.unresolvedThreads === 0 && reviewers.bot.unresolvedThreads === 0;
  return reviewerGroup("human", reviewers.human, t, unknownThreads) + reviewerGroup("bot", reviewers.bot, t);
}

// One cell so the narrow layout keeps both on the bottom row without widening the action column.
function reviewsCell(pr) {
  return `<td class="pull-reviews"><span class="pull-pills">${reviewerGroupsHtml(pr.reviewers)}${ciCell(pr.ci)}</span></td>`;
}

function renderPullRow(pr, showAuthor, repo, subTab, slaDays) {
  const atLimit = isAtWorkspaceLimit();
  const actionBtn = atLimit
    ? `<button class="agent-btn" title="Workspace limit reached" disabled>${claudeIcon()}</button>`
    : `<button class="agent-btn" title="Actions" data-pr-url="${escapeHtml(pr.url)}" onclick="event.stopPropagation(); openActionDrawerFromBtn(this)">${claudeIcon()}</button>`;
  const leadingCell = subTab === "merged" ? "" : statusCell(pr);
  const statusCells = subTab === "merged"
    ? `<td class="pull-deploy">${deployDots(pr.deploy, pr.repoTracked, pr.deployLinks)}</td>`
    : `<td class="pull-num">#${pr.number}</td>
    ${reviewsCell(pr)}`;
  const level = slaLevel(pr, slaDays);
  const rowClass = level ? ` pull-row-sla-${level}` : "";
  const rowTitle = level ? ` title="${escapeHtml(slaTooltip(pr, slaDays))}"` : "";
  return `<tr class="pull-row${rowClass}"${rowTitle} onclick="openExternal('${escapeHtml(pr.url)}')">
    ${leadingCell}
    <td class="pull-title"><a class="pull-title-link" href="${escapeHtml(pr.url)}" target="_blank" rel="noopener" onclick="openExternalClick(event, '${escapeHtml(pr.url)}')"><span class="pull-number">#${pr.number}</span> <span class="pull-title-text">${escapeHtml(pr.title)}</span></a></td>
    ${showAuthor ? `<td class="pull-author">${escapeHtml(pr.author)}</td>` : ""}
    ${statusCells}
    <td class="row-action">${actionBtn}</td>
  </tr>`;
}

async function openExternal(url) {
  const res = await apiPost("open-external", { url }).catch(() => null);
  // The server drives Google Chrome specifically. If Chrome isn't installed/running or
  // Automation permission was never granted, open the URL in whatever browser the
  // dashboard is running in rather than leaving the click as a silent no-op.
  if (res && res.fallback) window.open(url, "_blank", "noopener");
}
