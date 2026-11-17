# Library, folder, note

## One job per screen

- **Library:** list the vault's folders. Expand a folder to reach nested folders.
- **Folder:** list that folder's Markdown notes. The vault root is also a folder,
  so notes outside a named folder remain accessible.
- **Note:** show the complete note in Obsidian's own editor or reading view.

The library does not show files, search, metadata, counts or a details panel.
The folder screen does not show attachments, subfolders, file types, covers or
alternate layouts. The plugin adds no note header, property chips, page tabs or
bottom strip. The 3D graph remains a separate view.

## Interaction and appearance

Use actual folder and note names, not invented codes. The interface is a dense,
neutral directory: white, black and light grays in light mode, corresponding
neutral values in dark mode, straight rules, small monospaced type, and no
decorative photography, marketing, animation, or promotional UI. Selection and
keyboard focus remain distinct and readable. Do not add commerce concepts.
The folder tree uses disclosure marks only where needed. A folder selection opens
its note list; selecting a note opens it through Obsidian. Breadcrumbs provide a
way back. Keyboard activation and focus must work without a pointer. Existing
Obsidian chrome, native file access and the editor remain Obsidian's own.

## Compatibility

Existing notes are never rewritten. Notes created with old page markers now show
all their text; their markers remain in the file. Stored settings and saved
views remain in plugin data but no longer create removed screens. The retired
map, outline and properties-panel view identifiers close old saved tabs safely.
Commands for removed screens have been retired; the 3D graph and its commands
remain available. Attachments remain in the vault and accessible through
Obsidian's native file explorer, but do not appear in the note list.

Before release, run the simulation and real-Obsidian suites, review the library,
folder and note screens in light and dark themes, and refresh visual baselines.
