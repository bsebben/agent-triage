// Synthetic PRs for screenshots, shown above the real ones on the Mine tab. Revert the commit that added this file to remove.

const DEMO_PULL_GROUPS = (() => {
  const ago = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
  const none = { approved: [], blocked: [], unresolvedThreads: 0 };
  const group = (extra) => ({ ...none, ...extra });
  const pr = (number, title, status, ci, hoursOld, human, bot, threadsTruncated = false) => ({
    number,
    title,
    status,
    ci,
    url: `https://example.com/demo-service/pull/${number}`,
    author: "alice",
    isDraft: status === "draft",
    createdAt: ago(hoursOld),
    readyForReviewAt: status === "draft" ? null : ago(hoursOld),
    reviewers: { human: group(human), bot: group(bot), threadsTruncated },
  });

  return [{
    repo: "demo-service",
    prs: [
      pr(9001, "feat: add retry to the deploy poller", "comments", "passing", 30, { blocked: ["bob"], unresolvedThreads: 2 }, { unresolvedThreads: 5 }),
      pr(9002, "fix: stop stale pills from persisting", "comments", "failing", 52, { unresolvedThreads: 3 }, {}),
      pr(9012, "feat: rework review request routing so pull requests assigned to a team are shown to every member until one of them picks it up, then collapse duplicates across repositories and sub-teams into a single row", "comments", "passing", 18, { blocked: ["bob"], unresolvedThreads: 4 }, { unresolvedThreads: 3 }),
      pr(9013, "fix: stop the workspace card jittering when a branch such as feature/very-long-branch-name-with-many-segments-and-no-spaces-to-wrap-on-narrow-panels is shown in the title area", "open", "failing", 6, { approved: ["bob"] }, { approved: ["example-bot"], unresolvedThreads: 2 }),
      pr(9014, "refactor: split the monolithic pulls client into a table renderer, a reviewer group renderer, a status icon module, and a demo data module, and move the shared card styling so tickets and pull requests render identically in both the wide and narrow layouts", "approved", "running", 44, { approved: ["bob", "carol"], unresolvedThreads: 12 }, { unresolvedThreads: 6 }, true),
      pr(9009, "feat: rework the settings panel layout", "comments", "passing", 40, { unresolvedThreads: 12 }, {}),
      pr(9010, "refactor: extract the review thread mapper", "comments", "passing", 10, {}, {}, true),
      pr(9003, "chore: bump dependencies", "open", "passing", 5, {}, { unresolvedThreads: 4 }),
      pr(9005, "refactor: split the pulls client", "open", "running", 3, {}, { approved: ["example-bot"] }),
      pr(9011, "feat: add a keyboard shortcut cheatsheet", "open", "passing", 2, {}, {}),
      pr(9004, "docs: update the config reference", "approved", "passing", 20, { approved: ["bob"] }, { unresolvedThreads: 1 }),
      pr(9006, "feat: add the worktree pill", "queued", "running", 8, { approved: ["bob"] }, { approved: ["example-bot"] }),
      pr(9007, "fix: debounce workspace refresh", "queue_failed", "failing", 26, { approved: ["bob"] }, {}),
      pr(9008, "wip: rework session refresh", "draft", "none", 1, {}, {}),
    ],
  }];
})();
