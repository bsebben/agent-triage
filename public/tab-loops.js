// public/tab-loops.js

function renderLoops() {
  const loops = state.loops || [];
  if (!Array.isArray(loops)) {
    const url = loops.installUrl || "#";
    queue.innerHTML = `<div class="empty-state">
      Claude Loops is not installed.<br><br>
      <a href="${escapeHtml(url)}" target="_blank" class="btn primary">Install Claude Loops</a>
    </div>`;
    return;
  }
  if (loops.length === 0) {
    queue.innerHTML = `<div class="empty-state">No loops configured</div>`;
    return;
  }
  queue.innerHTML = `<div class="loops-section">
    <table class="loops-table">
      <thead><tr><th>Loop</th><th>Schedule</th><th>Status</th><th>Last Run</th><th>Runs</th></tr></thead>
      <tbody>${loops.map(renderLoopRow).join("")}</tbody>
    </table>
  </div>`;
}

function loopStatusClass(loop) {
  if (!loop.enabled) return "disabled";
  if (loop.session === "running") return "running";
  if (loop.loopState === "started") return "idle";
  return "stopped";
}

function renderLoopRow(loop) {
  const cls = loopStatusClass(loop);
  const statusLabel = !loop.enabled ? "disabled"
    : loop.session === "running" ? "running"
    : loop.loopState === "started" ? "idle"
    : loop.loopState;
  return `<tr class="loop-row loop-${cls}">
    <td class="loop-name">${escapeHtml(loop.name)}</td>
    <td class="loop-schedule">${escapeHtml(loop.schedule)}</td>
    <td class="loop-status"><span class="loop-badge ${cls}">${statusLabel}</span></td>
    <td class="loop-lastrun">${escapeHtml(loop.lastRunAgo)}</td>
    <td class="loop-runs">${loop.runs}</td>
  </tr>`;
}
