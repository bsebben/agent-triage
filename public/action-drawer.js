// public/action-drawer.js — side drawer with vertical action tabs and item metadata

let drawerEl = null;
let closeDrawer = null;

function findPrByUrl(url) {
  const pulls = state.pulls || { mine: [], reviews: [], merged: [] };
  for (const list of [pulls.mine, pulls.reviews, pulls.merged]) {
    for (const group of list) {
      for (const pr of group.prs) {
        if (pr.url === url) return { item: pr, repo: group.repo };
      }
    }
  }
  return null;
}

function findTicketByKey(key) {
  for (const group of state.tickets || []) {
    for (const t of group.tickets) {
      if (t.key === key) return { item: t };
    }
  }
  return null;
}

function externalLinkIcon() {
  return `<svg class="external-link-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3h3v3"/><path d="M13 3l-6 6"/><path d="M11 9v3.5A1.5 1.5 0 0 1 9.5 14h-6A1.5 1.5 0 0 1 2 12.5v-6A1.5 1.5 0 0 1 3.5 5H7"/></svg>`;
}

// Real href (not "#") so middle-click, right-click "copy link"/"open in new tab", and
// hover-preview all work even when the onclick's window-reuse flow can't run for some
// reason. openExternalClick (src/tabs/pulls.client.js) leaves cmd/ctrl/shift-click alone
// so they still get the browser's native new-tab/new-window behaviour.
function renderExternalLink(url, label) {
  return `<a class="external-link" href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Opens in new tab" onclick="openExternalClick(event, '${escapeHtml(url)}')">${escapeHtml(label)}${externalLinkIcon()}</a>`;
}

function renderPrMeta(pr, repo) {
  return `
    <dl class="meta-grid">
      <dt>Repo</dt><dd>${escapeHtml(repo)}</dd>
      <dt>Author</dt><dd>${escapeHtml(pr.author || "—")}</dd>
      <dt>Status</dt><dd>${escapeHtml(pr.status || "—")}</dd>
      <dt>CI</dt><dd>${escapeHtml(pr.ci || "—")}</dd>
      <dt>Branch</dt><dd>${escapeHtml(pr.branch || "—")}</dd>
    </dl>
    <div class="meta-link">${renderExternalLink(pr.url, "Open in GitHub")}</div>
  `;
}

function renderTicketMeta(ticket) {
  return `
    <dl class="meta-grid">
      <dt>Type</dt><dd>${escapeHtml(ticket.type || "—")}</dd>
      <dt>Status</dt><dd>${escapeHtml(ticket.status || "—")}</dd>
    </dl>
    <div class="meta-link">${renderExternalLink(ticket.url, "Open in Jira")}</div>
  `;
}

// Tickets carry no working directory of their own (unlike PRs, which are grouped by GitHub
// repo) and aren't always tied to a git repo at all, so the drawer offers an editable guess
// instead — a combobox, not a static field, since the guess can be wrong. It sits in its own
// bar right under the header, visible before any action is clicked, so glancing at (or
// correcting) it doubles as the confirmation step — no separate modal, and no action button
// is ever disabled while it loads.
function renderDirectoryPicker() {
  return `
    <div class="drawer-directory-bar">
      <label for="drawer-directory-input">Directory</label>
      <input id="drawer-directory-input" class="drawer-directory-input is-loading" list="drawer-directory-options"
        placeholder="Finding directory…" autocomplete="off" spellcheck="false" />
      <datalist id="drawer-directory-options"></datalist>
    </div>
  `;
}

function renderDrawerContent(item, type, repo) {
  const actions = type === "pr" ? prActions : ticketActions;
  const title = type === "pr"
    ? `<span class="drawer-title-key">#${item.number}</span> ${escapeHtml(item.title)}`
    : `<span class="drawer-title-key">${escapeHtml(item.key)}</span> ${escapeHtml(item.summary)}`;

  const buttons = actions.map((a) =>
    `<button class="drawer-action-btn" data-action-id="${a.id}"><span class="btn-label">${escapeHtml(a.label)}</span><span class="btn-label-dangerous">${escapeHtml(a.label)} (dangerously)</span></button>`
  ).join("");

  const detail = type === "pr" ? renderPrMeta(item, repo) : renderTicketMeta(item);

  return `
    <div class="drawer-header">
      <div class="drawer-title">${title}</div>
      <button class="drawer-close" aria-label="Close" onclick="closeActionDrawer()">×</button>
    </div>
    ${type === "ticket" ? renderDirectoryPicker() : ""}
    <div class="drawer-body">
      <section class="drawer-section">
        <h3 class="drawer-section-label">Details</h3>
        <div class="drawer-detail">${detail}</div>
      </section>
      <section class="drawer-section">
        <h3 class="drawer-section-label">Actions</h3>
        <div class="drawer-actions">${buttons}</div>
      </section>
    </div>
  `;
}

