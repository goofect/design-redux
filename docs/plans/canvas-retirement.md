# What a later major release could delete

**Done in 3.0.** `src/canvas/` and its tests are gone; diagnostics moved to
`plugin/355-diagnostics.js`; the canvas command ids a mind map answers to
are its own commands now (`mapCommands()`, `mindmap/420`); retired setting
keys go in migration step 13 (`RETIRED_CANVAS_KEYS`). Unlike the plan:
`core/079` stays, slimmed to the few asks of a plain canvas (the strip's
count, the panel's picked card, a study highlight as a card);
`canvasRelationTypes` and `canvasRelationNames` stay, since mind maps and
Knowledge share them, and their editor moved to Knowledge's settings; the
Mapping workspace mode is "Maps" and opens the latest mind map.

Written at M7 of the mind-map plan (`docs/plans/mindmap.md`), when new maps
became mind maps. Canvas maps stay through 2.x; this is what the release that
stops offering them (step 5, "Retire") could take out, and how big it is.
Line counts as of M7.

## Deleted

| What | Lines |
| --- | ---: |
| `src/canvas/`: the 36 canvas-map modules, 315–349 (all but `340-diagnostics`) | 11,209 |
| `src/core/079-canvas-adapter.js`: the adapter over the canvas's internals | 425 |
| `src/canvas/340-diagnostics.js`: its six canvas rows (minimap view ×2, Canvas switched on, legend counts, folding, arrow styles) | about 67 |
| `styles.css`: rules for canvas maps and their minimap | about 400 |
| `tests/test_canvas.js` | 2,888 |
| **Total** | **about 15,000** |

The real-Obsidian tests of canvas maps in `tests/obsidian/plugin.e2e.mjs` go
with them; `tests/snapshots/internals*` shrinks to what's left.

## Kept

- The converter and export: `tree/414-tree-convert.js` (canvas to map and
  back) and `mindmap/440-mindmap-convert.js`, with `tests/fixtures/canvas/`.
  They read and write a canvas's JSON and touch no canvas internals.
- `tree/` as it is: the canvas's tree code (`400`, `403`) is the mind map's
  layout now.
- `340-diagnostics` without its canvas rows: the Compatibility list (menus,
  suggestions, property types, drag and drop, graph, quiet links), the
  Copy diagnostics command and the error capture for bug reports. The M7
  plan said to remove the module as canvas-internals diagnostics; it's more
  than that, so it stays.
- `mapHandlers()` (`mindmap/420`, was `MINDMAP_HANDLERS`): the canvas command ids a mind map
  answers to, so their hotkeys keep working.

## To do in that release

- Command ids only a canvas answers to (`canvas-map-folder`, `canvas-map-tag`,
  `map-album`, `canvas-quick-add` and the rest without a mind-map handler)
  leave `tests/snapshots/lifecycle.json`; the lifecycle test asks for the
  update.
- `canvas*` setting keys and `canvasMapFiles` go through a migration step
  (the stale-key pass drops them), and `mindmapKeepCanvasMaps` with them.
- `library/257-album-structure.js` uses `CanvasVaultMap` (328): point it at
  the mind map's vault map first, then record the layer change
  (`node tests/map.js --check --update`).
- `Knowledge`'s canvas side (`KnowledgeCanvas`, mixed in from 326): Open in
  canvas and the relationships canvas go; Map its relationships is already a
  mind map.
