// test/config-validation.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildSchema, validateConfig } from "../src/config.js";

const tabDefaults = {
  tasks: { enabled: false, maxAgeDays: 0, expireBehavior: "hide" },
};

describe("validateConfig", () => {
  const schema = buildSchema(tabDefaults);

  it("returns zero warnings for a clean, in-shape config", () => {
    const raw = {
      configVersion: 0,
      port: 7777,
      maxSessions: null,
      tabs: { tasks: { enabled: true, maxAgeDays: 30, expireBehavior: "delete" } },
    };
    assert.deepEqual(validateConfig(raw, schema), []);
  });

  it("warns about an unknown top-level key", () => {
    const warnings = validateConfig({ port: 7777, bogusKey: 1 }, schema);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].key, "bogusKey");
  });

  it("warns about an unknown nested key", () => {
    const warnings = validateConfig({ tabs: { tasks: { nope: true } } }, schema);
    assert.ok(warnings.some((w) => w.key === "tabs.tasks.nope"));
  });

  it("warns about an invalid enum value without throwing", () => {
    let warnings;
    assert.doesNotThrow(() => {
      warnings = validateConfig(
        { tabs: { tasks: { expireBehavior: "explode" } } },
        schema,
      );
    });
    assert.ok(warnings.some((w) => w.key === "tabs.tasks.expireBehavior"));
  });

  it("accepts a valid enum value", () => {
    const warnings = validateConfig(
      { tabs: { tasks: { expireBehavior: "delete" } } },
      schema,
    );
    assert.deepEqual(warnings, []);
  });

  it("does not warn about the configVersion meta key", () => {
    const warnings = validateConfig({ configVersion: 3 }, schema);
    assert.deepEqual(warnings, []);
  });

  it("warns about a type mismatch", () => {
    const warnings = validateConfig({ port: "seven" }, schema);
    assert.ok(warnings.some((w) => w.key === "port"));
  });

  it("never throws", () => {
    assert.doesNotThrow(() => validateConfig({}, schema));
    assert.doesNotThrow(() => validateConfig({ tabs: {} }, schema));
  });
});
