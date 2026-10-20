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
const { reviewerGroupsCell } = sandbox;

const group = (extra = {}) => ({ approved: [], blocked: [], unresolvedThreads: 0, ...extra });
const reviewers = (human = {}, bot = {}, threadsTruncated = false) => ({
  human: group(human), bot: group(bot), threadsTruncated,
});

describe("reviewerGroupsCell", () => {
  it("renders an empty cell when there is nothing to show", () => {
    assert.equal(reviewerGroupsCell(reviewers()), '<td class="pull-reviews"></td>');
  });

  it("renders only the groups that have indicators", () => {
    const html = reviewerGroupsCell(reviewers({}, { approved: ["example-bot"] }));
    assert.match(html, /pull-rev-bot/);
    assert.doesNotMatch(html, /pull-rev-human/);
  });

  it("shows a muted 0+ on the human group when threads were cut off and none of the fetched ones are unresolved", () => {
    const html = reviewerGroupsCell(reviewers({}, {}, true));
    assert.match(html, /pull-rev-human/);
    assert.match(html, /pull-rev-unknown/);
    assert.match(html, />0\+</);
  });

  it("does not add the 0+ marker when some unresolved threads were found", () => {
    const html = reviewerGroupsCell(reviewers({ unresolvedThreads: 2 }, {}, true));
    assert.doesNotMatch(html, /pull-rev-unknown/);
    assert.match(html, />2\+</);
  });

  it("escapes reviewer logins in tooltips", () => {
    const html = reviewerGroupsCell(reviewers({ blocked: ['"><img src=x onerror=alert(1)>'] }));
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });
});
