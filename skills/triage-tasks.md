---
name: triage-tasks
description: Manage your Agent Triage task list — add, list, complete, and delete tasks from the dashboard. Use when someone says "add a task", "add to triage tasks", "check off task", "show my tasks", "remove task", "triage task list", "what's on my task list", or "mark task done".
allowed-tools: [Bash]
---

# Triage Tasks

Manage the Agent Triage dashboard task list via its REST API.

## API Base

All requests go to `http://localhost:7777/api/tasks`. The Agent Triage dashboard must be running.

## Operations

### List tasks

```bash
curl -sf http://localhost:7777/api/tasks | jq .
```

### Add a task

```bash
curl -sf -X POST http://localhost:7777/api/tasks \
  -H 'Content-Type: application/json' \
  -d '{"title":"TASK_TITLE_HERE"}'
```

### Complete a task (mark as done)

First list tasks to find the ID, then:

```bash
curl -sf -X PATCH http://localhost:7777/api/tasks/TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"done":true}'
```

### Uncomplete a task (mark as not done)

```bash
curl -sf -X PATCH http://localhost:7777/api/tasks/TASK_ID \
  -H 'Content-Type: application/json' \
  -d '{"done":false}'
```

### Delete a task

```bash
curl -sf -X DELETE http://localhost:7777/api/tasks/TASK_ID
```

## Error Handling

- If curl fails with "connection refused", tell the user: "The Agent Triage dashboard isn't running. Start it with `npm start` in the agent-triage directory, or make sure cmux is running."
- If the API returns `{"error":"Tasks tab is not enabled..."}`, tell the user: "The Tasks tab is disabled. Enable it in the Agent Triage dashboard Settings panel."
- Always use `-sf` flags with curl so failures are surfaced as non-zero exit codes.

## Usage Notes

- When adding a task, confirm success by showing the created task's title.
- When listing tasks, format them as a numbered list showing title and done status.
- When completing or deleting, confirm the action to the user.
- You can add multiple tasks in one go by making multiple POST requests.
