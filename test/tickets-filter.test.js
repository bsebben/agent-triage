import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

// tickets.client.js is a plain browser script rather than a module, so there is nothing to
// import. Evaluating it in a sandbox exercises the code the browser actually loads,
// instead of a copy in the test that could drift away from it.
const sandbox = {
  state: { tabStatus: { tickets: { available: true, pillStatuses: ["Backlog", "Acceptance"] } }, tickets: [] },
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
  collectTicketPills,
  collectTicketStatuses,
  filterTicketGroups,
  filterTicketGroupsByStatus,
  setTicketsStatusFilter,
  toggleTicketsPill,
} = sandbox;

// The filter is a `let` binding at the top of the script, which lives in the context's
// global lexical scope rather than on the sandbox object, so it has to be read back by
// evaluating it inside the same context.
const statusFilter = () => runInContext("ticketsStatusFilter", sandbox);

const PILLS = ["Backlog", "Acceptance"];
const ticket = (key, status) => ({ key, status, summary: `summary ${key}`, url: `https://x/${key}` });
const group = (key, tickets) => ({ key, summary: `parent ${key}`, url: `https://x/${key}`, tickets });

// Array.from runs in the host realm, so the result carries the host's Array.prototype.
// The sandbox-realm array these functions return fails deepEqual on prototype identity
// even when the contents match.
const statuses = (groups) => Array.from(collectTicketStatuses(groups));
const keys = (groups) => Array.from(groups, (g) => g.key);
const pillSummary = (groups, pills) =>
  Array.from(collectTicketPills(groups, pills), (p) => `${p.status}:${p.count}`);

const setTickets = (groups, pillStatuses = PILLS) => {
  sandbox.state.tickets = groups;
  sandbox.state.tabStatus.tickets.pillStatuses = pillStatuses;
};

beforeEach(() => {
  setTicketsStatusFilter("");
});

describe("collectTicketStatuses", () => {
  it("dedupes and sorts case-insensitively", () => {
    const groups = [
      group("P-1", [ticket("a", "in progress"), ticket("b", "To Do"), ticket("c", "in progress")]),
      group("P-2", [ticket("d", "Backlog"), ticket("e", "To Do")]),
    ];
    assert.deepEqual(statuses(groups), ["Backlog", "in progress", "To Do"]);
  });

  it("ignores tickets with no status", () => {
    const groups = [group("P-1", [ticket("a", "To Do"), ticket("b", "")])];
    assert.deepEqual(statuses(groups), ["To Do"]);
  });
});

describe("filterTicketGroups (Active view)", () => {
  const groups = [
    group("P-1", [ticket("a", "In Progress"), ticket("b", "Backlog")]),
    group("P-2", [ticket("c", "Acceptance"), ticket("d", "backlog")]),
    group("P-3", [ticket("e", "In Review")]),
  ];

  it("drops pill statuses case-insensitively and empty groups", () => {
    const active = filterTicketGroups(groups, PILLS);
    assert.deepEqual(keys(active), ["P-1", "P-3"]);
    assert.deepEqual(Array.from(active[0].tickets, (t) => t.key), ["a"]);
  });

  it("keeps everything when no pill statuses are configured", () => {
    assert.deepEqual(keys(filterTicketGroups(groups, [])), ["P-1", "P-2", "P-3"]);
  });

  it("does not mutate the groups it filters", () => {
    filterTicketGroups(groups, PILLS);
    assert.equal(groups[0].tickets.length, 2);
  });
});

