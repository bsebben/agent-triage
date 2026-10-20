import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// Same approach as pulls-badge.test.js: evaluate the browser scripts as loaded, in a sandbox.
// escapeHtml is defined by app.js in the browser; this stub covers the characters that matter.
const sandbox = {
  state: {},
  appConfig: {},
  escapeHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
};
createContext(sandbox);
for (const file of ["../public/pull-icons.js", "../src/tabs/pulls.client.js"]) {
  runInContext(readFileSync(new URL(file, import.meta.url), "utf-8"), sandbox);
}
const { reviewerGroupsHtml, reviewsCell, statusCell } = sandbox;

const group = (extra = {}) => ({ approved: [], blocked: [], unresolvedThreads: 0, ...extra });
const reviewers = (human = {}, bot = {}, threadsTruncated = false) => ({
  human: group(human), bot: group(bot), threadsTruncated,
});

describe("reviewerGroupsHtml", () => {
  it("renders nothing when there is nothing to show", () => {
    assert.equal(reviewerGroupsHtml(reviewers()), "");
  });

  it("renders only the groups that have indicators", () => {
    const html = reviewerGroupsHtml(reviewers({}, { approved: ["example-bot"] }));
    assert.match(html, /pull-rev-bot/);
    assert.doesNotMatch(html, /pull-rev-human/);
  });

  it("shows a muted 0+ on the human group when threads were cut off and none of the fetched ones are unresolved", () => {
    const html = reviewerGroupsHtml(reviewers({}, {}, true));
    assert.match(html, /pull-rev-human/);
    assert.match(html, /pull-rev-unknown/);
    assert.match(html, />0\+</);
  });

  it("does not add the 0+ marker when some unresolved threads were found", () => {
    const html = reviewerGroupsHtml(reviewers({ unresolvedThreads: 2 }, {}, true));
    assert.doesNotMatch(html, /pull-rev-unknown/);
    assert.match(html, />2\+</);
  });

  it("escapes reviewer logins in tooltips", () => {
    const html = reviewerGroupsHtml(reviewers({ blocked: ['"><img src=x onerror=alert(1)>'] }));
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });
});

describe("statusCell", () => {
  const prWith = (status, rev) => ({ status, reviewers: rev });

  it("shows the blocked icon for a comments PR with a changes-requested review", () => {
    const html = statusCell(prWith("comments", reviewers({ blocked: ["bob"] })));
    assert.match(html, /status-blocked/);
    assert.match(html, /title="changes requested"/);
  });

  it("also treats a bot's changes-requested review as blocking", () => {
    assert.match(statusCell(prWith("comments", reviewers({}, { blocked: ["example-bot"] }))), /status-blocked/);
  });

  it("keeps the comments icon when nothing blocks", () => {
    const html = statusCell(prWith("comments", reviewers({ unresolvedThreads: 2 })));
    assert.match(html, /status-comments/);
    assert.doesNotMatch(html, /status-blocked/);
  });

  it("leaves other statuses alone even if reviewer data says blocked", () => {
    assert.match(statusCell(prWith("queued", reviewers({ blocked: ["bob"] }))), /status-queued/);
  });

  it("handles a PR with no reviewer data", () => {
    assert.match(statusCell({ status: "comments" }), /status-comments/);
  });
});

describe("reviewsCell", () => {
  const pr = (ci, rev = reviewers()) => ({ ci, reviewers: rev });

  it("holds a labelled CI pill even when nobody has reviewed", () => {
    const html = reviewsCell(pr("passing"));
    assert.match(html, /^<td class="pull-reviews">/);
    assert.match(html, /pull-ci-pill ci-passing/);
    assert.match(html, />CI</);
  });

  it("puts the reviewer groups before the CI pill", () => {
    const html = reviewsCell(pr("failing", reviewers({ blocked: ["bob"] })));
    assert.ok(html.indexOf("pull-rev-human") < html.indexOf("pull-ci-pill"));
    assert.match(html, /ci-failing/);
  });

  it("renders the CI pill when reviewer data is missing", () => {
    assert.match(reviewsCell({ ci: "running" }), /ci-running/);
  });
});
