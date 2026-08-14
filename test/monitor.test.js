import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { enrichNotification, Monitor } from "../src/monitor.js";
import { Queue } from "../src/queue.js";

describe("enrichNotification", () => {
  it("adds workspace and terminal info to a notification", async () => {
    const notification = {
      id: "A",
      category: "waiting",
      workspaceId: "W1",
      surfaceId: "S1",
    };
    const workspaces = [{ id: "W1", title: "my-project", directory: "/home/testuser/workspace/my-project" }];
    const terminals = [{ workspaceId: "W1", paneId: "P1", directory: "/home/testuser/workspace/my-project", gitBranch: "main" }];

    const result = await enrichNotification(notification, workspaces, terminals);
    assert.equal(result.workspaceTitle, "my-project");
    assert.equal(result.workspaceDir, "/home/testuser/workspace/my-project");
    assert.equal(result.gitBranch, "main");
    assert.equal(result.isWorktree, false);
  });

  it("attaches worktree info resolved from the workspace directory", async () => {
    const notification = { id: "A", category: "waiting", workspaceId: "W1", surfaceId: "S1" };
    const workspaces = [{ id: "W1", title: "my-project", directory: "/home/user/my-project-worktrees/wt-demo" }];
    const terminals = [{ workspaceId: "W1", paneId: "P1", directory: "/home/user/my-project-worktrees/wt-demo", gitBranch: "demo" }];
    const resolveWorktreeFn = async (dir) => {
      assert.equal(dir, "/home/user/my-project-worktrees/wt-demo");
      return { isWorktree: true, worktreeName: "wt-demo", repoRoot: "/home/user/my-project", repoName: "my-project" };
    };

    const result = await enrichNotification(notification, workspaces, terminals, resolveWorktreeFn);
    assert.equal(result.isWorktree, true);
    assert.equal(result.worktreeName, "wt-demo");
    assert.equal(result.repoRoot, "/home/user/my-project");
  });
});

