// src/config.js
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runMigrations, CURRENT_CONFIG_VERSION } from "./migrations.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const HOME = homedir();
const BACKUP_DIR = join(PROJECT_ROOT, "data", "config-backups");

const DEFAULTS = {
  port: 7777,
  defaultDirectory: "~/workspace",
  maxSessions: null,
  maxRecentGroups: 4,
  showRecentGroups: true,
  cmux: { binary: null, socket: null },
};

export const FIELD_META = {
  port:             { description: "<b>Requires restart.</b> HTTP port the dashboard listens on" },
  maxSessions:      { type: "number", nullable: true, description: "Caps how many concurrent Claude Code workspaces can be open" },
  maxRecentGroups: { type: "number", group: "recentGroups", description: "Maximum number of recently-used workspace groups to show when they have no active sessions" },
  showRecentGroups: { type: "boolean", group: "recentGroups", description: "Show recently-used workspace groups that have no active sessions" },
  defaultDirectory: { type: "string", nullable: true, description: "Working directory for new sessions (falls back to home directory if path doesn't exist)" },
  "cmux.binary":    { type: "string", nullable: true, description: "<b>Requires restart.</b> Path to the cmux CLI binary" },
  "cmux.socket":    { type: "string", nullable: true, description: "<b>Requires restart.</b> Unix socket for cmux RPC" },
  "tabs.loops.dataDir":    { type: "string", nullable: true, description: "Path to claude-loops plugin data" },
  "tabs.loops.installUrl": { type: "string", nullable: true, description: "URL shown when the plugin isn't installed" },
  "tabs.pulls.orgFilter":  { type: "string", nullable: true, description: "GitHub org to filter PRs by" },
  "tabs.tickets.excludeProjects":    { type: "string", nullable: true, description: "Comma-separated Jira project keys to hide (e.g. \"USPUDU, BBO\")" },
  "tabs.tickets.runlayerUserApiKey": { type: "string", nullable: true, description: "Runlayer user API key (or set RUNLAYER_USER_KEY env var). Required when not using mcpproxy." },
  "tabs.tickets.runlayerUrl":        { type: "string", nullable: true, description: "Runlayer Jira MCP endpoint URL — auto-detected from Claude Code MCP config if not set" },
  "tabs.tasks.maxAgeDays":      { type: "number", description: "Hide tasks older than this many days (0 = never expire)" },
  "tabs.tasks.expireBehavior":  { type: "string", enum: ["hide", "delete"], description: 'What to do with expired tasks: "hide" (filter from display) or "delete" (remove from disk)' },
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
      group: meta.group || "server",
      description: meta.description || "",
      ...(meta.nullable && { nullable: true }),
      ...(meta.enum && { enum: meta.enum }),
    };
  }

  for (const [key, value] of Object.entries(DEFAULTS.cmux)) {
    const path = `cmux.${key}`;
    const meta = FIELD_META[path] || {};
    schema[path] = {
      type: meta.type || inferType(value),
      default: value,
      group: "cmux",
      description: meta.description || "",
      ...(meta.nullable && { nullable: true }),
      ...(meta.enum && { enum: meta.enum }),
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
        description: meta.description || "",
        ...((meta.nullable || isNullDefault) && { nullable: true }),
        ...(meta.enum && { enum: meta.enum }),
      };
    }
  }

  return schema;
}

