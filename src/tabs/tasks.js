// src/tabs/tasks.js — Tab module: persistent task list
import { TaskStore } from "../task-store.js";

/**
 * @module tasks
 *
 * Tab module for a persistent, locally-managed task list.
 *
 * Unlike polling tabs, tasks are mutated exclusively via REST API calls
 * (POST /api/tasks, PATCH /api/tasks/:id, DELETE /api/tasks/:id).
 * No background polling is required.
 *
 * Public API:
 *   - defaults (named export): default config values for this tab
 *   - default (tab object): tab with enabled, available, hint, data getter, init()
 */

export const defaults = {
  enabled: false,
  maxAgeDays: 7,
  expireBehavior: "hide",
};

let cfg;
let dataPath;

export const store = new TaskStore();

/**
 * Persist tasks to disk.
 *
 * Returns:
 *   Promise that resolves when the save completes.
 */
export function save() {
  if (dataPath) return store.save(dataPath);
  return Promise.resolve();
}

/**
 * Initialize the tasks tab.
 *
 * Loads persisted tasks from disk. Unlike other tabs, this module does not
 * poll — tasks are locally managed and mutated via REST API calls.
 *
 * Args:
 *   tabConfig: Tab-specific config merged with defaults.
 *   onUpdate: Callback to broadcast state via WebSocket.
 */
async function init(tabConfig, onUpdate) {
  cfg = { ...defaults, ...tabConfig };
  dataPath = tabConfig._dataPath || null;
  tab.enabled = cfg.enabled;
  tab.available = true;
  tab.hint = null;

  console.log(`Config: tasks ${cfg.enabled ? "enabled" : "disabled"}`);
  if (!cfg.enabled) return;

  if (dataPath) await store.load(dataPath);
}

const tab = {
  enabled: false,
  available: true,
  hint: null,
  /**
   * Get the current list of tasks, filtered by expiry config.
   *
   * Returns:
   *   Sorted array of task objects, or empty array if not yet initialized.
   */
  get data() {
    if (!cfg) return [];
    return store.list(cfg.maxAgeDays, cfg.expireBehavior);
  },
  init,
};

export default tab;
