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

  function makeCmux({ notifications = [], workspaces = [], terminals = [], agentWorkspaceIds = new Set(), bypassWorkspaceIds = new Set(), reorderWorkspaces = async () => {} }) {
    return {
      listNotifications: async () => notifications,
      listWorkspaces: async () => workspaces,
      listTerminals: async () => terminals,
      listAgentWorkspaceIds: async () => agentWorkspaceIds,
      listBypassWorkspaceIds: async () => bypassWorkspaceIds,
      readScreen: async () => null,
      reorderWorkspaces,
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

  it("triggers an out-of-cycle poll when a workspace event fires", async () => {
    const state = {
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      agentWorkspaceIds: new Set(["W1"]),
    };
    const cmuxApi = {
      listNotifications: async () => [],
      listWorkspaces: async () => state.workspaces,
      listTerminals: async () => [],
      listAgentWorkspaceIds: async () => state.agentWorkspaceIds,
      listBypassWorkspaceIds: async () => new Set(),
      readScreen: async () => null,
    };
    let onEvent;
    const subscribeWorkspaceEventsFn = (cb) => {
      onEvent = cb;
      return () => {};
    };
    const monitor = new Monitor(queue, {
      cmuxApi,
      resolveWorktreeFn: async () => ({ isWorktree: false }),
      subscribeWorkspaceEventsFn,
      pollIntervalMs: 60_000,
      immediatePollDebounceMs: 0,
    });

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(queue.items().length, 1, "initial start() poll should have populated the queue");

    state.workspaces = [
      { id: "W1", title: "claude-session", directory: "/home/user/project" },
      { id: "W2", title: "another-session", directory: "/home/user/other" },
    ];
    state.agentWorkspaceIds = new Set(["W1", "W2"]);
    onEvent({ type: "event", name: "workspace.selected", category: "workspace" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(queue.items().length, 2, "event should have triggered an immediate poll picking up W2");
    monitor.stop();
  });

  it("debounces a burst of workspace events into a single poll", async () => {
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", title: "claude-session", directory: "/home/user/project" }],
      agentWorkspaceIds: new Set(["W1"]),
    });
    let pollCount = 0;
    const originalListWorkspaces = cmuxApi.listWorkspaces;
    cmuxApi.listWorkspaces = async () => {
      pollCount++;
      return originalListWorkspaces();
    };
    let onEvent;
    const subscribeWorkspaceEventsFn = (cb) => {
      onEvent = cb;
      return () => {};
    };
    const monitor = new Monitor(queue, {
      cmuxApi,
      resolveWorktreeFn: async () => ({ isWorktree: false }),
      subscribeWorkspaceEventsFn,
      pollIntervalMs: 60_000,
      immediatePollDebounceMs: 20,
    });

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const pollsBeforeBurst = pollCount;

    onEvent({ type: "event", name: "workspace.selected" });
    onEvent({ type: "event", name: "workspace.selected" });
    onEvent({ type: "event", name: "workspace.selected" });
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.equal(pollCount - pollsBeforeBurst, 1, "a burst of events should coalesce into one poll");
    monitor.stop();
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

  it("excludes and reaps notifications for workspaces outside the hosting window", async () => {
    // notification.list is global, but workspace.list only reflects the
    // window Agent Triage is hosted in — a notification for a workspace in
    // some other window (e.g. a stray second cmux window) should never
    // surface as a permanent, unresolved "Unknown" card.
    const state = {
      notifications: [
        { id: "notif-own", category: "waiting", workspaceId: "W1", surfaceId: "S1", body: "waiting" },
        { id: "notif-foreign", category: "permission", workspaceId: "GHOST-1", surfaceId: "S2", body: "approve?" },
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

    const items = queue.items();
    assert.equal(items.length, 1, "only the notification for a known workspace should surface");
    assert.equal(items[0].workspaceId, "W1");

    // Even if cmux keeps re-reporting the foreign notification on every
    // poll (as it did live — the ghost window doesn't go away on its own),
    // it should never accumulate as a permanent item.
    await monitor.poll();
    assert.equal(queue.items().length, 1);
  });
});

describe("Monitor tab order sync", () => {
  let queue;

  function makeCmux({ notifications = [], workspaces = [], terminals = [], agentWorkspaceIds = new Set(), bypassWorkspaceIds = new Set(), reorderWorkspaces = async () => {} }) {
    return {
      listNotifications: async () => notifications,
      listWorkspaces: async () => workspaces,
      listTerminals: async () => terminals,
      listAgentWorkspaceIds: async () => agentWorkspaceIds,
      listBypassWorkspaceIds: async () => bypassWorkspaceIds,
      readScreen: async () => null,
      reorderWorkspaces,
    };
  }

  beforeEach(() => {
    queue = new Queue();
  });

  it("pushes Agent Triage's order to cmux when it differs from cmux's current order", async () => {
    const calls = [];
    const cmuxApi = makeCmux({
      workspaces: [
        { id: "W1", windowId: "WIN1", title: "b-project", directory: "/home/user/b" },
        { id: "W2", windowId: "WIN1", title: "a-project", directory: "/home/user/a" },
      ],
      agentWorkspaceIds: new Set(["W1", "W2"]),
      reorderWorkspaces: async (windowId, order) => calls.push({ windowId, order }),
    });
    const monitor = new Monitor(queue, { cmuxApi, resolveWorktreeFn: async () => ({ isWorktree: false }) });

    await monitor.poll();

    // Directory groups sort alphabetically ("a" before "b"), so Agent
    // Triage's own order puts W2 first even though cmux currently has W1 first.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].windowId, "WIN1");
    assert.deepEqual(calls[0].order, ["W2", "W1"]);
  });

  it("does not call reorder when cmux's order already matches", async () => {
    const calls = [];
    const cmuxApi = makeCmux({
      workspaces: [
        { id: "W2", windowId: "WIN1", title: "a-project", directory: "/home/user/a" },
        { id: "W1", windowId: "WIN1", title: "b-project", directory: "/home/user/b" },
      ],
      agentWorkspaceIds: new Set(["W1", "W2"]),
      reorderWorkspaces: async (windowId, order) => calls.push({ windowId, order }),
    });
    const monitor = new Monitor(queue, { cmuxApi, resolveWorktreeFn: async () => ({ isWorktree: false }) });

    await monitor.poll();

    assert.equal(calls.length, 0);
  });

  it("does not reorder a window with only one known workspace", async () => {
    const calls = [];
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", windowId: "WIN1", title: "solo", directory: "/home/user/solo" }],
      agentWorkspaceIds: new Set(["W1"]),
      reorderWorkspaces: async (windowId, order) => calls.push({ windowId, order }),
    });
    const monitor = new Monitor(queue, { cmuxApi, resolveWorktreeFn: async () => ({ isWorktree: false }) });

    await monitor.poll();

    assert.equal(calls.length, 0);
  });

  it("keeps each window's reorder independent", async () => {
    const calls = [];
    const cmuxApi = makeCmux({
      workspaces: [
        { id: "W1", windowId: "WIN1", title: "b-project", directory: "/home/user/b" },
        { id: "W2", windowId: "WIN1", title: "a-project", directory: "/home/user/a" },
        { id: "W3", windowId: "WIN2", title: "y-project", directory: "/home/user/y" },
        { id: "W4", windowId: "WIN2", title: "x-project", directory: "/home/user/x" },
      ],
      agentWorkspaceIds: new Set(["W1", "W2", "W3", "W4"]),
      reorderWorkspaces: async (windowId, order) => calls.push({ windowId, order }),
    });
    const monitor = new Monitor(queue, { cmuxApi, resolveWorktreeFn: async () => ({ isWorktree: false }) });

    await monitor.poll();

    assert.equal(calls.length, 2);
    const byWindow = Object.fromEntries(calls.map((c) => [c.windowId, c.order]));
    assert.deepEqual(byWindow.WIN1, ["W2", "W1"]);
    assert.deepEqual(byWindow.WIN2, ["W4", "W3"]);
  });

  it("places dismissed workspaces after active ones in the pushed order", async () => {
    const calls = [];
    const cmuxApi = makeCmux({
      workspaces: [
        { id: "W1", windowId: "WIN1", title: "a-project", directory: "/home/user/a" },
        { id: "W2", windowId: "WIN1", title: "b-project", directory: "/home/user/b" },
      ],
      agentWorkspaceIds: new Set(["W1", "W2"]),
      reorderWorkspaces: async (windowId, order) => calls.push({ windowId, order }),
    });
    const monitor = new Monitor(queue, { cmuxApi, resolveWorktreeFn: async () => ({ isWorktree: false }) });

    await monitor.poll();
    assert.equal(calls.length, 0, "already in order, nothing to push yet");

    queue.dismiss("synthetic-W1");
    calls.length = 0;
    await monitor.poll();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].order, ["W2", "W1"]);
  });

  it("ignores its own workspace.reordered event instead of scheduling another poll", async () => {
    const cmuxApi = makeCmux({
      workspaces: [{ id: "W1", windowId: "WIN1", title: "solo", directory: "/home/user/solo" }],
      agentWorkspaceIds: new Set(["W1"]),
    });
    let pollCount = 0;
    const originalListWorkspaces = cmuxApi.listWorkspaces;
    cmuxApi.listWorkspaces = async () => {
      pollCount++;
      return originalListWorkspaces();
    };
    let onEvent;
    const subscribeWorkspaceEventsFn = (cb) => {
      onEvent = cb;
      return () => {};
    };
    const monitor = new Monitor(queue, {
      cmuxApi,
      resolveWorktreeFn: async () => ({ isWorktree: false }),
      subscribeWorkspaceEventsFn,
      pollIntervalMs: 60_000,
      immediatePollDebounceMs: 0,
    });

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const pollsBeforeEvent = pollCount;

    onEvent({ type: "event", name: "workspace.reordered" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(pollCount, pollsBeforeEvent, "a reordered event shouldn't trigger an extra poll");
    monitor.stop();
  });

  it("skips syncing tab order while more than one cmux window is open", async () => {
    const calls = [];
    const cmuxApi = {
      listNotifications: async () => [],
      listWorkspaces: async () => [
        { id: "W1", windowId: "WIN1", title: "b-project", directory: "/home/user/b" },
        { id: "W2", windowId: "WIN1", title: "a-project", directory: "/home/user/a" },
      ],
      listTerminals: async () => [],
      listAgentWorkspaceIds: async () => new Set(["W1", "W2"]),
      listBypassWorkspaceIds: async () => new Set(),
      readScreen: async () => null,
      reorderWorkspaces: async (windowId, order) => calls.push({ windowId, order }),
      getWindowCount: async () => 2,
    };
    const monitor = new Monitor(queue, { cmuxApi, resolveWorktreeFn: async () => ({ isWorktree: false }) });

    await monitor.poll();

    assert.equal(calls.length, 0, "should not reorder while a second window is open");
    assert.equal(monitor.windowCount, 2);
  });
});

describe("Monitor reentrancy and dependency injection", () => {
  let queue;

  beforeEach(() => {
    queue = new Queue();
  });

  it("defers an overlapping poll instead of running it concurrently", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    let listWorkspacesCalls = 0;
    const cmuxApi = {
      listNotifications: async () => [],
      listWorkspaces: async () => {
        listWorkspacesCalls++;
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight--;
        return [];
      },
      listTerminals: async () => [],
      listAgentWorkspaceIds: async () => new Set(),
      listBypassWorkspaceIds: async () => new Set(),
      readScreen: async () => null,
    };
    const monitor = new Monitor(queue, { cmuxApi });

    const first = monitor.poll();
    const second = monitor.poll(); // fires while `first` is still in flight
    await Promise.all([first, second]);
    // The deferred poll runs after `first` resolves, asynchronously — give
    // it a tick to complete before asserting the final call count.
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(maxConcurrent, 1, "polls should never run concurrently");
    assert.equal(listWorkspacesCalls, 2, "the overlapping call should still run once, right after the first");
  });

  it("uses subscribeWorkspaceEvents from an injected cmuxApi without a separate override", async () => {
    let subscribed = false;
    const cmuxApi = {
      listNotifications: async () => [],
      listWorkspaces: async () => [],
      listTerminals: async () => [],
      listAgentWorkspaceIds: async () => new Set(),
      listBypassWorkspaceIds: async () => new Set(),
      readScreen: async () => null,
      subscribeWorkspaceEvents: () => {
        subscribed = true;
        return () => {};
      },
    };
    // Deliberately no subscribeWorkspaceEventsFn override — the injected
    // cmuxApi's own subscribeWorkspaceEvents should be used instead of
    // falling through to the real module (which would open a real socket).
    const monitor = new Monitor(queue, { cmuxApi, pollIntervalMs: 60_000 });

    monitor.start();

    assert.equal(subscribed, true);
    monitor.stop();
  });
});
