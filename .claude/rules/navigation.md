---
paths:
  - "src/core/070-orders.js"
  - "src/core/047-helpers-text.js"
  - "src/tools/190-strip.js"
  - "src/tools/191-header-skip.js"
  - "src/library/1[0-4]*-*.js"
  - "src/plugin/350-plugin.js"
---

# Opening notes, stepping through albums, redrawing

- A note is opened in the page with `openInPage(plugin, file, leaf)`, and a
  step through its album is `stepInAlbum(plugin, file, dir, leaf)` (core/070).
  Both keep a pinned tab: it keeps its note and the next one opens in a new
  tab. Don't call `getLeaf(false).openFile` for a note shown in the page;
  `tests/test_scripts.js` refuses a new `getLeaf(false)` outside the files
  that had one when the rule came in.
- A note's opening line comes from `noteExcerpt(plugin, file, put, el)`
  (core/047): its description first, otherwise its opening; kept on the
  plugin by path and mtime; read later, it's written only while `el` is still
  on the page. Don't read a note's first lines yourself.
- An album's order changing fires `design-redux:albums-changed`
  (`Orders.setAlbum` / `setAlbumOn`, through `albumChanged()`; album
  structure too). Anything that shows an order (the note page's steps, the
  panel, shelves) listens for it.
- A small save that only needs open views drawn again: `plugin.saveData(...)`,
  then `plugin.queueSync()` (and `refreshBrowse()` if the browse view shows
  it). `saveSettings()` refreshes every feature and the browse views, so keep
  it for real settings changes.
- The header's « » (tools/191) lead out of the note's folder and back, each
  tab with its own short history (not Obsidian's), whether the strip is up or
  not. Previous and next inside the folder are the strip's, the note page's
  and the commands'.