function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function getNestedValue(obj, dottedKey) {
  return dottedKey.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

const CONFIG_META_KEYS = new Set(["configVersion"]);

/**
 * Schema-aware validation. Returns a warnings array; never throws.
 * A non-empty result signals a missing or incomplete migration — in steady
 * state (migration ran, shape matches) this is always empty.
 */
export function validateConfig(raw, schema) {
  const warnings = [];
  const schemaKeys = new Set(Object.keys(schema));

  for (const key of flattenKeys(raw)) {
    if (CONFIG_META_KEYS.has(key)) continue;
    if (!schemaKeys.has(key)) {
      warnings.push({ key, message: `Unknown config key "${key}" — it will be ignored.` });
    }
  }

  for (const [key, entry] of Object.entries(schema)) {
    const value = getNestedValue(raw, key);
    if (value === undefined) continue;
    if (value === null) {
      if (!entry.nullable) {
        warnings.push({ key, message: `"${key}" must not be null.` });
      }
      continue;
    }
    if (entry.enum && !entry.enum.includes(value)) {
      warnings.push({ key, message: `"${key}" must be one of ${entry.enum.map((v) => `"${v}"`).join(", ")} (got "${value}").` });
    } else if (entry.type === "number" && typeof value !== "number") {
      warnings.push({ key, message: `"${key}" must be a number (got ${typeof value}).` });
    } else if (entry.type === "boolean" && typeof value !== "boolean") {
      warnings.push({ key, message: `"${key}" must be a boolean (got ${typeof value}).` });
    }
  }

  return warnings;
}

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return HOME;
  if (p.startsWith("~/")) return join(HOME, p.slice(2));
  return p;
}

function resolveDirectory(raw) {
  const expanded = expandHome(raw);
  if (expanded && existsSync(expanded)) return expanded;
  return HOME;
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

/**
 * Build the object to persist on a UI save. Overwrites/prunes all schema-known
 * keys from the form body, but carries `configVersion` through from the existing
 * file verbatim — it is owned by the migration runner, never asserted or dropped
 * by the UI (dropping it would re-trigger every migration on next load).
 */
export function mergeConfigForSave(body, existing) {
  const merged = { ...body };
  if (existing && "configVersion" in existing) {
    merged.configVersion = existing.configVersion;
  } else {
    delete merged.configVersion;
  }
  return merged;
}

function backupRawConfig(raw, fromVersion) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(BACKUP_DIR, `config-v${fromVersion}-${ts}.json`);
  writeFileSync(backupPath, JSON.stringify(raw, null, 2) + "\n");
  return backupPath;
}

/**
 * Load-time migration wrapper. Backs up + rewrites config.json when the
 * stored version is behind, and refuses to touch a config authored by a
 * newer app (downgrade safety valve). Returns { config, notice }.
 */
export function maybeMigrate(raw) {
  const current = raw.configVersion ?? 0;

  if (current > CURRENT_CONFIG_VERSION) {
    return {
      config: raw,
      notice: {
        key: "configVersion",
        message: `config.json is version ${current} but this app expects ${CURRENT_CONFIG_VERSION}. Skipping migration to avoid data loss — update the app or restore a compatible config.`,
      },
    };
  }

  if (current < CURRENT_CONFIG_VERSION) {
    const backupPath = backupRawConfig(raw, current);
    const migrated = runMigrations(raw, current);
    migrated.configVersion = CURRENT_CONFIG_VERSION;
    writeConfigFile(migrated);
    const message = `Migrated config v${current} → v${CURRENT_CONFIG_VERSION}; backup saved at ${backupPath}`;
    console.log(message);
    return { config: migrated, notice: null };
  }

  return { config: raw, notice: null };
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

  const maxRecentGroups = raw.maxRecentGroups ?? DEFAULTS.maxRecentGroups;
  const showRecentGroups = raw.showRecentGroups ?? DEFAULTS.showRecentGroups;

  const config = {
    port: raw.port ?? DEFAULTS.port,
    defaultDirectory: resolveDirectory(raw.defaultDirectory ?? DEFAULTS.defaultDirectory),
    maxSessions,
    maxRecentGroups,
    showRecentGroups,
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

// Tooling (snapshot generation, version-check) imports the schema helpers
// without a real config.json or cmux install; skip the boot resolve for them.
const skipBoot = process.env.AGENT_TRIAGE_NO_BOOT === "1";
const { config: migratedRaw, notice: migrationNotice } = skipBoot
  ? { config: {}, notice: null }
  : maybeMigrate(loadConfigFile());
const config = skipBoot ? {} : resolve(migratedRaw);
export default config;
export { HOME, PROJECT_ROOT, migratedRaw, migrationNotice };
