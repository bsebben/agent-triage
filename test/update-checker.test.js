import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isNewer, extractChangelog, UpdateChecker } from "../src/update-checker.js";

describe("isNewer", () => {
  it("returns true when remote is a higher patch", () => {
    assert.equal(isNewer("1.13.1", "1.13.0"), true);
  });

  it("returns true when remote is a higher minor", () => {
    assert.equal(isNewer("1.14.0", "1.13.3"), true);
  });

  it("returns true when remote is a higher major", () => {
    assert.equal(isNewer("2.0.0", "1.99.99"), true);
  });

  it("returns false when versions are equal", () => {
    assert.equal(isNewer("1.13.0", "1.13.0"), false);
  });

  it("returns false when remote is older", () => {
    assert.equal(isNewer("1.12.0", "1.13.0"), false);
  });

  it("returns false for invalid input", () => {
    assert.equal(isNewer(null, "1.0.0"), false);
    assert.equal(isNewer("1.0.0", null), false);
    assert.equal(isNewer("abc", "1.0.0"), false);
  });
});

describe("extractChangelog", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [1.14.0] - 2026-05-07",
    "",
    "### Added",
    "",
    "- Auto-update notification",
    "",
    "## [1.13.1] - 2026-05-06",
    "",
    "### Fixed",
    "",
    "- Close button on dismissed cards",
    "",
    "## [1.13.0] - 2026-05-06",
    "",
    "### Added",
    "",
    "- New Session buttons",
    "",
  ].join("\n");

  it("extracts entries between remote and current version", () => {
    const result = extractChangelog(changelog, "1.13.0");
    assert.ok(result.includes("1.14.0"));
    assert.ok(result.includes("1.13.1"));
    assert.ok(!result.includes("1.13.0"));
    assert.ok(!result.includes("New Session buttons"));
  });

  it("returns null when current version is not found", () => {
    assert.equal(extractChangelog(changelog, "0.0.1"), null);
  });

  it("returns null for empty input", () => {
    assert.equal(extractChangelog("", "1.0.0"), null);
    assert.equal(extractChangelog(null, "1.0.0"), null);
  });
});

describe("UpdateChecker", () => {
  it("detects newer remote version", async () => {
    const checker = new UpdateChecker({
      currentVersion: "1.13.0",
      git: async (args) => {
        if (args[1] === "origin/master:package.json") return JSON.stringify({ version: "1.14.0" });
        if (args[1] === "origin/master:CHANGELOG.md") return "## [1.14.0] - 2026-05-07\n\n### Added\n\n- New feature\n\n## [1.13.0] - 2026-05-06\n\n### Added\n\n- Old feature\n";
        return "";
      },
    });
    await checker.check();
    assert.equal(checker.data.available, true);
    assert.equal(checker.data.remote, "1.14.0");
    assert.ok(checker.data.changelog.includes("New feature"));
    assert.ok(!checker.data.changelog.includes("Old feature"));
  });

  it("reports not available when versions match", async () => {
    const checker = new UpdateChecker({
      currentVersion: "1.13.0",
      git: async (args) => {
        if (args[1] === "origin/master:package.json") return JSON.stringify({ version: "1.13.0" });
        return "";
      },
    });
    await checker.check();
    assert.equal(checker.data.available, false);
  });

  it("handles git failure gracefully", async () => {
    const checker = new UpdateChecker({
      currentVersion: "1.13.0",
      git: async () => { throw new Error("network error"); },
    });
    await checker.check();
    assert.equal(checker.data.available, false);
  });

  it("calls onUpdate callback after check", async () => {
    let called = false;
    const checker = new UpdateChecker({
      currentVersion: "1.13.0",
      git: async (args) => {
        if (args[1] === "origin/master:package.json") return JSON.stringify({ version: "1.13.0" });
        return "";
      },
    });
    checker.init(() => { called = true; });
    await checker.check();
    assert.equal(called, true);
    checker.stop();
  });
});
