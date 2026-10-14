# Design Redux: architecture audit and refactor roadmap

The refactor is done (M0–M6 and M8; M7, ES modules, was weighed and left out). The first
section says how the code stands now. §1–§3 are the milestone-0 audit as it was taken
(2026-10-11: 88 pieces, 36,627 lines), kept as the record. The rest is the roadmap and what
each milestone did.

## 0. Where it stands

```text
esbuild bundles src/main.js → main.js; 103 ES modules in a folder per area (2.0, phase 1)

 src/core/     constants; helpers (art, colours 031, properties 045, text 047,      19 modules  4,622 lines
               sorting, DOM); services: Pins, Orders, Notes 073, Files 074,
               Selection 076; actions 078; Feature and mixInto 080; appearance
 src/ui/       pickers, covers, cover drop, image routing, property clipboard        5 modules  1,286
 src/library/  sidebar, browse view 120 (+121–124), screens, filters; and the       18 modules  8,750
               album features, knowledge, library and knowledge checks
 src/chrome/   actions menu, properties panel, strip, Up Next, menus, modes         10 modules  2,994
 src/links/    graph filter and routes, quiet links 263–266                          6 modules  2,736
 src/editor/   marked lists, scripts, footnotes                                      3 modules  2,389
 src/bulk/     engine, dialogs 300–304, feature                                      7 modules  4,118
 src/canvas/   tree (the model, saveCanvas), folds, layouts, arrows, outline, …     33 modules 10,747
 src/plugin/   the plugin (lifecycle, settings, features, delegates), settings      2 modules  1,076
```

- **The rules, checked on every `npm test`:**
  - **Layers:** a piece uses its own area and those below. 20 known crossings remain, and
    the list in `tests/snapshots/layers.json` only shrinks. From 88 at M0.
  - **Lifecycle:** no leftovers after switching off or unloading, and no command id or
    setting key lost.
  - **Note text:** what the plugin writes into notes, byte for byte.
- **One way to do each common thing:**
  - read or write a note's properties: `noteProps`, `plugin.notes`;
  - move a file or undo a move: `plugin.files`;
  - make an element act as a button: `asButton`;
  - follow a change made by hand on a canvas: `afterCanvasChange`, `glideAndSettle`,
    `saveCanvas`.
- **Features tell each other through workspace events** where they can. Elsewhere they ask
  through `plugin.feature(X)`; those are the crossings left.
- **Pairs of pieces that use each other:** 11, down from 21.
- **The largest pieces now:** `290-bulk-engine` (1,605 lines), `120-browse-view` (1,173),
  `110-browse-screens` (1,045), `285-footnotes` (994), `301-bulk-properties` (969),
  `262-graph-routes` (964).

## 1. The architecture at M0

```text
build.mjs joins src/NNN-*.js in name order → main.js (one shared scope)

 010–089  core          imports, constants, helpers, Feature base, appearance     12 pieces   3,478 lines
 090–139  library       sidebar library, browse view and screens, filters          7 pieces   4,977
 140–229  chrome        actions menu, properties panel, strip, Up Next, menus     11 pieces   2,976
 230–253  shared UI     pickers, covers, property clipboard, action registry       6 pieces   1,360
 254–261  albums        knowledge, album property/refactor/structure, smart,       7 pieces   3,148
                        library check, knowledge check
 260–269  links         graph filter, graph routes, quiet links                    3 pieces   2,754
 270–289  editor        marked lists, scripts, footnotes                           3 pieces   2,393
 290–314  bulk          engine, dialogs, feature                                   3 pieces   4,121
 315–347  canvas        tree/adapter, folds, layouts, arrows, outline, …          33 pieces  10,357
 348–999  composition   workspace modes, plugin (onload), settings tab, export     3 pieces   1,151
```

What holds it together:

- **`Feature`** (`080`): `register()` once at layout-ready, `enable()`/`disable()` on every
  settings save (`plugin.refresh()`), `sync()` on layout and active-leaf changes (batched to
  one per frame), and `settingKey` for the on/off toggle. There are 56 feature classes, all of
  them built in `350-plugin.js`.
- **Actions** (`078`, moved from `253` in M2): each feature writes what it does once, as actions. Its commands
  (registered once, hidden by `check`) and every menu of that kind of thing are built from that
  list. Command ids are stable.
- **Settings**: `DEFAULTS` holds every setting, `SETTINGS_TABS` places them in the settings
  tab, `PATH_KEYED` settings follow renames, and there are versioned `SETTINGS_MIGRATIONS`,
  backed up first (`350-plugin.js` `loadSettings`).
- **Undo**: there are two separate mechanisms (see issue 5).
- **Tests**:
  - 18 simulation suites (jsdom plus real CodeMirror, about 10 s), which load the built
    `main.js` and export names from it.
  - 38 real-Obsidian tests, run on the oldest supported Obsidian and the latest.

This works well and stays:

- The `Feature` lifecycle and the action registry. These are the right abstractions, used
  consistently.
- Settings defaults, migrations and path keys.
- Guarding Obsidian internals behind `typeof` checks with a fallback.
- The design tokens in `styles.css`.
- A zero-dependency runtime and a 50-line build.

## 2. Dependency analysis

Names used by one area from another, counting each name once:

| From → to | Names | Notes |
|---|---|---|
| library → core | 52 | expected |
| chrome → core | 36 | expected |
| composition → canvas | 30 | expected: the plugin builds the features |
| shared UI → core, bulk → core, albums → core, canvas → core | 22 / 17 / 13 / 13 | expected |
| albums → canvas | 13 | **questionable**: the knowledge model draws on canvas internals |
| albums → library | 6 | BrowseView, BROWSE_SCREENS, Library… |
| **core → albums** | 5 | **upward**: AlbumStructure, ALBUM_TYPES, ALBUM_KIND_NEUTRAL, Knowledge, AlbumRefactor |
| **core → library / chrome / canvas** | 1 each | **upward**: BrowseView, UpNext, CANVAS_SPACE |
| shared UI, links, chrome, albums → canvas | 1–3 each | ComparePicker and plainMarkdownLine sit in canvas pieces but are used everywhere |

