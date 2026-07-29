// test/pulls.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  prStatus,
  parseDeployments,
  capMergedGroups,
  resolveDeploy,
  isTerminalDeploy,
} from "../src/tabs/pulls.js";

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

describe("isTerminalDeploy", () => {
  it("is terminal when every environment has settled (deployed/none/errored)", () => {
    assert.equal(isTerminalDeploy({ prod: "deployed", stage: "deployed", demo: "deployed" }), true);
    // Common partial-deploy case: a repo that only deploys to prod. This must be
    // terminal so the cache engages instead of re-fetching forever.
    assert.equal(isTerminalDeploy({ prod: "deployed", stage: "none", demo: "none" }), true);
    assert.equal(isTerminalDeploy({ prod: "errored", stage: "none", demo: "deployed" }), true);
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
});
