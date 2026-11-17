# Library, folder, note

## One job per screen

- **Library:** list the vault's folders. Expand a folder to reach nested folders.
- **Folder:** list that folder's Markdown notes. The vault root is also a folder,
  so notes outside a named folder remain accessible.
- **Note:** show its text in Obsidian's own editor or reading view. Paged notes
  show one page at a time with a compact page selector.

The library does not show files, search, metadata, counts or a details panel.
The folder screen does not show attachments, subfolders, file types, covers or
alternate layouts. Paged notes have page tabs; the plugin adds no folder header,
property chips or bottom strip. The 3D graph remains a separate view.

## Interaction and appearance

Use actual folder and note names, not invented codes. The interface is a dense,
neutral directory: white, black and light grays in light mode, corresponding
neutral values in dark mode, straight rules, small monospaced type, and no
decorative photography, marketing, animation, or promotional UI. Selection and
keyboard focus remain distinct and readable. Do not add commerce concepts.
The workspace browser contains two bordered panels: folders on the left and
notes on the right, with the proportions and spacing of the reference. The
folder tree uses disclosure marks only where needed. A folder selection updates
its note list; selecting a note opens it through Obsidian. Breadcrumbs provide a
way back. Keyboard activation and focus must work without a pointer. Existing
Obsidian chrome, native file access and the editor remain Obsidian's own.

The plugin closes existing native File explorer views when enabled and removes
the side docks, ribbons, and status bar from its workspace while enabled. The
neutral design applies to the full Obsidian window; the duplicate native browser
header is removed. The browser is opened
with the Open library command. Obsidian's File explorer remains a core plugin;
the plugin does not delete or disable Obsidian's application code. Disabling
Design Redux restores the dock and ribbon, and Obsidian's File explorer can be
reopened through Obsidian.

## Compatibility

Existing notes are not rewritten by migration. Notes created with old page markers
use those markers and their remembered page selections. Stored settings and saved
views remain in plugin data but no longer create removed screens. The retired
map, outline and properties-panel view identifiers close old saved tabs safely.
Commands for removed screens have been retired; the 3D graph and its commands
remain available. Attachments remain in the vault and accessible through
Obsidian's native file explorer, but do not appear in the note list.

Before release, run the simulation and real-Obsidian suites, review the library,
folder and note screens in light and dark themes, and refresh visual baselines.