The pieces everything leans on:

| Piece | Used by | Lines | Note |
|---|---|---|---|
| `030-helpers-art` | 45 pieces | 949 | a grab-bag: pure helpers next to album-aware ones |
| `080-feature` | 34 | 72 | expected |
| `316-canvas-tree` | 28 | 590 | the de facto canvas adapter |
| `040-helpers-sorting` | 24 | 381 | expected |
| `315-canvas-feature` | 24 | 131 | expected |

The largest pieces:

| Piece | Lines | Uses / used by |
|---|---|---|
| `120-browse-view` | 2,723 | 15 / 11 |
| `300-bulk-dialogs` | 2,210 | 8 / 1 |
| `290-bulk-engine` | 1,660 | 6 / 6 |
| `265-quiet-links` | 1,317 | 5 / 4 |
| `110-browse-screens` | 1,060 | 6 / 6 |
| `285-footnotes` | 998 | 6 / 2 |

`350-plugin` uses 67 pieces. That's expected for the place that builds everything, but it also
carries behaviour (see issue 7).

There are 21 pairs of pieces that use each other. The ones that matter:

- **`030-helpers-art` with 032, 120, 254, 256 and 257.** Core helpers call into album code.
- **`120-browse-view` with 130, 190, 195, 257, 258 and 290.** The browse view is a hub.
- **Inside the library:** 090↔130 and 100↔130/258.
- **190↔195 and 190↔348.**
- **254↔261:** knowledge and its check.
- **Canvas internals:** 316↔335, 317↔335 and 315↔321.

A shared scope allows these pairs, as long as the call happens inside a function. They are what
makes "change one thing without reading the whole plugin" hard.

## 3. Issues found

**Confirmed** means it's shown by the code. **Risk** means it's possible and should be checked
before the code concerned is touched.

1. **Confirmed: shared helpers live in the wrong area.** Each is declared inside a feature but
   used across areas:

   | Name | Declared in | Used by |
   |---|---|---|
   | `ComparePicker` | `331-canvas-compare` | 8 pieces: albums, links, shared UI, chrome |
   | `valueList` | `257-album-structure` | the clipboard and bulk |
   | `confirmAction` | `265-quiet-links` | albums and the plugin |
   | `knownPropertyNames`, `propertyValues` | `260-graph-filter` | library, chrome and bulk |
   | `plainMarkdownLine` | a canvas piece | the panel |

   Reading any of these means opening an unrelated feature.
2. **Confirmed: `030-helpers-art` mixes layers.** It has five mutual pairs with album and
   browse pieces, which makes the most depended-on piece also one of the most coupled.
3. **Confirmed: exact duplicates.** Each pair has the same function body, normalised:
   - `pageFile`: `190-strip` and `195-up-next`;
   - `rerender`/`rerenderReading`: `270-lists` and `280-scripts`;
   - `cardOf`: `323-canvas-restructure` and `334-canvas-mindmap`;
   - `reorder`/`spread`: `323` and `325-canvas-layouts`, twice.
4. **Confirmed: a note's properties are read and written in many ways.**
   - **Reads:** four "properties of a note" methods (`PropertyClipboard.propertiesOf`,
     `AlbumProperty.frontmatter`, `AlbumRefactor.frontmatter`, `BulkEdits.frontmatterOf`),
     plus 30 inline `getFileCache(f).frontmatter || {}` reads in 15 pieces.
   - **Writes:** `processFrontMatter` is called in 10 pieces, each with its own error notice and
     its own undo.
5. **Confirmed (two mechanisms) and risk (restoring blindly): undo.**
   - **Bulk edits** keep a record and restore a file only if it is still exactly what they
     wrote, so they detect conflicts.
   - **`plugin.offerUndo(message, fn)`** runs whatever closure it is given. It is used in 14
     places in albums and others, including the new property paste. These closures put old
     values back even if the note has been edited since the change.
