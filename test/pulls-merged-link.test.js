import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// Same approach as pulls-badge.test.js: evaluate the browser scripts as loaded, in a sandbox.
const sandbox = {
  state: {},
  appConfig: {},
  escapeHtml: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
};
createContext(sandbox);
for (const file of ["../public/pull-icons.js", "../src/tabs/pulls.client.js"]) {
  runInContext(readFileSync(new URL(file, import.meta.url), "utf-8"), sandbox);
}
const { repoMergedLink } = sandbox;

const hrefOf = (html) => decodeURIComponent(html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, "&"));

describe("repoMergedLink", () => {
  it("searches the viewer's merged PRs, including both authored and assigned", () => {
    const html = repoMergedLink({
      repo: "my-project",
      prs: [
        { repoWithOwner: "example-org/my-project", author: "someone-else" },
        { repoWithOwner: "example-org/my-project", author: "me" },
      ],
    });
    const href = hrefOf(html);
    assert.match(href, /^https:\/\/github\.com\/example-org\/my-project\/pulls\?q=/);
    assert.match(href, /author:@me/);
    assert.match(href, /assignee:@me/);
    assert.match(href, /OR/);
    assert.doesNotMatch(href, /someone-else/);
  });

  it("renders nothing for an empty group", () => {
    assert.equal(repoMergedLink({ repo: "my-project", prs: [] }), "");
  });
});
