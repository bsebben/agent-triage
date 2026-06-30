// src/tabs/tickets.js — Tab module: Jira ticket integration
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startPolling } from "../utils.js";
import { RunlayerMcpClient } from "../runlayer-mcp.js";

const execFileAsync = promisify(execFile);
const DEFAULT_JQL = "assignee = currentUser() AND status != Done ORDER BY status ASC";
const FIELDS = ["summary", "status", "issuetype", "parent"];

const detected = {
  cloudId: null,
  jiraSite: null,
  jql: DEFAULT_JQL,
  transport: null, // "mcpproxy" | "runlayer"
  mcpTool: null,
  runlayerClient: null,
};

export const defaults = {
  enabled: true,
  runlayerUrl: null,
  runlayerApiKey: null,
};

let data = [];

async function init(tabConfig, onUpdate) {
  const cfg = { ...defaults, ...tabConfig };
  tab.enabled = cfg.enabled;
  if (!cfg.enabled) return;

  if (cfg.runlayerUrl) {
    detected.runlayerUrl = cfg.runlayerUrl;
  }
  if (cfg.runlayerApiKey) {
    detected.runlayerApiKey = cfg.runlayerApiKey;
  }

  tab.refresh = await startPolling("Tickets", poll, onUpdate, 3 * 60 * 1000);
}

// --- Transport detection ---

/**
 * Tries mcpproxy first, then Runlayer. Sets detected.transport on success.
 *
 * Returns true if a working transport was found.
 */
async function detect() {
  if (await detectMcpProxy()) return true;
  if (await detectRunlayer()) return true;

  tab.hint = "No Jira transport available. Install mcpproxy, or configure runlayerUrl and runlayerApiKey in config.json tabs.tickets.";
  return false;
}

/**
 * Detects mcpproxy and discovers the Jira server through it.
 *
 * This is the original transport — uses the mcpproxy CLI to proxy MCP calls.
 */
