// src/loops.js — Tab module: Claude Loops integration
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import config from "../config.js";

const DATA_DIR = config.loops.dataDir;
const CONFIG_PATH = DATA_DIR ? join(DATA_DIR, "config.yml") : null;
const STATE_DIR = DATA_DIR ? join(DATA_DIR, "state") : null;

const tab = {
  enabled: config.loops.enabled,
  available: !!DATA_DIR,
  hint: DATA_DIR ? null : "Claude Loops plugin not found.",
  installUrl: config.loops.installUrl,
  get data() { return data; },
  init,
};

let data = [];

async function poll() {
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

  data = loops;
}

async function init(onUpdate) {
  console.log(`Config: loops ${tab.enabled ? "enabled" : "disabled"}${DATA_DIR ? ` (${DATA_DIR})` : " (plugin not found)"}`);
  if (!tab.enabled || !tab.available) return;

  const doPoll = async () => {
    try { await poll(); onUpdate(); }
    catch (err) { console.error("Loops poll error:", err.message); }
  };
  await doPoll();
  setInterval(doPoll, 5 * 60 * 1000);
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

export default tab;
