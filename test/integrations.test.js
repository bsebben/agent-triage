// test/integrations.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { status, enable, disable, isDecided, dismiss } from "../src/integrations.js";

function makeExec(impl) {
  const calls = [];
  const fn = (cmd, args, cb) => {
    calls.push([cmd, ...args]);
    impl(cmd, args, cb);
  };
  fn.calls = calls;
  return fn;
}

const ok = (cb) => cb(null, { stdout: "", stderr: "" });
const fail = (cb, message = "exit 1") => cb(Object.assign(new Error(message), { code: 1 }));

// In-memory stand-in for config.js's loadRawConfig/writeConfigFile, so these
// tests never touch the real config.json.
function makeConfigIO(initial = {}) {
  let raw = { ...initial };
  return {
    load: () => raw,
    save: (next) => { raw = next; },
    get raw() { return raw; },
  };
}

describe("integrations: worktree-hook", () => {
  it("status() is true when --check exits 0", async () => {
    const execFileFn = makeExec((cmd, args, cb) => ok(cb));
    assert.equal(await status("worktree-hook", { execFileFn }), true);
    assert.match(execFileFn.calls[0][0], /install-worktree-hook\.sh$/);
    assert.deepEqual(execFileFn.calls[0].slice(1), ["--check"]);
  });

  it("status() is false when --check exits non-zero", async () => {
    const execFileFn = makeExec((cmd, args, cb) => fail(cb));
    assert.equal(await status("worktree-hook", { execFileFn }), false);
  });

  it("status() is false rather than throwing when the script itself can't run (e.g. missing jq)", async () => {
    const execFileFn = makeExec((cmd, args, cb) => cb(new Error("jq: command not found")));
    assert.equal(await status("worktree-hook", { execFileFn }), false);
  });

  it("enable() runs the install script with no args and reports ok", async () => {
    const execFileFn = makeExec((cmd, args, cb) => ok(cb));
    const result = await enable("worktree-hook", { execFileFn });
    assert.deepEqual(result, { ok: true });
    assert.match(execFileFn.calls[0][0], /install-worktree-hook\.sh$/);
    assert.deepEqual(execFileFn.calls[0].slice(1), []);
  });

  it("enable() surfaces the failure instead of throwing", async () => {
    const execFileFn = makeExec((cmd, args, cb) => fail(cb, "jq is required to install this hook"));
    const result = await enable("worktree-hook", { execFileFn });
    assert.equal(result.ok, false);
    assert.match(result.error, /jq is required/);
  });

  it("disable() runs the uninstall script with no args and reports ok", async () => {
    const execFileFn = makeExec((cmd, args, cb) => ok(cb));
    const result = await disable("worktree-hook", { execFileFn });
    assert.deepEqual(result, { ok: true });
    assert.match(execFileFn.calls[0][0], /uninstall-worktree-hook\.sh$/);
    assert.deepEqual(execFileFn.calls[0].slice(1), []);
  });

  it("disable() surfaces the failure instead of throwing", async () => {
    const execFileFn = makeExec((cmd, args, cb) => fail(cb, "No settings file found"));
    const result = await disable("worktree-hook", { execFileFn });
    assert.equal(result.ok, false);
    assert.match(result.error, /No settings file found/);
  });

  it("rejects for an unknown integration id", async () => {
    const execFileFn = makeExec((cmd, args, cb) => ok(cb));
    await assert.rejects(() => status("not-a-real-integration", { execFileFn }), /Unknown integration/);
    await assert.rejects(() => enable("not-a-real-integration", { execFileFn }), /Unknown integration/);
    await assert.rejects(() => disable("not-a-real-integration", { execFileFn }), /Unknown integration/);
  });
});

describe("integrations: opt-in nudge (decided tracking)", () => {
  it("isDecided() is false when decidedIntegrations is absent", () => {
    const configIO = makeConfigIO({});
    assert.equal(isDecided("worktree-hook", { configIO }), false);
  });

  it("isDecided() is false when the id isn't in decidedIntegrations", () => {
    const configIO = makeConfigIO({ decidedIntegrations: ["some-other-integration"] });
    assert.equal(isDecided("worktree-hook", { configIO }), false);
  });

  it("isDecided() is true once the id is in decidedIntegrations", () => {
    const configIO = makeConfigIO({ decidedIntegrations: ["worktree-hook"] });
    assert.equal(isDecided("worktree-hook", { configIO }), true);
  });

  it("enable() marks the integration decided on success", async () => {
    const execFileFn = makeExec((cmd, args, cb) => ok(cb));
    const configIO = makeConfigIO({});
    await enable("worktree-hook", { execFileFn, configIO });
    assert.deepEqual(configIO.raw.decidedIntegrations, ["worktree-hook"]);
  });

  it("enable() does not mark decided when the install script fails", async () => {
    const execFileFn = makeExec((cmd, args, cb) => fail(cb));
    const configIO = makeConfigIO({});
    await enable("worktree-hook", { execFileFn, configIO });
    assert.equal(configIO.raw.decidedIntegrations, undefined);
  });

  it("dismiss() marks decided without running any script", () => {
    const configIO = makeConfigIO({});
    const result = dismiss("worktree-hook", { configIO });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(configIO.raw.decidedIntegrations, ["worktree-hook"]);
  });

  it("dismiss() rejects for an unknown integration id", () => {
    const configIO = makeConfigIO({});
    assert.throws(() => dismiss("not-a-real-integration", { configIO }), /Unknown integration/);
  });

  it("marking one integration decided doesn't affect others already recorded", async () => {
    const execFileFn = makeExec((cmd, args, cb) => ok(cb));
    const configIO = makeConfigIO({ decidedIntegrations: ["some-other-integration"] });
    await enable("worktree-hook", { execFileFn, configIO });
    assert.deepEqual(new Set(configIO.raw.decidedIntegrations), new Set(["some-other-integration", "worktree-hook"]));
  });

  it("enabling twice doesn't duplicate the id in decidedIntegrations", async () => {
    const execFileFn = makeExec((cmd, args, cb) => ok(cb));
    const configIO = makeConfigIO({ decidedIntegrations: ["worktree-hook"] });
    await enable("worktree-hook", { execFileFn, configIO });
    assert.deepEqual(configIO.raw.decidedIntegrations, ["worktree-hook"]);
  });
});
