// public/window-count-indicator.js — warns when more than one cmux window
// is open, since Agent Triage only ever sees the window it's hosted in.

function renderWindowCountIndicator() {
  const container = document.getElementById("window-count-indicator");
  if (!container) return;

  const count = state.windowCount;
  if (!count || count <= 1) {
    container.innerHTML = "";
    container.style.opacity = "0";
    return;
  }

  const tooltip = "Agent Triage only tracks the cmux window it's hosted in. Workspaces in other windows won't show correctly — close the extras.";
  container.innerHTML = `<span class="cmux-compat-badge">
    <button class="cmux-compat-btn" title="${escapeHtml(tooltip)}"
      onclick="event.stopPropagation();showToast('${escapeHtml(tooltip)}', 8000)">&#x26a0; ${count} cmux windows</button>
  </span>`;
  container.style.opacity = "1";
}
