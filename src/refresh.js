import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as cmux from "./cmux.js";

const execFileAsync = promisify(execFile);
const SESSION_ID_PATTERN = /claude --resume\s+([0-9a-f-]{36})/i;
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 30000;

export { SESSION_ID_PATTERN };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Refresher {
  #cmux;
  #execFileAsync;
  #inFlight = new Set();
  #pollIntervalMs;
  #timeoutMs;

  constructor({ cmuxApi = null, execFileFn = null, pollIntervalMs = POLL_INTERVAL_MS, timeoutMs = TIMEOUT_MS } = {}) {
    this.#cmux = cmuxApi || cmux;
    this.#execFileAsync = execFileFn ? promisify(execFileFn) : execFileAsync;
    this.#pollIntervalMs = pollIntervalMs;
    this.#timeoutMs = timeoutMs;
  }

  get refreshingIds() {
    return new Set(this.#inFlight);
  }

  async #resolveWorkspace(workspaceId) {
    const raw = await this.#cmux.rpc("system.top");
    for (const win of raw.windows || []) {
      for (const ws of win.workspaces || []) {
        if (ws.id !== workspaceId) continue;
        let surfaceRef = null;
        let tty = null;
        for (const pane of ws.panes || []) {
          for (const surface of pane.surfaces || []) {
            if (surface.type === "terminal") {
              surfaceRef = surface.ref;
              tty = surface.tty || null;
              break;
            }
          }
          if (surfaceRef) break;
        }
        if (!surfaceRef) return null;
        return { surfaceRef, workspaceRef: ws.ref, tty, title: ws.title || null };
      }
    }
    return null;
  }

  async #findClaudePid(tty) {
    try {
      const { stdout } = await this.#execFileAsync("ps", ["-t", tty, "-o", "pid,comm"]);
      for (const line of stdout.split("\n")) {
        if (line.includes("/claude") || line.match(/\bclaude\b/)) {
          const pid = parseInt(line.trim(), 10);
          if (pid > 0) return pid;
        }
      }
    } catch {}
    return null;
  }

  async #isClaudeRunning(tty) {
    return (await this.#findClaudePid(tty)) !== null;
  }

  async #waitForScreenStable(workspaceRef, { stableMs = 800, timeoutMs = 15000 } = {}) {
    const UNSET = Symbol();
    const deadline = Date.now() + timeoutMs;
    let prev = UNSET;
    let stableSince = null;
    while (Date.now() < deadline) {
      await sleep(this.#pollIntervalMs);
      const screen = await this.#cmux.readScreenByWorkspace(workspaceRef);
      if (screen === null) {
        // Treat an unreadable screen as still changing
        stableSince = null;
        prev = UNSET;
        continue;
      }
      if (prev !== UNSET && screen === prev) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= stableMs) return;
      } else {
        stableSince = null;
        prev = screen;
      }
    }
  }

  async refreshSession(workspaceId) {
    const agentIds = await this.#cmux.listAgentWorkspaceIds();
    if (!agentIds.has(workspaceId)) {
      return { ok: false, error: "Not a Claude Code session" };
    }

    if (this.#inFlight.has(workspaceId)) {
      return { ok: false, error: "Already refreshing" };
    }

    const resolved = await this.#resolveWorkspace(workspaceId);
    if (!resolved) {
      return { ok: false, error: "Workspace not found" };
    }
    const { surfaceRef, workspaceRef, tty, title } = resolved;

    if (!tty) {
      return { ok: false, error: "No tty found for workspace" };
    }

    this.#inFlight.add(workspaceId);
    try {
      // Kill the Claude Code process on this tty
      const pid = await this.#findClaudePid(tty);
      if (pid) {
        try { process.kill(pid, "SIGTERM"); } catch {}
      }

      // Wait for Claude Code to exit and print session ID
      let deadline = Date.now() + this.#timeoutMs;
      let sessionId = null;

      while (Date.now() < deadline) {
        await sleep(this.#pollIntervalMs);

        if (await this.#isClaudeRunning(tty)) continue;

        // Claude exited — read screen for session ID
        const screen = await this.#cmux.readScreenByWorkspace(workspaceRef);
        if (screen) {
          const match = screen.match(SESSION_ID_PATTERN);
          if (match) sessionId = match[1];
        }
        break;
      }

      if (await this.#isClaudeRunning(tty)) {
        return { ok: false, error: "Timeout waiting for Claude Code to exit" };
      }

      await sleep(500);

      // Relaunch Claude Code
      if (sessionId) {
        await this.#cmux.sendText(workspaceId, surfaceRef, `claude --resume ${sessionId}`);
      } else {
        await this.#cmux.sendText(workspaceId, surfaceRef, "claude --continue");
      }
      await this.#cmux.sendKey(workspaceId, surfaceRef, "Enter");

      // Wait for Claude Code to be fully running (claude_code tag appears)
      deadline = Date.now() + this.#timeoutMs;
      while (Date.now() < deadline) {
        await sleep(this.#pollIntervalMs);
        const ids = await this.#cmux.listAgentWorkspaceIds();
        if (ids.has(workspaceId)) break;
      }

      // Wait for the terminal screen to stabilize — the claude_code tag appears
      // when the process starts, but Claude isn't ready for slash commands until
      // the resume/initialization flow finishes and the input prompt is active.
      await this.#waitForScreenStable(workspaceRef, { timeoutMs: this.#timeoutMs });

      await this.#cmux.sendText(workspaceId, surfaceRef, "/reload-plugins");
      await this.#cmux.sendKey(workspaceId, surfaceRef, "Enter");

      // Restore the workspace title
      if (title) {
        try { await this.#cmux.renameWorkspace(workspaceId, title); } catch {}
      }

      return { ok: true, sessionId: sessionId || null };
    } finally {
      this.#inFlight.delete(workspaceId);
    }
  }

  async refreshAll() {
    const agentIds = await this.#cmux.listAgentWorkspaceIds();
    const workspaceIds = [...agentIds];

    const results = await Promise.allSettled(
      workspaceIds.map(async (id) => {
        const result = await this.refreshSession(id);
        return { workspaceId: id, ...result };
      }),
    );

    return {
      ok: true,
      results: results.map((r) =>
        r.status === "fulfilled"
          ? r.value
          : { workspaceId: null, ok: false, error: r.reason?.message || "Unknown error" },
      ),
    };
  }
}

// Default singleton for server use
export const defaultRefresher = new Refresher();
export const refreshSession = (id) => defaultRefresher.refreshSession(id);
export const refreshAll = () => defaultRefresher.refreshAll();
export const refreshingIds = () => defaultRefresher.refreshingIds;
