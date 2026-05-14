import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNotifications, categorizeNotification, AGENT_TITLE_PREFIX } from "../src/cmux.js";

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
          subtitle: "Completed in zenpayroll",
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
});

describe("categorizeNotification", () => {
  // Backwards compat: old subtitle-based format
  it("categorizes Permission subtitle", () => {
    const n = { subtitle: "Permission", body: "Claude Code needs your approval" };
    assert.equal(categorizeNotification(n), "permission");
  });
  it("categorizes Completed subtitle", () => {
    const n = { subtitle: "Completed in zenpayroll", body: "Done" };
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
    assert.ok(AGENT_TITLE_PREFIX.test("✳ zenpayroll"));
  });
  it("matches idle braille dot prefix (⠂)", () => {
    assert.ok(AGENT_TITLE_PREFIX.test("⠂ zenpayroll"));
  });
  it("matches idle braille dot variant prefix (⠐)", () => {
    assert.ok(AGENT_TITLE_PREFIX.test("⠐ my-project"));
  });
  it("does not match plain workspace titles", () => {
    assert.equal(AGENT_TITLE_PREFIX.test("zenpayroll"), false);
  });
  it("does not match titles with prefix mid-string", () => {
    assert.equal(AGENT_TITLE_PREFIX.test("my ✳ session"), false);
  });
});
