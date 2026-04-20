import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseNotifications, categorizeNotification } from "../src/cmux.js";

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
});
