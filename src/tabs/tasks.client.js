// src/tabs/tasks.client.js — Tasks tab renderer

/**
 * Render the tasks tab content.
 *
 * Displays a text input for adding tasks and a checklist of existing tasks.
 * Done items sort to the bottom with strikethrough styling.
 */
function renderTasks() {
  const prevInput = queue.querySelector(".tasks-input");
  const savedValue = prevInput?.value || "";
  const wasFocused = prevInput && document.activeElement === prevInput;

  const taskStatus = state.tabStatus?.tasks || appConfig.tasks || {};
  if (!taskStatus.enabled) {
    queue.innerHTML = '<div class="empty-state">Tasks tab is disabled. Enable it in Settings.</div>';
    return;
  }

  const tasks = state.tasks || [];
  const inputHtml = `<div class="tasks-input-row">
    <input type="text" class="tasks-input" placeholder="Add a task…"
      onkeydown="if(event.key==='Enter')addTask(this)" />
    <button class="tasks-add-btn" onclick="addTask(this.previousElementSibling)">Add</button>
  </div>`;

  if (tasks.length === 0) {
    queue.innerHTML = `${inputHtml}<div class="empty-state">No tasks yet</div>`;
  } else {
    const rows = tasks.map((t) => {
      const checked = t.done ? "checked" : "";
      const doneClass = t.done ? " task-done" : "";
      return `<div class="task-row${doneClass}" data-task-id="${escapeHtml(t.id)}">
      <label class="task-checkbox-label">
        <input type="checkbox" ${checked} onchange="toggleTask('${escapeHtml(t.id)}', this.checked)" />
        <span class="task-title">${escapeHtml(t.title)}</span>
      </label>
      <button class="task-delete-btn" title="Delete" onclick="deleteTask('${escapeHtml(t.id)}')">×</button>
    </div>`;
    }).join("");

    queue.innerHTML = `${inputHtml}<div class="tasks-list">${rows}</div>`;
  }

  const newInput = queue.querySelector(".tasks-input");
  if (newInput) {
    newInput.value = savedValue;
    if (wasFocused) newInput.focus();
  }
}

/**
 * Add a new task from the input field.
 *
 * Args:
 *   input: The text input DOM element.
 */
async function addTask(input) {
  const title = input.value.trim();
  if (!title) return;
  input.value = "";
  try {
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  } catch {}
}

/**
 * Toggle a task's done state.
 *
 * Args:
 *   id: The task ID.
 *   done: The new done state.
 */
async function toggleTask(id, done) {
  try {
    await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
  } catch {}
}

/**
 * Delete a task.
 *
 * Args:
 *   id: The task ID to delete.
 */
async function deleteTask(id) {
  try {
    await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {}
}
