# Design Redux 4.0: release notes

A rewrite from the design up. Your vault opens as it was; nothing in your notes is rewritten by the upgrade.

## What changed
- **A new look, drawn by the plugin's own glyphs and tokens** (docs/design-language.md): one palette, light and dark, set on every window, popouts included, and taken off again when the plugin unloads. Nothing of Obsidian's is hidden.
- **The library is one sidebar at three levels** (home, folder, notes), as objects, words or a table, with the browse view and saved views. Covers are glyphs now; generated cover art is gone.
- **The note has a head** (pages, properties, footnotes, where it sits) and a strip at the foot; the properties panel has one kind of row, edited in place.
- **Maps are new**: one model for a folder's map and a note's, drawn from the vault; the keys walk the tree.
- **Tools** are one suite: property tools, clipboard and sets, schemas and rules with undo, the graph filter and routes, the 3D graph, the menu filter.
- **Desktop only** (`isDesktopOnly: true`).
- **Settings migrate once.** The old `data.json` is read and converted, and kept whole as `data.legacy.json` beside it. If that copy can't be written, the old file is left alone.
- **Every command id of the old plugin is kept** (70 of 70), so hotkeys hold. New ids: `open-map`, `open-map-here`, `open-map-note`, `panel-folder-properties`. All seven view types are kept; the outline view stays registered and closes itself.

## Corrected before release (docs/design-corrections.md)
- **The note's title comes first**: its folder over it, then its properties on one line (`name value · name value`) and its pages under it, all in the note's column and scrolling with it.
- **Fewer lines and boxes**: no frame round what sits in a pane, no rule between rows, bare controls, a table with one line under its header; the panel is a sheet.
- **Objects are named** under their glyphs by default, and a folder named for something gets that glyph (Music, a tune). Eighteen glyphs that looked like controls or signs (an X, a lock, a plus, a box in a box, a hash and others) are redrawn as things; a folder that had one gets a new one.
- **Quieter words**: capitals only for a section's title and a property's name; numbers only where the order means something; one sign a state (clay and bold is open, an ink square is picked).
- **Controls**: pressed is a deeper ash, disabled is muted words, loading is a word; the toggle is 40 by 20; a folder picked says Open, New note and Pin in words; the browse view's head holds four things.
- **Screens**: shelves are one row and name the bar you point at; headings sit smaller under the open note; map nodes show a folder's tone as a small square; property rules read and are written as sentences, each with a toggle.

## What was cut
- The one-page layout, the settings button in the header, swiping the sidebars (`singleArea`, `onePage`, `settingsInHeader`, `swipeSidebars`).
- The old home screen and its shelves, and the screen of every property.
- Generated cover art, small covers beside names, cover sizes and designs.
- The old album page's note limits, excerpts and columns (a folder's table takes `tableColumns`).
- The panel's Places section and folded sections; the strip at the top (it is a bar at the foot).
- Commands: none. Settings: 36 old keys retired, each with its reason in `src/core/migrate.js`; their values stay in `data.legacy.json`.
