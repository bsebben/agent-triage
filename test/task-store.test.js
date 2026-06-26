// test/task-store.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { TaskStore } from "../src/task-store.js";

describe("TaskStore", () => {
  let store;

  beforeEach(() => {
    store = new TaskStore();
  });

  it("adds a task with generated id, title, done=false, and createdAt", () => {
    const task = store.add("Buy milk");
    assert.ok(task.id.startsWith("t_"));
    assert.equal(task.title, "Buy milk");
    assert.equal(task.done, false);
    assert.equal(typeof task.createdAt, "number");
  });

  it("lists all tasks ordered by createdAt ascending", () => {
    const a = store.add("First");
    const b = store.add("Second");
    const items = store.list(30, "hide");
    assert.equal(items.length, 2);
    assert.equal(items[0].id, a.id);
    assert.equal(items[1].id, b.id);
  });

  it("gets a task by id", () => {
    const task = store.add("Find me");
    const found = store.get(task.id);
    assert.equal(found.title, "Find me");
  });

  it("returns null when getting a non-existent id", () => {
    assert.equal(store.get("t_nonexistent"), null);
  });

  it("toggles done state", () => {
    const task = store.add("Do laundry");
    assert.equal(task.done, false);
    const toggled = store.toggle(task.id);
    assert.equal(toggled.done, true);
    const toggledBack = store.toggle(task.id);
    assert.equal(toggledBack.done, false);
  });

  it("returns null when toggling a non-existent id", () => {
    const result = store.toggle("t_nonexistent");
    assert.equal(result, null);
  });

  it("removes a task by id", () => {
    const task = store.add("Remove me");
    assert.equal(store.remove(task.id), true);
    assert.equal(store.list(30, "hide").length, 0);
  });

  it("returns false when removing a non-existent id", () => {
    assert.equal(store.remove("t_nonexistent"), false);
  });

  it("hides expired tasks from list when expireBehavior is 'hide'", () => {
    const task = store.add("Old task");
    // Backdate createdAt to 10 days ago
    store._setCreatedAt(task.id, Date.now() - 10 * 24 * 60 * 60 * 1000);
    const visible = store.list(7, "hide");
    assert.equal(visible.length, 0);
  });

  it("keeps expired tasks in storage when expireBehavior is 'hide'", () => {
    const task = store.add("Old task");
    store._setCreatedAt(task.id, Date.now() - 10 * 24 * 60 * 60 * 1000);
    store.list(7, "hide");
    // Task is still in storage (just hidden from list)
    assert.equal(store._size(), 1);
  });

  it("removes expired tasks from storage when expireBehavior is 'delete'", () => {
    const task = store.add("Old task");
    store._setCreatedAt(task.id, Date.now() - 10 * 24 * 60 * 60 * 1000);
    store.list(7, "delete");
    assert.equal(store._size(), 0);
  });

  it("never expires tasks when maxAgeDays is 0", () => {
    const task = store.add("Permanent");
    store._setCreatedAt(task.id, Date.now() - 365 * 24 * 60 * 60 * 1000);
    const visible = store.list(0, "hide");
    assert.equal(visible.length, 1);
  });

  it("persists and restores across save/load", async () => {
    const tmpFile = join(tmpdir(), `tasks-test-${Date.now()}.json`);
    try {
      store.add("Persistent task");
      store.add("Another one");
      await store.save(tmpFile);

      const loaded = new TaskStore();
      await loaded.load(tmpFile);
      assert.equal(loaded.list(30, "hide").length, 2);
      assert.equal(loaded.list(30, "hide")[0].title, "Persistent task");
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it("handles load from non-existent file gracefully", async () => {
    await store.load("/tmp/does-not-exist-12345.json");
    assert.equal(store.list(30, "hide").length, 0);
  });

  it("generates unique ids for tasks added in the same millisecond", () => {
    const realNow = Date.now;
    Date.now = () => 1700000000000;
    try {
      const a = store.add("Task A");
      const b = store.add("Task B");
      assert.notEqual(a.id, b.id);
    } finally {
      Date.now = realNow;
    }
  });
});
