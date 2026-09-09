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

// Repos that have ever returned a real (observed) deploy state. Persists across polls so
// all-"none" PRs from a tracked repo still show dots (they're just waiting to deploy).
const deployTrackedRepos = new Set();

const PR_QUERY = `
query($q: String!, $n: Int!, $after: String) {
  search(query: $q, type: ISSUE, first: $n, after: $after) {
    pageInfo { hasNextPage endCursor }
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
        latestReviews { totalCount }
      }
    }
  }
}`;

let cfg;
let onUpdateCb = () => {};
let data = { mine: [], reviews: [], merged: [], assigned: [] };

async function init(tabConfig, onUpdate) {
  cfg = { ...defaults, ...tabConfig };
  deployStatusBase = cfg.deployStatusUrl || process.env.DEPLOY_STATUS_API_URL || null;

  tab.enabled = cfg.enabled;
  tab.available = ghAvailable;
  tab.hint = ghAvailable ? null : "GitHub CLI (gh) not found. Install it with: brew install gh";

  console.log(`Config: pulls ${cfg.enabled ? "enabled" : "disabled"}${ghAvailable ? "" : " (gh CLI not found)"}`);
  if (!cfg.enabled || !ghAvailable) return;

  onUpdateCb = onUpdate;
  tab.refresh = await startPolling("Pulls", poll, onUpdate, 2 * 60 * 1000);
}

