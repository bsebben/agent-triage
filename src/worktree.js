// src/worktree.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, basename } from "node:path";

const execFileAsync = promisify(execFile);

// Bounds both caches below so a long-running dashboard observing many distinct
// directories over time doesn't grow unbounded, and re-checks each entry's
// identity/registration periodically rather than trusting it for the life of
// the process — a directory can be removed and recreated at the same path
// (e.g. a worktree torn down and rebuilt while iterating on a feature).
const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 500;

function pruneCache(cache) {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  // Map iterates in insertion order; re-querying a cached key doesn't move it,
  // so the oldest-inserted entries (front of iteration) are evicted first —
  // an approximation of LRU that's cheap enough not to need its own bookkeeping.
  const excess = cache.size - MAX_CACHE_ENTRIES;
  const keys = cache.keys();
  for (let i = 0; i < excess; i++) cache.delete(keys.next().value);
}

// dir -> { identity: identity|null, expiresAt }
const identityCache = new Map();

// dir -> { stillRegistered, expiresAt }. Guards against cmux reporting a directory
// whose worktree has since been removed (or its admin entry pruned) elsewhere.
const stalenessCache = new Map();

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
  stalenessCache.set(dir, { stillRegistered, expiresAt: now + CACHE_TTL_MS });
  pruneCache(stalenessCache);
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

  const now = Date.now();
  const cached = identityCache.get(dir);
  let identity;
  if (cached && cached.expiresAt > now) {
    identity = cached.identity;
  } else {
    identity = await resolveIdentity(dir, exec);
    identityCache.set(dir, { identity, expiresAt: now + CACHE_TTL_MS });
    pruneCache(identityCache);
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
