// src/queue.js
import { writeFile, readFile } from "node:fs/promises";

const PRIORITY = { error: 0, permission: 1, waiting: 2, question: 2, completion: 3, unknown: 4, running: 5, terminal: 6 };
const NON_PENDING = new Set(["completion", "running", "terminal"]);

import { homedir } from "node:os";

const HOME = homedir();

function dirLabel(dir) {
  if (!dir || dir === HOME) return "~";
  if (dir.startsWith(HOME + "/")) return "~/" + dir.slice(HOME.length + 1);
  return dir;
}

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
      .sort((a, b) => (PRIORITY[a.category] ?? 99) - (PRIORITY[b.category] ?? 99));
  }

  dismissedItems() {
    return [...this.#items.values()]
      .filter((i) => i.dismissed)
      .sort((a, b) => (b.dismissedAt || 0) - (a.dismissedAt || 0));
  }

  get recentDirCount() {
    return this.#recentDirs.size;
  }

  grouped(maxGroups = 8) {
    const groups = new Map();
    for (const item of this.items()) {
      const dir = item.workspaceDir || "Unknown";
      const label = dirLabel(dir);
      if (!groups.has(label)) {
        groups.set(label, { title: label, directory: dir, items: [] });
      }
      groups.get(label).items.push(item);
    }

    const now = Date.now();
    for (const [label, group] of groups) {
      this.#recentDirs.set(label, { label, directory: group.directory, lastSeenAt: now });
    }
    this.#pruneRecentDirs();

    const activeGroups = [...groups.values()].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
    );

    const recentSlots = Math.max(0, maxGroups - activeGroups.length);
    const recentGroups = [...this.#recentDirs.values()]
      .filter((d) => !groups.has(d.label))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, recentSlots)
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
