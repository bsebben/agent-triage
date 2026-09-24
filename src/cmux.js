import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import config from "./config.js";
import { permissionFlags } from "./utils.js";

const execFileAsync = promisify(execFile);
const CMUX = config.cmux.binary;
const SOCKET_PATH = config.cmux.socket;

// --- Persistent socket RPC ---

const RPC_TIMEOUT_MS = 10000;

let sock = null;
let buffer = "";
let currentRequest = null;
const requestQueue = [];
let connecting = null;

function resetSocket() {
  if (sock) {
    sock.removeAllListeners();
    sock.destroy();
  }
  sock = null;
  connecting = null;
  buffer = "";
}

function getSocket() {
  if (sock && !sock.destroyed) return Promise.resolve(sock);
  if (connecting) return connecting;

  connecting = new Promise((resolve, reject) => {
    buffer = "";
    const s = createConnection(SOCKET_PATH);
    s.setEncoding("utf8");

    s.on("connect", () => { sock = s; connecting = null; resolve(s); });
    s.on("error", (err) => {
      resetSocket();
      reject(err);
    });

    s.on("data", (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        try {
          const parsed = JSON.parse(line);
          if (currentRequest) {
            clearTimeout(currentRequest.timer);
            if (parsed.ok === false) {
              currentRequest.reject(new Error(parsed.error?.message || "RPC error"));
            } else {
              currentRequest.resolve(parsed.result || parsed);
            }
            currentRequest = null;
            drainQueue();
          }
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
      }
    });

    s.on("close", () => {
      resetSocket();
      if (currentRequest) {
        clearTimeout(currentRequest.timer);
        currentRequest.reject(new Error("cmux socket closed"));
        currentRequest = null;
      }
      while (requestQueue.length > 0) {
        requestQueue.shift().reject(new Error("cmux socket closed"));
      }
    });
  });

  return connecting;
}

// Requests are serialized on currentRequest and replies carry no id to match
// against, so a reply that never arrives — or one that arrives unparseable and
// leaves the buffer wedged — pins currentRequest forever. Every later call then
// waits behind it indefinitely, including the workspace.select behind a card
// click, and because nothing rejects there is no error to log.
function onRequestTimeout(req) {
  if (currentRequest !== req) return;
  currentRequest = null;
  req.reject(new Error(`cmux ${req.method} timed out after ${RPC_TIMEOUT_MS}ms`));
  // Drop the connection instead of reading on: a late reply would be handed to
  // whichever request ran next, answering it with another call's data.
  resetSocket();
  while (requestQueue.length > 0) {
    requestQueue.shift().reject(new Error("cmux socket reset after timeout"));
  }
}

function drainQueue() {
  if (currentRequest || requestQueue.length === 0) return;
  if (!sock || sock.destroyed) return;
  const next = requestQueue.shift();
  currentRequest = next;
  next.timer = setTimeout(() => onRequestTimeout(next), RPC_TIMEOUT_MS);
  sock.write(JSON.stringify({ method: next.method, params: next.params }) + "\n");
}

async function socketRpc(method, params = {}) {
  await getSocket();
  return new Promise((resolve, reject) => {
    requestQueue.push({ method, params, resolve, reject });
    drainQueue();
  });
}

// --- Event stream (separate connection: events.stream takes over whatever
// socket it's sent on, so it can't share the RPC connection above) ---

const EVENTS_RECONNECT_DELAY_MS = 3000;

/**
 * Subscribes to cmux's live event stream, filtered to the "workspace"
 * category (created/selected/closed/renamed/moved/reordered — covers
 * workspace switches from shortcuts, sidebar clicks, and CLI/socket
 * commands alike). Reconnects on error/close so a cmux restart doesn't
 * kill the subscription. Returns an unsubscribe function.
 *
 * @param {(event: object) => void} onEvent
 * @returns {() => void} unsubscribe
 */
