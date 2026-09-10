// src/utils.js — Shared utilities
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
};

export function startPolling(name, pollFn, onUpdate, intervalMs) {
  // A single poll can outlast the interval (paged fetches with per-page retries), so guard
  // against overlap in `refresh` itself, not just the interval tick — `refresh` is also
  // returned as `tab.refresh` and invoked directly by the manual "/api/refresh/:name"
  // endpoint. Guarding only the tick would still let a manual refresh race a slow scheduled
  // poll (or two manual refreshes race each other), and whichever finishes last publishes
  // its snapshot over the other regardless of which is actually newer.
  let inFlight = false;
  const refresh = async () => {
    if (inFlight) {
      console.log(`[${name.toLowerCase()}] previous poll still running, skipping`);
      return;
    }
    inFlight = true;
    try { await pollFn(); onUpdate(); }
    finally { inFlight = false; }
  };
  const doPoll = async () => {
    try { await refresh(); }
    catch (err) { console.error(`[${name.toLowerCase()}] poll error: ${err.message.split("\n")[0]}`); }
  };
  doPoll();
  setInterval(doPoll, intervalMs);
  return refresh;
}

export function timeAgo(isoString) {
  const ms = Date.now() - new Date(isoString).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

export async function serveStatic(res, filePath) {
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "text/plain" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

export function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const CLAUDE_EXEC = /^(?:.*\/)?claude$/;
const DANGEROUS_FLAG = "--dangerously-skip-permissions";
const PERMISSION_MODE_VALUE = /^[A-Za-z]+$/;

/**
 * Launch flags that take their value as the next argv token. Their value has to
 * be skipped so it isn't mistaken for the first positional argument. A flag
 * missing from this list only ends the scan early, which loses a later flag
 * rather than inventing one — the safe direction.
 */
const VALUE_FLAGS = new Set([
  "--resume",
  "-r",
  "--model",
  "--settings",
  "--permission-mode",
  "--add-dir",
  "--agents",
  "--append-system-prompt",
  "--mcp-config",
  "--session-id",
  "--allowed-tools",
  "--disallowed-tools",
]);

/**
 * Index of the last token belonging to the flag value starting at `start`.
 *
 * Values are normally a single token, but Claude re-execs itself with
 * `--settings <json>` and that JSON carries string values (hook commands) with
 * spaces in them, so `ps` prints it as several tokens. A brace-delimited value
 * is followed until its braces balance; an unbalanced one falls back to a
 * single token so a malformed blob can't swallow the rest of the argv.
 */
function endOfValue(tokens, start) {
  if (!tokens[start]?.startsWith("{")) return start;
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    for (const ch of tokens[i]) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth <= 0) return i;
  }
  return start;
}

/**
 * The permission flags a Claude Code process was launched with, read from its
 * argv as printed by `ps -o args=`.
 *
 * Shared by the workspace card's bypass pill (`cmux.listBypassWorkspaceIds`)
 * and the refresh relaunch (`Refresher`) so the mode the UI reports and the
 * mode a refresh replays can never disagree.
 *
 * Only flag tokens count: the scan starts at the `claude` executable token and
 * stops at the first positional argument, because the session's prompt is part
 * of argv and may itself contain flag-looking text. Only launch-time flags are
 * visible here — a mode switched interactively (shift+tab) leaves no trace in
 * argv and cannot be recovered.
 *
 * @param {string} psOutput One or more lines of `ps -o args=` output.
 * @returns {string[]} Flags in command-line form, empty when none apply.
 */
export function permissionFlags(psOutput) {
  for (const line of (psOutput || "").split("\n")) {
    const tokens = line.trim().split(/\s+/);
    const start = tokens.findIndex((token) => CLAUDE_EXEC.test(token));
    if (start === -1) continue;

    let mode = null;
    for (let i = start + 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token.startsWith("-")) break;
      if (token === DANGEROUS_FLAG) return [DANGEROUS_FLAG];
      if (token === "--permission-mode") {
        mode = tokens[i + 1] || null;
        i += 1;
        continue;
      }
      const inlineMode = token.match(/^--permission-mode=(.*)$/);
      if (inlineMode) {
        mode = inlineMode[1];
        continue;
      }
      if (VALUE_FLAGS.has(token)) i = endOfValue(tokens, i + 1);
    }
    if (mode && PERMISSION_MODE_VALUE.test(mode)) return [`--permission-mode ${mode}`];
  }
  return [];
}
