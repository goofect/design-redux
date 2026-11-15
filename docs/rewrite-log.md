# Rewrite log

Session 0 inventory. Branch `rewrite`. Built from `tests/snapshots/lifecycle.json`, `node tests/map.js`, grep; no tests run. Recommendations are proposals for you to mark.

Note: `docs/REWRITE.md` and `docs/DESIGN.md` are not in the repo yet (only `docs/architecture.md`); this inventory did not need them.

Size: 38,253 lines in `src/` (library 9,216; tools 12,073; core 7,645; note 6,114; ui 1,796; plugin 1,409). Largest module: `core/032-drawn-covers.js`, 2,415 lines.

## 1. Features (33 `Feature` classes)

| Class | Setting key | Module | Lines | What it does | Recommend |
|---|---|---|---|---|---|
| Library | `library` | library/130 | 589 | Sidebar library view, history, layout; offers `library` | keep |
| NotePage | `notePage` | library/140 | 381 | Album + title header, chips, shelves, next at a note's end | keep |
| AlbumProperty | `propertyForAlbum` | library/255 | 121 | A property's menu hands its value to the album's notes | merge → album tools |
| AlbumRefactor | `albumRefactor` | library/256 | 500 | Rename/move/merge/split albums safely, with preview | keep (merge with structure) |
| AlbumStructure | `albumStructure` | library/257 | 641 | Folder-note keys (type, description, includes, related, featured, layout); offers `albums` | keep |
| SmartAlbums | `smartAlbums` | library/258 | 310 | Saved filters as albums; offers `savedViews` | keep |
| LibraryCheck | `libraryCheck` | library/259 | 505 | Audit and inbox of loose notes; offers `libraryCheck` | keep, slim |
| SidebarDrop | `sidebarDrop` | library/107 | 99 | Drop a note on an album in the library | merge → Library |
| ListKeys | `typeToJump` | note/105 | 70 | Type-to-jump in lists | merge → shared UI |
| PropertyLinks | `propertyLinks` | note/165 | 70 | Panel: where a note is named in other notes' properties | merge → panel |
| PropertiesPanel | `propertiesDropdown` | note/180 | 651 | The panel / inspector | keep |
| NotePages | `notePages` | note/267 | 914 | One note, several pages (`%%page: name%%`) | keep? ask |
| MarkedLists | `(none)` | note/273 | 233 | Lettered and roman lists | cut? ask |
| Scripts | `scripts` | note/280 | 518 | Superscript/subscript marks | cut? ask |
| Footnotes | `footnotes` | note/285 | 249 | Footnote add/tidy/aside; offers `footnotes` | keep |
| ActionsMenu | `navDropdown` | tools/140 | 159 | File-explorer action buttons, ribbon in menu | merge → Library |
| ContextStrip | `contextStrip` | tools/190 | 601 | Bottom strip: place in album, detail, progress; offers `strip` | keep |
| HeaderSkip | `(none)` | tools/191 | 247 | Header back/forward out of folder and in | merge → Library |
| OnePage | `onePage` | tools/200 | 116 | Single-area layout | cut? ask |
| MenuFilter | `(none)` | tools/210 | 112 | Trims Obsidian's context menu | cut? ask |
| SettingsButton | `settingsInHeader` | tools/220 | 143 | Settings button in header | cut |
| SidebarSwipe | `swipeSidebars` | tools/225 | 160 | Swipe sidebars (touch) | cut (desktop only) |
| GraphPropertyFilter | `graphProperties` | tools/260 | 433 | Graph filter by property | merge → one graph feature |
| GraphRoutes | `graphRoutes` | tools/262 | 495 | Graph routing by a parent property | merge → one graph feature |
| Graph3D | `(none; toggle-graph-3d)` | tools/275 | 760 | 3D graph tab | ask: keep/cut |
| PropertySchemas | `propertySchemaMarks` | tools/305 | 465 | Property types/schemas per folder, checks | keep → Properties tools |
| PropertyHistory | `propertyHistoryLimit` | tools/306 | 110 | Undo history for bulk changes | keep → Properties tools |
| PropertyRules | `propertyRulesOn` | tools/307 | 346 | Rules on property values, dry run | keep → Properties tools |
| BulkEditing | `(none); offers propertyTools` | tools/310 | 283 | Rename/merge/clean property, tag, value everywhere | keep |
| Appearance | `lookScope` | core/085 | 90 | Look settings (art, density, icons); offers `look` | keep |
| CoverImages | `(none); offers covers` | ui/235 | 260 | Covers from images, colours, first image | keep |
| CoverDrop | `coverDrop` | ui/237 | 159 | Drop an image to set a cover | merge → covers |
| ImageRouter | `routeImages` | ui/240 | 91 | Route pasted images to a folder | cut? ask |
| PropertyClipboard | `(none); offers clipboard` | ui/250 | 526 | Copy/paste/sort properties, as table too | keep |
| Diagnostics | `(none)` | plugin/355 | 213 | Copy diagnostics | keep, slim |

