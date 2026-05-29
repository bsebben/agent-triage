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
    const { groups: grouped } = queue.grouped();
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
    const { groups: initial } = queue.grouped();
    assert.deepEqual(initial.map((g) => g.title), ["~/workspace/agent-triage", "~/workspace/middle", "~/workspace/zenpayroll"]);

    queue.upsert({ id: "M1", category: "completion", workspaceId: "W3", workspaceDir: `${HOME}/workspace/middle`, body: "done" });
    queue.upsert({ id: "A1", category: "permission", workspaceId: "W2", workspaceDir: `${HOME}/workspace/agent-triage`, body: "approve?" });
    const { groups: after } = queue.grouped();
    assert.deepEqual(after.map((g) => g.title), ["~/workspace/agent-triage", "~/workspace/middle", "~/workspace/zenpayroll"]);
  });

  it("tracks directories seen via grouped()", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/zenpayroll`, body: "" });
    queue.grouped();
    assert.equal(queue.recentDirCount, 1);
  });

  it("returns recentGroups for directories with no active items", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/zenpayroll`, body: "" });
    queue.grouped();
    queue.remove("A");
    const { groups, recentGroups } = queue.grouped();
    assert.equal(groups.length, 0);
    assert.equal(recentGroups.length, 1);
    assert.equal(recentGroups[0].title, "~/workspace/zenpayroll");
    assert.equal(recentGroups[0].items.length, 0);
    assert.equal(recentGroups[0].recent, true);
  });

  it("does not duplicate a directory in both groups and recentGroups", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/zenpayroll`, body: "" });
    queue.grouped();
    const { groups, recentGroups } = queue.grouped();
    assert.equal(groups.length, 1);
    assert.equal(recentGroups.length, 0);
  });

  it("limits recentGroups to maxGroups minus active count", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/a`, body: "" });
    queue.upsert({ id: "B", category: "running", workspaceId: "W2", workspaceDir: `${HOME}/workspace/b`, body: "" });
    queue.upsert({ id: "C", category: "running", workspaceId: "W3", workspaceDir: `${HOME}/workspace/c`, body: "" });
    queue.grouped();
    queue.remove("A");
    queue.remove("B");
    queue.remove("C");
    const { recentGroups } = queue.grouped(2);
    assert.equal(recentGroups.length, 2);
  });

  it("shows zero recentGroups when active groups fill maxGroups", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/a`, body: "" });
    queue.upsert({ id: "B", category: "running", workspaceId: "W2", workspaceDir: `${HOME}/workspace/b`, body: "" });
    queue.upsert({ id: "C", category: "running", workspaceId: "W3", workspaceDir: `${HOME}/workspace/c`, body: "" });
    queue.grouped();
    queue.remove("C");
    const { recentGroups } = queue.grouped(2);
    assert.equal(recentGroups.length, 0);
  });

  it("sorts recentGroups by most recently active first", () => {
    let fakeNow = Date.now();
    const realNow = Date.now;
    Date.now = () => fakeNow;
    try {
      queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/alpha`, body: "" });
      queue.grouped();
      queue.remove("A");

      fakeNow += 1000;
      queue.upsert({ id: "B", category: "running", workspaceId: "W2", workspaceDir: `${HOME}/workspace/beta`, body: "" });
      queue.grouped();
      queue.remove("B");

      const { recentGroups } = queue.grouped(10);
      assert.equal(recentGroups[0].title, "~/workspace/beta");
      assert.equal(recentGroups[1].title, "~/workspace/alpha");
    } finally {
      Date.now = realNow;
    }
  });

  it("evicts oldest directory when exceeding MAX_RECENT_DIRS", () => {
    const original = Queue.MAX_RECENT_DIRS;
    Queue.MAX_RECENT_DIRS = 3;
    try {
      for (let i = 0; i < 4; i++) {
        queue.upsert({ id: `id${i}`, category: "running", workspaceId: `W${i}`, workspaceDir: `${HOME}/workspace/dir${i}`, body: "" });
        queue.grouped();
        queue.remove(`id${i}`);
      }
      assert.equal(queue.recentDirCount, 3);
      const { recentGroups } = queue.grouped(10);
      const titles = recentGroups.map((g) => g.title);
      assert.ok(!titles.includes("~/workspace/dir0"));
      assert.ok(titles.includes("~/workspace/dir3"));
    } finally {
      Queue.MAX_RECENT_DIRS = original;
    }
  });
});
