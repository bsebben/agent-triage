// src/config.js
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const HOME = homedir();

const DEFAULTS = {
  port: 7777,
  cmux: { binary: null, socket: null },
  loops: {
    enabled: true,
    dataDir: null,
    installUrl: "https://silver-adventure-o3qwg53.pages.github.io/plugin.html?name=claude-loops",
  },
  tickets: { enabled: true },
  pulls: { enabled: true, orgFilter: null },
};

function merge(defaults, overrides) {
  const result = {};
  for (const key of Object.keys(defaults)) {
    const def = defaults[key];
    const val = overrides?.[key];
    if (def !== null && typeof def === "object" && !Array.isArray(def)) {
      result[key] = { ...def, ...val };
    } else {
      result[key] = val ?? def;
    }
  }
  return result;
}

function loadConfigFile() {
  const configPath = join(PROJECT_ROOT, "config.json");
  if (!existsSync(configPath)) {
    console.error("Missing config.json — copy config.example.json to config.json and edit it.");
    console.error("  cp config.example.json config.json");
    process.exit(1);
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function detectCmuxBinary() {
  try {
    return execFileSync("which", ["cmux"], { encoding: "utf-8" }).trim();
  } catch {
    const appBundle = "/Applications/cmux.app/Contents/Resources/bin/cmux";
    if (existsSync(appBundle)) return appBundle;
    return null;
  }
}

function detectCmuxSocket() {
  const sock = join(HOME, "Library", "Application Support", "cmux", "cmux.sock");
  return existsSync(sock) ? sock : null;
}

function detectLoopsDataDir() {
  const pluginsData = join(HOME, ".claude", "plugins", "data");
  if (!existsSync(pluginsData)) return null;
  const entries = readdirSync(pluginsData);
  const matches = entries.filter((e) => e.startsWith("claude-loops"));
  const withState = matches.find((e) => existsSync(join(pluginsData, e, "state")));
  const match = withState || matches[0];
  return match ? join(pluginsData, match) : null;
}

function resolve(raw) {
  const config = merge(DEFAULTS, raw);

  config.cmux.binary ??= detectCmuxBinary();
  config.cmux.socket ??= detectCmuxSocket();
  config.loops.dataDir ??= detectLoopsDataDir();

  if (!config.cmux.binary) {
    console.error("Could not find cmux. Set cmux.binary in config.json.");
    process.exit(1);
  }
  if (!config.cmux.socket) {
    console.error("Could not find cmux socket. Set cmux.socket in config.json.");
    process.exit(1);
  }

  console.log(`Config: cmux binary = ${config.cmux.binary}`);
  console.log(`Config: cmux socket = ${config.cmux.socket}`);

  return Object.freeze(config);
}

const config = resolve(loadConfigFile());
export default config;
export { HOME };
