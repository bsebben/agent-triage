// public/tab-tickets.js

const collapsedTicketGroups = new Set();
let ticketsShowBacklog = false;

function toggleTicketsBacklog() {
  ticketsShowBacklog = !ticketsShowBacklog;
  renderTickets();
}

function filterTicketGroups(groups) {
  if (ticketsShowBacklog) return groups;
  return groups
    .map((g) => ({ ...g, tickets: g.tickets.filter((t) => t.status.toLowerCase() !== "backlog") }))
    .filter((g) => g.tickets.length > 0);
}

function renderTickets() {
  const ticketStatus = state.tabStatus?.tickets || appConfig.tickets || {};
  if (!ticketStatus.available) {
    const hint = escapeHtml(ticketStatus.hint || "Jira not detected. Make sure your Jira MCP server is authenticated and running.");
    queue.innerHTML = `<div class="empty-state">${hint}</div>`;
    return;
  }
  const allGroups = state.tickets || [];
  const groups = filterTicketGroups(allGroups);
  const totalAll = allGroups.reduce((n, g) => n + g.tickets.length, 0);
  const totalVisible = groups.reduce((n, g) => n + g.tickets.length, 0);
  const backlogCount = totalAll - totalVisible + (ticketsShowBacklog ? 0 : 0);
  const hiddenBacklog = allGroups.reduce((n, g) => n + g.tickets.filter((t) => t.status.toLowerCase() === "backlog").length, 0);
  if (totalAll === 0) {
    const hint = ticketStatus.hint ? escapeHtml(ticketStatus.hint) : "No assigned tickets";
    queue.innerHTML = `<div class="empty-state">${hint}</div>`;
    return;
  }
  const filterBar = `<div class="tickets-filter-bar">
    <button class="tickets-filter-btn${ticketsShowBacklog ? " active" : ""}" onclick="toggleTicketsBacklog()">
      Backlog${hiddenBacklog > 0 && !ticketsShowBacklog ? ` (${hiddenBacklog})` : ""}
    </button>
  </div>`;
  if (totalVisible === 0) {
    queue.innerHTML = workspaceLimitBanner() + filterBar + `<div class="empty-state">No active tickets</div>`;
    return;
  }
  queue.innerHTML = workspaceLimitBanner() + filterBar + `<div class="tickets-section">
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
  const atLimit = isAtWorkspaceLimit();
  const actionBtn = atLimit
    ? `<button class="agent-btn" title="Workspace limit reached" disabled>${claudeIcon()}</button>`
    : `<button class="agent-btn" title="Actions" data-ticket-key="${escapeHtml(ticket.key)}" onclick="event.stopPropagation(); openActionDrawerFromBtn(this)">${claudeIcon()}</button>`;
  return `<tr class="ticket-row" onclick="openExternal('${escapeHtml(ticket.url)}')">
    <td class="ticket-title"><span class="ticket-key">${escapeHtml(ticket.key)}</span> ${escapeHtml(ticket.summary)}</td>
    <td><span class="ticket-badge status-${ticketStatusClass(ticket.status)}">${escapeHtml(ticket.status)}</span></td>
    <td class="row-action">${actionBtn}</td>
  </tr>`;
}