6. **Risk: lifecycle leftovers aren't tested as a whole.**
   - `enable()` must be safe to repeat, and `disable()` must undo everything (body classes, DOM
     moved into Obsidian's own elements, observers, patches).
   - No simulation suite runs every feature through register → enable twice → disable and
     checks that nothing is left.
   - The only check is a real-Obsidian disable and re-enable at the start of the suite, and it
     checks for errors, not leftovers.
   - Global listeners on `document`/`window` look paired (120: 8 added, 10 removed; 160: 4 and
     4), but that should be proven.
7. **Confirmed: the plugin class does feature work.**
   - `350-plugin.js` holds file moves (`moveFile`, `putBack`), `offerUndo`, folder-note
     renames, `setNoteCover` and `pruneLeftovers` alongside building the features.
   - These belong with `Orders`, `Pins` and `Queue`, as small services the features share.
8. **Confirmed: canvas internals are touched in 19 of 33 canvas pieces**, through
   `view.canvas.nodes/edges/requestSave/selection/data…`.
   - `316-canvas-tree` (`canvasModel`, used by 20) is the adapter in practice, but not the
     only door.
   - The 128 `typeof … === 'function'` guards in canvas are the symptom: each piece guards its
     own access.
9. **Risk: there are two hubs.**
   - `120-browse-view` (2,723 lines, six mutual pairs) is where navigation, rendering, filters
     and album rules meet.
   - `300-bulk-dialogs` (2,210 lines) holds eleven dialogs; their shared parts (`BulkModal`)
     are reused well, but the dialogs aren't split.
10. **Risk: popout windows.** Several features set classes on `document.body` (41 uses of
    `document.` in chrome alone), which only reaches the main window. That's fine today, but it
    is a hidden assumption.

## 4. Target architecture

The same five responsibilities the plan names, but kept inside today's build. The number range
is the layer:

```text
 core (010–089)         constants, pure helpers, Feature, services: Notes (read/write
                        properties, with undo), Files (move/put back), Orders, Pins, Queue
 shared UI (230–253)    pickers (ComparePicker included), checklists, summaries
 domain features        library · chrome · albums · links · editor · bulk · canvas
   each one: pure planning (testable without Obsidian) → one service call that writes
 adapters               canvas (316 + 315 the only door to view.canvas), CodeMirror bits
 composition (348–999)  plugin: builds the features and wires events; nothing else
```

The rules, to be checked by a script (warnings at first):

- A piece may use names from its own area, from lower areas, and from shared UI.
- Upward use needs an entry on an allowlist with a reason.
- Only `315`/`316` read `view.canvas` internals.

**Build:** keep concatenation for now.
- **Against moving to ES modules now:**
  - It touches all 88 pieces, and the test harness that exports names from `main.js`.
  - It gives no runtime benefit: Obsidian loads one file either way.
  - It isn't needed to see dependencies: `map.js` already computes each piece's exports and
    imports.
- **When to move:** once the layer rules hold. The migration is then mechanical: generate
  `import`/`export` lines from the index, and bundle with esbuild, keeping `obsidian` and
  `@codemirror/*` external.
- **What it would buy:** isolated unit tests and editor navigation. If those don't matter by
  then, skip it.

## 5. Migration plan, file by file

| Milestone | Pieces | Change | Behaviour |
|---|---|---|---|
| M1 | `tests/` | lifecycle test for every feature; data-preservation fixtures; `map.js --areas` (area matrix, mutual pairs, layer warnings) | none |
| M2 | 331 → 230 | move `ComparePicker` to the pickers | none |
| M2 | 257, 260, 265, canvas → 030/040/230 | move `valueList`, `knownPropertyNames`, `propertyValues`, `confirmAction`, `plainMarkdownLine` down | none |
| M2 | 190/195, 270/280, 323/334, 323/325 | one copy of each duplicate | none |
| M2 | 030 | split pure helpers from album-aware ones (the latter go to 257); break 030's mutual pairs | none |
| M3 | new `Notes` service (core) | `props(file)`, `write(file, change, message)` with undo that restores only what's unchanged since | undo no longer overwrites later edits |
| M3 | 160, 235, 250, 254, 255, 256, 257, 345 | use `Notes` for reads and writes | same results |
| M3 | 290 | the bulk engine keeps its records and shares the conflict rule | none |
| M3 | 265 | split into parsing (pure), cache integration, editor, reading view, commands: 263–267 | none |
| M4 | 350 → new `Files` service | `moveFile`, `putBack`, `offerUndo`, folder-note renames | none |
| M4 | 120 | split navigation, rendering and filtering; album membership queries into 257 | none |
| M4 | 300 | one piece per dialog family (properties, tags/values, types/missing, the list tool) | none |
| M5 | 300, 250, 259, 261 | shared summary/checklist/note-link builders; CSS sections follow pieces; unused selectors removed after a scan | none |
| M6 | 317–347 | canvas internals only through 315/316; layout maths separate from applying it; one glide-and-save step for the 8 copies in 323, 325, 326, 334, 338, 341; knowledge's canvas mapping (254 → 316/321/326/332/334) into the canvas area; benchmarks | none |
| M7 | build | ES modules: optional, see §4 | none |
| M8 | all | remove what's unused, update AGENTS.md and the `.claude/rules/` notes | none |

## 6. Milestones

Each milestone is one or a few commits to main. Every push that passes CI is released, so each
commit must keep behaviour (the one intended change is in M3) and can be reverted on its own.

| | Scope | Risk | Done when |
|---|---|---|---|
| M0 | this audit | low | this file |
| M1 | safety net — **done** | low | lifecycle test green for all 56 features; `--areas` prints today's matrix |
| M2 | helpers in the right place, duplicates gone — **done** | low | no shared helper declared in a feature piece; nothing in core reaches up; 030 has no mutual pairs |
| M3 | note and property operations; quiet links split — **done** | high | one read path and one write path for properties; undo doesn't overwrite later edits |
| M4 | library, albums, the plugin class — **done** | high | 120 under ~1,200 lines; 350 only composes |
| M5 | UI parts and CSS — **done** | medium | dialogs build from shared parts |
| M6 | canvas — **done** (target revised, §16) | very high | 2 pieces touch `view.canvas`; benchmarks within 10% of the baseline |
| M7 | build (optional) | high | only if §4's conditions hold |
| M8 | cleanup — **done** | medium | docs match the code |

## 7. Tests and validation

- **Every commit:** `npm test`, all 18 suites. Changed pieces must keep their suites. A moved
  name must stay exported to the suites that import it, since tests read names from `main.js`.
- **After each push:** CI runs every test on the oldest and latest Obsidian (`tests/ci.sh`).
- **New in M1:**
  - **Lifecycle:** build the plugin in jsdom, run register, refresh twice, then unload. Assert
    no `dr-` body classes, no `[class*="dr-"]` elements outside views, and no live
    observers or timers left.
  - **Data preservation:** fixtures with complex YAML, aliases, wikilinks, quiet links, Unicode
    and duplicate names, run through every write path. Assert unrelated bytes are unchanged.
  - **Architecture:** `map.js --areas --check` warns about upward use that isn't allowlisted.
    It becomes a failure once M2 is done.
- **Before M3/M6:** add a test for any behaviour about to move that has none. The pieces with no
  suite naming them are 032, 090, 150, 230, 240, 318, 337 and 339.

## 8. Performance baseline

- **Already recorded:** each real-Obsidian test's time (`ci-output/<version>-timings.txt`).
- **Added in M1:** plugin load time and one library redraw, as `perf:` lines at the top of
  the same file.
- **To add with the milestones that touch them:** library redraws with 50 and 500 albums (M4);
  canvas fold, unfold and tidy on 20, 100 and 500 cards (M6). They are compared by eye at
  first, and later flagged at more than 10% slower.

## 9. Risks

| Risk | Where | Guard |
|---|---|---|
| A moved name breaks load order (a class before its base, a top-level use before its declaration) | M2–M4 | the build refuses parse errors and duplicates; move names earlier, never later |
| A suite imports a name that moved or was renamed | M2–M4 | names stay the same; suites run on every commit |
| Undo changes behaviour | M3 | deliberate, tested: restore only what's unchanged, say what was skipped |
| A frontmatter write changes formatting | M3 | data-preservation fixtures |
| Canvas internals differ between Obsidian versions | M6 | both versions in CI; the adapter keeps the guards |
| A refactor ships a release with a regression | all | small commits, CI on both versions before release, revertable |
| Command ids or setting keys change | all | never renamed; the lifecycle test lists command ids against a snapshot |
| The refactor grows features | all | new ideas go in a list, not in refactor commits |

## 10. M1, done

- `tests/test_lifecycle.js` builds the whole plugin in a stand-in for Obsidian's window: load,
  enable twice, every switch off and on, unload. It checks nothing is doubled or left behind:
  classes, elements, listeners, observers, intervals, frames, handlers, patched methods. It also
  checks that no command id (161) or setting key (127) is lost; new ones are recorded with
  `node tests/test_lifecycle.js --update`.
  - It found one leftover, now fixed: footnotes left `dr-footnotes-aside` on the body after
    unload.
- `tests/test_preserve.js` covers what the plugin writes into notes, byte for byte: quiet-link
  renames, sharing and back, and tag renames, on an awkward note.
  - It found that renaming a note rewrote quiet links inside code, maths and comments. Now fixed.
- `node tests/map.js --areas` prints the area report. `--check`, run as `tests/test_layers.js`,
  fails on a new use across the layers, or on a listed one that's gone. 88 are known today,
  listed in `tests/snapshots/layers.json`; the list only shrinks.
- The real-Obsidian suite records plugin load and library redraw times.

**Next, M2:** move the misplaced shared helpers, merge the duplicates, and split
`030-helpers-art`. Each step shortens `layers.json`.

## 12. M2, done

Behaviour is unchanged, and every suite passed at every step. The crossings went from 88 to
52, and the pairs of pieces that use each other from 21 to 14.

- **New core pieces:**
  - `045-helpers-properties`: plainValue, fmGet, propertyCounter, valueList,
    knownPropertyNames, propertyValues.
  - `047-helpers-text`: bulkCount, plainMarkdownLine, noteNameFrom.
  - `031-colours`: normalHex, hexToRgb, hexToHsl.
- **Moved down:**
  - ComparePicker and confirmAction to `230-pickers`.
  - The shared constants (album kinds, graph types, tag keys, canvas spacing) to
    `020-constants`.
  - scriptLivePreview and one rerenderReading (three copies before) to `050-helpers-dom`.
- **The action registry** moved into core, from `253-actions` to `078-actions`, beside
  `Feature`, which builds its commands from it. The browse view adds its own `browse` context.
- **Core no longer reaches up:**
  - The queue tells its listeners of changes, and Up Next listens.
  - Core helpers recognise the browse view by its type (`isBrowseView`).
  - The album features' menu entries and kind info come through the plugin
    (`addAlbumMenuItems`, `albumInfo`).
- **Duplicates merged:** `pageFile(app)` and `soleCard(selected)`. The canvas glide-and-save
  block (8 copies) moves to M6, since it's canvas saving.

The 52 crossings left, by kind, and the milestone that takes each kind:
- **Features asking for each other with `plugin.feature(X)`:** Library, BrowseView,
  AlbumStructure, SmartAlbums, BulkEditing, ContextStrip, UpNext, QuietLinks, Footnotes,
  CanvasOutline and others. Taken in M4, where the library and the plugin class are split, and
  in M6 for the canvas ones.
- **Albums adding screens to the browse view:** `BROWSE_SCREENS`, `BrowseScreen`. These are
  by design: library is the host, and the albums area adds to it. M4 decides whether albums
  sits above library.
- **Knowledge mapping notes onto canvases** (11 canvas names): M6.
- **Album property using the bulk engine's notices** (`bulkNotice`, `bulkTail`): M3, when bulk
  and notes share one undo.

## 13. M3, done

- **`073-notes`** is now the one read path and the one write path for properties.
  - `noteProps(app, file)` and `plugin.notes.props/get` read a note's properties as Obsidian
    has them, without its `position` key. 19 hand-written reads now use it; only reads that
    need the cache for tags or links too keep the cache.
  - `plugin.notes.write(file, change, opts)` writes through `processFrontMatter`, shows the
    error notice in one place, and returns what changed, key by key.
  - `plugin.notes.undo(records)` puts back only what's still as the change left it. What was
    edited since is kept, and a notice says how many were kept. A key that's put back returns
    to its old place.
- **Moved onto it:**
  - the property clipboard;
  - the properties panel, whose own put-back is gone;
  - knowledge relationships, whose own restore is gone;
  - carrying album values over to new names;
  - an album's properties, and the merge undo;
  - covers, set and cleared;
  - folder defaults.
- **This is the one behaviour change in M3, and it was deliberate.** Undo no longer overwrites
  later edits for the clipboard, knowledge, album carry-over and album merges. Before, those
  put old values back blindly.
- **Still outside it:**
  - The bulk engine keeps its own records. They are text-level, and restore a file only if it
    is still exactly what bulk wrote, which is stricter. It now shares `sameValue` with
    notes.
  - `345-canvas-outline-sync` keeps its own stamp write. It is canvas code, so it waits for
    M6.
- **Quiet links** are in four pieces: `263-quiet-text` (pure), `264-quiet-cache`,
  `265-quiet-links` (the feature) and `266-quiet-editor`. The class itself is unsplit, since
  pieces can't share a class.
- **Tests:** the notes tests are in `test_bulk`, on its real-YAML vault. The suites' stand-in
  plugins now carry a real `Notes`.

**Next, M4:** the library and albums.
- Move file operations (`moveFile`, `putBack`, `offerUndo`, folder-note renames) out of the
  plugin class into a `Files` service.
- Split `120-browse-view`.
- Decide where albums sit relative to the library.
- Take on the `plugin.feature(X)` lookups between features.

## 14. M4, done

Behaviour is unchanged, and every suite passed at each step. The crossings went from 52 to 29,
and the pairs of pieces that use each other from 14 to 12.

- **`074-files`:** making notes, canvases and folders under a free name, moving files and
  putting them back, and finding, making and renaming folder notes. It lives in
  `plugin.files`. The plugin keeps one-line delegates, so features and tests ask it as before.
- **The browse view is in four pieces:**
  - `120-browse-view`: the class, navigation, screens and headers (1,188 lines, down from
    2,723).
  - `121-browse-sorting`.
  - `122-browse-editing`, which includes pins in your own order.
  - `123-browse-rows`: the list, shelves and cards.
  - These are methods of `BrowseView`, put on it by `mixInto` (in `080`). It refuses a name
    written twice. The methods that call `super` stay in the class.
- **The bulk dialogs are in pieces by family:** `300` keeps `BulkModal` and the "where"
  conditions; then `301` properties, `302` tags and values, `303` types and missing values,
  and `304` the property list and the tools window.
- **Albums and the library are one area** in `map.js` (090–139 and 254–259), as
  `.claude/rules/albums.md` already says. Album features draw inside the browse view and add
  its screens, so it's one subsystem. Splitting it would mean a delegate for every album panel,
  for no gain.
- **Bulk renames are announced** (`design-redux:renamed`, `design-redux:property-renamed`)
  rather than handed to three features. The library moves open screens on
  (`BrowseView.followRenamed`), and the graph filter follows. `tagUnder` and `renameTagText`
  moved to `047`.
- **Not done, and moved to M8:**
  - **The plugin class still holds behaviour beyond composing:** covers (`folderCoverSrc`,
    setting and clearing them), `newFolder`, `togglePin` and `pruneLeftovers`.
  - **The library benchmarks with 50 and 500 albums.** M4 only moved code, so there's no
    redraw change to measure.

The 29 crossings left:
- **Features asking each other for a capability through `plugin.feature(X)`:**
  - the strip with Library, Knowledge, AlbumStructure and Footnotes;
  - the panel with AlbumProperty, BulkEditing and QuietLinks;
  - the browse view with ContextStrip, UpNext and BulkEditing;
  - workspace modes and one-page;
  - album property with the bulk notices;
  - album structure with the canvas vault map.
- **Knowledge mapping notes onto canvases:** 11 names, for M6.

## 15. M5, done

Behaviour and markup are unchanged, and every suite passed at each step.

- **`asButton(el, label)`** (in `040`, beside `onActivate`) replaces the hand-written role, tab
  stop and label in 81 places. It sets them in the same order, so redraw comparisons see the
  same markup.
- **`reportRow`** builds the rows of both the library check and the knowledge check. The
  knowledge check used to build its rows line for line the same way, then add its own fix
  button.
- **The summary and note-link builders** were already shared in M3 (`BulkModal.showSummary`,
  `noteList`), and the property paste preview builds on the same patterns.
- **The checkbox rows stay as they are.** Property rows with icons and counts, note pick lists
  and single options differ by design, each with its own markup and styles. Merging them would
  change both for no gain.
- **CSS:**
  - A scan of all 512 `dr-` classes against the source found one rule nothing sets
    (`.dr-quiet-hidden`, left from before quiet links were kept out of Obsidian's cache), and
    it is gone. The two Style Settings toggles (`dr-flat-covers`, `dr-strip-flat`) are set by
    that plugin.
  - The map at the top of `styles.css` now names the pieces each part dresses.
  - Rules stay in their order. Moving them could change which of two equally specific rules
    wins, for no gain in behaviour.

**Next, M6:** the canvas.
- Internals reached only through `315`/`316`.
- One glide-and-save step for its 8 copies.
- Knowledge's canvas mapping moved into the canvas area.
- Benchmarks.

## 16. M6, done

Behaviour is unchanged, and every suite passed at each step. The crossings went from 29 to
20, and the pairs of pieces that use each other from 12 to 11.

- **`afterCanvasChange` and `glideAndSettle`** (in `335`, beside the fold pass) do what
  followed every change made by hand: save if anything changed, tell the fold pass, tell those
  watching. That was written out in restructure, layouts (twice), arrange, the mind map and
  tidy. Arrange still doesn't announce, and the mind map still always saves, as before.
- **`saveCanvas(canvas)`** (in `316`) replaces eight copies of the guarded save: four
  `save(view)` methods alike in cards, arrows, fold and relations, and four try-blocks. Saves
  inside larger steps (after `importData`) stay where they are.
- **Relations:** the kinds and the keys an arrow carries (`RELATION_KEY`, `RELATED_KEY`,
  `DEFAULT_RELATION_TYPES`) are shared data in `020`. `relationTypes(settings)` gives the kinds
  as set, for the canvas and for knowledge alike.
- **Knowledge's canvas side** moved to `326-canvas-relations` as `KnowledgeCanvas`, put on
  `Knowledge` by `mixInto`. It finds a note's card, writes arrows into notes, draws
  relationships as arrows and makes a map beside a note. Knowledge (library area) no longer
  reaches into canvas pieces; one use the other way, `Knowledge` itself, replaces 11.
- **Benchmarks:** the real-Obsidian suite times fold-all, unfold-all and tidy on trees of
  20, 100 and 500 cards. It turns motion off, so it times the work, not the glide. The
  `perf:` lines go into `ci-output/<version>-timings.txt`. The first run, on the latest
  Obsidian locally:

  | Cards | Fold all | Unfold all | Tidy |
  |---|---|---|---|
  | 20 | 9 ms | 5 ms | 7 ms |
  | 100 | 31 ms | 12 ms | 25 ms |
  | 500 | 79 ms | 21 ms | 15 ms |

- **Target revised.** "Only 315/316 touch `view.canvas`" isn't worth it. The reads that
  remain (`canvas.nodes` 41 times, `readonly` 18, `edges` 18) are plain property reads, already
  guarded. Reading the canvas goes through `canvasModel`. Wrapping each read would churn 19
  pieces and make nothing safer. The calls with side effects (saving, gliding, what follows a
  change) are now each in one place, which was the point.
- **Next:** M7 (ES modules) stays optional, per §4. M8 is cleanup:
  - the plugin class's leftover behaviour (covers, new folder, pins, leftovers);
  - the library benchmarks;
  - docs and `AGENTS.md` brought up to date.

## 17. M8, done

- **The plugin class** now wires the features and coordinates them: lifecycle, settings, the
  feature registry, delegates, pins, new folder, and clearing leftovers.
  - Covers (a folder's artwork; setting, clearing and colouring them) moved to `CoverImages`
    (235).
  - `propertyLabel(app, key)` moved to `045`.
  - The plugin keeps one-line delegates, so callers and test stand-ins are as they were.
- **Unused code:** a scan of every top-level name found three nothing used, and they're
  gone: `renameQuietLinks` (tests use `renameQuietLinksIn`), `outlineCards` and
  `DEFAULT_RELATIONS`. In M5, one unused CSS rule went the same way.
- **Library benchmarks:** the real-Obsidian suite times a shelf of 50 and of 500 albums, and
  the sidebar beside them. The first run, locally on the latest Obsidian:

  | Albums | Shelf drawn | Sidebar |
  |---|---|---|
  | 50 | 22 ms | 18 ms |
  | 500 | 135 ms | 100 ms |

  The sidebar's 100 ms at 500 albums is worth watching, since it redraws as the vault
  changes. It's for a later look, not this refactor.
- **Docs:** `AGENTS.md` now states the layers, the services, `mixInto`, the events, the
  canvas helpers and `asButton`. The rules notes for albums, the canvas and quiet links say
  what moved. §0 above gives the current state.

## 18. 2.0, phase 1: ES modules, done

- **What changed:** each piece became a module in its area's folder,
  `src/<area>/NNN-name.js`, importing what it uses and exporting what it
  declares. `src/main.js` imports them all and exports the plugin; esbuild
  bundles it into the one `main.js` (CommonJS, `obsidian` and `@codemirror/*`
  left to Obsidian, nothing shaken out, the plugin class itself as
  `module.exports`, as in 1.x). `010-imports` and `999-export` went.
- **How:** the import and export lines were generated from what
  `tests/map.js` already knew each piece declares and uses. A second,
  independent scope analysis agreed on every piece.
- **Load order:** ES modules run their imports first, so the old number
  order no longer decides it. Of the 13 pairs of modules that use each other,
  one needs the other as it loads: `SmartScreen extends BrowseScreen` (258 on
  110), while 110 only reaches for `SmartAlbums` when drawing. A cycle runs
  from the module imported first, so `src/main.js` imports 258 before the
  rest. `tests/map.js` now records which names a module needs as it loads.
- **What the build refuses, besides a name declared twice:** a name used
  without importing it, or imported from the wrong module; a module that needs
  a name as it loads from one that runs after it; an import across the layers
  not on the known list (`tests/map.js --verify`); and a `main.js` that fails
  as it loads, run with Obsidian stood in for.
- **Tests:** unchanged in what they check. They still load the bundle, whose
  top-level names are the modules' own (the build refuses a name declared
  twice, so esbuild never renames one). A few changes: the Obsidian stand-ins
  now keep the classes they make (the bundle reads `obsidian.X` at each use,
  not once), the canvas suite takes `TFolder` from its stand-in, and the
  settings-rows check reads `src/` rather than esbuild's reprint.
- **Gate:** the 21 suites, the layer check and the real-Obsidian run (41
  tests, latest version locally; both in CI) pass with no change in behaviour.
- **Next:** suites that load only the modules they test, through a small
  esbuild step, in place of the whole bundle.

## 19. 2.0, phase 2: foundations

- **The library index** (`core/077`, `libraryIndex(plugin)`): every file, the
  notes, the folders and their folder notes, what each folder holds, and the
  links each way, worked out once and kept while files and links stay as they
  are. The browse view, Home, smart albums, knowledge, the sidebar and the
  canvas's links read it rather than walking the vault. Shelves and the
  sidebar draw as fast as before (within noise).
- **Design tokens:** durations, easings, glass blur, the interface font and
  the cover radius are `--dr-*` variables, used in place of the numbers.
- **The canvas adapter** (`core/079`): the one place that reads Obsidian's
  canvas internals — the cards and arrows, what's picked, a card's data,
  box, element and what the plugin keeps on it, an arrow's ends and data,
  making cards and arrows, typing in a card, saving, the view — each behind
  a check with a fallback. Every canvas feature goes through it.
  `node tests/map.js --internals` counts the direct uses left in each module
  (262 lines in 31 to start, 35 in 5 now), and `tests/test_layers.js`
  refuses a module that gains any. What's left is meant to be: the folds',
  the arrow styles' and the view history's patches of Obsidian's own
  methods, and the diagnostics, which check those internals are there.

## 20. 2.0, phase 3: the map engine

- **Live mind maps** (`canvas/348`, opt-in per canvas: "Make this canvas a
  mind map"). Positions come from the tree: each card's spot is worked out
  by its tree's layout (the same layouts as "Lay out branch", now
  `layoutPlaces` in 325), and its place is that spot plus its adjustment
  (`drNudge`) and those of the cards above it. Making a map keeps every card
  where it is, as adjustments; Tidy clears them.
- **When it lays out:** a card moved by hand keeps how far it moved, and its
  branch follows; a change to the tree (a card added, taken away,
  re-linked, resized, folded) lays the map out again, gliding. The result is
  saved into the step of Undo the change made (Obsidian's
  `overrideHistory`), so one Undo takes back both.
- **Folds hide; they don't move.** In a map a fold only tucks its branch
  away — no record of what moved — and the cards go straight to their map
  places in the same glide; unfolding lays the branch out again. A card's
  re-linking is told from its arrows, which a folded card keeps, so its
  adjustment survives a fold.
- **Groups frame branches.** A group holding one branch and nothing else is
  drawn round it (`drFrames`: the branch and the room round it), so it
  moves, folds and grows with its cards; sized by hand, it keeps the new
  room. Master cards keep their branch out of folds above, as before, and
  stand as a tree of their own while the card above them is folded.
- **Gate:** folding, unfolding and re-linking leave no drift (simulated
  over repeated rounds, and in Obsidian).
- **A layout per branch.** The tree's first card picks the layout; any
  branch can have its own (`drLayout` on its card), set by "Lay out branch".
  It's laid out by itself first, then placed as one block in the layout
  above it (`composedLayout`), so nothing overlaps; set back to the way
  above it, it follows the tree again.
- **Phase 3 is done.** Next, phase 4: Tab and Enter placed by the layout,
  dragging to re-link with a preview and to reorder siblings, arrow keys
  along the tree, richer cards and one map toolbar (customizable).

## 21. 2.0, phase 4: map editing, cards, toolbar

- **Editing in a map:** Tab adds the last card of a branch and Enter the
  next one after the selected card, each put straight in its place by the
  layout (one glide out of the card it hangs from). Alt and an arrow key go
  along the tree — the card above, the child that way, the next card beside
  it — and to the nearest card that way where the tree doesn't go. A card
  dragged past another beside it takes its place among them; dragged a
  little, it keeps the adjustment; dropped onto a card it hangs from it,
  placed by the layout. While it's dragged, a ghost shows where it would
  land.
- **One map toolbar** (`canvas/349`): a group of buttons in the bar above
  the selected cards for what you do to a map — add a card after or beside,
  fold, lay out, master card, focus — each shown only when its action fits.
  Which buttons, and their order, is a setting (`canvasToolbarItems`); the
  fold feature's own buttons give way to the toolbar's. The canvas settings
  are in six groups: Map, Cards, Arrows, Arrange, Find and focus, Check.
- **Cards that hold more** (`CanvasCardFacts` in 322): a card shows how far
  its checklist is done (3/5), a note card its cover and title like an album
  tile, and the properties chosen in settings as chips. Cards can be tinted
  by their branch or their depth (347), leaving cards' own colours as they
  are.

## 22. 2.0, phase 5: design, note-first

- **A quieter album page.** Notes nest under the note their parent property
  names (`albumNestBy`, `parent` to begin with; `nestByProperty` in 045),
  a step in, folding open, and that property gets no column. Under each
  title, a grey line: the note's description, or its first sentence
  (`noteOpening` in 047, read once per change of the note). One count,
  under the title: an album of its own notes alone has no heading for them
  and no count at its foot. At the end, "Still to write" — what its notes
  link to that isn't a note yet, greyed; a click writes it there — and a
  New note row.
- **The note page** (`library/140`): a note opens with its album above its
  title, in the accent colour (a click opens the album), and one grey line
  under it — what it hangs from, its length, when it was edited. Its
  properties can sit there as quiet chips, the full block a click away
  (off to begin with). At its end, shelves: Linked from here, Mentioned in,
  More in its album — each note its title and opening line. In editing and
  reading views, only in the note's own layout (not an embed's), drawn again
  only where what it says changed.
- **Colour from the cover, and glass.** A note's page takes a soft glow of
  its cover, or its album's, behind its title; without one it stays plain
  (`notePageTint`). Menus, suggestions and the canvas's bar and controls
  are frosted glass (`glassPanels`, a class on the page), not in the
  editorial look and not where the system asks for less transparency.

## 23. 2.0, phase 6: reading progress and Home

- **Reading history** (`core/075`, `readingOf(plugin)`): when each note was
  last opened and when it was read, in the plugin's data (`readingLog`,
  path-keyed, the latest 3000), never in notes. A note is read once its
  text has been on screen to its end (`library/145`: scrolled there, or
  short enough to fit and open a few seconds); changed since, it's
  "changed"; changed by you while open, still read.
