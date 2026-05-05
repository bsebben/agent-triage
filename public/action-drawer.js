// public/action-drawer.js — side drawer with vertical action tabs and item metadata

let drawerEl = null;
let drawerBackdrop = null;
let drawerKeyHandler = null;

function findPrByUrl(url) {
  const pulls = state.pulls || { mine: [], reviews: [] };
  for (const list of [pulls.mine, pulls.reviews]) {
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

function renderExternalLink(url, label) {
  return `<a class="external-link" href="#" title="Opens in new tab" onclick="event.preventDefault(); openExternal('${escapeHtml(url)}'); return false;">${escapeHtml(label)}${externalLinkIcon()}</a>`;
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

function renderDrawerContent(item, type, repo) {
  const actions = type === "pr" ? prActions : ticketActions;
  const title = type === "pr"
    ? `<span class="drawer-title-key">#${item.number}</span> ${escapeHtml(item.title)}`
    : `<span class="drawer-title-key">${escapeHtml(item.key)}</span> ${escapeHtml(item.summary)}`;

  const buttons = actions.map((a) =>
    `<button class="drawer-action-btn" data-action-id="${a.id}">${escapeHtml(a.label)}</button>`
  ).join("");

  const detail = type === "pr" ? renderPrMeta(item, repo) : renderTicketMeta(item);

  return `
    <div class="drawer-header">
      <div class="drawer-title">${title}</div>
      <button class="drawer-close" aria-label="Close" onclick="closeActionDrawer()">×</button>
    </div>
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

function openActionDrawer(item, type, repo) {
  if (!drawerBackdrop) {
    drawerBackdrop = document.createElement("div");
    drawerBackdrop.className = "drawer-backdrop";
    drawerBackdrop.addEventListener("click", closeActionDrawer);
    document.body.appendChild(drawerBackdrop);
  }
  if (!drawerEl) {
    drawerEl = document.createElement("div");
    drawerEl.className = "action-drawer";
    document.body.appendChild(drawerEl);
  }
  drawerEl.dataset.type = type;
  drawerEl.innerHTML = renderDrawerContent(item, type, repo);

  drawerEl.querySelectorAll(".drawer-action-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const actionId = btn.dataset.actionId;
      const actions = type === "pr" ? prActions : ticketActions;
      const action = actions.find((a) => a.id === actionId);
      if (!action) return;
      apiPost("agent-workspace", { prompt: action.prompt(item), repo });
      closeActionDrawer();
    });
  });

  requestAnimationFrame(() => {
    drawerBackdrop.classList.add("open");
    drawerEl.classList.add("open");
  });

  if (!drawerKeyHandler) {
    drawerKeyHandler = (e) => {
      if (e.key === "Escape") closeActionDrawer();
    };
    document.addEventListener("keydown", drawerKeyHandler);
  }
}

function closeActionDrawer() {
  if (drawerEl) drawerEl.classList.remove("open");
  if (drawerBackdrop) drawerBackdrop.classList.remove("open");
  if (drawerKeyHandler) {
    document.removeEventListener("keydown", drawerKeyHandler);
    drawerKeyHandler = null;
  }
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
