# Design Redux

An Obsidian plugin that turns the vault into a library: the folders as a tree
in the left sidebar, a folder's notes as a ruled list in the page, a note head
(its properties as a ledger) and pages, a strip at the note's foot, and
property tools.
One look, reduced and raw: monospace at one size, black, white and greys,
framed panes, and Obsidian's chrome hidden. Desktop only.

This file is the only document. The principles below are the design; the
look's values are in `styles/00-tokens.css`, and the tests (`test_reset`,
`test_design`, `test_tokens`) hold what a machine can check. Don't add a
docs folder or a design document: a principle that changes is changed here.
The old plugin (`legacy/`) is gone from the tree; to learn what a feature
did, read it in git history (before 4.0.4). Never build or copy it.

## Principles

The author's own, from a catalogue site's six rules and a screenshot of two
framed panes. Treat them as law; when one is in doubt, take something away.

1. **Subtract until it breaks.** No feature, control, setting, glyph, label
   or line that the screen works without. A feature that only adds commands
   has no switch. When asked to change something, prefer removing it. Gone so
   far, and staying gone: the grid and covers, zoom levels and shelves, the
   glyph builder, the image router, the properties panel and property
   history, most settings, arrows in the tree, the design docs.
2. **An inventory, not a showcase.** A collection is one ruled list, like a
   stock sheet: names in rows, a light rule under each. No grid of cards, no
   images, no counts, no numbers, no decoration that carries nothing.
3. **One job per pane.** The sidebar is the folders as a tree, nothing else.
   A folder's page is its path, then only the notes directly in it; its
   subfolders live in the tree. A note shows its text, and under its title
   its properties as a ledger: ruled rows, name grey, value ink, edited
   where they stand. That is the one place properties are shown; Obsidian's
   own properties block is hidden, and nothing returns the right sidebar.
4. **Small, plain type.** One monospace face at 13px for everything the
   plugin draws. A name that matters (a pane's head) is bold, never bigger.
   No capitals for effect, no tracking, no italics.
5. **Black, white and greys.** White ground, black ink, one grey for
   secondary words, a light rule, a lighter fill for what is open or picked;
   dark mode the inverse. The only other colour is red for an error, with its
   words. Colour in the person's content is theirs, not the interface's.
6. **Structure is the only line.** A pane is framed by 1px ink; its head is
   ruled off under it; rows are ruled; the path is boxed words separated by
   slashes. Nothing else has a border, a radius, a shadow or a blur.
7. **Say it with characters before glyphs.** A folder that holds more ends in
   a slash ("Politics/"). Where a word or a character will do, no icon. The
   plugin's few glyphs are for tools that have no plain word (a map's fit,
   zoom, fold).
8. **No buttons at rest.** The library's panes show none. Everything else is
   in the command palette and Obsidian's own menus. Search is a command, not
   a field.
9. **One cue per state.** Hover underlines. Focus is a 2px ink outline. Open
   or picked is the light fill. Disabled is grey. Nothing else, nothing
   doubled.
10. **The panes are the whole window.** With the look on, Obsidian's chrome
    goes: ribbons, the right sidebar, the status bar, the tab strip, view
    headers. The look off puts it all back. Hide, never move or remove
    Obsidian's own nodes.
11. **Fast and still.** No motion, no transitions, no carousels; draw from
    the index, never walk the vault for a screen; one redraw for many
    changes.
12. **Honest about what it is.** A tool for notes that looks like one: plain
    words that say what a thing does ("Show the vault in the page"), no
    marketing voice, no analogies to other products. Desktop only.

What these left out on purpose: product-style codes on items (`POL-01`):
invented labels carry no information.

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
  head, segments, field, sheet, say-so) and the plugin's
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
