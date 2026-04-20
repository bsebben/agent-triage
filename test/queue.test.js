// test/queue.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { Queue } from "../src/queue.js";

const HOME = homedir();

describe("Queue", () => {
  let queue;

  beforeEach(() => {
    queue = new Queue();
  });

  it("upserts items by notification id", () => {
    queue.upsert({ id: "A", category: "waiting", workspaceId: "W1", subtitle: "Waiting", body: "test" });
    queue.upsert({ id: "A", category: "waiting", workspaceId: "W1", subtitle: "Waiting", body: "updated" });
    assert.equal(queue.items().length, 1);
    assert.equal(queue.items()[0].body, "updated");
  });

  it("dismisses items", () => {
    queue.upsert({ id: "A", category: "waiting", workspaceId: "W1", subtitle: "Waiting", body: "test" });
    queue.dismiss("A");
    assert.equal(queue.items().length, 0);
  });

  it("returns items sorted by priority", () => {
    queue.upsert({ id: "A", category: "completion", workspaceId: "W1", subtitle: "Completed", body: "done" });
    queue.upsert({ id: "B", category: "permission", workspaceId: "W1", subtitle: "Permission", body: "approve?" });
    queue.upsert({ id: "C", category: "error", workspaceId: "W1", subtitle: "Error", body: "failed" });
    const items = queue.items();
    assert.equal(items[0].category, "error");
    assert.equal(items[1].category, "permission");
    assert.equal(items[2].category, "completion");
  });

  it("groups items by directory path", () => {
    queue.upsert({ id: "A", category: "waiting", workspaceId: "W1", workspaceDir: `${HOME}/workspace/zenpayroll`, body: "q1" });
    queue.upsert({ id: "B", category: "waiting", workspaceId: "W2", workspaceDir: `${HOME}/workspace/web`, body: "q2" });
    queue.upsert({ id: "C", category: "waiting", workspaceId: "W3", workspaceDir: `${HOME}/workspace/zenpayroll`, body: "q3" });
    const grouped = queue.grouped();
    assert.equal(grouped.length, 2);
    const zp = grouped.find((g) => g.title === "~/workspace/zenpayroll");
    assert.equal(zp.items.length, 2);
  });
});
