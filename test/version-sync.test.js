import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf-8"));

describe("package-lock version sync", () => {
  it("lockfile top-level version matches package.json", () => {
    assert.equal(lock.version, pkg.version);
  });

  it("lockfile root package version matches package.json", () => {
    assert.equal(lock.packages[""].version, pkg.version);
  });
});
