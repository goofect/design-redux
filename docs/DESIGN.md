# DESIGN.md: Design Redux, the new look

Design Redux changes the whole Obsidian interface to one new look: Obsidian's
own chrome, the editor and reading view, overlays, settings, Canvas, Graph,
and icons, and every surface the plugin draws itself (library, browse
view, album pages, the note page and its page control, the strip, the
properties panel, mind maps). This look replaces the plugin's earlier looks.
The plugin is being rewritten from scratch at the same time: `REWRITE.md`
says how the code is rebuilt, and this file says how everything looks.

Direction: reduction and brutalism (`docs/direction-reset.md`). Reduction
removes until a screen breaks, then puts one thing back; brutalism shows the
raw material and doesn't apologise for it: one system typeface used as it
comes, black, white and one grey, two sizes, lines only where the structure
divides, plain underlined words for controls. The notes are the content;
everything around them is as little as can still work.

Take nothing of another's: no wordmarks, logos, imagery or copied layouts.

## The language in detail

These rules are the look. Every screen is judged against them before it is
called done; the checks in `docs/direction-reset.md` hold the countable ones.

**Reduction**
1. **One job per screen.** The library lists folders. A folder shows its
   notes. A note shows its text. Nothing else lives on those screens.
2. **A budget of visible controls**, counted at rest by a test: the library
   sidebar 1 (search), a folder 2 (back, more), a note 0 (everything else is
   in Obsidian's own menus and the command palette), the browse view 2
   (search, more), a sheet its fields and one button. Links that go
   somewhere (a folder's name, a note's, a page's) are content, not controls.
3. **One view of a collection.** No zoom levels, no shelves, no grid, no
   covers: the sidebar is the folders as a tree, a folder's page its notes
   as one ruled list (its subfolders only in the tree).
4. **No ornament that carries no information.** No generated glyphs (a
   folder is its name), no counts, no row numbers, no group header that repeats its rows, no
   section title where there is one section.
5. **One way to show each state.** Hover: an underline. Focus: a 2px black
   outline. Selected or open: filled light grey, the words as they were.
   Disabled: grey words. Nothing else.
6. **Fewer settings.** The settings tab is the features' switches and fits
   one screen. Everything else is a fixed value (or, in a vault that had set
   it, the value it had).
7. **Fewer icons.** About ten (search, back, close, more, add, the map's
   tools); everything else is a word.

**Brutalism**
1. **Raw material.** One typeface for all the plugin draws, the system's
   monospace as it comes (`ui-monospace, SF Mono, Menlo, …`), like an
   inventory sheet. No tracking, no capitals for effect.
2. **Black, white, greys.** Light: white ground, black ink, grey `#595959`
   for what is secondary, a light rule `#D4D4D4` between rows, a lighter
   fill `#E5E5E5` for what is open or picked; dark: the inverse. The only
   other colour is red, for an error, always with its word.
3. **One small size.** 13px for everything. The name that matters (a pane's
   head) is bold, never bigger.
4. **Structure, not decoration.** Each pane is framed by a 1px ink line, its
   head ruled off under it; rows are ruled like a stock list; the path is
   boxed words. Nothing else has a line.
5. **Plain controls.** Links and text buttons are underlined words; a field
   is a line under its text; a toggle is Obsidian's own, squared; the one
   button that commits is black with white words, one a screen at most.
6. **Left and ragged.** Left-aligned, unjustified; only a single object
   alone on its page is centred.
7. **No motion, no shadow, no radius, no blur.**

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
- Retired by the reset (settings 102, values kept under `retired`):
  `alwaysShowLabels`, the library's zoom level, the glyph chosen per folder,
  the table's columns, the regions' switches; see `src/core/migrate.js`.
- The `--dr-*` names stay. The old look's token values (radii, shadows,
  glass, motion) are not carried into the new `styles.css`; the palette
  below is the new set.
- The migration of these keys is part of `REWRITE.md`'s settings migration
  and is tested with the owner's real `data.json`.

## Palette tokens

Defined once per colour scheme on the gated body, then mapped onto
Obsidian's variables. Components use these tokens, never colour values.

```css
body.dr-active.theme-light {
  --dr-bg:    #FFFFFF; /* the ground */
  --dr-ink:   #000000; /* words, frames */
  --dr-muted: #595959; /* secondary words (7.00:1; 5.56:1 on the fill) */
  --dr-rule:  #D4D4D4; /* the rule between rows, under a head */
  --dr-fill:  #E5E5E5; /* open or picked */
  --dr-error: #C00000; /* an error, always with its word */
}
body.dr-active.theme-dark {
  --dr-bg:    #000000; /* the exact inverse */
  --dr-ink:   #FFFFFF;
  --dr-muted: #A0A0A0;
  --dr-rule:  #333333;
  --dr-fill:  #262626;
  --dr-error: #FF5C5C;
}
```

Rules: one surface colour. Panes are the ground, parted by 1px black lines
where the structure divides, not by tone. Selected or open is the ink as a
fill with the ground's colour for its words. The grey is for words only. The
person's own colours (Canvas cards, graph groups, a folder's colour on a
map) are not the plugin's: they stay the theme's, through Obsidian's own
colour names, and the plugin declares none of them.

