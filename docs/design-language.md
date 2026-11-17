# The design language

How Design Redux looks, as a system: reduction and brutalism
(`docs/direction-reset.md`). `docs/DESIGN.md` says what the look is; this
file says how it is built. A screen is made only from what is here; one that
needs something this file lacks adds it here and to the specimen first.

- See it: `docs/specimen.html` (light and dark side by side), built by
  `node tools/specimen.mjs` from the same sources the plugin ships.
- Sources: `styles/` (tokens in `00-tokens.css`), `assets/icons/actions/`
  (the few glyphs), `src/ui/` (the shared pieces).
- Checked by: `tests/test_reset.js` (budgets, colours, sizes, lines, icons,
  settings), `tests/test_tokens.js`, `tests/test_glyphs.js`,
  `tests/contrast.js`, `tests/screenshots.js`.

## 1. The unit

One unit is 8px (`--dr-u`). Sizes, gaps and positions are whole units. Two
things are not, and both are lines: a line is 1px (`--dr-hair`) and the focus
outline 2px (`--dr-ring`). A row is four units; the gutter either side of a
column two. Boxes are `border-box`.

## 2. Type

One face for everything the plugin draws, a system face as it comes:
`--dr-font: "Helvetica Neue", Helvetica, Arial, sans-serif`. Two sizes and
nothing between:

| Token | Size | Line | For |
| --- | --- | --- | --- |
| `--dr-size` | 13px | 16px in a row, 24px running | everything |
| `--dr-size-display` | 48px | 48px | the one name that matters on a screen: a folder's on its page, the names of the browse view's grid |

No tracking, no capitals for effect, no italics. Bold nowhere: the inversion
is the sign of what is open. The note's own text keeps the person's font
(`--font-text`).

## 3. Colour

Black, white, one grey; red only for an error, and always with its word.

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--dr-bg` | `#FFFFFF` | `#000000` | the ground, and words on the inverted fill |
| `--dr-ink` | `#000000` | `#FFFFFF` | words, lines, the inverted fill |
| `--dr-muted` | `#767676` | `#898989` | words that are secondary: a property's name, a count, a hint |
| `--dr-error` | `#C00000` | `#FF5C5C` | an error's words |

Measured (`node tests/contrast.js`, written into `00-tokens.css`): ink on
the ground 21:1; grey on the ground 4.54:1 (6.0:1 dark); red 6.48:1 (6.94:1
dark). The grey is for words only, never a fill. The person's own colours (a
folder's colour on a map, Canvas cards, graph groups) are theirs: the plugin
names Obsidian's colour variables for them and declares no colour of its own.

## 4. States

One way to show each, nowhere a second.

| State | Read from | Drawn as |
| --- | --- | --- |
| rest | — | ink words on the ground |
| hover | `:hover`, where a pointer hovers | an underline (a glyph: a line under it) |
| focus | `:focus-visible` | a 2px ink outline, 2px clear; inside the edge on a row |
| selected, open | `aria-selected`, `aria-current`, `aria-checked`, `aria-pressed` | inverted: the ink as a fill, the words in the ground's colour |
| disabled | `aria-disabled`, `:disabled` | grey words; no hover |
| error | `aria-invalid`, `.is-error` | red words, and the words say what is wrong |
| loading | `aria-busy` | its word ("Moving…", "Reading the vault…") in grey |
| empty | the say-so | a sentence saying what is not there |

## 5. Pieces

Each is one set of `dr-` classes in one part of the stylesheet.

### Link · `.dr-link` · `10-base.css`
An underlined word that goes somewhere: a folder's name over a note, a page,
Previous and Next. Content, not a control: it is not counted in a budget.

### Text button · `.dr-button` · `20-controls.css`
An underlined word that does something ("New note", "Cancel"). The one that
commits (`.is-primary`) is black with white words, one a screen at most.

### Icon button · `.dr-icon-button` · `20-controls.css`
Four units square, a glyph of two, no box. Only where a glyph is plainer
than a word: search, back, close, more, add, and the map's tools. Its word
is its `aria-label` and its tooltip.

### Field · `.dr-field` · `20-controls.css`
A line under its text (`.dr-field-box`), nothing round it. Its name above,
in grey, only where the placeholder doesn't say the same.

### Toggle · Obsidian's `.checkbox-container`
Obsidian's own, squared through its variables: off, the ground in a line
and an ink knob; on, inverted.

