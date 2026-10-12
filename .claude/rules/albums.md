---
paths:
  - "src/1[0-3][0-9]-*.js"
  - "src/235-covers.js"
  - "src/25[5-9]-*.js"
  - "tests/test_album.js"
---

# Albums, the library and the browse view

- An album's data lives in its folder note's properties, read by name from
  `ALBUM_KEYS` (the names can be changed in settings: never write `'album'`,
  `'includes'` and so on as strings). Nothing album-shaped goes in settings
  but per-path view preferences, which go in `PATH_KEYED` so they follow
  renames.
- Album and shelf orders are kept by name per folder (`Orders`, `albumOrders`):
  a shelf's albums and an album's notes share that one list.
- Anything that changes files is one step of Undo (`plugin.offerUndo`); files
  move with `plugin.moveFile` / `plugin.putBack`, which keep links and number
  a name that's taken.
- A screen is a class in `BROWSE_SCREENS`, reached with
  `view.navigate({ mode, property })`; an album's panels are entries in
  `FolderScreen.panels`, shown as tabs only when there's more than one.
- The browse view is `BrowseView` (120) with its parts in 121 (sorting and
  filters), 122 (editing, pins in your own order) and 123 (rows, shelves,
  cards), put on it by `mixInto`. The library and its albums are one area for
  the layer check.
- `tests/test_album.js`: `setup()` gives a vault whose files really move; its
  `plugin.moveFile` returns true, not the old path, and `processFrontMatter`
  does nothing — replace either in a test that needs them.
  Its plugin has a real `notes` and `files`.
