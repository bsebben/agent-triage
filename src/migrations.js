// src/migrations.js
//
// Forward-only config migrations keyed by an integer `configVersion`.
// Each step transforms a config object from `version - 1` to `version`.
// The runner is pure (no disk I/O) so it can be unit-tested in isolation;
// the load-time backup + write side effects live in config.js `maybeMigrate`.

/**
 * Ordered migration steps. Each entry:
 *   { version: N, describe: string, migrate(cfg) => newCfg }
 *
 * Rules enforced by tests:
 *   - versions are sequential starting at 1 (migrations[i].version === i + 1)
 *   - migrate() must be pure and return a new object (no mutation)
 *
 * Ships empty: the machinery is inert until the first config-shape change
 * adds step 1.
 */
export const migrations = [];

export const CURRENT_CONFIG_VERSION = migrations.length;

/**
 * Apply every migration step with version > `from`, in ascending order.
 * Returns a new config object; the input is never mutated.
 */
export function runMigrations(cfg, from = 0) {
  let result = { ...cfg };
  for (const step of migrations) {
    if (step.version > from) {
      result = step.migrate(result);
    }
  }
  return result;
}
