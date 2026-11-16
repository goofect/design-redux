# Design corrections for 4.0 (the rewrite)

Reviewed on `main` at the rewrite merge (`f3bdda1`), from the specimen's
approved screenshots (`tests/screenshots/`) and the source. Each item says
what is wrong, the correction, and how to check it. Where a correction
changes a rule, update `docs/DESIGN.md` and `docs/design-language.md` and
the specimen in the same change.

The overall diagnosis: the rewrite read "hairlines instead of surfaces" as
"a hairline around everything". Every panel has a frame, every row a rule,
every control a box, every label is capitals. The result is a dense ledger.
The direction asked for the opposite: a few objects, a lot of empty ground,
and lines only where they separate something.

## A. Broken (fix first)

1. **The note's title sits under the band.** The head band (folder, chips,
   pages, line) is inserted at the top of the view's `contentEl`, above the
   scroller, so in Obsidian it sits above the inline title and doesn't
   scroll with the note.
   *Fix:* put the band inside the note's sizer, right after the inline title,
   in both editing and reading view (as legacy `140-note-page.js` did with
   `places(view)`), so the order is folder, title, properties, pages, then
   text, and all of it scrolls with the note.
   *Check:* a real-Obsidian spec asserts that the inline title comes before
   the band in both views and that the band scrolls away with the text.
2. **The objects level can't be read.** Folders show as unlabeled glyphs
   picked at random (a flag, a cat, a factory, a lock), so nobody can tell
   which folder is which without hovering each one.
   *Fix:* labels show under every object by default (`alwaysShowLabels`
   on), one line, cut with an ellipsis; turning it off stays possible. The
   glyph builder first tries a meaningful match (a folder named after
   something the set has a glyph for), and only falls back to the hashed
   pick.
   *Check:* the library suite asserts that labels show at rest by default.
3. **Object glyphs look like actions.** An X (reads as close), a lock (reads
   as locked), a cross (reads as add), a square in a square (reads as stop
   or a checkbox) and a hash are in the object set. On a map, "Thesis" has an
   X beside it.
   *Fix:* remove every object glyph that resembles an action glyph or a
   common UI sign, and redraw replacements.
   *Check:* `test_glyphs.js` gains a list of forbidden object forms, and a
   check that no object glyph's outline is close to any action glyph's.
4. **The page tabs cut a word in half.** "EXERCISE" is clipped
   mid-letter when tabs overflow.
   *Fix:* overflowing tabs scroll with a fade or ellipsis at the edge, never
   clip a glyph.

## B. Too many boxes and rules

5. **Frames everywhere.** The sidebar, panel, browse view, sheets and maps
   each draw a frame, then a header band with a rule, then a rule under every
   row.
   *Fix:* no frame on anything that already sits in an Obsidian pane; one
   hairline under a header; rows separated by space on the 8px grid, not by
   rules; a hairline only between groups. Tables keep horizontal rules.
   *Check:* the specimen's lists, panel and sidebar show no rule between two
   rows of the same group.
6. **Every control is boxed.** The zoom control is three bordered cells, the
   active one clay with a border; tabs, chips, icon buttons in their on
   state are all boxed.
   *Fix:* the zoom control is three bare icons, the active one on a clay
   square with no border. Tabs are bare words, the open one on a clay fill.
   Icon buttons have no border in any state but focus.
7. **Properties became bordered chips.** Each property is a box with a
   capital key, and a value's tone colors the whole border. On `main` before
   the rewrite (3.1.85 to 3.1.88) they already ran in a line as name and
   value, which was right.
   *Fix:* bring that back: properties under the title as one line of
   `name value · name value`, the name muted, no borders; a value a schema
   finds wrong shown in its tone with the warning glyph beside it.
8. **The panel is a ledger.** A frame, the note's name again at the top, a
   rule under every row, group headers with square minus buttons, numbered
   mentions and links with capital folder names at the right.
   *Fix:* the specification sheet that `main` reached in 3.1.85 to 3.1.87: a
   faint capital label with its value beside it, no rules between parts, no
   arrows or folding buttons on headings, no repeat of the note's name.
   Mentions and links as plain rows without numbers.
9. **The browse table is a full grid.** Vertical lines between every
   column, a number column, a huge name column with the sort mark far to its
   right.
   *Fix:* horizontal hairlines only (under the header, between groups); no
   number column unless the folder has a set order; the sort mark beside the
   column's name; columns as wide as their content.

