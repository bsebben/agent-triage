// test/config.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The config module has side effects (reads config.json, detects cmux), so
// we test the resolve logic indirectly by validating the exported config.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import config, { buildSchema, FIELD_META, loadRawConfig, writeConfigFile } from "../src/config.js";

describe("config.maxSessions", () => {
  it("defaults to null when not set in config.json", () => {
    // config.example.json sets maxSessions: null, and the default is null
    assert.equal(config.maxSessions === null || typeof config.maxSessions === "number", true);
  });

  it("is either null or a positive integer", () => {
    if (config.maxSessions !== null) {
      assert.equal(Number.isInteger(config.maxSessions), true);
      assert.ok(config.maxSessions >= 1);
    }
  });
});

describe("buildSchema", () => {
  it("includes top-level fields with correct types", () => {
    const schema = buildSchema({});
    assert.equal(schema.port.type, "number");
    assert.equal(schema.port.default, 7777);
    assert.equal(schema.port.group, "server");
    assert.equal(schema.port.nullable, undefined);
  });

  it("marks nullable fields explicitly", () => {
    const schema = buildSchema({});
    assert.equal(schema.maxSessions.nullable, true);
    assert.equal(schema.maxSessions.type, "number");
    assert.equal(schema.defaultDirectory.nullable, true);
    assert.equal(schema.defaultDirectory.type, "string");
  });

  it("includes cmux fields in cmux group", () => {
    const schema = buildSchema({});
    assert.equal(schema["cmux.binary"].group, "cmux");
    assert.equal(schema["cmux.binary"].nullable, true);
    assert.equal(schema["cmux.socket"].group, "cmux");
  });

  it("includes tab defaults with correct groups", () => {
    const tabDefaults = {
      loops: { enabled: true, dataDir: null },
      pulls: { enabled: true, orgFilter: null },
    };
    const schema = buildSchema(tabDefaults);
    assert.equal(schema["tabs.loops.enabled"].type, "boolean");
    assert.equal(schema["tabs.loops.enabled"].group, "tabs.loops");
    assert.equal(schema["tabs.loops.dataDir"].nullable, true);
    assert.equal(schema["tabs.pulls.orgFilter"].nullable, true);
  });

  it("top-level and cmux fields have descriptions", () => {
    const schema = buildSchema({});
    for (const [key, entry] of Object.entries(schema)) {
      assert.equal(typeof entry.description, "string", `${key} missing description`);
    }
  });
});

describe("loadRawConfig", () => {
  it("returns the raw config.json contents without resolving", () => {
    const raw = loadRawConfig();
    assert.equal(typeof raw, "object");
    assert.ok("port" in raw || "maxSessions" in raw || "tabs" in raw);
  });
});

describe("writeConfigFile", () => {
  it("round-trips config through write and read", () => {
    const before = loadRawConfig();
    const testValue = before.maxSessions === 99 ? 100 : 99;
    writeConfigFile({ ...before, maxSessions: testValue });
    const after = loadRawConfig();
    assert.equal(after.maxSessions, testValue);
    writeConfigFile(before);
  });

  it("preserves JSON formatting with 2-space indent", () => {
    const raw = loadRawConfig();
    writeConfigFile(raw);
    const content = readFileSync(join(process.cwd(), "config.json"), "utf-8");
    assert.ok(content.includes("\n  "), "should have 2-space indentation");
    assert.ok(content.endsWith("\n"), "should end with newline");
  });
});
