// src/queue.js
import { writeFile, readFile } from "node:fs/promises";

const PRIORITY = { error: 0, permission: 1, waiting: 2, question: 2, completion: 3, running: 5, unknown: 4 };

import { homedir } from "node:os";

const HOME = homedir();

function dirLabel(dir) {
  if (!dir || dir === HOME) return "~";
  if (dir.startsWith(HOME + "/")) return "~/" + dir.slice(HOME.length + 1);
  return dir;
}

export class Queue {
  #items = new Map();

  upsert(item) {
    const existing = this.#items.get(item.id);
    this.#items.set(item.id, {
      ...existing,
      ...item,
      dismissed: false,
      dismissedAt: null,
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

  grouped() {
    const groups = new Map();
    for (const item of this.items()) {
      const dir = item.workspaceDir || "Unknown";
      const label = dirLabel(dir);
      if (!groups.has(label)) {
        groups.set(label, { title: label, directory: dir, items: [] });
      }
      groups.get(label).items.push(item);
    }
    return [...groups.values()];
  }

  stats() {
    const active = this.items();
    const dismissed = this.dismissedItems();
    return {
      total: active.length,
      pending: active.filter((i) => i.category !== "completion").length,
      completed: active.filter((i) => i.category === "completion").length,
      dismissed: dismissed.length,
    };
  }

  async save(filePath) {
    const data = Object.fromEntries(this.#items);
    await writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async load(filePath) {
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      for (const [id, item] of Object.entries(data)) {
        this.#items.set(id, item);
      }
    } catch {
      // No saved state, start fresh
    }
  }
}