- **What it shows:** an album's header counts "12 of 17 read"; a row new to
  you — made since the history began, or changed since you read it — has a
  dot; Open on an album becomes Continue, at the note you were last on;
  Recently read is a collection and joins the library after Pinned
  (settings step 4); Home's Continue reading picks up a note you didn't
  finish before the next one. Home's Rediscover leads with notes due a revisit: read a month ago or
  more, the longest ago first.

## 24. 2.0, phase 7: carry over and polish

- **Settings** come through each numbered step with a backup of the file
  as it was (`data.before-vN.json`); only settings still known are kept,
  retired ones dropped. A test opens 1.x settings and checks nothing else
  is lost.
- **Canvases:** free canvases are untouched. Making one a mind map keeps its
  earlier folds folded and drops their room records; pasted lists in a map
  land in their places.
- **Classic look** (Appearance → Look): the look from before 2.0 — no note
  header or shelves, no lines or dots under notes, no glass — for one
  release.

## 25. Several notes at once

- While an album is in Edit (122), each row has a tick box; Shift ticks a
  run from the last one ticked. A bar at the top of the album says how many
  are ticked and offers Move to…, Delete and Clear.
- Moving goes through `plugin.moveFile`, each note's place in its album
  kept; one Undo puts them all back (`putBack`, in reverse). Delete asks
  first (`ConfirmModal`, ui/230) and sends the notes to the trash.
