# DESIGN.md: Design Redux, the new look

Design Redux changes the whole Obsidian interface to one new look: Obsidian's
own chrome, the editor and reading view, overlays, settings, Canvas, Graph,
and icons, and every surface the plugin draws itself (library, browse
view, album pages, the note page and its page control, the strip, the
properties panel, mind maps). This look replaces the plugin's earlier looks.
The plugin is being rewritten from scratch at the same time: `REWRITE.md`
says how the code is rebuilt, and this file says how everything looks.

Direction: raw, utilitarian, unadorned, and object-led. The reference is the
stark, icon-led storefront design of the Yeezy website: a flat ground, single
objects in a strict grid with large empty space around them, almost no words,
tiny labels, and nothing that is not the thing itself. Here the objects are
folders and notes, drawn as glyphs. Flat earth tones, 1px ink hairlines
instead of surfaces, zero radius, no shadows, no motion. The notes are the
content, and everything around them is deliberately austere.

Take the aesthetic only. No third-party wordmarks, logos, imagery, product
photos or copied layouts.

## The language in detail

These rules are the look. Every screen is judged against them before it is
called done.

1. **Objects, not chrome.** A folder or a note appears as an object: a solid
   glyph on the ground, centered in its grid cell, with nothing around it.
   No cards, panels, frames or backgrounds behind objects. The interface
   around them is a few bare icon buttons, and hairlines only where they
   part one thing from another: one under a header, one between groups,
   never round what already sits in a pane, never between two rows.
2. **The grid is the structure.** An 8px base unit; every position, size
   and gap a multiple of it. Object cells are square and equal. Lists,
   tables and grids snap to the same columns. Empty space is used on purpose
   and is not filled: a screen that looks sparse is right.
3. **Words only where they earn it.** An object's name earns its place: a
   grid of unnamed glyphs can't be read. Each object shows its name under
   it, one line, cut with an ellipsis, and always to screen readers
   (`aria-label`). A setting, "Always show labels" (on by default), leaves
   the names to the pointer, the keyboard and the pick when turned off.
   Lists, tables, the note and anything that is reading show their words
   normally.
4. **Labels are small and quiet.** Plugin-owned labels (object names,
   counts, column headers, section titles) are set small, in capitals, with
   wide tracking, in ink or muted. Reading text (notes, rows, menus) is
   sentence case at normal size. Obsidian's own labels keep their case.
5. **Icons are the controls.** Toolbars and actions are icon buttons, one
   size, one weight, square hit areas, ink on bone; the word is the
   tooltip and the `aria-label`. Text buttons appear only where an icon
   would be unclear (a destructive confirmation, a first-run choice).
6. **One accent, used as a fill.** Clay marks what is selected or open, as
   a flat fill behind an object or a row. Nothing else is colored except the
   user's own semantic colors.
7. **Zoom instead of navigation.** Collections are seen at three levels of
   detail in the same place (objects, shelves, words), switched by a
   three-part control, rather than by opening and closing pages.
8. **Stillness.** Nothing moves. State changes are instant swaps.
9. **Every screen squints well.** Blurred, a screen should read as a few
   objects in a calm grid with one fill marking where you are.

Read `AGENTS.md` first. Its rules still hold; where this file and `AGENTS.md`
seem to disagree, the "Conflicts, resolved" section below decides.

## Scope

In scope, all visual:
- Obsidian: titlebar, ribbon, tabs, sidebars, file explorer, panes and
  splits, view headers, status bar, modals, the settings window, command
  palette, suggesters, menus, popovers, notices, scrollbars, the editor
  (Live Preview, Source, Reading view), note typography and layout, callouts,
  tables, code, embeds and media, Canvas, Graph, icons, and
  the look of other installed plugins.
- Design Redux's own surfaces: the library sidebar, home, browse view (grid,
  rows, the notes table, the preview), album pages, covers, the note page
  (header, chips, page control), the strip, the properties panel and its
  sections, settings rows, mind maps (nodes, links, toolbar, minimap,
  legend), and every menu and modal the plugin opens.

Fixed. Tell the owner if any of these should change:
- the data contract in `REWRITE.md` (what is read from and written to
  notes and `data.json`, and the command ids of kept features)
- no kept feature may be hidden or made unreachable, nor any of Obsidian's
  (search, file operations, sync status, properties, backlinks)
- readability and accessibility must not regress (see guardrails)

