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
  // Enrich merged PRs with deploy-status dots from an external deploy-status API.
  // Off unless a base URL is configured (deployStatusUrl or DEPLOY_STATUS_API_URL).
  deployStatus: true,
  deployStatusUrl: null,
};

// Base URL of the deploy-status API, resolved at init() from config or the
// DEPLOY_STATUS_API_URL env var. Left null when unset, which disables enrichment.
// Do not hardcode a host here — this repository is public (see CLAUDE.md).
let deployStatusBase = null;

// Fairness caps for the merged view (design: 5 most recent per repo, last 30 days).
const MERGED_PER_REPO_CAP = 5;
const MERGED_WINDOW_DAYS = 30;

// The deploy-status API's deployment state enum:
// deploying | succeeded | failed | canceled | blocked. Only `deploying` is non-terminal.
function deployStateToIndicator(state) {
  if (state === "succeeded") return "deployed";
  if (state === "deploying") return "in_progress";
  if (state === "failed" || state === "canceled" || state === "blocked") return "errored";
  return "unknown";
}

const DEPLOY_ENV_KEYS = { production: "prod", staging: "stage", demo: "demo" };

// Concurrency-limited enrichment pool so we don't fire N deploy-status requests at once.
const DEPLOY_STATUS_CONCURRENCY = 6;

// Per-SHA cache: SHAs whose tracked environments have all settled (no in_progress or
// unknown) are terminal and never re-fetched. Everything still deploying or unknown
// re-fetches each poll.
const deployCache = new Map(); // sha -> { deploy, fetchedAt }

