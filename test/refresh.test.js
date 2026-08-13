import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Refresher, SESSION_ID_PATTERN, isPendingInput, inputBoxText } from "../src/refresh.js";
import {
  IDLE,
  EXITED_WITH_SESSION_ID,
  EXITED_WITHOUT_SESSION_ID,
  PENDING_WITH_DROPDOWN,
  PENDING_NO_DROPDOWN,
  SUBMITTED,
  DROPDOWN_ACCEPTED_OTHER,
} from "./fixtures/claude-screens.js";

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

/**
 * Stateful screen source that mimics a real pane: `preSubmit` (a screen or a
 * function returning one) until `/reload-plugins` is typed, then the pending
 * input box, then the submitted screen once `entersToSubmit` Enters have landed.
 */
function makePane(preSubmit, { entersToSubmit = 1, pending = PENDING_NO_DROPDOWN, submitted = SUBMITTED } = {}) {
  const sentTexts = [];
  const sentKeys = [];
  let typed = false;
  let enters = 0;
  return {
    sentTexts,
    sentKeys,
    get entersAfterCommand() {
      return enters;
    },
    sendText: async (_wsId, _surfaceId, text) => {
      sentTexts.push(text);
      if (text === "/reload-plugins") typed = true;
    },
    sendKey: async (_wsId, _surfaceId, key) => {
      sentKeys.push(key);
      if (typed) enters++;
    },
    readScreenByWorkspace: async () => {
      if (!typed) return typeof preSubmit === "function" ? preSubmit() : preSubmit;
      return enters >= entersToSubmit ? submitted : pending;
    },
    renameWorkspace: async () => {},
  };
}

function makeCmuxApi(pane, workspaces) {
  return {
    listAgentWorkspaceIds: async () => new Set(["W1"]),
    rpc: async (method) => {
      if (method === "system.top") return makeTopData(workspaces);
      return {};
    },
    sendText: pane.sendText,
    sendKey: pane.sendKey,
    readScreenByWorkspace: pane.readScreenByWorkspace,
    renameWorkspace: pane.renameWorkspace,
  };
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
    const pane = makePane(EXITED_WITHOUT_SESSION_ID);
    const refresher = new Refresher({ cmuxApi: makeCmuxApi(pane, [ws]), execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 3000 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    assert.equal(result.sessionId, null);
    const relaunchCmd = pane.sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd, "should have sent a relaunch command");
    assert.equal(relaunchCmd, "claude", "should start fresh without --continue or --resume");
  });

  it("starts fresh with --dangerously-skip-permissions when no session ID and dangerous=true", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const pane = makePane(EXITED_WITHOUT_SESSION_ID);
    const refresher = new Refresher({ cmuxApi: makeCmuxApi(pane, [ws]), execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 3000 });

    const result = await refresher.refreshSession("W1", { dangerous: true });
    assert.equal(result.ok, true);
    const relaunchCmd = pane.sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd, "should have sent a relaunch command");
    assert.equal(relaunchCmd, "claude --dangerously-skip-permissions", "should start fresh with dangerous flag");
  });

  it("appends --dangerously-skip-permissions when dangerous=true (with session ID)", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const pane = makePane(EXITED_WITH_SESSION_ID);
    const refresher = new Refresher({ cmuxApi: makeCmuxApi(pane, [ws]), execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 3000 });

    const result = await refresher.refreshSession("W1", { dangerous: true });
    assert.equal(result.ok, true);
    const relaunchCmd = pane.sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd, "should have sent a relaunch command");
    assert.ok(relaunchCmd.includes("--dangerously-skip-permissions"), `relaunch cmd should include flag, got: ${relaunchCmd}`);
  });

  it("does not append --dangerously-skip-permissions by default", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const pane = makePane(EXITED_WITH_SESSION_ID);
    const refresher = new Refresher({ cmuxApi: makeCmuxApi(pane, [ws]), execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 3000 });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    const relaunchCmd = pane.sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd, "should have sent a relaunch command");
    assert.ok(!relaunchCmd.includes("--dangerously-skip-permissions"), `relaunch cmd should not include flag, got: ${relaunchCmd}`);
  });
});

describe("Refresher.waitForScreenStable (via refreshSession)", () => {
  it("sends /reload-plugins only after screen content stops changing", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    let screenCallCountAtReload = null;
    let screenCallCount = 0;

    // Screen sequence: two distinct values, then stabilizes at the idle prompt for
    // 3+ reads. Stability requires seeing the same value twice with stableMs elapsed
    // between them, so /reload-plugins must not be sent until at least the 4th read.
    const screens = ["initializing...", "resuming session...", IDLE, IDLE, IDLE, IDLE];
    const pane = makePane(() => {
      const screen = screens[Math.min(screenCallCount, screens.length - 1)];
      screenCallCount++;
      return screen;
    });
    const origSendText = pane.sendText;
    const cmuxApi = makeCmuxApi(pane, [ws]);
    cmuxApi.sendText = async (wsId, surfaceId, text) => {
      if (text === "/reload-plugins") screenCallCountAtReload = screenCallCount;
      await origSendText(wsId, surfaceId, text);
    };

    // Provide an execFileFn mock so ps returns no output — Claude appears not running,
    // and the kill path is deterministically skipped (no real process on this tty).
    const mockExecFile = (_cmd, _args, cb) => cb(null, { stdout: "" });

    const refresher = new Refresher({ cmuxApi, execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 5000 });
    const result = await refresher.refreshSession("W1");

    // /reload-plugins must be sent after screen stabilizes
    assert.equal(result.ok, true);
    assert.ok(pane.sentTexts.includes("/reload-plugins"), "should send /reload-plugins");
    // At the moment /reload-plugins was queued, the screen must have been read at least 4
    // times — enough to observe 2 content changes followed by a stable match.
    assert.ok(
      screenCallCountAtReload >= 4,
      `expected screenCallCount >= 4 when /reload-plugins was sent, got ${screenCallCountAtReload}`,
    );
  });
});

