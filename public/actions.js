// public/actions.js — action definitions for the per-row drawer

const prActions = [
  {
    id: "status",
    label: "Status update",
    prompt: (pr) =>
      `Give me a quick status update on this PR: ${pr.url}\n\n` +
      `Don't review or analyze the code — just summarize the current state ` +
      `(open/draft/merged, CI, review status, recent activity, my role on it).\n\n` +
      `Then ask what I'd like to do next. Suggest options based on my role: ` +
      `if I'm the author, I might want to update the description, push fixes, ` +
      `address review comments, or mark ready for review; if I'm a reviewer, ` +
      `I might want to leave comments or run a review skill from the ` +
      `review-artisan plugin. Don't pick for me — list a few likely actions and wait.`,
  },
  {
    id: "review",
    label: "Review the PR",
    prompt: (pr) =>
      `Use \`/review-artisan:appraise ${pr.url}\` to do a thorough PR review.\n\n` +
      `If the skill isn't installed, walk through the PR yourself: read the diff ` +
      `file by file, flag simplifications, quality issues, missing tests, and ` +
      `call out anything risky.`,
  },
  {
    id: "refine",
    label: "Address review comments",
    prompt: (pr) =>
      `Use \`/review-artisan:refine ${pr.url}\` to walk through review comments ` +
      `and address them.\n\n` +
      `If the skill isn't installed, fetch the PR's review comments via ` +
      `\`gh api\`, walk through each one, propose a fix with reasoning, and ` +
      `ask before editing.`,
  },
  {
    id: "taskPr",
    label: "Update PR description",
    prompt: (pr) =>
      `Use \`/task-pr\` to update this PR's description in my style: ${pr.url}\n\n` +
      `If the skill isn't installed, look at the diff and commits, draft a ` +
      `description with a short summary, Changes section if relevant, and ` +
      `Testing section (Local or unit tests). Don't include AI attribution.`,
  },
];

const ticketActions = [
  {
    id: "investigate",
    label: "Investigate and plan",
    prompt: (ticket) =>
      `Investigate this ticket and propose an implementation plan: ` +
      `${ticket.key} - ${ticket.summary}\n\n${ticket.url}\n\n` +
      `Read the description and comments, look at related code in the ` +
      `workspace, then sketch a plan: which files change, what tests are ` +
      `needed, and any open questions before starting. Don't start coding yet.`,
  },
  {
    id: "taskStart",
    label: "Start work on it",
    prompt: (ticket) =>
      `Use \`/task-start ${ticket.key}\` to begin work on this ticket.\n\n` +
      `If the skill isn't installed, create a feature branch named after the ` +
      `ticket, read the ticket details, set up commit context, and offer a ` +
      `brief implementation plan before coding. Ticket: ${ticket.url}`,
  },
];
