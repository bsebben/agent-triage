// public/actions.js — action definitions for the per-row drawer

const prActions = [
  {
    id: "discuss",
    label: "Discuss It",
    prompt: (pr) =>
      `I want to discuss this PR — I have questions or want to talk it through, ` +
      `not necessarily take action yet: ${pr.url}\n\n` +
      `Load context first: read it with \`gh pr view ${pr.number}\` and the diff with ` +
      `\`gh pr diff ${pr.number}\`. The branch is \`${pr.branch}\` — you can inspect its ` +
      `code without checking it out (\`gh\`, \`git show origin/${pr.branch}:<file>\`), ` +
      `and only check it out if we decide the discussion calls for it (I may have other ` +
      `work on the current branch). Then ask what I'd like to discuss. ` +
      `Don't make changes or run review/fix skills unless I ask.`,
  },
  {
    id: "explain",
    label: "Explain it",
    prompt: (pr) =>
      `Give me a high-level overview of what this PR does and why: ${pr.url}\n\n` +
      `Load context first: \`gh pr view ${pr.number}\` and \`gh pr diff ${pr.number}\`. ` +
      `Summarize the overall change in plain language — don't critique it, don't list ` +
      `action items. After the overview, offer to walk me through the files in more ` +
      `detail if I want.`,
  },
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
      `I might want to leave comments or run a review tool if I have one ` +
      `installed. Don't pick for me — list a few likely actions and wait.`,
  },
  {
    id: "review",
    label: "Review the PR",
    prompt: (pr) =>
      `Do a thorough review of this PR: ${pr.url}\n\n` +
      `Read the diff file by file, flag simplifications, quality issues, missing ` +
      `tests, and anything risky. If you have a tool for posting a structured ` +
      `review with inline comments, use it — otherwise just share your findings here.`,
  },
  {
    id: "refine",
    label: "Address review comments",
    prompt: (pr) =>
      `Walk through this PR's review comments and address them: ${pr.url}\n\n` +
      `Fetch the comments (e.g. via \`gh api\`), propose a fix for each with ` +
      `reasoning, and ask before editing. If you have a tool for drafting and ` +
      `posting replies to review comments, use it.`,
  },
  {
    id: "ciFix",
    label: "Fix CI",
    prompt: (pr) =>
      `Check out the branch \`${pr.branch}\` then use \`/ci fix\` to investigate ` +
      `and fix the failing CI on this PR: ${pr.url}\n\n` +
      `If the skill isn't installed, check CI status with ` +
      `\`gh pr checks ${pr.number}\`, read the logs of failing jobs, ` +
      `reproduce the failures locally, fix the code, and push. ` +
      `Iterate until CI is green.`,
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
  {
    id: "updateFromMain",
    label: "Update from main",
    prompt: (pr) =>
      `Resolve merge conflicts and bring this PR's branch (${pr.branch}) up to ` +
      `date with main: ${pr.url}\n\n` +
      `Auto-detect whether to rebase onto main (no reviews yet, keeps history ` +
      `linear) or merge main in (preserves existing approvals). Locate or create ` +
      `a worktree, resolve conflicts, push. Flag anything genuinely ambiguous ` +
      `(contradictory logic changes) for me instead of guessing.`,
  },
];

const ticketActions = [
  {
    id: "discuss",
    label: "Discuss It",
    prompt: (ticket) =>
      `I want to discuss this ticket — I have questions or want to talk it through, ` +
      `not necessarily start work: ${ticket.key} - ${ticket.summary}\n\n${ticket.url}\n\n` +
      `Read the description and comments for context, then ask what I'd like to discuss. ` +
      `Don't start coding or run task skills unless I ask.`,
  },
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
