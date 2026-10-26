# Design Redux

An Obsidian plugin that makes the vault feel like Apple Music: folders open as
albums, notes as tracks, with covers, a library sidebar, a context strip along
the bottom, property tools, and mind maps. Goes with the author's theme,
Coffee N' Christmas.

## Files

- `src/<area>/NNN-name.js` — the source, as ES modules in a folder per area
  (core, ui, tree, then the four places — library, note, maps, tools —
  and plugin). Each
  imports what it uses and exports what it declares; `src/main.js` imports
  the plugin, whose imports reach every module (the build refuses one
  nothing imports), and exports it. After using a name from another module,
  `node tests/map.js --fix-imports` writes the import lines. A new module goes in its area with a number
  between its neighbours'. `obsidian` and `@codemirror/*` are imported as
  usual and provided by Obsidian at runtime.
- `main.js` — built, not committed. `npm run build` (tests build it first):
  esbuild bundles `src/main.js` into it. Never edit it: edit `src/`. The build
  refuses a name declared in two modules, a name used without importing it, a
  use across the layers that isn't on the known list, a module that needs a
  name as it loads from one that runs after it (a cycle runs from the module
  `src/main.js` imports first), and a `main.js` that fails as it loads.
- `styles/NN-name.css` — all styles, in parts the build joins, in order, into
  `styles.css` (built, not committed; never edit it: edit `styles/`). The
  order is the cascade: a new rule goes in the part it dresses, after what it
  overrides. The map at the top of `04-foundation.css` says what each part is.
- `manifest.json`, `versions.json` — **never edit versions by hand.** The release
  workflow bumps the patch version itself; a commit with a `Release-As: X.Y.Z`
  line releases that version instead (only when the author asks).
- `README.md` — don't update unless asked.
- `docs/architecture.md` — the architecture audit and the refactor roadmap
  (milestones M0–M8): read it before moving code between pieces.
- `tests/test_*.js` — simulation suites (jsdom + real CodeMirror, Obsidian stood
  in for). `npm test`, or `node tests/run.js qol album` for just some.
- `tests/test_lifecycle.js` checks command ids, setting keys and view types against
  `tests/snapshots/lifecycle.json`, and `tests/test_layers.js` checks uses across
  the layers against `tests/snapshots/layers.json` (`node tests/map.js --areas`
  shows them). After a deliberate change: `node tests/test_lifecycle.js
  --update`, `node tests/map.js --check --update`. Never drop a command id or a
  setting key without a migration.
- `tests/obsidian/` — tests inside the real Obsidian (`wdio.conf.mjs`,
  wdio-obsidian-service), run by GitHub Actions on the oldest supported version
  and the latest.
- `.claude/rules/` — notes for one area each (the canvas adapter, albums and
  the browse view, quiet links, real-Obsidian tests). Claude Code loads one
  when a file of its area is opened; other agents: read it before changing
  that area. `.claude/skills/diagnose-tests` says how to read a failure.

## How the code is laid out

- Each feature is a `class X extends Feature` with `settingsSchema()`,
  `actions()`, `register()` (events, once), `enable()` / `disable()` / `sync()`,
  and `X.settingKey` naming the toggle that switches it on. `enable()` runs on
  every settings save, so it must be safe to call repeatedly.
- What a feature does is written once in `actions()` (`078-actions.js`): each
  says what it acts on (`on`: app, note, file, editor, canvas, mindmap, album, browse);
  its commands come from them, and menus of that thing are built from the
  same list (`addActionEntries`, `addActionItems`). Keep command ids: hotkeys
  hang on them.
- `DEFAULTS` holds every setting. Settings rows are placed by `SETTINGS_TABS`: a tab for each
  category (General, Appearance — the look's rows first —, Library, Notes, Inspector, Maps, Advanced), in it one row a feature (its `switch` key, and in `keys` what its gear opens); a new
  row's key must be added to one feature, and to none twice. The look rows are `LOOK_KEYS`.
- Settings keyed by a file's path go in `PATH_KEYED`, so they follow renames and
  deletes (see `Orders.followRename`).
- Layers, by folder (`node tests/map.js --areas`): core, then shared UI (`ui`)
  and the pure map tree (`tree`, which imports only core), then the features by place (library
  and albums; note: panel, footnotes, scripts, quiet links; maps: mind maps; tools: bulk edits,
  strip, modes, graph), then the plugin. A module imports from its own area and those below;
  the build and `tests/test_layers.js` refuse a new import across.
- Core services on the plugin: `plugin.notes` reads and writes a note's
  properties — read with `noteProps(app, file)`, write with
  `plugin.notes.write(file, change, { undo })`, whose Undo keeps what was edited
  since; never `processFrontMatter` directly. `plugin.files` makes, moves and puts
  back files and folder notes (the plugin's `moveFile` and so on pass to it).
  `libraryIndex(plugin)` (077) is what screens read of the vault — `notes()`,
  `markdown()`, `folders()`, `folderNotes()`, `count(folder)`,
  `hasNotes(folder)`, `incoming(file)`, `outgoing(file)` — kept while files
  and links stay as they are; read it rather than walking the vault.
- A large class can be written in parts, chained by `extends`: each part
  extends the one before it, and the class extends the last (BrowseView in
  120 over 121–125; MindMaps in 420 and MindMapView in 421 over the rest of
  maps, in the order their `extends` name). A part's methods are the class's;
  a test refuses a name written in two parts, so none quietly replaces
  another. A lower area that needs a higher one's work asks the plugin
  (`plugin.mapNoteRelationships`), never patches a class.
- Features tell each other through workspace events where they can
  (`design-redux:renamed`, `design-redux:property-renamed`,
  `design-redux:panel-changed`).
- An element that acts as a button: `asButton(el, label)` and `onActivate`.
- A feature adds to the note panel with `panelSections(panel)`: `PanelSection`
  instances (082), drawn between the properties and the mentions. The panel
  is where a note is edited: on a computer, docked in the right sidebar as
  the inspector (179, `INSPECTOR_VIEW`); on a phone, a sheet. What the
  inspector is about is `plugin.coordinator`'s to say (084): the tab worked
  in, a pick, a canvas card, a map node, and the pin, kept as a snapshot
  `{ target, leaf, origin, pinned }` the docked panel draws.
- What's picked is `plugin.selection` (076), apart from what's open. In the
  browse view, rows and tiles go through `pickOrOpen`. While the inspector
  shows (`inspectorShowing`), a click picks and a double click or Enter
  opens. The browse view (124) draws what the library knows of a pick into
  the inspector: an album in brief, and a picked note's Open / Reveal in
  collection / More.
- Obsidian's unofficial internals (submenus, canvas internals, the graph's renderer, menu item lists,
  `metadataTypeManager`, `internalPlugins`) are only touched behind `typeof`
  checks, with a fallback. A plain canvas's go through the adapter (`core/079`:
  `liveCards`, `cardCount`, `pickedOnCanvas`, `addTextCard`,
  `requestCanvasSave`, …); `tests/test_layers.js` refuses a new direct use
  outside it, and after moving some onto it, `node tests/map.js --internals
  --update`.

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
- The canvas adapter and quiet links have notes of their own in `.claude/rules/`.

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
    PIECE` (where a name is declared and who uses it; `--who` gives the
    lines) → grep and the few lines needed → a whole
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