async function detectMcpProxy() {
  try {
    const server = await detectMcpProxyJiraServer();
    if (!server) return false;

    const { cloudId, jiraSite } = await detectCloudInfoViaMcpProxy(server.name);
    detected.transport = "mcpproxy";
    detected.cloudId = cloudId;
    detected.jiraSite = jiraSite.replace(/\/$/, "");
    detected.mcpTool = `${server.name}:searchJiraIssuesUsingJql`;
    tab.available = true;
    tab.hint = null;
    console.log(`Config: tickets enabled via mcpproxy (${detected.jiraSite})`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects the Runlayer Jira MCP server and initializes a client.
 *
 * Uses the runlayerUrl/runlayerApiKey from config, falling back to
 * the RUNLAYER_USER_KEY env var for the API key.
 */
async function detectRunlayer() {
  const url = detected.runlayerUrl;
  const apiKey = detected.runlayerApiKey || process.env.RUNLAYER_USER_KEY;

  if (!url) return false;
  if (!apiKey) {
    tab.hint = "Runlayer URL configured but no API key found. Set runlayerApiKey in config.json tabs.tickets, or set RUNLAYER_USER_KEY env var.";
    return false;
  }

  try {
    const client = new RunlayerMcpClient(url, apiKey);
    await client.initialize();

    const { cloudId, jiraSite } = await detectCloudInfoViaRunlayer(client);
    detected.transport = "runlayer";
    detected.runlayerClient = client;
    detected.cloudId = cloudId;
    detected.jiraSite = jiraSite.replace(/\/$/, "");
    tab.available = true;
    tab.hint = null;
    console.log(`Config: tickets enabled via Runlayer (${detected.jiraSite})`);
    return true;
  } catch (err) {
    console.log(`[tickets] Runlayer detection failed: ${err.message}`);
    tab.hint = `Runlayer Jira connection failed: ${friendlyError(err.message)}`;
    return false;
  }
}

// --- Polling ---

async function poll() {
  if (!detected.transport) {
    await detect();
    if (!detected.transport) throw new Error("Jira transport not available");
  }

  const { cloudId, jiraSite, jql } = detected;
  console.log(`[tickets] polling via ${detected.transport}`);

  try {
    let issues;
    if (detected.transport === "mcpproxy") {
      issues = await pollViaMcpProxy(cloudId, jql);
    } else {
      issues = await pollViaRunlayer(cloudId, jql);
    }

    const result = groupByParent(issues, jiraSite);
    if (result.length > 0) data = result;
    tab.hint = null;
  } catch (err) {
    const friendly = friendlyError(err.message);
    tab.hint = friendly;
    console.error(`[tickets] fetch error: ${friendly}`);
    if (isTransportError(err.message)) detected.transport = null;
    throw err;
  }
}

function isTransportError(msg) {
  return msg.includes("ENOENT") || msg.includes("ECONNREFUSED")
    || msg.includes("HTTP 401") || msg.includes("HTTP 403");
}

// --- mcpproxy transport ---

async function pollViaMcpProxy(cloudId, jql) {
  const { stdout } = await execFileAsync(
    "mcpproxy",
    [
      "call", "tool-read",
      "-t", detected.mcpTool,
      "-j", JSON.stringify({ cloudId, jql, fields: FIELDS }),
      "-o", "json",
    ],
    { timeout: 30000, maxBuffer: 1024 * 1024 },
  );
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) return [];
  const raw = JSON.parse(stdout.slice(jsonStart));
  const textContent = raw?.content?.[0]?.text;
  if (!textContent) return [];
  return extractIssuesFromMcpProxy(textContent);
}

async function detectMcpProxyJiraServer() {
  const { stdout } = await execFileAsync("mcpproxy", ["upstream", "list", "--json"], { timeout: 5000 });
  const servers = JSON.parse(stdout);
  return servers.find((s) =>
    /jira/i.test(s.name) && s.health?.level === "healthy"
  );
}

async function detectCloudInfoViaMcpProxy(serverName) {
  const tool = `${serverName}:getAccessibleAtlassianResources`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 5000));
    try {
      const { stdout } = await execFileAsync(
        "mcpproxy",
        ["call", "tool-read", "-t", tool, "-j", "{}", "-o", "json"],
        { timeout: 10000 },
      );
      const resources = unwrapMcpProxyResponse(stdout);
      if (!resources.length) throw new Error("No accessible Atlassian resources found");
      const site = resources[0];
      return { cloudId: site.id, jiraSite: site.url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// --- Runlayer transport ---

async function pollViaRunlayer(cloudId, jql) {
  const result = await detected.runlayerClient.callTool(
    "searchJiraIssuesUsingJql",
    { cloudId, jql, fields: FIELDS },
  );

  const textContent = result?.content?.[0]?.text;
  if (!textContent) return [];

  try {
    const parsed = JSON.parse(textContent);
    return parsed.issues || [];
  } catch {
    return extractIssuesFromCleanJson(textContent);
  }
}

async function detectCloudInfoViaRunlayer(client) {
  const result = await client.callTool("getAccessibleAtlassianResources", {});
  const textContent = result?.content?.[0]?.text;
  if (!textContent) throw new Error("Empty response from getAccessibleAtlassianResources");

  const resources = JSON.parse(textContent);
  if (!Array.isArray(resources) || !resources.length) {
    throw new Error("No accessible Atlassian resources found");
  }
  return { cloudId: resources[0].id, jiraSite: resources[0].url };
}

// --- Shared helpers ---

function friendlyError(raw) {
  if (raw.includes("rate limit")) return "Rate limited — will retry on next poll.";
  if (raw.includes("ENOENT")) return "mcpproxy not found. Make sure it's installed and in your PATH.";
  if (raw.includes("timeout") || raw.includes("ETIMEDOUT")) return "Connection timed out. Check that your Jira MCP server is running.";
  if (raw.includes("not found")) return "Jira tools not available on this MCP server.";
  if (raw.includes("HTTP 401")) return "Authentication failed. Check your Runlayer API key.";
  if (raw.includes("HTTP 403")) return "Access denied. Make sure you're using a user API key, not an org key.";
  return "Check that your Jira MCP server is authenticated and running.";
}

function groupByParent(issues, jiraSite) {
  const groups = new Map();
  const standalone = [];

  for (const issue of issues) {
    const f = issue.fields;
    const ticket = {
      key: issue.key,
      summary: f.summary,
      status: f.status?.name || "Unknown",
      type: f.issuetype?.name || "Task",
      url: `${jiraSite}/browse/${issue.key}`,
    };

    const parent = f.parent;
    if (parent) {
      const parentKey = parent.key;
      if (!groups.has(parentKey)) {
        groups.set(parentKey, {
          key: parentKey,
          summary: parent.fields?.summary || parentKey,
          type: parent.fields?.issuetype?.name || "Story",
          url: `${jiraSite}/browse/${parentKey}`,
          tickets: [],
        });
      }
      groups.get(parentKey).tickets.push(ticket);
    } else {
      standalone.push(ticket);
    }
  }

  const result = [];
  for (const group of groups.values()) {
    result.push(group);
  }
  if (standalone.length > 0) {
    result.push({ key: null, summary: "Standalone", type: null, url: null, tickets: standalone });
  }
  return result;
}

// --- mcpproxy response parsing ---
// mcpproxy double-wraps MCP responses with Go map[] serialization.
// These parsers handle that format.

function unwrapMcpProxyResponse(raw) {
  let text = raw;
  for (let i = 0; i < 5; i++) {
    const arrayStart = text.indexOf("[{");
    if (arrayStart >= 0) {
      try {
        const arr = JSON.parse(text.slice(arrayStart));
        if (Array.isArray(arr) && arr[0]?.id) return arr;
      } catch { /* not a complete array at this level */ }
    }
    const jsonStart = text.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const obj = JSON.parse(text.slice(jsonStart));
        const inner = obj?.content?.[0]?.text;
        if (inner) { text = inner; continue; }
      } catch { /* not valid JSON, try extracting from Go map[] */ }
    }
    const mapMatch = text.match(/map\[text:(\[.+\]|\{.+\})\s+type:text\]/s);
    if (mapMatch) { text = mapMatch[1]; continue; }
    break;
  }
  return [];
}

function unescapeJsonString(escaped) {
  let out = "";
  for (let j = 0; j < escaped.length; j++) {
    if (escaped[j] === "\\" && j + 1 < escaped.length) {
      const next = escaped[j + 1];
      if (next === "n") { out += "\n"; j++; }
      else if (next === '"') { out += '"'; j++; }
      else if (next === "\\") { out += "\\"; j++; }
      else if (next === "t") { out += "\t"; j++; }
      else if (next === "r") { out += "\r"; j++; }
      else { out += escaped[j]; }
    } else {
      out += escaped[j];
    }
  }
  return out;
}

function parseIssueArray(src, arrayStart) {
  const issues = [];
  let depth = 0;
  let objStart = -1;
  for (let k = arrayStart + 1; k < src.length; k++) {
    const ch = src[k];
    if (ch === '"') {
      k++;
      while (k < src.length && src[k] !== '"') {
        if (src[k] === "\\") k++;
        k++;
      }
      continue;
    }
    if (ch === "{") {
      if (depth === 0) objStart = k;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try {
          issues.push(JSON.parse(src.slice(objStart, k + 1)));
        } catch { /* partial object at truncation boundary */ }
        objStart = -1;
      }
    }
  }
  return issues;
}

