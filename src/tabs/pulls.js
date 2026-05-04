// src/tabs/pulls.js — Tab module: GitHub PR monitoring
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { startPolling } from "../utils.js";

const execFileAsync = promisify(execFile);
const PR_FIELDS = "number,title,isDraft,reviewDecision,latestReviews,statusCheckRollup,createdAt,url,headRefName,author";

const ghAvailable = (() => {
  try { execFileSync("which", ["gh"], { encoding: "utf-8" }); return true; }
  catch { return false; }
})();

export const defaults = {
  enabled: true,
  orgFilter: null,
};

let cfg;
let data = { mine: [], reviews: [] };

async function init(tabConfig, onUpdate) {
  cfg = { ...defaults, ...tabConfig };

  tab.enabled = cfg.enabled;
  tab.available = ghAvailable;
  tab.hint = ghAvailable ? null : "GitHub CLI (gh) not found. Install it with: brew install gh";

  console.log(`Config: pulls ${cfg.enabled ? "enabled" : "disabled"}${ghAvailable ? "" : " (gh CLI not found)"}`);
  if (!cfg.enabled || !ghAvailable) return;

  await startPolling("Pulls", poll, onUpdate, 2 * 60 * 1000);
}

async function poll() {
  try {
    const [mine, reviews] = await Promise.all([fetchAuthoredPrs(), fetchReviewRequestedPrs()]);
    data = { mine, reviews };
  } catch (err) {
    console.error("PR fetch error:", err.message);
  }
}

async function fetchAuthoredPrs() {
  const { stdout } = await execFileAsync(
    "gh",
    ["search", "prs", "--author=@me", "--state=open", "--json", "repository,number", "--limit", "100"],
    { timeout: 15000 },
  );
  return groupAndFetch(JSON.parse(stdout), () => true, prPriority);
}

async function fetchReviewRequestedPrs() {
  const { stdout } = await execFileAsync(
    "gh",
    ["search", "prs", "--review-requested=@me", "--state=open", "--draft=false", "--json", "repository,number", "--limit", "100"],
    { timeout: 15000 },
  );
  return groupAndFetch(JSON.parse(stdout), (pr) => !pr.isDraft, reviewPriority);
}

async function groupAndFetch(hits, filter, sortFn) {
  const orgFilter = cfg.orgFilter;
  const byRepo = new Map();
  for (const hit of hits) {
    const repo = hit.repository.nameWithOwner;
    if (orgFilter && !orgFilter.includes(repo.split("/")[0])) continue;
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo).push(hit.number);
  }

  const groups = [];
  await Promise.all([...byRepo.entries()].map(async ([repo, numbers]) => {
    const prs = await fetchRepoPrs(repo, numbers, filter);
    if (prs.length > 0) groups.push({ repo: repo.split("/")[1], prs });
  }));

  for (const g of groups) g.prs.sort((a, b) => sortFn(a) - sortFn(b));
  groups.sort((a, b) => b.prs.length - a.prs.length);
  return groups;
}

async function fetchRepoPrs(repo, numbers, filter) {
  try {
    const results = await Promise.all(
      numbers.map(async (num) => {
        const { stdout } = await execFileAsync(
          "gh", ["pr", "view", String(num), "--repo", repo, "--json", PR_FIELDS],
          { timeout: 15000 },
        );
        return summarizePr(JSON.parse(stdout));
      }),
    );
    return results.filter(filter);
  } catch (err) {
    console.error(`PR fetch error for ${repo}:`, err.message);
    return [];
  }
}

function summarizePr(pr) {
  return {
    number: pr.number, title: pr.title, branch: pr.headRefName, url: pr.url,
    createdAt: pr.createdAt, isDraft: pr.isDraft, author: pr.author?.login || "",
    status: prStatus(pr), ci: ciStatus(pr.statusCheckRollup || []),
  };
}

const PRIORITY = { approved: 0, comments: 1, open: 3, draft: 4 };
function prPriority(pr) {
  if (pr.ci === "failing" && pr.status !== "approved" && pr.status !== "comments") return 2;
  return PRIORITY[pr.status] ?? 5;
}

const CI_ORDER = { passing: 0, running: 1, none: 2, failing: 3 };
function reviewPriority(pr) { return CI_ORDER[pr.ci] ?? 2; }

function prStatus(pr) {
  if (pr.isDraft) return "draft";
  if (pr.reviewDecision === "APPROVED") return "approved";
  if ((pr.latestReviews || []).length > 0) return "comments";
  return "open";
}

function ciStatus(checks) {
  if (checks.length === 0) return "none";
  const meaningful = checks.filter((c) => c.conclusion !== "SKIPPED" && c.conclusion !== "NEUTRAL");
  if (meaningful.length === 0) return "none";
  if (meaningful.some((c) => c.status !== "COMPLETED")) return "running";
  if (meaningful.some((c) => c.conclusion === "FAILURE" || c.conclusion === "TIMED_OUT")) return "failing";
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
