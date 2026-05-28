// public/cmux-compat-indicator.js — cmux version compatibility pill

function renderCmuxCompatIndicator() {
  const container = document.getElementById("cmux-compat-indicator");
  if (!container) return;

  const info = state.cmuxVersion || appConfig.cmuxVersion;
  if (!info || info.compatible !== false) {
    container.innerHTML = "";
    container.style.opacity = "0";
    return;
  }

  const rangeText = `${info.range.min}\u2013${info.range.max}`;
  let label, tooltip;
  if (info.reason === "too_old") {
    label = "\u2191 cmux upgrade";
    tooltip = `cmux ${info.version} detected \u2014 ${rangeText} required`;
  } else if (info.reason === "too_new") {
    label = "\u2193 cmux downgrade";
    tooltip = `cmux ${info.version} detected \u2014 ${rangeText} required`;
  } else {
    label = "\u26a0 cmux unknown";
    tooltip = `Could not detect cmux version \u2014 ${rangeText} required`;
  }

  container.innerHTML = `<span class="cmux-compat-badge">
    <button class="cmux-compat-btn" title="${escapeHtml(tooltip)}"
      onclick="event.stopPropagation(); downloadCmux(this)">${label}</button>
  </span>`;
  container.style.opacity = "1";
}

function downloadCmux(btn) {
  const info = state.cmuxVersion || appConfig.cmuxVersion;
  if (!info?.downloadUrl) return;

  window.open(info.downloadUrl, "_blank");

  btn.textContent = "Installing\u2026";
  btn.classList.add("installing");
  btn.title = "Open the downloaded DMG, drag cmux to Applications, restart cmux";
}
