// src/pulls.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import config from "./config.js";

const execFileAsync = promisify(execFile);
const PR_FIELDS = "number,title,isDraft,reviewDecision,latestReviews,statusCheckRollup,createdAt,url,headRefName,author";

export async function getMyPulls() {
  if (!config.pulls.enabled) return { mine: [], reviews: [] };
  try {
    const [mine, reviews] = await Promise.all([
      fetchAuthoredPrs(),
      fetchReviewRequestedPrs(),
    ]);
    return { mine, reviews };
  } catch (err) {
    console.error("PR fetch error:", err.message);
    return { mine: [], reviews: [] };
  }
}

async function fetchAuthoredPrs() {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "search", "prs",
      "--author=@me",
      "--state=open",
      "--json", "repository,number",
      "--limit", "100",
    ],
    { timeout: 15000 },
  );
  const hits = JSON.parse(stdout);
  return groupAndFetch(hits, (pr) => true, prPriority);
}

async function fetchReviewRequestedPrs() {
  const { stdout } = await execFileAsync(
    "gh",
    [
      "search", "prs",
      "--review-requested=@me",
      "--state=open",
      "--draft=false",
      "--json", "repository,number",
      "--limit", "100",
    ],
    { timeout: 15000 },
  );
  const hits = JSON.parse(stdout);
  return groupAndFetch(hits, (pr) => !pr.isDraft, reviewPriority);
}

async function groupAndFetch(hits, filter, sortFn) {
  const orgFilter = config.pulls.orgFilter;
  const byRepo = new Map();
  for (const hit of hits) {
    const repo = hit.repository.nameWithOwner;
    if (orgFilter && !orgFilter.includes(repo.split("/")[0])) continue;
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo).push(hit.number);
  }

  const groups = [];
  const fetches = [...byRepo.entries()].map(async ([repo, numbers]) => {
    const prs = await fetchRepoPrs(repo, numbers, filter);
    if (prs.length > 0) {
      groups.push({ repo: repo.split("/")[1], prs });
    }
  });
  await Promise.all(fetches);

  for (const g of groups) {
    g.prs.sort((a, b) => sortFn(a) - sortFn(b));
  }
  groups.sort((a, b) => b.prs.length - a.prs.length);
  return groups;
}

async function fetchRepoPrs(repo, numbers, filter) {
  try {
    const results = await Promise.all(
      numbers.map(async (num) => {
        const { stdout } = await execFileAsync(
          "gh",
          ["pr", "view", String(num), "--repo", repo, "--json", PR_FIELDS],
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
    number: pr.number,
    title: pr.title,
    branch: pr.headRefName,
    url: pr.url,
    createdAt: pr.createdAt,
    isDraft: pr.isDraft,
    author: pr.author?.login || "",
    status: prStatus(pr),
    ci: ciStatus(pr.statusCheckRollup || []),
  };
}

const PRIORITY = { approved: 0, comments: 1, open: 3, draft: 4 };

function prPriority(pr) {
  if (pr.ci === "failing" && pr.status !== "approved" && pr.status !== "comments") return 2;
  return PRIORITY[pr.status] ?? 5;
}

// Review requests: CI passing first (ready to review), then running, then failing
const CI_ORDER = { passing: 0, running: 1, none: 2, failing: 3 };
function reviewPriority(pr) {
  return CI_ORDER[pr.ci] ?? 2;
}

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
