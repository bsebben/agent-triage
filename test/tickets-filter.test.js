import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// tickets.client.js is a plain browser script rather than a module, so there is nothing to
// import. Evaluating it in a sandbox exercises the code the browser actually loads,
// instead of a copy in the test that could drift away from it.
const sandbox = {
  state: { tabStatus: { tickets: { available: true } }, tickets: [] },
  appConfig: {},
  queue: { innerHTML: "" },
  escapeHtml: (s) => String(s),
  workspaceLimitBanner: () => "",
  isAtWorkspaceLimit: () => false,
  claudeIcon: () => "",
};
createContext(sandbox);
runInContext(
  readFileSync(new URL("../src/tabs/tickets.client.js", import.meta.url), "utf-8"),
  sandbox,
);
const {
  collectTicketStatuses,
  filterTicketGroups,
  filterTicketGroupsByStatus,
  setTicketsStatusFilter,
  toggleTicketsBacklog,
} = sandbox;

// The two filter flags are `let` bindings at the top of the script, which live in the
// context's global lexical scope rather than on the sandbox object, so they have to be
// read back by evaluating them inside the same context.
const statusFilter = () => runInContext("ticketsStatusFilter", sandbox);
const showBacklog = () => runInContext("ticketsShowBacklog", sandbox);

const ticket = (key, status) => ({ key, status, summary: `summary ${key}`, url: `https://x/${key}` });
const group = (key, tickets) => ({ key, summary: `parent ${key}`, url: `https://x/${key}`, tickets });

// Array.from runs in the host realm, so the result carries the host's Array.prototype.
// The sandbox-realm array these functions return fails deepEqual on prototype identity
// even when the contents match.
const statuses = (groups) => Array.from(collectTicketStatuses(groups));
const keys = (groups) => Array.from(groups, (g) => g.key);

describe("collectTicketStatuses", () => {
  it("dedupes and sorts case-insensitively", () => {
    const groups = [
      group("P-1", [ticket("a", "in progress"), ticket("b", "To Do"), ticket("c", "in progress")]),
      group("P-2", [ticket("d", "Backlog"), ticket("e", "To Do")]),
    ];
    assert.deepEqual(statuses(groups), ["Backlog", "in progress", "To Do"]);
  });

  it("excludes Backlog once the backlog filter has run", () => {
    const groups = [
      group("P-1", [ticket("a", "In Progress"), ticket("b", "Backlog")]),
      group("P-2", [ticket("c", "Backlog")]),
    ];
    assert.deepEqual(statuses(groups), ["Backlog", "In Progress"]);
    assert.equal(showBacklog(), false);
    assert.deepEqual(statuses(filterTicketGroups(groups)), ["In Progress"]);
  });

  it("ignores tickets with no status", () => {
    const groups = [group("P-1", [ticket("a", "To Do"), ticket("b", "")])];
    assert.deepEqual(statuses(groups), ["To Do"]);
  });
});

describe("filterTicketGroupsByStatus", () => {
  const groups = [
    group("P-1", [ticket("a", "In Progress"), ticket("b", "To Do")]),
    group("P-2", [ticket("c", "To Do")]),
  ];

  it("drops groups left with zero tickets", () => {
    const filtered = filterTicketGroupsByStatus(groups, "In Progress");
    assert.deepEqual(keys(filtered), ["P-1"]);
    assert.deepEqual(Array.from(filtered[0].tickets, (t) => t.key), ["a"]);
  });

  it("keeps every group that still has a match", () => {
    assert.deepEqual(keys(filterTicketGroupsByStatus(groups, "To Do")), ["P-1", "P-2"]);
  });

  it("passes groups through unchanged when no status is selected", () => {
    assert.equal(filterTicketGroupsByStatus(groups, ""), groups);
  });

  it("does not mutate the groups it filters", () => {
    filterTicketGroupsByStatus(groups, "In Progress");
    assert.equal(groups[0].tickets.length, 2);
  });
});

describe("stale status selection", () => {
  it("clears a status the backlog toggle has just hidden", () => {
    sandbox.state.tickets = [
      group("P-1", [ticket("a", "In Progress"), ticket("b", "Backlog")]),
    ];

    toggleTicketsBacklog();
    assert.equal(showBacklog(), true);

    setTicketsStatusFilter("Backlog");
    assert.equal(statusFilter(), "Backlog");
    assert.match(sandbox.queue.innerHTML, /summary b/);

    // Hiding backlog removes the only ticket the filter matched. Leaving the selection in
    // place would render a dropdown without that option and strand the user on an empty
    // list they cannot clear.
    toggleTicketsBacklog();
    assert.equal(showBacklog(), false);
    assert.equal(statusFilter(), "");
    assert.match(sandbox.queue.innerHTML, /summary a/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /No active tickets/);
  });
});
