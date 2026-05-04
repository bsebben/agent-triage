// public/tab-tickets.js

function renderTickets() {
  const ticketsCfg = appConfig.tickets || {};
  if (!ticketsCfg.available) {
    const hint = escapeHtml(ticketsCfg.hint || "Jira not detected. Make sure mcpproxy is running with a Jira MCP server.");
    queue.innerHTML = `<div class="empty-state">${hint}</div>`;
    return;
  }
  const groups = state.tickets || [];
  const totalTickets = groups.reduce((n, g) => n + g.tickets.length, 0);
  if (totalTickets === 0) {
    queue.innerHTML = `<div class="empty-state">No assigned tickets</div>`;
    return;
  }
  queue.innerHTML = `<div class="tickets-section">
    ${groups.map(renderTicketGroup).join("")}
  </div>`;
}

function renderTicketGroup(group) {
  const header = group.key
    ? `<div class="tickets-parent" onclick="openExternal('${escapeHtml(group.url)}')">${escapeHtml(group.summary)} <span class="tickets-parent-key">${escapeHtml(group.key)}</span></div>`
    : `<div class="tickets-parent">${escapeHtml(group.summary)}</div>`;
  return `<div class="tickets-group">
    ${header}
    <table class="tickets-table">
      <thead><tr><th>Ticket</th><th>Status</th><th></th></tr></thead>
      <tbody>${group.tickets.map(renderTicketRow).join("")}</tbody>
    </table>
  </div>`;
}

function ticketStatusClass(status) {
  const s = status.toLowerCase();
  if (s === "in progress") return "in-progress";
  if (s === "backlog") return "backlog";
  if (s === "to do") return "todo";
  return "default";
}

function renderTicketRow(ticket) {
  return `<tr class="ticket-row" onclick="openExternal('${escapeHtml(ticket.url)}')">
    <td class="ticket-title"><span class="ticket-key">${escapeHtml(ticket.key)}</span> ${escapeHtml(ticket.summary)}</td>
    <td><span class="ticket-badge status-${ticketStatusClass(ticket.status)}">${escapeHtml(ticket.status)}</span></td>
    <td class="row-action"><button class="agent-btn" title="Actions" data-ticket-key="${escapeHtml(ticket.key)}" onclick="event.stopPropagation(); openActionDrawerFromBtn(this)">${claudeIcon()}</button></td>
  </tr>`;
}