describe("inputBoxText", () => {
  it("reads the bottom-most prompt line, not an earlier transcript echo", () => {
    assert.equal(inputBoxText(PENDING_WITH_DROPDOWN), "/reload-plugins");
    assert.equal(inputBoxText(SUBMITTED), "");
  });

  it("ignores autocomplete suggestion rows", () => {
    assert.ok(
      PENDING_WITH_DROPDOWN.includes("  /reload-plugins  "),
      "fixture should contain an indented autocomplete row",
    );
    assert.equal(inputBoxText(PENDING_WITH_DROPDOWN), "/reload-plugins");
  });

  it("returns null when no prompt line is on screen", () => {
    assert.equal(inputBoxText(null), null);
    assert.equal(inputBoxText(""), null);
    assert.equal(inputBoxText("⏺ Working...\n  ⎿  Read 3 files"), null);
  });
});

describe("isPendingInput", () => {
  it("detects a command still sitting in the input box (dropdown open)", () => {
    assert.equal(isPendingInput(PENDING_WITH_DROPDOWN, "/reload-plugins"), true);
  });

  it("detects a command still sitting in the input box (dropdown dismissed)", () => {
    assert.equal(isPendingInput(PENDING_NO_DROPDOWN, "/reload-plugins"), true);
  });

  it("does not treat a submitted transcript echo as pending", () => {
    assert.equal(isPendingInput(SUBMITTED, "/reload-plugins"), false);
  });

  it("is false for an idle prompt and for a different command in the box", () => {
    assert.equal(isPendingInput(IDLE, "/reload-plugins"), false);
    assert.equal(isPendingInput(DROPDOWN_ACCEPTED_OTHER, "/reload-plugins"), false);
  });

  it("returns false for an empty or unreadable screen", () => {
    assert.equal(isPendingInput(null, "/reload-plugins"), false);
    assert.equal(isPendingInput("", "/reload-plugins"), false);
  });
});

describe("Refresher /reload-plugins submission", () => {
  const mockExecFile = (_cmd, _args, cb) => cb(null, { stdout: "" });

  const ws = () => makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");

  function run(pane) {
    const refresher = new Refresher({
      cmuxApi: makeCmuxApi(pane, [ws()]),
      execFileFn: mockExecFile,
      pollIntervalMs: 10,
      timeoutMs: 3000,
    });
    return refresher.refreshSession("W1");
  }

  it("sends exactly one Enter when the first one submits", async () => {
    const pane = makePane(IDLE, { entersToSubmit: 1 });
    const result = await run(pane);

    assert.equal(result.ok, true);
    assert.ok(pane.sentTexts.includes("/reload-plugins"), "should send /reload-plugins");
    assert.equal(pane.entersAfterCommand, 1, `expected a single Enter, got ${pane.entersAfterCommand}`);
  });

  it("re-sends Enter when the autocomplete dropdown swallowed the first one", async () => {
    const pane = makePane(IDLE, { entersToSubmit: 2, pending: PENDING_WITH_DROPDOWN });
    const result = await run(pane);

    assert.equal(result.ok, true);
    assert.equal(pane.entersAfterCommand, 2, `expected a retried Enter, got ${pane.entersAfterCommand}`);
  });

  it("reports failure when /reload-plugins never leaves the input box", async () => {
    const pane = makePane(IDLE, { entersToSubmit: Infinity, pending: PENDING_WITH_DROPDOWN });
    const result = await run(pane);

    assert.equal(result.ok, false);
    assert.match(result.error, /reload-plugins/);
    assert.equal(pane.entersAfterCommand, 3, "should stop retrying Enter after 3 attempts");
  });

  it("reports failure when the dropdown accepted a different command", async () => {
    const pane = makePane(IDLE, { entersToSubmit: 1, submitted: DROPDOWN_ACCEPTED_OTHER });
    const result = await run(pane);

    assert.equal(result.ok, false);
    assert.match(result.error, /replaced in the input box/);
    assert.match(result.error, /reload-plugins-force/);
    assert.equal(pane.entersAfterCommand, 1, "should not keep pressing Enter on a foreign command");
  });

  it("reports failure when the typed command never reaches the input box", async () => {
    // sendText silently no-ops: the pane keeps showing an empty prompt.
    const pane = makePane(IDLE, { entersToSubmit: 1, pending: IDLE, submitted: IDLE });
    const cmuxApi = makeCmuxApi(pane, [ws()]);
    cmuxApi.readScreenByWorkspace = async () => IDLE;
    const refresher = new Refresher({ cmuxApi, execFileFn: mockExecFile, pollIntervalMs: 10, timeoutMs: 3000 });

    const result = await refresher.refreshSession("W1");

    assert.equal(result.ok, false);
    assert.match(result.error, /never reached the input box/);
    assert.equal(pane.entersAfterCommand, 0, "should not press Enter when the command never landed");
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
