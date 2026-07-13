// src/tabs/tickets.js — Tab module: Jira ticket integration
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startPolling } from "../utils.js";
import { RunlayerMcpClient } from "../runlayer-mcp.js";

const execFileAsync = promisify(execFile);
const DEFAULT_JQL = "assignee = currentUser() AND status != Done ORDER BY status ASC";
const FIELDS = ["summary", "status", "issuetype", "parent"];
const PAGE_LIMIT = 100;
const MCPPROXY_PAGE_SIZE = 3; // small enough to stay under mcpproxy's ~19KB truncation limit

export const defaults = {
  enabled: true,
  jql: null,
  runlayerUrl: null,
  runlayerApiKey: null,
};

// Shared detected state — transport-specific state lives inside each transport's closure
const detected = {
  cloudId: null,
  jiraSite: null,
  jql: DEFAULT_JQL,
  transport: null,
};

let resolvedCfg = { ...defaults };
let data = [];

// --- Init & Polling ---

async function init(tabConfig, onUpdate) {
  resolvedCfg = { ...defaults, ...tabConfig };
  tab.enabled = resolvedCfg.enabled;
  if (!tab.enabled) return;
  if (resolvedCfg.jql) detected.jql = resolvedCfg.jql;
  tab.refresh = await startPolling("Tickets", poll, onUpdate, 3 * 60 * 1000);
}