- Leaving Edit clears the ticks.

## 26. Search and properties, reworked

- **Ranked search** (core/048 `rankNote`): a note's title, aliases, one
  property, its album, or its letters nearly in order, scored so the note
  named for the query comes first; the reason shows as the row's grey line
  (`view.searchWhy`). A row above the results picks the kind (All, Notes,
  Albums, Collections, Properties — `view.searchKind`) and the order of notes
  (`view.searchSort`), neither touching the query. Search rows aren't nested.
- **A property** (110 `renderOverview`): its facts — notes using it, values,
  empty, type — then its values, in the sort menu's order, each opening its
  notes (`view.value`; `EMPTY_VALUE` for the notes that leave it blank) with
  a way back. Values picked by their boxes merge into one, chosen or typed
  (`MergeValuesModal`, 302; `bulk.mergeValuesInto`, one step of Undo). The
  list sorts by name, notes or type (`propertiesSort`).
- **A note's property menu** (160 `showMenu`): by reach — type and place in
  this note; then Manage property (`manageEntries`, nested where Obsidian
  allows): View all notes using it and View notes with each of its values
  (the Properties screen, through `Library.browseMode`), Rename across vault,
  Set for the album; last, Remove from note.
- **Narrowing across properties** (121): `filterProp` and `filterMore`
  (`propFilters()`, `addPropFilter`) — a note passes all of them; each is a
  chip with its ×. A value's notes offer Narrow to these; the Properties
  screen keeps the filters as it moves (`keepFilters` in the state, which
  otherwise starts each screen clean) and says how many notes match, with
  Show them (Notes) and Search among them. Smart albums keep `more`.
