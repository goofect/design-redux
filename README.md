# Design Redux

An Obsidian plugin that browses a vault the way a music app browses a
library: folders open as albums with cover art, properties behave like
artists, and everything is reached from one sidebar and a back button.

It also tidies the chrome — the ribbon, the file explorer's buttons and
the settings gear collapse into a single menu in the tab header, and a
note's properties move into a dropdown beside its title.

## The screens

**Library** (left sidebar) is a list of places you choose, grouped under
your own headings. Everything it points at opens in the main area. It's
drawn as a floating panel with the vault at its foot, one row marks
where you are — the screen, the folder, or the folder a note sits in —
folders with covers show them as artwork, and Pinned is a group:
clicking it opens or closes your pins in place (so do the right and left
arrow keys). The Pinned screen is reached from its heading on Home. Right-click a folder there —
or anywhere else it appears — for New note and New folder alongside its
other actions. On a phone or tablet, hold it instead.

**Home** gathers the note you've set as home, what you've opened lately,
what's pinned, and your folders — each heading opening the whole of
whatever it shows.

**Search** looks through note names and property values as you type,
with the terms you've used lately and a set of category tiles built from
one property's values. A search is remembered once it's finished —
Enter, opening a result, or leaving the screen with something typed —
not letter by letter. Note bodies are handed to Obsidian's own search,
which the results header opens.

**Folder** shows a folder as an album: cover art, a title block, and its
notes as a numbered list. Subfolders appear as discs, the way a
multi-disc album does, and on desktop a note can be dragged between them
to move it on disk. A folder holding nothing but folders shows tiles
instead.

Drag a note onto another in its own disc and it goes there: the album
now has its own order, as a playlist keeps the order you drag its songs
into. That order is **Album order** on the album's filter button, where
choosing A–Z or a date instead keeps it to come back to. It follows
notes renamed, moved out or deleted, and new notes join the end. (While
Find or a filter is narrowing the list, dragging doesn't arrange it,
since not everything is showing.)

**Edit** on an album turns it into the place to change it:

- the album's name and each note's name become fields — Enter or
  clicking away renames the file where it is, links and all, and
  Escape puts the name back;
- each subfolder's heading can be renamed or deleted, and empty
  subfolders show too, so they can be named or filled;
- every note has a handle to drag it into order — with a finger on a
  phone or tablet as well — or Alt+↑ and Alt+↓ from the keyboard;
- a note can be moved to another folder, or deleted — with Obsidian's
  own confirmation and trash setting;
- **New note** adds one with its name ready to type, rather than
  opening it; **New folder** adds a disc; the button on the artwork
  sets or changes the cover.

**Done**, Escape, or leaving the page ends editing.

**Folders** is every folder in the vault as cover tiles.

**Properties** lists your properties on the left and the selected one's
values on the right, each holding the notes that carry it.

**Notes** is every note as a sortable table, with columns you choose.

**Recently opened** and **Pinned** are tiles. Pins are Obsidian
bookmarks, so they appear in its own bookmarks pane too. A bookmark to
a heading or block inside a note is to that part, so it doesn't make
the note pinned, and unpinning the note leaves it alone.

Pins can be put in your own order: drag the tiles on the Pinned screen
(desktop), use **Move earlier** and **Move later** in a pin's menu, or
Alt+← and Alt+→ on a tile. Folders and notes mix once arranged, and the
sidebar's Pinned group and Home follow the same order.

## Cover images

Covers come from a property on the note — the same one a Bases card
view reads, so setting one here sets it there. Commands exist to choose
an image, take the first image already in a note, or repair a link that
was typed as a bare filename.

A folder's cover lives on its folder note, so it travels with the vault.
Right-click a folder anywhere in the browse view to set one. An image
named `cover` inside a folder works as a fallback.

Anything without a cover gets one made for it: a gradient with its
initials, the way a playlist without artwork does. By default the
colour is chosen by its name, so the same name always gets the same
colours. **Generated cover colour** under Covers and images can make
them all your theme's accent colour, or one colour of your choosing,
instead; **Generated covers** there turns them off.