// Populates the directory picker's datalist and guess. Runs async after the drawer is already
// interactive — action buttons work immediately — but the field shows a loading state until
// the guess lands, and a click that happens first waits for it rather than silently
// dispatching without one.
//
// The guess is surfaced via `placeholder` + `data-suggested`, not `input.value`: a native
// <input list> filters its <datalist> dropdown to options that start with the input's current
// value, so pre-filling `.value` with the guess would hide every other option behind that one
// prefix the moment the guess isn't itself a shared prefix of the others. Leaving `.value`
// empty keeps the dropdown showing everything; the click handler falls back to
// `data-suggested` if the user never typed anything.
//
// `suggested` comes from the server explicitly rather than being read off the top of the list
// — with no history the list starts at whichever checkout sorts first alphabetically, which
// is not a guess worth dispatching to.
async function loadDirectoryOptions(ticketKey, expectedDrawerEl) {
  const input = expectedDrawerEl.querySelector("#drawer-directory-input");
  const datalist = expectedDrawerEl.querySelector("#drawer-directory-options");
  const projectKey = ticketKey.split("-")[0];
  let directories = [];
  let suggested = null;
  let defaultDirectory = null;
  try {
    const res = await fetch(`/api/directories?project=${encodeURIComponent(projectKey)}`);
    ({ directories = [], suggested = null, defaultDirectory = null } = await res.json());
  } catch {
    // Field stays empty — falls back to the configured default directory server-side.
  }
  // Writes go to the elements captured above, not to whatever drawer is open now, so a
  // drawer replaced mid-fetch is never touched — and an in-flight click on this drawer still
  // gets its guess even if the drawer itself has since closed.
  if (!datalist || !input) return;
  input.classList.remove("is-loading");
  input.placeholder = defaultDirectory ? `${defaultDirectory} (default)` : "workspace (default)";
  datalist.innerHTML = directories.map((d) => `<option value="${escapeHtml(d)}"></option>`).join("");
  if (!input.value && suggested) {
    input.placeholder = suggested;
    input.dataset.suggested = suggested;
  }
}

function openActionDrawer(item, type, repo) {
  if (closeDrawer) closeDrawer();

  drawerEl = document.createElement("div");
  drawerEl.className = "action-drawer";
  drawerEl.dataset.type = type;
  drawerEl.innerHTML = renderDrawerContent(item, type, repo);

  const directoryOptionsLoaded = type === "ticket" ? loadDirectoryOptions(item.key, drawerEl) : null;

  drawerEl.querySelectorAll(".drawer-action-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const actionId = btn.dataset.actionId;
      const actions = type === "pr" ? prActions : ticketActions;
      const action = actions.find((a) => a.id === actionId);
      if (!action) return;
      const dangerous = e.shiftKey;
      const el = drawerEl;
      const body = { prompt: action.prompt(item), repo };
      if (type === "ticket") {
        const directoryInput = el.querySelector("#drawer-directory-input");
        // A click can land before the guess does. Typing beats the guess, so only an
        // untouched field has to wait — dispatching without the guess would send the agent
        // somewhere the user never saw.
        if (!directoryInput?.value.trim()) await directoryOptionsLoaded;
        const pickedDirectory = directoryInput?.value.trim() || directoryInput?.dataset.suggested;
        if (pickedDirectory) body.directory = pickedDirectory;
        body.jiraProject = item.key.split("-")[0];
      }
      if (dangerous) body.dangerous = true;
      apiPost("agent-workspace", body);
      if (drawerEl === el) closeActionDrawer(); // a slow guess may have outlived this drawer
    });
  });

  closeDrawer = openOverlay(drawerEl, {
    onClose: () => { drawerEl.remove(); drawerEl = null; closeDrawer = null; },
  });
}

function closeActionDrawer() {
  if (closeDrawer) closeDrawer();
}

function openActionDrawerFromBtn(btn) {
  const url = btn.dataset.prUrl;
  const key = btn.dataset.ticketKey;
  if (url) {
    const found = findPrByUrl(url);
    if (found) openActionDrawer(found.item, "pr", found.repo);
    return;
  }
  if (key) {
    const found = findTicketByKey(key);
    if (found) openActionDrawer(found.item, "ticket");
  }
}
