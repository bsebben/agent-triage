import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNotifications, categorizeNotification, agentStateFromTags, AGENT_TITLE_PREFIX, findWindowIdForWorkspace } from "../src/cmux.js";

describe("agentStateFromTags", () => {
  const tags = (values) => Object.entries(values).map(([key, value]) => ({ key, value }));

  it("reads Idle as the user's turn", () => {
    assert.equal(agentStateFromTags(tags({ claude_code: "Idle" })), "idle");
  });

  it("reads Running, Running subagents and Waiting as the agent's turn", () => {
    for (const value of ["Running", "Running subagents", "Waiting"]) {
      assert.equal(agentStateFromTags(tags({ claude_code: value })), "running", value);
    }
  });

  it("reads Needs input on either tag as a permission request", () => {
    assert.equal(agentStateFromTags(tags({ claude_code: "Needs input" })), "permission");
    assert.equal(
      agentStateFromTags(tags({ claude_code: "Running", "cmux.feed.attention:claude_code": "Needs input" })),
      "permission"
    );
  });

  it("falls back to program_status when the claude_code tag is missing", () => {
    assert.equal(agentStateFromTags(tags({ program_status: "claude-code · Working" })), "running");
    assert.equal(agentStateFromTags(tags({ program_status: "claude-code · Done" })), "idle");
    assert.equal(agentStateFromTags(tags({ program_status: "claude-code · approve Bash: ls" })), "permission");
  });

  it("treats a tool description in program_status as the agent working", () => {
    assert.equal(agentStateFromTags(tags({ program_status: "claude-code · Reading the log" })), "running");
  });

  it("prefers claude_code over program_status when they disagree", () => {
    assert.equal(agentStateFromTags(tags({ claude_code: "Idle", program_status: "claude-code · Working" })), "idle");
  });

  it("returns null when no tag identifies a Claude session", () => {
    assert.equal(agentStateFromTags([]), null);
    assert.equal(agentStateFromTags(undefined), null);
    assert.equal(agentStateFromTags(tags({ program_status: "vim · editing" })), null);
  });
});

describe("parseNotifications", () => {
  it("parses cmux notification JSON into structured items", () => {
    const raw = {
      notifications: [
        {
          id: "ABC-123",
          workspace_id: "WS-1",
          surface_id: "SF-1",
          is_read: false,
          title: "Claude Code",
          subtitle: "Waiting",
          body: "Claude is waiting for your input",
        },
        {
          id: "DEF-456",
          workspace_id: "WS-2",
          surface_id: "SF-2",
          is_read: true,
          title: "Claude Code",
          subtitle: "Completed in my-project",
          body: "Task finished successfully",
        },
      ],
    };
    const result = parseNotifications(raw);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, "ABC-123");
    assert.equal(result[0].workspaceId, "WS-1");
    assert.equal(result[0].surfaceId, "SF-1");
    assert.equal(result[0].isRead, false);
    assert.equal(result[0].subtitle, "Waiting");
  });

  it("parses created_at into epoch milliseconds", () => {
    const raw = { notifications: [{ id: "A", workspace_id: "WS-1", created_at: "2026-11-18T18:49:49Z" }] };
    assert.equal(parseNotifications(raw)[0].createdAt, Date.parse("2026-11-18T18:49:49Z"));
  });

  it("leaves createdAt null when created_at is missing or malformed", () => {
    const raw = {
      notifications: [
        { id: "A", workspace_id: "WS-1" },
        { id: "B", workspace_id: "WS-1", created_at: "not a date" },
      ],
    };
    const result = parseNotifications(raw);
    assert.equal(result[0].createdAt, null);
    assert.equal(result[1].createdAt, null);
  });
});

describe("categorizeNotification", () => {
  // Backwards compat: old subtitle-based format
  it("categorizes Permission subtitle", () => {
    const n = { subtitle: "Permission", body: "Claude Code needs your approval" };
    assert.equal(categorizeNotification(n), "permission");
  });
  it("categorizes Completed subtitle", () => {
    const n = { subtitle: "Completed in my-project", body: "Done" };
    assert.equal(categorizeNotification(n), "completion");
  });
  it("categorizes Waiting as waiting", () => {
    const n = { subtitle: "Waiting", body: "Claude is waiting for your input" };
    assert.equal(categorizeNotification(n), "waiting");
  });

  // New: empty subtitle, body-based fallback (cmux 0.64.3+)
  it("falls back to body for permission when subtitle is empty", () => {
    const n = { subtitle: "", body: "Claude needs your permission to use Bash" };
    assert.equal(categorizeNotification(n), "permission");
  });
  it("falls back to body for approval when subtitle is empty", () => {
    const n = { subtitle: "", body: "Claude Code needs your approval" };
    assert.equal(categorizeNotification(n), "permission");
  });
  it("falls back to body for waiting when subtitle is empty", () => {
    const n = { subtitle: "", body: "Claude is waiting for your input" };
    assert.equal(categorizeNotification(n), "waiting");
  });
  it("falls back to body for completion when subtitle is empty", () => {
    const n = { subtitle: "", body: "Task completed in 3m 20s" };
    assert.equal(categorizeNotification(n), "completion");
  });
  it("falls back to body for finished when subtitle is empty", () => {
    const n = { subtitle: "", body: "Claude finished the task" };
    assert.equal(categorizeNotification(n), "completion");
  });
  it("returns unknown when both subtitle and body have no keywords", () => {
    const n = { subtitle: "", body: "Some unrelated message" };
    assert.equal(categorizeNotification(n), "unknown");
  });
});

describe("AGENT_TITLE_PREFIX", () => {
  it("matches active/thinking prefix (✳)", () => {
    assert.ok(AGENT_TITLE_PREFIX.test("✳ my-project"));
  });
  it("matches idle braille dot prefix (⠂)", () => {
    assert.ok(AGENT_TITLE_PREFIX.test("⠂ my-project"));
  });
  it("matches idle braille dot variant prefix (⠐)", () => {
    assert.ok(AGENT_TITLE_PREFIX.test("⠐ my-project"));
  });
  it("does not match plain workspace titles", () => {
    assert.equal(AGENT_TITLE_PREFIX.test("my-project"), false);
  });
  it("does not match titles with prefix mid-string", () => {
    assert.equal(AGENT_TITLE_PREFIX.test("my ✳ session"), false);
  });
});

describe("findWindowIdForWorkspace", () => {
  // Mirrors system.top's shape: top-level windows[], each with its own
  // workspaces[] — this is what listWorkspaces() uses to resolve which
  // window the dashboard's own host workspace lives in, since workspace.list
  // itself scopes to cmux's currently-*selected* window, not the caller's.
  const raw = {
    windows: [
      { id: "WIN-1", workspaces: [{ id: "WS-1" }, { id: "WS-2" }] },
      { id: "WIN-2", workspaces: [{ id: "WS-3" }] },
    ],
  };

  it("finds the window containing the given workspace id", () => {
    assert.equal(findWindowIdForWorkspace(raw, "WS-2"), "WIN-1");
    assert.equal(findWindowIdForWorkspace(raw, "WS-3"), "WIN-2");
  });

  it("returns null when no window contains the workspace", () => {
    assert.equal(findWindowIdForWorkspace(raw, "WS-unknown"), null);
  });

  it("returns null when windows/workspaces are missing", () => {
    assert.equal(findWindowIdForWorkspace({}, "WS-1"), null);
    assert.equal(findWindowIdForWorkspace({ windows: [{ id: "WIN-1" }] }, "WS-1"), null);
  });
});
