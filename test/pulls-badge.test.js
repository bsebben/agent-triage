import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// pulls.client.js is a plain browser script rather than a module, so there is nothing to
// import. Evaluating it in a sandbox exercises the code the browser actually loads,
// instead of a copy in the test that could drift away from it.
const sandbox = { state: {}, appConfig: {} };
createContext(sandbox);
runInContext(
  readFileSync(new URL("../src/tabs/pulls.client.js", import.meta.url), "utf-8"),
  sandbox,
);
const { pullsBadge, getPullsConfig, prNeedsAction } = sandbox;

const pr = (url, extra = {}) => ({ url, status: "open", ci: "passing", ...extra });
const group = (repo, prs) => ({ repo, prs });

describe("pullsBadge", () => {
  const pulls = {
    mine: [group("a", [
      pr("https://x/a/1", { status: "approved" }),
      pr("https://x/a/2", { ci: "failing" }),
      pr("https://x/a/3"),
    ])],
    // 300-odd rows in reality, truncated to the fetch ceiling — must never be counted.
    reviews: [group("b", [
      pr("https://x/b/1", { status: "comments" }),
      pr("https://x/b/2"),
      pr("https://x/b/9", { ci: "failing" }),
    ])],
    assigned: [group("b", [
      pr("https://x/b/1", { status: "comments" }),
      pr("https://x/b/3"),
    ])],
  };

  // Array.from runs in the host realm, so the result has the host's Array.prototype.
  // b.parts.map() would return a sandbox-realm array, which deepStrictEqual rejects on
  // prototype identity even when the contents match — same cross-realm trap as below.
  // Array.from runs in the host realm, so the result has the host's Array.prototype.
  // b.parts.map() would return a sandbox-realm array, which deepStrictEqual rejects on
  // prototype identity even when the contents match — same cross-realm trap as below.
  const texts = (b) => Array.from(b.parts, (p) => p.text);
  const variants = (b) => Array.from(b.parts, (p) => p.variant);

  it("renders two pills: own PRs needing action, then direct review requests", () => {
    const b = pullsBadge(pulls);
    assert.deepEqual(texts(b), ["2", "2"]);
    assert.deepEqual(variants(b), ["mine", "reviews"]);
    assert.equal(b.total, 4);
  });

  it("gives each pill its own tooltip, so colour is not the only cue", () => {
    const [mine, reviews] = pullsBadge(pulls).parts;
    assert.match(mine.title, /your PRs need action/);
    assert.match(reviews.title, /assigned directly as a reviewer/);
    assert.notEqual(mine.title, reviews.title);
  });

  it("uses two distinct colour variants", () => {
    // Guards the pairing the palette validator cleared; a regression to one variant
    // would silently make the two pills indistinguishable.
    assert.equal(new Set(variants(pullsBadge(pulls))).size, 2);
  });

  it("omits the mine pill entirely when no PR of yours needs action", () => {
    const onlyReviews = { mine: [], reviews: [], assigned: [group("b", [pr("https://x/b/3")])] };
    const b = pullsBadge(onlyReviews);
    assert.deepEqual(texts(b), ["1"]);
    assert.deepEqual(variants(b), ["reviews"]);
  });

  it("omits the reviews pill entirely when nothing awaits your review", () => {
    const onlyMine = { mine: [group("a", [pr("https://x/a/1", { status: "approved" })])], reviews: [], assigned: [] };
    const b = pullsBadge(onlyMine);
    assert.deepEqual(texts(b), ["1"]);
    assert.deepEqual(variants(b), ["mine"]);
  });

  it("never counts the row-capped team-inclusive reviews bucket", () => {
    // b/9 is failing CI and lives only in `reviews` — it must not reach the badge.
    const teamOnly = { mine: [], reviews: pulls.reviews, assigned: [] };
    const b = pullsBadge(teamOnly);
    assert.equal(b.total, 0);
    assert.equal(b.parts.length, 0);
  });

  it("dedupes a PR listed twice within a bucket", () => {
    const dupe = { mine: [group("a", [
      pr("https://x/a/1", { status: "approved" }),
      pr("https://x/a/1", { status: "approved" }),
    ])], reviews: [], assigned: [] };
    assert.equal(pullsBadge(dupe).total, 1);
  });

  it("emits no pills and no tooltip when there is nothing to show", () => {
    const b = pullsBadge({});
    assert.equal(b.parts.length, 0);
    assert.equal(b.total, 0);
    assert.equal(b.title, "");
  });

  it("joins the pill tooltips for the tab-level tooltip", () => {
    const t = pullsBadge(pulls).title;
    assert.match(t, /need action/);
    assert.match(t, /assigned directly as a reviewer/);
    assert.match(t, / \u00b7 /);
  });

  it("uses singular copy for a count of one", () => {
    const one = {
      mine: [group("a", [pr("https://x/a/1", { status: "approved" })])],
      reviews: [],
      assigned: [group("b", [pr("https://x/b/3")])],
    };
    const [mine, reviews] = pullsBadge(one).parts;
    assert.equal(mine.title, "1 of your PRs needs action");
    assert.equal(reviews.title, "1 PR where you're assigned directly as a reviewer");
  });
});

describe("prNeedsAction", () => {
  it("flags approved, commented, queue-failed, and failing-CI PRs", () => {
    for (const p of [{ status: "approved" }, { status: "comments" }, { status: "queue_failed" }, { ci: "failing" }]) {
      assert.equal(prNeedsAction(p), true, JSON.stringify(p));
    }
  });

  it("ignores plain open and draft PRs with healthy CI", () => {
    assert.equal(prNeedsAction({ status: "open", ci: "passing" }), false);
    assert.equal(prNeedsAction({ status: "draft", ci: "none" }), false);
  });
});

describe("getPullsConfig", () => {
  it("prefers the live tabStatus payload over the load-time config", () => {
    sandbox.state = { tabStatus: { pulls: { badgeCount: "reviews" } } };
    sandbox.appConfig = { pulls: { badgeCount: "actionable" } };
    assert.equal(getPullsConfig().badgeCount, "reviews");
  });

  it("falls back to appConfig before tabStatus arrives", () => {
    sandbox.state = {};
    sandbox.appConfig = { pulls: { badgeCount: "reviews" } };
    assert.equal(getPullsConfig().badgeCount, "reviews");
  });

  it("returns an empty object when neither source has pulls config", () => {
    sandbox.state = {};
    sandbox.appConfig = {};
    // Objects built inside the sandbox carry that realm's prototype, so deepStrictEqual
    // against a literal here fails on cross-realm identity. Assert on shape instead.
    assert.equal(Object.keys(getPullsConfig()).length, 0);
  });
});
