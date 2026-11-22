# Design Redux

An Obsidian plugin that turns the vault into a library: the folders as a tree
in the left sidebar, a folder's notes as a list in the page, a note head
(its properties as a ledger) and pages, and property tools.
One look, reduced and raw, a catalogue site's: small capital labels in one
monospace, black, white and one grey, space instead of lines, and
Obsidian's chrome hidden. Desktop only.

This file is the only document. The principles below are the design; the
look's values are in `styles/00-tokens.css`, and the tests hold what a
machine can check (`test_reset`, `test_design`, `test_tokens` the look;
`tests/obsidian/` the plugin in the real app). Don't add a docs folder or a
design document: a principle that changes is changed here.
The old plugin (`legacy/`) is gone from the tree; to learn what a feature
did, read it in git history (before 4.0.4). Never build or copy it.

## Principles

The author's own, from a catalogue site's six rules and a screenshot of two
framed panes. They are law for how the plugin looks and how quiet it is, not
a cap on what it can do: a new ability is welcome when it lives in the
person's text, the keys, the command palette or Obsidian's menus, and the
screen at rest shows nothing more. When a principle is in doubt, take
something away.

1. **Subtract until it breaks.** No feature, control, setting, glyph, label
   or line that the screen works without. A feature that only adds commands
   has no switch. When asked to change something, see first whether taking
   it away serves; when something is missing, build it so it adds nothing
   to look at.
2. **An inventory, not a showcase.** A collection is one ruled list, like a
   stock sheet: names in rows, a light rule under each. No grid of cards, no
   images, no counts, no numbers, no decoration that carries nothing.
3. **One job per pane.** The sidebar is the folders as a tree, nothing else.
   A folder's page is its path, then only the notes directly in it; its
   subfolders live in the tree. A note shows its text, and under its title
   its properties as a ledger: ruled rows, name grey, value ink, edited
   where they stand. That is the one place properties are shown; Obsidian's
   own properties block is hidden, and nothing returns the right sidebar.
4. **Labels, like a catalogue's codes.** One monospace face at 13px for
   everything the plugin draws. A label (a pane's name, a folder's, a note's
   in a list, the path, a property's name) is in capitals, a little apart,
   regular weight; never bold, never bigger. The person's own words (a
   note's title and text, a property's value) stay as written. It must read
   as a catalogue site, never as a terminal.
5. **Black, white, one grey.** Following Obsidian's mode: white ground and
   black ink, or the inverse. Grey is what is not here (FEMALE beside MALE):
   the folders not open, the path above. The only other colour is red for an
   error, with its words. Colour in the person's content is theirs.
6. **No lines, no boxes: space.** No frame round a pane, no rule under a
   head, no rule between rows, no box round a word. Panes, heads and rows are
   parted by space alone. Nothing has a border (but a field's line), a
   radius, a shadow or a blur. A folder's page has no head: its path is it.
7. **Say it with characters before glyphs.** A folder that holds more ends in
   a slash ("Politics/"). Where a word or a character will do, no icon. The
   plugin's few glyphs are for tools that have no plain word (a map's fit,
   zoom, fold).
8. **No buttons at rest.** The library's panes show none; the sidebar's head
   holds one underlined word, Settings, since the bare workspace hides
   Obsidian's own. Everything else is
   in the command palette and Obsidian's own menus. Search is a command, not
   a field.
9. **One cue per state.** Hover underlines. Focus is a 2px ink outline. Open
   or picked is black where its list is grey (in the tree and the path), or
   underlined where its list is black. Disabled is grey. No fills.
10. **The panes are the whole window.** With the look on, Obsidian's chrome
    goes: ribbons, the right sidebar, the status bar, the tab strip, view
    headers. The look off puts it all back. Hide, never move or remove
    Obsidian's own nodes.
11. **Fast and still.** No motion, no transitions, no carousels; draw from
    the index, never walk the vault for a screen; one redraw for many
    changes.

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
  `tests/obsidian.js`. `npm test` builds and runs them all; `node tests/run.js
  note` runs some against the last build. `tests/harness.js` gives a suite
  the whole source as one object (`load()`) and a vault to try it in
  (`world()`). A stand-in can't show how Obsidian's own styles and editor
  meet the plugin's.
- `tests/obsidian/*.e2e.mjs` — the plugin in the real, latest Obsidian
  (WebdriverIO; the app is cached in `.obsidian-cache/`): `npm run
  test:obsidian`, or one spec with `-- --spec tests/obsidian/note.e2e.mjs`.
  What draws in the note's text, the editor or Obsidian's own regions gets
  an `it` here.
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
  them, and `tests/test_contract.js` holds every kept id. A command that
  goes is removed, never kept as a stub that does nothing.
- Settings: `core/settings.js` holds every key and its default. A key that
  holds paths is in `PATH_KEYED`, so it follows renames and deletes. An
  older `data.json` is converted once by `core/migrate.js` and saved: every
  old key is read, migrated, or listed there as retired with why, and a
  retired key's value is dropped, never kept unread.
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
  inline style but the geometry a script must set (`--dr-size`, positions
  on a map, an editor line's hang), no `innerHTML`.
- Obsidian's own styles outweigh a plain `dr-` class: `.markdown-source-view
  .mod-cm6 .cm-line` zeroes every editor line's padding, and Obsidian puts
  an inline style on indented lines. Before styling an element Obsidian
  draws, read what it sets: `app.css` is in
  `~/Library/Application Support/obsidian/obsidian-<version>.asar`. An
  editor line's style is beaten only by a line decoration's, which comes
  after it.
- JS never moves, clones or removes Obsidian's own DOM nodes: its interface
  holds them and the plugin could not put them back. A note's rendered text,
  handed to a post-processor, is not that: it is drawn from the note, changed
  by plugins and drawn again, so a post-processor may rebuild it.

## Working here

- The smallest complete change. Report changed files and tests run, briefly.
- Bring a better idea when you see one: say it in a line; build it when it
  is small and keeps the principles; ask first when it is big.
- Test in rising order: the suites the change touches while working, `npm
  test` once at the end, `npm run screenshots` when the look changed, the
  Obsidian specs when it meets Obsidian's DOM, styles or editor. Never use
  the author's vault or Obsidian settings to try something.
- Commit locally; push only when the author asks, after a fetch and rebase.
  A push to main releases: CI runs every test, in the real app too, and
  publishes the next patch. After a push, `node tools/ci.mjs --wait` waits
  quietly for its run and prints the result in a few lines: each failing
  test with its error, and the release. A test in Obsidian is tried twice;
  one named flaky passed only the second time, and wants fixing. Don't poll
  Actions or read logs;
  only when the summary isn't enough, read that file on the `ci-results`
  branch (`git show origin/ci-results:obsidian-tests.txt`).
- Keep usage down: grep before reading, read the lines needed, long output
  through `tail`. A long task keeps `.claude-cache/checkpoint.md` current.
- Replies to the author: short, plain.
