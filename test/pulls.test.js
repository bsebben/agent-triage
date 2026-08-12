// test/pulls.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  prStatus,
  parseDeployments,
  capMergedGroups,
  resolveDeploy,
  isTerminalDeploy,
  isTrunkQueueCheck,
  trunkQueueState,
  settlePollResults,
  deployStateIsTracked,
  shouldShowDeployDots,
} from "../src/tabs/pulls.js";

const fulfilled = (value) => ({ status: "fulfilled", value });
const rejected = (reason) => ({ status: "rejected", reason });

const trunkCheck = (status, conclusion) => ({
  name: "Trunk Merge Queue (main)",
  status,
  conclusion,
  checkSuite: { app: { slug: "trunk-io" } },
});

describe("prStatus", () => {
  it("returns 'draft' for a draft PR regardless of other state", () => {
    assert.equal(prStatus({ isDraft: true, isInMergeQueue: true, reviewDecision: "APPROVED" }), "draft");
  });

  it("returns 'queued' when the PR is in the merge queue", () => {
    assert.equal(prStatus({ isInMergeQueue: true }), "queued");
  });

  it("prefers 'queued' over 'approved' when both apply", () => {
    assert.equal(prStatus({ isInMergeQueue: true, reviewDecision: "APPROVED" }), "queued");
  });

  it("returns 'approved' when approved and not queued", () => {
    assert.equal(prStatus({ isInMergeQueue: false, reviewDecision: "APPROVED" }), "approved");
  });

  it("returns 'comments' when there are reviews but no approval", () => {
    assert.equal(prStatus({ reviewDecision: "REVIEW_REQUIRED", latestReviews: { nodes: [{ state: "COMMENTED" }] } }), "comments");
  });

  it("returns 'open' when there are no reviews", () => {
    assert.equal(prStatus({ reviewDecision: "REVIEW_REQUIRED", latestReviews: { nodes: [] } }), "open");
  });

  it("returns 'merged' when the PR has a mergedAt timestamp", () => {
    assert.equal(prStatus({ mergedAt: "2026-07-20T00:00:00Z", isDraft: true }), "merged");
  });

  it("returns 'merged' when the node is flagged merged", () => {
    assert.equal(prStatus({ merged: true }), "merged");
  });

  it("returns 'queued' when the Trunk merge-queue check is queued", () => {
    assert.equal(prStatus({ reviewDecision: "APPROVED" }, "queued"), "queued");
  });

  it("returns 'queue_failed' when the Trunk merge-queue check failed", () => {
    assert.equal(prStatus({ reviewDecision: "APPROVED" }, "failed"), "queue_failed");
  });

  it("prefers 'queued' over 'queue_failed' ordering (queued wins when native queue is set)", () => {
    assert.equal(prStatus({ isInMergeQueue: true }, "failed"), "queued");
  });
});

describe("isTrunkQueueCheck", () => {
  it("matches a Trunk Merge Queue CheckRun by app slug and name", () => {
    assert.equal(isTrunkQueueCheck(trunkCheck("QUEUED", null)), true);
  });

  it("ignores non-trunk checks", () => {
    assert.equal(isTrunkQueueCheck({ name: "Trunk Merge Queue (main)", checkSuite: { app: { slug: "other" } } }), false);
    assert.equal(isTrunkQueueCheck({ name: "CI", checkSuite: { app: { slug: "trunk-io" } } }), false);
    assert.equal(isTrunkQueueCheck({ state: "SUCCESS" }), false);
    assert.equal(isTrunkQueueCheck(undefined), false);
  });
});

describe("trunkQueueState", () => {
  it("returns null when no Trunk check is present (not submitted)", () => {
    assert.equal(trunkQueueState([{ name: "CI", status: "COMPLETED", conclusion: "SUCCESS" }]), null);
    assert.equal(trunkQueueState([]), null);
  });

  it("returns 'queued' while the check is non-terminal", () => {
    assert.equal(trunkQueueState([trunkCheck("QUEUED", null)]), "queued");
    assert.equal(trunkQueueState([trunkCheck("IN_PROGRESS", null)]), "queued");
  });

  it("returns null on a successful (merged) Trunk check", () => {
    assert.equal(trunkQueueState([trunkCheck("COMPLETED", "SUCCESS")]), null);
  });

  it("returns 'failed' when the Trunk check completed with a non-success conclusion", () => {
    assert.equal(trunkQueueState([trunkCheck("COMPLETED", "FAILURE")]), "failed");
    assert.equal(trunkQueueState([trunkCheck("COMPLETED", "TIMED_OUT")]), "failed");
    assert.equal(trunkQueueState([trunkCheck("COMPLETED", "CANCELLED")]), "failed");
  });
});

