import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Refresher, SESSION_ID_PATTERN } from "../src/refresh.js";

function makeWorkspace(id, surfaceRef, wsRef, tty) {
  return {
    id,
    ref: wsRef || `workspace:${id}`,
    panes: [{ surfaces: [{ type: "terminal", ref: surfaceRef, tty: tty || `ttys${id}` }] }],
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
  const mockExecFile = (_cmd, _args, cb) => cb(null, { stdout: "" });

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

  it("rejects when workspace has no tty", async () => {
    const ws = makeWorkspace("W1", "surface:1");
    ws.panes[0].surfaces[0].tty = null;
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([ws]);
        return {};
      },
      sendText: async () => {},
      sendKey: async () => {},
      readScreenByWorkspace: async () => null,
    };
    const refresher = new Refresher({ cmuxApi });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, false);
    assert.equal(result.error, "No tty found for workspace");
  });

  it("rejects duplicate refresh for the same workspace", async () => {
    let blockResolve;
    const block = new Promise((r) => { blockResolve = r; });

    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([makeWorkspace("W1", "surface:1", null, "ttysTest")]);
        return {};
      },
      sendText: async () => {},
      sendKey: async () => {},
      readScreenByWorkspace: async () => {
        await block;
        return "claude --resume abc-123";
      },
    };

    // Override findClaudePid to simulate a process that takes a while to exit
    let pidCalls = 0;
    const origExec = await import("node:child_process");
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10, timeoutMs: 5000 });

    // Monkey-patch the private method indirectly: the first call will block on readScreen
    const first = refresher.refreshSession("W1");
    await new Promise((r) => setTimeout(r, 50));

    const second = await refresher.refreshSession("W1");
    assert.equal(second.ok, false);
    assert.equal(second.error, "Already refreshing");

    blockResolve();
    await first.catch(() => {});
  });

  it("starts a fresh claude session when no session ID is found (no --continue)", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const sentTexts = [];
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([ws]);
        return {};
      },
      sendText: async (_wsId, _surfaceId, text) => { sentTexts.push(text); },
      sendKey: async () => {},
      readScreenByWorkspace: async () => "no session info here",
      renameWorkspace: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 3000 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    assert.equal(result.sessionId, null);
    const relaunchCmd = sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd, "should have sent a relaunch command");
    assert.equal(relaunchCmd, "claude", "should start fresh without --continue or --resume");
  });

  it("starts fresh with --dangerously-skip-permissions when no session ID and dangerous=true", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const sentTexts = [];
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([ws]);
        return {};
      },
      sendText: async (_wsId, _surfaceId, text) => { sentTexts.push(text); },
      sendKey: async () => {},
      readScreenByWorkspace: async () => "no session info here",
      renameWorkspace: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 3000 });

    const result = await refresher.refreshSession("W1", { dangerous: true });
    assert.equal(result.ok, true);
    const relaunchCmd = sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd, "should have sent a relaunch command");
    assert.equal(relaunchCmd, "claude --dangerously-skip-permissions", "should start fresh with dangerous flag");
  });

  it("appends --dangerously-skip-permissions when dangerous=true (with session ID)", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const sentTexts = [];
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([ws]);
        return {};
      },
      sendText: async (_wsId, _surfaceId, text) => { sentTexts.push(text); },
      sendKey: async () => {},
      readScreenByWorkspace: async () => "claude --resume abc-def-123",
      renameWorkspace: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 3000 });

    const result = await refresher.refreshSession("W1", { dangerous: true });
    assert.equal(result.ok, true);
    const relaunchCmd = sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd, "should have sent a relaunch command");
    assert.ok(relaunchCmd.includes("--dangerously-skip-permissions"), `relaunch cmd should include flag, got: ${relaunchCmd}`);
  });

  it("does not append --dangerously-skip-permissions by default", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const sentTexts = [];
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([ws]);
        return {};
      },
      sendText: async (_wsId, _surfaceId, text) => { sentTexts.push(text); },
      sendKey: async () => {},
      readScreenByWorkspace: async () => "claude --resume abc-def-123",
      renameWorkspace: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 3000 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    const relaunchCmd = sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd, "should have sent a relaunch command");
    assert.ok(!relaunchCmd.includes("--dangerously-skip-permissions"), `relaunch cmd should not include flag, got: ${relaunchCmd}`);
  });
});

describe("Refresher.waitForScreenStable (via refreshSession)", () => {
  it("sends /reload-plugins only after screen content stops changing", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const sentTexts = [];
    let screenCallCountAtReload = null;
    let screenCallCount = 0;

    // Screen sequence: two distinct values, then stabilizes at "> " for 3+ reads.
    // Stability requires seeing the same value twice with stableMs elapsed between them,
    // so /reload-plugins must not be sent until at least the 4th read (index 3).
    const screens = ["loading...", "still loading", "> ", "> ", "> ", "> "];
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      rpc: async (method) => {
        if (method === "system.top") return makeTopData([ws]);
        return {};
      },
      sendText: async (_wsId, _surfaceId, text) => {
        if (text === "/reload-plugins") screenCallCountAtReload = screenCallCount;
        sentTexts.push(text);
      },
      sendKey: async () => {},
      readScreenByWorkspace: async () => {
        const screen = screens[Math.min(screenCallCount, screens.length - 1)];
        screenCallCount++;
        return screen;
      },
      renameWorkspace: async () => {},
    };

    // Provide an execFileFn mock so ps returns no output — Claude appears not running,
    // and the kill path is deterministically skipped (no real process on this tty).
    const mockExecFile = (_cmd, _args, cb) => cb(null, { stdout: "" });

    const refresher = new Refresher({ cmuxApi, execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 5000 });
    const result = await refresher.refreshSession("W1");

    // /reload-plugins must be sent after screen stabilizes
    assert.ok(sentTexts.includes("/reload-plugins"), "should send /reload-plugins");
    // At the moment /reload-plugins was queued, the screen must have been read at least 4
    // times — enough to observe 2 content changes followed by a stable match.
    assert.ok(
      screenCallCountAtReload >= 4,
      `expected screenCallCount >= 4 when /reload-plugins was sent, got ${screenCallCountAtReload}`,
    );
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
