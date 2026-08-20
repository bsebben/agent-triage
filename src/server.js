import { createServer } from "node:http";
import { readFileSync, existsSync, utimesSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Queue } from "./queue.js";
import { DirectoryHistory, listDirectories, resolveDirectory } from "./directory-history.js";
import { Monitor } from "./monitor.js";
import * as cmux from "./cmux.js";
import { execFile } from "node:child_process";
import { readBody, serveStatic, jsonResponse } from "./utils.js";
import { initLogs, getLines } from "./logs.js";
import config, { HOME, validateConfig, mergeConfigForSave, loadRawConfig, writeConfigFile, migratedRaw, migrationNotice } from "./config.js";
import { buildConfigSchema } from "./config-schema.js";
import { UpdateChecker } from "./update-checker.js";
import { detectCmuxVersion } from "./cmux-version.js";
import * as plugins from "./plugins.js";
import { INTEGRATIONS, status as integrationStatus, enable as enableIntegration, disable as disableIntegration, isDecided as integrationIsDecided, dismiss as dismissIntegration } from "./integrations.js";
import { refreshSession, refreshAll, refreshingIds } from "./refresh.js";
import loops from "./tabs/loops.js";
import pulls from "./tabs/pulls.js";
import tickets from "./tabs/tickets.js";
import tasks, { store as taskStore, save as saveTasks } from "./tabs/tasks.js";

const configSchema = buildConfigSchema();

