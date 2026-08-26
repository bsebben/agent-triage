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
    this.#subscribeWorkspaceEvents = subscribeWorkspaceEventsFn || cmux.subscribeWorkspaceEvents;
    this.#immediatePollDebounceMs = immediatePollDebounceMs;
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

  async poll() {
    try {
      const [notifications, workspaces, terminals, agentWsIds, bypassWsIds] = await Promise.all([
        this.#cmux.listNotifications(),
        this.#cmux.listWorkspaces(),
        this.#cmux.listTerminals(),
        this.#cmux.listAgentWorkspaceIds(),
        this.#cmux.listBypassWorkspaceIds(),
      ]);

      for (const id of agentWsIds) this.#knownAgentWorkspaces.add(id);
      for (const id of this.#knownAgentWorkspaces) {
        if (!agentWsIds.has(id)) this.#knownAgentWorkspaces.delete(id);
      }

      const currentIds = new Set();

      // Find the Dashboard workspace ID so we can exclude its notifications
      const dashboardWsId = workspaces.find((w) => w.title === DASHBOARD_WS_NAME)?.id;

      // Enrichment does a git subprocess round-trip per distinct directory
      // (on a cold or expired worktree cache) — resolve all of a poll cycle's
      // items concurrently rather than serializing N round-trips through a
      // sequential await in the loop.
      const relevantNotifications = notifications.filter((n) => n.workspaceId !== dashboardWsId);
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
      const syntheticWorkspaces = workspaces.filter(
        (ws) => ws.title !== DASHBOARD_WS_NAME && !notifiedWorkspaceIds.has(ws.id)
      );
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
      const liveWsIds = new Set(workspaces.map((w) => w.id));
      for (const item of this.#queue.dismissedItems()) {
        if (!item.workspaceId || !liveWsIds.has(item.workspaceId)) {
          this.#queue.remove(item.id);
        }
      }

      if (this.#onUpdate) this.#onUpdate();

      await this.#syncTabOrder(workspaces);
    } catch (err) {
      console.error("Poll error:", err.message);
    }
  }

  // Pushes Agent Triage's own display order (grouped/sorted, dismissed
  // items last) into cmux's real per-window tab order, so cmux's native
  // navigation (and the dashboard's own Cmd+↑/↓) walks the same order
  // shown here. Agent Triage owns ordering — this always wins over a
  // manual drag in cmux.
  async #syncTabOrder(workspaces) {
    const windowIdByWorkspaceId = new Map(workspaces.map((w) => [w.id, w.windowId]));

    const desiredIds = [
      ...this.#queue.grouped().groups.flatMap((g) => g.items.map((i) => i.workspaceId)),
      ...this.#queue.dismissedItems().map((i) => i.workspaceId),
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
      return !arraysEqual(order, currentByWindow.get(windowId) || []);
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
