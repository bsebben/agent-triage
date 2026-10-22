import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// Same approach as pulls-badge.test.js: evaluate the browser scripts as loaded, in a sandbox.
const sandbox = {
  state: {},
  appConfig: {},
  escapeHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  isAtWorkspaceLimit: () => false,
  claudeIcon: () => "",
  statusCell: () => '<td class="pull-status"></td>',
  ciCell: () => "",
  deployDots: () => "",
  slaLevel: () => null,
  slaTooltip: () => "",
};
createContext(sandbox);
for (const file of ["../public/workspace-links.js", "../public/pull-icons.js", "../src/tabs/pulls.client.js"]) {
  runInContext(readFileSync(new URL(file, import.meta.url), "utf-8"), sandbox);
}
const { renderPullRow } = sandbox;

const pr = { number: 7, title: "Fix thing", url: "https://example.com/pr/7", author: "someone", reviewers: null, ci: null };

describe("renderPullRow", () => {
  it("places the author cell before the title cell", () => {
    const html = renderPullRow(pr, true, "my-project", "mine", 3);
    assert.ok(html.indexOf('class="pull-author"') >= 0);
    assert.ok(html.indexOf('class="pull-author"') < html.indexOf('class="pull-title"'));
  });

  it("omits the author cell when showAuthor is false", () => {
    const html = renderPullRow(pr, false, "my-project", "mine", 3);
    assert.doesNotMatch(html, /pull-author/);
  });
});