export function subscribeWorkspaceEvents(onEvent) {
  let closed = false;
  let socket = null;
  let reconnectTimer = null;
  let eventBuffer = "";

  function connect() {
    if (closed) return;
    eventBuffer = "";
    const s = createConnection(SOCKET_PATH);
    socket = s;
    s.setEncoding("utf8");

    s.on("connect", () => {
      s.write(JSON.stringify({ method: "events.stream", params: { categories: ["workspace"] } }) + "\n");
    });

    s.on("data", (chunk) => {
      eventBuffer += chunk;
      let idx;
      while ((idx = eventBuffer.indexOf("\n")) !== -1) {
        const line = eventBuffer.slice(0, idx);
        eventBuffer = eventBuffer.slice(idx + 1);
        try {
          const frame = JSON.parse(line);
          if (frame.type === "event") onEvent(frame);
        } catch {
          eventBuffer = line + "\n" + eventBuffer;
          break;
        }
      }
    });

    s.on("error", (err) => {
      console.error("Workspace event stream error:", err.message);
      scheduleReconnect();
    });
    s.on("close", scheduleReconnect);
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return;
    console.error(`Workspace event stream disconnected — reconnecting in ${EVENTS_RECONNECT_DELAY_MS}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, EVENTS_RECONNECT_DELAY_MS);
  }

  connect();

  return function unsubscribe() {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.destroy();
  };
}

// --- CLI fallback for commands not available via RPC ---

// SIGTERM mid-write crashes cmux's helper (unhandled NSFileHandleOperationException),
// taking down every workspace's socket. Reject on a JS timer without killing the child.
async function runCli(args, timeoutMs = 10000) {
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`cmux ${args[0]} timed out`)), timeoutMs);
      execFileAsync(CMUX, args).then(
        (r) => resolve({ stdout: r.stdout }),
        reject,
      );
    });
  } finally {
    clearTimeout(timer);
  }
}

// --- Public API ---

export async function rpc(method, params) {
  return socketRpc(method, params);
}

export async function listNotifications() {
  const raw = await rpc("notification.list");
  return parseNotifications(raw);
}

export function parseNotifications(raw) {
  return (raw.notifications || []).map((n) => ({
    id: n.id,
    workspaceId: n.workspace_id,
    surfaceId: n.surface_id,
    isRead: n.is_read,
    title: n.title,
    subtitle: n.subtitle,
    body: n.body,
    category: categorizeNotification(n),
  }));
}

export function categorizeNotification(n) {
  if (n.subtitle === "Permission") return "permission";
  if (n.subtitle?.startsWith("Completed")) return "completion";
  if (n.subtitle === "Waiting") return "waiting";

  const body = (n.body || "").toLowerCase();
  if (body.includes("permission") || body.includes("approval")) return "permission";
  if (body.includes("waiting for your input")) return "waiting";
  if (body.includes("completed") || body.includes("finished")) return "completion";

  return "unknown";
}

export const AGENT_TITLE_PREFIX = /^[✳⠂⠐]/;

/**
 * Number of open cmux windows. Purely informational (see Monitor#windowCount
 * / the multi-window indicator) — `listWorkspaces` below pins itself to our
 * own window explicitly, so this count no longer needs to gate any behavior.
 */
export async function getWindowCount() {
  try {
    // Like workspace.list, system.top without all_windows scopes to
    // whichever window is currently *selected* app-wide, not every open
    // window — silently undercounting to 1 otherwise.
    const raw = await rpc("system.top", { all_windows: true });
    return (raw.windows || []).length;
  } catch {
    return 1;
  }
}

let ownWindowIdPromise = null;

/**
 * Resolves the cmux window this process's own host workspace lives in.
 *
 * `workspace.list`/`system.top` without an explicit `window_id` don't scope
 * to "the caller's window" — they scope to whichever window cmux currently
 * has *selected*, app-wide. Opening or focusing a second window flips that
 * target out from under us mid-poll, so the dashboard briefly renders the
 * other window's workspaces as its own. cmux sets `CMUX_WORKSPACE_ID` on any
 * process it launches (this dashboard must run inside a cmux-hosted
 * terminal), which stays pinned to our own workspace regardless of focus —
 * cross-reference it against `system.top` once to find our window's real id.
 *
 * Returns null (and callers fall back to the old ambient-scoped behavior) if
 * we're not running inside cmux or the lookup fails.
 */
export function findWindowIdForWorkspace(raw, workspaceId) {
  for (const win of raw.windows || []) {
    if ((win.workspaces || []).some((ws) => ws.id === workspaceId)) {
      return win.id;
    }
  }
  return null;
}

async function resolveOwnWindowId() {
  const ownWorkspaceId = process.env.CMUX_WORKSPACE_ID;
  if (!ownWorkspaceId) return null;

  try {
    // all_windows: true — without it system.top only returns the
    // currently-*selected* window, which may not be our own, so we'd never
    // find our workspace in it.
    const raw = await rpc("system.top", { all_windows: true });
    return findWindowIdForWorkspace(raw, ownWorkspaceId);
  } catch {}
  return null;
}

function getOwnWindowId() {
  if (!ownWindowIdPromise) ownWindowIdPromise = resolveOwnWindowId();
  return ownWindowIdPromise;
}

// Scopes system.top to just our own window when it's resolvable, so agent/
// bypass tags from other cmux windows can't leak into our own workspace
// roster. Falls back to every window (the old behavior) when we can't
// resolve our own — e.g. running outside cmux entirely.
async function systemTopScopedToOwnWindow() {
  const ownWindowId = await getOwnWindowId();
  return rpc("system.top", ownWindowId ? { window_id: ownWindowId } : { all_windows: true });
}

export async function listAgentWorkspaceIds() {
  try {
    const raw = await systemTopScopedToOwnWindow();
    const ids = new Set();
    for (const win of raw.windows || []) {
      for (const ws of win.workspaces || []) {
        for (const tag of ws.tags || []) {
          if (tag.key === "claude_code") ids.add(ws.id);
        }
        if (!ids.has(ws.id) && AGENT_TITLE_PREFIX.test(ws.title || "")) {
          ids.add(ws.id);
        }
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

/**
 * Maps workspace ID to the ttys of its terminal surfaces, from a system.top
 * response.
 *
 * Every terminal tty in the workspace, not just one: a workspace routinely has
 * several terminal panes (this repo's own convention is to run dev servers in
 * their own pane), and which of them holds the Claude Code session isn't
 * knowable from system.top alone.
 *
 * @param {object} raw system.top response.
 * @param {{agentsOnly?: boolean}} options `agentsOnly` limits the result to
 *   workspaces cmux tags as running Claude Code.
 * @returns {Map<string, string[]>} Workspace ID to ttys (e.g. ["ttys012"]).
 */
export function collectWorkspaceTtys(raw, { agentsOnly = false } = {}) {
  const ttysByWsId = new Map();
  for (const win of raw.windows || []) {
    for (const ws of win.workspaces || []) {
      if (agentsOnly) {
        let isAgent = false;
        for (const tag of ws.tags || []) {
          if (tag.key === "claude_code") isAgent = true;
        }
        if (!isAgent && AGENT_TITLE_PREFIX.test(ws.title || "")) isAgent = true;
        if (!isAgent) continue;
      }

      for (const pane of ws.panes || []) {
        for (const surface of pane.surfaces || []) {
          if (surface.type === "terminal" && surface.tty) {
            const ttys = ttysByWsId.get(ws.id);
            if (ttys) {
              if (!ttys.includes(surface.tty)) ttys.push(surface.tty);
            } else {
              ttysByWsId.set(ws.id, [surface.tty]);
            }
          }
        }
      }
    }
  }
  return ttysByWsId;
}

/** Every terminal tty in a system.top response, regardless of window. */
function collectAllTtys(raw) {
  const ttys = new Set();
  for (const win of raw.windows || []) {
    for (const ws of win.workspaces || []) {
      for (const pane of ws.panes || []) {
        for (const surface of pane.surfaces || []) {
          if (surface.type === "terminal" && surface.tty) ttys.add(surface.tty);
        }
      }
    }
  }
  return ttys;
}

/**
 * Reads the terminal ttys cmux currently reports, in two slices.
 *
 * tty is how a Claude Code session's self-reported cross-session address gets
 * correlated back to the card it belongs to (see src/session-addresses.js), and
 * how a registration for a pane that no longer exists gets pruned. Those two
 * jobs want different scopes, hence both:
 *
 * - `byWorkspace` is our own window only, matching the workspace roster the
 *   dashboard renders. Not limited to agent workspaces: a session whose
 *   claude_code tag blinks out for a poll shouldn't lose its address.
 * - `liveTtys` spans every open cmux window, because the hooks are installed
 *   machine-globally. A session in another window has no card here, but its
 *   registration must not be pruned as dead — that would put it in a loop of
 *   re-announcing on every prompt.
 *
 * Returns null when cmux couldn't be read at all, which callers must
 * distinguish from an empty result: pruning against "cmux didn't answer" would
 * wipe every registration on a single socket blip.
 *
 * @returns {Promise<{byWorkspace: Map<string, string[]>, liveTtys: Set<string>}|null>}
 */
export async function listWorkspaceTtys() {
  try {
    // One all_windows read serves both scopes — our own window is a filter on
    // it, so this costs no extra RPC over the own-window-only version.
    const [ownWindowId, raw] = await Promise.all([getOwnWindowId(), rpc("system.top", { all_windows: true })]);
    const ownWindow = ownWindowId ? { windows: (raw.windows || []).filter((win) => win.id === ownWindowId) } : raw;
    return { byWorkspace: collectWorkspaceTtys(ownWindow), liveTtys: collectAllTtys(raw) };
  } catch {
    return null;
  }
}

/**
 * Returns the set of workspace IDs whose Claude Code process was launched
 * with --dangerously-skip-permissions.
 *
 * Calls system.top to resolve each agent workspace's TTY, then inspects the
 * process args via `ps -ww`. The -ww flag is required because Claude's
 * --settings JSON is very long and macOS ps truncates without it. Parsing goes
 * through the shared permissionFlags so this pill and the flags a refresh
 * replays are decided by the same rules.
 *
 * @returns {Promise<Set<string>>} Workspace IDs running in bypass mode.
 */
export async function listBypassWorkspaceIds() {
  try {
    const raw = await systemTopScopedToOwnWindow();
    const ttysByWsId = collectWorkspaceTtys(raw, { agentsOnly: true });

    const bypassIds = new Set();
    const checks = [...ttysByWsId.entries()].map(async ([wsId, ttys]) => {
      // Any terminal pane in the workspace may be the one running Claude, so
      // check them all rather than betting on one.
      for (const tty of ttys) {
        try {
          const { stdout } = await execFileAsync("ps", ["-ww", "-t", tty, "-o", "args="]);
          if (permissionFlags(stdout).includes("--dangerously-skip-permissions")) {
            bypassIds.add(wsId);
            return;
          }
        } catch {}
      }
    });
    await Promise.all(checks);
    return bypassIds;
  } catch {
    return new Set();
  }
}

export async function listWorkspaces() {
  const ownWindowId = await getOwnWindowId();
  // Pin explicitly to our own window (see resolveOwnWindowId) rather than
  // trusting workspace.list's default scoping, which follows cmux's
  // currently-*selected* window app-wide, not the caller's own window.
  const raw = await rpc("workspace.list", ownWindowId ? { window_id: ownWindowId } : undefined);
  // window_id is a top-level field of the response, not per-workspace, so
  // every entry it returns belongs to that same window.
  const windowId = raw.window_id || null;
  return (raw.workspaces || []).map((w) => ({
    id: w.id,
    title: w.title,
    directory: w.current_directory || null,
    ref: w.ref,
    windowId,
    selected: w.selected || false,
    pinned: w.pinned || false,
  }));
}

export async function listTerminals() {
  const raw = await rpc("debug.terminals");
  return (raw.terminals || []).map((t) => ({
    workspaceId: t.workspace_id,
    paneId: t.pane_id,
    paneRef: t.pane_ref,
    directory: t.current_directory || null,
    gitBranch: t.git_branch || null,
  }));
}

export async function selectWorkspace(workspaceId) {
  const result = await socketRpc("workspace.select", { workspace_id: workspaceId });
  if (result?.window_id) {
    await socketRpc("window.focus", { window_id: result.window_id });
  }
}

/**
 * Reorders workspaces within one window to match `orderedWorkspaceIds`.
 * `reorder-workspaces` is CLI-only (not in the RPC method list). Per its own
 * docs the ordering is **group-scoped**: "the comma-separated order is the
 * final leading order inside the pinned and unpinned groups; unmentioned
 * workspaces keep their relative order after listed peers in the same group."
 *
 * So a flat list can only ever order workspaces *within* their own pin group —
 * the pinned group always precedes the unpinned one, and no `--order` can move
 * a pinned workspace behind an unpinned one. Callers comparing a desired order
 * against cmux's reported order must therefore compare per pin group, or the
 * check will never converge (see monitor.js#syncTabOrder).
 */
export async function reorderWorkspaces(windowId, orderedWorkspaceIds) {
  if (orderedWorkspaceIds.length < 2) return;
  await runCli(["reorder-workspaces", "--window", windowId, "--order", orderedWorkspaceIds.join(",")]);
}

export async function closeWorkspace(workspaceId) {
  await socketRpc("workspace.close", { workspace_id: workspaceId });
}

export async function renameWorkspace(workspaceId, title) {
  await socketRpc("workspace.rename", { workspace_id: workspaceId, title });
}

export async function readScreenByWorkspace(workspaceRef, lines = 30) {
  try {
    const { stdout } = await runCli([
      "read-screen",
      "--workspace",
      workspaceRef,
      "--lines",
      String(lines),
    ]);
    return stripAnsi(stdout);
  } catch {
    return null;
  }
}

export async function sendText(workspaceId, surfaceId, text) {
  await socketRpc("surface.send_text", { surface_id: surfaceId, text });
}

export async function sendKey(workspaceId, surfaceId, key) {
  await socketRpc("surface.send_key", { surface_id: surfaceId, key });
}

export async function createWorkspace({ cwd, command } = {}) {
  let workspaceId;
  if (cwd || command) {
    const args = ["new-workspace", "--focus", "true"];
    if (cwd) args.push("--cwd", cwd);
    if (command) args.push("--command", command);
    const { stdout } = await runCli(args);
    workspaceId = stdout.match(/workspace:\d+/)?.[0];
    if (!workspaceId) return null;
  } else {
    const result = await socketRpc("workspace.create", {});
    workspaceId = result?.workspace_id;
    if (!workspaceId) return result;
    await selectWorkspace(workspaceId);
  }
  activateCmux();
  return { workspace_id: workspaceId };
}

export function activateCmux() {
  execFile("osascript", ["-e", 'tell application "cmux" to activate'], () => {});
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}
