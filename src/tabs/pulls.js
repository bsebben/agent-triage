// src/tabs/pulls.js — Tab module: GitHub PR monitoring
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { startPolling } from "../utils.js";

const execFileAsync = promisify(execFile);

const ghAvailable = (() => {
  try { execFileSync("which", ["gh"], { encoding: "utf-8" }); return true; }
  catch { return false; }
})();

export const defaults = {
  enabled: true,
  orgFilter: null,
};

const PR_QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        isDraft
        createdAt
        headRefName
        reviewDecision
        author { login }
        repository { nameWithOwner }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 50) {
                  nodes {
                    ... on CheckRun { conclusion status }
                    ... on StatusContext { state }
                  }
                }
              }
            }
          }
        }
        latestReviews(first: 10) {
          nodes { state }
        }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login }
            }
          }
        }
      }
    }
  }
}`;

let cfg;
let currentUser = "";
let data = { mine: [], reviews: [] };

async function init(tabConfig, onUpdate) {
  cfg = { ...defaults, ...tabConfig };

  tab.enabled = cfg.enabled;
  tab.available = ghAvailable;
  tab.hint = ghAvailable ? null : "GitHub CLI (gh) not found. Install it with: brew install gh";

  console.log(`Config: pulls ${cfg.enabled ? "enabled" : "disabled"}${ghAvailable ? "" : " (gh CLI not found)"}`);
  if (!cfg.enabled || !ghAvailable) return;

  try {
    const { stdout } = await execFileAsync("gh", ["api", "user", "--jq", ".login"], { timeout: 10000 });
    currentUser = stdout.trim();
  } catch { /* non-fatal; directReview will always be false */ }

  await startPolling("Pulls", poll, onUpdate, 2 * 60 * 1000);
}

async function poll() {
  try {
    const [mine, reviews] = await Promise.all([
      searchPrs("is:pr is:open author:@me", () => true, prPriority),
      searchPrs("is:pr is:open review-requested:@me draft:false", (pr) => !pr.isDraft, reviewPriority),
    ]);
    data = { mine, reviews };
  } catch (err) {
    console.error("PR fetch error:", err.message);
  }
}

async function searchPrs(query, filter, sortFn) {
  console.log(`[pulls] polling: ${query}`);
  const { stdout } = await execFileAsync(
    "gh", ["api", "graphql", "-F", `query=${PR_QUERY}`, "-F", `q=${query}`],
    { timeout: 30000 },
  );
  const nodes = JSON.parse(stdout).data.search.nodes;
  console.log(`[pulls] got ${nodes.length} results`);

  const orgFilter = cfg.orgFilter;
  const byRepo = new Map();

  for (const node of nodes) {
    const repo = node.repository.nameWithOwner;
    if (orgFilter && !orgFilter.includes(repo.split("/")[0])) continue;
    const pr = summarize(node);
    if (!filter(pr)) continue;
    const repoName = repo.split("/")[1];
    if (!byRepo.has(repoName)) byRepo.set(repoName, []);
    byRepo.get(repoName).push(pr);
  }

  const groups = [];
  for (const [repo, prs] of byRepo) {
    prs.sort((a, b) => sortFn(a) - sortFn(b));
    groups.push({ repo, prs });
  }
  groups.sort((a, b) => b.prs.length - a.prs.length);
  return groups;
}

function summarize(node) {
  const checks = node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes || [];
  return {
    number: node.number,
    title: node.title,
    branch: node.headRefName,
    url: node.url,
    createdAt: node.createdAt,
    isDraft: node.isDraft,
    author: node.author?.login || "",
    status: prStatus(node),
    ci: ciStatus(checks),
    directReview: (node.reviewRequests?.nodes || []).some(
      (r) => r.requestedReviewer?.__typename === "User" && r.requestedReviewer?.login === currentUser
    ),
  };
}

const PRIORITY = { approved: 0, comments: 1, open: 3, draft: 4 };
function prPriority(pr) {
  if (pr.ci === "failing" && pr.status !== "approved" && pr.status !== "comments") return 2;
  return PRIORITY[pr.status] ?? 5;
}

const CI_ORDER = { passing: 0, running: 1, none: 2, failing: 3 };
function reviewPriority(pr) { return CI_ORDER[pr.ci] ?? 2; }

function prStatus(node) {
  if (node.isDraft) return "draft";
  if (node.reviewDecision === "APPROVED") return "approved";
  if ((node.latestReviews?.nodes || []).length > 0) return "comments";
  return "open";
}

function ciStatus(checks) {
  if (checks.length === 0) return "none";
  const meaningful = checks.filter((c) =>
    c.conclusion !== "SKIPPED" && c.conclusion !== "NEUTRAL" && c.state !== "EXPECTED"
  );
  if (meaningful.length === 0) return "none";
  const hasIncomplete = meaningful.some((c) => c.status === "IN_PROGRESS" || c.status === "QUEUED" || c.state === "PENDING");
  if (hasIncomplete) return "running";
  const hasFailing = meaningful.some((c) =>
    c.conclusion === "FAILURE" || c.conclusion === "TIMED_OUT" || c.state === "FAILURE" || c.state === "ERROR"
  );
  if (hasFailing) return "failing";
  return "passing";
}

const tab = {
  enabled: false,
  available: false,
  hint: null,
  get data() { return data; },
  init,
};

export default tab;
