# REWRITE.md: Design Redux, rebuilt from scratch

Design Redux is rewritten as a new codebase with a new look (`DESIGN.md`).
The old code is a reference for what the plugin does, not a base to edit.
The goal is a smaller plugin, easier to change, that a person can learn in
an afternoon, with every feature the owner keeps working at least as well as
it does today.

## What must survive (the data contract)

A person's vault must open in the rewrite with nothing lost and nothing to
redo. Fixed unless the owner says otherwise:
- **Notes are never rewritten by the upgrade.** Every property the old plugin
  wrote into notes (covers, orders, pages, relationships, study data and the
  rest, found in phase 0) is read by the new code with the same names and
  values. New writes use the same names.
- **Settings migrate.** The new plugin reads the old `data.json` on first
  load and converts it once, keeping a copy of the original as
  `data.legacy.json`. Path-keyed settings follow renames as before. A
  migration test runs against a copy of the owner's real `data.json`.
- **Command ids of kept features stay the same,** because hotkeys hang on
  them. A cut feature's ids are listed in the release notes.
- **Files the plugin made stay valid:** folder notes, `.mindmap` files,
  templates and anything else found in phase 0.
- Nothing is uploaded, synced or sent anywhere that the old plugin did not.

## Scope: the feature decision

Phase 0 lists every feature of the old plugin (its `Feature` classes, from
`tests/snapshots/lifecycle.json` and the source) in one table, one line
each: what it does, its size in lines, and a keep / merge / cut
recommendation. The owner marks each one **keep**, **merge** (into another
feature) or **cut** before any new code is written. The
rewrite builds only what is marked keep or merge. Fable proposes, the owner
decides.

## How to run it

- Work on a branch `rewrite`. Move the old source to `legacy/` (`legacy/src`,
  `legacy/styles.css`, `legacy/tests`), kept for reading and never built or
  imported. The new code starts empty in `src/`.
- The old plugin stays the released one until the rewrite reaches the cutover
  gate. The rewrite ships as a new major version, and only when the owner
  says so (a `Release-As:` line, per `AGENTS.md`).
- **Lean on tokens; the owner accepts more risk for it.** Six sessions in
  all, a short review between them, not a stop after every step.
  `docs/rewrite-log.md` holds only decisions, cuts and open questions, in a
  few lines each. `.claude-cache/checkpoint.md` holds the next step.
- What is never traded for tokens: notes are never rewritten by the upgrade,
  the old `data.json` is kept as a backup, and the migration has a test.
  Everything else (extra tests, audits, screenshots, real-Obsidian runs) is
  kept to the minimum below.
- Commit locally at the end of each session. Push only when the owner asks.

## Architecture

Keep what worked in the old plugin, drop what made it heavy.

Keep:
- **Features with a lifecycle:** `register()` once, `enable()` and
  `disable()` safe to repeat, everything a feature adds removed by
  `disable()`.
- **Actions as the single source:** a feature declares its actions once,
  with what they act on; commands and menu entries are built from that list.
- **Core services:** one service to read and write a note's properties (with
  an Undo that keeps later edits), one for making, moving and restoring
  files, one index of the vault that screens read instead of walking it, and
  one selection model.
- **Layers by folder,** checked by a test: `core`, then `ui`, then the
  features by place (`library`, `note`, `maps`, `tools`), then `plugin`. A
  module imports only from its own area and those below.
- **The simulation tests** (jsdom with real CodeMirror, Obsidian stood in
  for) and the real-Obsidian tests, rebuilt for the new code. The old harness
  can be copied and trimmed; it is the one part of `legacy/` worth reusing.
- **The rules that have bitten before** in `AGENTS.md`: no regex lookbehind,
  hover styles inside `@media (any-hover: hover)`, no `scope` field on a
  `Modal`, the settings window's own document, menu entries with a section,
  Obsidian's internals only behind `typeof` checks with a fallback.

Change:
- **Budgets, enforced by a test:** no module over 400 lines; a feature's
  settings under about 10, with the rarely changed ones behind its gear; the
  whole plugin's settings and commands counted and reported each phase.
- **One look, in `DESIGN.md`.** No glass, no motion system, no alternate
  looks. `styles.css` is built from small files under `styles/` (one per
  region and per feature), concatenated in a fixed order by the build, so a
  region can be found and replaced whole.
- **One way to draw a screen:** a few shared UI pieces (row, table, button,
  menu, sheet, field, tabs) in `ui/`, used by every feature, with no
  feature-specific copies.
- **No duplicate engines.** Mind maps and the plain-canvas extras share one
  map model; anything kept from the canvas side goes through one adapter.
- **Plain names and comments** that say what a thing is for, in the style of
  the old `AGENTS.md`.

`AGENTS.md` is rewritten in phase 1 to describe the new code, and kept true
as the code changes.

## Build order (six sessions)

0. **Inventory** (no new code, short): the feature table, built from
   `tests/snapshots/lifecycle.json` and the `Feature` classes with one line
   each; the data contract (property names, setting keys, command ids, file
   formats) as plain lists. The owner marks keep / merge / cut.
1. **The design system** (Fable, the heaviest design session):
   `docs/design-language.md`, the plugin's icon set (60+ glyphs as SVG
   sources), the glyph builder and its tests, the token and contrast work,
   and `docs/specimen.html` with its screenshot tests. No plugin features
   yet; the owner reviews the specimen before anything is built on it.
2. **Skeleton, core and Obsidian's regions:** the branch, `legacy/`, the new
   `src/` with its layers, the build with `styles/`, a trimmed copy of the
   test harness, the new `AGENTS.md`, settings with the migration and its
   test, the core services, actions, the Feature base, the shared UI pieces
   built from the design language, and Obsidian's own regions in the look.
3. **Library and note:** the three-level library sidebar, the folder detail,
   home, browse view, folder notes, the note page, pages, the properties
   panel and the kept note features.
4. **Tools and maps:** the strip, modes, bulk edits, the graph filter, and
   mind maps (with whatever is kept of the canvas extras) on one model. The
   plugin is desktop only: `isDesktopOnly: true` in `manifest.json`, and any
   code that exists only for phones or tablets is cut.
5. **Cutover:** the parity check below, one real-Obsidian run, the migration
   run on a copy of the owner's vault, the specimen and screenshots
   re-approved, short release notes. The owner decides when it ships.

## The parity check (the cutover gate)

- Every kept command id is registered (checked by the lifecycle test).
- Every old setting key is read by the new code, migrated, or listed as
  belonging to a cut feature.
- A copy of the owner's vault opens with the new plugin and shows the same
  albums, covers, orders, pages and maps, with no note changed on disk by
  the upgrade (checked by comparing files before and after).
- The design self-audit, the layer and budget tests and the simulation suite
  pass; one real-Obsidian run passes on the latest version (CI covers the
  oldest once pushing resumes).

## What the owner provides

- The keep / merge / cut marks after phase 0.
- A copy of their `data.json`, and ideally a copy of a real vault (or a
  trimmed one), for the migration tests. These stay out of the repo.
- Answers to the open questions each phase ends with.
