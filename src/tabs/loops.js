// src/tabs/loops.js — Tab module: Claude Loops integration
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import yaml from "js-yaml";
import { startPolling } from "../utils.js";

export const defaults = {
  enabled: true,
  dataDir: null,
  installUrl: "https://silver-adventure-o3qwg53.pages.github.io/plugin.html?name=claude-loops",
};

function detectDataDir() {
  const pluginsData = join(homedir(), ".claude", "plugins", "data");
  if (!existsSync(pluginsData)) return null;
  const entries = readdirSync(pluginsData);
  const matches = entries.filter((e) => e.startsWith("claude-loops"));
  const withState = matches.find((e) => existsSync(join(pluginsData, e, "state")));
  const match = withState || matches[0];
  return match ? join(pluginsData, match) : null;
}

let cfg;
let data = [];

async function init(tabConfig, onUpdate) {
  cfg = { ...defaults, ...tabConfig };
  cfg.dataDir ??= detectDataDir();
  const dataDir = cfg.dataDir;

  tab.enabled = cfg.enabled;
  tab.available = !!dataDir;
  tab.hint = dataDir ? null : "Claude Loops plugin not found.";
  tab.installUrl = cfg.installUrl;

  console.log(`Config: loops ${cfg.enabled ? "enabled" : "disabled"}${dataDir ? ` (${dataDir})` : " (plugin not found)"}`);
  if (!cfg.enabled || !dataDir) return;

  await startPolling("Loops", poll, onUpdate, 5 * 60 * 1000);
}

async function poll() {
  const dataDir = cfg.dataDir;
  const configPath = join(dataDir, "config.yml");
  const stateDir = join(dataDir, "state");

  const loopConfig = await loadYaml(configPath);
  const loops = [];

  for (const loop of loopConfig.loops || []) {
    const state = await loadState(stateDir, loop.name);
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

async function loadYaml(path) {
  try {
    const raw = await readFile(path, "utf-8");
    return yaml.load(raw) || {};
  } catch {
    return {};
  }
}

async function loadState(stateDir, name) {
  try {
    const raw = await readFile(join(stateDir, `${name}.json`), "utf-8");
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

const tab = {
  enabled: false,
  available: false,
  hint: null,
  installUrl: null,
  get data() { return data; },
  init,
};

export default tab;
