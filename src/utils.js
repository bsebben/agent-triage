// src/utils.js — Shared utilities
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
};

export function startPolling(name, pollFn, onUpdate, intervalMs) {
  const doPoll = async () => {
    try { await pollFn(); onUpdate(); }
    catch (err) { console.error(`[${name.toLowerCase()}] poll error: ${err.message.split("\n")[0]}`); }
  };
  doPoll();
  setInterval(doPoll, intervalMs);
  return async () => { await pollFn(); onUpdate(); };
}

export function timeAgo(isoString) {
  const ms = Date.now() - new Date(isoString).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

export async function serveStatic(res, filePath) {
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

export function jsonResponse(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
