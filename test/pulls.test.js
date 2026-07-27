// test/pulls.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { prStatus } from "../src/tabs/pulls.js";

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
});