Not `Feature` classes but big: browse view (library/120–128, `BrowseView` + 7 parts), property rows/edits (note/160–161), folder/home screens (library/108–119), drawn covers (core/032, 2,415 lines).

Retired already: mindmap and outline views (`note/196-retired-views.js`; `RETIRED_CANVAS_KEYS` in core/070). Session 4's "maps" are new work.

## 2. Data contract

### Note / folder-note properties
- Folder-note keys (`ALBUM_KEY_DEFAULTS`, renameable via `albumKeyNames`): `type` (default value `album`), `description`, `includes`, `related`, `featured`, `layout`.
- `cover` (setting `coverProperty`), `domain` (`categoryProperty`), `parent` (`albumNestBy`, `graphRouteProperty`), `tags`/`tag`.
- Folder note name pattern: `{{folder}}` (`folderNoteName`). Table columns default `domain, status`; album columns `domain, modified`.
- Page markers inside a note: `%%page: Name%%` on its own line. Script marks `x^2^`, `H~2~O` (or `<sup>`/`<sub>`); lettered/roman lists written as plain text.

### data.json keys (115 settings in lifecycle snapshot)

`albumColumns`, `albumExcerpts`, `albumKeyNames`, `albumNestBy`, `albumNoteLimit`, `albumOrders`, `albumRefactor`, `albumRollups`, `albumSortMemory`, `albumSorts`, `albumStillToWrite`, `albumStructure`, `albums`, `artworkSize`, `autoOrdinals`, `categoryProperty`, `contextStrip`, `coverColors`, `coverDesigns`, `coverDrop`, `coverFallback`, `coverFromFirstImage`, `coverFromFolder`, `coverPrint`, `coverProperty`, `defaultSort`, `discNoteLimit`, `folderCovers`, `folderDefaults`, `folderNoteName`, `footnoteOrder`, `footnotes`, `footnotesAside`, `generatedCoverColor`, `graphFilters`, `graphProperties`, `graphRouteProperty`, `graphRoutes`, `graphRouting`, `gridDensity`, `headerOrder`, `hideEmptyFolders`, `hideFolderNotes`, `hideNativeProperties`, `homePath`, `homeShelves`, `iconMode`, `imageFolder`, `inspector`, `inspectorClick`, `keepOwnOrder`, `letterLists`, `library`, `libraryCheck`, `libraryInbox`, `libraryLayout`, `librarySections`, `lookScope`, `navDropdown`, `notePage`, `notePageChips`, `notePageNext`, `notePageShelves`, `notePages`, `onePage`, `pagesOpen`, `panelFoldedGroups`, `panelFolderViews`, `panelGroupList`, `panelPlaces`, `panelPrimaryProps`, `panelPropertiesView`, `panelPropertyGroups`, `panelPropsCollapsed`, `pinOrder`, `pinsExpanded`, `propertiesDropdown`, `propertiesSort`, `propertyForAlbum`, `propertyHistory`, `propertyHistoryLimit`, `propertyInlineEdit`, `propertyInspector`, `propertyLinks`, `propertyOptions`, `propertyRules`, `propertyRulesDryRun`, `propertyRulesOn`, `propertySchemaMarks`, `propertySchemas`, `propertySets`, `propertyValueChips`, `recentSearches`, `ribbonInMenu`, `rollupDateKey`, `romanLists`, `routeImages`, `scriptSyntax`, `scripts`, `searchNoteText`, `settingsInHeader`, `settingsVersion`, `showArt`, `showMentions`, `sidebarDrop`, `singleArea`, `smartAlbumList`, `smartAlbums`, `stripDetail`, `stripPlace`, `stripSide`, `swipeSidebars`, `tableColumns`, `tileGroups`, `typeToJump`

