# PR/Ticket Action Drawer — Design

**Status:** approved, awaiting implementation plan
**Date:** 2026-04-28

## Problem

Today each row on the Pull Requests and Tickets tabs has a single Claude-icon button that spawns an agent workspace with a fixed prompt ("status update"). Users want different actions per row — review the PR, address comments, update the description, investigate a ticket, start work — without leaving the dashboard.

## Goal

Replace the single-action button with a side drawer. Each PR or ticket row's icon opens a drawer showing item metadata on the right and a vertical action menu on the left. Clicking an action fires it immediately and spawns an agent workspace with a tailored prompt. Skill-backed actions degrade gracefully when the relevant plugin/skill isn't installed.

## Non-goals

- Auto-detecting installed plugins on the server side — addressed by prompt-level fallback
- Filtering the action menu by row state (CI status, unread comments, ticket status) — always show all
- Keyboard navigation between tabs (mouse only for v1)
- Browser-history integration / deep linking to a specific drawer

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

Single source of truth for what actions exist. Exports:

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

Action object schema: `{ id: string, label: string, prompt: (item) => string }`. `id` is stable (used as DOM data attribute). `prompt` is a function so each row passes its own data.

### `public/action-drawer.js` (new)

Drawer controller. Exports a single function:

```js
export function openActionDrawer(item, type) {
  // type: "pr" | "ticket"
  // 1. If a drawer already exists, replace its content
  // 2. Otherwise create the drawer element and append to <body>
  // 3. Render: vertical action tabs (left) + metadata pane (right)
  // 4. Tab click: POST /api/agent-workspace with action.prompt(item) and close
  // 5. Outside click / Escape / X button: close
}
```

One drawer instance at a time — opening another replaces the first.

### Tab integration

`tab-pulls.js` and `tab-tickets.js` keep their existing row markup. The agent icon button's `onclick` swaps from `openInAgentFromBtn(this)` to `openActionDrawer(item, type)`.

The row's outer click (open in browser) is **preserved** — only the icon click is repurposed.

### Backend

Unchanged. `/api/agent-workspace` continues to accept `{ prompt, repo }`. All drawer-side logic is frontend-only.

## UI

### Layout

The drawer slides in from the right edge of the viewport:

```
┌──── dashboard ────┬──── PR drawer ───────┐
│ Mine (3)          │ #142 [×]              │
│   #142 ...   [icn]│ ┌────────┬───────────┐│
│   #143 ...   [icn]│ │ Status │ Title:    ││
│   #144 ...   [icn]│ │ Review │ Author:   ││
│                   │ │ Refine │ Status:   ││
│                   │ │ Update │ CI:       ││
│                   │ └────────┴───────────┘│
└───────────────────┴──────────────────────┘
```

- Width: ~420px, fixed
- Slides in via CSS transform; click-outside or Escape closes
- Header: item key/number + close (×) button
- Body: two columns — `.drawer-tabs` (left, ~140px) and `.drawer-detail` (right, fills remainder)

### PR metadata fields

Shown in `.drawer-detail` for PR rows. Limited to what the existing `/api/queue` payload already provides — adding fields like "last updated" or "review threads" would require backend changes (out of scope for v1):

- Title
- Number + repo (already grouped by repo)
- Author
- Status (open / draft / comments / approved)
- CI (passing / failing / running)
- Branch (`headRefName`)

Plus an "Open in GitHub" link at the bottom for explicit access (since row click already does this, the link is a redundant convenience).

### Ticket metadata fields

Shown in `.drawer-detail` for ticket rows. Same scope rule — only fields already in the payload:

- Key + summary
- Status (e.g. To Do / In Progress / Done)
- Type (Story / Bug / Task)
- Parent key + summary, when present (already grouped by parent)

Plus an "Open in Jira" link at the bottom.

### Markup

```html
<div class="action-drawer" data-type="pr">
  <div class="drawer-header">
    <span class="drawer-title">#142 — Add per-row Claude-icon button</span>
    <button class="drawer-close" aria-label="Close">×</button>
  </div>
  <div class="drawer-body">
    <div class="drawer-tabs" role="menu">
      <button class="drawer-tab" data-action-id="status">Status update</button>
      <button class="drawer-tab" data-action-id="review">Review the PR</button>
      <button class="drawer-tab" data-action-id="refine">Address review comments</button>
      <button class="drawer-tab" data-action-id="taskPr">Update PR description</button>
    </div>
    <div class="drawer-detail">
      <!-- metadata fields -->
    </div>
  </div>
</div>
```

### Behavior

- Click `.agent-btn` on a row → drawer opens or replaces content
- Click `.drawer-tab` → POST `/api/agent-workspace` with that action's prompt, close drawer
- Click `.drawer-close`, click outside the drawer, or press Escape → close
- Single instance — opening another row's drawer replaces content (no animation reset)
- Drawer stays open across polling refreshes; if the same item is in the new state, metadata refreshes; if it's gone (e.g., PR closed), drawer closes

### Styling

Appended to `public/style.css`. Uses existing CSS variables. Approximate:

```css
.action-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -4px 0 16px rgba(0,0,0,0.4);
  z-index: 200;
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.2s ease;
}
.action-drawer.open { transform: translateX(0); }

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.drawer-close {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 20px;
  cursor: pointer;
}

.drawer-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.drawer-tabs {
  width: 140px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 8px 0;
}

.drawer-tab {
  background: transparent;
  border: none;
  color: var(--text);
  text-align: left;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 13px;
  border-left: 2px solid transparent;
}

.drawer-tab:hover {
  background: var(--card);
  border-left-color: var(--text-dim);
}

.drawer-detail {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  font-size: 13px;
}

.drawer-detail .meta-field {
  margin-bottom: 8px;
}

.drawer-detail .meta-label {
  color: var(--text-dim);
  margin-right: 8px;
}
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

1. Click PR icon → drawer slides in from right with PR metadata + action tabs
2. Click each PR action — verify a fresh cmux workspace spawns with the right command and drawer closes
3. Click outside / press Escape / click × — drawer closes
4. Click another row's icon while drawer is open — content replaces (no reopen animation glitch)
5. Click a row body (not the icon) — opens in browser as before, drawer not affected
6. Repeat for ticket rows
7. Leave drawer open across a poll cycle (~2 min for PRs) — metadata refreshes when the same item is in the new payload; if the item disappears, drawer closes

Existing tests (`cmux.test.js`, `monitor.test.js`, `queue.test.js`) stay untouched.

## Versioning & changelog

Minor bump (new feature, no breaking changes): `1.4.0` → `1.5.0`. CHANGELOG entry under `Added`:

> - Per-row action drawer on Pull Requests and Tickets tabs — clicking the Claude icon opens a side drawer with item metadata and a vertical action menu (status, review, address comments, update description for PRs; investigate, start work for tickets)
> - Skill-backed actions fall back to plain-language instructions when the skill isn't installed

## Files changed

- `public/actions.js` — new
- `public/action-drawer.js` — new
- `public/tab-pulls.js` — swap icon button onclick to `openActionDrawer(pr, 'pr')`
- `public/tab-tickets.js` — swap icon button onclick to `openActionDrawer(ticket, 'ticket')`
- `public/style.css` — append `.action-drawer` and child rules
- `package.json` — bump to 1.5.0
- `CHANGELOG.md` — add 1.5.0 section

## Open questions

None — all clarifying questions resolved during brainstorming.