function extractIssuesFromMcpProxy(text) {
  const marker = '"text":"';
  let pos = text.indexOf(marker);

  if (pos === -1) {
    const issuesIdx = text.indexOf('"issues"');
    if (issuesIdx === -1) return [];
    const arrayStart = text.indexOf("[", issuesIdx);
    if (arrayStart === -1) return [];
    try {
      const objStart = text.lastIndexOf("{", issuesIdx);
      if (objStart !== -1) {
        const parsed = JSON.parse(text.slice(objStart));
        if (parsed.issues) return parsed.issues;
      }
    } catch { /* truncated — fall through to char-by-char */ }
    return parseIssueArray(text, arrayStart);
  }

  while (pos !== -1) {
    const start = pos + marker.length;
    let i = start;
    while (i < text.length) {
      if (text[i] === "\\") { i += 2; continue; }
      if (text[i] === '"') break;
      i++;
    }
    const escaped = text.slice(start, i);
    if (!escaped.includes("issues")) {
      pos = text.indexOf(marker, i + 1);
      continue;
    }

    const unescaped = unescapeJsonString(escaped);

    try {
      const parsed = JSON.parse(unescaped);
      if (parsed.issues) return parsed.issues;
    } catch { /* truncated */ }

    const issuesStart = unescaped.indexOf('"issues"');
    if (issuesStart === -1) return [];
    const arrayStart = unescaped.indexOf("[", issuesStart);
    if (arrayStart === -1) return [];
    return parseIssueArray(unescaped, arrayStart);
  }
  return [];
}

// --- Runlayer response parsing ---

function extractIssuesFromCleanJson(text) {
  const issuesIdx = text.indexOf('"issues"');
  if (issuesIdx === -1) return [];
  const arrayStart = text.indexOf("[", issuesIdx);
  if (arrayStart === -1) return [];
  try {
    const objStart = text.lastIndexOf("{", issuesIdx);
    if (objStart !== -1) {
      const parsed = JSON.parse(text.slice(objStart));
      if (parsed.issues) return parsed.issues;
    }
  } catch { /* fall through to char-by-char */ }
  return parseIssueArray(text, arrayStart);
}

const tab = {
  enabled: false,
  available: false,
  hint: null,
  get data() { return data; },
  init,
};

export default tab;
