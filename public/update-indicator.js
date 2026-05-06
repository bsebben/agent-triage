// public/update-indicator.js — update available indicator + "What's New" modal

function renderUpdateIndicator() {
  const container = document.getElementById("update-indicator");
  if (!container) return;

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

async function performUpdate(btn) {
  const original = btn.innerHTML;
  btn.innerHTML = "Updating\u2026";
  btn.disabled = true;

  try {
    const res = await apiPost("update", {});
    if (!res.ok) {
      btn.innerHTML = original;
      btn.disabled = false;
      const badge = btn.closest(".update-badge");
      let err = badge.querySelector(".update-error");
      if (!err) {
        err = document.createElement("span");
        err.className = "update-error";
        badge.appendChild(err);
      }
      err.textContent = res.error || "Update failed";
      setTimeout(() => err.remove(), 5000);
    }
  } catch {
    btn.innerHTML = original;
    btn.disabled = false;
  }
}
