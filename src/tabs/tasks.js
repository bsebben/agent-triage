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
const store = new TaskStore();

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
  tab.enabled = cfg.enabled;
  tab.available = true;
  tab.hint = null;

  console.log(`Config: tasks ${cfg.enabled ? "enabled" : "disabled"}`);
  if (!cfg.enabled) return;

  await store.load(tab._dataPath);
}

const tab = {
  enabled: false,
  available: true,
  hint: null,
  _dataPath: null,
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
  /**
   * Get the underlying TaskStore instance.
   *
   * Returns:
   *   The TaskStore used by this tab.
   */
  get store() { return store; },
  /**
   * Get the resolved tab config.
   *
   * Returns:
   *   The merged config object, or undefined before init() is called.
   */
  get cfg() { return cfg; },
  init,
};

export default tab;
