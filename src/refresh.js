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

const PROMPT_LINE = /^\s*[>❯➜](\s|$)/;

/**
 * The text currently in Claude Code's input box, `""` when the box is empty, or
 * `null` when the screen holds no prompt line at all.
 *
 * Claude Code draws the input box as a bare prompt line (`❯ /reload-plugins`)
 * between two horizontal rules — there are no vertical borders to key off, and
 * transcript echoes of earlier submissions use the same shape. So the live input
 * box is identified by position: it is the bottom-most prompt line on the screen.
 * Autocomplete suggestion rows are indented and carry no prompt glyph, so they
 * never match.
 */
export function inputBoxText(screen) {
  if (!screen) return null;
  const lines = screen.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (PROMPT_LINE.test(lines[i])) return lines[i].replace(/^\s*[>❯➜]/, "").trim();
  }
  return null;
}

/** True when `text` is still sitting unsubmitted in Claude Code's input box. */
export function isPendingInput(screen, text) {
  return inputBoxText(screen) === text;
}

function describeBox(value) {
  if (value === null) return "no prompt";
  if (value === "") return "an empty prompt";
  return JSON.stringify(value);
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

  /** Polls until the input box holds exactly `text`. */
  async #waitForInputBox(workspaceRef, text, { polls = 20 } = {}) {
    let seen = null;
    for (let i = 0; i < polls; i++) {
      const screen = await this.#cmux.readScreenByWorkspace(workspaceRef);
      seen = inputBoxText(screen);
      if (seen === text) return { ok: true, seen };
      await sleep(this.#pollIntervalMs);
    }
    return { ok: false, seen };
  }

  /**
   * Classifies the input box after an Enter: submitted (prompt cleared), still
   * pending (`text` unchanged), or holding something else entirely.
   */
  async #readSubmitOutcome(workspaceRef, text, { polls = 6 } = {}) {
    let current = null;
    for (let i = 0; i < polls; i++) {
      await sleep(this.#pollIntervalMs);
      const screen = await this.#cmux.readScreenByWorkspace(workspaceRef);
      current = inputBoxText(screen);
      if (current === null) continue;
      // An empty prompt is positive evidence: the text we confirmed was in the
      // box before Enter has left it, so Claude Code accepted the line.
      if (current === "") return { submitted: true, current };
      if (current !== text) return { submitted: false, current };
    }
    return { submitted: false, current };
  }

  /**
   * Types a slash command and submits it, tolerating Claude Code's autocomplete.
   *
   * Enter that arrives while the slash-command dropdown is open gets consumed by
   * the dropdown (it accepts the highlighted suggestion) instead of submitting the
   * line, leaving the command typed but never run. Waiting for the screen to settle
   * does not help — a screen with the dropdown open is stable. So each step is
   * verified against the input box instead: confirm the command landed in the box,
   * then send Enter and re-send it as long as the box still holds the command.
   *
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async #submitCommand(workspaceId, surfaceRef, workspaceRef, text, { attempts = 3 } = {}) {
    await this.#cmux.sendText(workspaceId, surfaceRef, text);

    const landed = await this.#waitForInputBox(workspaceRef, text);
    if (!landed.ok) {
      return { ok: false, error: `${text} never reached the input box (found ${describeBox(landed.seen)})` };
    }

    for (let attempt = 0; attempt < attempts; attempt++) {
      await this.#cmux.sendKey(workspaceId, surfaceRef, "Enter");
      const outcome = await this.#readSubmitOutcome(workspaceRef, text);
      if (outcome.submitted) return { ok: true };
      if (outcome.current === null) {
        // No prompt line was visible for the whole read window — Claude Code is
        // likely mid-render (e.g. still processing the command we just sent), not
        // necessarily still holding it. We can't tell submitted from swallowed here,
        // and sending another blind Enter risks a spurious keystroke landing once
        // rendering catches up, so stop instead of retrying.
        return { ok: false, error: `${text} submission could not be confirmed (no prompt visible after Enter)` };
      }
      if (outcome.current !== text) {
        return { ok: false, error: `${text} was replaced in the input box by ${describeBox(outcome.current)}` };
      }
      // Still holding the command: the dropdown swallowed that Enter. It closes on
      // accepting the suggestion, so the next Enter reaches the input line.
    }
    return { ok: false, error: `${text} is still sitting in the input box after ${attempts} attempts` };
  }

  async refreshSession(workspaceId, { dangerous = false } = {}) {
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
      const dangerousSuffix = dangerous ? " --dangerously-skip-permissions" : "";
      if (sessionId) {
        await this.#cmux.sendText(workspaceId, surfaceRef, `claude --resume ${sessionId}${dangerousSuffix}`);
      } else {
        await this.#cmux.sendText(workspaceId, surfaceRef, `claude${dangerousSuffix}`);
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

      const submitted = await this.#submitCommand(workspaceId, surfaceRef, workspaceRef, "/reload-plugins");

      // Restore the workspace title
      if (title) {
        try { await this.#cmux.renameWorkspace(workspaceId, title); } catch {}
      }

      if (!submitted.ok) {
        return { ok: false, sessionId: sessionId || null, error: `Claude Code restarted, but ${submitted.error}` };
      }

      return { ok: true, sessionId: sessionId || null };
    } finally {
      this.#inFlight.delete(workspaceId);
    }
  }

  async refreshAll({ dangerous = false } = {}) {
    const agentIds = await this.#cmux.listAgentWorkspaceIds();
    const workspaceIds = [...agentIds];

    const results = await Promise.allSettled(
      workspaceIds.map(async (id) => {
        const result = await this.refreshSession(id, { dangerous });
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
export const refreshSession = (id, opts) => defaultRefresher.refreshSession(id, opts);
export const refreshAll = (opts) => defaultRefresher.refreshAll(opts);
export const refreshingIds = () => defaultRefresher.refreshingIds;
