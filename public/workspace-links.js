// public/workspace-links.js

const TICKET_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const PR_NUMBER_PATTERN = /(?:^|[^\w&])#(\d+)\b/g;

function matchAll(pattern, text, group = 0) {
  return [...text.matchAll(pattern)].map((m) => m[group]);
}

function pathBasename(path) {
  return path ? path.split("/").filter(Boolean).pop() : null;
}

function indexTickets(ticketGroups) {
  const byKey = new Map();
  for (const group of ticketGroups || []) {
    for (const t of group.tickets) byKey.set(t.key, t);
  }
  return byKey;
}

function indexPrs(pulls) {
  const byNumber = new Map();
  for (const list of [pulls?.mine, pulls?.reviews, pulls?.merged, pulls?.assigned]) {
    for (const group of list || []) {
      for (const pr of group.prs) {
        const known = byNumber.get(pr.number) || [];
        if (!known.some((k) => k.pr.url === pr.url)) known.push({ pr, repo: group.repo });
        byNumber.set(pr.number, known);
      }
    }
  }
  return byNumber;
}

// A bare `#N` exists in every repo, so a number only resolves when it can be pinned to one:
// the workspace's own repo wins, otherwise it has to be unambiguous across the loaded PRs.
function resolvePr(candidates, workspaceRepo) {
  if (!candidates) return null;
  const inWorkspaceRepo = candidates.filter((c) => c.repo === workspaceRepo);
  if (inWorkspaceRepo.length === 1) return inWorkspaceRepo[0].pr;
  return candidates.length === 1 ? candidates[0].pr : null;
}

// Only ids that resolve to an item loaded in the Pulls or Tickets tab become links, so lookalikes
// (UTF-8, a stray #1) are ignored and no Jira hostname has to be configured.
function findWorkspaceLinks(item, { pulls, tickets } = {}) {
  const text = [item.workspaceTitle, item.gitBranch].filter(Boolean).join(" ");
  if (!text) return [];

  const links = [];
  const seen = new Set();
  const add = (kind, label, url, title) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ kind, label, url, title });
  };

  const ticketsByKey = indexTickets(tickets);
  for (const key of matchAll(TICKET_KEY_PATTERN, text)) {
    const ticket = ticketsByKey.get(key);
    if (ticket) add("ticket", ticket.key, ticket.url, ticket.summary);
  }

  const prsByNumber = indexPrs(pulls);
  const workspaceRepo = pathBasename(item.repoRoot);
  for (const num of matchAll(PR_NUMBER_PATTERN, text, 1)) {
    const pr = resolvePr(prsByNumber.get(Number(num)), workspaceRepo);
    if (pr) add("pr", `#${pr.number}`, pr.url, pr.title);
  }

  return links;
}

function renderWorkspaceLinks(links) {
  if (!links.length) return "";
  const pills = links.map((l) =>
    `<a class="card-link card-link-${l.kind}" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" title="${escapeHtml(l.title || l.url)}" onclick="openExternalClick(event, '${escapeHtml(l.url)}')">${escapeHtml(l.label)}</a>`
  ).join("");
  return `<span class="card-links">${pills}</span>`;
}
