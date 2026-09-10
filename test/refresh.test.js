import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Refresher, SESSION_ID_PATTERN, isPendingInput, inputBoxText } from "../src/refresh.js";
import { permissionFlags } from "../src/utils.js";
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

// Above macOS's pid ceiling, so tests that let the real `process.kill` run can
// only ever ESRCH — the fake pid can never name a real process.
const UNREACHABLE_PID_BASE = 2147480000;

/**
 * Fake `ps` for a Claude Code process launched with `flagsByTty` — either a
 * flag string used for every tty, or a `{ tty: flags }` map. A tty mapped to
 * `null` has no Claude process at all (already exited).
 *
 * The process is reported alive for the pid lookup that precedes the kill and
 * gone for every later poll, which is the state sequence a real refresh walks
 * through. Every query is appended to `calls` as `{ kind, tty }` so tests can
 * assert the order the refresh reads and kills in.
 */
function mockPs(flagsByTty, calls = []) {
  const flagsFor = (tty) => (typeof flagsByTty === "string" ? flagsByTty : flagsByTty[tty]);
  const pidByTty = new Map();
  const ttyByPid = new Map();
  const looked = new Set();

  const pidFor = (tty) => {
    if (flagsFor(tty) === null || flagsFor(tty) === undefined) return null;
    if (!pidByTty.has(tty)) {
      const pid = UNREACHABLE_PID_BASE + pidByTty.size + 1;
      pidByTty.set(tty, pid);
      ttyByPid.set(pid, tty);
    }
    return pidByTty.get(tty);
  };

  return (_cmd, args, cb) => {
    if (args.includes("args=")) {
      const pid = Number(args[args.indexOf("-p") + 1]);
      const tty = ttyByPid.get(pid);
      calls.push({ kind: "args", tty: tty ?? null });
      if (tty === undefined) return cb(null, { stdout: "" });
      return cb(null, { stdout: `node /opt/homebrew/bin/claude --resume abc ${flagsFor(tty)}\n` });
    }

    const tty = args[args.indexOf("-t") + 1];
    calls.push({ kind: "pid", tty });
    const pid = pidFor(tty);
    // Alive for the pre-kill lookup only; the exit poll that follows the kill
    // must see it gone or the refresh times out.
    if (pid === null || looked.has(tty)) return cb(null, { stdout: "" });
    looked.add(tty);
    cb(null, { stdout: `${pid} claude\n` });
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

  it("replays --dangerously-skip-permissions from the running session", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const pane = makePane(EXITED_WITH_SESSION_ID);
    const refresher = new Refresher({
      cmuxApi: makeCmuxApi(pane, [ws]),
      execFileFn: mockPs("--dangerously-skip-permissions"),
      pollIntervalMs: 10,
      timeoutMs: 3000,
    });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    const relaunchCmd = pane.sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd.endsWith(" --dangerously-skip-permissions"), `relaunch cmd should replay the flag, got: ${relaunchCmd}`);
  });

  it("replays --permission-mode from the running session", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const pane = makePane(EXITED_WITH_SESSION_ID);
    const refresher = new Refresher({
      cmuxApi: makeCmuxApi(pane, [ws]),
      execFileFn: mockPs("--permission-mode plan"),
      pollIntervalMs: 10,
      timeoutMs: 3000,
    });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    const relaunchCmd = pane.sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd.endsWith(" --permission-mode plan"), `relaunch cmd should replay the mode, got: ${relaunchCmd}`);
  });

  it("replays no flags when the Claude process has already exited", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const pane = makePane(EXITED_WITH_SESSION_ID);
    const refresher = new Refresher({
      cmuxApi: makeCmuxApi(pane, [ws]),
      // No process on the tty at all: argv is gone, so there is nothing to read
      // the launch mode from and the relaunch falls back to default mode.
      execFileFn: mockPs({ ttysTest: null }),
      pollIntervalMs: 10,
      timeoutMs: 3000,
    });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);
    const relaunchCmd = pane.sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd, "should have sent a relaunch command");
    assert.ok(
      !relaunchCmd.includes("--dangerously-skip-permissions") && !relaunchCmd.includes("--permission-mode"),
      `an exited session cannot replay flags, got: ${relaunchCmd}`,
    );
  });

  it("does not duplicate the flag when dangerous=true and the session already bypasses", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const pane = makePane(EXITED_WITH_SESSION_ID);
    const refresher = new Refresher({
      cmuxApi: makeCmuxApi(pane, [ws]),
      execFileFn: mockPs("--dangerously-skip-permissions"),
      pollIntervalMs: 10,
      timeoutMs: 3000,
    });

    const result = await refresher.refreshSession("W1", { dangerous: true });
    assert.equal(result.ok, true);
    const relaunchCmd = pane.sentTexts.find((t) => t.startsWith("claude"));
    assert.equal(relaunchCmd.match(/--dangerously-skip-permissions/g).length, 1, `flag should appear once, got: ${relaunchCmd}`);
  });

  it("reads the permission flags before killing the process", async () => {
    const ws = makeWorkspace("W1", "surface:1", "workspace:W1", "ttysTest");
    const pane = makePane(EXITED_WITH_SESSION_ID);
    const calls = [];
    const refresher = new Refresher({
      cmuxApi: makeCmuxApi(pane, [ws]),
      execFileFn: mockPs("--dangerously-skip-permissions", calls),
      // Recorded in the same log as the ps queries so the read/kill order is
      // observable; the workspace has a single tty, so the pid needs no mapping.
      killFn: () => calls.push({ kind: "kill", tty: "ttysTest" }),
      pollIntervalMs: 10,
      timeoutMs: 3000,
    });

    const result = await refresher.refreshSession("W1");
    assert.equal(result.ok, true);

    // The flags live in the process's argv, so they can only be read while the
    // process is alive. Asserting the read lands before the SIGTERM — not just
    // that the final command is right — is what makes a refactor that moves the
    // lookup after the kill fail loudly instead of silently reading a dead
    // process and dropping the mode.
    const kinds = calls.filter((c) => c.tty === "ttysTest").map((c) => c.kind);
    assert.deepEqual(
      kinds.slice(0, 3),
      ["pid", "args", "kill"],
      `argv must be read between the pid lookup and the kill, got: ${JSON.stringify(calls)}`,
    );
    assert.ok(kinds.includes("kill"), "the refresh should have killed the live process");
    const relaunchCmd = pane.sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(relaunchCmd.endsWith(" --dangerously-skip-permissions"), `relaunch cmd should replay the flag, got: ${relaunchCmd}`);
  });
});