describe("parseDeployments", () => {
  it("maps deploy-status API states to indicators per environment", () => {
    const deploy = parseDeployments([
      { environment: "production", state: "succeeded" },
      { environment: "staging", state: "deploying" },
      { environment: "demo", state: "failed" },
    ]);
    assert.deepEqual(deploy, { prod: "deployed", stage: "in_progress", demo: "errored" });
  });

  it("treats canceled and blocked as errored", () => {
    const canceled = parseDeployments([{ environment: "production", state: "canceled" }]);
    assert.equal(canceled.prod, "errored");
    const blocked = parseDeployments([{ environment: "staging", state: "blocked" }]);
    assert.equal(blocked.stage, "errored");
  });

  it("marks an unrecognized state as unknown", () => {
    const deploy = parseDeployments([{ environment: "production", state: "queued" }]);
    assert.equal(deploy.prod, "unknown");
  });

  it("defaults a missing environment to 'none'", () => {
    const deploy = parseDeployments([{ environment: "production", state: "succeeded" }]);
    assert.deepEqual(deploy, { prod: "deployed", stage: "none", demo: "none" });
  });

  it("ignores environments outside prod/staging/demo", () => {
    const deploy = parseDeployments([{ environment: "canary", state: "succeeded" }]);
    assert.deepEqual(deploy, { prod: "none", stage: "none", demo: "none" });
  });

  it("returns all 'none' for a missing or non-array deployments field", () => {
    assert.deepEqual(parseDeployments(undefined), { prod: "none", stage: "none", demo: "none" });
    assert.deepEqual(parseDeployments(null), { prod: "none", stage: "none", demo: "none" });
    assert.deepEqual(parseDeployments([]), { prod: "none", stage: "none", demo: "none" });
  });

  it("picks the most recent entry per environment when a retry follows a failure", () => {
    const deploy = parseDeployments([
      { environment: "production", state: "failed", started_at: "2026-08-12T10:00:00Z" },
      { environment: "production", state: "succeeded", started_at: "2026-08-12T10:05:00Z" },
    ]);
    assert.equal(deploy.prod, "deployed");
  });

  it("is not fooled by array order — an earlier-failed entry listed after a later success", () => {
    const deploy = parseDeployments([
      { environment: "production", state: "succeeded", started_at: "2026-08-12T10:05:00Z" },
      { environment: "production", state: "failed", started_at: "2026-08-12T10:00:00Z" },
    ]);
    assert.equal(deploy.prod, "deployed");
  });

  it("falls back to finished_at when started_at is absent", () => {
    const deploy = parseDeployments([
      { environment: "staging", state: "failed", finished_at: "2026-08-12T10:00:00Z" },
      { environment: "staging", state: "succeeded", finished_at: "2026-08-12T10:05:00Z" },
    ]);
    assert.equal(deploy.stage, "deployed");
  });

  it("tracks the most recent entry independently per environment", () => {
    const deploy = parseDeployments([
      { environment: "production", state: "failed", started_at: "2026-08-12T10:00:00Z" },
      { environment: "production", state: "succeeded", started_at: "2026-08-12T10:05:00Z" },
      { environment: "staging", state: "succeeded", started_at: "2026-08-12T09:00:00Z" },
      { environment: "staging", state: "deploying", started_at: "2026-08-12T09:30:00Z" },
    ]);
    assert.deepEqual(deploy, { prod: "deployed", stage: "in_progress", demo: "none" });
  });
});