## Delivery

The look is built inside the rewrite's phases (`REWRITE.md`, Build order):
the foundation, then Obsidian's regions, then each feature drawn in this look
as it is rebuilt. No old style is carried over: `styles.css` is written new.
Each phase ends with the self-audit below, the tests passing, and a short
change summary.

## Architecture rules

1. **One master switch.** Everything is gated behind `body.dr-active`.
   Without it, the window shows the user's theme exactly as if the plugin's
   look were off. If the plugin already adds a body class for its look, reuse
   or rename that one; do not run two systems side by side.
2. **Every window.** Obsidian opens popout windows and, since 1.13, the
   settings window as separate documents. Apply the same classes to each
   window's `body` when it opens (`window-open`) and remove them when it
   closes or the plugin unloads. Settings code uses
   `containerEl.ownerDocument`, never the main `document`.
3. **Per-region toggles.** Each region has a body class
   `dr-region-<name>`, driven by a setting, so a break in one region can be
   turned off without losing the rest. Regions: `chrome`, `tabs`, `sidebars`,
   `editor`, `overlays`, `library`, `note`, `strip`, `panel`, `canvas`,
   `graph`, `maps`, `icons`, `compat`.
4. **Variables first, selectors second.** Most of the look comes from
   overriding Obsidian's CSS variables on `body.dr-active` (general values)
   and `body.dr-active.theme-light` / `.theme-dark` (colors). Use element
   selectors only for what variables cannot do (layout, ordering, per-element
   states). Keep selectors low in specificity, because Obsidian's class names
   and nesting change between versions.
5. **Verify names against the installed app.** Read `app.css` in Developer
   Tools; never invent a variable or class. List every structural selector on
   Obsidian's DOM in one labeled "selector map" at the top of `styles.css`, so
   breakages are easy to find after an Obsidian update. The plugin's own
   `dr-` classes do not need to be in the map.
6. **CSS does presentation; JavaScript does state.** JS may add and remove
   classes and attributes, read workspace state, and react to events through
   `registerEvent`. It must not move, clone, replace or delete Obsidian's DOM
   nodes, and must not add a body-wide `MutationObserver` (if one is
   unavoidable, scope it to one container and debounce it).
7. **No inline styles, no styles from JS, no `!important`, no
   `<style>`/`<link>` elements.** State is class toggles. Plugin-owned DOM is
   built with `createEl`/`createDiv`, never `innerHTML`. The only exceptions
   are listed under "Conflicts, resolved".
8. **Let users out.** Without `!important`, snippets and Style Settings can
   still override the look. The riskiest changes get their own toggle.
9. **Desktop only.** The plugin is desktop only (`isDesktopOnly: true` in
   `manifest.json`), so there are no mobile rules, no `.is-mobile` blocks
   and no phone layouts to keep. Hover styles stay inside
   `@media (any-hover: hover)`, as `AGENTS.md` says.
10. **Plugin code follows the plugin's patterns.** The switch and region
    classes belong to one `Feature` (its `enable()` safe to call on every
    settings save, its `disable()` removing everything it added). Settings
    go in `DEFAULTS`, in a row of `SETTINGS_TABS`, and the look rows in
    `LOOK_KEYS`.

## Settings and migration

- Keep the existing `look` key. `theme` turns the master switch off (the
  user's theme, untouched); every other value turns it on. Older values
  (`editorial`, `classic` and any other) migrate to the one new look on load,
  so no key is dropped and no saved value is left meaningless.
- Keep `lookScope` (the whole window, or only what the plugin draws) if it
  exists; with "only what the plugin draws", the Obsidian regions stay off and
  the plugin's own regions stay on.
- One new boolean key per region, `lookRegion<Name>`, default on. They sit in
  one settings row whose gear opens them.
- New: `alwaysShowLabels` (off), the library's zoom level per window, and the
  glyph chosen per folder (path-keyed, so it follows renames).
- The `--dr-*` names stay. The old look's token values (radii, shadows,
  glass, motion) are not carried into the new `styles.css`; the palette
  below is the new set.
- The migration of these keys is part of `REWRITE.md`'s settings migration
  and is tested with the owner's real `data.json`.

## Palette tokens

Defined once per color scheme on the gated body, then mapped onto Obsidian's
variables. Components use Obsidian's variables (or these tokens), never hex
values.

