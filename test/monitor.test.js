import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { enrichNotification, parseScreenForQuestion, Monitor } from "../src/monitor.js";
import { Queue } from "../src/queue.js";

describe("parseScreenForQuestion", () => {
  it("extracts question text and options from screen content", () => {
    const screen = [
      "Some output above",
      "",
      '  "Which test approach should we use?"',
      "",
      "  ❯ Unit tests only",
      "    Integration tests",
      "    Both unit and integration",
      "    Other",
    ].join("\n");

    const result = parseScreenForQuestion(screen);
    assert.ok(result);
    assert.ok(result.question.includes("Which test approach"));
    assert.ok(result.options.length >= 3);
  });

  it("returns null when no question is found", () => {
    const screen = "just regular terminal output\n$ ls\nfile1.js file2.js";
    const result = parseScreenForQuestion(screen);
    assert.equal(result, null);
  });
});

describe("enrichNotification", () => {
  it("adds screen data and question info to waiting notifications", async () => {
    const notification = {
      id: "A",
      category: "waiting",
      workspaceId: "W1",
      surfaceId: "S1",
    };
    const workspaces = [{ id: "W1", title: "zenpayroll", directory: "/home/testuser/workspace/zenpayroll" }];
    const terminals = [{ workspaceId: "W1", paneId: "P1", directory: "/home/testuser/workspace/zenpayroll", gitBranch: "main" }];
    const mockReadScreen = async () => 'Some output\n  "Pick one?"\n  ❯ Option A\n    Option B';

    const result = await enrichNotification(notification, workspaces, terminals, mockReadScreen);
    assert.equal(result.workspaceTitle, "zenpayroll");
    assert.equal(result.workspaceDir, "/home/testuser/workspace/zenpayroll");
    assert.equal(result.gitBranch, "main");
    assert.ok(result.screenContent);
  });
});

describe("Monitor terminal detection", () => {
  let queue;

  function makeCmux({ notifications = [], workspaces = [], terminals = [], agentWorkspaceIds = new Set() }) {
    return {
      listNotifications: async () => notifications,
      listWorkspaces: async () => workspaces,
      listTerminals: async () => terminals,
      listAgentWorkspaceIds: async () => agentWorkspaceIds,
      readScreen: async () => null,
    };
  }

  beforeEach(() => {
    queue = new Queue();
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
});