describe("Monitor terminal detection", () => {
  let queue;

  function makeCmux({ notifications = [], workspaces = [], terminals = [], agentWorkspaceIds = new Set(), bypassWorkspaceIds = new Set() }) {
    return {
      listNotifications: async () => notifications,
      listWorkspaces: async () => workspaces,
      listTerminals: async () => terminals,
      listAgentWorkspaceIds: async () => agentWorkspaceIds,
      listBypassWorkspaceIds: async () => bypassWorkspaceIds,
      readScreen: async () => null,
    };
  }

  beforeEach(() => {
    queue = new Queue();
  });

  it("attaches worktree info to a synthetic (notification-less) item", async () => {
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", title: "my-project", directory: "/home/user/my-project-worktrees/wt-demo" }],
      terminals: [{ workspaceId: "W1", paneId: "P1", directory: "/home/user/my-project-worktrees/wt-demo", gitBranch: "demo" }],
      agentWorkspaceIds: new Set(["W1"]),
    });
    const resolveWorktreeFn = async () => ({
      isWorktree: true,
      worktreeName: "wt-demo",
      repoRoot: "/home/user/my-project",
      repoName: "my-project",
    });
    const monitor = new Monitor(queue, { cmuxApi, resolveWorktreeFn });
    await monitor.poll();

    const items = queue.items();
    assert.equal(items.length, 1);
    assert.equal(items[0].isWorktree, true);
    assert.equal(items[0].worktreeName, "wt-demo");
    assert.equal(items[0].repoRoot, "/home/user/my-project");
  });

  it("marks workspace without notification history as terminal", async () => {
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", title: "my-terminal", directory: "/home/user" }],
    });
    const monitor = new Monitor(queue, { cmuxApi });
    await monitor.poll();
    const items = queue.items();
    assert.equal(items.length, 1);
    assert.equal(items[0].category, "terminal");
    assert.equal(items[0].workspaceId, "W1");
  });

  it("marks workspace with claude_code tag as running", async () => {
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      terminals: [{ workspaceId: "W1", paneId: "P1", directory: "/home/user/project", gitBranch: "main" }],
      agentWorkspaceIds: new Set(["W1"]),
    });
    const monitor = new Monitor(queue, { cmuxApi });
    await monitor.poll();

    const items = queue.items();
    assert.equal(items.length, 1);
    assert.equal(items[0].category, "running");
  });

  it("marks workspace with agent title prefix as running", async () => {
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", title: "✳ my-project", directory: "/home/user/project" }],
      terminals: [{ workspaceId: "W1", paneId: "P1", directory: "/home/user/project", gitBranch: "main" }],
      agentWorkspaceIds: new Set(["W1"]),
    });
    const monitor = new Monitor(queue, { cmuxApi });
    await monitor.poll();

    const items = queue.items();
    assert.equal(items.length, 1);
    assert.equal(items[0].category, "running");
  });

  it("marks workspace with idle braille prefix as running", async () => {
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", title: "⠂ my-project", directory: "/home/user/project" }],
      terminals: [{ workspaceId: "W1", paneId: "P1", directory: "/home/user/project", gitBranch: "main" }],
      agentWorkspaceIds: new Set(["W1"]),
    });
    const monitor = new Monitor(queue, { cmuxApi });
    await monitor.poll();

    const items = queue.items();
    assert.equal(items.length, 1);
    assert.equal(items[0].category, "running");
  });

  it("reverts to terminal when claude_code tag disappears", async () => {
    const agentIds = new Set(["W1"]);
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      agentWorkspaceIds: agentIds,
    });
    const monitor = new Monitor(queue, { cmuxApi });
    await monitor.poll();
    assert.equal(queue.items()[0].category, "running");

    agentIds.clear();
    await monitor.poll();
    assert.equal(queue.items()[0].category, "terminal");
  });

  it("distinguishes terminal and agent workspaces in same poll", async () => {
    const cmuxApi = makeCmux({
      workspaces: [
        { id: "W1", title: "agent", directory: "/home/user/project" },
        { id: "W2", title: "plain-shell", directory: "/home/user" },
      ],
      agentWorkspaceIds: new Set(["W1"]),
    });
    const monitor = new Monitor(queue, { cmuxApi });
    await monitor.poll();

    const items = queue.items();
    assert.equal(items.length, 2);
    const w1 = items.find((i) => i.workspaceId === "W1");
    const w2 = items.find((i) => i.workspaceId === "W2");
    assert.equal(w1.category, "running");
    assert.equal(w2.category, "terminal");
  });

  it("preserves dismiss when notification ID rotates for the same workspace", async () => {
    const state = {
      notifications: [
        { id: "notif-1", category: "permission", workspaceId: "W1", surfaceId: "S1", body: "approve?" },
      ],
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
    };
    const cmuxApi = {
      listNotifications: async () => state.notifications,
      listWorkspaces: async () => state.workspaces,
      listTerminals: async () => [],
      listAgentWorkspaceIds: async () => new Set(),
      listBypassWorkspaceIds: async () => new Set(),
      readScreen: async () => null,
    };
    const monitor = new Monitor(queue, { cmuxApi });

    await monitor.poll();
    assert.equal(queue.items().length, 1);
    queue.dismiss("notif-1");
    assert.equal(queue.dismissedItems().length, 1);

    state.notifications = [
      { id: "notif-2", category: "permission", workspaceId: "W1", surfaceId: "S1", body: "approve?" },
    ];
    await monitor.poll();

    assert.equal(queue.items().length, 0, "rotated notification should inherit dismiss");
    assert.equal(queue.dismissedItems().length, 1, "should have one dismissed entry");
    assert.equal(queue.dismissedItems()[0].id, "notif-2", "dismissed entry should use the new ID");
  });

  it("preserves dismiss when synthetic ID is stable across polls", async () => {
    const state = {
      notifications: [],
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      agentWorkspaceIds: new Set(["W1"]),
    };
    const cmuxApi = {
      listNotifications: async () => state.notifications,
      listWorkspaces: async () => state.workspaces,
      listTerminals: async () => [],
      listAgentWorkspaceIds: async () => state.agentWorkspaceIds,
      listBypassWorkspaceIds: async () => new Set(),
      readScreen: async () => null,
    };
    const monitor = new Monitor(queue, { cmuxApi });

    await monitor.poll();
    assert.equal(queue.items().length, 1);
    assert.equal(queue.items()[0].id, "synthetic-W1");
    queue.dismiss("synthetic-W1");
    assert.equal(queue.dismissedItems().length, 1);

    await monitor.poll();
    assert.equal(queue.items().length, 0, "dismissed synthetic should stay dismissed");
    assert.equal(queue.dismissedItems().length, 1);
  });

  it("reaps a dismissed item when its workspace no longer exists in cmux", async () => {
    const state = {
      notifications: [],
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      agentWorkspaceIds: new Set(["W1"]),
    };
    const cmuxApi = {
      listNotifications: async () => state.notifications,
      listWorkspaces: async () => state.workspaces,
      listTerminals: async () => [],
      listAgentWorkspaceIds: async () => state.agentWorkspaceIds,
      listBypassWorkspaceIds: async () => new Set(),
      readScreen: async () => null,
    };
    const monitor = new Monitor(queue, { cmuxApi });

    await monitor.poll();
    queue.dismiss("synthetic-W1");
    assert.equal(queue.dismissedItems().length, 1);

    state.workspaces = [];
    state.agentWorkspaceIds = new Set();
    await monitor.poll();

    assert.equal(queue.dismissedItems().length, 0, "dismissed item for a closed workspace should be reaped");
    assert.equal(queue.items().length, 0);
  });

  it("sets bypassPermissions on synthetic running items", async () => {
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      agentWorkspaceIds: new Set(["W1"]),
      bypassWorkspaceIds: new Set(["W1"]),
    });
    const monitor = new Monitor(queue, { cmuxApi });
    await monitor.poll();

    const items = queue.items();
    assert.equal(items.length, 1);
    assert.equal(items[0].bypassPermissions, true);
  });

  it("sets bypassPermissions false when workspace is not in bypass mode", async () => {
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      agentWorkspaceIds: new Set(["W1"]),
      bypassWorkspaceIds: new Set(),
    });
    const monitor = new Monitor(queue, { cmuxApi });
    await monitor.poll();

    const items = queue.items();
    assert.equal(items.length, 1);
    assert.equal(items[0].bypassPermissions, false);
  });

  it("sets bypassPermissions on enriched notification items", async () => {
    const cmuxApi = makeCmux({
      notifications: [
        { id: "notif-1", category: "permission", workspaceId: "W1", surfaceId: "S1", body: "approve?" },
      ],
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      bypassWorkspaceIds: new Set(["W1"]),
    });
    const monitor = new Monitor(queue, { cmuxApi });
    await monitor.poll();

    const items = queue.items();
    assert.equal(items.length, 1);
    assert.equal(items[0].bypassPermissions, true);
  });

  it("updates bypassPermissions when session mode changes between polls", async () => {
    const state = {
      bypassWorkspaceIds: new Set(["W1"]),
    };
    const cmuxApi = {
      listNotifications: async () => [],
      listWorkspaces: async () => [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      listTerminals: async () => [],
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      listBypassWorkspaceIds: async () => state.bypassWorkspaceIds,
      readScreen: async () => null,
    };
    const monitor = new Monitor(queue, { cmuxApi });

    await monitor.poll();
    assert.equal(queue.items()[0].bypassPermissions, true);

    state.bypassWorkspaceIds = new Set();
    await monitor.poll();
    assert.equal(queue.items()[0].bypassPermissions, false);
  });

  it("evicts a dismissed synthetic entry when the workspace starts producing notifications", async () => {
    const state = {
      notifications: [],
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      agentWorkspaceIds: new Set(["W1"]),
    };
    const cmuxApi = {
      listNotifications: async () => state.notifications,
      listWorkspaces: async () => state.workspaces,
      listTerminals: async () => [],
      listAgentWorkspaceIds: async () => state.agentWorkspaceIds,
      listBypassWorkspaceIds: async () => new Set(),
      readScreen: async () => null,
    };
    const monitor = new Monitor(queue, { cmuxApi });

    await monitor.poll();
    assert.equal(queue.items().length, 1);
    queue.dismiss("synthetic-W1");
    assert.equal(queue.dismissedItems().length, 1);

    state.notifications = [
      { id: "notif-abc", category: "permission", workspaceId: "W1", surfaceId: "S1", body: "approve?" },
    ];
    await monitor.poll();

    assert.equal(queue.items().length, 1, "notification should be the only active entry");
    assert.equal(queue.items()[0].id, "notif-abc");
    assert.equal(queue.dismissedItems().length, 0, "stale dismissed synthetic should be evicted");
  });
});
