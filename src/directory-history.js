// src/directory-history.js
import { writeFile, readFile } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, isAbsolute } from "node:path";
import { resolveWorktree } from "./worktree.js";

const MAX_MRU = 10;

// A workspace can hold dozens of checkouts and each one costs a git subprocess (two for a
// worktree), so the fan-out is capped and each call is bounded — an unresponsive repo slows
// the picker by at most GIT_TIMEOUT_MS instead of hanging the request indefinitely.
const GIT_CONCURRENCY = 8;
const GIT_TIMEOUT_MS = 3000;

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function timeBounded(execFileFn) {
  return (file, args, callback) => execFileFn(file, args, { timeout: GIT_TIMEOUT_MS }, callback);
}

/**
 * Directory names for the ticket drawer's directory picker — the subset of `dir`'s children
 * that are actual git checkouts, excluding worktrees (linked worktrees have their own .git
 * file but aren't independent root checkouts, so listing them alongside their main repo would
 * just clutter the picker with duplicates).
 *
 * Args:
 *   dir: Absolute path whose children to list.
 *   readdirFn/existsFn/execFileFn: Injectable for tests.
 *
 * Returns:
 *   Bare child directory names, unordered.
 */
export async function listDirectories(dir, { readdirFn = readdirSync, existsFn = existsSync, execFileFn = execFile } = {}) {
  let entries;
  try {
    entries = readdirFn(dir, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && existsFn(join(dir, entry.name, ".git")),
    );
  } catch {
    return [];
  }
  const exec = timeBounded(execFileFn);
  const checks = await mapWithLimit(entries, GIT_CONCURRENCY, async (entry) => {
    const worktree = await resolveWorktree(join(dir, entry.name), { execFileFn: exec }).catch(() => null);
    // Fail open on an unresolved check (e.g. a corrupted repo) — keep offering it,
    // matching the pre-filter behavior for that edge case.
    return { name: entry.name, isWorktree: worktree?.isWorktree === true };
  });
  return checks.filter((c) => !c.isWorktree).map((c) => c.name);
}

/**
 * Resolve a directory pick (or a PR's repo name) to a working directory.
 *
 * Args:
 *   pick: An absolute path (the picker can hand back the default directory itself), a bare
 *     directory name, or an `owner/repo` slug. Falsy resolves to the default directory.
 *   defaultDirectory: The configured default directory.
 *   home: Last-resort fallback when the default directory doesn't exist.
 *   existsFn: Injectable for tests.
 *
 * Returns:
 *   An absolute path.
 */
export function resolveDirectory(pick, { defaultDirectory, home, existsFn = existsSync } = {}) {
  // An absolute pick is honored directly instead of being treated as a bare name to join
  // under the default directory.
  if (pick && isAbsolute(pick) && existsFn(pick)) return pick;
  if (pick) {
    const name = pick.split("/").pop();
    const path = join(defaultDirectory, name);
    if (existsFn(path)) return path;
  }
  if (existsFn(defaultDirectory)) return defaultDirectory;
  return home;
}

function bumpMru(list, value, max = MAX_MRU) {
  return [value, ...list.filter((v) => v !== value)].slice(0, max);
}

/**
 * Tracks which directory a ticket action last dispatched to, so the ticket drawer's
 * directory field can guess correctly next time instead of always falling back to
 * the default directory.
 *
 * Two MRU lists are kept: one per Jira project key (a project's tickets tend
 * to cluster on a handful of directories) and one global (fallback for a project
 * seen for the first time).
 */
export class DirectoryHistory {
  #byProject = new Map();
  #recentDirectories = [];

  /**
   * Record that `directory` was used for a ticket dispatch, bumping it to the
   * front of both the project-scoped and global MRU lists.
   *
   * Args:
   *   projectKey: The ticket's Jira project key (e.g. "PO"), or null/undefined
   *     if unknown — the project-scoped list is skipped in that case.
   *   directory: The directory name that was dispatched to. A falsy value is a no-op.
   */
  use(projectKey, directory) {
    if (!directory) return;
    this.#recentDirectories = bumpMru(this.#recentDirectories, directory);
    if (projectKey) {
      const list = this.#byProject.get(projectKey) || [];
      this.#byProject.set(projectKey, bumpMru(list, directory));
    }
  }

  /**
   * Build the picker's choices and the guess to pre-fill.
   *
   * `fallbackDirectory` (the configured default directory) is a first-class candidate, not an
   * afterthought appended to the list: it's offered in the picker, it can be recorded in
   * history like any other choice, and history can therefore rank it ahead of the repos. When
   * no history applies it is the guess — never an arbitrary alphabetically-first checkout,
   * which would silently dispatch into some unrelated repo on first use.
   *
   * Ordering is [history-backed entries (project MRU, then global MRU), fallback, remainder
   * alphabetically]. History entries that no longer exist (a directory renamed or removed on
   * disk) are dropped rather than offered as stale suggestions.
   *
   * Args:
   *   projectKey: The ticket's Jira project key, or null/undefined.
   *   allDirectories: The directory names currently on disk.
   *   fallbackDirectory: The default directory, or null.
   *
   * Returns:
   *   `{ directories, suggested }` — `suggested` is a history hit when there is one,
   *   otherwise `fallbackDirectory`, otherwise the first listed directory (or null).
   */
  directoryOptions(projectKey, allDirectories = [], fallbackDirectory = null) {
    const valid = new Set(allDirectories);
    if (fallbackDirectory) valid.add(fallbackDirectory);
    const projectList = projectKey ? this.#byProject.get(projectKey) || [] : [];

    const seen = new Set();
    const historyBacked = [];
    for (const directory of [...projectList, ...this.#recentDirectories]) {
      if (seen.has(directory) || !valid.has(directory)) continue;
      seen.add(directory);
      historyBacked.push(directory);
    }

    const fallbackEntry = fallbackDirectory && !seen.has(fallbackDirectory) ? [fallbackDirectory] : [];
    if (fallbackDirectory) seen.add(fallbackDirectory);
    const remainder = [...valid].filter((d) => !seen.has(d)).sort();

    const directories = [...historyBacked, ...fallbackEntry, ...remainder];
    return { directories, suggested: historyBacked[0] ?? fallbackDirectory ?? directories[0] ?? null };
  }

  /**
   * Persist history to a JSON file.
   *
   * Args:
   *   filePath: Absolute path to write the JSON file.
   */
  async save(filePath) {
    const data = {
      byProject: Object.fromEntries(this.#byProject),
      recentDirectories: this.#recentDirectories,
    };
    await writeFile(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load history from a JSON file, replacing current state.
   *
   * Args:
   *   filePath: Absolute path to read the JSON file from.
   */
  async load(filePath) {
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      this.#byProject = new Map(Object.entries(data.byProject || {}));
      this.#recentDirectories = Array.isArray(data.recentDirectories) ? data.recentDirectories : [];
    } catch {
      // No saved state, start fresh
    }
  }
}
