import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Refresher, SESSION_ID_PATTERN } from "../src/refresh.js";

const SESSION_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

function makeCmux({
  agentWorkspaceIds = new Set(),
  terminals = [],
  screenSequence = [],
} = {}) {
  let screenIndex = 0;
  const calls = { sendText: [], sendKey: [] };
  return {
    calls,
    listAgentWorkspaceIds: async () => agentWorkspaceIds,
    listTerminals: async () => terminals,
    readScreen: async () => {
      const screen = screenSequence[screenIndex];
      if (screenIndex < screenSequence.length - 1) screenIndex++;
      return screen ?? null;
    },
    sendText: async (wsId, surfId, text) => { calls.sendText.push({ wsId, surfId, text }); },
    sendKey: async (wsId, surfId, key) => { calls.sendKey.push({ wsId, surfId, key }); },
  };
}

describe("SESSION_ID_PATTERN", () => {
  it("matches 'Session ID: <uuid>' format", () => {
    const line = `Session ID: ${SESSION_UUID}`;
    const match = line.match(SESSION_ID_PATTERN);
    assert.ok(match);
    assert.equal(match[1], SESSION_UUID);
  });

  it("matches 'Resumable session: <uuid>' format", () => {
    const line = `Resumable session: ${SESSION_UUID}`;
    const match = line.match(SESSION_ID_PATTERN);
    assert.ok(match);
    assert.equal(match[1], SESSION_UUID);
  });

  it("does not match random text", () => {
    assert.equal("hello world".match(SESSION_ID_PATTERN), null);
  });
});

describe("Refresher.refreshSession", () => {
  it("rejects non-Claude Code workspaces", async () => {
    const cmuxApi = makeCmux({ agentWorkspaceIds: new Set() });
    const refresher = new Refresher({ cmuxApi });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, false);
    assert.equal(result.error, "Not a Claude Code session");
  });

  it("rejects when workspace has no terminal", async () => {
    const cmuxApi = makeCmux({
      agentWorkspaceIds: new Set(["W1"]),
      terminals: [],
    });
    const refresher = new Refresher({ cmuxApi });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, false);
    assert.equal(result.error, "Workspace not found");
  });

  it("sends /exit and resumes with captured session ID", async () => {
    const cmuxApi = makeCmux({
      agentWorkspaceIds: new Set(["W1"]),
      terminals: [{ workspaceId: "W1", paneId: "P1", paneRef: "pane:1" }],
      screenSequence: [
        null,
        `Claude Code exiting...\nSession ID: ${SESSION_UUID}\n$`,
      ],
    });
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    assert.equal(result.sessionId, SESSION_UUID);

    assert.equal(cmuxApi.calls.sendText.length, 2);
    assert.equal(cmuxApi.calls.sendText[0].text, "/exit");
    assert.ok(cmuxApi.calls.sendText[1].text.includes(`claude --resume ${SESSION_UUID}`));

    assert.equal(cmuxApi.calls.sendKey.length, 2);
    assert.equal(cmuxApi.calls.sendKey[0].key, "Enter");
    assert.equal(cmuxApi.calls.sendKey[1].key, "Enter");
  });

  it("times out when session ID never appears", async () => {
    const cmuxApi = makeCmux({
      agentWorkspaceIds: new Set(["W1"]),
      terminals: [{ workspaceId: "W1", paneId: "P1", paneRef: "pane:1" }],
      screenSequence: ["just a shell prompt\n$"],
    });
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10, timeoutMs: 50 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, false);
    assert.equal(result.error, "Timeout waiting for session ID");
  });

  it("rejects duplicate refresh for the same workspace", async () => {
    let resolveScreen;
    const screenPromise = new Promise((r) => { resolveScreen = r; });
    let firstCall = true;
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1"]),
      listTerminals: async () => [{ workspaceId: "W1", paneId: "P1", paneRef: "pane:1" }],
      readScreen: async () => {
        if (firstCall) {
          firstCall = false;
          await screenPromise;
          return `Session ID: ${SESSION_UUID}`;
        }
        return `Session ID: ${SESSION_UUID}`;
      },
      sendText: async () => {},
      sendKey: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10 });

    const first = refresher.refreshSession("W1");
    // Give the first call time to enter the in-flight state
    await new Promise((r) => setTimeout(r, 20));
    const second = await refresher.refreshSession("W1");
    assert.equal(second.ok, false);
    assert.equal(second.error, "Already refreshing");

    // Unblock the first call
    resolveScreen();
    const firstResult = await first;
    assert.equal(firstResult.ok, true);
  });

  it("clears in-flight state after failure", async () => {
    const cmuxApi = makeCmux({
      agentWorkspaceIds: new Set(["W1"]),
      terminals: [{ workspaceId: "W1", paneId: "P1", paneRef: "pane:1" }],
      screenSequence: ["no session id here"],
    });
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10, timeoutMs: 30 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, false);

    // Should be able to try again (not stuck in "Already refreshing")
    const retry = await refresher.refreshSession("W1");
    assert.equal(retry.ok, false);
    assert.equal(retry.error, "Timeout waiting for session ID");
  });
});

describe("Refresher.refreshAll", () => {
  it("refreshes all Claude Code sessions concurrently", async () => {
    const uuid2 = "11111111-2222-3333-4444-555555555555";
    let w1Calls = 0;
    let w2Calls = 0;
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1", "W2"]),
      listTerminals: async () => [
        { workspaceId: "W1", paneId: "P1", paneRef: "pane:1" },
        { workspaceId: "W2", paneId: "P2", paneRef: "pane:2" },
      ],
      readScreen: async (surfaceId) => {
        if (surfaceId === "pane:1") {
          w1Calls++;
          return w1Calls > 1 ? `Session ID: ${SESSION_UUID}` : null;
        }
        w2Calls++;
        return w2Calls > 1 ? `Session ID: ${uuid2}` : null;
      },
      sendText: async () => {},
      sendKey: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10 });

    const result = await refresher.refreshAll();
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 2);

    const r1 = result.results.find((r) => r.workspaceId === "W1");
    const r2 = result.results.find((r) => r.workspaceId === "W2");
    assert.equal(r1.ok, true);
    assert.equal(r1.sessionId, SESSION_UUID);
    assert.equal(r2.ok, true);
    assert.equal(r2.sessionId, uuid2);
  });

  it("returns empty results when no agent sessions exist", async () => {
    const cmuxApi = makeCmux({ agentWorkspaceIds: new Set() });
    const refresher = new Refresher({ cmuxApi });

    const result = await refresher.refreshAll();
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 0);
  });

  it("includes partial failures in results", async () => {
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1", "W2"]),
      listTerminals: async () => [
        { workspaceId: "W1", paneId: "P1", paneRef: "pane:1" },
        // W2 has no terminal — will fail with "Workspace not found"
      ],
      readScreen: async () => `Session ID: ${SESSION_UUID}`,
      sendText: async () => {},
      sendKey: async () => {},
    };
    const refresher = new Refresher({ cmuxApi, pollIntervalMs: 10 });

    const result = await refresher.refreshAll();
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 2);

    const r1 = result.results.find((r) => r.workspaceId === "W1");
    const r2 = result.results.find((r) => r.workspaceId === "W2");
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, false);
    assert.equal(r2.error, "Workspace not found");
  });
});