async function poll() {
  const mergedSince = new Date(Date.now() - MERGED_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  // allSettled keeps the queries independent: a single failing query (e.g. a GitHub 502)
  // retains its last-known data while the others still update, instead of failing the
  // whole poll and letting the display go stale.
  const [mine, reviews, merged, assigned] = await Promise.allSettled([
    searchPrs("is:pr is:open archived:false author:@me", () => true, prPriority),
    // `review-requested:@me` includes requests routed via a team, so this matches far more
    // than fits in the row ceiling. `sort:updated-desc` makes the truncation deterministic
    // (most recently updated first) instead of an arbitrary slice of a drifting result set —
    // same rationale as the merged query below.
    searchPrs("is:pr is:open archived:false review-requested:@me draft:false sort:updated-desc", (pr) => !pr.isDraft, reviewPriority),
    // GitHub search has no merged-date sort, so `sort:updated-desc` is the closest
    // proxy to skew the returned window toward the most recent merges.
    searchMerged(`is:pr archived:false author:@me is:merged merged:>=${mergedSince} sort:updated-desc`),
    // Requests addressed to me personally rather than to one of my teams. Every row is a
    // direct request by construction, so no client-side filtering is needed.
    searchPrs("is:pr is:open archived:false user-review-requested:@me draft:false", (pr) => !pr.isDraft, reviewPriority),
  ]);

  data = settlePollResults({ mine, reviews, merged, assigned }, data);
  // Only re-enrich when the merged query actually refreshed; on failure the retained
  // groups were already enriched by an earlier poll. Deploy dots fill in via a follow-up
  // onUpdate from enrichInBackground so the deploy-status fetch never blocks the initial
  // render (each fetch can run its full 10s abort timeout when the API is unreachable).
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
// Never throws into poll(): per-PR network/HTTP failures resolve to "unknown"; 404s resolve to null.
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
// Network/HTTP failures resolve to "unknown"; 404s resolve to null. Never throws out of poll().
async function enrichDeployStatus(groups) {
  const tasks = [];
  for (const group of groups) {
    for (const pr of group.prs) tasks.push(pr);
  }

  let cursor = 0;
  const worker = async () => {
    while (cursor < tasks.length) {
      const pr = tasks[cursor++];
      pr.deploy = await deployForSha(pr.repoWithOwner, pr.mergeCommitOid);
      pr.deployLinks = deployLinksForSha(pr.mergeCommitOid);
      if (deployStateIsTracked(pr.deploy)) deployTrackedRepos.add(pr.repoWithOwner);
    }
  };
  const pool = Array.from({ length: Math.min(DEPLOY_STATUS_CONCURRENCY, tasks.length) }, worker);
  await Promise.all(pool);

  for (const group of groups) {
    for (const pr of group.prs) {
      pr.repoTracked = deployTrackedRepos.has(pr.repoWithOwner);
    }
  }
}

// sha -> links object. Populated in lockstep with deployCache: the wrapped fetcher below
// only runs when resolveDeploy actually does a network fetch (i.e. not on a cache hit), so
// this stays in sync with whatever deploy state resolveDeploy is currently serving for a sha.
const deployLinksCache = new Map();

async function deployForSha(repoWithOwner, sha) {
  if (!sha) return null;
  return resolveDeploy(sha, async () => {
    const { deploy, links } = await fetchDeployStatus(repoWithOwner, sha);
    deployLinksCache.set(sha, links);
    return deploy;
  }, deployCache);
}

function deployLinksForSha(sha) {
  return deployLinksCache.get(sha) ?? NO_LINKS;
}

// A repo counts as "tracked" only once a real, observed deployment state comes back.
// null (per-sha 404: repo untracked OR that commit not yet ingested) and the all-"unknown"
// sentinel (API unreachable / off-VPN) are NOT evidence of tracking — treating them as such
// would flip a repo to tracked on a single transient failure and never unflip.
export function deployStateIsTracked(deploy) {
  if (!deploy) return false;
  return Object.values(deploy).some((v) => v !== "none" && v !== "unknown");
}

// Client + server share this gate: hide dots when there's nothing to show. No deploy
// object (null 404 / not enriched yet) hides. An all-"none" or all-"unknown" result hides
// for untracked repos — both mean no real deployment state has been observed. For tracked
// repos, all-"none" still shows (PR is waiting to start deploying) and all-"unknown" shows
// (API temporarily unreachable, but we know the repo deploys).
export function shouldShowDeployDots(deploy, repoTracked) {
  if (!deploy) return false;
  if (!repoTracked && !deployStateIsTracked(deploy)) return false;
  return true;
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
// null (per-sha 404) is also terminal — cached per-sha so it never re-fetches that commit,
// but it does NOT poison other SHAs of the same repo (a commit merely not-yet-ingested 404s
// too, so the negative cache must stay sha-scoped, not repo-scoped).
const NON_TERMINAL_DEPLOY_STATES = new Set(["in_progress", "unknown"]);
export function isTerminalDeploy(deploy) {
  if (deploy === null) return true;
  return !NON_TERMINAL_DEPLOY_STATES.has(deploy.prod)
    && !NON_TERMINAL_DEPLOY_STATES.has(deploy.stage)
    && !NON_TERMINAL_DEPLOY_STATES.has(deploy.demo);
}

const NO_LINKS = { prod: null, stage: null, demo: null };

// Returns { deploy, links } — links carries a Buildkite build URL per environment (or null),
// derived from the same deployments[] payload as deploy. Kept as a sibling field, never
// merged into `deploy` itself: deployStateIsTracked() does Object.values(deploy).some(...)
// over exactly {prod,stage,demo}, so any extra key there would always count as "tracked".
async function fetchDeployStatus(repoWithOwner, sha) {
  const url = `${deployStatusBase}/v2/commits/repo/${repoWithOwner}/sha/${sha}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let json;
    try {
      const res = await fetch(url, { signal: controller.signal });
      // this sha isn't in the deploy-status API (untracked repo or not-yet-ingested commit)
      if (res.status === 404) return { deploy: null, links: NO_LINKS };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    const deployments = json?.data?.deployments;
    return { deploy: parseDeployments(deployments), links: parseDeployLinks(deployments) };
  } catch {
    // Unreachable / network error / bad response → gray "unknown", not cached as terminal.
    return { deploy: { prod: "unknown", stage: "unknown", demo: "unknown" }, links: NO_LINKS };
  }
}

// Groups deployments[] by environment, keeping only the most recent entry per environment.
// The API can return multiple entries for the same environment (e.g. a failed deploy
// followed by a retry) with no guaranteed chronological array order, so entries are picked
// by started_at (falling back to finished_at) rather than trusting array order — otherwise
// a stale/failed entry landing later in the array can overwrite a genuinely newer one.
// Shared by parseDeployments (deploy state) and parseDeployLinks (Buildkite build links).
function latestDeploymentsByEnv(deployments) {
  const latest = new Map(); // key -> { ts, entry }
  if (!Array.isArray(deployments)) return latest;
  for (const d of deployments) {
    const key = DEPLOY_ENV_KEYS[d?.environment];
    if (!key) continue;
    const ts = new Date(d?.started_at || d?.finished_at || 0).getTime();
    const prev = latest.get(key);
    if (!prev || ts >= prev.ts) latest.set(key, { ts, entry: d });
  }
  return latest;
}

// Parse the deploy-status API's deployments[] into { prod, stage, demo }. Missing env → "none".
export function parseDeployments(deployments) {
  const deploy = { prod: "none", stage: "none", demo: "none" };
  for (const [key, { entry }] of latestDeploymentsByEnv(deployments)) {
    deploy[key] = deployStateToIndicator(entry.state);
  }
  return deploy;
}

// Parses a Buildkite execution_ref URN (urn:buildkite:build:<org>:<pipeline>:<number>) into
// a clickable build URL. Returns null for a missing ref, a non-Buildkite ref (some other CI
// system), or anything that doesn't match the expected shape.
export function buildkiteUrlFromExecutionRef(ref) {
  if (typeof ref !== "string") return null;
  const m = ref.match(/^urn:buildkite:build:([^:]+):([^:]+):(\d+)$/);
  if (!m) return null;
  const [, org, pipeline, number] = m;
  return `https://buildkite.com/${org}/${pipeline}/builds/${number}`;
}

// Parse the deploy-status API's deployments[] into { prod, stage, demo } Buildkite build
// links (or null per environment when there's no deploy yet, or the deploy didn't run on
// Buildkite). Mirrors parseDeployments' "most recent per environment" selection.
export function parseDeployLinks(deployments) {
  const links = { prod: null, stage: null, demo: null };
  for (const [key, { entry }] of latestDeploymentsByEnv(deployments)) {
    links[key] = buildkiteUrlFromExecutionRef(entry.execution_ref);
  }
  return links;
}

// GitHub caps the execution resources a single GraphQL request may consume, and the cost
// tracks the nested per-PR fan-out (commits -> statusCheckRollup -> contexts) times the
// number of rows *returned* — not how many results the search matched. Measured against
// the broad review-requested search: 50 rows is reliable, the failure cliff starts around
// 75, and 100 rows fails every time (reproduces identically running `gh api graphql` by
// hand, outside this app). So every search pages at 50, regardless of expected size —
// paging short-circuits on `hasNextPage: false`, so a small result set still costs one
// request and no search is left sitting past the cliff.
const SEARCH_PAGE_SIZE = 50;
// Two pages preserves the 100-row ceiling the single-request version had.
const MAX_SEARCH_PAGES = 2;

// Depending on which layer gives up first, an over-budget request comes back either as a
// raw gateway error or as a structured resource-limit error in the GraphQL response body.
// Retry a couple of times before letting poll()'s allSettled fallback (see settlePollResults)
// absorb it as stale data. Only these are retried — anything else (auth, malformed query)
// should surface immediately rather than being masked for 6+ seconds. Note that retrying is
// insurance for a genuinely transient blip only: at an over-budget query shape the failure
// is deterministic, so keeping every request under budget is what actually fixes it.
export const RETRYABLE_ERROR = /HTTP 50[234]|Resource limits for this query exceeded/i;

async function fetchPrSearchPage(query, { first, after = null }, attempts = 3) {
  const args = ["api", "graphql", "-F", `query=${PR_QUERY}`, "-F", `q=${query}`, "-F", `n=${first}`];
  if (after) args.push("-F", `after=${after}`);

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    try {
      const { stdout } = await execFileAsync("gh", args, { timeout: 30000 });
      const search = JSON.parse(stdout).data.search;
      return { nodes: search.nodes || [], pageInfo: search.pageInfo };
    } catch (err) {
      const match = err.message.match(RETRYABLE_ERROR);
      if (!match || attempt === attempts - 1) throw err;
      console.error(`[pulls] graphql ${match[0]}, retrying (attempt ${attempt + 2}/${attempts})...`);
    }
  }
}

// Walks up to `maxPages` search pages via `fetchPage(after) -> { nodes, pageInfo }`,
// stopping early once GitHub reports no next page. Dedupes by PR url: the underlying
// result set shifts while we page through it (observed drifting 365 -> 362 mid-session),
// and that cursor drift can hand back a PR that already appeared on an earlier page.
export async function collectSearchPages(fetchPage, maxPages = MAX_SEARCH_PAGES) {
  const nodes = [];
  const seen = new Set();
  let after = null;

  for (let page = 0; page < maxPages; page++) {
    const { nodes: pageNodes = [], pageInfo } = await fetchPage(after);
    for (const node of pageNodes) {
      const key = node?.url;
      if (key) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      nodes.push(node);
    }
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }

  return nodes;
}

function fetchPrNodes(query) {
  return collectSearchPages((after) => fetchPrSearchPage(query, { first: SEARCH_PAGE_SIZE, after }));
}

async function searchPrs(query, filter, sortFn) {
  console.log(`[pulls] polling: ${query}`);
  const nodes = await fetchPrNodes(query);
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
  if ((node.latestReviews?.totalCount || 0) > 0) return "comments";
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
