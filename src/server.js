import { createServer } from "node:http";
import { readFileSync, existsSync, utimesSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Queue } from "./queue.js";
import { Monitor } from "./monitor.js";
import * as cmux from "./cmux.js";
import { execFile } from "node:child_process";
import { readBody, serveStatic, jsonResponse } from "./utils.js";
import { initLogs, getLines } from "./logs.js";
import config, { HOME, buildSchema, loadRawConfig, writeConfigFile } from "./config.js";
import { UpdateChecker } from "./update-checker.js";
import loops, { defaults as loopsDefaults } from "./tabs/loops.js";
import pulls, { defaults as pullsDefaults } from "./tabs/pulls.js";
import tickets, { defaults as ticketsDefaults } from "./tabs/tickets.js";

const tabDefaults = { loops: loopsDefaults, pulls: pullsDefaults, tickets: ticketsDefaults };
const configSchema = buildSchema(tabDefaults);

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const TABS_DIR = join(__dirname, "tabs");
const DATA_DIR = join(__dirname, "..", "data");
const PORT = process.env.PORT || config.port;

// --- Tab registry ---
// Each tab module exports: { status, data, init(onUpdate) }
// Modules manage their own polling. To add a new tab: create a module, import it, add it here.

const tabs = { loops, pulls, tickets };

// --- Logs ---

function sendToAll(payload) {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

// --- Queue + WebSocket ---

const queue = new Queue();
await queue.load(join(DATA_DIR, "queue.json"));

function broadcast() {
  const payload = JSON.stringify({ type: "update", data: getFullData() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
  queue.save(join(DATA_DIR, "queue.json")).catch(() => {});
}

const updateChecker = new UpdateChecker();
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
    groups: queue.grouped(),
    dismissed: queue.dismissedItems(),
    stats: queue.stats(),
    maxSessions: config.maxSessions,
    sessionCount: getSessionCount(),
    updateStatus: updateChecker.data,
    ...tabData,
    tabStatus,
  };
}

function resolveCwd(repo) {
  const workspace = join(HOME, "workspace");
  if (repo) {
    const repoName = repo.split("/").pop();
    const repoPath = join(workspace, repoName);
    if (existsSync(repoPath)) return repoPath;
  }
  if (existsSync(workspace)) return workspace;
  return HOME;
}


const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

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
        ...tabConfigs,
      });
    }

    if (req.url === "/api/config/schema" && req.method === "GET") {
      return jsonResponse(res, {
        schema: configSchema,
        raw: loadRawConfig(),
        resolved: config,
      });
    }

    if (req.url === "/api/config" && req.method === "POST") {
      const body = await readBody(req);
      if (!body || typeof body !== "object") {
        return jsonResponse(res, { error: "Invalid config object" }, 400);
      }
      writeConfigFile(body);
      jsonResponse(res, { ok: true });
      setTimeout(() => {
        const now = new Date();
        utimesSync(join(__dirname, "server.js"), now, now);
      }, 100);
      return;
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

    if (req.url === "/api/respond" && req.method === "POST") {
      const { surfaceId, workspaceId, text } = await readBody(req);
      await cmux.sendText(workspaceId, surfaceId, text);
      await cmux.sendKey(workspaceId, surfaceId, "Enter");
      return jsonResponse(res, { ok: true });
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

    if (req.url === "/api/close" && req.method === "POST") {
      const { workspaceId } = await readBody(req);
      await cmux.closeWorkspace(workspaceId);
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/open-external" && req.method === "POST") {
      const { url } = await readBody(req);
      if (url && /^https?:\/\//.test(url)) {
        const script = `
          tell application "Google Chrome"
            set targetWindow to missing value
            repeat with w in windows
              set tabURLs to URL of every tab of w
              set isDashboard to false
              repeat with u in tabURLs
                if u starts with "http://localhost:${PORT}" then
                  set isDashboard to true
                  exit repeat
                end if
              end repeat
              if not isDashboard then
                set targetWindow to w
                exit repeat
              end if
            end repeat
            if targetWindow is missing value then
              make new window
              set targetWindow to window 1
            end if
            tell targetWindow to make new tab with properties {URL:"${url}"}
          end tell`;
        execFile("osascript", ["-e", script]);
      }
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/new-workspace" && req.method === "POST") {
      if (config.maxSessions !== null && getSessionCount() >= config.maxSessions) {
        return jsonResponse(res, { error: "Session limit reached", limit: config.maxSessions, current: getSessionCount() }, 429);
      }
      const body = await readBody(req).catch(() => ({}));
      const cwd = body.cwd || config.defaultDirectory;
      let { command } = body;
      if (command === "claude" && body.prompt) {
        const escaped = "'" + body.prompt.replace(/'/g, "'\\''") + "'";
        command = `claude ${escaped}`;
      }
      await cmux.createWorkspace({ cwd, command });
      await monitor.poll();
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/agent-workspace" && req.method === "POST") {
      if (config.maxSessions !== null && getSessionCount() >= config.maxSessions) {
        return jsonResponse(res, { error: "Session limit reached", limit: config.maxSessions, current: getSessionCount() }, 429);
      }
      const { prompt, repo } = await readBody(req);
      if (!prompt || typeof prompt !== "string") {
        return jsonResponse(res, { error: "prompt required" }, 400);
      }
      const escaped = "'" + prompt.replace(/'/g, "'\\''") + "'";
      await cmux.createWorkspace({
        cwd: resolveCwd(repo),
        command: `claude ${escaped}`,
      });
      await monitor.poll();
      return jsonResponse(res, { ok: true });
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
            execFile("npm", ["install"], { cwd: repoCwd }, (err) => err ? reject(err) : resolve()));
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
  await tab.init(config.tabs[name] || {}, broadcast);
}

updateChecker.init(broadcast);

server.listen(PORT, () => {
  console.log(`Agent Triage running at http://localhost:${PORT}`);
  monitor.start();
});