describe("permissionFlags", () => {
  it("returns no flags for a session launched without any", () => {
    assert.deepEqual(permissionFlags("node /opt/homebrew/bin/claude --resume abc\n-zsh\n"), []);
  });

  it("picks up --dangerously-skip-permissions", () => {
    assert.deepEqual(permissionFlags("node /opt/homebrew/bin/claude --dangerously-skip-permissions\n"), [
      "--dangerously-skip-permissions",
    ]);
  });

  it("picks up --permission-mode in both space and equals form", () => {
    assert.deepEqual(permissionFlags("node /opt/homebrew/bin/claude --permission-mode acceptEdits\n"), [
      "--permission-mode acceptEdits",
    ]);
    assert.deepEqual(permissionFlags("node /opt/homebrew/bin/claude --permission-mode=plan\n"), [
      "--permission-mode plan",
    ]);
  });

  it("ignores flags on processes that are not Claude Code", () => {
    assert.deepEqual(permissionFlags("vim notes-on---dangerously-skip-permissions.md\n"), []);
  });

  it("ignores flag-looking text inside the session's own prompt", () => {
    assert.deepEqual(
      permissionFlags("node /opt/homebrew/bin/claude fix the --dangerously-skip-permissions replay bug\n"),
      [],
    );
    assert.deepEqual(
      permissionFlags("node /opt/homebrew/bin/claude --resume abc why does --permission-mode plan fail\n"),
      [],
    );
  });

  it("reads flags that follow a value-taking flag", () => {
    assert.deepEqual(
      permissionFlags('node /opt/homebrew/bin/claude --settings {"a":1} --dangerously-skip-permissions run it\n'),
      ["--dangerously-skip-permissions"],
    );
  });

  it("steps over a --settings blob whose JSON contains spaces", () => {
    // Claude re-execs itself with its resolved settings inline, and hook
    // commands in there have spaces, so ps prints the blob as several tokens.
    const argv =
      '/opt/homebrew/Caskroom/claude-code@latest/2.1.241/claude --session-id 1295-4061 --fork-session' +
      ' --resume /Users/me/.claude/projects/-Users-me-repo/f540f70e.jsonl' +
      ' --settings {"hooks":{"SessionStart":[{"command":"bash -c echo hi"}]}} --dangerously-skip-permissions\n';
    assert.deepEqual(permissionFlags(argv), ["--dangerously-skip-permissions"]);
  });

  it("does not read the wrapped command line of the bg-pty-host helper as flags", () => {
    // The helper's argv embeds the real claude invocation after a `--`, so the
    // first claude token on the line is followed by the helper's own socket path.
    const argv =
      "/opt/homebrew/Caskroom/claude-code@latest/2.1.241/claude --bg-pty-host /tmp/cc/12958703.sock 240 74" +
      " -- /opt/homebrew/Caskroom/claude-code@latest/2.1.241/claude --session-id 1295-4061\n";
    assert.deepEqual(permissionFlags(argv), []);
  });

  it("ignores a matching process further down the tty once claude is found", () => {
    const psOutput = "-zsh\nnode /opt/homebrew/bin/claude --resume abc write the docs\n";
    assert.deepEqual(permissionFlags(psOutput), []);
  });

  it("returns no flags for empty or missing ps output", () => {
    assert.deepEqual(permissionFlags(""), []);
    assert.deepEqual(permissionFlags(null), []);
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

  it("preserves each session's own permission mode", async () => {
    const workspaces = [
      makeWorkspace("W1", "surface:1", "workspace:W1", "ttys001"),
      makeWorkspace("W2", "surface:2", "workspace:W2", "ttys002"),
    ];
    const panes = { W1: makePane(EXITED_WITH_SESSION_ID), W2: makePane(EXITED_WITH_SESSION_ID) };
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1", "W2"]),
      rpc: async (method) => (method === "system.top" ? makeTopData(workspaces) : {}),
      sendText: async (wsId, surfaceId, text) => panes[wsId].sendText(wsId, surfaceId, text),
      sendKey: async (wsId, surfaceId, key) => panes[wsId].sendKey(wsId, surfaceId, key),
      readScreenByWorkspace: async (wsRef) => panes[wsRef.replace("workspace:", "")].readScreenByWorkspace(),
      renameWorkspace: async () => {},
    };
    const refresher = new Refresher({
      cmuxApi,
      execFileFn: mockPs({ ttys001: "--dangerously-skip-permissions", ttys002: "" }),
      pollIntervalMs: 10,
      timeoutMs: 3000,
    });

    const result = await refresher.refreshAll();
    assert.equal(result.ok, true);
    assert.ok(result.results.every((r) => r.ok), `all refreshes should succeed, got: ${JSON.stringify(result.results)}`);

    const relaunchOf = (wsId) => panes[wsId].sentTexts.find((t) => t.startsWith("claude"));
    assert.ok(
      relaunchOf("W1").includes("--dangerously-skip-permissions"),
      `bypass session should stay in bypass mode, got: ${relaunchOf("W1")}`,
    );
    assert.ok(
      !relaunchOf("W2").includes("--dangerously-skip-permissions"),
      `default session should not be escalated, got: ${relaunchOf("W2")}`,
    );
  });

  it("escalates every session when dangerous is set", async () => {
    const workspaces = [
      makeWorkspace("W1", "surface:1", "workspace:W1", "ttys001"),
      makeWorkspace("W2", "surface:2", "workspace:W2", "ttys002"),
    ];
    const panes = { W1: makePane(EXITED_WITH_SESSION_ID), W2: makePane(EXITED_WITH_SESSION_ID) };
    const cmuxApi = {
      listAgentWorkspaceIds: async () => new Set(["W1", "W2"]),
      rpc: async (method) => (method === "system.top" ? makeTopData(workspaces) : {}),
      sendText: async (wsId, surfaceId, text) => panes[wsId].sendText(wsId, surfaceId, text),
      sendKey: async (wsId, surfaceId, key) => panes[wsId].sendKey(wsId, surfaceId, key),
      readScreenByWorkspace: async (wsRef) => panes[wsRef.replace("workspace:", "")].readScreenByWorkspace(),
      renameWorkspace: async () => {},
    };
    const refresher = new Refresher({
      cmuxApi,
      execFileFn: mockPs({ ttys001: "--dangerously-skip-permissions", ttys002: "" }),
      pollIntervalMs: 10,
      timeoutMs: 3000,
    });

    const result = await refresher.refreshAll({ dangerous: true });
    assert.equal(result.ok, true);
    assert.ok(result.results.every((r) => r.ok), `all refreshes should succeed, got: ${JSON.stringify(result.results)}`);

    const relaunchOf = (wsId) => panes[wsId].sentTexts.find((t) => t.startsWith("claude"));
    for (const wsId of ["W1", "W2"]) {
      const cmd = relaunchOf(wsId);
      assert.equal(
        (cmd.match(/--dangerously-skip-permissions/g) || []).length,
        1,
        `${wsId} should carry the flag exactly once, got: ${cmd}`,
      );
    }
  });
});
