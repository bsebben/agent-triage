---
name: config-migration
description: Author a config migration when the Agent Triage config shape changes. Use when someone says "add a config migration", "config shape changed", "migrate config", "the version-check config gate is failing", or is renaming/removing/retyping a config field.
allowed-tools: [Bash, Read, Edit]
---

# Config Migration

Agent Triage's `config.json` is user-owned and never touched by `git pull`. Additive
changes are safe, but **renames, moves, type changes, enum changes, and removals**
orphan the user's value unless a migration carries it forward. The PR-time gate
(`scripts/version-check.sh`) blocks any config-shape change that lacks a migration.

**The gate enforces; this skill authors.**

## When to run

- The version-check config gate failed with "config shape changed but no migration added."
- You renamed, moved, retyped, or removed a config field (in `DEFAULTS`, `FIELD_META`, or a tab module's `defaults`).

## Detect the shape change

Compare the live schema against the committed snapshot to see exactly which keys changed:

```bash
diff <(git show origin/master:config.shape.json) <(AGENT_TRIAGE_NO_BOOT=1 node scripts/config-snapshot.mjs --print)
```

- Lines removed from the old shape = keys you dropped or renamed away.
- Lines added in the new shape = keys you introduced or renamed to.

## Author the migration

1. **Add a migration step** to `src/migrations.js`. Append to the `migrations` array; the new
   step's `version` must be `previous length + 1` (sequential, no gaps). `CURRENT_CONFIG_VERSION`
   is derived from `migrations.length`, so no manual bump is needed.

   Stub (fill in from the detected key diff):

   ```js
   {
     version: 1,
     describe: "rename <oldKey> -> <newKey>",
     migrate(cfg) {
       const next = { ...cfg };
       // move / rename / retype the value, then delete the old key
       // e.g. next.newKey = next.oldKey; delete next.oldKey;
       return next;
     },
   },
   ```

   Migrations must be **pure** — return a new object, never mutate the input, never touch disk.

2. **Update `config.example.json`** to the new shape: add, rename, or remove the affected fields
   and set `configVersion` to the new `CURRENT_CONFIG_VERSION`. Fresh installs copy this file and
   must start already-current so they never re-migrate.

3. **Regenerate the snapshot** and commit it:

   ```bash
   npm run config-snapshot
   ```

4. **Add a `CHANGELOG.md` entry** describing the user-visible change, and **bump the package
   version** (minor for a new field, per the project's versioning rules):

   ```bash
   npm version minor --no-git-tag-version
   ```

## Verify

```bash
npm test            # migration + shape tests must pass
npm run version-check   # config gate must pass
```

The gate passes when: the committed `config.shape.json` matches the live schema, the
`config.example.json` `configVersion` equals `CURRENT_CONFIG_VERSION`, and any shape change
relative to `origin/master` is accompanied by an increased `configVersion`.
