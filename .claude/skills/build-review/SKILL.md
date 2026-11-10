---
name: build-review
description: Build one Design Redux change in a worktree, have it reviewed read-only, fix once, then land it — the briefs to hand each agent and what the reviewer looks for.
---

# Build, review, land

One change, two agents and one fix round. The orchestrator writes the
briefs, runs the tests itself at the end, and lands the change.

1. **Builder brief.** Work in a worktree of your own. First `git log
   --oneline -1`: it must be the base named in the brief; if it isn't,
   `git reset --hard <base>` (a fresh worktree, so it's safe) and check
   again. Make the smallest complete change (AGENTS.md); while working, run
   the suites it touches (`node tests/run.js album qol`); at the end,
   `npm test`, all of it passing. Commit once, a short plain sentence in the
   repo's style (`git log --oneline -5`) with the Co-Authored-By line. Don't
   push. Report briefly: the commit, the files changed, the tests run, what's
   left.
2. **Reviewer brief.** Read-only: no edits, no commits. Read the diff
   (`git diff <base>..<branch>`) and only the code around it. Give a verdict,
   **ship** or **fix first**. For each problem, file:line and the scenario
   that fails (what the user does, what goes wrong). At most 3 nits.
3. **The loop.** On fix first, the builder gets the problems as they were
   written and fixes them in one round, one more commit. No second review
   unless a fix changed the design. Then the orchestrator runs `npm test`
   in the worktree itself, fast-forwards main onto the branch
   (`git merge --ff-only`), and removes the worktree.

## Reviewer checklist

What reviewers have actually caught here:

- Built on the wrong base: `git log -1` isn't what the brief named.
- A cache or key that goes stale: an album reorder that only does `saveData`
  and fires nothing, so what shows the order doesn't redraw; a cache key
  without the file's mtime.
- `sync()` clearing what should be kept (it runs on every layout change).
- A pinned tab replaced: a note opened without `openInPage` / `stepInAlbum`.
- `saveSettings` where `saveData` and `plugin.queueSync()` would do.
- A dialog promising an Undo the code can't give: `Orders.followDelete`
  wipes the `PATH_KEYED` settings of what's deleted.
- An async target gone stale: after an `await`, check
  `app.vault.getAbstractFileByPath(path) === file` before acting on it.
- A test stub that's synchronous where the real thing is async (`openFile`,
  `processFrontMatter`, `trash`), so a race can't show.
- Tests that pass without the fix: revert the fix and run them.
