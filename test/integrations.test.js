// test/integrations.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { status, enable, disable } from "../src/integrations.js";

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
