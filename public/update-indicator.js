// public/update-indicator.js — update available indicator + "What's New" modal

let updating = false;

function renderUpdateIndicator() {
  const container = document.getElementById("update-indicator");
  if (!container) return;

  // While an update is in flight, show a sticky "Updating…" pill that survives
  // broadcast re-renders. It stays until the page reloads on the new version.
  if (updating) {
    container.innerHTML = `<span class="update-badge"><span class="update-progress">Updating…</span></span>`;
    container.style.opacity = "1";
    return;
  }

  const status = state.updateStatus;
  if (!status?.available) {
    container.innerHTML = "";
    container.style.opacity = "0";
    return;
  }

  container.innerHTML = `<span class="update-badge">
    <button class="update-info-btn" title="What's New in v${escapeHtml(status.remote)}" onclick="event.stopPropagation();openWhatsNewModal()">ⓘ</button>
    <button class="update-action-btn" title="Update to v${escapeHtml(status.remote)}" onclick="event.stopPropagation();performUpdate(this)">↑ v${escapeHtml(status.remote)}</button>
  </span>`;
  container.style.opacity = "1";
}

let closeWhatsNew = null;

function openWhatsNewModal() {
  if (closeWhatsNew) return;
  const status = state.updateStatus;
  if (!status?.changelog) return;

  const panel = document.createElement("div");
  panel.className = "modal-panel";
  panel.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">What's New in v${escapeHtml(status.remote)}</span>
      <button class="modal-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">${parseChangelog(status.changelog)}</div>
  `;
  panel.querySelector(".modal-close").addEventListener("click", () => closeWhatsNew?.());

  closeWhatsNew = openOverlay(panel, {
    onClose: () => { panel.remove(); closeWhatsNew = null; },
  });
}

async function performUpdate(btn, opts = {}) {
  updating = true;
  renderUpdateIndicator();

  try {
    const res = await apiPost("update", opts);
    if (res.ok) {
      // Stay in the "Updating…" state until the server restarts and the
      // reconnecting WebSocket triggers a reload onto the new version.
      pendingReload = true;
      return;
    }

    updating = false;
    renderUpdateIndicator();

    if (res.needsBranchSwitch) {
      openBranchSwitchModal(res.branch, document.querySelector(".update-action-btn") || btn);
      return;
    }

    const badge = document.querySelector(".update-badge");
    if (badge) {
      const err = document.createElement("span");
      err.className = "update-error";
      err.textContent = res.error || "Update failed";
      badge.appendChild(err);
      setTimeout(() => err.remove(), 5000);
    }
  } catch {
    updating = false;
    renderUpdateIndicator();
  }
}

function openBranchSwitchModal(branch, btn) {
  const panel = document.createElement("div");
  panel.className = "modal-panel";
  panel.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Switch to master?</span>
      <button class="modal-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">
      <p>You're on branch <code>${escapeHtml(branch)}</code>. Updating requires switching to <code>master</code>.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn" data-action="cancel">Cancel</button>
        <button class="btn primary" data-action="confirm">Switch &amp; Update</button>
      </div>
    </div>
  `;

  let close;
  panel.querySelector(".modal-close").addEventListener("click", () => close?.());
  panel.querySelector('[data-action="cancel"]').addEventListener("click", () => close?.());
  panel.querySelector('[data-action="confirm"]').addEventListener("click", () => {
    close?.();
    const liveBtn = document.querySelector(".update-action-btn") || btn;
    performUpdate(liveBtn, { switchBranch: true });
  });

  close = openOverlay(panel, {
    onClose: () => { panel.remove(); },
  });
}