async function poll() {
  if (!detected.transport) {
    await detect();
    if (!detected.transport) throw new Error("Jira transport not available");
  }

  const { cloudId, jiraSite, jql } = detected;
  console.log(`[tickets] polling via ${detected.transport.name}`);

  try {
    const issues = await paginateIssues(cloudId, jql, detected.transport);
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

// --- Transport detection ---
// Tries each transport in order; first one that detects successfully wins.

async function detect() {
  const transports = [mcpproxyTransport, runlayerTransport];
  for (const t of transports) {
    const result = await t.detect(resolvedCfg);
    if (result) {
      detected.transport = t;
      detected.cloudId = result.cloudId;
      detected.jiraSite = result.jiraSite.replace(/\/$/, "");
      tab.available = true;
      tab.hint = null;
      return true;
    }
  }
  tab.hint = "No Jira transport available. Install mcpproxy or jira-cli, or configure runlayerUrl and runlayerApiKey in config.json tabs.tickets.";
  return false;
}

// --- Shared pagination ---
// Each transport implements searchIssues(cloudId, jql, fields, maxResults) => { issues, isLast }.
// This loop is transport-agnostic: cursor-based keyset pagination using ORDER BY key ASC.

function stripOrderBy(jql) {
  return jql.replace(/\s+ORDER\s+BY\s+.+$/i, "").trim();
}

async function paginateIssues(cloudId, jql, transport) {
  const baseJql = stripOrderBy(jql);
  const allIssues = [];
  let lastKey = null;
  const pageSize = transport.pageSize ?? 50;

  for (let page = 0; page < 20 && allIssues.length < PAGE_LIMIT; page++) {
    const pagedJql = lastKey
      ? `${baseJql} AND key > "${lastKey}" ORDER BY key ASC`
      : `${baseJql} ORDER BY key ASC`;
    const { issues, isLast } = await transport.searchIssues(cloudId, pagedJql, FIELDS, pageSize);
    allIssues.push(...issues);
    if (isLast || issues.length === 0) break;
    lastKey = issues[issues.length - 1].key;
  }
  return allIssues;
}

// --- mcpproxy transport ---
// Uses the mcpproxy CLI to proxy MCP calls to a locally-running Jira MCP server.
// Handles mcpproxy's Go map response format and ~19KB truncation limit.

const mcpproxyTransport = (() => {
  let mcpTool = null;

  return {
    name: "mcpproxy",
    pageSize: MCPPROXY_PAGE_SIZE,

    async detect(_cfg) {
      try {
        const server = await findMcpProxyJiraServer();
        if (!server) return null;
        const { cloudId, jiraSite } = await fetchCloudInfoViaMcpProxy(server.name);
        mcpTool = `${server.name}:searchJiraIssuesUsingJql`;
        console.log(`Config: tickets enabled via mcpproxy (${jiraSite})`);
        return { cloudId, jiraSite };
      } catch {
        return null;
      }
    },

    async searchIssues(cloudId, jql, fields, maxResults) {
      const { stdout } = await execFileAsync(
        "mcpproxy",
        ["call", "tool-read", "-t", mcpTool, "-j", JSON.stringify({ cloudId, jql, fields, maxResults }), "-o", "json"],
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      const jsonStart = stdout.indexOf("{");
      if (jsonStart === -1) return { issues: [], isLast: true };
      const raw = JSON.parse(stdout.slice(jsonStart));
      const textContent = raw?.content?.[0]?.text;
      if (!textContent) return { issues: [], isLast: true };
      return parseGoMapPage(textContent);
    },
  };
})();

async function findMcpProxyJiraServer() {
  const { stdout } = await execFileAsync("mcpproxy", ["upstream", "list", "--json"], { timeout: 5000 });
  const servers = JSON.parse(stdout);
  return servers.find((s) => /jira/i.test(s.name) && s.health?.level === "healthy");
}

async function fetchCloudInfoViaMcpProxy(serverName) {
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
      return { cloudId: resources[0].id, jiraSite: resources[0].url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

// --- Runlayer transport ---
// HTTP-based MCP client. Requires explicit runlayerUrl + runlayerApiKey config.

const runlayerTransport = (() => {
  let client = null;

  return {
    name: "runlayer",
    pageSize: 100,

    async detect(cfg) {
      const url = cfg.runlayerUrl;
      const apiKey = cfg.runlayerApiKey || process.env.RUNLAYER_USER_KEY;

      if (!url) return null;
      if (!apiKey) {
        tab.hint = "Runlayer URL configured but no API key found. Set runlayerApiKey in config.json tabs.tickets, or set RUNLAYER_USER_KEY env var.";
        return null;
      }

      try {
        client = new RunlayerMcpClient(url, apiKey);
        await client.initialize();
        const { cloudId, jiraSite } = await fetchCloudInfoViaRunlayer(client);
        console.log(`Config: tickets enabled via Runlayer (${jiraSite})`);
        return { cloudId, jiraSite };
      } catch (err) {
        tab.hint = `Runlayer Jira connection failed: ${friendlyError(err.message)}`;
        return null;
      }
    },

    async searchIssues(cloudId, jql, fields, maxResults) {
      const result = await client.callTool("searchJiraIssuesUsingJql", { cloudId, jql, fields, maxResults });
      const textContent = result?.content?.[0]?.text;
      if (!textContent) return { issues: [], isLast: true };
      try {
        const parsed = JSON.parse(textContent);
        const issues = parsed.issues || [];
        // Derive isLast from explicit field or standard Jira pagination fields (total/startAt/maxResults)
        const isLast = parsed.isLast !== undefined
          ? parsed.isLast !== false
          : (parsed.startAt ?? 0) + issues.length >= (parsed.total ?? issues.length);
        return { issues, isLast };
      } catch {
        return { issues: extractIssuesFromCleanJson(textContent), isLast: true };
      }
    },
  };
})();

async function fetchCloudInfoViaRunlayer(rl) {
  const result = await rl.callTool("getAccessibleAtlassianResources", {});
  const textContent = result?.content?.[0]?.text;
  if (!textContent) throw new Error("Empty response from getAccessibleAtlassianResources");
  const resources = JSON.parse(textContent);
  if (!Array.isArray(resources) || !resources.length) throw new Error("No accessible Atlassian resources found");
  return { cloudId: resources[0].id, jiraSite: resources[0].url };
}

// --- Shared helpers ---

function isTransportError(msg) {
  return msg.includes("ENOENT") || msg.includes("ECONNREFUSED")
    || msg.includes("HTTP 401") || msg.includes("HTTP 403");
}

function friendlyError(raw) {
  if (raw.includes("rate limit")) return "Rate limited — will retry on next poll.";
  if (raw.includes("ENOENT")) return "Jira transport not found. Make sure mcpproxy or jira-cli is installed and in your PATH.";
  if (raw.includes("timeout") || raw.includes("ETIMEDOUT")) return "Connection timed out. Check that your Jira transport is running.";
  if (raw.includes("not found")) return "Jira tools not available on this MCP server.";
  if (raw.includes("HTTP 401")) return "Authentication failed. Check your Runlayer API key.";
  if (raw.includes("HTTP 403")) return "Access denied. Make sure you're using a user API key, not an org key.";
  return "Check that your Jira transport is authenticated and running.";
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

  const result = [...groups.values()];
  if (standalone.length > 0) {
    result.push({ key: null, summary: "Standalone", type: null, url: null, tickets: standalone });
  }
  return result;
}

// --- mcpproxy response parsing ---
// mcpproxy double-wraps MCP responses with Go map[] serialization.

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

function parseGoMapPage(text) {
  const TRUNCATION_MARKER = "... [truncated by mcpproxy]";
  const truncIdx = text.indexOf(TRUNCATION_MARKER);
  const wasTruncated = truncIdx !== -1;
  const safeText = wasTruncated ? text.slice(0, truncIdx) : text;

  const goMapPos = safeText.indexOf("text:{");
  if (goMapPos !== -1) {
    const jsonStart = goMapPos + 5;
    const lastBrace = safeText.lastIndexOf("}");
    if (lastBrace > jsonStart) {
      try {
        const parsed = JSON.parse(safeText.slice(jsonStart, lastBrace + 1));
        if (parsed.issues) {
          const isLast = wasTruncated ? false : parsed.isLast !== false;
          return { issues: parsed.issues, isLast };
        }
      } catch { /* fall through */ }
    }
  }
  const issues = parseGoMapIssues(safeText);
  return { issues, isLast: !wasTruncated };
}

function parseGoMapIssues(text) {
  const goMapPos = text.indexOf("text:{");
  if (goMapPos !== -1) {
    const jsonStart = goMapPos + 5;
    const lastBrace = text.lastIndexOf("}");
    if (lastBrace > jsonStart) {
      try {
        const parsed = JSON.parse(text.slice(jsonStart, lastBrace + 1));
        if (parsed.issues) return parsed.issues;
      } catch { /* fall through to legacy parsers */ }
    }
  }

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