describe("collectTicketPills", () => {
  it("counts per status, uses Jira's own spelling, and follows config order", () => {
    const groups = [
      group("P-1", [ticket("a", "acceptance"), ticket("b", "Backlog")]),
      group("P-2", [ticket("c", "Backlog"), ticket("d", "In Progress")]),
    ];
    assert.deepEqual(pillSummary(groups, PILLS), ["Backlog:2", "acceptance:1"]);
  });

  it("omits configured statuses no ticket carries", () => {
    const groups = [group("P-1", [ticket("a", "In Progress")])];
    assert.deepEqual(pillSummary(groups, PILLS), []);
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

describe("default Active view rendering", () => {
  it("hides pill-status tickets and shows a pill with a count", () => {
    setTickets([group("P-1", [ticket("a", "In Progress"), ticket("b", "Backlog"), ticket("c", "Acceptance")])]);
    setTicketsStatusFilter("");
    assert.match(sandbox.queue.innerHTML, /summary a/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /summary b/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /summary c/);
    assert.match(sandbox.queue.innerHTML, /Backlog \(1\)/);
    assert.match(sandbox.queue.innerHTML, /Acceptance \(1\)/);
  });

  it("renders no pill for a configured status nobody has", () => {
    setTickets([group("P-1", [ticket("a", "In Progress"), ticket("b", "Backlog")])]);
    setTicketsStatusFilter("");
    assert.match(sandbox.queue.innerHTML, /Backlog \(1\)/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /Acceptance/);
  });

  it("shows every ticket and no pills when pillStatuses is empty", () => {
    setTickets([group("P-1", [ticket("a", "In Progress"), ticket("b", "Backlog")])], []);
    setTicketsStatusFilter("");
    assert.match(sandbox.queue.innerHTML, /summary a/);
    assert.match(sandbox.queue.innerHTML, /summary b/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /tickets-filter-btn/);
  });
});

describe("pills", () => {
  const groups = [group("P-1", [ticket("a", "In Progress"), ticket("b", "Backlog"), ticket("c", "Acceptance")])];

  it("shows only that status when its pill is selected", () => {
    setTickets(groups);
    toggleTicketsPill("Backlog");
    assert.equal(statusFilter(), "Backlog");
    assert.match(sandbox.queue.innerHTML, /summary b/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /summary a/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /summary c/);
  });

  it("returns to the Active view when the selected pill is clicked again", () => {
    setTickets(groups);
    toggleTicketsPill("Backlog");
    toggleTicketsPill("Backlog");
    assert.equal(statusFilter(), "");
    assert.match(sandbox.queue.innerHTML, /summary a/);
  });

  it("switches directly between pills", () => {
    setTickets(groups);
    toggleTicketsPill("Backlog");
    toggleTicketsPill("Acceptance");
    assert.equal(statusFilter(), "Acceptance");
    assert.match(sandbox.queue.innerHTML, /summary c/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /summary b/);
  });

  it("clears a selected pill once its status leaves the data", () => {
    setTickets(groups);
    toggleTicketsPill("Backlog");
    setTickets([group("P-1", [ticket("a", "In Progress"), ticket("c", "Acceptance")])]);
    setTicketsStatusFilter("Backlog");
    assert.equal(statusFilter(), "");
    assert.match(sandbox.queue.innerHTML, /summary a/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /No active tickets/);
  });

  it("keeps the pills reachable when every ticket is in a pill status", () => {
    setTickets([group("P-1", [ticket("b", "Backlog")])]);
    setTicketsStatusFilter("");
    assert.match(sandbox.queue.innerHTML, /No active tickets/);
    assert.match(sandbox.queue.innerHTML, /Backlog \(1\)/);
  });
});

describe("status filter dropdown", () => {
  it("hides the dropdown when only one non-pill status is present", () => {
    setTickets([group("P-1", [ticket("a", "In Progress"), ticket("b", "In Progress"), ticket("c", "Backlog")])]);
    setTicketsStatusFilter("");
    assert.doesNotMatch(sandbox.queue.innerHTML, /tickets-filter-select/);
  });

  it("shows the dropdown once a second non-pill status is present", () => {
    setTickets([group("P-1", [ticket("a", "In Progress"), ticket("b", "To Do")])]);
    setTicketsStatusFilter("");
    assert.match(sandbox.queue.innerHTML, /tickets-filter-select/);
  });

  it("defaults to Active and never offers a pill status", () => {
    setTickets([group("P-1", [ticket("a", "In Progress"), ticket("b", "To Do"), ticket("c", "Backlog")])]);
    setTicketsStatusFilter("");
    assert.match(sandbox.queue.innerHTML, /<option value="">Active<\/option>/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /<option value="Backlog"/);
  });

  it("filters to the chosen status within the Active view", () => {
    setTickets([group("P-1", [ticket("a", "In Progress"), ticket("b", "To Do"), ticket("c", "Backlog")])]);
    setTicketsStatusFilter("To Do");
    assert.match(sandbox.queue.innerHTML, /summary b/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /summary a/);
    assert.doesNotMatch(sandbox.queue.innerHTML, /summary c/);
  });
});