## Variable map (starting point; confirm each name in `app.css`)

Inside the gated block:
- backgrounds: `--background-primary`, `--background-secondary` (and
  `-alt`) and `--background-modifier-hover` to `--dr-bg` (hover is an
  underline, not a fill); `--background-modifier-border` and
  `--divider-color` to `--dr-ink`; `--divider-width` to `--dr-hair`
- text: `--text-normal` to `--dr-ink`; `--text-muted` and `--text-faint`
  to `--dr-muted`; `--interactive-accent` to `--dr-ink` and
  `--text-on-accent` to `--dr-bg` (what is selected is inverted); link
  color to `--dr-ink`, underlined; error to `--dr-error`. The person's own
  colours (`--color-red` and the rest) are left to the theme
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
- Ribbon: flat vertical strip, right-edge line, monochrome icons, no fill
  under the pointer, no radius or glow.
- Tabs: rectangular, no pills. Active tab: inverted. Pinned and unsaved
  states shown with text or underline, not color alone.
- Sidebars and file explorer: the ground, a line dividing them from the
  editor. Rows are plain text, no radius; the active one inverted. Indent
  with `--size-4-*` spacing. Keep the collapse chevrons.
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
- Code: square, a 1px line, the ground, monospace. Syntax highlighting is
  ink and grey; check that code stays legible and flag any tradeoff.
- Callouts: square, 1px ink border, no tint, no icon fill; the type shows in
  its title text.
- Embeds and media: square corners, hairline border, no shadow, no filters,
  native size.
- Properties: plain key and value rows with hairlines. The plugin's
  footnote box and scripts follow the same rules.

### Overlays and settings
- Modals, command palette, suggesters, menus, popovers, notices: square, 1px
  black line, the ground, no shadow, no blur. The selected item inverted.
  This covers every menu and modal the plugin opens.
- Controls (buttons, inputs, selects, toggles, checkboxes, sliders): native
  elements restyled through variables, square. A toggle's on-state is black.
  No custom-built controls.
- Settings window: the same rules; the plugin's tab is its features'
  switches in two columns and fits one screen.
- Scrollbars: thin, square, an ink thumb on the ground.

### Design Redux surfaces
- **Library sidebar:** a framed pane headed "Library" (bold), the vault's
  folders as a tree: a chevron where a folder holds folders, then its name;
  the open folder filled light grey. No notes, no controls; search is a
  command. A folder's name pressed shows it in the page.
- **A folder, in the page:** a framed pane headed by its name (bold), the
  path to it as boxed words (Vault / Politics), then only the notes directly
  in it, as ruled rows. Its subfolders are in the tree, not here. The
  vault's top is the same page, headed Vault. No buttons at rest.
- **Note head:** in the note's column, scrolling with it: the folder's name
  as a link, the title, the properties as one line of plain text (name grey,
  value ink), the pages as underlined words, the open one inverted, a line
  under it all. No control.
- **Strip:** one line at the note's foot: "21 / 24", and Previous and Next
  as underlined words.
- **Properties panel:** name and value on a line, the name grey; where it
  is named, mentioned and what it links to as plain lists; a header only
  where there is more than one group.
- **Maps:** words on the ground joined by 1px lines; the picked node
  inverted; a folder's colour only as a small square before its word.
- **Sheets and menus:** Obsidian's own, flattened by the variable map; a
  sheet's fields are a line under their text, its one committing button
  black.
