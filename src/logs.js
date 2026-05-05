// src/logs.js — Captures console output into a ring buffer and streams to WebSocket clients
const MAX_LINES = 500;
const lines = [];
let broadcastFn = null;

export function initLogs(broadcast) {
  broadcastFn = broadcast;

  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;

  console.log = (...args) => {
    origLog.apply(console, args);
    push("info", args.join(" "));
  };

  console.error = (...args) => {
    origError.apply(console, args);
    push("error", args.join(" "));
  };

  console.warn = (...args) => {
    origWarn.apply(console, args);
    push("warn", args.join(" "));
  };
}

function push(level, text) {
  const entry = { ts: Date.now(), level, text };
  lines.push(entry);
  if (lines.length > MAX_LINES) lines.shift();
  if (broadcastFn) {
    broadcastFn(JSON.stringify({ type: "log", entry }));
  }
}

export function getLines() {
  return lines;
}
