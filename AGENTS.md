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
- Canvas folds (`316`, `317`, `335`–`339`): a tucked card keeps its own place in
  the file and only answers `getBBox` with its fold's box, so arrows end at the
  fold. A pass never saves — only a fold, unfold or tidy by hand does: a canvas
  can be rewritten from outside while open, and each save is a step of Undo
  that, undone, would only start the pass again.
- Quiet links: Obsidian reads `[[[X]]]` as a link to a missing "[X". They're
  set aside from each note's cache in `metadataCache` 'changed' — which fires
  before Obsidian counts the note's links — and swept once after 'resolved'
  for notes it remembered. That keeps the stand-in out of the graph, backlinks,
  Outgoing links, the [[ list and Quick switcher; don't patch those separately.
  Obsidian doesn't update quiet links on rename; the plugin does.

## Working here

- Test lightly, the author wants it quick: before pushing, run the simulation
  suites the change touches (`node tests/run.js qol album`), and an Obsidian
  test only for what can't be checked otherwise — just the tests for it
  (`--mochaOpts.grep`), on the latest version (`WDIO_LATEST_ONLY=1`). CI runs everything on both
  versions after the push; fix what it finds. CI keeps only a few screenshots.
- Before pushing, fetch and rebase: the release workflow commits version bumps
  to the default branch.
- CI results (summary, test output, a few screenshots from the latest real
  Obsidian, and a compatibility report of the internals the plugin uses) are
  published to the `ci-results` branch:
  `git fetch origin +ci-results:refs/remotes/origin/ci-results` (the clone is
  single-branch), then `git show origin/ci-results:summary.txt`. The
  screenshots are the real app, but look at one only when a UI change needs
  checking: the author wants usage kept down.
- Replies to the author: short, plain, no version-number bookkeeping.
