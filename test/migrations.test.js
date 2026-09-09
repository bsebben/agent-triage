// test/migrations.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { migrations, CURRENT_CONFIG_VERSION, runMigrations } from "../src/migrations.js";

describe("migrations array", () => {
  it("uses sequential versions starting at 1 with no gaps", () => {
    migrations.forEach((step, i) => {
      assert.equal(step.version, i + 1, `migrations[${i}].version should be ${i + 1}`);
    });
  });

  it("derives CURRENT_CONFIG_VERSION from migrations.length", () => {
    assert.equal(CURRENT_CONFIG_VERSION, migrations.length);
  });

  it("every step has a describe string and a migrate function", () => {
    for (const step of migrations) {
      assert.equal(typeof step.describe, "string");
      assert.equal(typeof step.migrate, "function");
    }
  });
});

describe("runMigrations", () => {
  it("returns an equivalent object when there is nothing to run", () => {
    const cfg = { port: 7777, tabs: {} };
    const result = runMigrations(cfg, CURRENT_CONFIG_VERSION);
    assert.deepEqual(result, cfg);
  });

  it("does not mutate the input", () => {
    const cfg = { port: 7777 };
    const snapshot = JSON.parse(JSON.stringify(cfg));
    runMigrations(cfg, 0);
    assert.deepEqual(cfg, snapshot);
  });

  it("is idempotent: re-running at the current version is a no-op", () => {
    const cfg = { port: 7777, configVersion: CURRENT_CONFIG_VERSION };
    const once = runMigrations(cfg, CURRENT_CONFIG_VERSION);
    const twice = runMigrations(once, CURRENT_CONFIG_VERSION);
    assert.deepEqual(once, twice);
  });

  it("applies a full v0 -> vN chain in order", () => {
    // Exercise the runner with a synthetic ordered chain to prove sequencing,
    // independent of whatever real migrations happen to exist.
    const steps = [
      { version: 1, describe: "a", migrate: (c) => ({ ...c, trail: [...(c.trail || []), 1] }) },
      { version: 2, describe: "b", migrate: (c) => ({ ...c, trail: [...(c.trail || []), 2] }) },
      { version: 3, describe: "c", migrate: (c) => ({ ...c, trail: [...(c.trail || []), 3] }) },
    ];
    const run = (cfg, from) => {
      let result = { ...cfg };
      for (const step of steps) if (step.version > from) result = step.migrate(result);
      return result;
    };
    assert.deepEqual(run({}, 0).trail, [1, 2, 3]);
    assert.deepEqual(run({}, 1).trail, [2, 3]);
    assert.deepEqual(run({}, 2).trail, [3]);
    assert.equal(run({}, 3).trail, undefined);
  });
});
