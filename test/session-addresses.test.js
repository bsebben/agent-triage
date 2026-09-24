// test/session-addresses.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionAddresses, ADDRESS_TTL_MS } from "../src/session-addresses.js";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const INSTALL_SCRIPT = join(PROJECT_ROOT, "bin/install-session-address-hook.sh");
const HOOK_SCRIPT = join(PROJECT_ROOT, "bin/hooks/session-address.sh");

describe("SessionAddresses", () => {
  it("returns the address a session registered for its tty", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "agent-triage-b7 [40e5ca]");
    assert.equal(registry.get("ttys012"), "agent-triage-b7 [40e5ca]");
  });

  it("returns null for a tty that never registered", () => {
    const registry = new SessionAddresses();
    assert.equal(registry.get("ttys012"), null);
  });

  it("ignores a registration missing a tty or an address", () => {
    const registry = new SessionAddresses();
    registry.register("", "agent-triage-b7 [40e5ca]");
    registry.register("ttys012", "");
    assert.equal(registry.size, 0);
  });

  it("re-registering the same tty replaces the address", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "old-name [aaaaaa]");
    registry.register("ttys012", "new-name [bbbbbb]");
    assert.equal(registry.size, 1);
    assert.equal(registry.get("ttys012"), "new-name [bbbbbb]");
  });

  it("keeps two sessions that share a name apart, since each has its own tty", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "agent-triage-b7 [40e5ca]");
    registry.register("ttys013", "agent-triage-b7 [91fd22]");
    assert.equal(registry.get("ttys012"), "agent-triage-b7 [40e5ca]");
    assert.equal(registry.get("ttys013"), "agent-triage-b7 [91fd22]");
  });

  it("treats a registration older than the TTL as absent", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "agent-triage-b7 [40e5ca]", 0);
    assert.equal(registry.get("ttys012", ADDRESS_TTL_MS - 1), "agent-triage-b7 [40e5ca]");
    assert.equal(registry.get("ttys012", ADDRESS_TTL_MS + 1), null);
  });

  it("a heartbeat keeps a registration inside the TTL", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "agent-triage-b7 [40e5ca]", 0);
    assert.equal(registry.heartbeat("ttys012", ADDRESS_TTL_MS - 1), true);
    assert.equal(registry.get("ttys012", ADDRESS_TTL_MS + 1), "agent-triage-b7 [40e5ca]");
  });

  it("a heartbeat for an unknown tty reports that there was nothing to refresh", () => {
    const registry = new SessionAddresses();
    assert.equal(registry.heartbeat("ttys012"), false);
    // Crucially it does not conjure an address-less entry.
    assert.equal(registry.size, 0);
  });

  it("unregister drops the address immediately", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "agent-triage-b7 [40e5ca]");
    assert.equal(registry.unregister("ttys012"), true);
    assert.equal(registry.get("ttys012"), null);
  });

  it("prune drops registrations whose tty cmux no longer reports", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "still-here [40e5ca]");
    registry.register("ttys013", "pane-closed [91fd22]");
    assert.equal(registry.prune(new Set(["ttys012"])), 1);
    assert.equal(registry.get("ttys012"), "still-here [40e5ca]");
    assert.equal(registry.get("ttys013"), null);
  });

  it("prune keeps a registration whose pane is still live past the TTL, so a long autonomous run keeps its address", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "agent-triage-b7 [40e5ca]", 0);
    // An hour into a single prompt: no heartbeat has fired, but cmux still
    // reports the pane, which is the liveness fact that counts.
    assert.equal(registry.prune(new Set(["ttys012"]), ADDRESS_TTL_MS * 6), 0);
    assert.equal(registry.get("ttys012", ADDRESS_TTL_MS * 6), "agent-triage-b7 [40e5ca]");
  });

  it("prune expires an entry only once cmux has stopped reporting it", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "agent-triage-b7 [40e5ca]", 0);
    assert.equal(registry.prune(new Set([]), 1), 1);
    assert.equal(registry.size, 0);
  });

  it("prune accepts a plain array of ttys", () => {
    const registry = new SessionAddresses();
    registry.register("ttys012", "agent-triage-b7 [40e5ca]");
    assert.equal(registry.prune(["ttys012"]), 0);
    assert.equal(registry.prune([]), 1);
  });
});

