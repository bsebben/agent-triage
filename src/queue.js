// src/queue.js
import { writeFile, readFile } from "node:fs/promises";

const PRIORITY = { error: 0, permission: 1, waiting: 2, completion: 3, unknown: 4, running: 5, terminal: 6 };
const NON_PENDING = new Set(["completion", "running", "terminal"]);

import { homedir } from "node:os";

const HOME = homedir();

// Tiebreak for equal-priority/equal-dismissedAt items. `item.id` can rotate
// (synthetic ↔ notification handoff) without the underlying workspace's
// state changing, so sorting by it would reorder ties for no real reason —
// `workspaceId` is the one thing that stays constant for a given workspace.
function compareByWorkspaceId(a, b) {
  return (a.workspaceId || "").localeCompare(b.workspaceId || "");
}

// Shared tiebreak piece for sorting host-flagged entries (items in items(),
// whole groups in grouped()) after everything else.
function hostRank(isHost) {
  return isHost ? 1 : 0;
}

function dirLabel(dir) {
  if (!dir || dir === HOME) return "~";
  if (dir.startsWith(HOME + "/")) return "~/" + dir.slice(HOME.length + 1);
  return dir;
}

// Sentinel group key for the dashboard's own host workspace — never a real
// dirLabel() output (those are always an absolute path or "~"-prefixed), so
// it can't collide with an actual directory group.
const HOST_GROUP_KEY = "\0host";

export class Queue {
  #items = new Map();
  #recentDirs = new Map();
  static MAX_RECENT_DIRS = 20;

  upsert(item) {
    const existing = this.#items.get(item.id);
    this.#items.set(item.id, {
      ...existing,
      ...item,
      dismissed: existing?.dismissed || false,
      dismissedAt: existing?.dismissedAt || null,
      updatedAt: Date.now(),
      createdAt: existing?.createdAt || Date.now(),
    });
  }

  dismiss(id) {
    const item = this.#items.get(id);
    if (item) {
      this.#items.set(id, { ...item, dismissed: true, dismissedAt: Date.now() });
    }
  }

  remove(id) {
    this.#items.delete(id);
  }

  restore(id) {
    const item = this.#items.get(id);
    if (item) {
      this.#items.set(id, { ...item, dismissed: false, dismissedAt: null });
    }
  }

  get(id) {
    return this.#items.get(id);
  }

  items() {
    return [...this.#items.values()]
      .filter((i) => !i.dismissed)
      .sort(
        (a, b) =>
          (PRIORITY[a.category] ?? 99) - (PRIORITY[b.category] ?? 99) ||
          hostRank(a.isHost) - hostRank(b.isHost) ||
          compareByWorkspaceId(a, b)
      );
  }

  dismissedItems() {
    return [...this.#items.values()]
      .filter((i) => i.dismissed)
      .sort((a, b) => (b.dismissedAt || 0) - (a.dismissedAt || 0) || compareByWorkspaceId(a, b));
  }

  get recentDirCount() {
    return this.#recentDirs.size;
  }

  grouped(maxRecent = 4) {
    const groups = new Map();
    // The real directory the host's item would have grouped under were it
    // not pulled into its own dedicated group — tracked so that directory
    // never gets mistaken for "recently closed" below just because nothing
    // *else* is active there (the host itself still is).
    let hostDirLabel = null;
    for (const item of this.items()) {
      // The host gets a dedicated group of its own, keyed separately from any
      // real directory — never mixed into (or hidden behind) an actual
      // project group, even one for its own repo. There's only ever one host
      // workspace, so this group is always exactly one item; no grouping
      // nuance to worry about inside it. Everything else groups by repo root
      // when the workspace is inside a git repo, so worktrees of the same
      // repo share a group with the main checkout — non-repo directories
      // (e.g. a plain ~/workspace shell) keep grouping by directory.
      const rawGroupKey = item.repoRoot || item.workspaceDir || "Unknown";
      const realLabel = dirLabel(rawGroupKey);
      if (item.isHost) hostDirLabel = realLabel;
      const groupKey = item.isHost ? HOST_GROUP_KEY : realLabel;
      if (!groups.has(groupKey)) {
        const label = item.isHost ? item.workspaceTitle || "Dashboard Host" : groupKey;
        // "New session"/"New terminal" for this group should land wherever this
        // (highest-priority) item actually lives, not always the repo root —
        // otherwise a group made up entirely of worktree items would silently
        // launch new sessions in the main checkout instead of either worktree.
        groups.set(groupKey, { title: label, directory: item.workspaceDir || rawGroupKey, items: [] });
      }
      groups.get(groupKey).items.push(item);
    }

    const now = Date.now();
    for (const [key, group] of groups) {
      // The host isn't a project directory a user would ever want a "recently
      // active" stub for once its group disappears — skip tracking it.
      if (key === HOST_GROUP_KEY) continue;
      this.#recentDirs.set(key, { label: key, directory: group.directory, lastSeenAt: now });
    }
    this.#pruneRecentDirs();

    // The host's dedicated group sorts after every other group, regardless of
    // title — it's always the dashboard's own tab, which is always last in
    // cmux's real order too (see monitor.js#syncTabOrder, which independently
    // guarantees that for the actual cmux tab order; this is just the display
    // list agreeing with it). Host-ness is derived from the sentinel key
    // itself rather than a second stored flag, so there's one source of truth.
    const activeGroups = [...groups.entries()]
      .sort(
        ([keyA, a], [keyB, b]) =>
          hostRank(keyA === HOST_GROUP_KEY) - hostRank(keyB === HOST_GROUP_KEY) ||
          a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
      )
      .map(([, group]) => group);

    const recentGroups = [...this.#recentDirs.values()]
      .filter((d) => !groups.has(d.label) && d.label !== hostDirLabel)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, maxRecent)
      .map((d) => ({ title: d.label, directory: d.directory, items: [], recent: true, lastSeenAt: d.lastSeenAt }));

    return { groups: activeGroups, recentGroups };
  }

  #pruneRecentDirs() {
    if (this.#recentDirs.size <= Queue.MAX_RECENT_DIRS) return;
    const sorted = [...this.#recentDirs.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    while (this.#recentDirs.size > Queue.MAX_RECENT_DIRS) {
      this.#recentDirs.delete(sorted.shift()[0]);
    }
  }

  stats() {
    const active = this.items();
    const dismissed = this.dismissedItems();
    return {
      total: active.length,
      pending: active.filter((i) => !NON_PENDING.has(i.category)).length,
      completed: active.filter((i) => i.category === "completion").length,
      dismissed: dismissed.length,
    };
  }

  async save(filePath) {
    const data = {
      items: Object.fromEntries(this.#items),
      recentDirs: Object.fromEntries(this.#recentDirs),
    };
    await writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async load(filePath) {
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      if (data.items && typeof data.items === "object" && !Array.isArray(data.items)) {
        for (const [id, item] of Object.entries(data.items)) {
          this.#items.set(id, item);
        }
        if (data.recentDirs) {
          for (const [label, entry] of Object.entries(data.recentDirs)) {
            this.#recentDirs.set(label, entry);
          }
        }
      } else {
        for (const [id, item] of Object.entries(data)) {
          this.#items.set(id, item);
        }
      }
    } catch {
      // No saved state, start fresh
    }
  }
}
