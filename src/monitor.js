import * as cmux from "./cmux.js";

const DASHBOARD_WS_NAME = "Agent Triage Dashboard Host";

export function parseScreenForQuestion(screen) {
  if (!screen) return null;
  const lines = screen.split("\n");

  let question = null;
  const options = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect question lines (quoted text ending in ?)
    if ((line.startsWith('"') || line.startsWith("'")) && line.includes("?")) {
      question = line.replace(/^["']|["']$/g, "");
    }

    // Detect option lines (prefixed with ❯, >, ●, ○, or numbered)
    if (/^[❯>●○◉◎►▸]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const optionText = line.replace(/^[❯>●○◉◎►▸]\s+/, "").replace(/^\d+[.)]\s+/, "");
      if (optionText && optionText !== "Other") {
        options.push(optionText);
      }
    }
    // Also detect indented options following the selected one
    if (options.length > 0 && /^\s{2,}[A-Za-z]/.test(lines[i]) && !line.startsWith('"')) {
      const optionText = line;
      if (optionText && optionText !== "Other") {
        options.push(optionText);
      }
    }
  }

  if (!question && options.length === 0) return null;

  return { question, options };
}

export async function enrichNotification(notification, workspaces, terminals, readScreenFn) {
  const workspace = workspaces.find((w) => w.id === notification.workspaceId);
  const terminal = terminals?.find((t) => t.workspaceId === notification.workspaceId);

  const directory = terminal?.directory || workspace?.directory || null;

  const enriched = {
    ...notification,
    workspaceTitle: workspace?.title || null,
    workspaceDir: directory,
    workspaceSelected: workspace?.selected || false,
    gitBranch: terminal?.gitBranch || null,
    screenContent: null,
    parsedQuestion: null,
  };

  if (notification.category === "waiting" || notification.category === "question") {
    const reader = readScreenFn || cmux.readScreen;
    enriched.screenContent = await reader(notification.surfaceId, 30);

    if (enriched.screenContent) {
      const parsed = parseScreenForQuestion(enriched.screenContent);
      if (parsed) {
        enriched.parsedQuestion = parsed;
        enriched.category = "question";
      }
    }
  }

  return enriched;
}

export class Monitor {
  #queue;
  #interval = null;
  #onUpdate = null;
  #pollIntervalMs;
  #knownAgentWorkspaces = new Set();
  #cmux;

  constructor(queue, { pollIntervalMs = 5000, onUpdate = null, cmuxApi = null } = {}) {
    this.#queue = queue;
    this.#pollIntervalMs = pollIntervalMs;
    this.#onUpdate = onUpdate;
    this.#cmux = cmuxApi || cmux;
  }

  start() {
    this.poll();
    this.#interval = setInterval(() => this.poll(), this.#pollIntervalMs);
  }

  stop() {
    if (this.#interval) clearInterval(this.#interval);
  }

  async poll() {
    try {
      const [notifications, workspaces, terminals, agentWsIds] = await Promise.all([
        this.#cmux.listNotifications(),
        this.#cmux.listWorkspaces(),
        this.#cmux.listTerminals(),
        this.#cmux.listAgentWorkspaceIds(),
      ]);

      for (const id of agentWsIds) this.#knownAgentWorkspaces.add(id);
      for (const id of this.#knownAgentWorkspaces) {
        if (!agentWsIds.has(id)) this.#knownAgentWorkspaces.delete(id);
      }

      const currentIds = new Set();

      // Find the Dashboard workspace ID so we can exclude its notifications
      const dashboardWsId = workspaces.find((w) => w.title === DASHBOARD_WS_NAME)?.id;

      for (const n of notifications) {
        if (n.workspaceId === dashboardWsId) continue;
        currentIds.add(n.id);
        const enriched = await enrichNotification(n, workspaces, terminals);
        this.#queue.upsert(enriched);
      }

      const notifiedWorkspaceIds = new Set(notifications.map((n) => n.workspaceId));
      for (const ws of workspaces) {
        if (ws.title === DASHBOARD_WS_NAME) continue;
        if (!notifiedWorkspaceIds.has(ws.id)) {
          const category = this.#knownAgentWorkspaces.has(ws.id) ? "running" : "terminal";
          const syntheticId = `synthetic-${ws.id}`;
          currentIds.add(syntheticId);
          const terminal = terminals?.find((t) => t.workspaceId === ws.id);
          this.#queue.upsert({
            id: syntheticId,
            workspaceId: ws.id,
            surfaceId: null,
            category,
            body: "",
            workspaceTitle: ws.title || null,
            workspaceDir: terminal?.directory || ws.directory || null,
            workspaceSelected: ws.selected || false,
            gitBranch: terminal?.gitBranch || null,
          });
        }
      }

      // Remove active (non-dismissed) items that cmux no longer reports.
      for (const item of this.#queue.items()) {
        if (!currentIds.has(item.id)) {
          this.#queue.remove(item.id);
        }
      }

      if (this.#onUpdate) this.#onUpdate();
    } catch (err) {
      console.error("Poll error:", err.message);
    }
  }
}
