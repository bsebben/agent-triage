// Screen fixtures for Claude Code panes, captured from live panes with
// `cmux read-screen --workspace <ref>` (the same path `src/cmux.js` uses) and then
// scrubbed of project, branch, and cost details. The layout is verbatim.
//
// What the real renderer does — and does not — do:
//   - The input box is a bare prompt line (`❯ …`) between two horizontal rules.
//     There are no vertical box-drawing borders anywhere on the screen.
//   - Transcript echoes of earlier submissions use the same `❯ ` shape as the
//     live input box, so only position distinguishes them: the input box is the
//     bottom-most prompt line, above the statusline.
//   - Slash-command autocomplete rows are indented two spaces and carry no
//     prompt glyph.

const RULE = "─".repeat(120);

const STATUSLINE = [
  "   ~/my-project ",
  "   ✱ Sonnet 5  ☉ $0.00 (0 tokens) 0%  ◔ 100,000 (50%) ",
  "  ⏵⏵ auto mode on (shift+tab to cycle)",
  "",
].join("\n");

function screen(...transcriptAndBox) {
  return [...transcriptAndBox, STATUSLINE].join("\n");
}

/** A freshly relaunched session sitting at an empty input box. */
export const IDLE = screen(
  "",
  "                                                            Update available! Run: brew upgrade claude-code@latest",
  RULE,
  "❯                                                                        ",
  RULE,
);

/** A pane with `text` typed into the input box, still unsubmitted. */
export const pendingInput = (text) => screen("⏺ Ready.", "", RULE, `❯ ${text}`, RULE);

/** A pane where `text` has been submitted: echoed into the transcript, box empty. */
export const submittedInput = (text) =>
  screen(`❯ ${text}`, "  ⎿  Picking up where it left off", "", RULE, "❯                    ", RULE);

/** The exited process printing its resume hint, before relaunch. */
export const EXITED_WITH_SESSION_ID = [
  "  Session limit reached. Resume this session with:",
  "",
  "  claude --resume abc12345-6789-4abc-8def-0123456789ab",
  "",
  "➜  my-project ",
  "",
].join("\n");

/** The exited process with no resume hint on screen. */
export const EXITED_WITHOUT_SESSION_ID = ["  no session info here", "", "➜  my-project ", ""].join("\n");

/**
 * `/reload-plugins` typed with the autocomplete dropdown still open — the state
 * that eats the first Enter. Note the older `❯ 4` transcript echo above it: the
 * input box is the *last* prompt line, not the first.
 */
export const PENDING_WITH_DROPDOWN = screen(
  "❯ 4",
  "  ⎿  SessionStart:resume says: ✓ MCP proxy: healthy",
  "",
  "  /reload-plugins                                                  Activate pending plugin changes in the current session",
  RULE,
  "❯ /reload-plugins",
  RULE,
);

/** `/reload-plugins` typed with the dropdown dismissed, still unsubmitted. */
export const PENDING_NO_DROPDOWN = screen(
  "⏺ Ready.",
  "",
  RULE,
  "❯ /reload-plugins",
  RULE,
);

/**
 * `/reload-plugins` submitted: it is echoed into the transcript with the same
 * `❯ ` shape while the live input box below is empty.
 */
export const SUBMITTED = screen(
  "❯ /reload-plugins",
  "  ⎿  Reloaded 3 plugins",
  "",
  RULE,
  "❯                                                                        ",
  RULE,
);

/** The dropdown accepted a different highlighted suggestion than we typed. */
export const DROPDOWN_ACCEPTED_OTHER = screen(
  "⏺ Ready.",
  "",
  RULE,
  "❯ /reload-plugins-force",
  RULE,
);

/** `/reload-skills` typed with the autocomplete dropdown still open. */
export const PENDING_WITH_DROPDOWN_SKILLS = screen(
  "❯ 4",
  "  ⎿  SessionStart:resume says: ✓ MCP proxy: healthy",
  "",
  "  /reload-skills                                                    Reload skill definitions from disk",
  RULE,
  "❯ /reload-skills",
  RULE,
);

/** `/reload-skills` typed with the dropdown dismissed, still unsubmitted. */
export const PENDING_NO_DROPDOWN_SKILLS = screen(
  "⏺ Ready.",
  "",
  RULE,
  "❯ /reload-skills",
  RULE,
);

/** `/reload-skills` submitted: echoed into the transcript, input box now empty. */
export const SUBMITTED_SKILLS = screen(
  "❯ /reload-skills",
  "  ⎿  Reloaded 5 skills",
  "",
  RULE,
  "❯                                                                        ",
  RULE,
);

/** The dropdown accepted a different highlighted suggestion than /reload-skills. */
export const DROPDOWN_ACCEPTED_OTHER_SKILLS = screen(
  "⏺ Ready.",
  "",
  RULE,
  "❯ /reload-skills-force",
  RULE,
);
