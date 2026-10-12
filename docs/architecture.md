# Design Redux: architecture audit and refactor roadmap

This covers milestone 0 of the refactor: what the code is now, what's wrong with it (with
evidence), where it should go, and in what order. It doesn't change any code. The figures were
taken on 2026-10-11 from `src/` (88 pieces, 36,627 lines) using `tests/map.js`'s index.
To get them again: `node tests/map.js`, then `--who NAME` and `--deps PIECE`.

## 1. The current architecture

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
| M8 | cleanup | medium | docs match the code |

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
