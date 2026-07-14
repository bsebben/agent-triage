// test/config-save.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mergeConfigForSave } from "../src/config.js";

describe("mergeConfigForSave", () => {
  it("carries the existing configVersion through verbatim", () => {
    const body = { port: 7777, maxSessions: null };
    const existing = { port: 8888, configVersion: 3 };
    const saved = mergeConfigForSave(body, existing);
    assert.equal(saved.configVersion, 3);
  });

  it("prunes any key not present in the form body (overwrite semantics)", () => {
    const body = { port: 7777 };
    const existing = { port: 8888, orphanedKey: "cruft", configVersion: 2 };
    const saved = mergeConfigForSave(body, existing);
    assert.equal("orphanedKey" in saved, false);
    assert.equal(saved.port, 7777);
    assert.equal(saved.configVersion, 2);
  });

  it("does not add configVersion when the existing file lacks it", () => {
    const saved = mergeConfigForSave({ port: 7777 }, { port: 8888 });
    assert.equal("configVersion" in saved, false);
  });

  it("never lets the UI body assert its own configVersion", () => {
    const body = { port: 7777, configVersion: 999 };
    const saved = mergeConfigForSave(body, { configVersion: 1 });
    assert.equal(saved.configVersion, 1);
  });
});