// The Integrations contract: --check reports live status and has no side
// effects. Pointed at a throwaway settings file via CLAUDE_SETTINGS_PATH so it
// never reads or writes the real ~/.claude/settings.json.
describe("install-session-address-hook.sh --check", () => {
  async function checkAgainst(settings) {
    const dir = await mkdtemp(join(tmpdir(), "agent-triage-hook-"));
    const settingsPath = join(dir, "settings.json");
    if (settings !== null) await writeFile(settingsPath, JSON.stringify(settings));
    try {
      await execFileAsync(INSTALL_SCRIPT, ["--check"], { env: { ...process.env, CLAUDE_SETTINGS_PATH: settingsPath } });
      return true;
    } catch {
      return false;
    }
  }

  const hookEntry = (mode) => [{ matcher: "", hooks: [{ type: "command", command: `${HOOK_SCRIPT} ${mode}` }] }];

  it("reports not installed when there is no settings file at all", async () => {
    assert.equal(await checkAgainst(null), false);
  });

  it("reports not installed for a settings file with no hooks", async () => {
    assert.equal(await checkAgainst({}), false);
  });

  it("reports not installed when only some of the three hooks are registered", async () => {
    assert.equal(await checkAgainst({ hooks: { SessionStart: hookEntry("--announce") } }), false);
  });

  it("reports installed once all three hooks are registered", async () => {
    const installed = await checkAgainst({
      hooks: {
        SessionStart: hookEntry("--announce"),
        UserPromptSubmit: hookEntry("--heartbeat"),
        SessionEnd: hookEntry("--end"),
      },
    });
    assert.equal(installed, true);
  });

  it("recognizes hooks that share an entry with someone else's", async () => {
    const shared = (mode) => [
      {
        matcher: "",
        hooks: [
          { type: "command", command: "/somewhere/else/other-hook.sh" },
          { type: "command", command: `${HOOK_SCRIPT} ${mode}` },
        ],
      },
    ];
    const installed = await checkAgainst({
      hooks: {
        SessionStart: shared("--announce"),
        UserPromptSubmit: shared("--heartbeat"),
        SessionEnd: shared("--end"),
      },
    });
    assert.equal(installed, true);
  });
});

// Whether the announce actually lands is up to the model and the user's
// permission answer, so the ask has to give up rather than reappear on every
// prompt for the life of the session. Run against a copy of the hook with a
// stub curl on PATH and a stub tty resolver, so nothing here touches a real
// dashboard or a real pane.
describe("session-address.sh announce attempts", () => {
  async function hookSandbox() {
    const dir = await mkdtemp(join(tmpdir(), "agent-triage-announce-"));
    await mkdir(join(dir, "bin/hooks/lib"), { recursive: true });
    await mkdir(join(dir, "stub"), { recursive: true });
    await mkdir(join(dir, "state"), { recursive: true });
    await copyFile(HOOK_SCRIPT, join(dir, "bin/hooks/session-address.sh"));
    await writeFile(join(dir, "bin/hooks/lib/resolve-pane-tty.sh"), 'resolve_pane_tty() { printf "%s" "ttys777"; }\n');
    await writeFile(join(dir, "config.json"), JSON.stringify({ port: 7919 }));
    const curl = join(dir, "stub/curl");
    await writeFile(curl, '#!/bin/bash\nprintf "%s" "{\\"ok\\":true,\\"known\\":${STUB_KNOWN:-false}}"\n');
    await chmod(curl, 0o755);

    const hook = join(dir, "bin/hooks/session-address.sh");
    return async function run(mode, { known = false } = {}) {
      const stdout = await new Promise((resolve, reject) => {
        const child = execFile(
          "bash",
          [hook, mode],
          {
            env: { ...process.env, PATH: `${join(dir, "stub")}:${process.env.PATH}`, TMPDIR: join(dir, "state"), STUB_KNOWN: String(known) },
          },
          (err, out) => (err ? reject(err) : resolve(out))
        );
        // The hook reads the Claude Code hook payload off stdin, so it has to
        // be written and closed or the hook waits forever.
        child.stdin.end('{"transcript_path":"/tmp/session.jsonl"}');
      });
      return stdout.includes("additionalContext") ? "announced" : "silent";
    };
  }

  it("stops asking after a few unanswered attempts", async () => {
    const run = await hookSandbox();
    assert.equal(await run("--announce"), "announced");
    assert.equal(await run("--heartbeat"), "announced");
    assert.equal(await run("--heartbeat"), "announced");
    assert.equal(await run("--heartbeat"), "silent");
    assert.equal(await run("--heartbeat"), "silent");
  });

  it("a successful registration resets the budget, so a later server restart can re-ask", async () => {
    const run = await hookSandbox();
    await run("--announce");
    await run("--heartbeat");
    await run("--heartbeat");
    assert.equal(await run("--heartbeat"), "silent");

    assert.equal(await run("--heartbeat", { known: true }), "silent");
    assert.equal(await run("--heartbeat"), "announced");
  });

  it("a new session in the same pane starts from a clean budget", async () => {
    const run = await hookSandbox();
    await run("--announce");
    await run("--heartbeat");
    await run("--heartbeat");
    assert.equal(await run("--heartbeat"), "silent");

    assert.equal(await run("--announce"), "announced");
    assert.equal(await run("--heartbeat"), "announced");
  });
});
