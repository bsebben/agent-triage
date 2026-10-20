// public/tab-tickets.js

const collapsedTicketGroups = new Set();
// "" is the default Active view: every status that isn't a pill status.
let ticketsStatusFilter = "";

function setTicketsStatusFilter(status) {
  ticketsStatusFilter = status;
  renderTickets();
}

function toggleTicketsPill(status) {
  setTicketsStatusFilter(ticketsStatusFilter === status ? "" : status);
}

function isPillStatus(status, pills) {
  const s = (status || "").toLowerCase();
  return pills.some((p) => p.toLowerCase() === s);
}

function filterTicketGroups(groups, pills) {
  return groups
    .map((g) => ({ ...g, tickets: g.tickets.filter((t) => !isPillStatus(t.status, pills)) }))
    .filter((g) => g.tickets.length > 0);
}

// One entry per configured pill status that at least one ticket carries, in config order.
// The label is the status exactly as Jira spells it, which is also the value the status
// filter compares against.
function collectTicketPills(groups, pills) {
  const found = new Map();
  for (const g of groups) {
    for (const t of g.tickets) {
      if (!isPillStatus(t.status, pills)) continue;
      const key = t.status.toLowerCase();
      const entry = found.get(key) || { status: t.status, count: 0 };
      entry.count += 1;
      found.set(key, entry);
    }
  }
  return pills.map((p) => found.get(p.toLowerCase())).filter(Boolean);
}

function collectTicketStatuses(groups) {
  const statuses = new Set();
  for (const g of groups) {
    for (const t of g.tickets) {
      if (t.status) statuses.add(t.status);
    }
  }
  return [...statuses].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function filterTicketGroupsByStatus(groups, status) {
  if (!status) return groups;
  return groups
    .map((g) => ({ ...g, tickets: g.tickets.filter((t) => t.status === status) }))
    .filter((g) => g.tickets.length > 0);
}

function renderTicketStatusFilter(statuses) {
  const options = statuses
    .map((s) => `<option value="${escapeHtml(s)}"${s === ticketsStatusFilter ? " selected" : ""}>${escapeHtml(s)}</option>`)
    .join("");
  return `<select class="tickets-filter-select" onchange="setTicketsStatusFilter(this.value)">
    <option value="">Active</option>
    ${options}
  </select>`;
}

function renderTicketPill(pill) {
  const active = pill.status === ticketsStatusFilter;
  return `<button class="tickets-filter-btn${active ? " active" : ""}" data-status="${escapeHtml(pill.status)}" onclick="toggleTicketsPill(this.dataset.status)">
      ${escapeHtml(pill.status)} (${pill.count})
    </button>`;
}

function renderTickets() {
  const ticketStatus = state.tabStatus?.tickets || appConfig.tickets || {};
  if (!ticketStatus.available) {
    const hint = escapeHtml(ticketStatus.hint || "Jira not detected. Make sure your Jira MCP server is authenticated and running.");
    queue.innerHTML = `<div class="empty-state">${hint}</div>`;
    return;
  }
  const allGroups = state.tickets || [];
  const pillConfig = ticketStatus.pillStatuses || [];
  const activeGroups = filterTicketGroups(allGroups, pillConfig);
  const pills = collectTicketPills(allGroups, pillConfig);
  // The dropdown only lists non-pill statuses; pill statuses are reached through their
  // pills. Drop a selection neither control can show any more — otherwise the user is
  // stranded on an empty list they can't clear.
  const statuses = collectTicketStatuses(activeGroups);
  const pillSelected = pills.some((p) => p.status === ticketsStatusFilter);
  if (ticketsStatusFilter && !pillSelected && !statuses.includes(ticketsStatusFilter)) ticketsStatusFilter = "";
  const filtered = filterTicketGroupsByStatus(pillSelected ? allGroups : activeGroups, ticketsStatusFilter);
  const totalAll = allGroups.reduce((n, g) => n + g.tickets.length, 0);
  const totalVisible = filtered.reduce((n, g) => n + g.tickets.length, 0);
  if (totalAll === 0) {
    const hint = ticketStatus.hint ? escapeHtml(ticketStatus.hint) : "No assigned tickets";
    queue.innerHTML = `<div class="empty-state">${hint}</div>`;
    return;
  }
  const filterBar = `<div class="tickets-filter-bar">
    ${pills.map(renderTicketPill).join("")}
    ${statuses.length > 1 ? renderTicketStatusFilter(statuses) : ""}
  </div>`;
  if (totalVisible === 0) {
    queue.innerHTML = workspaceLimitBanner() + filterBar + `<div class="empty-state">No active tickets</div>`;
    return;
  }
  queue.innerHTML = workspaceLimitBanner() + filterBar + `<div class="tickets-section">
    ${filtered.map(renderTicketGroup).join("")}
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
    ? `<a class="tickets-parent-key" href="${escapeHtml(group.url)}" target="_blank" rel="noopener" onclick="openExternalClick(event, '${escapeHtml(group.url)}')">${escapeHtml(group.key)}</a>`
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
    <td class="ticket-num ticket-key">${escapeHtml(ticket.key)}</td>
    <td class="ticket-title"><a class="ticket-title-link" href="${escapeHtml(ticket.url)}" target="_blank" rel="noopener" onclick="openExternalClick(event, '${escapeHtml(ticket.url)}')"><span class="ticket-title-text">${escapeHtml(ticket.summary)}</span></a></td>
    <td class="ticket-status"><span class="ticket-badge status-${ticketStatusClass(ticket.status)}">${escapeHtml(ticket.status)}</span></td>
    <td class="row-action">${actionBtn}</td>
  </tr>`;
}
