import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

export function isNewer(remote, current) {
  if (!remote || !current) return false;
  const r = remote.split(".").map(Number);
  const c = current.split(".").map(Number);
  if (r.some(isNaN) || c.some(isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    if ((r[i] || 0) > (c[i] || 0)) return true;
    if ((r[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

export function extractChangelog(changelog, currentVersion) {
  if (!changelog || !currentVersion) return null;
  const marker = `## [${currentVersion}]`;
  const idx = changelog.indexOf(marker);
  if (idx === -1) return null;
  const slice = changelog.slice(0, idx).trim();
  const firstEntry = slice.indexOf("## [");
  if (firstEntry === -1) return null;
  return slice.slice(firstEntry).trim();
}

async function defaultGit(args) {
  if (args[0] === "fetch") {
    await execFileAsync("git", args, { cwd: PROJECT_ROOT });
    return "";
  }
  const { stdout } = await execFileAsync("git", args, { cwd: PROJECT_ROOT });
  return stdout;
}

export class UpdateChecker {
  #current;
  #git;
  #onUpdate = null;
  #interval = null;
  #state = { available: false, current: null, remote: null, changelog: null, checkedAt: null };

  constructor({ currentVersion, git } = {}) {
    this.#current = currentVersion || JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8")).version;
    this.#git = git || defaultGit;
    this.#state.current = this.#current;
  }

  get data() {
    return this.#state;
  }

  init(onUpdate) {
    this.#onUpdate = onUpdate;
    this.check();
    this.#interval = setInterval(() => this.check(), 1_800_000);
  }

  stop() {
    if (this.#interval) clearInterval(this.#interval);
  }

  async check() {
    try {
      await this.#git(["fetch", "origin", "master"]);
      const pkgJson = await this.#git(["show", "origin/master:package.json"]);
      const remote = JSON.parse(pkgJson).version;

      if (isNewer(remote, this.#current)) {
        const changelogMd = await this.#git(["show", "origin/master:CHANGELOG.md"]);
        this.#state = {
          available: true,
          current: this.#current,
          remote,
          changelog: extractChangelog(changelogMd, this.#current),
          checkedAt: Date.now(),
        };
      } else {
        this.#state = { available: false, current: this.#current, remote: null, changelog: null, checkedAt: Date.now() };
      }
    } catch {
      this.#state = { ...this.#state, available: false, checkedAt: Date.now() };
    }
    if (this.#onUpdate) this.#onUpdate();
  }
}
