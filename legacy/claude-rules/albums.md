---
paths:
  - "src/library/*.js"
  - "src/ui/235-covers.js"
  - "src/library/25[5-9]-*.js"
  - "tests/test_album.js"
---

# Albums, the library and the browse view

- An album's details (kind, description, includes, related, featured, layout)
  are kept by the plugin in `settings.albums`, by the folder's path, the lists
  as paths (`AlbumStructure.setField`, read with `info()`); folder covers in
  `settings.folderCovers`. Both are `PATH_KEYED`, and `Orders` follows the
  paths inside them through renames and deletes. No folder note is ever made.
  A folder note from before is still read (by the names in `ALBUM_KEYS`; never
  write `'album'`, `'includes'` and so on as strings) until the first change
  carries what it says over; it's left as it is.
- Album and shelf orders are kept by name per folder (`Orders`, `albumOrders`):
  a shelf's albums and an album's notes share that one list.
- Anything that changes files is one step of Undo (`plugin.offerUndo`); files
  move with `plugin.moveFile` / `plugin.putBack`, which keep links and number
  a name that's taken.
- A screen is a class in `BROWSE_SCREENS`, reached with
  `view.navigate({ mode, property })`; an album's page is its notes, with
  no tabs.
- The browse view is `BrowseView` (120) with its parts in 121 (sorting), 122 (editing, and the cells of a row edited in place), 123 (rows, shelves,
  cards), 124 (what it draws of a pick into the inspector), 125 (an album's page),
  126 (arranging: discs, tracks, pins and tiles in your own order), 127 (an
  album as a table: columns, header, groups by a property) and 128 (filters and
  Find), chained by `extends`: BrowseView extends 128, which extends 127, down to 121 over `ItemView`.
  The library and its albums are one area for the layer check.
- `tests/test_album.js`: `setup()` gives a vault whose files really move; its
  `plugin.moveFile` returns true, not the old path, and `processFrontMatter`
  does nothing — replace either in a test that needs them.
  Its plugin has a real `notes` and `files`.
