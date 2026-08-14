// test/worktree.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resolveWorktree, _clearCachesForTest } from "../src/worktree.js";

function makeExec(responses) {
  const calls = [];
  const fn = (cmd, args, cb) => {
    calls.push([cmd, ...args]);
    const key = args.join(" ");
    const match = Object.entries(responses).find(([pattern]) => key.includes(pattern));
    if (!match) return cb(new Error(`fatal: not a git repository`));
    const [, result] = match;
    if (result instanceof Error) return cb(result);
    cb(null, { stdout: result, stderr: "" });
  };
  fn.calls = calls;
  return fn;
}

describe("resolveWorktree", () => {
  beforeEach(() => {
    _clearCachesForTest();
  });

  it("returns null for a directory outside any git repo", async () => {
    const execFileFn = makeExec({});
    const result = await resolveWorktree("/home/user/not-a-repo", { execFileFn });
    assert.equal(result, null);
  });

  it("reports the main checkout as not a worktree", async () => {
    const execFileFn = makeExec({
      "rev-parse":
        "/home/user/my-project/.git\n/home/user/my-project/.git\n/home/user/my-project",
    });
    const result = await resolveWorktree("/home/user/my-project", { execFileFn });
    assert.deepEqual(result, {
      isWorktree: false,
      worktreeName: null,
      repoRoot: "/home/user/my-project",
      repoName: "my-project",
    });
  });

  it("reports a linked worktree that's still registered", async () => {
    const execFileFn = makeExec({
      "rev-parse":
        "/home/user/my-project/.git/worktrees/wt-demo\n/home/user/my-project/.git\n/home/user/my-project-worktrees/wt-demo",
      "worktree list": "worktree /home/user/my-project\nworktree /home/user/my-project-worktrees/wt-demo\n",
    });
    const result = await resolveWorktree("/home/user/my-project-worktrees/wt-demo", { execFileFn });
    assert.deepEqual(result, {
      isWorktree: true,
      worktreeName: "wt-demo",
      repoRoot: "/home/user/my-project",
      repoName: "my-project",
    });
  });

  it("hides the worktree when it no longer appears in git worktree list", async () => {
    const execFileFn = makeExec({
      "rev-parse":
        "/home/user/my-project/.git/worktrees/wt-demo\n/home/user/my-project/.git\n/home/user/my-project-worktrees/wt-demo",
      "worktree list": "worktree /home/user/my-project\n",
    });
    const result = await resolveWorktree("/home/user/my-project-worktrees/wt-demo", { execFileFn });
    assert.equal(result.isWorktree, false);
    assert.equal(result.worktreeName, null);
    assert.equal(result.repoRoot, "/home/user/my-project");
  });

  it("caches the identity lookup across repeated calls for the same directory", async () => {
    const execFileFn = makeExec({
      "rev-parse":
        "/home/user/my-project/.git\n/home/user/my-project/.git\n/home/user/my-project",
    });
    await resolveWorktree("/home/user/my-project", { execFileFn });
    await resolveWorktree("/home/user/my-project", { execFileFn });
    const revParseCalls = execFileFn.calls.filter((c) => c.includes("rev-parse"));
    assert.equal(revParseCalls.length, 1);
  });

  it("re-resolves identity and registration together once the cache expires, never one stale and one fresh", async () => {
    const realNow = Date.now;
    let fakeNow = realNow();
    Date.now = () => fakeNow;
    try {
      const execFileFn = makeExec({
        "rev-parse":
          "/home/user/my-project/.git/worktrees/wt-demo\n/home/user/my-project/.git\n/home/user/my-project-worktrees/wt-demo",
        "worktree list": "worktree /home/user/my-project\nworktree /home/user/my-project-worktrees/wt-demo\n",
      });
      const first = await resolveWorktree("/home/user/my-project-worktrees/wt-demo", { execFileFn });
      assert.equal(first.isWorktree, true);
      assert.equal(first.repoRoot, "/home/user/my-project");

      // Directory torn down and rebuilt as a fresh, unrelated repo at the same
      // path — a plausible workflow for this exact feature. Both identity and
      // registration must come from the new state together, not a mix of old
      // (cached) repoRoot with a freshly-rechecked isWorktree.
      fakeNow += 31_000;
      const execFileFn2 = makeExec({
        "rev-parse": "/home/user/other-project/.git\n/home/user/other-project/.git\n/home/user/other-project",
      });
      const second = await resolveWorktree("/home/user/my-project-worktrees/wt-demo", { execFileFn: execFileFn2 });
      assert.equal(second.isWorktree, false);
      assert.equal(second.repoRoot, "/home/user/other-project");
    } finally {
      Date.now = realNow;
    }
  });
});