const PR_QUERY = `
query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        isDraft
        isInMergeQueue
        createdAt
        mergedAt
        headRefName
        reviewDecision
        mergeCommit { oid }
        author { login }
        repository { nameWithOwner }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 50) {
                  nodes {
                    ... on CheckRun { name conclusion status checkSuite { app { slug } } }
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
let onUpdateCb = () => {};
let data = { mine: [], reviews: [], merged: [] };

async function init(tabConfig, onUpdate) {
  cfg = { ...defaults, ...tabConfig };
  deployStatusBase = cfg.deployStatusUrl || process.env.DEPLOY_STATUS_API_URL || null;

  tab.enabled = cfg.enabled;
  tab.available = ghAvailable;
  tab.hint = ghAvailable ? null : "GitHub CLI (gh) not found. Install it with: brew install gh";

  console.log(`Config: pulls ${cfg.enabled ? "enabled" : "disabled"}${ghAvailable ? "" : " (gh CLI not found)"}`);
  if (!cfg.enabled || !ghAvailable) return;

  try {
    const { stdout } = await execFileAsync("gh", ["api", "user", "--jq", ".login"], { timeout: 10000 });
    currentUser = stdout.trim();
  } catch { /* non-fatal; directReview will always be false */ }

  onUpdateCb = onUpdate;
  tab.refresh = await startPolling("Pulls", poll, onUpdate, 2 * 60 * 1000);
}

async function poll() {
  const mergedSince = new Date(Date.now() - MERGED_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  // allSettled keeps the three queries independent: a single failing query (e.g. a
  // GitHub 502) retains its last-known data while the others still update, instead of
  // failing the whole poll and letting the display go stale.
  const [mine, reviews, merged] = await Promise.allSettled([
    searchPrs("is:pr is:open archived:false author:@me", () => true, prPriority),
    searchPrs("is:pr is:open archived:false review-requested:@me draft:false", (pr) => !pr.isDraft, reviewPriority),
    // GitHub search has no merged-date sort, so `sort:updated-desc` is the closest
    // proxy to skew the first-100 window toward the most recent merges (see PR_QUERY's
    // first:100 ceiling — a hard cap, documented as a known limitation).
    searchMerged(`is:pr archived:false author:@me is:merged merged:>=${mergedSince} sort:updated-desc`),
  ]);

  data = settlePollResults({ mine, reviews, merged }, data);
  // Only re-enrich when the merged query actually refreshed; on failure the retained
  // groups were already enriched by an earlier poll.
  // Publish Mine/Reviews/merged immediately; deploy dots fill in via a follow-up
  // onUpdate so the deploy-status fetch never blocks the tab render (each fetch can
  // run its full 10s abort timeout when the API is unreachable).
  if (merged.status === "fulfilled" && cfg.deployStatus && deployStatusBase) enrichInBackground(data.merged);
}

// Merge a batch of Promise.allSettled results into the next data snapshot. Each
// fulfilled query publishes its fresh value; each rejected query retains its last-known
// value from `prev` so a single failing query (e.g. a GitHub 502) never blanks the tab.
export function settlePollResults(results, prev) {
  const next = {};
  for (const [key, result] of Object.entries(results)) {
    if (result.status === "fulfilled") {
      next[key] = result.value;
    } else {
      console.error(`PR fetch error (${key}):`, result.reason?.message || result.reason);
      next[key] = prev[key];
    }
  }
  return next;
}

async function searchMerged(query) {
  const groups = await searchPrs(query, () => true, mergedPriority);
  capMergedGroups(groups);
  return groups;
}

// Enrich merged groups with deploy status out of band, then push a follow-up update.
// Never throws into poll(): per-PR failures already resolve to "unknown".
// Guards against calling onUpdateCb() when a newer poll has already replaced data.merged,
// which would otherwise trigger a render showing the new merged list without deploy dots.
async function enrichInBackground(groups) {
  try {
    await enrichDeployStatus(groups);
    if (data.merged === groups) onUpdateCb();
  } catch (err) {
    console.error("[pulls] deploy enrichment error:", err.message);
  }
}

// Fairness cap: keep the N most recent merges per repo (by mergedAt desc).
export function capMergedGroups(groups, cap = MERGED_PER_REPO_CAP) {
  for (const group of groups) {
    group.prs.sort((a, b) => new Date(b.mergedAt || 0) - new Date(a.mergedAt || 0));
    group.prs = group.prs.slice(0, cap);
  }
  return groups;
}

// Fetch deploy status for every capped PR, bounded by a small pool.
// A per-PR failure resolves that PR's dots to "unknown"; it never throws out of poll().
async function enrichDeployStatus(groups) {
  const tasks = [];
  for (const group of groups) {
    for (const pr of group.prs) tasks.push({ pr, repo: group.repo });
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const { pr, repo } = tasks[cursor++];
      pr.deploy = await deployForSha(pr.repoWithOwner, pr.mergeCommitOid);
    }
  };
  const pool = Array.from({ length: Math.min(DEPLOY_STATUS_CONCURRENCY, tasks.length) }, worker);
  await Promise.all(pool);
}

async function deployForSha(repoWithOwner, sha) {
  if (!sha) return { prod: "unknown", stage: "unknown", demo: "unknown" };
  return resolveDeploy(sha, () => fetchDeployStatus(repoWithOwner, sha), deployCache);
}

// Cache-aware resolution: a terminal (fully settled) SHA is served from cache and never
// re-fetched; in-progress/unknown results self-heal by re-fetching on the next poll.
export async function resolveDeploy(sha, fetcher, cache = deployCache) {
  const cached = cache.get(sha);
  if (cached && isTerminalDeploy(cached.deploy)) return cached.deploy;

  const deploy = await fetcher();
  if (isTerminalDeploy(deploy)) cache.set(sha, { deploy, fetchedAt: Date.now() });
  return deploy;
}

// Terminal when no environment is still settling: "deploying" (in_progress) and
// "unknown" are the only non-terminal states. A repo that only deploys to prod
// ({prod:"deployed", stage:"none", demo:"none"}) is terminal so the cache engages.
const NON_TERMINAL_DEPLOY_STATES = new Set(["in_progress", "unknown"]);
export function isTerminalDeploy(deploy) {
  return !NON_TERMINAL_DEPLOY_STATES.has(deploy.prod)
    && !NON_TERMINAL_DEPLOY_STATES.has(deploy.stage)
    && !NON_TERMINAL_DEPLOY_STATES.has(deploy.demo);
}

async function fetchDeployStatus(repoWithOwner, sha) {
  const url = `${deployStatusBase}/v2/commits/repo/${repoWithOwner}/sha/${sha}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let json;
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    return parseDeployments(json?.data?.deployments);
  } catch {
    // Unreachable / network error / bad response → gray "unknown", not cached as terminal.
    return { prod: "unknown", stage: "unknown", demo: "unknown" };
  }
}

