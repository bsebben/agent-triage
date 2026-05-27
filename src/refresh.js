import * as cmux from "./cmux.js";

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
        for (const pane of ws.panes || []) {
          for (const surface of pane.surfaces || []) {
            if (surface.type === "terminal") {
              surfaceRef = surface.ref;
              break;
            }
          }
          if (surfaceRef) break;
        }
        if (!surfaceRef) return null;
        return { surfaceRef, workspaceRef: ws.ref, title: ws.title || null };
      }
    }
    return null;
  }

  async #stopClaude(workspaceId, surfaceRef) {
    // Ctrl+C cancels any active generation
    await this.#cmux.sendKey(workspaceId, surfaceRef, "ctrl+c");
    await sleep(300);
    // Ctrl+D sends EOF, causing Claude Code to exit at the idle prompt
    await this.#cmux.sendKey(workspaceId, surfaceRef, "ctrl+d");
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
    const { surfaceRef, workspaceRef, title } = resolved;

    this.#inFlight.add(workspaceId);
    try {
      await this.#stopClaude(workspaceId, surfaceRef);

      let deadline = Date.now() + this.#timeoutMs;
      let sessionId = null;
      let exited = false;

      while (Date.now() < deadline) {
        await sleep(this.#pollIntervalMs);

        const screen = await this.#cmux.readScreenByWorkspace(workspaceRef);
        if (screen) {
          const match = screen.match(SESSION_ID_PATTERN);
          if (match) {
            sessionId = match[1];
            exited = true;
            break;
          }
        }

        // Fall back to tag-based detection: if the claude_code tag is gone,
        // Claude exited without printing a session ID (empty/new session).
        const ids = await this.#cmux.listAgentWorkspaceIds();
        if (!ids.has(workspaceId)) {
          exited = true;
          break;
        }
      }

      if (!exited) {
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