describe("capMergedGroups", () => {
  it("keeps only the 5 most recent merges per repo, newest first", () => {
    const prs = Array.from({ length: 8 }, (_, i) => ({
      number: i,
      mergedAt: `2026-07-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
    }));
    const groups = [{ repo: "a", prs: [...prs] }];
    capMergedGroups(groups);
    assert.equal(groups[0].prs.length, 5);
    // Most recent (number 7) first, oldest kept (number 3) last.
    assert.equal(groups[0].prs[0].number, 7);
    assert.equal(groups[0].prs[4].number, 3);
  });

  it("does not cap repos with fewer than the limit", () => {
    const groups = [{ repo: "a", prs: [{ number: 1, mergedAt: "2026-07-01T00:00:00Z" }] }];
    capMergedGroups(groups);
    assert.equal(groups[0].prs.length, 1);
  });
});

describe("settlePollResults", () => {
  const prev = { mine: ["m0"], reviews: ["r0"], merged: ["g0"] };

  it("publishes fresh values when every query fulfills", () => {
    const next = settlePollResults(
      { mine: fulfilled(["m1"]), reviews: fulfilled(["r1"]), merged: fulfilled(["g1"]) },
      prev,
    );
    assert.deepEqual(next, { mine: ["m1"], reviews: ["r1"], merged: ["g1"] });
  });

  it("retains the last-known value for a single failing query", () => {
    const next = settlePollResults(
      { mine: fulfilled(["m1"]), reviews: rejected(new Error("HTTP 502")), merged: fulfilled(["g1"]) },
      prev,
    );
    assert.deepEqual(next, { mine: ["m1"], reviews: ["r0"], merged: ["g1"] });
  });

  it("retains all last-known values when every query fails", () => {
    const next = settlePollResults(
      { mine: rejected(new Error("a")), reviews: rejected(new Error("b")), merged: rejected(new Error("c")) },
      prev,
    );
    assert.deepEqual(next, prev);
  });
});

describe("isTerminalDeploy", () => {
  it("is terminal when every environment has settled (deployed/none/errored)", () => {
    assert.equal(isTerminalDeploy({ prod: "deployed", stage: "deployed", demo: "deployed" }), true);
    // Common partial-deploy case: a repo that only deploys to prod. This must be
    // terminal so the cache engages instead of re-fetching forever.
    assert.equal(isTerminalDeploy({ prod: "deployed", stage: "none", demo: "none" }), true);
    assert.equal(isTerminalDeploy({ prod: "errored", stage: "none", demo: "deployed" }), true);
  });

  it("treats null (404 = repo not tracked) as terminal", () => {
    assert.equal(isTerminalDeploy(null), true);
  });

  it("is not terminal when any environment is still in_progress or unknown", () => {
    assert.equal(isTerminalDeploy({ prod: "deployed", stage: "in_progress", demo: "none" }), false);
    assert.equal(isTerminalDeploy({ prod: "deployed", stage: "unknown", demo: "deployed" }), false);
  });
});

describe("resolveDeploy cache", () => {
  it("does not re-fetch a fully-deployed (terminal) SHA", async () => {
    const cache = new Map();
    const terminal = { prod: "deployed", stage: "deployed", demo: "deployed" };
    let calls = 0;
    const fetcher = async () => { calls++; return terminal; };
    await resolveDeploy("sha1", fetcher, cache);
    const second = await resolveDeploy("sha1", fetcher, cache);
    assert.equal(calls, 1);
    assert.deepEqual(second, terminal);
  });

  it("caches a partial deploy (prod-only) as terminal so it is not re-fetched", async () => {
    const cache = new Map();
    const partial = { prod: "deployed", stage: "none", demo: "none" };
    let calls = 0;
    const fetcher = async () => { calls++; return partial; };
    await resolveDeploy("sha2", fetcher, cache);
    const second = await resolveDeploy("sha2", fetcher, cache);
    assert.equal(calls, 1);
    assert.deepEqual(second, partial);
  });

  it("re-fetches an in-progress SHA every time (not cached)", async () => {
    const cache = new Map();
    const deploying = { prod: "deployed", stage: "in_progress", demo: "none" };
    let calls = 0;
    const fetcher = async () => { calls++; return deploying; };
    await resolveDeploy("sha4", fetcher, cache);
    await resolveDeploy("sha4", fetcher, cache);
    assert.equal(calls, 2);
    assert.equal(cache.has("sha4"), false);
  });

  it("re-fetches an unknown (off-VPN) SHA so it self-heals", async () => {
    const cache = new Map();
    const unknown = { prod: "unknown", stage: "unknown", demo: "unknown" };
    let calls = 0;
    const fetcher = async () => { calls++; return unknown; };
    await resolveDeploy("sha3", fetcher, cache);
    await resolveDeploy("sha3", fetcher, cache);
    assert.equal(calls, 2);
    assert.equal(cache.has("sha3"), false);
  });

  it("caches a null result (per-sha 404) so it is never re-fetched", async () => {
    const cache = new Map();
    let calls = 0;
    const fetcher = async () => { calls++; return null; };
    const first = await resolveDeploy("sha5", fetcher, cache);
    const second = await resolveDeploy("sha5", fetcher, cache);
    assert.equal(calls, 1);
    assert.equal(first, null);
    assert.equal(second, null);
  });

  it("scopes the null (404) cache to the sha, not the repo — a sibling sha still fetches", async () => {
    const cache = new Map();
    let calls = 0;
    // A 404'd sha (e.g. not-yet-ingested commit) must not suppress another sha's lookup.
    const fetcher = async (sha) => { calls++; return sha === "sha404" ? null : { prod: "deployed", stage: "none", demo: "none" }; };
    await resolveDeploy("sha404", () => fetcher("sha404"), cache);
    const other = await resolveDeploy("shaLive", () => fetcher("shaLive"), cache);
    assert.equal(calls, 2);
    assert.deepEqual(other, { prod: "deployed", stage: "none", demo: "none" });
  });
});

describe("deployStateIsTracked", () => {
  it("counts a repo as tracked once a real deployment state is observed", () => {
    assert.equal(deployStateIsTracked({ prod: "deployed", stage: "none", demo: "none" }), true);
    assert.equal(deployStateIsTracked({ prod: "none", stage: "in_progress", demo: "none" }), true);
    assert.equal(deployStateIsTracked({ prod: "none", stage: "none", demo: "errored" }), true);
  });

  it("does NOT treat the all-unknown sentinel (API unreachable / off-VPN) as tracked", () => {
    assert.equal(deployStateIsTracked({ prod: "unknown", stage: "unknown", demo: "unknown" }), false);
  });

  it("does NOT treat a null (per-sha 404) result as tracked", () => {
    assert.equal(deployStateIsTracked(null), false);
  });

  it("does NOT treat an all-none result as tracked", () => {
    assert.equal(deployStateIsTracked({ prod: "none", stage: "none", demo: "none" }), false);
  });
});

describe("shouldShowDeployDots", () => {
  it("hides dots when there is no deploy object (null 404 / not enriched yet)", () => {
    assert.equal(shouldShowDeployDots(null, false), false);
    assert.equal(shouldShowDeployDots(null, true), false);
  });

  it("hides all-none dots for an untracked repo", () => {
    assert.equal(shouldShowDeployDots({ prod: "none", stage: "none", demo: "none" }, false), false);
  });

  it("shows all-none dots for a tracked repo (PR waiting to start deploying)", () => {
    assert.equal(shouldShowDeployDots({ prod: "none", stage: "none", demo: "none" }, true), true);
  });

  it("shows dots whenever any environment has a real state, tracked or not", () => {
    assert.equal(shouldShowDeployDots({ prod: "deployed", stage: "none", demo: "none" }, false), true);
    assert.equal(shouldShowDeployDots({ prod: "none", stage: "in_progress", demo: "none" }, false), true);
  });

  it("hides all-unknown dots for an untracked repo (transient API failure, not evidence of tracking)", () => {
    assert.equal(shouldShowDeployDots({ prod: "unknown", stage: "unknown", demo: "unknown" }, false), false);
  });

  it("shows all-unknown dots for a tracked repo (API temporarily unreachable, but repo is known to deploy)", () => {
    assert.equal(shouldShowDeployDots({ prod: "unknown", stage: "unknown", demo: "unknown" }, true), true);
  });
});
