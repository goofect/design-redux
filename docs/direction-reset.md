# Direction reset: reduction and brutalism

4.0 is not reductive and not brutal. It is a careful, tasteful system:
earth tones, a clay accent, value tones, 150 drawn glyphs, a glyph
builder, three zoom levels, a label voice in tracked capitals, seven kinds
of state cue, a specimen with captions for every state. Every one of those
was added. Reduction removes; brutalism shows the raw material and doesn't
apologise for it. Both are missing, so this file resets the direction.

It replaces "The language in detail" and the palette in `docs/DESIGN.md`,
and sections B to E of `docs/design-corrections.md`. Sections A (broken)
and F (the release) still apply.

## Reduction: take away until it breaks, then put one thing back

1. **One job per screen.** The library lists folders. A folder shows its
   notes. A note shows its text. Nothing else lives on those screens.
2. **A budget of visible controls**, counted at rest, checked by a test:
   - library sidebar: 1 (search)
   - a folder: 2 (back, more)
   - a note: 0 (everything is in Obsidian's own menus and the command
     palette)
   - browse view: 2 (search, more)
   - a sheet: its fields and one button
3. **One view of a collection, not three.** The zoom control, the shelves
   level and the objects level in the sidebar are cut. The sidebar is a
   list of names. The browse view is one grid. A folder's notes are one
   list.
4. **No ornament that carries no information.** Cut: generated glyphs and
   the glyph builder (a folder shows its name, or the image the user set as
   its cover), the strip's glyph, counts on grid items, row numbers, group
   headers that only repeat what the rows say, specimen-style captions in
   the interface, section titles where there is one section.
5. **One way to show each state.** Hover: underline. Focus: a 2px black
   outline. Selected or open: inverted (black ground, white text). Disabled:
   grey text. Nothing else: no ash, no inner line, no foot bar, no dashes,
   no hourglass.
6. **Fewer settings.** The whole settings tab fits on one screen without
   scrolling. Everything that isn't a feature's on/off goes or gets a
   fixed, good value.
7. **Fewer icons.** About ten: search, back, close, more, add, and the few
   map tools. Everything else is a word.

## Brutalism: raw, blunt, honest

1. **Raw material.** One typeface for everything the plugin draws, a
   system face used as it comes: `Helvetica Neue, Helvetica, Arial,
   sans-serif`. No tracking, no capitals for effect, no small sizes for
   elegance.
2. **Black, white, one grey.** The earth tones and the clay accent go.
   Light: white `#FFFFFF` ground, black `#000000` ink, one grey `#767676`
   (4.5:1 on white) for what is secondary. Dark: the exact inverse. The only
   other color is red for an error, always with its word.
3. **Blunt scale.** Two sizes in the plugin's UI: 13px for everything, and
   one display size, 48px or larger, for the one name that matters on a
   screen (a folder's name on its page, the library's grid names in the
   browse view). Nothing in between.
4. **Structure, not decoration.** Lines appear only where they divide the
   screen's structure (under a header, between a list and its detail), 1px
   black, full width. No frames, no boxes around controls, no rules between
   rows: rows are separated by space.
5. **Plain controls.** Links and text buttons are underlined words.
   Fields are a line under the text. Toggles are Obsidian's own, squared.
   A button that commits something is black with white text, and there is
   at most one per screen.
6. **Left and ragged.** Text is left-aligned and unjustified. The only
   centered thing is a single object alone on its page.
7. **No motion, no shadow, no radius, no blur.** As before.

## What each screen becomes

| Screen | 4.0 | Reset |
| --- | --- | --- |
| Library sidebar | Header with label, search and a three-part zoom; a grid of glyphs | A list of folder names, 13px, the open one inverted; search as the only control |
| Browse view | Toolbar of 7, glyph grid or table | A grid of folder names at 48px (or the user's cover images), one per cell, nothing else; search and more |
| A folder | Big glyph, counts, four icon buttons, numbered ruled list | Its name at 48px, left, then its notes as a plain list; back and more |
| Note head | Folder label, bordered chips, boxed tabs, a line | Folder name as a link, then the title, then properties as one line of plain text, then pages as underlined words, the open one inverted |
| Properties panel | A ruled ledger with group headers and numbered lists | Name and value on a line, name in grey; links and mentions as plain lists; no headers when there is one group |
| Strip | Glyph, title, place, three icons | One line: "21 / 24", previous and next as words |
| Maps | Boxed nodes with tone borders and glyphs | Words on the ground joined by 1px lines; the selected node inverted; user colors only as a small square before the word |
| Sheets and menus | Framed, titled, numbered | Obsidian's own, flattened by the variable map |

## Checks (tests, so it stays reduced)

- **Control budget:** a test renders each screen in the simulation and
  counts focusable elements at rest against the budget above.
- **Colors:** the stylesheet declares exactly black, white, the grey and
  the error red per scheme; any other color value fails.
- **Sizes:** the plugin's UI uses exactly two font sizes.
- **Lines:** no `border` on a control or a row; borders only on the
  structural classes listed in `styles/00-tokens.css`.
- **Icons:** the registered set is at most about 12.
- **Settings:** the settings tab's height at a 900px window fits without
  scrolling.

## Decisions for the owner

- The typeface: a sans (Helvetica, as above) or a raw serif (Times New
  Roman). Both are honest; the sans is closer to the reference.
- The browse view's grid: folder names set large, or the user's cover
  images where set and names elsewhere.
- Whether the note's own text follows the plugin's typeface, or keeps the
  user's font for reading.

Taken in the reset's first run (2026-11-16), with the prompt's blanks left
open: Helvetica; cover images where set and names elsewhere; the note's own
text keeps the person's font. Each is one token or one rule to change.

## Prompt for Claude Code (Fable, high)

```
Read docs/direction-reset.md, then docs/design-corrections.md (sections A
and F still apply; B to E are replaced by the reset). Apply the reset to
Design Redux on main: rewrite the direction and palette in docs/DESIGN.md
and docs/design-language.md, then cut what the reset cuts (zoom levels,
shelves, glyph builder and most glyphs, tones, clay, the label voice,
the extra state cues, numbering, frames and row rules), then rebuild each
screen as the table says, then add the checks. Remove code and styles
rather than hiding them; keep the data contract (no setting key dropped
without its migration, command ids kept). My decisions: <typeface, grid,
note text>. Work section by section, run the touched suites and the full
suite once at the end, re-approve the specimen's screenshots, commit locally
after each section, and do not push. Reply in under 20 lines, including the
control, color, size and icon counts before and after.
```