```css
body.dr-active {
  --dr-radius: 0;
  --dr-hair: 1px;
}
body.dr-active.theme-light {
  --dr-bg:      #E9E6DF; /* bone: every surface */
  --dr-surface: #CFCCC5; /* ash: hover and pressed fills only */
  --dr-ink:     #1A1A18; /* text and hairlines */
  --dr-muted:   #5E5C57; /* secondary text, ONLY on --dr-bg (5.4:1) */
  --dr-clay:    #A58F7C; /* active and selected fill */
  --dr-on-clay: #1A1A18; /* text on clay (5.7:1) */
}
body.dr-active.theme-dark {
  --dr-bg:      #1C1B19;
  --dr-surface: #2A2927;
  --dr-ink:     #E9E6DF;
  --dr-muted:   #A8A59E; /* 7.0:1 on bg, 5.9:1 on surface */
  --dr-clay:    #A58F7C;
  --dr-on-clay: #1A1A18;
}
```

Rules: one surface color. Sidebars, tabs, ribbon, titlebar, panes, the editor
and every plugin surface are `--dr-bg`, separated by 1px ink hairlines, not
by tone. Ash is a hover or pressed fill only, and text on it is ink, never
muted (muted on ash is 4.2:1 in light mode and fails). Clay is a fill, never a
text color. The contrast ratios in the comments are re-measured by the
contrast script before they ship.

### Semantic colors (the one exception)

Some meaning cannot live in four neutrals: user-assigned colors (Canvas
cards, mind map branches, Graph groups, highlights, album and cover colors),
callout types, tag colors, and error, warning and success. For these only,
define a small earth-tone set (at most 5 hues, flat, no gradients) per color
scheme. A script computes every pair before use: 4.5:1 for text, 3:1 for
fills and borders; the measured ratios go in `styles.css` comments. Semantic
color is never the only carrier of meaning: pair it with a label, shape,
border style or position. Keep the user's colors distinct from each other
rather than collapsing them into one.

## Variable map (starting point; confirm each name in `app.css`)

Inside the gated block:
- backgrounds: `--background-primary`, `--background-secondary` (and
  `-alt`) to `--dr-bg`; `--background-modifier-hover` to `--dr-surface`;
  `--background-modifier-border` and `--divider-color` to `--dr-ink`;
  `--divider-width` to `--dr-hair`
- text: `--text-normal` to `--dr-ink`; `--text-muted` and `--text-faint`
  to `--dr-muted`; `--text-on-accent` to `--dr-on-clay`;
  `--interactive-accent` to `--dr-clay`; link color to `--dr-ink`,
  underlined; error, warning and success from the semantic set
- chrome: titlebar, ribbon, tab container and active tab, nav item hover and
  active, status bar background and text variables to the same tokens
- shape: `--radius-s/m/l/xl`, tab radii, `--clickable-icon-radius`,
  `--input-radius`, `--button-radius`, `--checkbox-radius`, modal, menu and
  callout radius to `0`
- depth: `--shadow-s/m/l` to `none`; the modal backdrop is a flat dim, no
  blur
- writing surface: heading variables (`--h1-*` to `--h6-*`), bold, italic
  and highlight colors, blockquote, code, table, hr, tag, list marker,
  checkbox and callout variables, `--file-line-width`, `--file-margins`
- graph and canvas: the graph and canvas color variables present in
  `app.css`
- icons: color, stroke width and size variables
- the plugin's own tokens (`--dr-*`): radius `0`, no shadow, no glass blur,
  no durations

### Themes

A theme may set its own fonts, radii, blur, list colors, or decoration on
`body::before` and `body::after`. Under `body.dr-active` the plugin
overrides the variables, and switches such body decoration off with a
gated, low-specificity rule. With the switch off, the theme must look
exactly as it does without the plugin.

## Regional spec (the target; audit the code and reconcile, do not blindly add)

### Obsidian chrome
- Titlebar: hidden where the platform setting allows it, otherwise one plain
  line with a bottom hairline.
- Ribbon: flat vertical strip, right-edge hairline, monochrome icons, square
  ash hover fill, no radius or glow.
- Tabs: rectangular, separated by hairlines, no pills. Active tab: clay fill,
  ink text. Pinned and unsaved states shown with text or underline, not
  color alone.
- Sidebars and file explorer: bone background, hairline divider with the
  editor. Rows are plain text, no radius; hover is an ash fill with ink text,
  active is a clay fill with ink text. Indent with `--size-4-*` spacing. Keep
  the collapse chevrons.
