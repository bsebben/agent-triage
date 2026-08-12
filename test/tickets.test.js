// test/tickets.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyExcludeProjects, paginateIssues } from "../src/tabs/tickets.js";

const DEFAULT_JQL = "assignee = currentUser() AND statusCategory != Done ORDER BY status ASC";

// Mirrors stripOrderBy() in tickets.js — the runtime path that paginateIssues
// runs the JQL through. If the injected clause doesn't survive this, the filter
// silently vanishes at query time.
const stripOrderBy = (jql) => jql.replace(/\s+ORDER\s+BY\s+.+$/i, "").trim();

describe("applyExcludeProjects", () => {
  it("returns the JQL unchanged when excludeProjects is null", () => {
    assert.equal(applyExcludeProjects(DEFAULT_JQL, null), DEFAULT_JQL);
  });

  it("returns the JQL unchanged when excludeProjects is empty or whitespace", () => {
    assert.equal(applyExcludeProjects(DEFAULT_JQL, ""), DEFAULT_JQL);
    assert.equal(applyExcludeProjects(DEFAULT_JQL, "  ,  , "), DEFAULT_JQL);
  });

  it("injects a quoted project NOT IN clause for a single key", () => {
    const out = applyExcludeProjects(DEFAULT_JQL, "USPUDU");
    assert.ok(out.includes('project NOT IN ("USPUDU")'));
  });

  it("handles multiple comma-separated keys and trims whitespace", () => {
    const out = applyExcludeProjects(DEFAULT_JQL, "USPUDU, BBO , FOO");
    assert.ok(out.includes('project NOT IN ("USPUDU", "BBO", "FOO")'));
  });

  it("places the clause BEFORE ORDER BY so it survives stripOrderBy", () => {
    const out = applyExcludeProjects(DEFAULT_JQL, "USPUDU");
    // Positional guarantee: the filter must precede ORDER BY.
    assert.ok(out.indexOf("project NOT IN") < out.indexOf("ORDER BY"));
    // Runtime guarantee: the clause is still present after pagination strips ORDER BY.
    assert.ok(stripOrderBy(out).includes('project NOT IN ("USPUDU")'));
  });

  it("appends the clause when the JQL has no ORDER BY", () => {
    const noOrder = "assignee = currentUser() AND statusCategory != Done";
    const out = applyExcludeProjects(noOrder, "BBO");
    assert.equal(out, `${noOrder} AND project NOT IN ("BBO")`);
  });
});

describe("paginateIssues", () => {
  const issue = (key) => ({ key, fields: {} });

  it("resumes across pages via nextPageToken — including a simulated project boundary "
    + "where a key-string cursor (`key > lastKey`) would have silently matched nothing", async () => {
    // GXP/PO sort before USPGIA alphabetically but have lower internal issue IDs — the bug
    // this pagination replaced compared `key >` against internal ID, so crossing from
    // "PO-1773" to "USPGIA-1169" (numerically lower) matched zero issues. A token-based
    // transport has no such assumption; simulate exactly that boundary.
    const pages = {
      null: { issues: [issue("GXP-1462"), issue("PO-1773")], isLast: false, nextPageToken: "tok1" },
      tok1: { issues: [issue("USPGIA-1169"), issue("USPGIA-1171")], isLast: false, nextPageToken: "tok2" },
      tok2: { issues: [issue("USPGIA-1173")], isLast: true },
    };
    const calls = [];
    const transport = {
      pageSize: 2,
      async searchIssues(cloudId, jql, fields, maxResults, pageToken) {
        calls.push(pageToken);
        return pages[pageToken ?? "null"];
      },
    };

    const result = await paginateIssues("cloud1", "assignee = currentUser() ORDER BY status ASC", transport);

    assert.deepEqual(result.map((i) => i.key), ["GXP-1462", "PO-1773", "USPGIA-1169", "USPGIA-1171", "USPGIA-1173"]);
    assert.deepEqual(calls, [null, "tok1", "tok2"]);
  });

  it("fetches with a fixed ORDER BY key ASC regardless of the caller's own ordering", async () => {
    let seenJql = null;
    const transport = {
      pageSize: 10,
      async searchIssues(cloudId, jql) {
        seenJql = jql;
        return { issues: [], isLast: true };
      },
    };
    await paginateIssues("cloud1", "assignee = currentUser() AND statusCategory != Done ORDER BY status ASC", transport);
    assert.equal(seenJql, "assignee = currentUser() AND statusCategory != Done ORDER BY key ASC");
  });

  it("stops as soon as a page reports isLast", async () => {
    let calls = 0;
    const transport = {
      pageSize: 10,
      async searchIssues() {
        calls++;
        return { issues: [issue("A-1")], isLast: true, nextPageToken: "should-be-ignored" };
      },
    };
    const result = await paginateIssues("cloud1", "ORDER BY key ASC", transport);
    assert.equal(calls, 1);
    assert.equal(result.length, 1);
  });

  it("stops when isLast is false but no nextPageToken is present, instead of looping forever "
    + "(e.g. a truncated response with no safe cursor to resume from)", async () => {
    let calls = 0;
    const transport = {
      pageSize: 10,
      async searchIssues() {
        calls++;
        return { issues: [issue("A-1")], isLast: false }; // no nextPageToken
      },
    };
    const result = await paginateIssues("cloud1", "ORDER BY key ASC", transport);
    assert.equal(calls, 1);
    assert.equal(result.length, 1);
  });

  it("stops once PAGE_LIMIT (100) issues are collected even with more pages available", async () => {
    let calls = 0;
    const transport = {
      pageSize: 50,
      async searchIssues(cloudId, jql, fields, maxResults, pageToken) {
        calls++;
        const start = calls * 50;
        return {
          issues: Array.from({ length: 50 }, (_, i) => issue(`A-${start + i}`)),
          isLast: false,
          nextPageToken: `tok${calls}`,
        };
      },
    };
    const result = await paginateIssues("cloud1", "ORDER BY key ASC", transport);
    assert.equal(calls, 2);
    assert.equal(result.length, 100);
  });

  it("caps at 20 pages even if PAGE_LIMIT hasn't been reached", async () => {
    let calls = 0;
    const transport = {
      pageSize: 1,
      async searchIssues(cloudId, jql, fields, maxResults, pageToken) {
        calls++;
        return { issues: [issue(`A-${calls}`)], isLast: false, nextPageToken: `tok${calls}` };
      },
    };
    const result = await paginateIssues("cloud1", "ORDER BY key ASC", transport);
    assert.equal(calls, 20);
    assert.equal(result.length, 20);
  });
});
