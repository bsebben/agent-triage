// src/worktree.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, basename } from "node:path";

const execFileAsync = promisify(execFile);

// dir -> identity | null. Whether a path is inside a repo, and which repo, is a
// stable property of that path — safe to cache for the life of the process.
const identityCache = new Map();

// dir -> { stillRegistered, expiresAt }. Guards against cmux reporting a directory
// whose worktree has since been removed (or its admin entry pruned) elsewhere.
const stalenessCache = new Map();
const STALENESS_TTL_MS = 30_000;

async function resolveIdentity(dir, exec) {
  try {
    const { stdout } = await exec("git", [
      "-C",
      dir,
      "rev-parse",
      "--path-format=absolute",
      "--git-dir",
      "--git-common-dir",
      "--show-toplevel",
    ]);
    const [gitDir, commonDir, toplevel] = stdout.trim().split("\n");
    const repoRoot = dirname(commonDir);
    return {
      isWorktree: gitDir !== commonDir,
      toplevel,
      repoRoot,
      repoName: basename(repoRoot),
    };
  } catch {
    return null;
  }
}

async function isStillRegistered(dir, toplevel, exec) {
  const now = Date.now();
  const cached = stalenessCache.get(dir);
  if (cached && cached.expiresAt > now) return cached.stillRegistered;

  let stillRegistered = false;
  try {
    const { stdout } = await exec("git", ["-C", dir, "worktree", "list", "--porcelain"]);
    stillRegistered = stdout
      .split("\n")
      .some((line) => line.startsWith("worktree ") && line.slice("worktree ".length).trim() === toplevel);
  } catch {
    stillRegistered = false;
  }
  stalenessCache.set(dir, { stillRegistered, expiresAt: now + STALENESS_TTL_MS });
  return stillRegistered;
}

/**
 * Resolves a directory's repo/worktree identity, or `null` when it isn't inside a
 * git repo. A linked worktree whose registration has since been removed (directory
 * still present but `git worktree list` no longer knows it) reports `isWorktree: false`
 * rather than a stale positive.
 */
export async function resolveWorktree(dir, { execFileFn } = {}) {
  if (!dir) return null;
  const exec = execFileFn ? promisify(execFileFn) : execFileAsync;

  let identity = identityCache.get(dir);
  if (identity === undefined) {
    identity = await resolveIdentity(dir, exec);
    identityCache.set(dir, identity);
  }
  if (!identity) return null;

  const isWorktree = identity.isWorktree && (await isStillRegistered(dir, identity.toplevel, exec));

  return {
    isWorktree,
    worktreeName: isWorktree ? basename(identity.toplevel) : null,
    repoRoot: identity.repoRoot,
    repoName: identity.repoName,
  };
}

export function _clearCachesForTest() {
  identityCache.clear();
  stalenessCache.clear();
}
