---
name: design-redux-task
description: Start one Design Redux ticket cheaply — locate the code, read only what's needed, plan, and pick the suites — before any edit.
---

# Starting a ticket

One ticket, one branch, one PR. Before editing, in this order, and stop as
soon as you know enough:

1. **Locate.** `node tools/context-pack.mjs --feature WORDS --budget 2500`
   (or `--files 122 180`): owners, declarations, callers, styles, rules,
   suites, and what it couldn't tell. An unknown word fails with suggestions:
   pick one, don't widen to the whole tree.
2. **Narrow.** `node tests/map.js --who NAME` for where a name lives and
   who uses it; `node tools/css-owners.mjs --selector .x --explain` or
   `--component NAME` for who styles what and which rule wins.
3. **Read bounded.** `grep -n` first, then `sed -n 'A,Bp'` of the lines
   needed — 100–200 at most at first, then only direct callers and callees.
   Never a whole large `src/` file or a whole stylesheet.
4. **Check what's done.** `git log --oneline origin/main..` on the stack and
   `.claude-cache/checkpoint.md`: much of the brief is already in open PRs.
   Build on the branch that holds the area, not on main.
5. **Plan in a few lines:** the files, the existing service to reuse (notes,
   files, coordinator, selection, inspectables, BulkSelection), the
   invariant at risk, and the test that will show it.
6. **Pick the suites.** `node tools/affected-tests.mjs --changed PATHS`
   while working (`npm run build` first: `run.js` doesn't build);
   `npm test` before pushing; `tests/e2e.sh "name"` only for what a
   simulation can't show.

Report back short: files changed, tests run, what's left.
