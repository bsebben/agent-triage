import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// max is also the release the update pill installs, so it must be an exact release tag.
// cmux ships hotfixes as a fourth component (0.65.2.2), which is why versions may have 3 or 4 parts.
export const CMUX_VERSION_RANGE = { min: "0.64.0", max: "0.65.2.2" };

const GITHUB_REPO = "manaflow-ai/cmux";

export function downloadUrl(version) {
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/cmux-macos.dmg`;
}

export function releaseUrl(version) {
  return `https://github.com/${GITHUB_REPO}/releases/tag/v${version}`;
}

export function parseCmuxVersion(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^cmux\s+(\d+(?:\.\d+){2,3})/);
  return m ? m[1] : null;
}

// A missing trailing part counts as 0, so 0.65.2 equals 0.65.2.0 and sorts below 0.65.2.2.
function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i++) {
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
    downloadUrl: downloadUrl(range.max),
    releaseUrl: releaseUrl(range.max),
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
