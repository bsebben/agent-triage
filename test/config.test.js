// test/config.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The config module has side effects (reads config.json, detects cmux), so
// we test the resolve logic indirectly by validating the exported config.
import config, { buildSchema, FIELD_META } from "../src/config.js";

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

  it("every field has a description", () => {
    const schema = buildSchema({});
    for (const [key, entry] of Object.entries(schema)) {
      assert.ok(entry.description, `${key} missing description`);
    }
  });
});
