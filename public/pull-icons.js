// Inline SVG icons for the Pulls tab (status, CI, and reviewer indicators).
// Stroke style matches claudeIcon() in app.js: 16px viewBox, currentColor, 1.5 stroke.

function pullIcon(inner) {
  return `<svg class="pull-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

// Octicons are filled paths rather than strokes.
function pullIconFilled(path) {
  return `<svg class="pull-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
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

function iconCommentBlocked() {
  return pullIcon('<path d="M2.5 3h11v7.5H8l-3 2.7v-2.7H2.5z"/><path d="M6.3 5.2l3.4 3.4M9.7 5.2L6.3 8.6"/>');
}

function iconCheck() {
  return pullIcon('<path d="M3 8.5l3.2 3.2L13 4.8"/>');
}

function iconBlocked() {
  return pullIcon('<circle cx="8" cy="8" r="6.5"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8"/>');
}

// The three Octicons below are copied from github.com/primer/octicons (MIT License,
// Copyright (c) GitHub, Inc.): git-pull-request, git-pull-request-draft, git-merge-queue.
function iconPullRequest() {
  return pullIconFilled("M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z");
}

function iconPullDraft() {
  return pullIconFilled("M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z");
}

function iconMergeQueue() {
  return pullIconFilled("M3.75 4.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5ZM3 7.75a.75.75 0 0 1 1.5 0v2.878a2.251 2.251 0 1 1-1.5 0Zm.75 5.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm5-7.75a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm5.75 2.5a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-1.5 0a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z");
}

function iconCheckCircle() {
  return pullIcon('<circle cx="8" cy="8" r="6.5"/><path d="M5 8.3l2.2 2.2L11 6"/>');
}

function iconHalfCircle() {
  return pullIcon('<circle cx="8" cy="8" r="6.5"/><path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" stroke="none"/>');
}

function iconDash() {
  return pullIcon('<path d="M4 8h8"/>');
}
