import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Queue } from "./queue.js";
import { Monitor } from "./monitor.js";
import * as cmux from "./cmux.js";
import { execFile } from "node:child_process";
import { getLoopStatuses } from "./loops.js";
import { getMyPulls } from "./pulls.js";
import { getMyTickets } from "./tickets.js";
import config from "./config.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");
const DATA_DIR = join(__dirname, "..", "data");
const PORT = process.env.PORT || config.port;

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
};

const queue = new Queue();
await queue.load(join(DATA_DIR, "queue.json"));

function broadcast() {
  const payload = JSON.stringify({ type: "update", data: getFullData() });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
  queue.save(join(DATA_DIR, "queue.json")).catch(() => {});
}

function broadcastUpdate() {
  broadcast();
}

let loopsData = [];
let pullsData = { mine: [], reviews: [] };
let ticketsData = [];

const monitor = new Monitor(queue, { onUpdate: broadcastUpdate });

function getQueueData() {
  return {
    groups: queue.grouped(),
    dismissed: queue.dismissedItems(),
    stats: queue.stats(),
  };
}

function getFullData() {
  return { ...getQueueData(), loops: loopsData, pulls: pullsData, tickets: ticketsData };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function serveStatic(res, filePath) {
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

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
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
      return jsonResponse(res, {
        version: JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version,
        loops: { enabled: config.loops.enabled, installUrl: config.loops.installUrl },
        tickets: { enabled: config.tickets.enabled },
        pulls: { enabled: config.pulls.enabled },
      });
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
      await cmux.createWorkspace();
      await monitor.poll();
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/dismiss" && req.method === "POST") {
      const { id } = await readBody(req);
      queue.dismiss(id);
      broadcastUpdate();
      return jsonResponse(res, { ok: true });
    }

    if (req.url === "/api/restore" && req.method === "POST") {
      const { id } = await readBody(req);
      queue.restore(id);
      broadcastUpdate();
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
  return serveStatic(res, join(PUBLIC_DIR, req.url));
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "update", data: getFullData() }));
});

async function pollLoops() {
  try {
    loopsData = await getLoopStatuses();
    broadcast();
  } catch (err) {
    console.error("Loops poll error:", err.message);
  }
}

async function pollPulls() {
  try {
    pullsData = await getMyPulls();
    broadcast();
  } catch (err) {
    console.error("Pulls poll error:", err.message);
  }
}

async function pollTickets() {
  try {
    const result = await getMyTickets();
    if (result.length > 0) ticketsData = result;
    broadcast();
  } catch (err) {
    console.error("Tickets poll error:", err.message);
  }
}

server.listen(PORT, () => {
  console.log(`Agent Triage v1.0.0 running at http://localhost:${PORT}`);
  monitor.start();
  if (config.loops.enabled) {
    pollLoops();
    setInterval(pollLoops, 5 * 60 * 1000);
  }
  if (config.pulls.enabled) {
    pollPulls();
    setInterval(pollPulls, 2 * 60 * 1000);
  }
  if (config.tickets.enabled) {
    pollTickets();
    setInterval(pollTickets, 3 * 60 * 1000);
  }
});