- **Search inside notes** (110 `renderText`, setting `searchNoteText`): for
  three letters or more, a moment after typing stops (`TEXT_PAUSE`), notes'
  text is read with `cachedRead`, forty at a time between yields, stopped
  when the query changes; up to `TEXT_MOST` notes not already found by name,
  each with its passage (core/048 `textExcerpt`), kept 15 s for redraws. The
  kind row gains In text. Obsidian's own search stays a button.
- **Search with nothing typed**: Recently searched, Browse by (Albums,
  Properties, Tags), Recently added, then the categories if set.
- **A note's menu in the library** opens with Open in new tab, Reveal in
  album (when it isn't this album) and Copy link (`noteOpenings`, through
  `showTargetMenu`'s `first`).

## 27. Search and Properties as a music app's

- **Search results** (110 `renderResults`): Top Result — the best of the
  ranked notes, an album named for the query, or a value that is the query —
  large, then Albums (covers), Notes (rows, each saying why), Properties
  (values as "domain: Law" and properties by name, `propertyHits`, one pass
  over the notes), Collections, and In Notes (what notes say). A few of each;
  See All (`view.searchKind`) shows one kind whole, with All results back.
  The kind pills and the sort are gone.
- **Search with nothing typed**: Recently Searched as a short list, then
  Browse Categories as tiles, with the property they come from chosen
  beside the heading (`categoryProperty`); with none, Albums, Properties and
  Tags instead.
- **Properties as Artists** (110 `PropertiesScreen`): the list on the left;
  a property's page on the right — its name, "N notes · N values · N empty",
  then its values as covers (`valueArt`, the same on the value's page) or a
  list (`propertyValueView`: auto shows covers up to `VALUE_GRID_MOST`),
  "No value" last. A value opens as an album (`renderValuePage`, through
  `renderAlbumHead`): cover, name, the property under it as the way back,
  Open, Random and More, and its notes in the album list. Management is in
  the menus — a value's: Open, Open in new tab, Rename value, Merge with
  (Edit with it picked), Copy value, Narrow the library to these; a
  property's: View values, Rename, Merge, Change type, Find notes missing
  it, Copy name, Remove from every note. Edit on a property's page picks
  values to merge; with none chosen, it renames and merges properties.

## 28. Simpler to begin with

- **Settings, everyday first** (360 `BASIC_SETTINGS`, `settingsLevel`):
  the rows that change everyday use show; the rest are marked
  `is-advanced` and hidden until Show all settings, a search (which finds
  every row), or a link to one of them (`reveal`, for as long as the tab is
  open). A tab or section with nothing everyday hides with them.
- **A shorter library** (130 `defaultSections`, settings step 5): Search,
  Home, All Notes, the albums and Pinned first; Recent; then More, a section
  with `folded` (its heading opens and closes it, remembered), holding the
  occasional places (`LIBRARY_MORE`). Step 5 moves those places in a saved
  layout under More, in their order, and drops a section they alone filled.
- **Quieter to begin with** (settings step 6): glass panels and the note
  page's tint are off by default, and turned off once for everyone on
  updating; both are a switch away.
- **Canvas tools by task** (321 `CANVAS_TASKS`, `canvasToolButtons`): among
  the canvas's controls a button for each task with something that fits
  what's selected — Add, Arrange, Connect, Focus, More (folding, master
  cards, notes from branches, checking, comparing) — redrawn only when that
  changes; or, set so, one button with all of them in its menu.
- **Modes are ways of working** (348, settings step 7): Standard (no mode,
  the workspace as you keep it), Study, Research and Canvas (id `mapping`,
  as before). The library and its review are places: their old commands
  (`workspace-mode-library`, `-review`) open Home and the library check, so
  hotkeys keep working; anyone left in either is in Standard.
- **One vocabulary** (interface only): an album is a Collection, a smart
  album a Saved view, the screen of saved views and gathering collections
  Views, and a folder that holds collections a Shelf. Ids, class names,
  property names (`album`, `includes`…) and stored data keep the old words.
- **Layout** (`libraryLayout`, 110 `showsCovers`): Automatic shows
  collections, pins and a property's values (up to `VALUE_GRID_MOST`) as
  covers, and notes opened, added or read as a list; Covers and Lists set
  every screen one way (collections as rows: `folderRows`).
