# Design Redux

An Obsidian plugin that turns the vault into a library: the folders as a tree
in the left sidebar, a folder's notes as a ruled list in the page, a note head
and pages, a strip at the note's foot, a properties panel and property tools.
One look, reduced and raw: monospace at one size, black, white and greys,
framed panes, and Obsidian's chrome hidden. Desktop only.

There are no design documents: the look is in `styles/` (tokens first) and
its rules are held by the tests (`test_reset`, `test_design`, `test_tokens`).
The old plugin (`legacy/`) is gone from the tree; to learn what a feature
did, read it in git history (before 4.0.4). Never build or copy it.

## Files

- `src/<area>/name.js` — the source, ES modules, a folder per area. Areas, in
  layers: `core`, then `ui`, then the features by place (`library`, `note`,
  `maps`, `tools`), then `plugin`. A module imports from its own area and
  those below it; the features' areas don't import each other. No module is
  over 400 lines. `src/main.js` exports the plugin.
- `main.js`, `styles.css` — built, not committed: `npm run build`
  (`build.mjs`; the tests build first). esbuild bundles `src/main.js`; the
  glyphs under `assets/icons/` are bundled as the module `dr:icons`; the
  parts of `styles/` are joined in name order. The build refuses a module
  over 400 lines, one in no area, one nothing imports, an import up or across
  the layers, and a name exported by two modules.
- `styles/NN-name.css` — all styles. 00 tokens, 01 the map onto Obsidian's
  variables, 10–29 the shared components, 30–39 the plugin's places, 40–59
  Obsidian's own regions, 60+ features. The order is the cascade. The first
  comment of each part says what it holds.
- `assets/icons/actions/*.svg` — the plugin's
  glyphs, one file each, held to the icon grammar by `tests/test_glyphs.js`.
  A plugin control never shows one of Obsidian's icons.
- `tests/_specimen.html` — every glyph, component and screen, built (not
  committed) by `npm run specimen` from the same sources; `npm run screenshots` compares it
  with the approved images. A new screen is added to it (`tools/specimen/`).
- `tests/test_*.js` — simulation suites: jsdom, with Obsidian stood in for by
  `tests/obsidian.js`. `npm test`, or `node tests/run.js settings library`.
  `tests/harness.js` gives a suite the whole source as one object (`load()`)
  and a vault to try it in (`world()`).
- `manifest.json`, `versions.json` — never edit versions by hand. `README.md`
  — don't update unless asked.

## How the code is laid out

- A feature is a `class X extends Feature` (`core/feature.js`): `register()`
  once, `enable()` and `disable()` safe to repeat, and everything it adds
  goes through `this.add(...)` so `disable()` takes it all away. `X.key` is
  the setting that turns it on. Features are listed once, in
  `plugin/features.js`.
- What a feature can do is written once, in `actions()`: `{ id, name, glyph,
  on, when, run }`. `on` says what it acts on (app, note, file, editor,
  folder). Commands and menu entries are both made from that list
  (`core/actions.js`). Command ids are the old plugin's: hotkeys hang on
  them, and `tests/test_contract.js` holds every kept id.
- Settings: `core/settings.js` holds every key and its default. A key that
  holds paths is in `PATH_KEYED`, so it follows renames and deletes. The old
  plugin's `data.json` is converted once by `core/migrate.js` and kept whole
  as `data.legacy.json`; every old key is read, migrated, or listed there as
  retired. Never drop a key or a command id without that.
- Core services on the plugin: `plugin.notes` reads and writes a note's
  properties (`write(file, change)` returns an undo that keeps later edits);
  `plugin.files` makes, moves and restores files and folder notes;
  `plugin.index` is what screens read of the vault instead of walking it;
  `plugin.selection` is the pick. Notes are never rewritten by an upgrade.
- A screen is built only from the shared pieces in `src/ui/` (button, row,
  cell, shelf, segments, table, field, sheet, say-so) and the plugin's
  glyphs (`glyph(el, name)`). State is the element's ARIA attribute; the
  styles read nothing else.
- The look: `body.dr-active` and a `dr-region-<name>` class a region, added
  to every window by `Appearance` and removed on unload. Rules on Obsidian's
  own DOM are gated by both and listed in the selector map at the top of the
  part they are in. The plugin's own `dr-` classes are not gated.
- Obsidian's unofficial internals are only touched behind `typeof` checks,
  with a fallback.

## Rules that have bitten before

- No regex lookbehind. No `scope` field on a `Modal`. Settings code uses
  `containerEl.ownerDocument` (Settings opens in a window of its own).
- Menu entries need a section (`setSection('action')` and so on).
- Hover styles only inside `@media (any-hover: hover)`. No `!important`, no
  inline style but the geometry properties a script must set
  (`--dr-size`, positions on a map), no `innerHTML`.
- JS never moves, clones or removes Obsidian's own DOM nodes.

## Working here

- The smallest complete change. Report changed files and tests run, briefly.
- Commit locally; push only when the author asks. Before a push, fetch and
  rebase.
- Test lightly: the suites the change touches while working, `npm test` once
  at the end, `npm run screenshots` when the look changed.
- Keep usage down: grep before reading, read the lines needed, long output
  through `tail`. A long task keeps `.claude-cache/checkpoint.md` current.
- Replies to the author: short, plain.
