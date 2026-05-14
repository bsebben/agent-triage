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

export const FIELD_META = {
  port:             { description: "Dashboard port" },
  maxSessions:      { type: "number", nullable: true, description: "Max concurrent workspaces (null = unlimited)" },
  defaultDirectory: { type: "string", nullable: true, description: "Default working directory (null = home)" },
  "cmux.binary":    { type: "string", nullable: true, description: "cmux binary path (null = auto-detect)" },
  "cmux.socket":    { type: "string", nullable: true, description: "cmux socket path (null = auto-detect)" },
};

function inferType(value) {
  if (value === null || value === undefined) return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return "string";
}

export function buildSchema(tabDefaults) {
  const schema = {};

  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (key === "cmux" || key === "tabs") continue;
    const meta = FIELD_META[key] || {};
    schema[key] = {
      type: meta.type || inferType(value),
      default: value,
      group: "server",
      description: meta.description || key,
      ...(meta.nullable && { nullable: true }),
    };
  }

  for (const [key, value] of Object.entries(DEFAULTS.cmux)) {
    const path = `cmux.${key}`;
    const meta = FIELD_META[path] || {};
    schema[path] = {
      type: meta.type || inferType(value),
      default: value,
      group: "cmux",
      description: meta.description || key,
      ...(meta.nullable && { nullable: true }),
    };
  }

  for (const [tabName, defaults] of Object.entries(tabDefaults)) {
    for (const [key, value] of Object.entries(defaults)) {
      const path = `tabs.${tabName}.${key}`;
      const meta = FIELD_META[path] || {};
      const isNullDefault = value === null;
      schema[path] = {
        type: meta.type || (isNullDefault ? "string" : inferType(value)),
        default: value,
        group: `tabs.${tabName}`,
        description: meta.description || key,
        ...((meta.nullable || isNullDefault) && { nullable: true }),
      };
    }
  }

  return schema;
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return join(HOME, p.slice(2));
  return p;
}

export function loadRawConfig() {
  const configPath = join(PROJECT_ROOT, "config.json");
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

export function writeConfigFile(configObj) {
  const configPath = join(PROJECT_ROOT, "config.json");
  writeFileSync(configPath, JSON.stringify(configObj, null, 2) + "\n");
}

function loadConfigFile() {
  const configPath = join(PROJECT_ROOT, "config.json");
  if (!existsSync(configPath)) {
    console.error("Missing config.json — copy config.example.json to config.json and edit it.");
    console.error("  cp config.example.json config.json");
    process.exit(1);
  }
  return loadRawConfig();
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