- Panes and splits: 1px ink dividers, zero gap, zero radius, no floating
  panes.
- View headers and breadcrumbs: one plain text line, a hairline below.
- Status bar: one text line with a top hairline.

### Writing surface (Live Preview, Source, Reading view)
- Background `--dr-bg`, ink text, left-aligned, no centered layouts or
  page effects. Line length stays readable (roughly 60 to 80 characters), and
  the user can still widen it.
- `em`/`rem` and Obsidian's text-size variable, so the font-size setting
  keeps working. Honor `--font-text`; offer a "use system sans" setting. No
  decorative fonts.
- Headings: the same family, a restrained scale (steps of at most about
  1.25), bold or regular, ink, no colors, no rules or borders.
- Links: ink, underlined. Tags: plain text with a 1px hairline, no pill fill.
- Blockquote: a left hairline, no tint. Horizontal rule: 1px ink.
- Lists and tasks: native markers, square checkboxes, the checked state shown
  by fill and mark. The plugin's lettered and roman lists follow the same
  markers.
- Tables: 1px ink grid, no zebra tint, bold header.
- Code: square, hairline border, bone or ash fill, monospace. Syntax
  highlighting loses hue, so token types differ by weight, italics,
  underline and the semantic set; check that code stays legible and flag any
  tradeoff.
- Callouts: square, 1px ink border, no tint, no icon fill; the type shows in
  its title text, with a semantic accent where useful.
- Embeds and media: square corners, hairline border, no shadow, no filters,
  native size.
- Properties: plain key and value rows with hairlines. The plugin's
  footnote box and scripts follow the same rules.

### Overlays and settings
- Modals, command palette, suggesters, menus, popovers, notices: square, 1px
  ink border, bone fill, no shadow, no blur. The selected item is a clay fill
  with ink text. This covers every menu and modal the plugin opens.
- Controls (buttons, inputs, selects, toggles, checkboxes, sliders): native
  elements restyled through variables, square, 1px ink border. A toggle's
  on-state is clay. No custom-built controls.
- Settings window: the same rules, its structure kept, including the
  plugin's tabs, feature rows and gears.
- Scrollbars: thin, square, ink thumb on a bone track.

### Design Redux surfaces
- **Library sidebar: three zoom levels in one place.** A header row with the
  word "Library" as a small label, a search icon, and a three-part zoom
  control (objects, shelves, words).
  - *Objects:* folders as glyphs in a three-column grid of square cells,
    each named under its glyph on one line; the picked folder shows its
    count too. Opening a folder fills the sidebar with its own grid of
    subfolders and notes, with a back icon and the folder's label.
  - *Shelves:* each folder a row: its label and count above, and its notes
    as vertical bars standing on a hairline, one per note, bar height from
    the note's length, the open note in ink and the rest muted.
  - *Words:* a plain outline: folder labels as small capitals, notes as
    numbered sentence-case rows, the open note's pages or headings indented
    under it, other folders collapsed to one line each.
  - The level, the open folder and the scroll position are kept per window.
- **Folder glyphs (covers).** Every folder gets a solid glyph: one the user
  picked from the plugin's glyph set, or, by default, the one its name asks
  for (Music, a tune) or else one generated from its path (see Icons, the
  glyph builder). A user's own cover image is shown
  instead when set: native aspect, square corners, no filter, as an object
  on the ground with nothing around it. The old generated cover art is not
  used.
- **A folder picked (detail).** The glyph large and centered with wide space
  around it, the name and counts as small capitals under it, a row of
  icon buttons (open, new note, pin, more), a hairline, then its notes as a
  list with no lines between rows, numbered only in the folder's own order.
  The open note is a clay fill.
- **Home and browse view:** the same object grid at window width, more
  columns, the same zoom control; the notes table has one line under its
  header and none between columns or rows, columns as wide as their
  content, the sort mark beside the column's name, and a number column only
  in the folder's own order. The preview is the folder-picked layout.
- **Note page:** in the note's own column, wherever it is laid out (the
  editor, reading view), so it scrolls with the text: the folder as a label
  over the title; under the title (and under Obsidian's own properties, when
  they are shown) the properties, the page tabs and a 1px ink line exactly as
  wide as the text. The order is folder, title, properties, pages, text. The page
  control is a row of small-capital text tabs separated by hairlines; the
  open page is a clay fill with ink text.
