// public/integration-nudge.js — full-width banner nudging undecided integrations
//
// A user might never open Settings on their own, so a new consent-gated
// integration needs a top-level cue too, not just a row in Settings. Lives in
// its own row (below the header, above the tabs) rather than squeezed into
// header-right with the other icon-sized indicators — it carries a name,
// description, and two real buttons, which wrapped and crowded out the
// "Agent Triage" title when it lived there. Opens the same consent modal
// Settings uses directly rather than duplicating it — one dialog, two entry
// points. Persists (reappears on every load/reconnect) until the user acts,
// since it shares the same shouldNudge flag as the Settings row.

async function initIntegrationNudge() {
  await initIntegrations();
  renderIntegrationNudge();
}

function renderIntegrationNudge() {
  const container = document.getElementById("integration-nudge");
  if (!container) return;

  const pending = (integrationsData || []).find((i) => i.shouldNudge);
  if (!pending) {
    container.innerHTML = "";
    container.classList.remove("visible");
    return;
  }

  container.innerHTML = `
    <span class="integration-nudge-text">
      <strong>New integration available:</strong> ${escapeHtml(pending.name)} — ${escapeHtml(pending.description)}
      <span class="integration-nudge-hint">You can turn this on or off anytime from Settings (&#x2699;).</span>
    </span>
    <span class="integration-nudge-actions">
      <button class="btn primary" onclick="openIntegrationConsentModal('${escapeHtml(pending.id)}')">Enable</button>
      <button class="btn" onclick="dismissIntegrationNudge('${escapeHtml(pending.id)}')">Not now</button>
    </span>`;
  container.classList.add("visible");
}

async function dismissIntegrationNudge(id) {
  await dismissIntegrationAction(id);
}
