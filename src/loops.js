// src/loops.js — Tab module for Claude Loops integration
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import config from "./config.js";

const DATA_DIR = config.loops.dataDir;
const CONFIG_PATH = DATA_DIR ? join(DATA_DIR, "config.yml") : null;
const STATE_DIR = DATA_DIR ? join(DATA_DIR, "state") : null;

export const status = {
  enabled: config.loops.enabled,
  available: !!DATA_DIR,
  hint: DATA_DIR ? null : "Claude Loops plugin not found.",
  installUrl: config.loops.installUrl,
};

export const pollInterval = 5 * 60 * 1000;

export async function init() {
  console.log(`Config: loops ${status.enabled ? "enabled" : "disabled"}${DATA_DIR ? ` (${DATA_DIR})` : " (plugin not found)"}`);
}

export async function poll() {
  const loopConfig = await loadConfig();
  const loops = [];

  for (const loop of loopConfig.loops || []) {
    const state = await loadState(loop.name);
    const schedule = loop.interval || loop.schedule || "—";
    const enabled = loop.enabled !== false;

    loops.push({
      name: loop.name,
      schedule,
      enabled,
      loopState: enabled ? (state?.loop || "unknown") : "disabled",
      session: state?.session || "—",
      lastRun: state?.last_run || null,
      runs: state?.runs || 0,
      lastRunAgo: state?.last_run ? timeAgo(state.last_run) : "—",
    });
  }

  return loops;
}

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return yaml.load(raw) || {};
  } catch {
    return {};
  }
}

async function loadState(name) {
  try {
    const raw = await readFile(join(STATE_DIR, `${name}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function timeAgo(isoString) {
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
