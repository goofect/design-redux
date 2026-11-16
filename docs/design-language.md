# The design language

How Design Redux looks, as a system: the unit, the two voices, the palette as
measured, every component in every state, the icon grammar and the glyph
builder. `docs/DESIGN.md` says what the look is; this file says how it is
built. Screens are made only from what is here. A screen that needs something
this file lacks adds it here and to the specimen first, then uses it.

- See it: `docs/specimen.html` (light and dark side by side), built by
  `node tools/specimen.mjs` from the same sources the plugin ships.
- Sources: `assets/icons/` (the glyphs, one SVG each), `styles/` (staged in
  `next/styles/` until the old tree moves to `legacy/`), `src/core/glyphs.js`
  (staged in `next/src/core/`).
- Checked by: `tests/test_glyphs.js`, `tests/test_tokens.js`,
  `tests/contrast.js`, `tests/screenshots.js`.

## 1. The unit

One unit is 8px (`--dr-u`). Every size, position and gap the plugin draws is a
whole number of units. Two things are not, and both are lines: a hairline is
1px (`--dr-hair`) and the focus ring 2px (`--dr-ring`). Type sizes are type
sizes; the lines they sit on are on the unit. Boxes are `border-box`, so a
hairline is inside the size it belongs to and never pushes the grid. A box
that holds words is as wide as its words (a text button, a tab, a chip); its
height, its padding and its gaps are on the unit.

| Token | Units | Px | What is that size |
| --- | --- | --- | --- |
| `--dr-u`, `--dr-mark` | 1 | 8 | the unit; the mark; a bar's width; the gap between a row's parts |
| `--dr-gutter`, `--dr-icon`, `--dr-line` | 2 | 16 | the margin either side of a column; a control's glyph; a line of a label or a row |
| `--dr-line-loose` | 3 | 24 | a line of running text or a title; a chip; the slot |
| `--dr-row` | 4 | 32 | a row; a control; a field; a menu item; a table cell |
| `--dr-object` | 6 | 48 | an object in the sidebar; a head row; the strip; a shelf's line |
| `--dr-object-wide` | 8 | 64 | an object at the window's width |
| `--dr-object-large` | 12 | 96 | the folder picked |

Empty space is a material. A cell is twice its glyph; a folder picked has six
units of ground over its glyph. A screen that looks sparse is right.

### Columns

**The sidebar** (about 280 to 400px, dragged freely). A gutter of two units
either side. Three columns of square cells; a cell is the largest whole number
of units that fits three across, and what is left over is shared by the two
margins:

```
cell = round(down, (width − 2 × 16) ÷ 3, 8)      280 → 80 · 296 → 88 · 320 → 96 · 344 → 104 · 400 → 120
```

It is one line of CSS (`.dr-grid`, with the sidebar as the container), so the
grid is right at every width with no script. Rows, shelves and the outline use
the same edges: words start at the gutter, or after **the slot** — three units
that hold a row's number, a chevron, or the mark — and a gap of one. A head
row is six units high; an icon button at either end of it is pulled a unit
outward so its glyph, not its box, stands on the gutter.

