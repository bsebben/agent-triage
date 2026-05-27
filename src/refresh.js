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
  #inFlight = new Set();
  #pollIntervalMs;
  #timeoutMs;

  constructor({ cmuxApi = null, pollIntervalMs = POLL_INTERVAL_MS, timeoutMs = TIMEOUT_MS } = {}) {
    this.#cmux = cmuxApi || cmux;
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

  async #getWorkspaceCwd(workspaceId) {
    const workspaces = await this.#cmux.listWorkspaces();
    const ws = workspaces.find((w) => w.id === workspaceId);
    return ws?.directory || null;
  }

  async #findClaudePidByTty(tty) {
    try {
      const { stdout } = await execFileAsync("ps", ["-t", tty, "-o", "pid,comm"]);
      for (const line of stdout.split("\n")) {
        if (line.includes("/claude") || line.match(/\bclaude\b/)) {
          const pid = parseInt(line.trim(), 10);
          if (pid > 0) return pid;
        }
      }
    } catch {}
    return null;
  }

  async #findClaudePidByCwd(cwd) {
    if (!cwd) return null;
    try {
      const { stdout: pids } = await execFileAsync("pgrep", ["-x", "claude"]);
      for (const pidStr of pids.trim().split("\n")) {
        const pid = parseInt(pidStr, 10);
        if (!(pid > 0)) continue;
        try {
          const { stdout: envLine } = await execFileAsync("ps", ["eww", "-p", String(pid), "-o", "command="]);
          const match = envLine.match(/PWD=([^\s]+)/);
          if (match && match[1] === cwd) return pid;
        } catch {}
      }
    } catch {}
    return null;
  }

  async #findClaudePid(tty, cwd) {
    if (tty) {
      const pid = await this.#findClaudePidByTty(tty);
      if (pid) return pid;
    }
    return this.#findClaudePidByCwd(cwd);
  }

  async #isProcessRunning(pid) {
    try { process.kill(pid, 0); return true; } catch { return false; }
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

    this.#inFlight.add(workspaceId);
    try {
      const cwd = await this.#getWorkspaceCwd(workspaceId);
      const pid = await this.#findClaudePid(tty, cwd);

      if (!pid) {
        return { ok: false, error: "Could not find Claude Code process" };
      }

      try { process.kill(pid, "SIGTERM"); } catch {}

      let deadline = Date.now() + this.#timeoutMs;
      let sessionId = null;

      while (Date.now() < deadline) {
        await sleep(this.#pollIntervalMs);

        if (await this.#isProcessRunning(pid)) continue;

        const screen = await this.#cmux.readScreenByWorkspace(workspaceRef);
        if (screen) {
          const match = screen.match(SESSION_ID_PATTERN);
          if (match) sessionId = match[1];
        }
        break;
      }

      if (await this.#isProcessRunning(pid)) {
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

      // Wait for Claude Code to be fully running (title prefix appears)
      deadline = Date.now() + this.#timeoutMs;
      while (Date.now() < deadline) {
        await sleep(this.#pollIntervalMs);
        const ids = await this.#cmux.listAgentWorkspaceIds();
        if (ids.has(workspaceId)) break;
      }

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