One album or note can have a colour of its own: right-click it and
choose **Cover colour…**, press the palette button on its cover in Edit
mode, or use the Set cover colour command. Pick a swatch, the accent
colour, or any colour at all, and see the cover change as you choose;
**Automatic** puts it back. The colour stays with it when it's renamed
or moved.

## Sorting and filtering

Every screen's round filter button sorts — alphabetically either way
(A–Z or Z–A), recently modified or recently created — and filters.

The order is one order, saved, and everything follows it: notes,
albums and their discs, a folder's subfolder tiles, the Folders screen,
Home's folder shelf, and the Properties screen's list and values. Choose
it on any screen, or under Settings → Browsing → Order, and every open
screen redraws in it; it holds after a note is opened and closed, in new
tabs, and after a restart. By date, folders and property values go by
their newest note. On the Notes screen the Title and Modified columns
set the same order, so the menu and the headings always agree; sorting
by a property column stays in the table. Recently opened and Pinned
keep their own order — offered first in their menu — until another is
chosen there. Alphabetical order reads numbers by value, so "Week 2"
comes before "Week 10".

The filters combine:

- **Folder** — only notes under one folder.
- **Tag** — only notes with a tag, from their text or their properties;
  a parent tag takes in the ones nested under it.
- **Property** — a property, then a value it takes (or any value at
  all), with **Exclude these instead** to turn it around: *status is
  draft*, *status is not draft*, *has domain*, *no domain*.
- **Date** — modified or created today, or in the past week, month or
  year.

Each filter that's on is ticked in the menu, and choosing it again
turns it off. They also show as chips under the bar, so a narrowed
screen never passes for the whole of something: a chip's name changes
it, its cross removes it, and **Clear filters** takes them all off.
Folder tiles show the folders holding a match, and an album's discs
without one drop out. Moving to another screen starts unfiltered.

## The shell

A strip along the bottom carries the note you're in: its cover, its
name, a property beneath, and the controls that belong to it — back and
forward, pin, properties, reading mode and the file menu. It's the one
thing on screen that doesn't change as you move.

In the middle, either side of the note, **«** and **»** go to the note
before and after it in its album — in the album's own order if it has
one — as a player skips tracks. They say where they lead when pointed
at, and they're commands too (Previous and Next note in album), to give
keys to. On a phone they sit together after the note, as a mini
player's controls do.

Because it carries those controls, the note's own reading toggle and
More button are hidden while it's up — on a phone they come back while
the keyboard is, since the strip steps aside then. The view header above
a note repeats the rest, so **Single content area** (desktop) hides that, the main tab bar, the
sidebar's tab chip and the status bar. Tabs and splits still work
underneath; they stop being visible. Turning the strip off brings the
header controls back rather than leaving you without them. The strip's
More is the page menu the header had — Find, Replace, Export to PDF and
the rest — and while the sidebar is closed, a Show sidebar button
appears in the strip and at the top of each screen, since Obsidian's
own reopen buttons were in the chrome that's hidden. Reopening it brings
the library back to the front.

Right-clicking a folder page's background, or its artwork, disc
headings and tiles, offers New note and New folder in that folder; so do
the New note / New folder in the current folder commands.

**Keep to one page** finishes it: anything that would open a new tab,
split or window opens in the page you're on, and an empty page shows
Home — so the new-tab command, closing the last note and starting with
nothing open all land there. Menu items that would now do something
other than they say ("Open in new tab", "Split right" and so on) are
removed while it's on — from the keyboard's reach too, not only from
view. They're recognised by their English names, so with Obsidian in
another language they stay. It's off by default because it overrides
behaviour other plugins may rely on: one that opens a fresh tab to show
something beside your note will replace the note instead. Switching it
off undoes it completely, and it leaves alone any other plugin that
patches the same part of Obsidian.

## Lettered and roman numeral lists

Obsidian numbers lists 1., 2., 3. only; a list written with letters or
roman numerals is just paragraphs to it. **Lettered lists** and **Roman
numeral lists** (both on by default, under Writing) make them lists:

```
a. Apples         (A) Parties          i. First
b. Bananas        (B) Recitals         ii. Second
c. Cherries       (C) Provisions       iii. Third
```

- **Reading view** draws them as numbered lists, with the letters and
  numerals as you wrote them, lined up the way a numbered list's are.
  Lines under a numbered or bulleted item become a list inside it, so
  1. → (a) → (i) outlines work.
- **The editor** colours the marker like a list marker and indents
  wrapped lines under the text.
- **Enter** starts the next item — `b.` after `a.`, `iv.` after `iii.`,
  `aa.` after `z.` — in the same case and punctuation, at the same
  indent, and renumbers the items after it. Enter on an empty item ends
  the list, as it does for numbers.

`a.`, `a)` and `(a)` work, in lower or upper case, for letters and
numerals alike. The note's text is never changed, so other markdown
apps read it as written.

Some letters are numerals too, so which one a line is depends on the
item above it: `i.` after `h.` is the ninth letter, and on its own it's
the numeral one; `v.` after `iv.` is five, after `u.` a letter.

Lists start where lists start — at `a`, or at a numeral under 40 — and
everything else has to follow the item before it. That keeps ordinary
lines out: "etc.", "vs.", "p. 12", "c. 1900", "mix." and "J. Smith" don't
follow anything, and "I. M. Pei" or "A. B. Smith" is a name wherever it
is. The one thing it can't tell apart is a line that starts with an
initial A — "A. Smith wrote" reads as the first item of a list.
Items separated by blank lines are followed through the note's source,
so they count on too. A marker in bold or code is left alone, and code
blocks, maths and frontmatter are skipped.

## Superscript and subscript

Markdown has no superscript or subscript. **Superscript and subscript**
(on by default, under Writing) reads the short form Pandoc and many
editors use, and the HTML tags:

```
E = mc^2^        H~2~O        the 19^th^ century
x<sub>i</sub>    2<sup>n + 1</sup>
```

- **In the editor** they're raised and lowered as you write. In Live
  Preview the `^` and `~` hide until the cursor reaches them, as bold's
  asterisks do; in source mode they're shown faintly. The tags are
  raised and lowered too, with the tags themselves faint.
- **In reading view and exports** the short form is drawn as real
  superscript and subscript. The tags Obsidian draws itself.
- **The Superscript and Subscript commands** wrap the selection, take
  it off again if it's already one, or change one into the other. With
  nothing selected they put the markers in with the cursor between.
  They're in the editor's right-click menu when text is selected, and
  can be given hotkeys (Settings → Hotkeys) or added to the phone's
  editing toolbar in Obsidian's settings, where they have their own
  icons.

**Write them as** chooses what the commands put in: the short form,
which reads well as plain text, or the tags, which Obsidian draws
without this plugin and most other markdown apps draw too. Text with a
space in it always gets the tags, since the short form can't hold one.

The short form has no spaces inside, as in Pandoc, so plain-text maths
like `x^2 + y^2` is left alone, and so are footnotes (`[^1]`), links to
blocks (`#^id`), `~~strikethrough~~`, code, maths and web addresses.
To keep a `^` or `~` pair as it is, put a backslash before it: `\^2\^`.

The commands have keys to start with, chosen so they don't clash with
Obsidian's own: on a Mac, Control-Command-= for superscript and
Control-Command-hyphen for subscript, as in Pages; elsewhere, Alt+= and
Alt+-. Change them under Settings → Hotkeys.

**Raise ordinals as you type** (off by default) turns 1st, 2nd, 3rd and
21st into 1^st^ as you type the space or punctuation after them. Only
real ones — not "1th" — and not in code or maths. Undo straight after
takes the raising back and leaves what you typed.

## Property filters in the graph

The graph view's settings panel gets a **Properties** section beneath
Filters. Add a condition — a property, then *is*, *is not*, *has any
value* or *is missing*, and a value picked from the ones your notes
use — and the graph shows only the notes that match. With more than
one, choose whether all of them must match or any one.