const configWarnings = [
  ...(migrationNotice ? [migrationNotice] : []),
  ...validateConfig(migratedRaw, configSchema),
];
for (const warning of configWarnings) {
  console.warn(`Config warning [${warning.key}]: ${warning.message}`);
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const TABS_DIR = join(__dirname, "tabs");
const DATA_DIR = join(__dirname, "..", "data");
const TASKS_DATA_PATH = join(DATA_DIR, "tasks.json");
const DIRECTORY_HISTORY_PATH = join(DATA_DIR, "ticket-directory-history.json");
const PORT = process.env.PORT || config.port;

// --- Tab registry ---
// Each tab module exports: { status, data, init(onUpdate) }
// Modules manage their own polling. To add a new tab: create a module, import it, add it here.

const tabs = { loops, pulls, tickets, tasks };

// --- Logs ---

function sendToAll(payload) {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

// --- Queue + WebSocket ---

const queue = new Queue();
await queue.load(join(DATA_DIR, "queue.json"));

const directoryHistory = new DirectoryHistory();
await directoryHistory.load(DIRECTORY_HISTORY_PATH);

function broadcast() {
  const payload = JSON.stringify({ type: "update", data: getFullData() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
  queue.save(join(DATA_DIR, "queue.json")).catch(() => {});
}

const updateChecker = new UpdateChecker();
const cmuxVersion = await detectCmuxVersion(config.cmux.binary);
if (cmuxVersion.compatible) {
  console.log(`Config: cmux version = ${cmuxVersion.version} (compatible)`);
} else {
  console.log(`Config: cmux version = ${cmuxVersion.version || "unknown"} (${cmuxVersion.reason} — supported: ${cmuxVersion.range.min}–${cmuxVersion.range.max})`);
}
const monitor = new Monitor(queue, { onUpdate: broadcast });

function getSessionCount() {
  const ids = new Set();
  for (const item of queue.items()) ids.add(item.workspaceId);
  return ids.size;
}

function getFullData() {
  const tabData = {};
  const tabStatus = {};
  for (const [name, tab] of Object.entries(tabs)) {
    tabData[name] = tab.data;
    const { data, init, ...status } = tab;
    tabStatus[name] = status;
  }
  return {
    ...queue.grouped(config.showRecentGroups ? config.maxRecentGroups : 0),
    dismissed: queue.dismissedItems(),
    stats: queue.stats(),
    maxSessions: config.maxSessions,
    sessionCount: getSessionCount(),
    updateStatus: updateChecker.data,
    cmuxVersion,
    refreshing: [...refreshingIds()],
    ...tabData,
    tabStatus,
  };
}

// Every mutating endpoint (new-workspace, restart, update, close, config POST, ...) is
// reachable from any page the user visits: CORS is wildcard and the server binds all
// interfaces. A browser cannot forge Origin, so requiring it to match Host blocks
// cross-site callers. Non-browser clients (curl) send no Origin at all. Applied to every
// non-GET/HEAD request below rather than per-endpoint, so new mutating routes are covered
// by default instead of needing to opt in individually.
function isSameOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function parseExternalUrl(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed;
}

// AppleScript window id of the Chrome window /api/open-external last opened a link into,
// so subsequent clicks reuse that dedicated window instead of picking whichever other
// window happens to be open (which was otherwise indistinguishable from the user's own
// browsing window). Empty string until the first successful open. In-memory only — reset
// on server restart, which just means the next click creates a fresh window.
let lastLinksWindowId = "";

function resolveCwd(pick) {
  return resolveDirectory(pick, { defaultDirectory: config.defaultDirectory, home: HOME });
}


const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  if (req.method !== "GET" && req.method !== "HEAD" && !isSameOriginRequest(req)) {
    return jsonResponse(res, { ok: false, error: "Cross-origin request rejected" }, 403);
  }

  try {
    if (req.url === "/api/queue" && req.method === "GET") {
      return jsonResponse(res, getFullData());
    }

    if (req.url === "/api/config" && req.method === "GET") {
      const tabConfigs = {};
      for (const [name, tab] of Object.entries(tabs)) {
        const { data, init, ...tabConfig } = tab;
        tabConfigs[name] = tabConfig;
      }
      return jsonResponse(res, {
        version: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version,
        resolved: config,
        projectDir: join(__dirname, ".."),
        cmuxVersion,
        configWarnings,
        ...tabConfigs,
      });
    }

    if (req.url === "/api/config/schema" && req.method === "GET") {
      return jsonResponse(res, {
        schema: configSchema,
        raw: loadRawConfig(),
        resolved: config,
        configWarnings,
      });
    }

    if (req.url === "/api/config" && req.method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        return jsonResponse(res, { error: "Invalid config object" }, 400);
      }
      writeConfigFile(mergeConfigForSave(body, loadRawConfig()));
      jsonResponse(res, { ok: true });
      setTimeout(() => {
        const now = new Date();
        utimesSync(join(__dirname, "server.js"), now, now);
      }, 100);
      return;
    }

    // --- Plugin config API ---

    if (req.url?.startsWith("/api/plugins") && req.method === "GET") {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

      if (path === "/api/plugins") {
        const refresh = url.searchParams.get("refresh") === "1";
        return jsonResponse(res, plugins.list(refresh));
      }

      const idMatch = path.match(/^\/api\/plugins\/([^/]+)\/config$/);
      if (idMatch) {
        const id = decodeURIComponent(idMatch[1]);
        const config = plugins.getConfig(id);
        if (!config) return jsonResponse(res, { error: "Plugin not found" }, 404);
        return jsonResponse(res, config);
      }
    }

    if (req.url?.match(/^\/api\/plugins\/[^/]+\/config$/) && req.method === "POST") {
      const id = decodeURIComponent(req.url.match(/^\/api\/plugins\/([^/]+)\/config$/)[1]);
      const body = await readBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return jsonResponse(res, { error: "Body must be a JSON object" }, 400);
      }
      try {
        plugins.writeConfig(id, body);
        return jsonResponse(res, { ok: true });
      } catch (err) {
        return jsonResponse(res, { error: err.message }, 404);
      }
    }

    if (req.url?.match(/^\/api\/plugins\/[^/]+\/config$/) && req.method === "DELETE") {
      const id = decodeURIComponent(req.url.match(/^\/api\/plugins\/([^/]+)\/config$/)[1]);
      try {
        plugins.deleteConfig(id);
        return jsonResponse(res, { ok: true });
      } catch (err) {
        return jsonResponse(res, { error: err.message }, 404);
      }
    }

    // --- Consent-gated integrations API ---
    // Status is always computed live (never cached in config.json) so the UI
    // can't show "enabled" when the underlying install action never ran, or
    // silently drift if something external changes the actual system state.

    if (req.url === "/api/integrations" && req.method === "GET") {
      const list = await Promise.all(
        INTEGRATIONS.map(async (i) => {
          const enabled = await integrationStatus(i.id);
          return {
            id: i.id,
            name: i.name,
            description: i.description,
            warning: i.warning,
            enabled,
            // Nudge-worthy until the user makes an explicit decision either way
            // (enable or dismiss) — once decided, never shown again.
            shouldNudge: !enabled && !integrationIsDecided(i.id),
          };
        })
      );
      return jsonResponse(res, list);
    }

    const integrationActionMatch = req.url?.match(/^\/api\/integrations\/([^/]+)\/(enable|disable|dismiss)$/);
    if (integrationActionMatch && req.method === "POST") {
      const id = decodeURIComponent(integrationActionMatch[1]);
      const action = integrationActionMatch[2];
      try {
        if (action === "dismiss") {
          const result = dismissIntegration(id);
          return jsonResponse(res, { ...result, enabled: await integrationStatus(id), shouldNudge: false });
        }
        const result = action === "enable" ? await enableIntegration(id) : await disableIntegration(id);
        // Always re-derive from live status rather than trusting the action's
        // own result — the frontend renders this, never the action's outcome,
        // so a partial failure can't leave the toggle showing the wrong state.
        const enabled = await integrationStatus(id);
        return jsonResponse(res, { ...result, enabled, shouldNudge: !enabled && !integrationIsDecided(id) });
      } catch (err) {
        return jsonResponse(res, { ok: false, error: err.message }, 404);
      }
    }

    if (req.url?.startsWith("/api/refresh/") && req.method === "POST") {
      const name = req.url.slice("/api/refresh/".length);
      const tab = tabs[name];
      if (!tab?.refresh) return jsonResponse(res, { error: "unknown tab" }, 404);
      try {
        await tab.refresh();
        return jsonResponse(res, { ok: true });
      } catch (err) {
        return jsonResponse(res, { error: err.message }, 500);
      }
    }

    if (req.url === "/api/logs" && req.method === "GET") {
      return jsonResponse(res, getLines());
    }

    if (req.url === "/api/restart" && req.method === "POST") {
      jsonResponse(res, { ok: true });
      setTimeout(() => {
        const now = new Date();
        utimesSync(join(__dirname, "server.js"), now, now);
      }, 100);
      return;
    }

    if (req.url === "/api/changelog" && req.method === "GET") {
      try {
        const content = await readFile(join(__dirname, "..", "CHANGELOG.md"), "utf-8");
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end(content);
      } catch (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        return res.end("Changelog not found");
      }
    }

    if (req.url === "/api/refresh-session" && req.method === "POST") {
      const { workspaceId, dangerous } = await readBody(req);
      const result = await refreshSession(workspaceId, { dangerous: !!dangerous });
      return jsonResponse(res, result, result.ok ? 200 : 400);
    }

    if (req.url === "/api/refresh-all" && req.method === "POST") {
      const { dangerous } = await readBody(req).catch(() => ({}));
      const result = await refreshAll({ dangerous: !!dangerous });
      return jsonResponse(res, result);
    }

    if (req.url === "/api/focus" && req.method === "POST") {
      const { workspaceId } = await readBody(req);
      await cmux.selectWorkspace(workspaceId);
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/rename" && req.method === "POST") {
      const { workspaceId, title } = await readBody(req);
      await cmux.renameWorkspace(workspaceId, title);
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/install-cmux" && req.method === "POST") {
      if (!cmuxVersion?.downloadUrl) {
        return jsonResponse(res, { error: "No download URL available" }, 400);
      }
      const tmpDmg = "/tmp/cmux-macos-install.dmg";
      try {
        const exec = (cmd, args) => new Promise((resolve, reject) =>
          execFile(cmd, args, { timeout: 120_000 }, (err, stdout) => err ? reject(err) : resolve(stdout)));

        await exec("curl", ["-fsSL", "-o", tmpDmg, cmuxVersion.downloadUrl]);

        const mountOut = await exec("hdiutil", ["attach", tmpDmg]);
        const mountLine = mountOut.trim().split("\n").pop();
        const mountPoint = mountLine?.split(/\t/).pop()?.trim();
        if (!mountPoint) throw new Error("Failed to determine mount point");

        execFile("open", [mountPoint]);

        return jsonResponse(res, { ok: true });
      } catch (err) {
        return jsonResponse(res, { ok: false, error: err.message }, 500);
      }
    }

    if (req.url === "/api/close" && req.method === "POST") {
      const { workspaceId } = await readBody(req);
      await cmux.closeWorkspace(workspaceId);
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/open-external" && req.method === "POST") {
      const { url } = await readBody(req);
      const target = parseExternalUrl(url);
      if (!target) {
        // A missing/malformed url (e.g. pr.url was never populated) hits this branch;
        // log it so the client's report isn't a dead end with no server-side signal.
        console.warn(`[open-external] rejected invalid or missing url: ${JSON.stringify(url)}`);
        return jsonResponse(res, { ok: false, error: "Invalid or missing url" }, 400);
      }
      // The URL is passed as argv rather than interpolated into the script source: a
      // double quote or newline in the URL would otherwise close the AppleScript string
      // literal and let the caller append arbitrary AppleScript (including `do shell
      // script`).
      //
      // Reuse only the window *this feature created* (tracked by AppleScript window id
      // in `lastLinksWindowId`), never "any window that isn't the dashboard" — that
      // heuristic matched whichever regular browsing window happened to be open and
      // dumped new tabs into it instead of a dedicated window. If the tracked window was
      // closed (or this is the first call since the server started), create a fresh one.
      const script = `
        on run argv
          set targetURL to item 1 of argv
          set lastWindowId to item 2 of argv
          tell application "Google Chrome"
            set targetWindow to missing value
            if lastWindowId is not "" then
              try
                set targetWindow to window id (lastWindowId as integer)
              end try
            end if
            if targetWindow is missing value then
              -- A freshly created window's default tab starts loading Chrome's own
              -- new-tab-page asynchronously, and that load can race anything we do
              -- immediately after make new window — including the second-tab-then-close
              -- approach below, non-deterministically. Retrying the URL set for up to
              -- 1.5s until it actually sticks (instead of setting it once and hoping)
              -- covers the race regardless of which step it lands on.
              make new window
              set targetWindow to window 1
              tell targetWindow to make new tab with properties {URL:targetURL}
              close tab 1 of targetWindow
              repeat with i from 1 to 15
                if (URL of active tab of targetWindow) is not "chrome://new-tab-page/" then exit repeat
                set URL of active tab of targetWindow to targetURL
                delay 0.1
              end repeat
            else
              tell targetWindow to make new tab with properties {URL:targetURL}
            end if
            -- Raise the window we actually wrote to before activating: a bare activate
            -- only fronts whichever Chrome window was last frontmost, which is usually
            -- the dashboard window the click came from.
            set index of targetWindow to 1
            activate
            return id of targetWindow
          end tell
        end run`;
      // A failed osascript invocation (Chrome not installed, not running, Automation
      // permission not granted) has no other observable signal. Report it so the
      // caller can fall back to a plain window.open.
      const { error, windowId } = await new Promise((resolve) => {
        execFile("osascript", ["-e", script, target.href, lastLinksWindowId], (err, stdout) => {
          resolve({ error: err, windowId: stdout && stdout.trim() });
        });
      });
      if (error) {
        console.error(`[open-external] osascript failed for ${target.href}: ${error.message}`);
        return jsonResponse(res, { ok: false, error: error.message, fallback: true }, 500);
      }
      if (windowId) lastLinksWindowId = windowId;
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/new-workspace" && req.method === "POST") {
      if (config.maxSessions !== null && getSessionCount() >= config.maxSessions) {
        return jsonResponse(res, { error: "Workspace limit reached", limit: config.maxSessions, current: getSessionCount() }, 429);
      }
      const body = await readBody(req).catch(() => ({}));
      const cwd = body.cwd || config.defaultDirectory;
      let { command } = body;
      if (command === "claude") {
        if (body.dangerous) command += " --dangerously-skip-permissions";
        if (body.prompt) {
          const escaped = "'" + body.prompt.replace(/'/g, "'\\''") + "'";
          command += ` ${escaped}`;
        }
      }
      await cmux.createWorkspace({ cwd, command });
      await monitor.poll();
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/agent-workspace" && req.method === "POST") {
      if (config.maxSessions !== null && getSessionCount() >= config.maxSessions) {
        return jsonResponse(res, { error: "Workspace limit reached", limit: config.maxSessions, current: getSessionCount() }, 429);
      }
      // `directory` is the ticket drawer's explicit pick; `repo` is the PR drawer's GitHub
      // repo name. Kept as separate fields so only a deliberate directory choice feeds the
      // picker's history — a PR dispatch shouldn't reorder the ticket guess.
      const { prompt, repo, directory, dangerous, jiraProject } = await readBody(req);
      if (!prompt || typeof prompt !== "string") {
        return jsonResponse(res, { error: "prompt required" }, 400);
      }
      const escaped = "'" + prompt.replace(/'/g, "'\\''") + "'";
      const flags = dangerous ? " --dangerously-skip-permissions" : "";
      await cmux.createWorkspace({
        cwd: resolveCwd(directory || repo),
        command: `claude${flags} ${escaped}`,
      });
      await monitor.poll();
      // Remember the pick so this ticket's project (and directories in general) guess better
      // next time — best-effort, never blocks the response on a disk write.
      if (directory) {
        directoryHistory.use(jiraProject || null, directory);
        directoryHistory.save(DIRECTORY_HISTORY_PATH).catch(() => {});
      }
      return jsonResponse(res, { ok: true });
    }

    // Directory choices for the ticket drawer's directory picker, plus the guess to pre-fill.
    // The datalist shows this project's most-recently-used directory first, then the global
    // recency cache, then the default directory, then the rest alphabetically. `suggested` is
    // returned explicitly rather than implied by list position, so the client never guesses an
    // arbitrary alphabetically-first checkout when there's no history to go on.
    if (req.url?.startsWith("/api/directories") && req.method === "GET") {
      const { searchParams } = new URL(req.url, "http://localhost");
      const projectKey = searchParams.get("project") || null;
      const names = await listDirectories(config.defaultDirectory);
      const { directories, suggested } = directoryHistory.directoryOptions(projectKey, names, config.defaultDirectory);
      return jsonResponse(res, { directories, suggested, defaultDirectory: config.defaultDirectory });
    }

    if (req.url === "/api/check-update" && req.method === "POST") {
      await updateChecker.check();
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/update" && req.method === "POST") {
      const repoCwd = join(__dirname, "..");
      const body = await readBody(req).catch(() => ({}));
      const git = (args) => new Promise((resolve, reject) =>
        execFile("git", args, { cwd: repoCwd }, (err, stdout) => err ? reject(err) : resolve(stdout)));
      try {
        const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
        if (branch !== "master" && !body.switchBranch) {
          return jsonResponse(res, { ok: false, needsBranchSwitch: true, branch });
        }
        const status = await git(["status", "--porcelain"]);
        const tracked = status.split("\n").filter((l) => l && !l.startsWith("??")).join("\n");
        if (tracked.trim()) {
          return jsonResponse(res, { ok: false, error: "Working tree has uncommitted changes" });
        }
        const switched = branch !== "master" && body.switchBranch;
        if (switched) {
          await git(["checkout", "master"]);
        }
        try {
          await git(["pull", "origin", "master"]);
          await new Promise((resolve, reject) =>
            execFile("npm", ["ci"], { cwd: repoCwd }, (err) => err ? reject(err) : resolve()));
        } catch (err) {
          if (switched) await git(["checkout", branch]).catch(() => {});
          throw err;
        }
        jsonResponse(res, { ok: true });
        setTimeout(() => {
          const now = new Date();
          utimesSync(join(__dirname, "server.js"), now, now);
        }, 200);
        return;
      } catch (err) {
        return jsonResponse(res, { ok: false, error: err.message }, 500);
      }
    }

    if (req.url === "/api/dismiss" && req.method === "POST") {
      const { id } = await readBody(req);
      queue.dismiss(id);
      broadcast();
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/restore" && req.method === "POST") {
      const { id } = await readBody(req);
      queue.restore(id);
      broadcast();
      return jsonResponse(res, { ok: true });
    }

    // --- Tasks API ---

    if (req.url === "/api/tasks" && req.method === "GET") {
      if (!tasks.enabled) {
        return jsonResponse(res, { error: "Tasks tab is not enabled. Enable it in Settings." }, 404);
      }
      return jsonResponse(res, { tasks: tasks.data });
    }

    if (req.url === "/api/tasks" && req.method === "POST") {
      if (!tasks.enabled) {
        return jsonResponse(res, { error: "Tasks tab is not enabled. Enable it in Settings." }, 404);
      }
      const { title } = await readBody(req);
      if (!title || typeof title !== "string" || !title.trim()) {
        return jsonResponse(res, { error: "title is required" }, 400);
      }
      const task = taskStore.add(title.trim());
      saveTasks().catch(() => {});
      broadcast();
      return jsonResponse(res, { task }, 201);
    }

    if (req.url?.startsWith("/api/tasks/") && req.method === "PATCH") {
      if (!tasks.enabled) {
        return jsonResponse(res, { error: "Tasks tab is not enabled. Enable it in Settings." }, 404);
      }
      const id = decodeURIComponent(req.url.slice("/api/tasks/".length));
      const body = await readBody(req);
      const task = taskStore.get(id);
      if (!task) return jsonResponse(res, { error: "Task not found" }, 404);
      if (typeof body.done === "boolean") task.done = body.done;
      saveTasks().catch(() => {});
      broadcast();
      return jsonResponse(res, { task });
    }

    if (req.url?.startsWith("/api/tasks/") && req.method === "DELETE") {
      if (!tasks.enabled) {
        return jsonResponse(res, { error: "Tasks tab is not enabled. Enable it in Settings." }, 404);
      }
      const id = decodeURIComponent(req.url.slice("/api/tasks/".length));
      if (!taskStore.remove(id)) {
        return jsonResponse(res, { error: "Task not found" }, 404);
      }
      saveTasks().catch(() => {});
      broadcast();
      res.writeHead(204);
      return res.end();
    }
  } catch (err) {
    console.error(`API error [${req.url}]:`, err.message);
    return jsonResponse(res, { error: err.message }, 500);
  }

  // Static files
  if (req.url === "/" || req.url === "/index.html") {
    return serveStatic(res, join(PUBLIC_DIR, "index.html"));
  }
  if (req.url.startsWith("/tabs/") && req.url.endsWith(".client.js")) {
    return serveStatic(res, join(TABS_DIR, req.url.slice("/tabs/".length)));
  }
  return serveStatic(res, join(PUBLIC_DIR, req.url));
});

const wss = new WebSocketServer({ server });

initLogs(sendToAll);

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "update", data: getFullData() }));
  ws.send(JSON.stringify({ type: "logs", lines: getLines() }));
});

// --- Init ---

for (const [name, tab] of Object.entries(tabs)) {
  const tabConfig = { ...(config.tabs[name] || {}) };
  if (name === "tasks") tabConfig._dataPath = TASKS_DATA_PATH;
  await tab.init(tabConfig, broadcast);
}

updateChecker.init(broadcast);

server.listen(PORT, () => {
  console.log(`Agent Triage running at http://localhost:${PORT}`);
  monitor.start();
});