**PATH_KEYED** (follow renames/deletes; `core/070`): `albums`, `folderCovers`, `coverColors`, `coverDesigns`, `albumSorts`, `propertySchemas`, `propertyHistory`, `panelFolderViews`, `pagesOpen`. Also path-keyed in plugin rename handling: `albumOrders`, `folderDefaults`.

Other: `settingsVersion` + `SETTINGS_MIGRATIONS` (core/070), `UNRENAMED_KEYS`, `RETIRED_CANVAS_KEYS`. Never drop a key without a migration.

### Command ids (70; hotkeys hang on them)

`add-footnote`, `add-page`, `add-properties-to-folders`, `album-delete`, `album-include-note`, `album-merge`, `album-move`, `album-rename`, `album-set-type`, `album-split`, `browse-vault`, `change-property-type`, `check-property-schemas`, `clean-up-property-values`, `copy-diagnostics`, `copy-properties`, `copy-properties-table`, `copy-some-properties`, `cover-from-first-image`, `cycle-cover-size`, `find-missing-properties`, `folder-default-properties`, `folder-property-schema`, `go-back`, `go-forward`, `library-check`, `library-inbox`, `make-lettered-list`, `make-roman-numeral-list`, `merge-properties`, `new-folder-here`, `new-note-here`, `next-in-album`, `next-page`, `open-actions`, `open-graph-3d`, `open-graph-3d-local`, `open-inspector`, `open-library`, `open-properties`, `paste-properties`, `paste-properties-table`, `previous-in-album`, `previous-page`, `property-rules`, `property-set-apply`, `property-set-remove`, `property-set-save`, `property-to-album`, `remove-cover-image`, `remove-folder-cover`, `remove-properties-from-folders`, `rename-property-everywhere`, `rename-tag-everywhere`, `rename-value-everywhere`, `repair-cover-link`, `reset-layout`, `set-cover-color`, `set-cover-image`, `set-folder-cover`, `show-footnotes`, `smart-album-open`, `smart-album-save`, `sort-properties`, `subscript`, `superscript`, `tidy-footnotes`, `toggle-graph-3d`, `toggle-graph-routes`, `undo-bulk-change`

### View types (7)
`design-redux-browse`, `design-redux-footnotes`, `design-redux-graph-3d`, `design-redux-library`, `design-redux-mindmap`, `design-redux-outline`, `design-redux-properties` (mindmap and outline are retired shells).

### Files the plugin creates
- Notes (`.md`, empty): new note in a folder, folder notes (`core/074-files.js`, `browse-editing`), property-panel new notes (`note/160`).
- Binary: dropped/pasted cover images via `createBinary` into `imageFolder` (default `attachments`) (`ui/237`).
- Folders: new folder, album move/merge/split (`plugin.files`).
- No custom file formats; everything else lives in `data.json` and note frontmatter. Clipboard formats: property copy and table copy (`PropertyClipboard`).

