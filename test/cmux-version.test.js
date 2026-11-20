import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseCmuxVersion,
  inRange,
  downloadUrl,
  releaseUrl,
  CMUX_VERSION_RANGE,
} from "../src/cmux-version.js";

describe("parseCmuxVersion", () => {
  it("parses standard cmux output", () => {
    assert.equal(parseCmuxVersion("cmux 0.64.7 (87) [4d04459dd]"), "0.64.7");
  });

  it("parses major version", () => {
    assert.equal(parseCmuxVersion("cmux 1.0.0 (1) [abc]"), "1.0.0");
  });

  it("returns null for empty string", () => {
    assert.equal(parseCmuxVersion(""), null);
  });

  it("returns null for null/undefined", () => {
    assert.equal(parseCmuxVersion(null), null);
    assert.equal(parseCmuxVersion(undefined), null);
  });

  it("returns null for unrecognized format", () => {
    assert.equal(parseCmuxVersion("not cmux output"), null);
    assert.equal(parseCmuxVersion("cmux beta"), null);
  });
});

describe("inRange", () => {
  const range = { min: "0.64.0", max: "0.64.7" };

  it("returns true for version within range", () => {
    assert.equal(inRange("0.64.3", range), true);
  });

  it("returns true for version equal to min", () => {
    assert.equal(inRange("0.64.0", range), true);
  });

  it("returns true for version equal to max", () => {
    assert.equal(inRange("0.64.7", range), true);
  });

  it("returns false for version below min", () => {
    assert.equal(inRange("0.63.99", range), false);
  });

  it("returns false for version above max", () => {
    assert.equal(inRange("0.64.8", range), false);
    assert.equal(inRange("0.65.0", range), false);
  });

  it("returns false for much higher major version", () => {
    assert.equal(inRange("1.0.0", range), false);
  });

  it("returns false for null version", () => {
    assert.equal(inRange(null, range), false);
  });

  it("returns false for malformed version", () => {
    assert.equal(inRange("abc", range), false);
    assert.equal(inRange("0.64", range), false);
  });

  it("returns false for null range fields", () => {
    assert.equal(inRange("0.64.3", { min: null, max: "0.64.7" }), false);
    assert.equal(inRange("0.64.3", { min: "0.64.0", max: null }), false);
  });

  it("works when min equals max", () => {
    assert.equal(inRange("0.64.7", { min: "0.64.7", max: "0.64.7" }), true);
    assert.equal(inRange("0.64.6", { min: "0.64.7", max: "0.64.7" }), false);
  });
});

describe("four-part versions", () => {
  const range = { min: "0.64.0", max: "0.65.2.2" };

  it("parses a fourth component", () => {
    assert.equal(parseCmuxVersion("cmux 0.65.2.2 (114) [abc]"), "0.65.2.2");
  });

  it("still parses three-part output followed by a build number", () => {
    assert.equal(parseCmuxVersion("cmux 0.65.2 (113) [abc]"), "0.65.2");
  });

  it("treats a three-part version as the hotfix-less release, below its hotfixes", () => {
    assert.equal(inRange("0.65.2", range), true);
    assert.equal(inRange("0.65.2.1", range), true);
    assert.equal(inRange("0.65.2.2", range), true);
  });

  it("rejects versions above a four-part max", () => {
    assert.equal(inRange("0.65.2.3", range), false);
    assert.equal(inRange("0.65.3", range), false);
  });

  it("rejects a four-part version below a three-part min", () => {
    assert.equal(inRange("0.63.9.9", range), false);
  });

  it("rejects a hotfix above a three-part max", () => {
    assert.equal(inRange("0.65.2.1", { min: "0.64.0", max: "0.65.2" }), false);
  });

  it("keeps the shipped range's max as a valid in-range version", () => {
    assert.equal(inRange(CMUX_VERSION_RANGE.max, CMUX_VERSION_RANGE), true);
  });
});

describe("shipped range", () => {
  it("excludes releases before batch reorder-workspaces and reorder events", () => {
    assert.equal(inRange("0.64.9", CMUX_VERSION_RANGE), false);
    assert.equal(inRange("0.64.0", CMUX_VERSION_RANGE), false);
  });

  it("includes the first release with them, and the releases after it", () => {
    assert.equal(inRange("0.64.10", CMUX_VERSION_RANGE), true);
    assert.equal(inRange("0.64.22", CMUX_VERSION_RANGE), true);
    assert.equal(inRange("0.65.2", CMUX_VERSION_RANGE), true);
  });
});

describe("release links", () => {
  it("builds download and release URLs from an exact tag, including a fourth component", () => {
    assert.equal(
      downloadUrl("0.65.2.2"),
      "https://github.com/manaflow-ai/cmux/releases/download/v0.65.2.2/cmux-macos.dmg",
    );
    assert.equal(releaseUrl("0.65.2.2"), "https://github.com/manaflow-ai/cmux/releases/tag/v0.65.2.2");
  });
});
