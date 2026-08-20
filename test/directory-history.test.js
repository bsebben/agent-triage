// test/directory-history.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { unlink } from "node:fs/promises";
import { DirectoryHistory, listDirectories, resolveDirectory } from "../src/directory-history.js";
import { _clearCachesForTest } from "../src/worktree.js";

const DEFAULT_DIR = "/Users/x/workspace";

describe("DirectoryHistory", () => {
  let history;

  beforeEach(() => {
    history = new DirectoryHistory();
  });

  it("orders an unused directory list alphabetically", () => {
    const { directories } = history.directoryOptions("ABC", ["another-project", "agent-triage", "my-project"]);
    assert.deepEqual(directories, ["agent-triage", "another-project", "my-project"]);
  });

  it("puts the project's most recently used directory first", () => {
    history.use("ABC", "my-project");
    const { directories, suggested } = history.directoryOptions("ABC", [
      "another-project",
      "agent-triage",
      "my-project",
    ]);
    assert.equal(directories[0], "my-project");
    assert.equal(suggested, "my-project");
  });

  it("orders project MRU before global MRU", () => {
    history.use("XYZ", "third-project");
    history.use("ABC", "my-project");
    const { directories } = history.directoryOptions("ABC", ["third-project", "my-project", "another-project"]);
    assert.deepEqual(directories, ["my-project", "third-project", "another-project"]);
  });

  it("falls back to the global MRU for a project with no history", () => {
    history.use("XYZ", "third-project");
    const { suggested } = history.directoryOptions("ABC", ["third-project", "my-project"]);
    assert.equal(suggested, "third-project");
  });

  it("most-recent use wins within a project's MRU", () => {
    history.use("ABC", "my-project");
    history.use("ABC", "another-project");
    history.use("ABC", "my-project");
    const { directories } = history.directoryOptions("ABC", ["my-project", "another-project", "third-project"]);
    assert.deepEqual(directories.slice(0, 2), ["my-project", "another-project"]);
  });

  it("drops history entries for directories no longer present on disk", () => {
    history.use("ABC", "deleted-repo");
    const { directories, suggested } = history.directoryOptions("ABC", ["my-project"]);
    assert.deepEqual(directories, ["my-project"]);
    assert.equal(suggested, "my-project");
  });

  it("treats a falsy directory as a no-op", () => {
    history.use("ABC", null);
    history.use("ABC", undefined);
    const { directories } = history.directoryOptions("ABC", ["my-project"]);
    assert.deepEqual(directories, ["my-project"]);
  });

  it("treats a missing projectKey as a no-op for the project-scoped list, but still updates global", () => {
    history.use(null, "my-project");
    const { suggested } = history.directoryOptions("ABC", ["my-project", "another-project"]);
    assert.equal(suggested, "my-project");
  });

  it("caps each MRU list at 10 entries", () => {
    for (let i = 0; i < 15; i++) history.use("ABC", `repo-${i}`);
    const allDirectories = Array.from({ length: 15 }, (_, i) => `repo-${i}`);
    const { directories } = history.directoryOptions("ABC", allDirectories);
    // Only the 10 most recent are prioritized; the rest fall back to alphabetical
    // and still all appear (directoryOptions never drops a directory that's on disk).
    assert.equal(directories.length, 15);
    assert.equal(directories[0], "repo-14");
  });

  it("persists and restores across save/load", async () => {
    const tmpFile = join(tmpdir(), `directory-history-test-${Date.now()}.json`);
    try {
      history.use("ABC", "my-project");
      history.use("XYZ", "third-project");
      await history.save(tmpFile);

      const loaded = new DirectoryHistory();
      await loaded.load(tmpFile);
      assert.deepEqual(loaded.directoryOptions("ABC", ["my-project", "third-project"]).directories, [
        "my-project",
        "third-project",
      ]);
      assert.deepEqual(loaded.directoryOptions("XYZ", ["my-project", "third-project"]).directories, [
        "third-project",
        "my-project",
      ]);
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it("handles load from a non-existent file gracefully", async () => {
    await history.load("/tmp/does-not-exist-directory-history-12345.json");
    assert.deepEqual(history.directoryOptions("ABC", ["my-project"]).directories, ["my-project"]);
  });

  describe("with a fallback default directory", () => {
    it("suggests the default directory when there is no history at all", () => {
      const { directories, suggested } = history.directoryOptions(
        "ABC",
        ["agent-triage", "my-project", "another-project"],
        DEFAULT_DIR,
      );
      assert.equal(suggested, DEFAULT_DIR);
      // Listed right after the (empty) history-backed entries, ahead of the alphabetical rest.
      assert.deepEqual(directories, [DEFAULT_DIR, "agent-triage", "another-project", "my-project"]);
    });

    it("lists the default directory once, after history-backed entries", () => {
      history.use("ABC", "my-project");
      const { directories } = history.directoryOptions("ABC", ["agent-triage", "my-project"], DEFAULT_DIR);
      assert.deepEqual(directories, ["my-project", DEFAULT_DIR, "agent-triage"]);
    });

    it("remembers a pick of the default directory itself and suggests it next time", () => {
      history.use("ABC", DEFAULT_DIR);
      const { directories, suggested } = history.directoryOptions("ABC", ["agent-triage", "my-project"], DEFAULT_DIR);
      assert.equal(suggested, DEFAULT_DIR);
      assert.deepEqual(directories, [DEFAULT_DIR, "agent-triage", "my-project"]);
    });

    it("prefers project history over the default directory", () => {
      history.use("ABC", "my-project");
      const { suggested } = history.directoryOptions("ABC", ["agent-triage", "my-project"], DEFAULT_DIR);
      assert.equal(suggested, "my-project");
    });

    it("prefers global history over the default directory", () => {
      history.use("XYZ", "third-project");
      const { suggested } = history.directoryOptions("ABC", ["third-project", "my-project"], DEFAULT_DIR);
      assert.equal(suggested, "third-project");
    });

    it("suggests null when there is neither history nor a default directory nor directories", () => {
      const { directories, suggested } = history.directoryOptions("ABC", [], null);
      assert.deepEqual(directories, []);
      assert.equal(suggested, null);
    });
  });
});

describe("resolveDirectory", () => {
  const opts = (existing) => ({
    defaultDirectory: DEFAULT_DIR,
    home: "/Users/x",
    existsFn: (p) => existing.includes(p),
  });

  it("honors an absolute pick — including the default directory itself", () => {
    assert.equal(resolveDirectory(DEFAULT_DIR, opts([DEFAULT_DIR])), DEFAULT_DIR);
    assert.equal(
      resolveDirectory("/Users/x/other/my-project", opts(["/Users/x/other/my-project"])),
      "/Users/x/other/my-project",
    );
  });

  it("joins a bare directory name under the default directory", () => {
    assert.equal(
      resolveDirectory("my-project", opts([join(DEFAULT_DIR, "my-project")])),
      join(DEFAULT_DIR, "my-project"),
    );
  });

  it("takes the last segment of an owner/repo slug", () => {
    assert.equal(
      resolveDirectory("acme/my-project", opts([join(DEFAULT_DIR, "my-project")])),
      join(DEFAULT_DIR, "my-project"),
    );
  });

  it("falls back to the default directory for an unknown pick", () => {
    assert.equal(resolveDirectory("nope", opts([DEFAULT_DIR])), DEFAULT_DIR);
    assert.equal(resolveDirectory("/absolute/nope", opts([DEFAULT_DIR])), DEFAULT_DIR);
  });

  it("falls back to the default directory with no pick", () => {
    assert.equal(resolveDirectory(undefined, opts([DEFAULT_DIR])), DEFAULT_DIR);
  });

  it("falls back to home when the default directory doesn't exist", () => {
    assert.equal(resolveDirectory("my-project", opts([])), "/Users/x");
  });
});

// git stub: `kind` per directory name — "main" (root checkout), "worktree" (linked
// worktree, still registered), or "error" (rev-parse fails, e.g. a corrupted repo).
function fakeGit(kinds, { calls } = {}) {
  return (file, args, options, callback) => {
    const dir = args[1];
    const kind = kinds[basename(dir)] || "main";
    calls?.push({ file, args, options });
    if (kind === "error") return callback(new Error("not a git repository"));
    if (args.includes("worktree")) return callback(null, { stdout: `worktree ${dir}\n` });
    const gitDir = kind === "worktree" ? `/repos/main/.git/worktrees/${basename(dir)}` : `${dir}/.git`;
    const commonDir = kind === "worktree" ? "/repos/main/.git" : `${dir}/.git`;
    callback(null, { stdout: `${gitDir}\n${commonDir}\n${dir}\n` });
  };
}

function fakeReaddir(entries) {
  return () => entries.map(({ name, isDir = true }) => ({ name, isDirectory: () => isDir }));
}

describe("listDirectories", () => {
  beforeEach(() => {
    _clearCachesForTest();
  });

  it("lists root git checkouts", async () => {
    const directories = await listDirectories(DEFAULT_DIR, {
      readdirFn: fakeReaddir([{ name: "my-project" }, { name: "another-project" }]),
      existsFn: () => true,
      execFileFn: fakeGit({}),
    });
    assert.deepEqual(directories.sort(), ["another-project", "my-project"]);
  });

  it("excludes linked worktrees", async () => {
    const directories = await listDirectories(DEFAULT_DIR, {
      readdirFn: fakeReaddir([{ name: "my-project" }, { name: "my-project-feature" }]),
      existsFn: () => true,
      execFileFn: fakeGit({ "my-project-feature": "worktree" }),
    });
    assert.deepEqual(directories, ["my-project"]);
  });

  it("excludes non-git directories", async () => {
    const directories = await listDirectories(DEFAULT_DIR, {
      readdirFn: fakeReaddir([{ name: "my-project" }, { name: "notes" }]),
      existsFn: (p) => p !== join(DEFAULT_DIR, "notes", ".git"),
      execFileFn: fakeGit({}),
    });
    assert.deepEqual(directories, ["my-project"]);
  });

  it("excludes files", async () => {
    const directories = await listDirectories(DEFAULT_DIR, {
      readdirFn: fakeReaddir([{ name: "my-project" }, { name: "README.md", isDir: false }]),
      existsFn: () => true,
      execFileFn: fakeGit({}),
    });
    assert.deepEqual(directories, ["my-project"]);
  });

  it("fails open on an unresolvable repo, still offering it", async () => {
    const directories = await listDirectories(DEFAULT_DIR, {
      readdirFn: fakeReaddir([{ name: "my-project" }, { name: "broken" }]),
      existsFn: () => true,
      execFileFn: fakeGit({ broken: "error" }),
    });
    assert.deepEqual(directories.sort(), ["broken", "my-project"]);
  });

  it("returns an empty list when the directory can't be read", async () => {
    const directories = await listDirectories(DEFAULT_DIR, {
      readdirFn: () => {
        throw new Error("ENOENT");
      },
      existsFn: () => true,
      execFileFn: fakeGit({}),
    });
    assert.deepEqual(directories, []);
  });

  it("bounds the git fan-out with a concurrency cap and a timeout", async () => {
    const calls = [];
    let inFlight = 0;
    let peak = 0;
    const git = fakeGit({}, { calls });
    const gated = (file, args, options, callback) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      setTimeout(() => {
        inFlight--;
        git(file, args, options, callback);
      }, 1);
    };
    const entries = Array.from({ length: 30 }, (_, i) => ({ name: `repo-${i}` }));
    const directories = await listDirectories(DEFAULT_DIR, {
      readdirFn: fakeReaddir(entries),
      existsFn: () => true,
      execFileFn: gated,
    });
    assert.equal(directories.length, 30);
    assert.ok(peak <= 8, `expected at most 8 concurrent git calls, saw ${peak}`);
    assert.ok(
      calls.every((c) => typeof c.options?.timeout === "number" && c.options.timeout > 0),
      "expected every git call to carry a timeout",
    );
  });
});