## 3. Actions the icon set must cover

73 actions carry a name and icon in source (palette, menus, strip). Many menu-only entries beyond these have no id in `actions()`; Session 1 should also grep menu items.

| id | Name | Current icon (Lucide) | Acts on | Module |
|---|---|---|---|---|
| `open-inspector` | Show or hide the inspector | `panel-right` | app | 130-library-feature.js |
| `open-library` | Open library | `library` | app | 130-library-feature.js |
| `reset-layout` | Put the library and inspector back in place | `layout` | app | 130-library-feature.js |
| `cycle-cover-size` | Next density: compact, standard, spacious | `grid-2x2` | app | 130-library-feature.js |
| `go-back` | Go back | `arrow-left` | app | 130-library-feature.js |
| `go-forward` | Go forward | `arrow-right` | app | 130-library-feature.js |
| `new-note-here` | New note in the current folder | `file-plus` | album | 130-library-feature.js |
| `new-folder-here` | New folder in the current folder | `folder-plus` | album | 130-library-feature.js |
| `browse-vault` | Browse vault as a grid | `layout-grid` | app | 130-library-feature.js |
| `previous-in-album` | Previous note in collection | `chevrons-left` | file | 140-note-page.js |
| `next-in-album` | Next note in collection | `chevrons-right` | file | 140-note-page.js |
| `property-to-album` | Give a property of this note to its whole collection… | `layers` | note | 255-album-property.js |
| `album-set-type` | Set what kind of collection this is… | `shapes` | app | 257-album-structure.js |
| `album-include-note` | Show this note in another collection too… | `folder-input` | note | 257-album-structure.js |
| `smart-album-open` | Open a saved view… | `sparkles` | app | 258-smart-albums.js |
| `smart-album-save` | Keep these filters as a saved view… | `sparkles` | app | 258-smart-albums.js |
| `library-check` | Look the library over | `stethoscope` | app | 259-library-check.js |
| `library-inbox` | Open the inbox: notes in no collection | `inbox` | app | 259-library-check.js |
| `open-properties` | Open properties | `list` | app | 180-panel.js |
| `next-page` | Next page of this note | `chevron-right` | note | 267-pages.js |
| `previous-page` | Previous page of this note | `chevron-left` | note | 267-pages.js |
| `add-page` | Add a page to this note | `plus` | note | 267-pages.js |
| `add-footnote` | Add footnote | `file-signature` | editor | 285-footnotes.js |
| `show-footnotes` | Show footnotes | `file-signature` | app | 285-footnotes.js |
| `tidy-footnotes` | Put footnotes in order | `list-ordered` | editor | 285-footnotes.js |
| `copy-diagnostics` | Copy diagnostics for a bug report | `clipboard-copy` | app | 355-diagnostics.js |
| `general` | Home screen | `home` | app | 357-settings-layout.js |
| `home` | Home screen | `home` | app | 357-settings-layout.js |
| `strip` | Context strip and modes | `panel-bottom` | app | 357-settings-layout.js |
| `appearance` | Covers | `image` | app | 357-settings-layout.js |
| `covers` | Covers | `image` | app | 357-settings-layout.js |
| `library` | Library | `library` | app | 357-settings-layout.js |
| `notes` | Note page | `file-text` | app | 357-settings-layout.js |
| `writing` | Writing extras | `pen-line` | app | 357-settings-layout.js |
| `pages` | Pages | `files` | app | 357-settings-layout.js |
| `inspector` | Properties panel | `list` | app | 357-settings-layout.js |
| `properties` | Properties panel | `list` | app | 357-settings-layout.js |
| `advanced` | Graph | `share-2` | app | 357-settings-layout.js |
| `graph` | Graph | `share-2` | app | 357-settings-layout.js |
| `compat` | Compatibility | `shield-check` | app | 357-settings-layout.js |
| `look` | Other | `more-horizontal` | app | 360-settings-tab.js |
| `other` | Other | `more-horizontal` | app | 360-settings-tab.js |
| `open-actions` | Open actions menu | `more-horizontal` | app | 140-actions-menu.js |
| `toggle-graph-routes` | Graph: links through notes between, on or off | `route` | app | 262-graph-routes.js |
| `open-graph-3d` | Open 3D graph | `rotate-3d` | app | 275-graph-3d.js |
| `open-graph-3d-local` | Open 3D graph around this note | `git-fork` | note | 275-graph-3d.js |
| `toggle-graph-3d` | Switch the graph between 2D and 3D | `box` | app | 275-graph-3d.js |
| `folder-property-schema` | Property schema for this folder… | `clipboard-check` | app | 305-bulk-schema.js |
| `check-property-schemas` | Check notes against their schemas… | `list-checks` | app | 305-bulk-schema.js |
| `property-rules` | Property rules… | `wand` | app | 307-bulk-rules.js |
| `add-properties-to-folders` | Add properties to folders… | `list-plus` | app | 310-bulk-feature.js |
| `rename-property-everywhere` | Rename a property everywhere… | `pencil` | app | 310-bulk-feature.js |
| `merge-properties` | Merge properties… | `merge` | app | 310-bulk-feature.js |
| `rename-tag-everywhere` | Rename a tag everywhere… | `tag` | app | 310-bulk-feature.js |
| `remove-properties-from-folders` | Remove properties from folders… | `list-minus` | app | 310-bulk-feature.js |
| `rename-value-everywhere` | Rename a property value everywhere… | `replace` | app | 310-bulk-feature.js |
| `clean-up-property-values` | Clean up a property’s values… | `sparkles` | app | 310-bulk-feature.js |
| `change-property-type` | Change a property’s type… | `shapes` | app | 310-bulk-feature.js |
| `find-missing-properties` | Find notes missing a property… | `search` | app | 310-bulk-feature.js |
| `folder-default-properties` | Default properties for this folder… | `folder-cog` | app | 310-bulk-feature.js |
| `undo-bulk-change` | Undo the last bulk change | `undo-2` | app | 310-bulk-feature.js |
| `set-cover-color` | Set cover colour | `palette` | app | 235-covers.js |
| `set-folder-cover` | Set cover image for a folder | `image-plus` | app | 235-covers.js |
| `remove-folder-cover` | Remove cover image from a folder | `image-minus` | app | 235-covers.js |
| `sort-properties` | Sort properties alphabetically | `arrow-down-a-z` | app | 250-property-clipboard.js |
| `copy-properties` | Copy properties | `copy` | note | 250-property-clipboard.js |
| `copy-some-properties` | Copy some of this note’s properties… | `copy-check` | note | 250-property-clipboard.js |
| `paste-properties` | Paste properties | `clipboard-paste` | note | 250-property-clipboard.js |
| `property-set-save` | Keep this note’s properties as a set… | `bookmark-plus` | note | 250-property-clipboard.js |
| `property-set-apply` | Apply a property set… | `stamp` | note | 250-property-clipboard.js |
| `copy-properties-table` | Copy the properties of this folder’s notes as a table | `table` | app | 250-property-clipboard.js |
| `paste-properties-table` | Update notes from a table on the clipboard… | `table-properties` | app | 250-property-clipboard.js |
| `property-set-remove` | Remove a property set… | `bookmark-minus` | app | 250-property-clipboard.js |

