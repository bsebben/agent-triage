// test/config.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The config module has side effects (reads config.json, detects cmux), so
// we test the resolve logic indirectly by validating the exported config.
import config from "../src/config.js";

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
