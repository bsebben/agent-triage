import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseCmuxVersion,
  inRange,
  downloadUrl,
  releaseUrl,
  CMUX_RECOMMENDED_RELEASE,
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

describe("release links", () => {
  it("builds download and release URLs from an exact tag, including a fourth component", () => {
    assert.equal(
      downloadUrl("0.65.2.2"),
      "https://github.com/manaflow-ai/cmux/releases/download/v0.65.2.2/cmux-macos.dmg",
    );
    assert.equal(releaseUrl("0.65.2.2"), "https://github.com/manaflow-ai/cmux/releases/tag/v0.65.2.2");
  });

  it("recommended release shares its first three parts with the range max", () => {
    const base = CMUX_RECOMMENDED_RELEASE.split(".").slice(0, 3).join(".");
    assert.equal(base, CMUX_VERSION_RANGE.max);
  });

  it("recommended release is a valid in-range target", () => {
    const base = CMUX_RECOMMENDED_RELEASE.split(".").slice(0, 3).join(".");
    assert.equal(inRange(base, CMUX_VERSION_RANGE), true);
  });
});
