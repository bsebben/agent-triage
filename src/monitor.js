import * as cmux from "./cmux.js";
import { resolveWorktree as defaultResolveWorktree } from "./worktree.js";

const DASHBOARD_WS_NAME = "Agent Triage Dashboard Host";

function worktreeFields(worktree) {
  return {
    isWorktree: worktree?.isWorktree || false,
    worktreeName: worktree?.worktreeName || null,
    repoRoot: worktree?.repoRoot || null,
  };
}

export async function enrichNotification(notification, workspaces, terminals, resolveWorktreeFn = defaultResolveWorktree) {
  const workspace = workspaces.find((w) => w.id === notification.workspaceId);
  const terminal = terminals?.find((t) => t.workspaceId === notification.workspaceId);

  const directory = terminal?.directory || workspace?.directory || null;
  const worktree = await resolveWorktreeFn(directory);

  return {
    ...notification,
    workspaceTitle: workspace?.title || null,
    workspaceDir: directory,
    workspaceSelected: workspace?.selected || false,
    gitBranch: terminal?.gitBranch || null,
    isHost: workspace?.title === DASHBOARD_WS_NAME,
    ...worktreeFields(worktree),
  };
}

export class Monitor {
  #queue;
  #interval = null;
  #onUpdate = null;
  #pollIntervalMs;
  #knownAgentWorkspaces = new Set();
  #cmux;
  #resolveWorktree;
  #subscribeWorkspaceEvents;
  #immediatePollDebounceMs;
  #unsubscribeWorkspaceEvents = null;
  #debounceTimer = null;
  #isPolling = false;
  #pollPending = false;
  #windowCount = 1;
  #hostWorkspaceId = null;

  constructor(queue, {
    pollIntervalMs = 5000,
    onUpdate = null,
    cmuxApi = null,
    resolveWorktreeFn = null,
    subscribeWorkspaceEventsFn = null,
    immediatePollDebounceMs = 150,
  } = {}) {
    this.#queue = queue;
    this.#pollIntervalMs = pollIntervalMs;
    this.#onUpdate = onUpdate;
    this.#cmux = cmuxApi || cmux;
    this.#resolveWorktree = resolveWorktreeFn || defaultResolveWorktree;
    this.#subscribeWorkspaceEvents = subscribeWorkspaceEventsFn || this.#cmux.subscribeWorkspaceEvents;
    this.#immediatePollDebounceMs = immediatePollDebounceMs;
  }

  // Number of open cmux windows as of the last poll. >1 means the dashboard
  // can only see one of them (see cmux.getWindowCount's doc comment).
  get windowCount() {
    return this.#windowCount;
  }

  // The dashboard's own hosting workspace, as of the last poll — the one
  // workspace no API endpoint should ever be allowed to close or rename,
  // since that's the terminal running this server. null before the first
  // poll or if cmux hasn't reported it (e.g. run outside cmux).
  get hostWorkspaceId() {
    return this.#hostWorkspaceId;
  }

