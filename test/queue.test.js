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

  it("sorts terminal items below running", () => {
    queue.upsert({ id: "T1", category: "terminal", workspaceId: "W1", body: "" });
    queue.upsert({ id: "R1", category: "running", workspaceId: "W2", body: "" });
    queue.upsert({ id: "P1", category: "permission", workspaceId: "W3", body: "approve?" });
    const items = queue.items();
    assert.equal(items[0].category, "permission");
    assert.equal(items[1].category, "running");
    assert.equal(items[2].category, "terminal");
  });

  it("excludes running and terminal from pending count", () => {
    queue.upsert({ id: "T1", category: "terminal", workspaceId: "W1", body: "" });
    queue.upsert({ id: "R1", category: "running", workspaceId: "W2", body: "" });
    queue.upsert({ id: "P1", category: "permission", workspaceId: "W3", body: "approve?" });
    queue.upsert({ id: "C1", category: "completion", workspaceId: "W4", body: "done" });
    const stats = queue.stats();
    assert.equal(stats.pending, 1);
    assert.equal(stats.total, 4);
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

  it("counts unique workspace IDs from active items", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", body: "" });
    queue.upsert({ id: "B", category: "waiting", workspaceId: "W1", body: "q" });
    queue.upsert({ id: "C", category: "terminal", workspaceId: "W2", body: "" });
    queue.upsert({ id: "D", category: "running", workspaceId: "W3", body: "" });
    const ids = new Set(queue.items().map((i) => i.workspaceId));
    assert.equal(ids.size, 3);
  });

  it("excludes dismissed items from session count", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", body: "" });
    queue.upsert({ id: "B", category: "running", workspaceId: "W2", body: "" });
    queue.dismiss("B");
    const ids = new Set(queue.items().map((i) => i.workspaceId));
    assert.equal(ids.size, 1);
  });

  it("sorts groups alphabetically regardless of item priority", () => {
    queue.upsert({ id: "Z1", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/zenpayroll`, body: "" });
    queue.upsert({ id: "A1", category: "terminal", workspaceId: "W2", workspaceDir: `${HOME}/workspace/agent-triage`, body: "" });
    queue.upsert({ id: "M1", category: "error", workspaceId: "W3", workspaceDir: `${HOME}/workspace/middle`, body: "boom" });
    const initial = queue.grouped().map((g) => g.title);
    assert.deepEqual(initial, ["~/workspace/agent-triage", "~/workspace/middle", "~/workspace/zenpayroll"]);

    queue.upsert({ id: "M1", category: "completion", workspaceId: "W3", workspaceDir: `${HOME}/workspace/middle`, body: "done" });
    queue.upsert({ id: "A1", category: "permission", workspaceId: "W2", workspaceDir: `${HOME}/workspace/agent-triage`, body: "approve?" });
    const after = queue.grouped().map((g) => g.title);
    assert.deepEqual(after, ["~/workspace/agent-triage", "~/workspace/middle", "~/workspace/zenpayroll"]);
  });
});
