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

function resolve(raw) {
  const config = {
    port: raw.port || 7777,
    cmux: {
      binary: raw.cmux?.binary || detectCmuxBinary(),
      socket: raw.cmux?.socket || detectCmuxSocket(),
    },
    loops: {
      enabled: raw.loops?.enabled,
      dataDir: raw.loops?.dataDir || detectLoopsDataDir(),
      installUrl: raw.loops?.installUrl || "https://silver-adventure-o3qwg53.pages.github.io/plugin.html?name=claude-loops",
    },
    tickets: {
      enabled: raw.tickets?.enabled,
    },
    pulls: {
      enabled: raw.pulls?.enabled,
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

  if (config.loops.enabled === false) {
    console.log("Config: loops disabled (explicit)");
  } else if (config.loops.dataDir) {
    config.loops.enabled = true;
    console.log(`Config: loops enabled (${config.loops.dataDir})`);
  } else {
    config.loops.enabled = false;
    console.log("Config: loops disabled (claude-loops plugin not found)");
  }

  if (config.pulls.enabled === false) {
    console.log("Config: pulls disabled (explicit)");
  } else {
    try {
      execFileSync("which", ["gh"], { encoding: "utf-8" });
      config.pulls.enabled = true;
      console.log(`Config: pulls enabled${config.pulls.orgFilter ? ` (orgs: ${config.pulls.orgFilter.join(", ")})` : ""}`);
    } catch {
      config.pulls.enabled = false;
      console.log("Config: pulls disabled (gh CLI not found)");
    }
  }

  console.log(`Config: cmux binary = ${config.cmux.binary}`);
  console.log(`Config: cmux socket = ${config.cmux.socket}`);

  return Object.freeze(config);
}

const DEFAULT_JQL = "assignee = currentUser() AND status != Done ORDER BY status ASC";

export const ticketConfig = {
  enabled: false,
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
  const raw = config.tickets;

  if (raw.enabled === false) {
    console.log("Config: tickets disabled (explicit)");
    return;
  }

  try {
    const server = await detectJiraServer();
    if (!server) {
      console.log("Config: tickets disabled (no healthy Jira server in mcpproxy)");
      return;
    }

    const { cloudId, jiraSite } = await detectCloudInfo(server.name);
    ticketConfig.enabled = true;
    ticketConfig.cloudId = cloudId;
    ticketConfig.jiraSite = jiraSite.replace(/\/$/, "");
    ticketConfig.mcpTool = `${server.name}:searchJiraIssuesUsingJql`;
    console.log(`Config: tickets enabled (auto-detected — ${ticketConfig.jiraSite})`);
  } catch (err) {
    console.warn(`Config: tickets disabled (auto-detect failed: ${err.message})`);
  }
}

const config = resolve(loadConfigFile());
export default config;
export { HOME };
