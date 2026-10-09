---
paths:
  - "tests/obsidian/**"
  - "wdio.conf.mjs"
  - "tests/e2e.sh"
---

# Real-Obsidian tests

- A test must pass on its own and after the others: earlier tests leave tabs
  open, so use the active leaf (`app.workspace.activeLeaf`, the `ACTIVE`
  selector), never `getLeavesOfType(...)[0]`. Wait for a condition
  (`readUntil`, `waitUntil`), not a fixed pause. Each test's time is in
  `ci-output/<version>-timings.txt`.
- They run in a sandbox too wherever GitHub's release downloads are reachable
  (that's where Obsidian comes from): under `xvfb-run -a`. With no window
  manager there, a few pointer tests behave differently than in CI.
