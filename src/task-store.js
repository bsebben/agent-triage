// src/task-store.js
import { writeFile, readFile } from "node:fs/promises";

/**
 * Persistent in-memory store for simple todo-list tasks.
 *
 * Each task is `{ id, title, done, createdAt }`. The store backs up to a
 * JSON file on disk via `save()` / `load()` and supports configurable
 * expiry (hide-only or permanent delete) of tasks older than a threshold.
 */
export class TaskStore {
  #items = new Map();
  #counter = 0;

  /**
   * Create a new task.
   *
   * Args:
   *   title: Free-form text description of the task.
   *
   * Returns:
   *   The newly created task object.
   */
  add(title) {
    const now = Date.now();
    const id = `t_${now}_${this.#counter++}`;
    const task = { id, title, done: false, createdAt: now };
    this.#items.set(id, task);
    return task;
  }

  /**
   * Get a task by ID.
   *
   * Args:
   *   id: The task ID to look up.
   *
   * Returns:
   *   The task object, or null if not found.
   */
  get(id) {
    return this.#items.get(id) || null;
  }

  /**
   * Toggle the done state of a task.
   *
   * Args:
   *   id: The task ID to toggle.
   *
   * Returns:
   *   The updated task, or null if not found.
   */
  toggle(id) {
    const task = this.#items.get(id);
    if (!task) return null;
    task.done = !task.done;
    return task;
  }

  /**
   * Remove a task permanently.
   *
   * Args:
   *   id: The task ID to remove.
   *
   * Returns:
   *   True if the task existed and was removed, false otherwise.
   */
  remove(id) {
    return this.#items.delete(id);
  }

  /**
   * List tasks, filtering out expired ones based on configuration.
   *
   * Args:
   *   maxAgeDays: Tasks older than this many days are considered expired.
   *     A value of 0 disables expiry entirely.
   *   expireBehavior: "hide" filters expired tasks from the returned list
   *     but keeps them in storage. "delete" permanently removes them.
   *
   * Returns:
   *   Array of tasks sorted by createdAt ascending, with done items last.
   */
  list(maxAgeDays, expireBehavior) {
    const cutoff = maxAgeDays > 0
      ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
      : 0;

    if (maxAgeDays > 0 && expireBehavior === "delete") {
      for (const [id, task] of this.#items) {
        if (task.createdAt < cutoff) this.#items.delete(id);
      }
    }

    const tasks = [...this.#items.values()];
    const visible = maxAgeDays > 0
      ? tasks.filter((t) => t.createdAt >= cutoff)
      : tasks;

    return visible.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * Persist all tasks to a JSON file.
   *
   * Args:
   *   filePath: Absolute path to write the JSON file.
   */
  async save(filePath) {
    const data = Object.fromEntries(this.#items);
    await writeFile(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * Load tasks from a JSON file, merging into current state.
   *
   * Args:
   *   filePath: Absolute path to read the JSON file from.
   */
  async load(filePath) {
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      for (const [id, task] of Object.entries(data)) {
        this.#items.set(id, task);
      }
    } catch {
      // No saved state, start fresh
    }
  }

  /** @internal Test helper: override createdAt for expiry tests. */
  _setCreatedAt(id, ts) {
    const task = this.#items.get(id);
    if (task) task.createdAt = ts;
  }

  /** @internal Test helper: return raw storage size (including hidden). */
  _size() {
    return this.#items.size;
  }
}
