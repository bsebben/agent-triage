#!/usr/bin/env node
//
// config-snapshot.mjs — regenerate config.shape.json from the live schema.
//
// The snapshot is a checked-in fingerprint of the config shape (sorted schema
// keys + current version), mirroring Rails' schema.rb. version-check.sh compares
// the live shape against it to gate config-shape changes behind a migration.
//
// Usage:
//   node scripts/config-snapshot.mjs           write config.shape.json
//   node scripts/config-snapshot.mjs --print   print the shape without writing

// Must be set before config.js is imported so its boot resolve is skipped —
// tooling has no real config.json or cmux install. Dynamic imports below run
// after this assignment (static imports would hoist ahead of it).
process.env.AGENT_TRIAGE_NO_BOOT = "1";

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const { buildConfigSchema } = await import("../src/config-schema.js");
const { CURRENT_CONFIG_VERSION } = await import("../src/migrations.js");

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SHAPE_PATH = join(__dirname, "..", "config.shape.json");

// Fingerprint each key's validation surface (type, enum, nullable), not just
// its name — a retype or enum change alters the schema without touching the key
// set, and the gate promises to catch exactly those.
export function buildShape() {
  const schema = buildConfigSchema();
  const keys = {};
  for (const key of Object.keys(schema).sort()) {
    const entry = schema[key];
    keys[key] = {
      type: entry.type,
      ...(entry.nullable && { nullable: true }),
      ...(entry.enum && { enum: entry.enum }),
    };
  }
  return { configVersion: CURRENT_CONFIG_VERSION, keys };
}

// Run the write/print only when invoked as a script, not when imported (tests
// import buildShape to compare against the committed snapshot).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const shape = buildShape();
  const serialized = JSON.stringify(shape, null, 2) + "\n";
  if (process.argv.includes("--print")) {
    process.stdout.write(serialized);
  } else {
    writeFileSync(SHAPE_PATH, serialized);
    console.log(`Wrote ${SHAPE_PATH} (configVersion ${shape.configVersion}, ${Object.keys(shape.keys).length} keys)`);
  }
}