It works by writing Obsidian's own search terms into the graph's
filter — `[domain:Politics]`, `-[status]`,
`([domain:Law] OR [domain:Politics])` — after anything you typed there
yourself, so the graph does the filtering and the query stays in plain
sight, editable by hand. Clear the field or reset the panel and the
conditions go with it. Local graphs get the section too.

## On iPhone and iPad

The library, every screen, covers, pins, the properties panel and the
strip all work in the mobile app. What changes:

- **Hold instead of right-click.** Every menu that opens on
  right-click opens on a long press — rows, tiles, discs, album art,
  library rows and a folder page's background. Moving a note to
  another disc is Obsidian's "Move file to…" in that menu, since
  dragging would take the same gesture.
- **The library is the left drawer.** Swipe in from the edge, or tap
  the sidebar button at the top of a screen. Choosing something closes
  it again.
- **Laid out for one column on a phone.** Large titles with the search
  field beneath; album art centred over its title; lists that show the
  name and leave the extra columns out; Home's shelves scrolling
  sideways; and Properties showing its list, then one property's
  values, with back returning to the list.
- **The strip is a mini player.** Full width above Obsidian's bottom
  bar with the note, Read/Edit and More. Pin is in More, the
  properties button stays in the note's header, and back and forward
  are the bottom bar's. It steps aside while the keyboard is up.
- **Desktop chrome stays desktop.** Single content area, the header
  actions menu, the ribbon in that menu and the settings gear in the
  header rearrange things the mobile app doesn't have, so they're off
  there and their settings aren't listed. Your choices for them still
  apply on the desktop, since settings sync with the vault.

## Navigation

The browse view is part of Obsidian's own leaf history, so back and
forward move through folders, properties and the notes you opened from
them as one trail. They're on every screen except Home and Search, in
the strip, and bindable to keys through the Go back and Go forward
commands, which act on the page even while the sidebar has focus. A
mouse's side buttons work too — Obsidian handles those itself, and the
screens are in the history it walks.

On a folder page, the pair at the top moves through the folders
instead: back goes up to the folder it's in, and forward comes back
down the way you went up — two levels up comes back down both — or,
if you haven't been up, into the first subfolder. Each says where it
leads when pointed at. The strip's pair stays the history, so there's
always one of each.

Going back returns each screen to where it was scrolled to.

