// test/tickets.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyExcludeProjects } from "../src/tabs/tickets.js";

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