**The browse view** (the window's width). The same grid: cells of sixteen
units, a glyph of eight, as many columns as fit, the remainder shared by the
margins (`.dr-grid.is-wide`). At the level of words a folder is the table,
from edge to edge of its pane (`.dr-table.is-flush`). The preview is the
folder-picked layout at a sidebar's width.

**The note.** The text column is Obsidian's own readable line, as wide as the
person set it. What the plugin adds round a note's title is put inside that
column, wherever the note is laid out (the editor's sizer, reading view's
header), so it scrolls with the text: the folder's label over the title; under
it (and under Obsidian's own properties, when they are shown) the properties,
the page tabs, and a hairline exactly as wide as the text. The order is folder,
title, properties, pages, text. The strip is the exception: it spans the pane,
with the sidebar's gutter, because it belongs to the pane and not to the text.

## 2. Two voices

| | Label | Reading | Title |
| --- | --- | --- | --- |
| Class | `.dr-label` | `.dr-text` | `.dr-title` |
| Size | 11px | 13px (`--font-ui-small`) | 20px (`--font-ui-large`) |
| Line | 16px | 16px in a row; 24px running (`.is-running`) | 24px |
| Tracking | 0.08em | 0 | 0 |
| Case | capitals | sentence | sentence |
| Weight | 500; 700 where it marks what is open, and in a table's header | 400; 600 where it marks what is open | 400 |
| Figures | tabular | tabular where they are counted | — |

- **Label** is the plugin's own naming: an object's name and count, a column
  head, a section's title, a tab, a property's name, a note's length. Ink, or
  muted on the ground.
- **Reading** is anything that is read: a note's title in a row, a value, a
  menu item, a sentence in a sheet. A note's name is the person's, so it is
  never capitals.
- **Title**: at most one to a region (a sheet's title).
- Bold marks only what is open, and a table's header. No italics outside the
  note's own text. Obsidian's own labels keep their case.
- The family is `--font-interface` for both; in the note, the person's.

## 3. Colour

Six neutrals, from `docs/DESIGN.md`, unchanged: every pair it uses measured at
or over its floor (`node tests/contrast.js`; the ratios are written into
`00-tokens.css` by the script and the suite fails if they drift).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--dr-bg` | `#E9E6DF` | `#1C1B19` | bone: every surface |
| `--dr-surface` | `#CFCCC5` | `#2A2927` | ash: under the pointer, and pressed; words on it are ink |
| `--dr-ink` | `#1A1A18` | `#E9E6DF` | text, glyphs, hairlines, the ring, the mark on the ground |
| `--dr-muted` | `#5E5C57` | `#A8A59E` | secondary words, on the ground only |
| `--dr-clay` | `#A58F7C` | `#A58F7C` | the fill behind what is selected or open; never text |
| `--dr-on-clay` | `#1A1A18` | `#1A1A18` | words, glyphs and marks on clay, dark in both schemes |

Measured: ink on bone 13.98 (dark 13.81); ink on ash 10.87 (11.66); muted on
bone 5.36 (7.00); on-clay on clay 5.66. Clay on bone is a fill at 2.47 in
light (5.59 in dark), and ash on bone 1.29: a fill has no floor, so **a fill
is never the only sign of a state** (next section). Three pairs are refused:
muted on ash (4.16 in light), anything but on-clay on clay (the dark scheme's
ink on clay is 2.47), and clay as a text colour.

**The semantic set**: five earth tones, for meaning the neutrals can't hold —
the person's own colours (Canvas cards, graph groups, map branches,
highlights), callouts, tags, error, warning, success.

| Tone | Light | Dark | Soft, light | Soft, dark | Stands for |
| --- | --- | --- | --- | --- | --- |
| `--dr-rust` | `#8A3F2C` | `#D1816E` | `#BE614A` | `#AE553F` | red; error (`--dr-error`) |
| `--dr-ochre` | `#6C5119` | `#BE8D2D` | `#9B762C` | `#8B6927` | orange; soft: yellow; warning |
| `--dr-moss` | `#485B2B` | `#7FA04C` | `#6B8544` | `#5F773D` | green; success |
| `--dr-slate` | `#3A596D` | `#749AB4` | `#59819B` | `#4F738A` | blue; soft: cyan |
| `--dr-plum` | `#764664` | `#B987A6` | `#A36B8E` | `#955C80` | purple; soft: pink |

A tone is at least 5.76 on the ground and 4.63 on ash in both schemes: it may
be text, a line, or a fill with words in the ground's colour on it. Its soft
form (`-soft`) is at least 3.33 on the ground: a fill or a line on the ground
only, never under words. Obsidian's eight colour names map onto the ten
values, so the person's colours stay distinct. A tone never carries meaning
alone: an error has its glyph and its reason in words.

## 4. Selected and open

Clay marks where you are. Because it is a fill, something that is not a fill
always comes with it. Each component reads its state from the element's ARIA
attribute, so what is drawn and what a screen reader hears cannot part ways.

| State | Attribute | Drawn as | The sign that is not colour |
| --- | --- | --- | --- |
| rest | — | ink on bone | — |
| hover | `:hover`, where a pointer hovers | ash fill, words on it ink | the pointer itself; an object's name appears |
| pressed | `:active` | ash fill | an inner ink line |
| focus | `:focus-visible` | — | the ring: 2px ink, 2px clear; inside the edge on anything flush with its neighbours (a row, a cell, a segment), and on-clay where that is clay |
| selected | `aria-selected="true"` | clay fill, on-clay words | a row: the hollow mark in the slot. A cell: its name and count appear. A panel row, a menu item: an ink line round it |
| open | `aria-current` (a note, a folder, a heading); `aria-selected` on a tab; `aria-checked` on a level | clay fill, on-clay words | bold, and: a row, the solid mark in the slot; a cell, the mark in its corner; a control without words, an ink bar along its foot; a bar, the mark under the line |
| on | `aria-pressed="true"`, `aria-checked="true"` | clay fill | the ink bar along the foot; a chip, the mark before its words; a toggle, the square's side |
| disabled | `aria-disabled="true"`, `:disabled` | muted | a dashed line where there is a border; no hover; a default cursor |
| loading | `aria-busy="true"` | — | the glass (`wait`) and a word |
| error | `aria-invalid="true"`, `.is-error` | rust line or words | the `alert` glyph and the reason in words |
| empty | `.is-empty`, `:empty`, the say-so block | muted | a dash for a value; a shelf's bare line; the say-so block |

**The mark** (`.dr-mark`) is one unit of ink, a square. Solid beside what is
open, hollow beside what is selected. It is the only ornament the plugin has,
and it always means the same thing.

One fill a surface: where a note is open and a heading of it is current, the
note keeps the clay and the heading takes the mark and bold on the ground.

## 5. Components

Each is one set of `dr-` classes in one part of the stylesheet, shown in every
state in the specimen; the screens built from them (the note, the panel,
search, a filter, the map, the 3D graph, a sheet) are drawn in the specimen
by the plugin itself, on a sample vault. "—" means the state does not apply. Tokens are named
without their `--dr-` prefix. Every interactive one is reached with Tab or the
arrow keys and wears the ring.

### Icon button · `.dr-icon-button` · `20-controls.css`

The plugin's controls are these. Four units square, a glyph of two, no border.
Its word is its `aria-label`, which Obsidian also shows as its tooltip.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | glyph `ink` on `bg` | — |
| hover | fill `surface` | the pointer |
| pressed | fill `surface` | the press itself |
| focus | ring `ink`, 2px clear | the ring, the only line it ever has |
| on (`aria-pressed`) | fill `clay`, glyph `on-clay` | the clay square: no bar, no border |
| disabled | glyph `muted`, no hover | default cursor; the control stays in place |
| loading (`aria-busy`) | the `wait` glyph | the glyph changes |
| selected, open, empty, error | — | a button acts; it holds no state but on |

### Text button · `.dr-button` · `20-controls.css`

Only where a glyph would not say it: a confirmation, a first choice. Four
units high, two of padding either side, a hairline, the reading voice.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | `ink` on `bg`, border `hair` `ink` | — |
| hover | fill `surface` | the pointer |
| pressed | fill `surface` | inner line, `ring` `ink` |
| focus | ring `ink`, 2px clear | the ring |
| proposed (`.is-primary`) | fill `ink`, words `bg` | reversed; it is the only one in its sheet |
| destroys (`.is-danger`) | border and words `error` | its word says what it destroys |
| disabled | border and words `muted` | border dashed |
| loading | the `wait` glyph before its word | glyph, and the word changes ("Moving…") |
| selected, open, empty | — | — |

### Zoom control · `.dr-segments` > `.dr-segment[role=radio]` · `20-controls.css`

Objects, shelves, words: three bare glyphs of four units, no frame and no
line between them, so the control is exactly twelve units wide. The level
shown stands on a clay square with no border. Arrow keys move between levels.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | glyph `ink` on `bg`, nothing round it | — |
| hover | fill `surface` | the pointer |
| pressed | fill `surface` | — (it becomes open at once) |
| focus | ring inside the segment | the ring |
| open (`aria-checked`) | fill `clay`, glyph `on-clay` | the clay square, no border |
| disabled | glyph `muted`, no hover | — |
| selected, empty, loading, error | — | a level is open or it is not |

### Tabs · `.dr-segments.dr-tabs` > `.dr-segment[role=tab]` · `20-controls.css`

A note's pages. Bare words, no frame and no line between them, a unit of
padding either side. More tabs than fit scroll sideways, a whole tab
at a time: a tab the edge would cut is not drawn (`is-cut`), and an ellipsis
stands at that edge (`is-more-before`, `is-more-after`), so no word is ever
cut in half. A fade would be a gradient, which the look refuses.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | label `ink` | — |
| hover | fill `surface` | the pointer |
| focus | ring inside the tab (`on-clay` on the open one) | the ring |
| open (`aria-selected`) | fill `clay`, words `on-clay` | bold (700) |
| disabled | label `muted` | no hover |
| empty | a note with one page shows no tabs | — |
| selected, loading, error | — | — |

### Toggle · Obsidian's `.checkbox-container` · `40-overlays.css`

Not built by the plugin: Obsidian's own, restyled, wherever a setting or a
sheet has one. Two squares of two units; the ink square stands on the side
that is true.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| off | track `bg` in a `hair` `ink` line, square `ink` at the start | the square's side |
| on (`.is-enabled`) | track `clay`, square `ink` at the end | the square's side |
| focus | ring `ink`, 2px clear | the ring |
| disabled (`.is-disabled`) | square `muted` | the line dashed |
| hover, selected, open, empty, loading, error | — | — |

### Field · `.dr-field` > `.dr-field-box` > `input.dr-input` · `20-controls.css`

A label over a square box of four units. The input is bare inside the box;
the box carries the border and the ring, and may hold a glyph before or after.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | box `hair` `ink` on `bg`; label `muted`; words `ink` | — |
| empty | placeholder `muted` | the placeholder's words |
| focus (`:focus-within`) | ring `ink`, 2px clear of the box | the ring |
| loading | `wait` glyph at the end; a note under ("Looking…") | glyph and words |
| error (`aria-invalid`) | box and note `error` | the `alert` glyph and the reason in words |
| disabled | box and words `muted` | box dashed |
| hover, selected, open | — | a field is typed in, not picked |

### Chip · `.dr-chip` · `20-controls.css`

Plain words, no box, three units high: a filter's part that takes itself off,
or a filter that can be on (`role="checkbox"`). A property under a note's
title is not a chip: it is the note head's line of name and value.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | name `muted`, value `ink`, nothing round them | — |
| hover (a filter) | fill `surface`, name `ink` | the pointer |
| focus | ring `ink`, 2px clear | the ring |
| on (`aria-checked`) | fill `clay`, words `on-clay` | — |
| disabled | words `muted` | no hover |
| error (`aria-invalid`) | words `error` | its place is beside the field or row that says why; its `aria-label` says why |
| takes itself off (a filter's part) | a `close` glyph after its words | the glyph; its `aria-label` says "Take off" |
| a value given a tone (`data-tone`) | words in the tone | the words are the value itself; the tone is the person's own colour |
| open, empty, loading | — | — |

A filter's parts are plain chips that close, not chips "on": the one clay
fill on a screen stays the mark of where you are.

### Object cell · `.dr-grid` > `.dr-cell` · `21-objects.css`

A folder or a note as a glyph on the ground: no frame, no fill, its name
under it. The cell is square; the glyph half of it, centred; the name
(`.dr-cell-label`) stands in the foot on one line, cut with an ellipsis, and
the count joins it under the pointer, the ring or the pick. That is the
default (`alwaysShowLabels`, `.dr-grid.is-labelled`); with it off, the name
waits there unseen until the pointer, the ring or the pick, so nothing moves
when it appears. The whole name and count are the cell's `aria-label`, and so
its tooltip. A cover of the person's own takes the glyph's place: its own
shape, square corners, no filter (`.dr-cell-cover`).

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | glyph `ink` on `bg`, its name under it | — |
| hover | fill `surface` | its count appears (and its name, with labels off) |
| focus | ring inside the cell | the ring; its name and count appear |
| selected | fill `clay`, glyph `on-clay` | its name and count stay |
| open (`aria-current`) | fill `clay` | the mark in its corner; its name bold |
| labels off (`.dr-grid` without `.is-labelled`) | no words at rest; name and count with the pointer, the ring or the pick | — |
| disabled | glyph `muted`, no hover | — |
| error | `alert` glyph in its corner, `error` (`.dr-cell-flag`) | the glyph; the reason in its tooltip |
| loading | the glyph stands until a cover has loaded | nothing flashes |
| empty | the grid shows the say-so block | — |

### Row · `.dr-rows` > `.dr-row` · `22-rows.css`

A note in a list. Four units high: the slot (`.dr-slot`, its number, muted,
tabular), its name (`.dr-row-name`, the reading voice), and what trails
(`.dr-row-end`, the label voice, muted: its length). No line between two rows:
their height, on the unit, parts them. A hairline parts groups only (over a
section's title that follows another group, between the outline's folders,
between a folder picked and its notes).

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | name `ink`; number and end `muted` | — |
| hover | fill `surface`; number and end `ink` | the pointer |
| focus | ring inside the row | the ring |
| selected | fill `clay`, all `on-clay` | the hollow mark where the number was |
| open | fill `clay`, all `on-clay` | the solid mark where the number was; name bold |
| disabled | all `muted`, no hover | — |
| not written yet (`.is-missing`) | name `muted` | a dashed line under it |
| error (`.is-error`) | end `error` | the `alert` glyph and a word |
| loading, empty | the say-so block stands in for the rows | — |

### Shelf · `.dr-shelf` > `.dr-shelf-head`, `.dr-shelf-bars` > `.dr-bar` · `23-shelves.css`

A folder as a row of bars: its label and count over them (the head, a row of
four units that opens the folder), one bar a note. A bar is a unit wide less a
hairline of ground, and one to five units tall by the note's length
(`--dr-size`, set by the script: 1 up to 300 words, then a unit more each
time the length doubles). It stands on a hairline that is its own, so a shelf
is as long as its notes and wraps into as many lines as it needs.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | bar `muted`, line `hair` `ink` | — |
| hover (a bar) | bar `ink` on a column of `surface` | the pointer; its name is its tooltip |
| focus (a bar) | ring round its column | the ring |
| selected (a bar) | fill `clay` behind the bar, bar `on-clay` | the hollow mark under the line |
| open (a bar: the open note) | fill `clay` behind the bar, bar `on-clay` | the solid mark under the line |
| open (the head: the folder in the page) | head fill `clay`, label `on-clay` | label bold |
| empty | the line with nothing on it | the bare line; the count reads 0 |
| disabled, loading, error | — | a bar is a note that exists |

### Outline row · `.dr-outline` > `.dr-outline-folder`, `.dr-row`, `.dr-row.is-child` · `22-rows.css`

Words: the plain outline. A folder is one line (`.dr-outline-folder`): a
chevron in the slot, its label, its count, a hairline over it. Open
(`aria-expanded`), its notes follow as rows without rules. Under the open
note, its headings or pages (`.is-child`), set in two units, muted.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| folder closed / open | label `ink`, count `muted` | the chevron: `next` closed, `down` open |
| hover | fill `surface`, all `ink` | the pointer |
| focus | ring inside the line | the ring |
| note rows | as Row, without the hairline | as Row |
| heading at rest | `muted` | — |
| the heading you are at (`aria-current`) | `ink` on `bg`: the clay stays with the note | the solid mark in the slot; bold |
| disabled, loading, error, empty | as Row | as Row |

### Panel row · `.dr-prop`, `.dr-section` · `22-rows.css`

A property: its name in the label voice (twelve units, muted), its value
beside it in the reading voice, no line under it. A section's title
(`.dr-section`) is a row of four units in the label voice, no line under it,
with the one or two bare icon buttons the section needs; a title that folds
its group is pressed itself (`aria-expanded` on its label): no arrow, no
button, and folded it is muted and counts what it holds.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | name `muted`, value `ink` | — |
| hover | fill `surface`, name `ink` | the pointer |
| focus | ring inside the row; editing, the ring is the field's | the ring |
| selected | fill `clay`, all `on-clay` | an ink line round the row |
| empty (`.is-empty`) | value `muted` | a dash for the value |
| a link | shown as the name of what it links to | — (edited as written) |
| a value given a tone | value in the tone (`data-tone`) | the value's own words |
| error (`aria-invalid`) | value `error` | the `alert` glyph at the end |
| disabled | all `muted` | no hover |
| open, loading | — | — |

The panel is a sheet. It does not name the note again (its name is on the
page beside it): it starts at its properties, as one section or in the
groups the person set (`panelGroupList`), each title folding its group on a
press, and its two bare buttons (add a property, the note's menu) at the end
of its first title. Its parts are parted by space, never a rule. Under the
properties, sections of plain rows, without numbers: where the note is
named in a property (the property trails it), where it is mentioned, what it
links to (a note's folder trails it only where the list mixes folders), and
its history (a press puts one value back).

### Table · `.dr-table` · `24-table.css`

A folder's notes at the window's width. Horizontal lines only: one under the
header, one between groups where a table has them; no line between columns
or rows, no zebra, cells of four units. Columns are as wide as what they hold
(a long name is cut at 48 units). Heads are the label voice, bold; cells the
reading voice; numbers right and tabular. A number column (the slot) only
where the order means something: a folder in its own order, not re-sorted.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | `ink` on `bg`, a `hair` `ink` line under the header | — |
| sorted column | — | `up` or `down` right beside its name, and `aria-sort` |
| hover (a row, a head) | fill `surface` | the pointer |
| focus (a cell, a head) | ring inside it | the ring |
| selected (a row) | fill `clay`, `on-clay` | the hollow mark in the slot |
| open (a row) | fill `clay`, `on-clay` | the solid mark in the slot; bold |
| disabled (a row) | `muted` | — |
| error (a cell) | words `error` | a wavy line under them |
| empty, loading | one cell across the table holding the say-so block | its glyph and label |

### Strip · `.dr-strip` · `25-blocks.css`

A bar across the foot of the note, six units, a hairline over it: the
folder's glyph at four units, the note's title over its place ("Logic · 5 of
24", the label voice), then previous, next and more as icon buttons. It never
floats, never covers text, and shows its buttons without the pointer.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | `ink` on `bg`; place `muted` | — |
| at the first or last note | that button `muted` (`aria-disabled`) | it stays in place, and does nothing |
| a note in no folder | the `note` glyph, its title, "No folder"; previous and next `muted` | the words say it |
| its buttons | as Icon button | as Icon button |
| selected, open, loading, error | — | — |

### Menu · Obsidian's `.menu` · `40-overlays.css`

Obsidian's own menu, for every menu the plugin opens. Square, a hairline, no
shadow. Items are rows of four units from edge to edge; a separator is a
hairline with no space round it. Glyphs are the plugin's.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | `ink` on `bg` | — |
| selected (`.selected`: the pointer or the arrow keys) | fill `clay`, `on-clay` | an ink line round the item |
| disabled (`.is-disabled`) | `muted` | it takes no selection |
| a submenu | — | `next` at its end |
| checked | — | Obsidian's own tick at its end |
| destroys (`.is-warning`) | `error` | its word; it stands last, under a separator |

### Sheet · `.dr-sheet` in Obsidian's `.modal` · `25-blocks.css`, `40-overlays.css`

What the plugin puts in one of Obsidian's modals: the modal's own title in the
title voice, the matter (running text, fields, rows), and the buttons at the
foot, right: cancel first, then the one it proposes or the one that destroys.
Square, a hairline, a flat dim behind it (`--dr-dim`), no blur.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | `ink` on `bg`, border `hair` `ink` | — |
| loading | the proposed button turns to loading; the rest stays | glyph and word |
| error | the field that is wrong says why; a failure that is the sheet's own is a say-so block in its matter | glyph and words |
| empty | a sheet with nothing to ask is not opened | — |

### Say-so · `.dr-state` · `25-blocks.css`

What a surface shows in place of its contents: a glyph at six units, a label,
a line of running text if it helps, and one text button at most.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| empty | `empty` glyph and line `muted`; label `ink` | the label says what is not there |
| loading | `wait` glyph; label ("Reading the vault") | glyph and label; nothing spins |
| error (`.is-error`) | `alert` glyph `error`; label `ink` | the label says what failed, the line why, the button what to do |

### Head row · `.dr-head` · `25-blocks.css`

Six units, a hairline under it, the one line a header has: a label, and the
few bare icon buttons a surface needs. The library's holds the word Library,
search, and the zoom control; inside a folder, a back button comes first and
the label is the folder's. Where the head names a note (a map of a note, the
3D graph round a note) it is set in the reading voice (`text: true`): a
note's name is the person's and is never capitals. The panel has no head.

### Note head · `.dr-note-place`, `.dr-note-head` · `31-note.css`

The plugin's own parts round a note's title, inside the note's column in
each place it is laid out (the editor's `.cm-sizer`, reading view's
`.mod-header`), so they scroll with the text. Over the inline title, the
folder as a label (`.dr-note-place`; a press opens it in the browse view).
Under it, or under Obsidian's own properties where they follow the title,
the head (`.dr-note-head`): the note's main properties on one line
(`.dr-note-props`) of name and value, `name value · name value`, the name
muted in the label voice and nothing round them (a value in its tone; one
its folder's schema finds wrong, `aria-invalid`, in the error's tone with
the `alert` glyph beside it), the page tabs and a `plus` to add a page, and a hairline under it all, with no
padding at its sides, so the line is exactly as wide as the text. A part
with nothing in it is not drawn; a head with nothing in it is taken away.
Nothing of Obsidian's is moved.

### Filter bar · `.dr-filter-bar` · `30-library.css`

Under a head row, a unit of ground above and below: a filter's parts as
chips that close (plain words and a `close` glyph), then how many notes
pass, as a muted label. No line of its own: the head's is the one line.

### Map · `.dr-map` > `.dr-map-node` · `60-tools.css`

A tree laid out in columns, a level a column, a leaf a row; every link one
path of ink hairlines, out of the parent, down, into the child. A node is a
box of 22 units by 4 with a hairline, its glyph and its name.

| State | Drawn with | Besides colour |
| --- | --- | --- |
| rest | `ink` on `bg`, border `hair` `ink` | — |
| hover | fill `surface` | the pointer |
| focus | ring `ink` | the ring; the arrow keys walk the tree, Space folds, Enter opens |
| picked (`aria-selected`) | fill `clay`, `on-clay`, an inner ink line | the line |
| open in the page (`aria-current`) | — | its name bold |
| folded (`aria-expanded="false"`) | a count, `+3`, `muted` | the count |
| a folder's tone (`data-tone`) | border `ring` in the tone | the line is twice as thick |

### 3D graph · `.dr-graph3d` · `60-tools.css`

Drawn on a canvas by the script, in the tokens' colours read from the
page: links as `muted` hairlines, notes as `ink` squares as large as they
are linked, the picked note and the open one in `clay` with an `ink` line
round them and two units larger. The name of the note pointed at or picked
stands in the corner in the reading voice. It opens fitted to its pane and
moves only when it is turned, by the pointer or the arrow keys.

## 6. Icons

Two families, kept apart. Obsidian's own icons are only restyled: one colour,
one size, one weight of line, through its variables (`01-obsidian-map.css`,
the icons region). **The plugin's set** is drawn for this look, 150 glyphs,
one SVG file each, and is the only thing a plugin control or object shows.

### The grammar

1. **The canvas** is 24 units, ruled in sixteen steps of 1.5. One step is one
   pixel at 16px, two at 32, three at 48, six at 96: at every size the plugin
   uses, an edge falls on a pixel. One step is kept clear all round.
2. **Solid.** A glyph is filled shapes, never a stroked line. Paint is
   `currentColor`.
3. **The bar** is two steps, 3 units: every line-like part is that thick, and
   no gap is narrower. Nothing finer exists in the set, a margin over
   `docs/DESIGN.md`'s floor of 2 units.
4. **Corners are square.** Nothing is rounded to soften it. A curve appears
   only where the thing is round, and then it is part of a true circle whose
   radius is on the rules.
5. **Edges** are level, upright, or at 45°. No other slope.
6. **Diagonals** weigh what bars weigh: a 45° band is cut three steps (4.5
   units) wide along the grid, which is 3.2 across. Its ends are cut level or
   upright, or by the corner of its box; never with a cap across.
7. **Holes** are cut from a shape (`fill-rule="evenodd"`), at least a bar
   wide: a ring is a disc with a disc cut out.
8. **Points** sit on the rules. Where a diagonal ends between two rules its
   end may sit on the half step (0.75); a level or upright edge never does.
9. **Centred**: a glyph's box is centred on the canvas to within half a step.
10. **The file** is one line: `<svg xmlns viewBox="0 0 24 24"
    fill="currentColor">` holding only `<path d>` elements, with only the
    commands `M`, `L`, `A` and `Z`. No strokes, groups, transforms, styles or
    ids. `tests/test_glyphs.js` holds every file to all of this.

### Action glyphs and object glyphs

| | Action (`assets/icons/actions/`, 102) | Object (`assets/icons/objects/`, 48) |
| --- | --- | --- |
| Stands for | something to do, or a state | a folder: a thing, never a sign |
| Built from | bars and small masses: arrows, lines, a simple body with a sign | one closed shape, with holes where the thing has them |
| Fills its box | lightly: mostly ground | heavily: mostly ink |
| A sign on a thing | the thing keeps its upper left; the sign (plus, minus, check, arrow) takes a square of six steps at the lower right, two steps clear of it | never: an object is not acted on in its own glyph |
| Drawn at | 16px in a control of 32 | 48, 64 and 96px, and 32 in the strip |
| Named for | what it does (`move`, `note-new`) | what it is (`boat`, `anvil`) |
| Never | — | a form that reads as an action or a sign: an X, a plus, a lock, a hash, a box in a box, a plain square, disc, diamond, octagon, ring, star, heart, bell, flag, pin, arrow, cloud, camera (`FORBIDDEN_FORMS` in `tests/test_glyphs.js`); nor an outline 90% the same as an action glyph's, each scaled to its own box |

A note, as an object, is the action set's `note`. Each command's glyph is
listed in `assets/icons/actions.json`, and the suite fails if a command has
none. A new glyph is drawn to the grammar, added to the folder of its kind,
and the specimen built again; a new object glyph also joins a family in
`src/core/glyphs.js`.

In the plugin a glyph is registered once with Obsidian's `addIcon` as
`dr-<name>`, its paths scaled to the 100-unit box that function expects, and
drawn with `setIcon`; `.dr-glyph` sizes and paints it.

## 7. The glyph builder

`src/core/glyphs.js`: text in, glyph names out; no Obsidian, no DOM.

- **What the name asks for.** A folder whose own name holds a word for
  something in the set takes that glyph (`glyphMeant`: Music a tune, Reading
  a book, Recipes a bowl, Café a cup), unless a sibling has it; accents, case
  and a plural's s are no part of it. Only then the hash.
- **From the path alone.** `glyphFor(path)` hashes the folder's path (FNV-1a
  with a last mix, over the name in one Unicode form, so a Mac's spelling and
  a synced one agree) and scores every glyph against it; the best is the
  folder's. The same on every run and machine; nothing in the folder is asked.
- **Siblings are told apart.** `glyphsAmong(paths, chosen)` settles the
  folders that share a parent together: no glyph twice while the set lasts,
  and the six families — glyphs of one build, the hardest to tell apart side
  by side — used evenly. Up to six siblings are six different builds; up to
  48, 48 different glyphs.
- **A choice is kept.** What is in `chosen` — picked by the person, or stored
  from an earlier call — is never changed, and a folder made later takes a
  glyph none of its siblings has. So the library stores what the builder gave
  the first time it showed a folder (by path, in `data.json`), and from then
  on a folder's face changes only when the person picks another.
- **Through a rename.** `glyphsRenamed(chosen, from, to)` carries a folder's
  choice, and those of everything under it, to the new path;
  `glyphsRemoved` drops them.
- **The set can grow.** Scores are per glyph, so a glyph added later takes
  only the folders that score it highest; no other unpicked folder moves.

## 8. From the rules to the code

| The language (`docs/DESIGN.md`) | Tokens | Classes | Held by |
| --- | --- | --- | --- |
| 1. Objects, not chrome | `--dr-object`, `-wide`, `-large` | `.dr-cell`, `.dr-glyph`, `.dr-detail` | specimen: no fill or frame at rest |
| 2. The grid is the structure | `--dr-u`, `--dr-gutter`, `--dr-row` | `.dr-grid`, `.dr-slot`, `.dr-head` | sizes only from tokens; `round()` for the cell |
| 3. Words only where they earn it | — | `.dr-cell-label`, `.is-labelled`, `aria-label` | specimen: objects at rest |
| 4. Labels are small and quiet | `--dr-label-size`, `-track`, `-weight`, `--dr-muted` | `.dr-label`, `.dr-muted` | — |
| 5. Icons are the controls | `--dr-icon`, `--dr-row` | `.dr-icon-button`, `.dr-button` for the exceptions | `test_glyphs`: a glyph for every command |
| 6. One accent, used as a fill | `--dr-clay`, `--dr-on-clay`, the semantic set | `aria-selected`, `aria-current`, `.dr-mark` | `contrast.js`; `test_tokens`: colour only in the tokens part |
| 7. Zoom instead of navigation | — | `.dr-segments`, `.dr-grid`, `.dr-shelf`, `.dr-outline` | specimen: the three levels |
| 8. Stillness | Obsidian's durations set to 0 | `.dr *`: no transition, no animation | `test_tokens`: no motion in any part |
| 9. Every screen squints well | — | one clay fill a surface (section 4) | the screenshots, looked at |
| Zero radius, no shadow, no blur | `--dr-radius` | — | `test_tokens` |
| Hover only for pointers that hover | `--dr-surface` | `@media (any-hover: hover)` | `test_tokens` |

The look reaches Obsidian through its variables (`01-obsidian-map.css`: 334
names, each on the list read from the app, `tests/snapshots/obsidian-vars.json`),
gated by `body.dr-active` and a region's class. The plugin's own classes are
not gated: they match only what the plugin draws. With the look off, the
tokens fall back to the theme's colours, so the plugin's surfaces follow the
theme and keep their structure.

## 9. What we refuse

- **A card, a panel, a frame or a tint behind an object.** The ground is the
  only surface; an object that needs a box is not strong enough.
- **A frame round what sits in a pane, a rule between two rows of a group, a
  box round a control.** The pane is the frame. A line parts one thing from
  another, or it is not drawn: one under a header, one between groups.
- **A rounded corner, a shadow, a gradient, a blur.** Depth is a claim that
  one thing is above another. Nothing is.
- **Movement.** A state is a fact, and a fact is shown at once. A spinner is
  refused with it: waiting is the glass and a word.
- **A second accent, or clay as text.** One fill says where you are. Two say
  nothing.
- **Colour as the only sign.** Clay on bone is 2.47 to 1. Every state has a
  sign that is a shape, a weight or a word.
- **An object nobody can name.** A grid of unnamed glyphs is a puzzle, and
  a glyph picked at random says nothing. The name stands under each object;
  the glyph is what its name asks for where the set has it.
- **An object glyph that looks like a control.** An X beside a folder reads
  as close, a lock as locked, a plus as add. Objects are things.
- **Words on a control.** A control is a glyph; its word is its tooltip. The
  exceptions are a confirmation and a first choice.
- **An outline icon, a stroke, a detail under the bar.** At 16px a hairline
  is noise, and two weights are two hands.
- **A slope that isn't 45°, a softened corner.** Every glyph shares one set
  of moves, which is why they look like one set.
- **A size off the unit.** One odd gap and the grid is a suggestion.
- **Muted words on ash.** 4.16 to 1. Under the pointer, words are ink.
- **A control of our own where Obsidian has one.** Toggles, menus, modals and
  inputs are its; they are restyled, so they keep its keys and its readers.
- **`!important`, inline colour, a hex outside the tokens part.** The person
  can always override the look, and there is one place to change a colour.
- **Anything of another's.** The discipline is borrowed. No mark, image or
  layout is.