- **Strip:** a full-width bar at the foot of the note with a top hairline,
  not a floating capsule: the folder glyph small, the title and place in the
  collection as text, previous, next and more as icon buttons. It never
  covers text and needs no hover to show its actions.
- **Properties panel:** a specification sheet: a faint capital name, its
  value beside it; no rules between its parts, no head repeating the note's
  name, no arrows or fold buttons on its titles (a press on a group's title
  folds it); mentions and links as plain rows without numbers.
- **Mind maps:** nodes square with a 1px ink border on bone, links as plain
  ink lines, the selected node a clay fill; user branch colors kept as
  semantic colors; toolbar, minimap and legend follow the overlay rules and
  use the plugin's icons.
- **Settings:** each feature a row with its glyph, name, switch and a gear;
  small-capital section labels; nothing else.

### Canvas
- Cards: square, 1px ink border, no shadow, bone fill; edges are plain ink
  lines; the toolbar and popups follow the overlay rules. Card colors are
  kept as semantic colors.

### Graph
- Monochrome: ink nodes and hairline links, the current node in clay, labels
  in ink on bone, no glow. Group colors kept as semantic colors, distinct
  from each other and from ink. The graph is drawn by Obsidian's renderer:
  use only the supported graph variables, and confirm what is stylable in
  `app.css` before promising a look. The plugin's graph filter keeps working.

### Icons
Two families, kept apart:
1. **Obsidian's own icons** are restyled only: one color (ink), one stroke
   width and size, through variables and gated selectors. Never depend on the
   inner markup of an icon's SVG.
2. **The plugin's own icon set**, drawn for this look and registered with
   Obsidian's supported API (`addIcon`, checked against the current
   developer docs), used for every control and object the plugin draws:
   - one 24-unit grid, solid shapes (not outlines), one optical weight, no
     detail smaller than 2 units, every glyph legible at 16px and 48px;
   - at least 60 glyphs: every action the plugin has (open, back, search,
     zoom levels, new note, new folder, pin, more, sort, filter, move, delete,
     undo, pages, properties, map tools and the rest found in the inventory)
     and a set of at least 40 object glyphs for folders (things: everyday
     objects, tools, plants and animals, a few cut forms), all drawn to the
     same rules. An object glyph is never a form that reads as an action or
     a sign (an X, a plus, a lock, a hash, a box in a box, a plain square,
     disc, diamond, star, heart, bell, flag, pin, arrow, cloud, camera), and
     its outline is never close to an action glyph's;
   - **the glyph builder:** a pure function in `core` that gives each folder
     the glyph its name asks for where the set has one (a folder named Music,
     a tune), and otherwise one hashed from its path (stable across sessions and
     machines, unchanged when the folder's contents change, kept through
     renames because it is stored once chosen), spreading neighbours across
     visibly different glyphs; the user can pick another from a grid of the
     set;
   - a specimen page (`docs/specimen.html`, built by a script from the same
     SVG sources) showing every glyph at 16, 24 and 48px in light and dark,
     every component in every state, and the three library zoom levels with
     sample data. It is the visual reference for the owner and the source of
     the screenshot tests.
Every icon-only control keeps an `aria-label` (`asButton(el, label)` in the
plugin).

### Other plugins
- Most plugins inherit Obsidian's variables and get the look for free. A
  plugin with its own DOM gets an optional block behind
  `dr-compat-<plugin-id>` and its own setting, starting with the plugins the
  owner uses.
- Never restyle another plugin with `!important`, and never touch its data.

## Typography summary
- Chrome text uses `--font-interface` at `--font-ui-small` or
  `--font-ui-smaller`; note text uses `--font-text`; code uses
  `--font-monospace`.
- Two voices only. Labels: plugin-owned, small, capitals, tracking about
  0.08em. Reading: sentence case, normal size, tracking 0.
- At most one larger size per region, used for a title. No bold except to
  mark what is open or a table header. No italics outside the note's own
  text. Obsidian's own labels keep their `text-transform` (changing it
  breaks translated UI).

## Motion
- None. `transition: none` and no animations inside the gated body,
  including the plugin's own (page switching, strip, sheets, map moves),
  and `prefers-reduced-motion` honored for anything left.

