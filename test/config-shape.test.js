// test/config-shape.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CURRENT_CONFIG_VERSION } from "../src/migrations.js";
import { buildShape } from "../scripts/config-snapshot.mjs";

const ROOT = join(process.cwd());

function readJson(name) {
  return JSON.parse(readFileSync(join(ROOT, name), "utf-8"));
}

describe("config.shape.json snapshot", () => {
  it("matches the live schema (run `npm run config-snapshot` if this fails)", () => {
    const committed = readJson("config.shape.json");
    const live = buildShape();
    assert.deepEqual(committed, live);
  });

  it("records the current config version", () => {
    const committed = readJson("config.shape.json");
    assert.equal(committed.configVersion, CURRENT_CONFIG_VERSION);
  });

  it("keys are sorted", () => {
    const committed = readJson("config.shape.json");
    const keyNames = Object.keys(committed.keys);
    assert.deepEqual(keyNames, [...keyNames].sort());
  });

  it("fingerprints each key's type and validation surface", () => {
    const committed = readJson("config.shape.json");
    assert.equal(committed.keys.port.type, "number");
    assert.equal(committed.keys["maxSessions"].nullable, true);
    assert.deepEqual(committed.keys["tabs.tasks.expireBehavior"].enum, ["hide", "delete"]);
  });
});

describe("config.example.json", () => {
  it("configVersion equals CURRENT_CONFIG_VERSION", () => {
    const example = readJson("config.example.json");
    assert.equal(example.configVersion, CURRENT_CONFIG_VERSION);
  });
});
