// src/tickets.js — Tab module for Jira ticket integration
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import config from "./config.js";

const execFileAsync = promisify(execFile);
const DEFAULT_JQL = "assignee = currentUser() AND status != Done ORDER BY status ASC";
const FIELDS = ["summary", "status", "issuetype", "parent"];

export const status = {
  enabled: config.tickets.enabled,
  available: false,
  hint: null,
};

const detected = {
  cloudId: null,
  jiraSite: null,
  jql: DEFAULT_JQL,
  mcpTool: null,
};

export const pollInterval = 3 * 60 * 1000;

export async function init() {
  if (!status.enabled) return;

  try {
    const server = await detectJiraServer();
    if (!server) {
      status.hint = "No Jira server found. Make sure your Jira MCP server is authenticated and running.";
      console.log("Config: tickets enabled (no Jira server found)");
      return;
    }

    const { cloudId, jiraSite } = await detectCloudInfo(server.name);
    status.available = true;
    detected.cloudId = cloudId;
    detected.jiraSite = jiraSite.replace(/\/$/, "");
    detected.mcpTool = `${server.name}:searchJiraIssuesUsingJql`;
    console.log(`Config: tickets enabled (${detected.jiraSite})`);
  } catch (err) {
    status.hint = `Jira auto-detection failed: ${err.message}`;
    console.log(`Config: tickets enabled (auto-detect failed: ${err.message})`);
  }
}

export async function poll() {
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
    if (jsonStart === -1) return [];
    const raw = JSON.parse(stdout.slice(jsonStart));
    const textContent = raw?.content?.[0]?.text;
    if (!textContent) return [];

    const issues = extractIssues(textContent);
    return groupByParent(issues, jiraSite);
  } catch (err) {
    console.error("Tickets fetch error:", err.message);
    return [];
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