## C. Too many words in capitals, numbers and labels

10. **Capitals everywhere.** Section titles, field labels, column headers,
    folder names at the end of rows, counts and the specimen captions all use
    the label voice, so nothing stands out.
    *Fix:* capitals only for section titles and a property's name. Field
    labels go when the placeholder says the same ("FIND" above "Notes and
    folders"). Folder names at the end of rows show only when a list mixes
    folders, in muted sentence case.
11. **Numbers on every list.** Search results, mentions, links, rules and the
    panel are numbered 01, 02 and so on.
    *Fix:* numbers only where order means something: a folder's notes in its
    set order.
12. **Two markers for one state.** A row can be clay, have an ink square,
    and be bold, and headings under the open note get their own squares.
    *Fix:* one sign per state: the open note is a clay fill and bold; what is
    selected but not open is an ink square at the left. Headings under the
    open note are muted rows with no marker.

## D. Controls and their states

13. **Too many state cues.** Hover is ash, pressed is ash plus an inner line,
    focus a ring, on is clay plus a foot bar, disabled is dashed, loading is
    an hourglass.
    *Fix:* hover ash, pressed a darker ash, focus the ring, on clay, disabled
    muted text with no border. Drop the inner line, the foot bar and dashed
    lines (dashes read as a drop target or a placeholder). Loading shows the
    word ("Moving…") in muted text.
14. **The toggle is a tiny rectangle.** It is about 32 by 14 px, and which
    side is "on" isn't obvious.
    *Fix:* square-cornered, 40 by 20 px, an ink knob, the on side filled
    clay, with the setting's words beside it saying what it does.
15. **Unlabeled actions in the folder detail.** Four icons (arrow, file
    with a plus, pin, more) under the big glyph mean nothing without
    hovering.
    *Fix:* here words earn their place: "Open", "New note", "Pin" as text
    buttons, with more as the icon.
16. **The browse view's toolbar is crowded.** Search, sort, filter, three
    zoom icons, new note and more, all at once.
    *Fix:* at most four visible (search, filter, zoom control, more); sort
    and new note go into more.

## E. Individual screens

17. **Shelves don't tell you anything.** Bars without names, wrapping onto a
    second row, the open note's bar barely different.
    *Fix:* one row per folder, no wrap ("+12" at the end when it doesn't
    fit); the bar under the pointer or focus names its note below the shelf;
    the open note's bar in clay.
18. **The words level mixes notes and headings.** The open note's headings
    sit among the notes at the same weight.
    *Fix:* headings only under the open note, indented one step, muted,
    smaller, no markers.
19. **Map nodes.** A folder's tone colors the node's whole border, so it
    reads as focus; the selected node has a double border and clay; each node
    has a tiny glyph that adds noise.
    *Fix:* every node a 1px ink border; the tone as a small square at the
    left; selection is the clay fill only; glyphs only on folder nodes.
20. **Sheets read like a developer tool.** "folder Logic -> status=draft",
    numbered rules, ON and OFF as words.
    *Fix:* a rule is written as a sentence with fields ("When a note comes
    into [folder], set [property] to [value]"); each rule has a toggle; no
    numbers.
21. **The note's line under the head is out of line.** It starts left of
    the text column.
    *Fix:* it spans exactly the text column.

## F. Outside the design

22. **4.0.0 was not released.** The `Release 4.0.0` commit carries
    `Release-As: 4.0.0`, but the workflow released `3.1.89`. It probably
    reads the trailer only when it is the last line, and here it is followed
    by `Co-Authored-By`. Check the workflow's pattern, fix it, and release
    4.0.0 with the trailer where the workflow finds it. Until then, BRAT
    shows the rewrite as 3.1.89.

## Prompt for Claude Code

```
Apply docs/design-corrections.md to Design Redux (main). Work through it
in order, A first. For each item: update docs/DESIGN.md and
docs/design-language.md where a rule changes, change the styles and code,
update the specimen and re-approve its screenshots, and add the check the
item names. Keep the token rules of AGENTS.md: narrow reads, short output,
the touched suites while working and the full suite once at the end.
Commit locally after each section (A to F). Do not push until I say.
Reply in under 20 lines: what changed per section, test results, and any
item you could not do as written.
```