// Parse the deploy-status API's deployments[] into { prod, stage, demo }. Missing env → "none".
export function parseDeployments(deployments) {
  const deploy = { prod: "none", stage: "none", demo: "none" };
  if (!Array.isArray(deployments)) return deploy;
  for (const d of deployments) {
    const key = DEPLOY_ENV_KEYS[d?.environment];
    if (!key) continue;
    deploy[key] = deployStateToIndicator(d.state);
  }
  return deploy;
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
  const trunk = trunkQueueState(checks);
  return {
    number: node.number,
    title: node.title,
    branch: node.headRefName,
    url: node.url,
    createdAt: node.createdAt,
    mergedAt: node.mergedAt,
    mergeCommitOid: node.mergeCommit?.oid || null,
    repoWithOwner: node.repository?.nameWithOwner || "",
    isDraft: node.isDraft,
    author: node.author?.login || "",
    status: prStatus(node, trunk),
    ci: ciStatus(checks.filter((c) => !isTrunkQueueCheck(c))),
    directReview: (node.reviewRequests?.nodes || []).some(
      (r) => r.requestedReviewer?.__typename === "User" && r.requestedReviewer?.login === currentUser
    ),
  };
}

const PRIORITY = { queue_failed: 0, queued: 1, approved: 2, comments: 3, open: 5, draft: 6 };
function prPriority(pr) {
  if (pr.ci === "failing" && pr.status !== "approved" && pr.status !== "comments" && pr.status !== "queue_failed") return 4;
  return PRIORITY[pr.status] ?? 6;
}

const CI_ORDER = { passing: 0, running: 1, none: 2, failing: 3 };
function reviewPriority(pr) { return CI_ORDER[pr.ci] ?? 2; }

// Merged PRs are sorted newest-first (most recent merge on top).
function mergedPriority(pr) { return -new Date(pr.mergedAt || 0).getTime(); }

// Some repos drive their merge queue via the Trunk.io GitHub App (app slug
// trunk-io) with a check named "Trunk Merge Queue (…)" instead of GitHub's native
// merge queue, so node.isInMergeQueue never fires for them.
// The check is absent until a PR is submitted, then non-terminal while queued,
// then COMPLETED/SUCCESS on merge or COMPLETED/FAILURE (etc.) if it fails in queue.
export function isTrunkQueueCheck(check) {
  return check?.checkSuite?.app?.slug === "trunk-io"
    && typeof check?.name === "string"
    && check.name.startsWith("Trunk Merge Queue");
}

// Reads the Trunk merge-queue check state: null (not submitted), "queued"
// (present, non-terminal), or "failed" (COMPLETED with a non-success conclusion).
export function trunkQueueState(checks) {
  const check = (checks || []).find(isTrunkQueueCheck);
  if (!check) return null;
  if (check.status !== "COMPLETED") return "queued";
  return check.conclusion === "SUCCESS" ? null : "failed";
}

export function prStatus(node, trunk = null) {
  if (node.merged || node.mergedAt) return "merged";
  if (node.isDraft) return "draft";
  if (node.isInMergeQueue || trunk === "queued") return "queued";
  if (trunk === "failed") return "queue_failed";
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
