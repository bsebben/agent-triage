// src/config.js
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

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
  const matches = entries.filter((e) => e.startsWith("claude-loops"));
  // Prefer the directory that has a state/ subdirectory with loop data
  const withState = matches.find((e) => existsSync(join(pluginsData, e, "state")));
  const match = withState || matches[0];
  return match ? join(pluginsData, match) : null;
}

function detectGhCli() {
  try {
    execFileSync("which", ["gh"], { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
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
      enabled: raw.tickets?.enabled !== false,
    },
    pulls: {
      enabled: raw.pulls?.enabled !== false,
      orgFilter: raw.pulls?.orgFilter || null,
      ghAvailable: detectGhCli(),
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

  console.log(`Config: cmux binary = ${config.cmux.binary}`);
  console.log(`Config: cmux socket = ${config.cmux.socket}`);
  console.log(`Config: loops ${config.loops.enabled ? "enabled" : "disabled"}${config.loops.dataDir ? ` (${config.loops.dataDir})` : " (plugin not found)"}`);
  console.log(`Config: pulls ${config.pulls.enabled ? "enabled" : "disabled"}${config.pulls.ghAvailable ? "" : " (gh CLI not found)"}`);

  return Object.freeze(config);
}

const DEFAULT_JQL = "assignee = currentUser() AND status != Done ORDER BY status ASC";

export const ticketConfig = {
  available: false,
  hint: null,
  cloudId: null,
  jiraSite: null,
  jql: DEFAULT_JQL,
  mcpTool: null,
};

async function detectJiraServer() {
  const { stdout } = await execFileAsync("mcpproxy", ["upstream", "list", "--json"], { timeout: 5000 });
  const servers = JSON.parse(stdout);
  return servers.find((s) =>
    /jira/i.test(s.name) && s.connected === true && s.health?.level === "healthy"
  );
}

async function detectCloudInfo(serverName) {
  const tool = `${serverName}:getAccessibleAtlassianResources`;
  const { stdout } = await execFileAsync(
    "mcpproxy",
    ["call", "tool-read", "-t", tool, "-j", "{}", "-o", "json"],
    { timeout: 10000 },
  );
  // mcpproxy wraps responses in { content: [{ text: "..." }] }
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) throw new Error("No JSON in getAccessibleResources response");
  const raw = JSON.parse(stdout.slice(jsonStart));
  const text = raw?.content?.[0]?.text;
  if (!text) throw new Error("Empty getAccessibleResources response");
  const resources = JSON.parse(text);
  if (!Array.isArray(resources) || !resources.length) throw new Error("No accessible Atlassian resources found");
  const site = resources[0];
  return { cloudId: site.id, jiraSite: site.url };
}

export async function initTickets() {
  if (!config.tickets.enabled) return;

  try {
    const server = await detectJiraServer();
    if (!server) {
      ticketConfig.hint = "No healthy Jira server found. Make sure mcpproxy is running with a Jira MCP server configured.";
      console.log("Config: tickets enabled (no Jira server found)");
      return;
    }

    const { cloudId, jiraSite } = await detectCloudInfo(server.name);
    ticketConfig.available = true;
    ticketConfig.cloudId = cloudId;
    ticketConfig.jiraSite = jiraSite.replace(/\/$/, "");
    ticketConfig.mcpTool = `${server.name}:searchJiraIssuesUsingJql`;
    console.log(`Config: tickets enabled (${ticketConfig.jiraSite})`);
  } catch (err) {
    ticketConfig.hint = `Jira auto-detection failed: ${err.message}`;
    console.log(`Config: tickets enabled (auto-detect failed: ${err.message})`);
  }
}

const config = resolve(loadConfigFile());
export default config;
export { HOME };