  start() {
    this.poll();
    this.#interval = setInterval(() => this.poll(), this.#pollIntervalMs);
    this.#unsubscribeWorkspaceEvents = this.#subscribeWorkspaceEvents((event) => {
      // Skip our own tab-order sync (below) echoing back as a "reordered"
      // event — Agent Triage owns ordering now, so there's no external
      // reorder left to react to instantly; a stray manual drag just gets
      // overwritten on the next regular poll anyway.
      if (event?.name === "workspace.reordered") return;
      this.#scheduleImmediatePoll();
    });
  }

  stop() {
    if (this.#interval) clearInterval(this.#interval);
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#unsubscribeWorkspaceEvents?.();
  }

  // Debounces bursts of workspace events (e.g. holding cmd+↓ to cycle
  // through several workspaces) into a single out-of-cycle poll.
  #scheduleImmediatePoll() {
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      this.poll();
    }, this.#immediatePollDebounceMs);
  }

  // Reentrancy guard: an event-triggered poll can now land while the 5s
  // timer's poll is still in flight (e.g. a slow reorder-workspaces CLI
  // call). Overlapping polls interleaving Queue mutations — and, worse,
  // issuing concurrent reorder-workspaces calls against the same cmux
  // window — is exactly what corrupted cmux's tab state during testing.
  // If a poll is already running, remember to run once more right after
  // instead of dropping the request.
  async poll() {
    if (this.#isPolling) {
      this.#pollPending = true;
      return;
    }
    this.#isPolling = true;
    try {
      await this.#doPoll();
    } finally {
      this.#isPolling = false;
      if (this.#pollPending) {
        this.#pollPending = false;
        this.poll();
      }
    }
  }

  async #doPoll() {
    try {
      const [notifications, workspaces, terminals, agentWsIds, bypassWsIds, windowCount] = await Promise.all([
        this.#cmux.listNotifications(),
        this.#cmux.listWorkspaces(),
        this.#cmux.listTerminals(),
        this.#cmux.listAgentWorkspaceIds(),
        this.#cmux.listBypassWorkspaceIds(),
        this.#cmux.getWindowCount ? this.#cmux.getWindowCount() : 1,
      ]);
      this.#windowCount = windowCount;

      for (const id of agentWsIds) this.#knownAgentWorkspaces.add(id);
      for (const id of this.#knownAgentWorkspaces) {
        if (!agentWsIds.has(id)) this.#knownAgentWorkspaces.delete(id);
      }

      // Computed once per poll and reused everywhere a "is this the host"
      // check is needed (tagging items below, tab-order pinning, and the
      // server's own close/rename guards), rather than re-deriving it
      // independently at each call site.
      this.#hostWorkspaceId = workspaces.find((w) => w.title === DASHBOARD_WS_NAME)?.id ?? null;

      const currentIds = new Set();

      // workspace.list only ever returns our own window's workspaces, but
      // notification.list is global — if a second cmux window exists, its
      // notifications keep showing up here forever with no way to resolve
      // a title/directory for them. Scope to workspaces we actually know
      // about so a stray window can't leave permanent "Unknown" ghost cards.
      const knownWorkspaceIds = new Set(workspaces.map((w) => w.id));

      // Enrichment does a git subprocess round-trip per distinct directory
      // (on a cold or expired worktree cache) — resolve all of a poll cycle's
      // items concurrently rather than serializing N round-trips through a
      // sequential await in the loop.
      const relevantNotifications = notifications.filter((n) => knownWorkspaceIds.has(n.workspaceId));
      for (const n of relevantNotifications) currentIds.add(n.id);
      const enrichedNotifications = await Promise.all(
        relevantNotifications.map(async (n) => {
          const enriched = await enrichNotification(n, workspaces, terminals, this.#resolveWorktree);
          enriched.bypassPermissions = bypassWsIds.has(n.workspaceId);
          return enriched;
        })
      );
      for (const enriched of enrichedNotifications) this.#queue.upsert(enriched);

      const notifiedWorkspaceIds = new Set(notifications.map((n) => n.workspaceId));
      const syntheticWorkspaces = workspaces.filter((ws) => !notifiedWorkspaceIds.has(ws.id));
      for (const ws of syntheticWorkspaces) currentIds.add(`synthetic-${ws.id}`);
      const syntheticItems = await Promise.all(
        syntheticWorkspaces.map(async (ws) => {
          const category = this.#knownAgentWorkspaces.has(ws.id) ? "running" : "terminal";
          const terminal = terminals?.find((t) => t.workspaceId === ws.id);
          const directory = terminal?.directory || ws.directory || null;
          const worktree = await this.#resolveWorktree(directory);
          return {
            id: `synthetic-${ws.id}`,
            workspaceId: ws.id,
            surfaceId: null,
            category,
            body: "",
            workspaceTitle: ws.title || null,
            workspaceDir: directory,
            workspaceSelected: ws.selected || false,
            gitBranch: terminal?.gitBranch || null,
            isHost: ws.id === this.#hostWorkspaceId,
            ...worktreeFields(worktree),
            bypassPermissions: bypassWsIds.has(ws.id),
          };
        })
      );
      for (const item of syntheticItems) this.#queue.upsert(item);

      // When a workspace's representation rotates IDs (synthetic ↔ notification,
      // or notification ID changes), carry the dismissed state forward to the new
      // ID — unless the new item escalated to an attention-required category
      // (e.g. running → permission), which should surface for the user.
      const ATTENTION = new Set(["error", "permission", "waiting"]);
      const dismissedByWs = new Map();
      for (const item of this.#queue.dismissedItems()) {
        if (item.workspaceId) dismissedByWs.set(item.workspaceId, item);
      }
      for (const item of this.#queue.items()) {
        const prev = dismissedByWs.get(item.workspaceId);
        if (!prev || prev.id === item.id) continue;
        const escalated = ATTENTION.has(item.category) && !ATTENTION.has(prev.category);
        if (!escalated) {
          this.#queue.dismiss(item.id);
        }
        this.#queue.remove(prev.id);
      }

      // Remove active (non-dismissed) items that cmux no longer reports.
      for (const item of this.#queue.items()) {
        if (!currentIds.has(item.id)) {
          this.#queue.remove(item.id);
        }
      }

      // Reap dismissed items whose workspace cmux no longer reports. Otherwise a
      // card for a closed workspace lingers forever in the Dismissed list and
      // can't be cleared — "close" only acts on a live cmux workspace.
      for (const item of this.#queue.dismissedItems()) {
        if (!item.workspaceId || !knownWorkspaceIds.has(item.workspaceId)) {
          this.#queue.remove(item.id);
        }
      }

      if (this.#onUpdate) this.#onUpdate();

      // listWorkspaces() pins itself to our own window explicitly (see
      // cmux.js#resolveOwnWindowId), so `workspaces` is reliably our own
      // window's data regardless of how many other cmux windows are open —
      // no need to skip syncing just because windowCount > 1.
      await this.#syncTabOrder(workspaces);
    } catch (err) {
      console.error("Poll error:", err.message);
    }
  }

  // Pushes Agent Triage's own display order (grouped/sorted, dismissed
  // items last, dashboard host last of all) into cmux's real per-window tab
  // order, so cmux's native navigation (and the dashboard's own Cmd+↑/↓)
  // walks the same order shown here. Agent Triage owns ordering — this
  // always wins over a manual drag in cmux.
  //
  // cmux's ordering is group-scoped (see cmux.js#reorderWorkspaces): the
  // pinned group always precedes the unpinned one and `--order` only sets the
  // leading order *within* each group. So "last" here means last within the
  // host's own pin group — if the user pins the host tab, it stays ahead of
  // the unpinned agent workspaces no matter what we push. Comparisons below
  // are likewise per pin group, otherwise a desired order that crosses groups
  // could never match what cmux reports and we'd re-push on every poll.
  async #syncTabOrder(workspaces) {
    const windowIdByWorkspaceId = new Map(workspaces.map((w) => [w.id, w.windowId]));
    const pinnedByWorkspaceId = new Map(workspaces.map((w) => [w.id, !!w.pinned]));
    const dashboardWsId = this.#hostWorkspaceId;

    // queue.js#grouped() already puts the host's own dedicated group last, so
    // it's normally redundant to strip and re-append it here — but that's a
    // display preference in a different method, not something this one
    // should depend on for its own correctness. Strip the host out of both
    // the grouped and dismissed lists and append it explicitly at the end
    // regardless of where it landed above — dedupe via `Set` alone would
    // keep its *first* occurrence, which can strand it mid-list instead of
    // last (dismissedItems() sorts most-recently-dismissed first, so a host
    // dismissed before some other item sorts ahead of it).
    const withoutHost = (ids) => ids.filter((id) => id !== dashboardWsId);
    const desiredIds = [
      ...withoutHost(this.#queue.grouped().groups.flatMap((g) => g.items.map((i) => i.workspaceId))),
      ...withoutHost(this.#queue.dismissedItems().map((i) => i.workspaceId)),
      dashboardWsId,
    ].filter((id) => id && windowIdByWorkspaceId.has(id));

    const desiredByWindow = new Map();
    for (const id of desiredIds) {
      const windowId = windowIdByWorkspaceId.get(id);
      if (!desiredByWindow.has(windowId)) desiredByWindow.set(windowId, []);
      desiredByWindow.get(windowId).push(id);
    }

    const knownIds = new Set(desiredIds);
    const currentByWindow = new Map();
    for (const w of workspaces) {
      if (!knownIds.has(w.id)) continue;
      if (!currentByWindow.has(w.windowId)) currentByWindow.set(w.windowId, []);
      currentByWindow.get(w.windowId).push(w.id);
    }

    const changedWindows = [...desiredByWindow.entries()].filter(([windowId, order]) => {
      if (order.length < 2) return false;
      const current = currentByWindow.get(windowId) || [];
      // Only the within-group order is achievable, so only that is compared.
      const inGroup = (ids, pinned) => ids.filter((id) => pinnedByWorkspaceId.get(id) === pinned);
      return (
        !arraysEqual(inGroup(order, true), inGroup(current, true)) ||
        !arraysEqual(inGroup(order, false), inGroup(current, false))
      );
    });
    if (changedWindows.length === 0) return;

    try {
      await Promise.all(changedWindows.map(([windowId, order]) => this.#cmux.reorderWorkspaces?.(windowId, order)));
    } catch (err) {
      console.error("Tab order sync error:", err.message);
    }
  }
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
