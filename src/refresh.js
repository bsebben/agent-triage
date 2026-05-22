import * as cmux from "./cmux.js";

const SESSION_ID_PATTERN = /(?:Session ID|session_id|Resumable session):\s*([0-9a-f-]{36})/i;
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

  async #resolveSurface(workspaceId) {
    const terminals = await this.#cmux.listTerminals();
    const match = terminals.find((t) => t.workspaceId === workspaceId);
    return match?.paneRef || null;
  }

  async refreshSession(workspaceId) {
    const agentIds = await this.#cmux.listAgentWorkspaceIds();
    if (!agentIds.has(workspaceId)) {
      return { ok: false, error: "Not a Claude Code session" };
    }

    if (this.#inFlight.has(workspaceId)) {
      return { ok: false, error: "Already refreshing" };
    }

    const surfaceId = await this.#resolveSurface(workspaceId);
    if (!surfaceId) {
      return { ok: false, error: "Workspace not found" };
    }

    this.#inFlight.add(workspaceId);
    try {
      await this.#cmux.sendText(workspaceId, surfaceId, "/exit");
      await this.#cmux.sendKey(workspaceId, surfaceId, "Enter");

      const deadline = Date.now() + this.#timeoutMs;
      let sessionId = null;

      while (Date.now() < deadline) {
        await sleep(this.#pollIntervalMs);
        const screen = await this.#cmux.readScreen(surfaceId);
        if (!screen) continue;

        const match = screen.match(SESSION_ID_PATTERN);
        if (match) {
          sessionId = match[1];
          break;
        }
      }

      if (!sessionId) {
        return { ok: false, error: "Timeout waiting for session ID" };
      }

      await this.#cmux.sendText(workspaceId, surfaceId, `claude --resume ${sessionId}`);
      await this.#cmux.sendKey(workspaceId, surfaceId, "Enter");

      return { ok: true, sessionId };
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
const defaultRefresher = new Refresher();
export const refreshSession = (id) => defaultRefresher.refreshSession(id);
export const refreshAll = () => defaultRefresher.refreshAll();
