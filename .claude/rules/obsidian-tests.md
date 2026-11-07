---
paths:
  - "tests/obsidian/**"
  - "wdio.conf.mjs"
  - "tests/e2e.sh"
---

# Real-Obsidian tests

- A spec per area (`app`, `library`, `note`, `tools`.e2e.mjs), each in an
  Obsidian and a vault copy of its own. A test goes in its area's spec,
  inside `suite()` (`helpers.mjs`), which before each test puts back what the
  spec began with: settings, sidebars, one tab, theme, inspector, no menus,
  nothing picked. So a test sets up what it needs (`openAlbum`,
  `obsidianPage.openFile`) and never relies on the one before; files it
  makes or moves are its own to put back.
- Use the active leaf (`app.workspace.activeLeaf`, the `ACTIVE` selector),
  never `getLeavesOfType(...)[0]`. Wait for a condition (`readUntil`,
  `waitUntil`), not a fixed pause. Each test's time is in
  `ci-output/<version>-timings.txt`, joined from each spec's (`parts.mjs`).
- The latest Obsidian only: no older version is tested. One at a time
  (`maxInstances` 1): two at once crash each other.
- They run in a sandbox too wherever GitHub's release downloads are reachable
  (that's where Obsidian comes from): under `xvfb-run -a`. With no window
  manager there, a few pointer tests behave differently than in CI.
