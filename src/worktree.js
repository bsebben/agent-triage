// src/worktree.js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, basename } from "node:path";

const execFileAsync = promisify(execFile);

// Bounds the cache below so a long-running dashboard observing many distinct
// directories over time doesn't grow unbounded, and re-checks each entry
// periodically rather than trusting it for the life of the process — a
// directory can be removed and recreated at the same path (e.g. a worktree
// torn down and rebuilt while iterating on a feature).
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

// dir -> { identity: identity|null, stillRegistered: boolean, expiresAt }. A
// single cache entry per directory, refreshed together, so isWorktree and
// repoRoot/repoName can never disagree about how stale they are — resolving
// them from two independently-expiring caches let isWorktree flip to false
// on a fresh check while repoRoot kept reporting the old repo for up to
// CACHE_TTL_MS longer.
const cache = new Map();

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

async function checkStillRegistered(dir, toplevel, exec) {
  try {
    const { stdout } = await exec("git", ["-C", dir, "worktree", "list", "--porcelain"]);
    return stdout
      .split("\n")
      .some((line) => line.startsWith("worktree ") && line.slice("worktree ".length).trim() === toplevel);
  } catch {
    return false;
  }
}

async function resolveEntry(dir, exec) {
  const identity = await resolveIdentity(dir, exec);
  if (!identity) return { identity: null, stillRegistered: false };
  // Only worth a second round-trip when it's actually a worktree — a main
  // checkout has nothing to deregister.
  const stillRegistered = identity.isWorktree ? await checkStillRegistered(dir, identity.toplevel, exec) : false;
  return { identity, stillRegistered };
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
  const cached = cache.get(dir);
  let entry;
  if (cached && cached.expiresAt > now) {
    entry = cached;
  } else {
    const { identity, stillRegistered } = await resolveEntry(dir, exec);
    entry = { identity, stillRegistered, expiresAt: now + CACHE_TTL_MS };
    cache.set(dir, entry);
    pruneCache(cache);
  }
  if (!entry.identity) return null;

  const isWorktree = entry.identity.isWorktree && entry.stillRegistered;

  return {
    isWorktree,
    worktreeName: isWorktree ? basename(entry.identity.toplevel) : null,
    repoRoot: entry.identity.repoRoot,
    repoName: entry.identity.repoName,
  };
}

export function _clearCachesForTest() {
  cache.clear();
}
