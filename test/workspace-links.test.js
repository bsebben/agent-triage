import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// workspace-links.js is a plain browser script rather than a module, so it is evaluated in a
// sandbox to exercise the code the browser actually loads.
const sandbox = { escapeHtml: (s) => String(s) };
createContext(sandbox);
runInContext(readFileSync(new URL("../public/workspace-links.js", import.meta.url), "utf-8"), sandbox);
const { findWorkspaceLinks, renderWorkspaceLinks } = sandbox;

const ticket = (key) => ({ key, summary: `summary ${key}`, url: `https://jira.example.com/browse/${key}` });
const pr = (number, repo) => ({ number, title: `title ${number}`, url: `https://github.com/org/${repo}/pull/${number}` });

const tickets = [{ key: "MP-1", tickets: [ticket("MP-10"), ticket("MP-11")] }];
const pulls = {
  mine: [{ repo: "my-service", prs: [pr(123, "my-service")] }],
  reviews: [{ repo: "other-service", prs: [pr(123, "other-service"), pr(7, "other-service")] }],
  merged: [{ repo: "my-service", prs: [pr(50, "my-service")] }],
  assigned: [],
};
// Round-trips through JSON because arrays built inside the vm context fail deepEqual against local ones.
const plain = (v) => JSON.parse(JSON.stringify(v));
const links = (item) => plain(findWorkspaceLinks(item, { pulls, tickets }));

describe("findWorkspaceLinks", () => {
  it("links a ticket key found in the workspace title", () => {
    assert.deepEqual(links({ workspaceTitle: "MP-10: Fix the thing" }), [
      { kind: "ticket", label: "MP-10", url: "https://jira.example.com/browse/MP-10", title: "summary MP-10" },
    ]);
  });

  it("links a ticket key found in the git branch", () => {
    const [link] = links({ workspaceTitle: "scratch", gitBranch: "brian/MP-11-cleanup" });
    assert.equal(link.label, "MP-11");
  });

  it("links the same ticket once when title and branch both name it", () => {
    assert.equal(links({ workspaceTitle: "MP-10: x", gitBranch: "MP-10-x" }).length, 1);
  });

  it("ignores ids that look like tickets but are not loaded", () => {
    assert.deepEqual(links({ workspaceTitle: "Upgrade to UTF-8, see MP-999" }), []);
  });

  it("links a PR number that is unique across loaded PRs", () => {
    const [link] = links({ workspaceTitle: "PR #7: tweak" });
    assert.equal(link.kind, "pr");
    assert.equal(link.label, "#7");
  });

  it("prefers the workspace's own repo when a PR number exists in several", () => {
    const [link] = links({ workspaceTitle: "PR #123: x", repoRoot: "/work/other-service" });
    assert.equal(link.url, "https://github.com/org/other-service/pull/123");
  });

  it("skips an ambiguous PR number when the workspace repo does not decide it", () => {
    assert.deepEqual(links({ workspaceTitle: "PR #123: x", repoRoot: "/work/unrelated" }), []);
  });

  it("resolves merged PRs that are still loaded", () => {
    assert.equal(links({ workspaceTitle: "PR #50: done" })[0].label, "#50");
  });

  it("returns nothing for a workspace with no title or branch", () => {
    assert.deepEqual(links({}), []);
  });

  it("returns nothing before the tabs have loaded", () => {
    assert.deepEqual(plain(findWorkspaceLinks({ workspaceTitle: "MP-10 PR #7" }, {})), []);
  });
});

describe("renderWorkspaceLinks", () => {
  it("renders nothing without links", () => {
    assert.equal(renderWorkspaceLinks([]), "");
  });

  it("renders a clickable pill per link", () => {
    const html = renderWorkspaceLinks(links({ workspaceTitle: "MP-10: x" }));
    assert.match(html, /class="card-link card-link-ticket"/);
    assert.match(html, /href="https:\/\/jira\.example\.com\/browse\/MP-10"/);
    assert.match(html, /openExternalClick/);
  });
});