Distinct current icon names (61): arrow-down-a-z, arrow-left, arrow-right, bookmark-minus, bookmark-plus, box, chevron-left, chevron-right, chevrons-left, chevrons-right, clipboard-check, clipboard-copy, clipboard-paste, copy, copy-check, file-plus, file-signature, file-text, files, folder-cog, folder-input, folder-plus, git-fork, grid-2x2, home, image, image-minus, image-plus, inbox, layers, layout, layout-grid, library, list, list-checks, list-minus, list-ordered, list-plus, merge, more-horizontal, palette, panel-bottom, panel-right, pen-line, pencil, plus, replace, rotate-3d, route, search, shapes, share-2, shield-check, sparkles, stamp, stethoscope, table, table-properties, tag, undo-2, wand

Plus 178 distinct `icon: '…'` literals in `src/` overall (menus, buttons); the full list is `grep -rhoE "icon: '[a-z0-9-]+'" src | sort -u`.

## 4. Questions for you
1. `docs/REWRITE.md` and `docs/DESIGN.md` don't exist; should they be added before Session 1?
2. Cut or keep: NotePages, MarkedLists, Scripts, OnePage, MenuFilter, ImageRouter, Graph3D?
3. Confirm cutting SettingsButton and SidebarSwipe (touch/desktop-only).
4. Is `drawn-covers` (2,415 lines) to be replaced by the new glyph builder?

