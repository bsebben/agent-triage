// Inline SVG icons for the Pulls tab (status, CI, and reviewer indicators).
// Stroke style matches claudeIcon() in app.js: 16px viewBox, currentColor, 1.5 stroke.

function pullIcon(inner) {
  return `<svg class="pull-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function iconHuman() {
  return pullIcon('<circle cx="8" cy="5" r="2.6"/><path d="M3 14c0-3.1 2.2-5 5-5s5 1.9 5 5"/>');
}

function iconBot() {
  return pullIcon('<rect x="3" y="5.5" width="10" height="8" rx="2"/><path d="M8 5.5V3"/><circle cx="8" cy="2.2" r=".9"/><circle cx="6" cy="9.3" r=".95" fill="currentColor" stroke="none"/><circle cx="10" cy="9.3" r=".95" fill="currentColor" stroke="none"/><path d="M1.5 8.5v2M14.5 8.5v2"/>');
}

function iconComment() {
  return pullIcon('<path d="M2.5 3h11v7.5H8l-3 2.7v-2.7H2.5z"/>');
}

function iconCheck() {
  return pullIcon('<path d="M3 8.5l3.2 3.2L13 4.8"/>');
}

function iconBlocked() {
  return pullIcon('<circle cx="8" cy="8" r="6.5"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"/>');
}
