// public/integrations-settings.js — consent-gated Integrations section for settings panel
//
// Enabling always goes through an explicit confirm dialog (first time or
// re-enabling later — there's no "already saw this once" bypass). Disabling
// runs immediately, no re-confirmation. The toggle never optimistically
// flips — it always re-renders from the server's live status, whether the
// action succeeded or not, so it can't show "enabled" when it isn't.

let integrationsData = [];
let closeIntegrationModal = null;

async function fetchIntegrations() {
  try {
    const res = await fetch("/api/integrations");
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function initIntegrations() {
  integrationsData = await fetchIntegrations();
}

async function refreshIntegrations() {
  integrationsData = await fetchIntegrations();
  renderSettings();
  if (typeof renderIntegrationNudge === "function") renderIntegrationNudge();
}

function renderIntegrationsSection() {
  if (integrationsData.length === 0) return "";

  const rows = integrationsData.map((i) => {
    const toggleId = `integration-toggle-${i.id}`;
    return `
      <div class="plugin-row">
        <div class="plugin-header">
          <span class="plugin-name">${escapeHtml(i.name)}${i.shouldNudge ? ' <span class="integration-new-badge">New</span>' : ""}</span>
          <span class="plugin-actions">
            <label class="config-toggle" for="${toggleId}">
              <input type="checkbox" id="${toggleId}" ${i.enabled ? "checked" : ""}
                onclick="event.preventDefault();toggleIntegration('${escapeHtml(i.id)}',${i.enabled ? "true" : "false"})">
              <span class="config-toggle-track"></span>
            </label>
          </span>
        </div>
        <div class="config-field-desc">${escapeHtml(i.description)}</div>
        ${i.shouldNudge ? `<button class="settings-edit-btn" onclick="dismissIntegrationAction('${escapeHtml(i.id)}')">Not now</button>` : ""}
      </div>`;
  }).join("");

  return `
    <div class="settings-section">
      <div class="settings-section-header">
        <h3>Integrations</h3>
        <button class="settings-edit-btn" onclick="refreshIntegrations()">Refresh</button>
      </div>
      ${rows}
    </div>`;
}

function toggleIntegration(id, currentlyEnabled) {
  if (currentlyEnabled) {
    disableIntegrationAction(id);
  } else {
    openIntegrationConsentModal(id);
  }
}

function openIntegrationConsentModal(id) {
  // Close any other integration's modal first rather than dropping this click —
  // with more than one registry entry, clicking a second toggle while the first
  // integration's dialog is still open should switch to it, not silently no-op.
  closeIntegrationModal?.();
  const integration = integrationsData.find((i) => i.id === id);
  if (!integration) return;

  const panel = document.createElement("div");
  panel.className = "modal-panel";
  panel.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">Enable ${escapeHtml(integration.name)}?</span>
      <button class="modal-close" type="button" aria-label="Close">&times;</button>
    </div>
    <div class="modal-body">
      <p>${escapeHtml(integration.description)}</p>
      ${integration.warning ? `
        <div class="config-warning-banner">
          <div class="config-warning-title">Heads up</div>
          <div>${escapeHtml(integration.warning)}</div>
        </div>` : ""}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn" type="button" data-action="cancel">Cancel</button>
        <button class="btn primary" type="button" data-action="confirm">Enable</button>
      </div>
    </div>
  `;

  panel.querySelector(".modal-close").addEventListener("click", () => closeIntegrationModal?.());
  panel.querySelector('[data-action="cancel"]').addEventListener("click", () => closeIntegrationModal?.());
  panel.querySelector('[data-action="confirm"]').addEventListener("click", async () => {
    closeIntegrationModal?.();
    await enableIntegrationAction(id);
  });

  closeIntegrationModal = openOverlay(panel, {
    onClose: () => { panel.remove(); closeIntegrationModal = null; },
  });
}

async function performIntegrationAction(id, verb) {
  const label = verb === "enable" ? "Enable" : verb === "disable" ? "Disable" : "Dismiss";
  try {
    const res = await fetch(`/api/integrations/${encodeURIComponent(id)}/${verb}`, { method: "POST" });
    const result = await res.json();
    if (!result.ok) showToast(`${label} failed: ${result.error || "unknown error"}`);
  } catch (e) {
    showToast(`${label} failed: ${e.message}`);
  } finally {
    await refreshIntegrations();
  }
}

function enableIntegrationAction(id) {
  return performIntegrationAction(id, "enable");
}

function disableIntegrationAction(id) {
  return performIntegrationAction(id, "disable");
}

function dismissIntegrationAction(id) {
  return performIntegrationAction(id, "dismiss");
}
