// public/window-count-indicator.js — notes when more than one cmux window
// is open. Purely informational: Agent Triage pins itself to its own
// hosting window explicitly, so other windows have no effect on it.

function renderWindowCountIndicator() {
  const container = document.getElementById("window-count-indicator");
  if (!container) return;

  const count = state.windowCount;
  if (!count || count <= 1) {
    container.innerHTML = "";
    container.style.opacity = "0";
    return;
  }

  container.innerHTML = `<span class="cmux-compat-badge">
    <button class="cmux-compat-btn" title="Click for details"
      onclick="event.stopPropagation();openWindowCountModal()">&#x26a0; ${count} cmux windows</button>
  </span>`;
  container.style.opacity = "1";
}

let closeWindowCountModal = null;

function openWindowCountModal() {
  if (closeWindowCountModal) return;

  const panel = document.createElement("div");
  panel.className = "modal-panel";
  panel.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Multiple cmux windows open</span>
      <button class="modal-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">
      <p>Only one cmux window should run the Agent Triage host process. This dashboard only ever shows workspaces from that host window — other open cmux windows have no effect on it and won't be reflected in Agent Triage. It is recommended that you run only one cmux window.</p>
    </div>
  `;
  panel.querySelector(".modal-close").addEventListener("click", () => closeWindowCountModal?.());

  closeWindowCountModal = openOverlay(panel, {
    onClose: () => { panel.remove(); closeWindowCountModal = null; },
  });
}
