// src/tickets.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import config from "./config.js";

const execFileAsync = promisify(execFile);
const JIRA_SITE = config.tickets.jiraSite;
const JQL = config.tickets.jql;
const MCP_TOOL = config.tickets.mcpTool;
const FIELDS = ["summary", "status", "issuetype", "parent"];

export async function getMyTickets() {
  if (!config.tickets.enabled) return [];

  try {
    const { stdout } = await execFileAsync(
      "mcpproxy",
      [
        "call", "tool-read",
        "-t", MCP_TOOL,
        "-j", JSON.stringify({ cloudId: config.tickets.cloudId, jql: JQL, fields: FIELDS }),
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
    return groupByParent(issues);
  } catch (err) {
    console.error("Tickets fetch error:", err.message);
    return [];
  }
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

function groupByParent(issues) {
  const groups = new Map();
  const standalone = [];

  for (const issue of issues) {
    const f = issue.fields;
    const ticket = {
      key: issue.key,
      summary: f.summary,
      status: f.status?.name || "Unknown",
      type: f.issuetype?.name || "Task",
      url: `${JIRA_SITE}/browse/${issue.key}`,
    };

    const parent = f.parent;
    if (parent) {
      const parentKey = parent.key;
      if (!groups.has(parentKey)) {
        groups.set(parentKey, {
          key: parentKey,
          summary: parent.fields?.summary || parentKey,
          type: parent.fields?.issuetype?.name || "Story",
          url: `${JIRA_SITE}/browse/${parentKey}`,
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
