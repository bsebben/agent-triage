// src/runlayer-mcp.js — Minimal MCP client for Runlayer Streamable HTTP servers
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { load as loadYaml } from "js-yaml";

const HOME = homedir();
const RUNLAYER_CONFIG_PATH = join(HOME, ".runlayer", "config.yaml");
const CLIENT_INFO = { name: "agent-triage", version: "1.0.0" };
const PROTOCOL_VERSION = "2025-06-18";

/**
 * Reads the Runlayer config from ~/.runlayer/config.yaml.
 *
 * @returns {{ defaultHost: string|null, hosts: Object }} The parsed config,
 *   or an empty structure if the file doesn't exist.
 */
export function readRunlayerConfig() {
  try {
    const raw = readFileSync(RUNLAYER_CONFIG_PATH, "utf-8");
    return loadYaml(raw) || {};
  } catch {
    return {};
  }
}

/**
 * Lightweight MCP client that speaks Streamable HTTP to a Runlayer proxy endpoint.
 *
 * Handles the initialize/initialized handshake and session management so callers
 * can just call `callTool(toolName, args)`.
 */
export class RunlayerMcpClient {
  /**
   * @param {string} url   Full Runlayer MCP endpoint URL
   *   (e.g. https://gusto.runlayer.com/api/v1/proxy/<uuid>/mcp)
   * @param {string} apiKey  User-level Runlayer API key for Bearer auth
   */
  constructor(url, apiKey) {
    this._url = url;
    this._apiKey = apiKey;
    this._sessionId = null;
    this._initialized = false;
    this._nextId = 1;
  }

  /**
   * Performs the MCP initialize + initialized handshake.
   *
   * Must be called before callTool(). Safe to call multiple times —
   * only the first call does network work.
   *
   * @returns {Object} The server's initialize result (capabilities, serverInfo, etc.)
   * @throws {Error} On network errors or non-200 responses
   */
  async initialize() {
    if (this._initialized) return;

    const result = await this._request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });

    // Send the `initialized` notification (no id → notification, no response expected)
    await this._notify("notifications/initialized", {});
    this._initialized = true;
    return result;
  }

  /**
   * Calls an MCP tool and returns the result.
   *
   * Auto-initializes the session if needed.
   *
   * @param {string} name  Tool name (e.g. "searchJiraIssuesUsingJql")
   * @param {Object} args  Tool arguments
   * @returns {Object} The tool result (typically { content: [{ type, text }] })
   */
  async callTool(name, args) {
    await this.initialize();
    return this._request("tools/call", { name, arguments: args });
  }

  /**
   * Lists available tools on the server.
   *
   * @returns {Object} The tools/list result
   */
  async listTools() {
    await this.initialize();
    return this._request("tools/list", {});
  }

  /**
   * Sends a JSON-RPC request (expects a response).
   *
   * @private
   */
  async _request(method, params) {
    const id = this._nextId++;
    const body = { jsonrpc: "2.0", id, method, params };
    const res = await this._post(body);

    const contentType = res.headers.get("content-type") || "";
    let data;

    if (contentType.includes("text/event-stream")) {
      data = await this._parseSseResponse(res, id);
    } else {
      data = await res.json();
    }

    if (data.error) {
      const msg = data.error.message || JSON.stringify(data.error);
      throw new Error(`MCP error (${method}): ${msg}`);
    }
    return data.result;
  }

  /**
   * Sends a JSON-RPC notification (fire-and-forget, no response expected).
   *
   * @private
   */
  async _notify(method, params) {
    const body = { jsonrpc: "2.0", method, params };
    await this._post(body);
  }

  /**
   * Makes the HTTP POST to the MCP endpoint with auth and session headers.
   *
   * @private
   */
  async _post(body) {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    };
    if (this._apiKey) {
      headers["Authorization"] = `Bearer ${this._apiKey}`;
    }
    if (this._sessionId) {
      headers["Mcp-Session-Id"] = this._sessionId;
    }

    const res = await fetch(this._url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    // Capture session ID from initialize response
    const sid = res.headers.get("mcp-session-id");
    if (sid) this._sessionId = sid;

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return res;
  }

  /**
   * Extracts the JSON-RPC response from an SSE stream.
   *
   * Runlayer may return tool results as SSE events. We read until we find
   * the response matching our request ID.
   *
   * @private
   */
  async _parseSseResponse(res, requestId) {
    const text = await res.text();
    const lines = text.split("\n");
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload);
        if (parsed.id === requestId) return parsed;
      } catch { /* skip malformed SSE data lines */ }
    }
    throw new Error("No matching response found in SSE stream");
  }
}