From the keyboard: **/** jumps to Find from anywhere on a screen, and
Escape in Find clears it (again, to leave the field). The arrow keys
move through lists and tiles — left and right along a row of tiles, up
and down a row at a time — and Enter opens what's chosen.

## The properties panel

A property's type icon is its handle: drag it to move the property,
and the note's frontmatter is rewritten in the new order. A click on
the icon still opens its menu, which also has Move up and Move down;
Alt+↑ and Alt+↓ move it from the keyboard, and Escape mid-drag puts
everything back.

Names are matched the way Obsidian matches them, ignoring case.
Renaming a property to a name the note already has is refused rather
than writing over the other one's value, and adding a property the
note already has takes you to it.

The panel lists a note's linked mentions — leaving out its links to
itself, such as to its own headings — and its unlinked mentions: notes
that name it, or one of its aliases, as a whole word without linking
it. Unlinked starts folded and searches the vault only when opened; a
result opens its note at the first mention.

## Changing many notes at once

**Add properties** puts one or more properties on every note in a set
of folders. Right-click a folder — in the file explorer, the library
or anywhere in the browse view — and choose **Add properties…**; select
several folders or notes in the file explorer first to start with all
of them; or use the **Add properties to folders…** command. More
folders can be added in the dialog. It asks:

- **Which notes** — every note in the folders and their subfolders,
  only the notes directly in them, or only their folder notes.
- **The properties** — a name and a value for each, with the names and
  values your vault already uses offered as you type. A property the
  vault already has keeps its type; a new one takes the type you pick
  from its icon. Lists are typed with commas, and the value can be
  left empty.
- **Where a note already has one** — keep its value (a list still gets
  the new items), or replace it.

**Rename a property everywhere** and **Rename a tag everywhere** change
a name wherever it's used:

- A property is renamed in every note that has it, keeping its place
  and its type; in bases — `.base` files and base blocks in notes —
  in their filters, formulas, columns, sorting and grouping; and in
  this plugin's own settings: the cover property, search categories,
  album and table columns, library items and graph filters. Open
  screens and graphs follow.
- A tag is renamed in notes' tags properties and in their text, with
  the tags nested beneath it (`#law/court` becomes `#legal/court`), and
  in bases that test for it. Tags inside code are left alone.
- Renaming to a name that's already in use merges the two. A note that
  has both properties with different values is left as it is, and
  named, so you can decide.

They're reached from the commands, from a property's menu in the
properties panel (**Rename in every note…**), by right-clicking a
property on the Properties screen, and by right-clicking a tag in the
editor or a tag under **tags** on the Properties screen.

More tools work the same way, with the same preview and Undo:

- **Rename a value everywhere** — `domain: IR` to `International
  Relations` — in every note, lists included, where the new value joins
  any already there. A link counts by what it points to, and keeps its
  heading and alias. Bases that compare the property with that value
  (`domain == "IR"`) are changed too. Right-click a value on the
  Properties screen to start from it.
- **Remove properties** from every note in some folders: tick the ones
  to go, from the properties those notes have, with how many have each.
- **Change a property's type** — text to a list, a list to text, text
  to a number, a date or a checkbox — converting the values that can
  be, and naming the notes whose values can't, which are left as they
  are.
- **Find missing properties**: the notes in some folders without a
  property (or with it empty), each with a field to fill it in on
  Enter, or one value for all of them.
- **Default properties** for a folder: notes made in it, or in its
  subfolders, get them — only what they don't already have, a moment
  after they're made, so a template filling the note goes first. The
  nearest folder decides where two name the same property, and a
  folder's own note is left out. The dialog can also add them to the
  notes already there. Defaults follow the folder if it's renamed.

The folder tools are in a folder's right-click menu; all of them are
commands, and a property's menu on the Properties screen has Rename,
Change type, Find notes missing it and Remove from every note.

Every dialog says what it will do before it does it: how many notes
change, which already have the value, where a clash is, and which
bases and settings are affected. The button names the number.
Afterwards, **Undo** in the notice — or the **Undo the last bulk
change** command — puts every file back, except one you've edited
since, which keeps your edit and is named. Obsidian's own saved
searches, such as graph colour groups, and other plugins' queries
aren't changed.

## Settings

Grouped by what they change: Library, Shell, Browsing, Covers and
images, Writing, Graph, Properties panel, Header. A setting that only
matters while another is on is listed only then. The library's layout
is edited in place — sections, their contents, and the order of both.

## Requirements

Obsidian 1.7.2 or later, on desktop, iPhone, iPad or Android.

Pinning needs the Bookmarks core plugin. Linked mentions in the
properties panel need Backlinks.

## Notes for anyone reading the source

`main.js` is one file because Obsidian loads a plugin's `main.js`
directly and this project has no build step. It's organised as:

- shared helpers, then a `Pins` service
- `Feature` — the base for anything that can be switched on in settings,
  which declares its own commands and settings rows
- `BrowseScreen` and one subclass per screen; `BrowseView` holds state,
  navigation and the parts every screen shares
- `PanelSection` and its subclasses for the properties panel
- `BulkEdits`, which plans, makes and undoes changes across many
  notes, and the dialogs and menus that use it
- `DesignRedux`, which is lifecycle only

A feature marked `desktopOnly` is off in the mobile app whatever its
setting says, and its settings aren't listed there. Menus are attached
with `onContextMenu`, which adds the long press; phone layouts key off
Obsidian's own `is-mobile` and `is-phone` body classes, and every
`:hover` rule sits behind `@media (any-hover: hover)` so a tap doesn't
leave a row lit.

View types are registered in `onload`; everything that touches the vault
waits for `onLayoutReady`, since Obsidian hasn't finished loading files
before that.

Some of what this does has no public API — the property type manager,
the bookmarks instance, and relocating Obsidian's own buttons. Those
calls are guarded and restore what they moved, but they're the parts
most likely to need attention after an Obsidian update.
