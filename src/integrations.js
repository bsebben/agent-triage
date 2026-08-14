// src/integrations.js
//
// Registry of consent-gated integrations: optional features that change state
// outside Agent Triage's own footprint (e.g. a global Claude Code hook) and so
// must never be enabled without an explicit user action. Status is always read
// live from the actual system state — never cached — so a partial failure or
// an external change to that state can't leave the UI showing something that
// isn't actually true.
//
// Each integration owns its own install/uninstall script, invoked with the
// same DI convention used by src/worktree.js/src/update-checker.js: pass
// execFileFn to swap in a test double, otherwise a real promisified execFile.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

export const INTEGRATIONS = [
  {
    id: "worktree-hook",
    name: "Worktree indicator hook",
    description:
      "Keeps the worktree pill accurate when an agent calls EnterWorktree/ExitWorktree in place, not just when a pane is opened directly at a worktree path.",
    warning:
      "Registers a global Claude Code hook in ~/.claude/settings.json — affects every Claude Code session on this machine, not just ones Agent Triage tracks.",
    installScript: "bin/install-worktree-hook.sh",
    uninstallScript: "bin/uninstall-worktree-hook.sh",
  },
];

function findIntegration(id) {
  const integration = INTEGRATIONS.find((i) => i.id === id);
  if (!integration) throw new Error(`Unknown integration: ${id}`);
  return integration;
}

async function run(scriptPath, args, execFileFn) {
  const exec = execFileFn ? promisify(execFileFn) : execFileAsync;
  await exec(join(PROJECT_ROOT, scriptPath), args);
}

/** Live status check — never cached. Returns false on any failure (missing
 * script, missing `jq`, not installed) rather than throwing, since "can't
 * confirm it's enabled" and "confirmed not enabled" both mean the same thing
 * to a caller deciding what to show. */
export async function status(id, { execFileFn } = {}) {
  const integration = findIntegration(id);
  try {
    await run(integration.installScript, ["--check"], execFileFn);
    return true;
  } catch {
    return false;
  }
}

export async function enable(id, { execFileFn } = {}) {
  const integration = findIntegration(id);
  try {
    await run(integration.installScript, [], execFileFn);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function disable(id, { execFileFn } = {}) {
  const integration = findIntegration(id);
  try {
    await run(integration.uninstallScript, [], execFileFn);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
