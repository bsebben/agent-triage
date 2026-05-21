// src/plugins.js — Claude Code plugin config discovery and management
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { HOME } from "./config.js";

const PLUGINS_DIR = join(HOME, ".claude", "plugins");
const INSTALLED_PATH = join(PLUGINS_DIR, "installed_plugins.json");
const DATA_DIR = join(PLUGINS_DIR, "data");

let cache = null;

function parsePluginId(key) {
  const at = key.lastIndexOf("@");
  if (at <= 0) return { name: key, marketplace: null };
  return { name: key.slice(0, at), marketplace: key.slice(at + 1) };
}

function dataDir(name, marketplace) {
  if (marketplace) return join(DATA_DIR, `${name}-${marketplace}`);
  return join(DATA_DIR, name);
}

function findOverridePath(name, marketplace) {
  const withMarketplace = join(dataDir(name, marketplace), "config.json");
  if (existsSync(withMarketplace)) return withMarketplace;
  const withoutMarketplace = join(dataDir(name, null), "config.json");
  if (existsSync(withoutMarketplace)) return withoutMarketplace;
  return null;
}

function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

export function discover() {
  if (!existsSync(INSTALLED_PATH)) return [];

  const installed = readJsonSafe(INSTALLED_PATH);
  if (!installed?.plugins) return [];

  const results = [];
  for (const [key, entries] of Object.entries(installed.plugins)) {
    const { name, marketplace } = parsePluginId(key);
    const entry = entries[0];
    if (!entry?.installPath) continue;

    const bundledPath = join(entry.installPath, "config.json");
    const hasBundled = existsSync(bundledPath);
    const overridePath = findOverridePath(name, marketplace);
    const hasOverride = overridePath !== null;

    if (!hasBundled && !hasOverride) continue;

    const hasConfigDoc = existsSync(join(entry.installPath, "CONFIG.md"));

    results.push({
      id: key,
      name,
      marketplace,
      version: entry.version || null,
      hasOverride,
      hasConfigDoc,
      configPath: overridePath || (marketplace
        ? join(dataDir(name, marketplace), "config.json")
        : join(dataDir(name, null), "config.json")),
      bundledPath: hasBundled ? bundledPath : null,
    });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  cache = results;
  return results;
}

export function list(refresh) {
  if (refresh || !cache) return discover();
  return cache;
}

function findPlugin(id) {
  const plugins = list(false);
  return plugins.find((p) => p.id === id) || null;
}

export function getConfig(id) {
  const plugin = findPlugin(id);
  if (!plugin) return null;

  const bundled = plugin.bundledPath ? readJsonSafe(plugin.bundledPath) : null;
  const override = plugin.hasOverride ? readJsonSafe(plugin.configPath) : null;
  const resolved = override || bundled;

  return { bundled, override, resolved, configDocUrl: null };
}

export function writeConfig(id, configObj) {
  const plugin = findPlugin(id);
  if (!plugin) throw new Error(`Plugin not found: ${id}`);

  const dir = join(plugin.configPath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(plugin.configPath, JSON.stringify(configObj, null, 2) + "\n");

  plugin.hasOverride = true;
}

export function deleteConfig(id) {
  const plugin = findPlugin(id);
  if (!plugin) throw new Error(`Plugin not found: ${id}`);

  if (plugin.hasOverride && existsSync(plugin.configPath)) {
    unlinkSync(plugin.configPath);
    plugin.hasOverride = false;
  }
}
