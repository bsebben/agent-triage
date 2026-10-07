import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTitlePrompt, cleanTitle, generateTitle } from "../src/workspace-title.js";

describe("cleanTitle", () => {
  it("strips wrapping quotes and keeps the first non-empty line", () => {
    assert.equal(cleanTitle("\n'PR #5: fix flaky test'\nbecause...", "PR #5"), "PR #5: fix flaky test");
  });

  it("re-attaches the id when the model omits it", () => {
    assert.equal(cleanTitle("fix flaky test", "PR #5"), "PR #5: fix flaky test");
  });

  it("re-attaches the id when it only appears mid-title or as a prefix of another id", () => {
    assert.equal(cleanTitle("fix PR #50 regression", "PR #5"), "PR #5: fix PR #50 regression");
  });

  it("strips markdown bold", () => {
    assert.equal(cleanTitle("**PR #5: fix x**", "PR #5"), "PR #5: fix x");
  });

  it("caps the length", () => {
    assert.ok(cleanTitle("PR #5: " + "word ".repeat(30), "PR #5").length <= 60);
  });

  it("returns null for empty output", () => {
    assert.equal(cleanTitle("  \n ", "PR #5"), null);
  });
});

describe("generateTitle", () => {
  it("passes the prompt to the runner and cleans the result", async () => {
    let args;
    const title = await generateTitle("my-1", "Add retries", async (a) => { args = a; return "\"my-1: add retries\"\n"; });
    assert.equal(title, "my-1: add retries");
    assert.ok(args.includes("haiku"));
    assert.ok(args.includes("--no-session-persistence"));
    assert.equal(args.at(-2), "--");
    assert.equal(args.at(-1), buildTitlePrompt("my-1", "Add retries"));
  });

  it("resolves null when the runner fails", async () => {
    assert.equal(await generateTitle("my-1", "x", async () => { throw new Error("boom"); }), null);
  });
});
