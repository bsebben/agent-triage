# PR/Ticket Action Menu — Design

**Status:** approved, awaiting implementation plan
**Date:** 2026-04-28

## Problem

Today each row on the Pull Requests and Tickets tabs has a single Claude-icon button that spawns an agent workspace with a fixed prompt ("status update"). Users want different actions per row — review the PR, address comments, update the description, investigate a ticket, start work — without leaving the dashboard.

## Goal

Replace the single-action button with a small dropdown menu of context-appropriate actions. Each action spawns an agent workspace with a tailored prompt. Skill-backed actions degrade gracefully when the relevant plugin/skill isn't installed.

## Non-goals

- Auto-detecting installed plugins on the server side (out of scope for v1; addressed by prompt-level fallback)
- Filtering the menu by row state (CI status, unread comments, ticket status) — always show all
- Keyboard navigation in the menu (mouse only for v1)

## Action invocation model

Each action carries a single prompt string. When the action wants a slash command, the prompt names it explicitly with plain-language fallback baked in. Example:

> Use `/review-artisan:appraise <url>` to do a thorough PR review. If the skill isn't installed, walk through the PR yourself: read the diff file by file, flag simplifications, quality issues, missing tests.

Claude in the new workspace runs the skill if registered; otherwise it follows the fallback prose. No schema split, no server-side plugin detection.

## Action set

Always show all actions for a type — no filtering by ownership, status, or any other signal.

### PR actions

| id | Label | Skill | Notes |
|---|---|---|---|
| `status` | Status update | (none) | Current default. Quick state summary, no code review. |
| `review` | Review the PR | `/review-artisan:appraise` | Thorough PR review, with manual review fallback. |
| `refine` | Address review comments | `/review-artisan:refine` | Walk through comments, propose fixes. |
| `taskPr` | Update PR description | `/task-pr` | Personal skill — fallback writes description in Brian's style. |

### Ticket actions

| id | Label | Skill | Notes |
|---|---|---|---|
| `investigate` | Investigate and plan | (none) | Read ticket, sketch implementation plan, no coding yet. |
| `taskStart` | Start work on it | `/task-start` | Personal skill — fallback creates branch and reads ticket. |

## Architecture

### `public/actions.js` (new)

Single source of truth. Exports two arrays:

```js
export const prActions = [
  { id, label, prompt: (pr) => string },
  ...
];

export const ticketActions = [
  { id, label, prompt: (ticket) => string },
  ...
];
```

Action object schema: `{ id: string, label: string, prompt: (item) => string }`.

`id` is stable (used as DOM data attribute and CSS hook). `prompt` is a function so each row passes its own data.

### `public/action-menu.js` (new)

Small popover helper. Exports:

```js
export function openActionMenu(triggerBtn, actions, item, repo) {
  // 1. Close any open menu
  // 2. Build a single global menu element appended to <body>
  // 3. Position absolutely below triggerBtn using getBoundingClientRect()
  // 4. On action click: POST /api/agent-workspace { prompt: action.prompt(item), repo }, then close
  // 5. On click-outside or Escape: close
}
```

One menu instance at a time. Opening a new one closes the previous.

### Tab integration

`tab-pulls.js` and `tab-tickets.js` import their respective action arrays and `openActionMenu`. The button's `onclick` becomes:

```js
onclick="event.stopPropagation(); openActionMenuFromBtn(this)"
```

`openActionMenuFromBtn` is a small wrapper defined in each tab file (or the menu helper). It reads the row's `data-*` attributes (item identifying info), looks up the matching item in the visible state, and calls `openActionMenu(btn, prActions, item, repo)`.

### Backend

Unchanged. `/api/agent-workspace` continues to accept `{ prompt, repo }` and spawn the workspace. All action specifics live on the frontend.

## UI

### Markup

Rendered dynamically into `<body>`:

```html
<div class="action-menu" role="menu">
  <button class="action-item" data-action-id="status">Status update</button>
  <button class="action-item" data-action-id="review">Review the PR</button>
  ...
</div>
```

### Behavior

- Click `.agent-btn` → menu appears below it
- Click outside or press Escape → menu closes
- Click an `.action-item` → POST and close
- Open menu on a different row → previous closes, new opens

### Styling

Appended to `public/style.css`. Uses existing CSS variables (`--surface`, `--card`, `--border`, `--text`, `--text-dim`):

```css
.action-menu { position: absolute; z-index: 100; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); padding: 4px; min-width: 180px; display: flex; flex-direction: column; }
.action-menu .action-item { background: transparent; border: none; color: var(--text); text-align: left; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 13px; white-space: nowrap; }
.action-menu .action-item:hover { background: var(--card); }
```

## Action prompts

### PR

```js
status: (pr) =>
  `Give me a quick status update on this PR: ${pr.url}

Don't review or analyze the code — just summarize the current state (open/draft/merged, CI, review status, recent activity, my role on it). Then ask what I'd like to do next.`,

review: (pr) =>
  `Use \`/review-artisan:appraise ${pr.url}\` to do a thorough PR review.

If the skill isn't installed, walk through the PR yourself: read the diff file by file, flag simplifications, quality issues, missing tests, and call out anything risky.`,

refine: (pr) =>
  `Use \`/review-artisan:refine ${pr.url}\` to walk through review comments and address them.

If the skill isn't installed, fetch the PR's review comments via \`gh api\`, walk through each one, propose a fix with reasoning, and ask before editing.`,

taskPr: (pr) =>
  `Use \`/task-pr\` to update this PR's description in my style: ${pr.url}

If the skill isn't installed, look at the diff and commits, draft a description with a short summary, Changes section if relevant, and Testing section (Local or unit tests). Don't include AI attribution.`,
```

### Ticket

```js
investigate: (ticket) =>
  `Investigate this ticket and propose an implementation plan: ${ticket.key} - ${ticket.summary}

${ticket.url}

Read the description and comments, look at related code in the workspace, then sketch a plan: which files change, what tests are needed, and any open questions before starting. Don't start coding yet.`,

taskStart: (ticket) =>
  `Use \`/task-start ${ticket.key}\` to begin work on this ticket.

If the skill isn't installed, create a feature branch named after the ticket, read the ticket details, set up commit context, and offer a brief implementation plan before coding. Ticket: ${ticket.url}`,
```

## Testing

No new server-side logic, so no additions to `test/`. Manual verification before merge:

1. Click PR icon → menu opens below button
2. Click each PR action — verify a fresh cmux workspace spawns with the right command
3. Click outside / press Escape — menu closes
4. Open menu on row A, click icon on row B — first menu closes, new one opens for row B
5. Repeat for ticket actions

Existing tests (`cmux.test.js`, `monitor.test.js`, `queue.test.js`) stay untouched.

## Versioning & changelog

Minor bump (new feature, no breaking changes): `1.4.0` → `1.5.0`. CHANGELOG entry under `Added`:

> - Per-row action menu on Pull Requests and Tickets tabs — pick from status, review, address comments, update description (PRs); investigate, start work (tickets)
> - Skill-backed actions fall back to plain-language instructions when the skill isn't installed

## Files changed

- `public/actions.js` — new
- `public/action-menu.js` — new
- `public/tab-pulls.js` — switch onclick to `openActionMenuFromBtn`, import shared array
- `public/tab-tickets.js` — same
- `public/style.css` — append `.action-menu` rules
- `package.json` — bump to 1.5.0
- `CHANGELOG.md` — add 1.5.0 section

## Open questions

None — all clarifying questions resolved during brainstorming.
