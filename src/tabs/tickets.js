// src/tabs/tickets.js — Tab module: Jira ticket integration
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startPolling } from "../utils.js";

const execFileAsync = promisify(execFile);
const DEFAULT_JQL = "assignee = currentUser() AND status != Done ORDER BY status ASC";
const FIELDS = ["summary", "status", "issuetype", "parent"];

const detected = {
  cloudId: null,
  jiraSite: null,
  jql: DEFAULT_JQL,
  mcpTool: null,
};

export const defaults = {
  enabled: true,
};

let data = [];

async function init(tabConfig, onUpdate) {
  const cfg = { ...defaults, ...tabConfig };
  tab.enabled = cfg.enabled;
  if (!cfg.enabled) return;

  try {
    const server = await detectJiraServer();
    if (!server) {
      tab.hint = "No Jira server found. Make sure your Jira MCP server is authenticated and running.";
      console.log("Config: tickets enabled (no Jira server found)");
      return;
    }

    const { cloudId, jiraSite } = await detectCloudInfo(server.name);
    tab.available = true;
    detected.cloudId = cloudId;
    detected.jiraSite = jiraSite.replace(/\/$/, "");
    detected.mcpTool = `${server.name}:searchJiraIssuesUsingJql`;
    console.log(`Config: tickets enabled (${detected.jiraSite})`);
  } catch (err) {
    tab.hint = `Jira auto-detection failed: ${err.message}`;
    console.log(`Config: tickets enabled (auto-detect failed: ${err.message})`);
    return;
  }

  await startPolling("Tickets", poll, onUpdate, 3 * 60 * 1000);
}

async function poll() {
  const { cloudId, jiraSite, jql, mcpTool } = detected;

  try {
    const { stdout } = await execFileAsync(
      "mcpproxy",
      [
        "call", "tool-read",
        "-t", mcpTool,
        "-j", JSON.stringify({ cloudId, jql, fields: FIELDS }),
        "-o", "json",
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    const jsonStart = stdout.indexOf("{");
    if (jsonStart === -1) return;
    const raw = JSON.parse(stdout.slice(jsonStart));
    const textContent = raw?.content?.[0]?.text;
    if (!textContent) return;

    const issues = extractIssues(textContent);
    const result = groupByParent(issues, jiraSite);
    if (result.length > 0) data = result;
  } catch (err) {
    console.error("Tickets fetch error:", err.message);
  }
}

// --- Jira server detection ---

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
  // mcpproxy double-wraps MCP responses: outer JSON → text field with Go map[] → inner JSON → text with resources.
  // Peel each layer by JSON-parsing, then extracting the text field, repeating until we find the resources array.
  const resources = unwrapMcpResponse(stdout);
  if (!resources.length) throw new Error("No accessible Atlassian resources found");
  const site = resources[0];
  return { cloudId: site.id, jiraSite: site.url };
}

function unwrapMcpResponse(raw) {
  let text = raw;
  for (let i = 0; i < 5; i++) {
    // Try parsing as a JSON array of resources
    const arrayStart = text.indexOf("[{");
    if (arrayStart >= 0) {
      try {
        const arr = JSON.parse(text.slice(arrayStart));
        if (Array.isArray(arr) && arr[0]?.id) return arr;
      } catch { /* not a complete array at this level */ }
    }
    // Try parsing as a JSON object with content[0].text
    const jsonStart = text.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const obj = JSON.parse(text.slice(jsonStart));
        const inner = obj?.content?.[0]?.text;
        if (inner) { text = inner; continue; }
      } catch { /* not valid JSON, try extracting from Go map[] */ }
    }
    // Handle Go map[] serialization: map[text:{...} type:text]
    const mapMatch = text.match(/map\[text:(\{.+\})\s+type:text\]/s);
    if (mapMatch) { text = mapMatch[1]; continue; }
    break;
  }
  return [];
}

// --- Response parsing ---

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

function extractIssues(text) {
  const marker = '"text":"';
  let pos = text.indexOf(marker);
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

    const issues = [];
    let depth = 0;
    let objStart = -1;
    for (let k = arrayStart + 1; k < unescaped.length; k++) {
      const ch = unescaped[k];
      if (ch === '"') {
        k++;
        while (k < unescaped.length && unescaped[k] !== '"') {
          if (unescaped[k] === "\\") k++;
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
            issues.push(JSON.parse(unescaped.slice(objStart, k + 1)));
          } catch { /* partial object at truncation boundary */ }
          objStart = -1;
        }
      }
    }
    return issues;
  }
  return [];
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

const tab = {
  enabled: false,
  available: false,
  hint: null,
  get data() { return data; },
  init,
};

export default tab;
