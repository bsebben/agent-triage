import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CMUX_VERSION_RANGE = { min: "0.64.0", max: "0.65.2" };

// Exact release tag (without the "v") the update pill installs. cmux ships hotfixes as a
// fourth component (0.65.2.2) that still report the three-part version, so this can be
// newer than range.max while sharing its first three parts.
export const CMUX_RECOMMENDED_RELEASE = "0.65.2.2";

const GITHUB_REPO = "manaflow-ai/cmux";

export function downloadUrl(release) {
  return `https://github.com/${GITHUB_REPO}/releases/download/v${release}/cmux-macos.dmg`;
}

export function releaseUrl(release) {
  return `https://github.com/${GITHUB_REPO}/releases/tag/v${release}`;
}

export function parseCmuxVersion(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^cmux\s+(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function inRange(version, range) {
  if (!version || !range?.min || !range?.max) return false;
  const parts = version.split(".").map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return false;
  return compareSemver(version, range.min) >= 0 && compareSemver(version, range.max) <= 0;
}

export async function detectCmuxVersion(binaryPath) {
  const range = CMUX_VERSION_RANGE;
  const base = {
    range,
    downloadUrl: downloadUrl(CMUX_RECOMMENDED_RELEASE),
    releaseUrl: releaseUrl(CMUX_RECOMMENDED_RELEASE),
  };

  let version = null;
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"]);
    version = parseCmuxVersion(stdout);
  } catch {
    return { version: null, compatible: false, reason: "unknown", ...base };
  }

  if (!version) {
    return { version: null, compatible: false, reason: "unknown", ...base };
  }

  const compatible = inRange(version, range);
  let reason = null;
  if (!compatible) {
    reason = compareSemver(version, range.min) < 0 ? "too_old" : "too_new";
  }

  return { version, compatible, reason, ...base };
}
