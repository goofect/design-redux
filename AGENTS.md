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
  and the latest.
- `.claude/rules/` — notes for one area each (canvas internals, albums and
  the browse view, quiet links, real-Obsidian tests). Claude Code loads one
  when a file of its area is opened; other agents: read it before changing
  that area. `.claude/skills/diagnose-tests` says how to read a failure.

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
- Canvas internals and quiet links have notes of their own in `.claude/rules/`.

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
- Before pushing, fetch and rebase: the release workflow commits version bumps
  to the default branch.
- After pushing, run `tests/ci.sh` once (with a long timeout): it waits for
  CI and prints how it went, whether it was released, and only the failing
  lines. Don't check CI by hand in a loop.
- Keep usage down, the author pays for it:
  - No throwaway probe scripts in real Obsidian when a simulation or an
    existing test can show it.
  - Don't read a large `src/` file whole: grep, then read the lines needed.
  - Look before reading, narrowest first: file names → `node tests/map.js
    [words]` (pieces, their features and suites) → `--who NAME` or `--deps
    PIECE` (where a name is declared and who uses it; the pieces share one
    scope; `--who` gives the lines) → grep and the few lines needed → a whole
    file only when the change needs it. Soft limits, widened when correctness
    needs it: a first read of 100–200 lines, then only the direct callers and
    callees; passing tests as a summary, a failure as its own lines.
  - A long task: keep a short checkpoint in `.claude-cache/checkpoint.md` —
    objective, files, constraints, changes, tests, what's left, the next
    step; conclusions, not transcripts — at the turn between phases, and read
    it after a compaction or in a new session. Unrelated work goes in a
    session of its own.
  - `node tests/tool-log.js` sums up the session (a hook logs each tool call:
    file and size, not contents): repeat and broad reads, output size, and
    tokens — input not served from the cache is the number to bring down.
  - Long output goes through `tail`/`grep` or into a file, never in full.
  - CI results (summary, test output, a few screenshots, a report of the
    internals used) are on the `ci-results` branch; `tests/ci.sh` reads what
    matters. Look at a screenshot only when a UI change can't be checked
    otherwise.
- Replies to the author: short, plain, no version-number bookkeeping.
