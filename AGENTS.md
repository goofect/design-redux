# Design Redux

An Obsidian plugin that makes the vault feel like Apple Music: folders open as
albums, notes as tracks, with covers, a library sidebar, a context strip along
the bottom, property tools, and canvas extras. Goes with the author's theme,
Coffee N' Christmas.

## Files

- `src/NNN-name.js` — the source: one plain-JavaScript script cut into pieces at
  its section headings. **Not modules**: `build.mjs` joins them in name order
  into `main.js`, and they share one scope — a piece uses anything declared in
  an earlier one directly, and (inside functions) anything in a later one. A
  class extending another must come after it. New pieces get a number between
  their neighbours'. `obsidian`, `@codemirror/view` and `@codemirror/state` are
  provided by Obsidian at runtime (required in `010-imports.js`).
- `main.js` — built, not committed. `npm run build` (tests build it first).
  Never edit it: edit `src/`. The build refuses a name declared twice or a
  script that won't parse.
- `styles.css` — all styles.
- `manifest.json`, `versions.json` — **never edit versions by hand.** The release
  workflow bumps the patch version itself.
- `README.md` — don't update unless asked.
- `tests/test_*.js` — simulation suites (jsdom + real CodeMirror, Obsidian stood
  in for). `npm test`, or `node tests/run.js qol album` for just some.
- `tests/obsidian/` — tests inside the real Obsidian (`wdio.conf.mjs`,
  wdio-obsidian-service), run by GitHub Actions on the oldest supported version
  and the latest. They run in a sandbox too wherever GitHub's release downloads
  are reachable (that's where Obsidian comes from): under `xvfb-run -a`.

## How the code is laid out

- Each feature is a `class X extends Feature` with `settingsSchema()`,
  `commands()`, `register()` (events, once), `enable()` / `disable()` / `sync()`,
  and `X.settingKey` naming the toggle that switches it on. `enable()` runs on
  every settings save, so it must be safe to call repeatedly.
- `DEFAULTS` holds every setting. Settings rows are placed in the settings tab by
  `SETTINGS_TABS`; a new row's key must be added there.
- Settings keyed by a file's path go in `PATH_KEYED`, so they follow renames and
  deletes (see `Orders.followRename`).
- Obsidian's unofficial internals (submenus, canvas internals, the graph's renderer, menu item lists,
  `metadataTypeManager`, `internalPlugins`) are only touched behind `typeof`
  checks, with a fallback.

## Rules that have bitten before

- No regex lookbehind (`(?<=`, `(?<!`): it breaks Obsidian on iOS before 16.4.
- Hover styles only inside `@media (any-hover: hover)`.
- Don't give a `Modal` subclass a field called `scope`: Obsidian uses it for the
  dialog's keys.
- Obsidian 1.13 opens Settings in a window of its own: settings code must use the
  tab's own elements (`containerEl.ownerDocument`), never the main `document`.
- Menu entries need a section (`setSection('action')` etc.), or Obsidian sorts
  them after its own.
- Newer Obsidian outranks plain rules on some of its own blocks (the note's
  properties): hiding them needs `!important`.
- A canvas can open before its cards are loaded; count them again when they arrive.
- Canvas folds (`316`–`318`, `335`–`339`): a tucked card keeps its own place in
  the file and only answers `getBBox` with its fold's box, so arrows end at the
  fold. A pass never saves — only a fold, unfold or tidy by hand does: a canvas
  can be rewritten from outside while open, and each save is a step of Undo
  that, undone, would only start the pass again. Folds and tidies glide
  (`glideCanvasModel`); no pass runs while `state.gliding`, and anything new
  calls `settle(view)` first so it starts from where the cards are going.
  A fold notes what its closing-up moved (`drRoom` on the folded card) and
  unfolding moves exactly that back — never make room again by guessing, or
  layouts drift. A tucked card only moves with its fold. Obsidian finds cards
  under the pointer from an index that still lists tucked ones, so the
  canvas's `getIntersectingNodes` and `hitTestNode` are wrapped (`336`) to
  leave them out.
- Arrow styles (`332`): the canvas edge prototype's `updatePath`, `getCenter`
  and `getBBox` are wrapped once with `around()`, and an arrow is redrawn
  after Obsidian draws it; anything unexpected falls back to Obsidian's own
  drawing. An arrow's style is in its data as `drArrow`.
- Quiet links: Obsidian reads `[[[X]]]` as a link to a missing "[X". They're
  set aside from each note's cache in `metadataCache` 'changed' — which fires
  before Obsidian counts the note's links — and swept once after 'resolved'
  for notes it remembered. That keeps the stand-in out of the graph, backlinks,
  Outgoing links, the [[ list and Quick switcher; don't patch those separately.
  Obsidian doesn't update quiet links on rename; the plugin does.

## Working here

- Make the smallest complete change: no rewriting files or touching unrelated
  code. Report changed files and tests run, briefly.
- Test lightly, the author wants it quick: while working, run the simulation
  suites the change touches (`node tests/run.js qol album`: a line per suite,
  details only on failure); before pushing, all of them (`npm test`, ~10 s,
  a few at once). A real-Obsidian test only for what can't be checked
  otherwise: `tests/e2e.sh "test name"` (latest version only, prints just the
  outcome; the full log is `logs/e2e.log`). CI runs everything on both
  versions after the push; fix what it finds.
- A real-Obsidian test must pass on its own and after the others: earlier
  tests leave tabs open, so use the active leaf (`app.workspace.activeLeaf`,
  the `ACTIVE` selector), never `getLeavesOfType(...)[0]`. Wait for a
  condition (`readUntil`, `waitUntil`), not a fixed pause. Each test's time
  is in `ci-output/<version>-timings.txt`.
- Before pushing, fetch and rebase: the release workflow commits version bumps
  to the default branch.
- After pushing, run `tests/ci.sh` once (with a long timeout): it waits for
  CI and prints how it went, whether it was released, and only the failing
  lines. Don't check CI by hand in a loop.
- Keep usage down, the author pays for it:
  - No throwaway probe scripts in real Obsidian when a simulation or an
    existing test can show it.
  - Don't read a large `src/` file whole: grep, then read the lines needed.
  - Long output goes through `tail`/`grep` or into a file, never in full.
  - CI results (summary, test output, a few screenshots, a report of the
    internals used) are on the `ci-results` branch; `tests/ci.sh` reads what
    matters. Look at a screenshot only when a UI change can't be checked
    otherwise.
- Replies to the author: short, plain, no version-number bookkeeping.
