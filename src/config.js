// src/config.js
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const HOME = homedir();

const DEFAULTS = {
  port: 7777,
  defaultDirectory: null,
  maxSessions: null,
  cmux: { binary: null, socket: null },
};

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return join(HOME, p.slice(2));
  return p;
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

function resolve(raw) {
  const maxSessions = raw.maxSessions ?? DEFAULTS.maxSessions;
  if (maxSessions !== null && (!Number.isInteger(maxSessions) || maxSessions < 1)) {
    console.error("maxSessions must be a positive integer or null.");
    process.exit(1);
  }

  const config = {
    port: raw.port ?? DEFAULTS.port,
    defaultDirectory: expandHome(raw.defaultDirectory) || HOME,
    maxSessions,
    cmux: { ...DEFAULTS.cmux, ...raw.cmux },
    tabs: raw.tabs || {},
  };

  config.cmux.binary ??= detectCmuxBinary();
  config.cmux.socket ??= detectCmuxSocket();

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

  return config;
}

function updateConfigFile(key, value) {
  const configPath = join(PROJECT_ROOT, "config.json");
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  raw[key] = value;
  writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n");
}

const config = resolve(loadConfigFile());
export default config;
export { HOME, PROJECT_ROOT, updateConfigFile };
