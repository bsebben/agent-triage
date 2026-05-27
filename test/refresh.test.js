import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Refresher, SESSION_ID_PATTERN } from "../src/refresh.js";

function makeWorkspace(id, surfaceRef, wsRef) {
  return {
    id,
    ref: wsRef || `workspace:${id}`,
    panes: [{ surfaces: [{ type: "terminal", ref: surfaceRef }] }],
  };
}

function makeTopData(workspaces) {
  return { windows: [{ workspaces }] };
}

describe("SESSION_ID_PATTERN", () => {
  it("matches 'claude --resume <uuid>' format", () => {
    const line = "claude --resume a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const match = line.match(SESSION_ID_PATTERN);
    assert.ok(match);
    assert.equal(match[1], "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  it("matches within surrounding text", () => {
    const screen = "Resume this session with:\nclaude --resume dbac4eb4-bc8b-4130-b4cd-124e736f645a\n➜  repo";
    const match = screen.match(SESSION_ID_PATTERN);
    assert.ok(match);
    assert.equal(match[1], "dbac4eb4-bc8b-4130-b4cd-124e736f645a");
  });

  it("does not match random text", () => {
    assert.equal("hello world".match(SESSION_ID_PATTERN), null);
  });
});

describe("Refresher.refreshSession", () => {
  it("rejects non-Claude Code workspaces", async () => {
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(),
      rpc: async () => ({}),
      sendText: async () => {},
      sendKey: async () => {},
      readScreenByWorkspace: async () => null,
    };
    const refresher = new Refresher({ cmuxApi });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, false);
    assert.equal(result.error, "Not a Claude Code session");
  });

  it("rejects when workspace has no terminal", async () => {
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([]);
        return {};
      },
      sendText: async () => {},
      sendKey: async () => {},
      readScreenByWorkspace: async () => null,
    };
    const refresher = new Refresher({ cmuxApi });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, false);
    assert.equal(result.error, "Workspace not found");
  });

  it("rejects duplicate refresh for the same workspace", async () => {
    let blockResolve;
    const block = new Promise((r) => { blockResolve = r; });

    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([makeWorkspace("W1", "surface:1")]);
        return {};
      },
      sendText: async () => {},
      sendKey: async () => {},
      readScreenByWorkspace: async () => {
        await block;
        return "claude --resume abc-123";
      },
    };

    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10, timeoutMs: 5000 });

    const first = refresher.refreshSession("W1");
    await new Promise((r) => setTimeout(r, 50));

    const second = await refresher.refreshSession("W1");
    assert.equal(second.ok, false);
    assert.equal(second.error, "Already refreshing");

    blockResolve();
    await first.catch(() => {});
  });

  it("sends ctrl+c and ctrl+d to stop Claude", async () => {
    const keysSent = [];
    let pollCount = 0;

    const cmuxApi = {
      listAgentWorkspaceIds: async () => {
        pollCount++;
        if (pollCount <= 2) return new Set(["W1"]);
        return new Set();
      },
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([makeWorkspace("W1", "surface:1")]);
        return {};
      },
      sendText: async () => {},
      sendKey: async (_ws, _surface, key) => { keysSent.push(key); },
      readScreenByWorkspace: async () => null,
      renameWorkspace: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10, timeoutMs: 2000 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    assert.equal(result.sessionId, null);
    assert.ok(keysSent.includes("ctrl+c"), "should send ctrl+c");
    assert.ok(keysSent.includes("ctrl+d"), "should send ctrl+d");
  });

  it("detects exit via session ID on screen", async () => {
    let pollCount = 0;
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([makeWorkspace("W1", "surface:1")]);
        return {};
      },
      sendText: async () => {},
      sendKey: async () => {},
      readScreenByWorkspace: async () => {
        pollCount++;
        if (pollCount >= 2) return "To resume:\nclaude --resume aabbccdd-1122-3344-5566-778899aabbcc\n➜";
        return "working...";
      },
      renameWorkspace: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10, timeoutMs: 2000 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    assert.equal(result.sessionId, "aabbccdd-1122-3344-5566-778899aabbcc");
  });

  it("times out when Claude does not exit", async () => {
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([makeWorkspace("W1", "surface:1")]);
        return {};
      },
      sendText: async () => {},
      sendKey: async () => {},
      readScreenByWorkspace: async () => "still running...",
      renameWorkspace: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10, timeoutMs: 100 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, false);
    assert.equal(result.error, "Timeout waiting for Claude Code to exit");
  });
});

describe("Refresher.refreshAll", () => {
  it("returns empty results when no agent sessions exist", async () => {
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(),
      rpc: async () => ({}),
      sendText: async () => {},
      sendKey: async () => {},
      readScreenByWorkspace: async () => null,
    };
    const refresher = new Refresher({ cmuxApi });

    const result = await refresher.refreshAll();
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 0);
  });

  it("includes partial failures in results", async () => {
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1", "W2"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([makeWorkspace("W1", "surface:1")]);
        return {};
      },
      sendText: async () => {},
      sendKey: async () => {},
      readScreenByWorkspace: async () => null,
    };
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10, timeoutMs: 50 });

    const result = await refresher.refreshAll();
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 2);

    const r2 = result.results.find((r) => r.workspaceId === "W2");
    assert.equal(r2.ok, false);
    assert.equal(r2.error, "Workspace not found");
  });
});