## Conflicts, resolved
Where `AGENTS.md`, the plugin's code and this file disagree:
1. `AGENTS.md` says hiding the note's properties block needs `!important`.
   This look hides nothing native, so no `!important` is needed. If a hide
   turns out unavoidable, it goes in one labeled exception block, at most a
   handful of rules, each with a comment saying why, and the self-audit test
   allows exactly that block.
2. Mind maps and Canvas need computed geometry (positions, sizes, zoom).
   Plugin-owned elements may receive it as CSS custom properties set from JS
   (`el.style.setProperty('--x', …)`), never as colors or other style. No
   style is ever set on Obsidian's own nodes.
3. Earlier plans (the Apple redesign, the pages doc's look sections) are
   superseded. The zoomable, icon-led sidebar is adopted and specified here.
   Pages in a note and settings rows with gears are built if the owner keeps
   those features in the inventory.

## Accessibility and compatibility guardrails
- Every control is keyboard operable, with a visible focus ring:
  `:focus-visible { outline: 2px solid var(--dr-ink); outline-offset: 2px; }`
- Text 4.5:1 or better, hairlines and focus rings 3:1 or better; semantic
  colors measured by script and recorded.
- State never relies on color alone (selected, unsaved, pinned, error, link,
  the open note, the open page).
- Checked by eye once, at cutover, by the owner in their own vault: light
  and dark, the owner's theme on and off, the three
  editor modes, the settings window. Everything else rests on the automated
  tests.

## Tests
- `tests/test_design.js` (new, simulation): runs the self-audit below on
  `styles.css` and the plugin's source where it can be checked mechanically
  (ungated rules, hex outside token blocks, `!important`, non-zero radius,
  shadows, gradients, blur, `innerHTML`, inline style outside the allowed
  geometry properties), and checks that enabling then disabling the look
  leaves no class, attribute or listener behind, in the main window and in a
  second document.
- `tests/contrast.js` (new): computes every token and semantic pair and
  fails below the guardrails; its output is what goes in the comments.
- `tests/test_glyphs.js` (new): every SVG in the set parses, sits on the
  24-unit grid and uses only allowed elements; the glyph builder is
  deterministic, spreads 1,000 sample paths across the set without visible
  clustering, and keeps a stored choice through a rename.
- Screenshot tests of `docs/specimen.html` in light and dark with Playwright
  (Chromium), compared against approved images, so a change to the look is
  seen before it ships.
- The lifecycle test: every kept command id present, and every old setting
  key either read by the new code or handled by the migration.
- Real-Obsidian tests (`tests/obsidian/`) only for what jsdom cannot show:
  that the variables apply in the real app, the settings window and a popout
  window get the classes, and nothing is left after unloading.

## Deliverables
- `docs/design-language.md`, written before any screen is built: the grid,
  the type voices with sizes, the full component inventory with every state
  (rest, hover, focus, selected, open, disabled, empty, loading, error), the
  icon grammar, the glyph builder's rules, and how each rule above maps to
  tokens and classes. Screens are built from it, and it is updated when a
  screen teaches something new.
- The plugin icon set as SVG sources, the glyph builder with its tests, and
  `docs/specimen.html`.
- Per session, a few lines: what changed, any readability tradeoff, any
  risky selector, and any rule of the language a screen could not keep.

## Self-audit (the phase fails if any is true)
- a rule not gated by `body.dr-active` (and its region class)
- unloading the plugin leaves classes, attributes, listeners, icons or styles
  behind, in any window
- a hex color outside the token and semantic blocks, any `!important`
  outside the labeled exception block, any inline style beyond the allowed
  geometry properties, any `innerHTML`
- JS that moves, replaces or removes Obsidian's DOM nodes
- an invented variable or class name that is not in the installed `app.css`
- a border-radius other than 0, any box-shadow, gradient or blur
- muted text on `--dr-surface`, or clay used as a text color
- meaning carried by color alone; an unmeasured semantic color
- a feature hidden or unreachable
- a readability regression: line length, code legibility, link visibility,
  focus visibility, or the font-size setting no longer working
- a break in `REWRITE.md`'s data contract
- a style copied over from the old `styles.css` instead of written to this
  file
- an object grid that shows labels at rest when "Always show labels" is off,
  or an object whose name is not available on focus and to screen readers
- a size, position or gap off the 8px grid in plugin-owned UI
- a plugin control drawn with an Obsidian icon where the plugin's set has one,
  or a glyph that breaks the icon grammar
- the glyph builder giving a folder a different glyph on another run or
  machine
