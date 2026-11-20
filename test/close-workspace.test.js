import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { workspaceCloseParams, isRunningProcessRefusal } from "../src/cmux.js";

describe("workspaceCloseParams", () => {
  it("sends only the workspace id for a plain close", () => {
    assert.deepEqual(workspaceCloseParams("W1"), { workspace_id: "W1" });
    assert.deepEqual(workspaceCloseParams("W1", false), { workspace_id: "W1" });
  });

  it("adds force only when asked for", () => {
    assert.deepEqual(workspaceCloseParams("W1", true), { workspace_id: "W1", force: true });
  });
});

describe("isRunningProcessRefusal", () => {
  it("recognizes cmux's refusal to close a workspace with a running process", () => {
    assert.equal(isRunningProcessRefusal(new Error("Workspace has a running process; retry with --force")), true);
    assert.equal(isRunningProcessRefusal(new Error("One or more workspaces have a running process; retry with force=true")), true);
  });

  it("does not match unrelated errors", () => {
    assert.equal(isRunningProcessRefusal(new Error("Workspace ref not found: workspace:9")), false);
    assert.equal(isRunningProcessRefusal(new Error("socket closed")), false);
  });

  it("tolerates a missing error or message", () => {
    assert.equal(isRunningProcessRefusal(undefined), false);
    assert.equal(isRunningProcessRefusal({}), false);
  });
});

// Values built inside the sandbox carry that realm's Object prototype, which deepEqual rejects.
const plain = (value) => JSON.parse(JSON.stringify(value));

// tab-workspaces.js is a plain browser script, so it is evaluated in a sandbox with the globals
// it expects, to exercise the code the browser actually loads.
function loadClient({ responses, confirmAnswer = true }) {
  const calls = { posts: [], confirms: [], toasts: [], renders: 0 };
  const queue = [...responses];
  const sandbox = {
    apiPost: async (endpoint, body) => {
      calls.posts.push({ endpoint, body });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    confirm: (message) => {
      calls.confirms.push(message);
      return confirmAnswer;
    },
    showToast: (message) => calls.toasts.push(message),
    recentCloses: new Map(),
    applyCloses: () => {},
    render: () => {
      calls.renders += 1;
    },
  };
  createContext(sandbox);
  runInContext(readFileSync(new URL("../public/tab-workspaces.js", import.meta.url), "utf-8"), sandbox);
  return { sandbox, calls };
}

describe("closeWorkspace (client)", () => {
  it("hides the card after a plain close succeeds", async () => {
    const { sandbox, calls } = loadClient({ responses: [{ ok: true }] });
    await sandbox.closeWorkspace("W1");
    assert.deepEqual(plain(calls.posts), [{ endpoint: "close", body: { workspaceId: "W1" } }]);
    assert.equal(sandbox.recentCloses.has("W1"), true);
    assert.equal(calls.renders, 1);
    assert.equal(calls.confirms.length, 0);
  });

  it("asks before forcing a close that cmux refused, then retries with force", async () => {
    const { sandbox, calls } = loadClient({
      responses: [{ error: "Workspace has a running process; retry with --force", code: "running_process" }, { ok: true }],
    });
    await sandbox.closeWorkspace("W1");
    assert.equal(calls.confirms.length, 1);
    assert.deepEqual(plain(calls.posts.map((p) => p.body)), [{ workspaceId: "W1" }, { workspaceId: "W1", force: true }]);
    assert.equal(sandbox.recentCloses.has("W1"), true);
  });

  it("leaves the card alone when the confirmation is declined", async () => {
    const { sandbox, calls } = loadClient({
      responses: [{ error: "Workspace has a running process; retry with --force", code: "running_process" }],
      confirmAnswer: false,
    });
    await sandbox.closeWorkspace("W1");
    assert.equal(calls.posts.length, 1);
    assert.equal(sandbox.recentCloses.has("W1"), false);
    assert.equal(calls.renders, 0);
    assert.equal(calls.toasts.length, 0);
  });

  it("does not hide the card and shows the error when the close fails for another reason", async () => {
    const { sandbox, calls } = loadClient({ responses: [{ error: "Workspace ref not found" }] });
    await sandbox.closeWorkspace("W1");
    assert.equal(sandbox.recentCloses.has("W1"), false);
    assert.equal(calls.renders, 0);
    assert.equal(calls.toasts.length, 1);
    assert.match(calls.toasts[0], /Workspace ref not found/);
  });

  it("does not hide the card when a forced close still fails", async () => {
    const { sandbox, calls } = loadClient({
      responses: [{ error: "running process", code: "running_process" }, { error: "still failed" }],
    });
    await sandbox.closeWorkspace("W1");
    assert.equal(sandbox.recentCloses.has("W1"), false);
    assert.match(calls.toasts[0], /still failed/);
  });

  it("shows a toast when the dashboard server can't be reached", async () => {
    const { sandbox, calls } = loadClient({ responses: [new Error("network down")] });
    await sandbox.closeWorkspace("W1");
    assert.equal(sandbox.recentCloses.has("W1"), false);
    assert.equal(calls.toasts.length, 1);
  });
});