- **Settings:** the features' switches, two columns, no descriptions, no
  gears; it fits one screen.

### Canvas
- Cards: square, 1px ink line, no shadow, the ground; edges are plain ink
  lines; the toolbar and popups follow the overlay rules. Card colors are
  the person's, left to the theme.

### Graph
- Monochrome: ink nodes and hairline links, the current node larger, labels
  in ink on the ground, no glow. Group colors are the person's, left to the
  theme. The graph is drawn by Obsidian's renderer:
  use only the supported graph variables, and confirm what is stylable in
  `app.css` before promising a look. The plugin's graph filter keeps working.

### Icons
Two families, kept apart:
1. **Obsidian's own icons** are restyled only: one colour (ink), one stroke
   width and size, through variables and gated selectors.
2. **The plugin's own set**, about ten glyphs (search, back, close, more,
   add, and the map's tools: fold, unfold, fit, zoom out), drawn to the icon
   grammar (`docs/design-language.md`) and registered with `addIcon`. There
   are no object glyphs and no glyph builder: a folder is its name.
   Everything else is a word.
Every icon-only control keeps an `aria-label` (`asButton(el, label)`).

### Other plugins
- Most plugins inherit Obsidian's variables and get the look for free. A
  plugin with its own DOM gets an optional block behind
  `dr-compat-<plugin-id>` and its own setting, starting with the plugins the
  owner uses.
- Never restyle another plugin with `!important`, and never touch its data.

## Typography summary
- Everything the plugin draws: the system's monospace (`--dr-font`), at
  13px (`--dr-size`). No second size.
- No tracking, no capitals for effect, no italics; bold for a pane's head
  and where the note's own text has it. Obsidian's own labels keep their case.
- The note's own text keeps the person's font (`--font-text`); code keeps
  `--font-monospace`.

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
   superseded, and so is 4.0's zoomable, icon-led sidebar: the reset makes it a list of names.
   Pages in a note and settings rows with gears are built if the owner keeps
   those features in the inventory.

## Accessibility and compatibility guardrails
- Every control is keyboard operable, with a visible focus ring:
  `:focus-visible { outline: 2px solid var(--dr-ink); outline-offset: 2px; }`
- Text 4.5:1 or better, lines and focus rings 3:1 or better; the error red
  measured by script and recorded.
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
- `tests/contrast.js`: computes every token pair (ink, grey and red on the
  ground, the ground on ink) and fails below 4.5; its output is what goes in
  the comments.
- `tests/test_glyphs.js`: every SVG in the set parses, sits on the 24-unit
  grid and uses only allowed elements, and the set stays at about ten.
- `tests/test_reset.js`: the reset's checks: the controls on each screen at
  rest within its budget, exactly four colours a scheme, exactly two font
  sizes, no border on a control or a row (borders only on the structural
  classes listed in `styles/00-tokens.css`), at most twelve icons, and a
  settings tab that fits a 900px window without scrolling.
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
  icon grammar, and how each rule above maps to
  tokens and classes. Screens are built from it, and it is updated when a
  screen teaches something new.
- The plugin's few icons as SVG sources, and `docs/specimen.html`.
- Per session, a few lines: what changed, any readability tradeoff, any
  risky selector, and any rule of the language a screen could not keep.

## Self-audit (the phase fails if any is true)
- a rule not gated by `body.dr-active` (and its region class)
- unloading the plugin leaves classes, attributes, listeners, icons or styles
  behind, in any window
- a colour value outside the token blocks, any `!important`, any inline
  style beyond the allowed geometry properties, any `innerHTML`
- JS that moves, replaces or removes Obsidian's DOM nodes
- an invented variable or class name that is not in the installed `app.css`
- a border-radius other than 0, any box-shadow, gradient or blur
- a colour beyond black, white, the grey and the error's red; meaning
  carried by colour alone
- a third font size, a second typeface, tracking, or capitals for effect
- a control over its screen's budget, or a second committing button
- a border on a control or a row; a line that divides nothing
- more than twelve icons; an icon where a word would do
- a settings tab that scrolls
- a feature hidden or unreachable; a break in `REWRITE.md`'s data contract
- a readability regression: line length, link visibility, focus visibility,
  or the font-size setting no longer working
