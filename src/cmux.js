import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import config from "./config.js";

const execFileAsync = promisify(execFile);
const CMUX = config.cmux.binary;
const SOCKET_PATH = config.cmux.socket;

// --- Persistent socket RPC ---

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

function drainQueue() {
  if (currentRequest || requestQueue.length === 0) return;
  if (!sock || sock.destroyed) return;
  const next = requestQueue.shift();
  currentRequest = next;
  sock.write(JSON.stringify({ method: next.method, params: next.params }) + "\n");
}

async function socketRpc(method, params = {}) {
  await getSocket();
  return new Promise((resolve, reject) => {
    requestQueue.push({ method, params, resolve, reject });
    drainQueue();
  });
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

export async function rpc(method) {
  return socketRpc(method);
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
  return "unknown";
}

export async function listWorkspaces() {
  const raw = await rpc("workspace.list");
  return (raw.workspaces || []).map((w) => ({
    id: w.id,
    title: w.title,
    directory: w.current_directory || null,
    ref: w.ref,
    windowId: w.window_id || null,
    selected: w.selected || false,
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

export async function closeWorkspace(workspaceId) {
  await socketRpc("workspace.close", { workspace_id: workspaceId });
}

export async function renameWorkspace(workspaceId, title) {
  await socketRpc("workspace.rename", { workspace_id: workspaceId, title });
}

export async function readScreen(surfaceId, lines = 30) {
  try {
    const { stdout } = await runCli([
      "read-screen",
      "--surface",
      surfaceId,
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
  if (cwd || command) {
    const args = ["new-workspace"];
    if (cwd) args.push("--cwd", cwd);
    if (command) args.push("--command", command);
    const { stdout } = await runCli(args);
    const id = stdout.match(/workspace:(\d+)/)?.[1];
    if (id) {
      const result = await socketRpc("workspace.select", { workspace_id: id });
      if (result?.window_id) {
        await socketRpc("window.focus", { window_id: result.window_id });
      }
    }
    return id ? { workspace_id: id } : null;
  }
  const result = await socketRpc("workspace.create", {});
  if (result?.workspace_id) {
    await socketRpc("workspace.select", { workspace_id: result.workspace_id });
    if (result.window_id) {
      await socketRpc("window.focus", { window_id: result.window_id });
    }
  }
  return result;
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}
