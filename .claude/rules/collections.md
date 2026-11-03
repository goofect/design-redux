---
paths:
  - "src/library/*.js"
  - "src/ui/235-covers.js"
  - "src/library/25[5-9]-*.js"
  - "tests/test_collection.js"
---

# Collections, the library and the browse view

- A collection's data lives in its folder note's properties, read by name from
  `COLLECTION_KEYS` (the names can be changed in settings: never write `'collection'`,
  `'includes'` and so on as strings). Nothing collection-shaped goes in settings
  but per-path view preferences, which go in `PATH_KEYED` so they follow
  renames.
- Collection and shelf orders are kept by name per folder (`Orders`, `collectionOrders`):
  a shelf's collections and a collection's notes share that one list.
- Anything that changes files is one step of Undo (`plugin.offerUndo`); files
  move with `plugin.moveFile` / `plugin.putBack`, which keep links and number
  a name that's taken.
- A screen is a class in `BROWSE_SCREENS`, reached with
  `view.navigate({ mode, property })`; a collection's panels are entries in
  `FolderScreen.panels`, shown as tabs only when there's more than one.
- The browse view is `BrowseView` (120) with its parts in 121 (sorting and
  filters), 122 (editing, pins in your own order), 123 (rows, shelves,
  cards), 124 (what it draws of a pick into the inspector) and 125 (a collection's page), chained by `extends`: BrowseView extends 125, which extends 124, down to 121 over `ItemView`.
  The library and its collections are one area for the layer check.
- `tests/test_collection.js`: `setup()` gives a vault whose files really move; its
  `plugin.moveFile` returns true, not the old path, and `processFrontMatter`
  does nothing — replace either in a test that needs them.
  Its plugin has a real `notes` and `files`.
- The look is plain (docs/architecture.md §43–44): a new screen's motion goes through
  `ui/231-motion.js`, never a measurement inside `render()`; everything is rows, a card
  included. Covers show only with `showCovers` (`coversOn`), as a small mark, never large.
- The note property that holds a collection's kind is still called `album` by default
  (`COLLECTION_KEY_DEFAULTS.type`): it's in people's notes. Command ids keep their old
  words too; hotkeys hang on them.
