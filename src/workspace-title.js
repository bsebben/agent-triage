import { execFile } from "node:child_process";
import { tmpdir } from "node:os";

const MAX_TITLE_LENGTH = 60;
const TIMEOUT_MS = 60_000;

export function buildTitlePrompt(id, text) {
  return `Write a short, descriptive title (5 words or fewer, excluding the id) for a ` +
    `workspace working on the item below. Start the title with "${id}: " and reply with ` +
    `the title only, no quotes or commentary. Example: '${id}: fix flaky session test'.\n\n` +
    `Item: ${text}`;
}

// Models occasionally wrap the reply in quotes or add a trailing explanation line; the
// id is re-attached when missing so the title stays cross-referenceable either way.
export function cleanTitle(raw, id) {
  const line = String(raw || "").split("\n").map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  let title = line.replace(/^["'`*]+|["'`*]+$/g, "").trim();
  if (!title) return null;
  if (!title.startsWith(id)) title = `${id}: ${title}`;
  return title.length > MAX_TITLE_LENGTH ? title.slice(0, MAX_TITLE_LENGTH).trim() : title;
}

// The dashboard host's CMUX_* variables are dropped so hooks in the headless call can't
// report against the host workspace.
function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("CMUX_")));
}

const defaultRun = (args) => new Promise((resolve, reject) => {
  execFile("claude", args, { cwd: tmpdir(), env: cleanEnv(), timeout: TIMEOUT_MS }, (err, stdout) =>
    err ? reject(err) : resolve(stdout));
});

// Generates a title outside the dispatched session so it never spends a turn on it.
// Best-effort: any failure resolves null and the placeholder name stays.
export async function generateTitle(id, text, run = defaultRun) {
  try {
    // No tools and no persisted session: the item text is untrusted input, and each
    // dispatch would otherwise leave a throwaway transcript behind. Project-only settings
    // keep user hooks and personas from colouring a one-line reply.
    const stdout = await run([
      "-p", "--model", "haiku", "--setting-sources", "project",
      "--no-session-persistence", "--tools", "",
      "--", buildTitlePrompt(id, text),
    ]);
    return cleanTitle(stdout, id);
  } catch {
    return null;
  }
}