### Row · `.dr-rows` > `.dr-row` · `22-rows.css`
A name and what trails it (grey), four units high. Rows are parted by their
height, never by a rule. Hover underlines the name; selected or open, the row
is inverted. No numbers, no marks.

### Head · `.dr-head` · `25-blocks.css`
The top of a screen: its few icon buttons, a line under it (the one line a
header has). A folder's page puts its name under the head at 48px
(`.dr-display`), left.

### Grid · `.dr-grid` > `.dr-cell` · `21-objects.css`
The browse view's folders: as many columns of cells as fit, a cell a
folder's name at 48px (`.dr-display`), or the cover image the person set.
Nothing else in a cell: no glyph, no count. Hover underlines the name;
selected or open, the cell is inverted.

### Say-so · `.dr-state` · `25-blocks.css`
What a screen shows in place of its contents: a sentence, and one text
button at most. An error's sentence is red.

### Sheet · `.dr-sheet` in Obsidian's `.modal`
Obsidian's own modal, flattened by the variable map: its title, the matter
(running text, fields, rows), the buttons at the foot, right: Cancel as an
underlined word, then the one that commits.

## 6. Screens

| Screen | Drawn as | Controls at rest |
| --- | --- | --- |
| Library sidebar | a field to search, then the folders' names as rows (the vault's loose notes after them); the open one inverted | 1: search |
| A folder | the head (back, more), its name at 48px, then its folders and notes as rows | 2: back, more |
| Browse view | the head (search, more), then the grid of folders | 2: search, more |
| Note | over the inline title, the folder's name as a link; under it the properties as one line (name grey, value ink, `·` between), the pages as links, the open one inverted, a line under it all; the strip at the foot: "21 / 24", Previous and Next as links | 0 |
| Properties panel | name and value on a line, the name grey; where it is named, mentioned and what it links to as plain rows; a header only where there is more than one group | 0 |
| Maps | words on the ground joined by 1px lines; the picked word inverted; a folder's colour as a small square before its word | the map's tools |
| 3D graph | ink squares on lines; the picked and the open note larger | the graph's tools |
| Sheets and menus | Obsidian's own, flattened | a sheet's fields and one button |

A line only where the structure divides: under a head (`.dr-head`), under
the note's head (`.dr-note-head`), over the strip (`.dr-strip`), between a
list and its detail (`.dr-browse-aside`), under a field (`.dr-field-box`).
These are the structural classes `00-tokens.css` lists; nothing else draws
a line.

## 7. Icons

Ten glyphs (`assets/icons/actions/`): `search`, `back`, `close`, `more`,
`plus`, `minus`, `fit`, `fold`, `unfold`, and `library` for the ribbon.
Drawn to one grammar, held by `tests/test_glyphs.js`: a 24-unit canvas ruled
every 1.5, filled shapes only, a bar of three units, square corners, edges
level, upright or at 45°, one step clear all round, one `<svg>` of `<path>`s.
Registered once with `addIcon` as `dr-<name>`. Menus and commands carry
words, not glyphs.

## 8. Budgets and checks

`tests/test_reset.js` holds the reset so it stays reduced:
- the controls of each screen at rest (icon and text buttons, fields,
  toggles, selects) within its budget; links and rows are content;
- each scheme declares exactly four colours: the ground, the ink, the grey,
  the error's red;
- exactly two font sizes;
- no border on a control or a row: borders only on the structural classes;
- at most twelve icons;
- the settings tab fits a 900px window without scrolling.

## 9. What we refuse

- **A second way to show a state.** No fill under the pointer, no inner
  line, no bar along a foot, no dashes, no hourglass, no mark beside what is
  picked.
- **A colour beyond the four**, a tint, a tone, an accent. Red only with its
  word.
- **A third size, a second face, tracking, capitals for effect.**
- **A frame, a box round a control, a rule between rows.** A line divides
  structure or is not drawn.
- **Ornament that carries no information**: a generated glyph, a count on a
  grid item, a row number, a header that repeats its rows, a title over the
  only section.
- **A second view of the same collection.** One list, one grid.
- **A rounded corner, a shadow, a gradient, a blur, movement.**
- **`!important`, inline colour, a colour value outside the tokens part.**
- **Anything of another's.** The discipline is borrowed. No mark, image or
  layout is.
