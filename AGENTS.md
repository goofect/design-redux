# Design Redux

An Obsidian plugin (desktop only): the vault as a library of folders and
notes, a note's head and pages, a properties panel, mind maps and property
tools, in one look of its own.

## Files

- `src/<area>/name.js`: the source, ES modules. Areas and layers:
  `core`, then `ui`, then `library`, `note`, `maps`, `tools`, then `plugin`.
  A module imports only from its own area and those below, is at most 400
  lines, exports no name another module exports, and is reached from
  `src/main.js`. `build.mjs` refuses anything else.
- `styles/NN-name.css`: the styles, joined in name order into `styles.css`
  by the build. `00-tokens.css` holds the colors and sizes,
  `01-obsidian-map.css` maps them onto Obsidian's variables.
- `assets/icons/`: the plugin's glyphs (SVG), bundled as `dr:icons`.
- `main.js`, `styles.css`: built, never edited. `npm run build`.
- `manifest.json`, `versions.json`: never edit versions by hand. CI releases
  after the tests pass on main; a commit whose message ends with a
  `Release-As: X.Y.Z` line releases that version (only when the owner asks).
- `docs/DESIGN.md`, `docs/design-language.md`: the look. Read before changing
  any style. `docs/specimen.html` (built by `tools/specimen.mjs`) shows every
  part.
- `tests/test_*.js`: simulation suites (jsdom, real CodeMirror, Obsidian
  stood in for). `tests/obsidian/`: tests in the real app.

## How the code is laid out

- A feature is a `Feature` (`core/feature.js`) with `register()` once and
  `enable()` / `disable()` safe to repeat; `disable()` removes all it added.
- Commands and menu entries come from a feature's actions
  (`core/actions.js`). Keep command ids: hotkeys hang on them.
- Settings: `core/settings.js` holds every key and its default; old keys are
  converted by `core/migrate.js`. Never drop a key without its migration.
- A note's properties are read and written through `core/notes.js`, files
  made and moved through `core/files.js`, the vault read through
  `core/index.js`, never by walking it.
- Shared pieces (row, table, field, sheet, segments, buttons) are in `ui/`;
  screens use them instead of drawing their own.

## Rules

- No regex lookbehind. Hover styles only inside `@media (any-hover: hover)`.
- No `scope` field on a `Modal` subclass.
- Settings code uses the settings tab's own document, never `document`.
- Menu entries need a section (`setSection`).
- Obsidian's unofficial internals only behind `typeof` checks, with a fallback.
- Styles: no `!important`, no hex outside `00-tokens.css`, no radius, shadow,
  blur or motion (`tests/test_design.js` checks).

## Working here (keep usage down: the owner pays for it)

- Smallest complete change; no rewriting files or touching unrelated code.
- Find before reading: file names, then grep, then the lines needed. Never
  read a large file whole.
- Tests: the suite you touched (`node tests/run.js note`), the full suite
  (`npm test`) once before pushing. Real-Obsidian tests only when nothing
  else can show it.
- Long output through `tail` or `grep`.
- Fetch and rebase before pushing: CI commits releases to main.
- Replies: short and plain.