## 5. Session 1: the design system

Built: `docs/design-language.md`, 150 glyphs (`assets/icons/`), the glyph builder, the tokens and the variable map, the component styles, `docs/specimen.html` and its 20 approved screenshots. No plugin feature yet.

Decisions
- **Where the new files are.** The old build refuses any new file under `src/` or `styles/`, so the new tree's first files are staged in `next/` (`next/src/core/glyphs.js`, `next/styles/NN-name.css`). Session 2 moves the old tree to `legacy/` and `next/*` to the root; the tests and tools look in both places, so nothing else changes.
- **Icon grammar.** A 24-unit canvas ruled every 1.5 units (sixteen steps: a pixel each at 16px). The bar is 3 units, over DESIGN's 2-unit floor. Square corners, 45° only, true circles only. Held on every file by `tests/test_glyphs.js`.
- **The set.** 102 action glyphs and 48 object glyphs (six families of eight). `assets/icons/actions.json` gives each of the 70 commands its glyph, whatever is kept or cut.
- **The builder.** A folder's glyph is scored from its path; siblings are settled together (none alike, families spread). The library is to store what the builder gave the first time it shows a folder (`folderGlyphs`, by path), so a folder made later never changes another's face.
- **Palette.** DESIGN's six values pass unchanged. Clay on bone is 2.47:1, so clay is never the only sign of a state. Everything drawn on clay is `--dr-on-clay`: the dark scheme's ink on clay is 2.47.
- **Semantic set.** Five earth tones (rust, ochre, moss, slate, plum), each with a soft form: ten values a scheme, onto which Obsidian's eight colour names map without two sharing one.
- **Selected and open.** The mark is an 8px ink square (DESIGN's "small ink dot": a round one would need a radius): solid beside what is open, hollow beside what is selected. Open is also bold. A control without words wears an ink bar along its foot.
- **Shelves.** The open note's bar has a clay fill behind it, as every other level has (DESIGN said ink alone).
- **The folder picked.** Its buttons are the plain square icon buttons, not round ones: zero radius and one kind of control win.
- **Gating.** The variable map and every rule on Obsidian's own DOM are gated by `body.dr-active` and a region. The plugin's own `dr-` classes are not: they match only what the plugin draws, and with the look off the tokens fall back to the theme's colours.
- **Obsidian's own controls.** Toggle, menu and modal are Obsidian's, restyled (`40-overlays.css`); the plugin builds none.
- **State is the ARIA attribute.** `aria-selected`, `aria-current`, `aria-pressed`, `aria-checked`, `aria-disabled`, `aria-busy`, `aria-invalid` are what the styles read.
- **Screenshots** are `node tests/screenshots.js`, outside `npm test`: they need a browser and the images are this Mac's fonts.

Open
- Inside a folder, at the level of objects, every note is the same sheet and a long title is cut at the cell's width (the whole of it is the tooltip). Words may be the better level to open a folder at.
- The keep, merge and cut marks of session 0 are still to come.
