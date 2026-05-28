// public/cmux-compat-indicator.js — cmux version compatibility pill

let cmuxInstallState = null;

function renderCmuxCompatIndicator() {
  const container = document.getElementById("cmux-compat-indicator");
  if (!container) return;

  if (cmuxInstallState === "installed") {
    container.innerHTML = `<span class="cmux-compat-badge">
      <button class="cmux-compat-btn cmux-restart-needed"
        title="Drag cmux to Applications, then restart cmux"
        onclick="event.stopPropagation(); showToast('Drag cmux to Applications, then restart cmux', 8000)">Restart cmux</button>
    </span>`;
    container.style.opacity = "1";
    return;
  }

  const info = state.cmuxVersion || appConfig.cmuxVersion;
  if (!info || info.compatible !== false) {
    container.innerHTML = "";
    container.style.opacity = "0";
    return;
  }

  if (cmuxInstallState === "installing") return;

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
      onclick="event.stopPropagation(); installCmux(this)">${label}</button>
  </span>`;
  container.style.opacity = "1";
}

async function installCmux(btn) {
  cmuxInstallState = "installing";
  btn.textContent = "Downloading\u2026";
  btn.classList.add("installing");
  btn.disabled = true;

  try {
    const res = await apiPost("install-cmux", {});
    if (res.ok) {
      cmuxInstallState = "installed";
      renderCmuxCompatIndicator();
      showToast("Drag cmux to Applications, then restart cmux", 10000);
    } else {
      cmuxInstallState = null;
      showToast(res.error || "Install failed", 5000);
      renderCmuxCompatIndicator();
    }
  } catch {
    cmuxInstallState = null;
    showToast("Install failed \u2014 check server logs", 5000);
    renderCmuxCompatIndicator();
  }
}
