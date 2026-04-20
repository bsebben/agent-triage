// src/config.js
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const HOME = homedir();

function loadConfigFile() {
  const configPath = join(PROJECT_ROOT, "config.json");
  if (!existsSync(configPath)) {
    console.error("Missing config.json — copy config.example.json to config.json and edit it.");
    console.error("  cp config.example.json config.json");
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function detectCmuxBinary() {
  try {
    return execFileSync("which", ["cmux"], { encoding: "utf-8" }).trim();
  } catch {
    const appBundle = "/Applications/cmux.app/Contents/Resources/bin/cmux";
    if (existsSync(appBundle)) return appBundle;
    return null;
  }
}

function detectCmuxSocket() {
  const sock = join(HOME, "Library", "Application Support", "cmux", "cmux.sock");
  return existsSync(sock) ? sock : null;
}

function detectLoopsDataDir() {
  const pluginsData = join(HOME, ".claude", "plugins", "data");
  if (!existsSync(pluginsData)) return null;
  const entries = readdirSync(pluginsData);
  const match = entries.find((e) => e.startsWith("claude-loops"));
  return match ? join(pluginsData, match) : null;
}

function resolve(raw) {
  const config = {
    port: raw.port || 7777,
    cmux: {
      binary: raw.cmux?.binary || detectCmuxBinary(),
      socket: raw.cmux?.socket || detectCmuxSocket(),
    },
    loops: {
      enabled: raw.loops?.enabled !== false,
      dataDir: raw.loops?.dataDir || detectLoopsDataDir(),
      installUrl: raw.loops?.installUrl || "https://silver-adventure-o3qwg53.pages.github.io/plugin.html?name=claude-loops",
    },
    tickets: {
      enabled: raw.tickets?.enabled === true,
      cloudId: raw.tickets?.cloudId || "",
      jiraSite: raw.tickets?.jiraSite || "",
      jql: raw.tickets?.jql || "",
      mcpTool: raw.tickets?.mcpTool || "",
    },
    pulls: {
      enabled: raw.pulls?.enabled !== false,
      orgFilter: raw.pulls?.orgFilter || null,
    },
  };

  if (!config.cmux.binary) {
    console.error("Could not find cmux. Set cmux.binary in config.json.");
    process.exit(1);
  }
  if (!config.cmux.socket) {
    console.error("Could not find cmux socket. Set cmux.socket in config.json.");
    process.exit(1);
  }

  if (config.loops.enabled && !config.loops.dataDir) {
    console.warn("Claude Loops data directory not found — disabling Loops tab.");
    console.warn("Install claude-loops or set loops.dataDir in config.json.");
    config.loops.enabled = false;
  }

  if (config.tickets.enabled) {
    const missing = [];
    if (!config.tickets.cloudId) missing.push("tickets.cloudId");
    if (!config.tickets.jiraSite) missing.push("tickets.jiraSite");
    if (!config.tickets.jql) missing.push("tickets.jql");
    if (!config.tickets.mcpTool) missing.push("tickets.mcpTool");
    if (missing.length > 0) {
      console.error(`Tickets enabled but missing required fields: ${missing.join(", ")}`);
      process.exit(1);
    }
  }

  // Log what was detected
  console.log(`Config: cmux binary = ${config.cmux.binary}`);
  console.log(`Config: cmux socket = ${config.cmux.socket}`);
  console.log(`Config: loops ${config.loops.enabled ? "enabled" : "disabled"}${config.loops.dataDir ? ` (${config.loops.dataDir})` : ""}`);
  console.log(`Config: tickets ${config.tickets.enabled ? "enabled" : "disabled"}`);
  console.log(`Config: pulls ${config.pulls.enabled ? "enabled" : "disabled"}${config.pulls.orgFilter ? ` (orgs: ${config.pulls.orgFilter.join(", ")})` : ""}`);

  return Object.freeze(config);
}

const config = resolve(loadConfigFile());
export default config;
export { HOME };
