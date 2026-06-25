// public/tab-tickets.js

const collapsedTicketGroups = new Set();

function renderTickets() {
  const ticketStatus = state.tabStatus?.tickets || appConfig.tickets || {};
  if (!ticketStatus.available) {
    const hint = escapeHtml(ticketStatus.hint || "Jira not detected. Make sure your Jira MCP server is authenticated and running.");
    queue.innerHTML = `<div class="empty-state">${hint}</div>`;
    return;
  }
  const groups = state.tickets || [];
  const totalTickets = groups.reduce((n, g) => n + g.tickets.length, 0);
  if (totalTickets === 0) {
    const hint = ticketStatus.hint ? escapeHtml(ticketStatus.hint) : "No assigned tickets";
    queue.innerHTML = `<div class="empty-state">${hint}</div>`;
    return;
  }
  queue.innerHTML = `<div class="tickets-section">
    ${groups.map(renderTicketGroup).join("")}
  </div>`;
}

function toggleTicketGroup(key, header) {
  if (collapsedTicketGroups.has(key)) {
    collapsedTicketGroups.delete(key);
  } else {
    collapsedTicketGroups.add(key);
  }
  toggleGroup(header);
}

function renderTicketGroup(group) {
  const groupKey = group.key || group.summary;
  const isCollapsed = collapsedTicketGroups.has(groupKey);
  const keyChip = group.key
    ? `<span class="tickets-parent-key" onclick="event.stopPropagation(); openExternal('${escapeHtml(group.url)}')">${escapeHtml(group.key)}</span>`
    : "";
  return `<div class="tickets-group">
    <div class="tickets-parent" data-group-key="${escapeHtml(groupKey)}" onclick="toggleTicketGroup('${escapeHtml(groupKey)}', this)">
      <span class="chevron${isCollapsed ? " collapsed" : ""}">▼</span>
      <span class="tickets-parent-summary">${escapeHtml(group.summary)}</span>
      ${keyChip}
    </div>
    <div class="group-items${isCollapsed ? " collapsed" : ""}">
      <table class="tickets-table">
        <tbody>${group.tickets.map(renderTicketRow).join("")}</tbody>
      </table>
    </div>
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
