// test/queue.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
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

  it("sorts a host item after a same-category peer, ignoring workspaceId order", () => {
    queue.upsert({ id: "H1", category: "terminal", workspaceId: "A-host", isHost: true, body: "" });
    queue.upsert({ id: "T1", category: "terminal", workspaceId: "Z-other", body: "" });
    // "A-host" would sort before "Z-other" by plain workspaceId comparison —
    // isHost must override that tie-break so the host is still last.
    assert.deepEqual(queue.items().map((i) => i.workspaceId), ["Z-other", "A-host"]);
  });

  it("applies the host tie-break regardless of which category the host item carries", () => {
    // enrichNotification sets isHost independent of category, so the host
    // could in principle surface with any category, not just "terminal".
    queue.upsert({ id: "H1", category: "running", workspaceId: "A-host", isHost: true, body: "" });
    queue.upsert({ id: "R1", category: "running", workspaceId: "Z-other", body: "" });
    assert.deepEqual(queue.items().map((i) => i.workspaceId), ["Z-other", "A-host"]);
  });

  it("breaks priority ties by workspaceId, not insertion order", () => {
    queue.upsert({ id: "A", category: "waiting", workspaceId: "W2", body: "" });
    queue.upsert({ id: "B", category: "waiting", workspaceId: "W1", body: "" });
    queue.upsert({ id: "C", category: "waiting", workspaceId: "W3", body: "" });
    assert.deepEqual(queue.items().map((i) => i.workspaceId), ["W1", "W2", "W3"]);
  });

  it("keeps a stable order across an item ID rotation for the same workspace", () => {
    queue.upsert({ id: "A", category: "waiting", workspaceId: "W2", body: "" });
    queue.upsert({ id: "B", category: "waiting", workspaceId: "W1", body: "" });
    const before = queue.items().map((i) => i.workspaceId);

    // Simulate a notification ID rotation for W1: remove the old entry and
    // upsert under a new id, as Monitor does when cmux's notification ID
    // changes — the workspace itself hasn't changed, so order shouldn't either.
    queue.remove("B");
    queue.upsert({ id: "B2", category: "waiting", workspaceId: "W1", body: "" });

    assert.deepEqual(queue.items().map((i) => i.workspaceId), before);
  });

  it("breaks dismissedAt ties by workspaceId", () => {
    let fakeNow = Date.now();
    const realNow = Date.now;
    Date.now = () => fakeNow;
    try {
      queue.upsert({ id: "A", category: "waiting", workspaceId: "W2", body: "" });
      queue.upsert({ id: "B", category: "waiting", workspaceId: "W1", body: "" });
      queue.dismiss("A");
      queue.dismiss("B");
      assert.deepEqual(queue.dismissedItems().map((i) => i.workspaceId), ["W1", "W2"]);
    } finally {
      Date.now = realNow;
    }
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
    queue.upsert({ id: "A", category: "waiting", workspaceId: "W1", workspaceDir: `${HOME}/workspace/my-project`, body: "q1" });
    queue.upsert({ id: "B", category: "waiting", workspaceId: "W2", workspaceDir: `${HOME}/workspace/web`, body: "q2" });
    queue.upsert({ id: "C", category: "waiting", workspaceId: "W3", workspaceDir: `${HOME}/workspace/my-project`, body: "q3" });
    const { groups: grouped } = queue.grouped();
    assert.equal(grouped.length, 2);
    const zp = grouped.find((g) => g.title === "~/workspace/my-project");
    assert.equal(zp.items.length, 2);
  });

  it("groups worktrees of the same repo with the main checkout", () => {
    queue.upsert({
      id: "A",
      category: "waiting",
      workspaceId: "W1",
      workspaceDir: `${HOME}/workspace/my-project`,
      repoRoot: `${HOME}/workspace/my-project`,
      body: "main checkout",
    });
    queue.upsert({
      id: "B",
      category: "waiting",
      workspaceId: "W2",
      workspaceDir: `${HOME}/workspace/my-project-worktrees/wt-a`,
      repoRoot: `${HOME}/workspace/my-project`,
      isWorktree: true,
      worktreeName: "wt-a",
      body: "worktree a",
    });
    queue.upsert({
      id: "C",
      category: "waiting",
      workspaceId: "W3",
      workspaceDir: `${HOME}/workspace/my-project-worktrees/wt-b`,
      repoRoot: `${HOME}/workspace/my-project`,
      isWorktree: true,
      worktreeName: "wt-b",
      body: "worktree b",
    });
    const { groups } = queue.grouped();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, "~/workspace/my-project");
    assert.equal(groups[0].directory, `${HOME}/workspace/my-project`);
    assert.equal(groups[0].items.length, 3);
  });

  it("targets new-session/new-terminal at a worktree, not the repo root, when no item is in the main checkout", () => {
    queue.upsert({
      id: "A",
      category: "waiting",
      workspaceId: "W1",
      workspaceDir: `${HOME}/workspace/my-project-worktrees/wt-a`,
      repoRoot: `${HOME}/workspace/my-project`,
      isWorktree: true,
      worktreeName: "wt-a",
      body: "worktree a",
    });
    queue.upsert({
      id: "B",
      category: "waiting",
      workspaceId: "W2",
      workspaceDir: `${HOME}/workspace/my-project-worktrees/wt-b`,
      repoRoot: `${HOME}/workspace/my-project`,
      isWorktree: true,
      worktreeName: "wt-b",
      body: "worktree b",
    });
    const { groups } = queue.grouped();
    assert.equal(groups.length, 1);
    assert.notEqual(groups[0].directory, `${HOME}/workspace/my-project`);
    assert.equal(groups[0].directory, `${HOME}/workspace/my-project-worktrees/wt-a`);
  });

  it("keeps grouping plain non-repo folders by directory", () => {
    queue.upsert({ id: "A", category: "waiting", workspaceId: "W1", workspaceDir: `${HOME}/workspace`, body: "plain shell" });
    const { groups } = queue.grouped();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, "~/workspace");
    assert.equal(groups[0].directory, `${HOME}/workspace`);
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
    queue.upsert({ id: "Z1", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/my-project`, body: "" });
    queue.upsert({ id: "A1", category: "terminal", workspaceId: "W2", workspaceDir: `${HOME}/workspace/agent-triage`, body: "" });
    queue.upsert({ id: "M1", category: "error", workspaceId: "W3", workspaceDir: `${HOME}/workspace/middle`, body: "boom" });
    const { groups: initial } = queue.grouped();
    assert.deepEqual(initial.map((g) => g.title), ["~/workspace/agent-triage", "~/workspace/middle", "~/workspace/my-project"]);

    queue.upsert({ id: "M1", category: "completion", workspaceId: "W3", workspaceDir: `${HOME}/workspace/middle`, body: "done" });
    queue.upsert({ id: "A1", category: "permission", workspaceId: "W2", workspaceDir: `${HOME}/workspace/agent-triage`, body: "approve?" });
    const { groups: after } = queue.grouped();
    assert.deepEqual(after.map((g) => g.title), ["~/workspace/agent-triage", "~/workspace/middle", "~/workspace/my-project"]);
  });

  it("puts the host in its own dedicated group, separate from its actual directory's group", () => {
    // A real agent workspace can share the host's own repo (e.g. someone
    // working on agent-triage itself, in the same checkout the dashboard
    // runs from) — that must stay a normal, independently-sorted group, not
    // get merged with (or bury) the host.
    queue.upsert({
      id: "A1",
      category: "running",
      workspaceId: "W1",
      workspaceDir: `${HOME}/workspace/agent-triage`,
      workspaceTitle: "Agent Triage Dashboard Host",
      isHost: true,
      body: "",
    });
    queue.upsert({ id: "A2", category: "running", workspaceId: "W2", workspaceDir: `${HOME}/workspace/agent-triage`, body: "" });
    queue.upsert({ id: "M1", category: "error", workspaceId: "W3", workspaceDir: `${HOME}/workspace/middle`, body: "boom" });
    const { groups } = queue.grouped();

    assert.deepEqual(groups.map((g) => g.title), ["~/workspace/agent-triage", "~/workspace/middle", "Agent Triage Dashboard Host"]);
    const dirGroup = groups.find((g) => g.title === "~/workspace/agent-triage");
    assert.equal(dirGroup.items.length, 1);
    assert.equal(dirGroup.items[0].workspaceId, "W2");
    const hostGroup = groups.find((g) => g.title === "Agent Triage Dashboard Host");
    assert.equal(hostGroup.items.length, 1);
    assert.equal(hostGroup.items[0].workspaceId, "W1");
  });

  it("sorts the host's dedicated group after every other group regardless of its title", () => {
    // "Agent Triage Dashboard Host" would sort alphabetically before
    // "zzz-project" — the host flag must override that, not just happen to
    // win on title text.
    queue.upsert({ id: "H1", category: "terminal", workspaceId: "HOST", workspaceTitle: "Agent Triage Dashboard Host", isHost: true, body: "" });
    queue.upsert({ id: "Z1", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/zzz-project`, body: "" });
    const { groups } = queue.grouped();
    assert.deepEqual(groups.map((g) => g.title), ["~/workspace/zzz-project", "Agent Triage Dashboard Host"]);
  });

  it("does not resurface the host's own directory as a recently-active group once other activity there closes", () => {
    queue.upsert({ id: "R1", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/agent-triage`, body: "" });
    queue.upsert({
      id: "H1",
      category: "terminal",
      workspaceId: "HOST",
      workspaceDir: `${HOME}/workspace/agent-triage`,
      workspaceTitle: "Agent Triage Dashboard Host",
      isHost: true,
      body: "",
    });
    queue.grouped(); // registers "~/workspace/agent-triage" as an active directory (via W1)
    queue.remove("R1"); // W1 closes; only the host is left in that directory now

    const { groups, recentGroups } = queue.grouped();
    assert.equal(groups.some((g) => g.title === "~/workspace/agent-triage"), false, "no bare directory group — the host has its own");
    assert.equal(
      recentGroups.some((g) => g.title === "~/workspace/agent-triage"),
      false,
      "the host itself still occupies that directory, so it's not actually 'recently closed'"
    );
  });

  it("falls back to a generic label for the host's group if it has no title yet", () => {
    queue.upsert({ id: "H1", category: "terminal", workspaceId: "HOST", isHost: true, body: "" });
    const { groups } = queue.grouped();
    assert.equal(groups[0].title, "Dashboard Host");
  });

  it("tracks directories seen via grouped()", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/my-project`, body: "" });
    queue.grouped();
    assert.equal(queue.recentDirCount, 1);
  });

  it("returns recentGroups for directories with no active items", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/my-project`, body: "" });
    queue.grouped();
    queue.remove("A");
    const { groups, recentGroups } = queue.grouped();
    assert.equal(groups.length, 0);
    assert.equal(recentGroups.length, 1);
    assert.equal(recentGroups[0].title, "~/workspace/my-project");
    assert.equal(recentGroups[0].items.length, 0);
    assert.equal(recentGroups[0].recent, true);
  });

  it("does not duplicate a directory in both groups and recentGroups", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/my-project`, body: "" });
    queue.grouped();
    const { groups, recentGroups } = queue.grouped();
    assert.equal(groups.length, 1);
    assert.equal(recentGroups.length, 0);
  });

  it("limits recentGroups to maxRecent", () => {
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

  it("shows recentGroups independently of active group count", () => {
    queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/a`, body: "" });
    queue.upsert({ id: "B", category: "running", workspaceId: "W2", workspaceDir: `${HOME}/workspace/b`, body: "" });
    queue.upsert({ id: "C", category: "running", workspaceId: "W3", workspaceDir: `${HOME}/workspace/c`, body: "" });
    queue.grouped();
    queue.remove("C");
    const { recentGroups } = queue.grouped(2);
    assert.equal(recentGroups.length, 1);
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

  it("persists recentDirs across save/load", async () => {
    const tmpFile = join(tmpdir(), `queue-test-${Date.now()}.json`);
    try {
      queue.upsert({ id: "A", category: "running", workspaceId: "W1", workspaceDir: `${HOME}/workspace/my-project`, body: "" });
      queue.grouped();
      queue.remove("A");
      await queue.save(tmpFile);

      const loaded = new Queue();
      await loaded.load(tmpFile);
      const { recentGroups } = loaded.grouped();
      assert.equal(recentGroups.length, 1);
      assert.equal(recentGroups[0].title, "~/workspace/my-project");
      assert.equal(recentGroups[0].directory, `${HOME}/workspace/my-project`);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });
});
