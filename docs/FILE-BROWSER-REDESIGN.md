# File browser redesign

## Goal

Replace the separate objects, shelves, words and table presentations with one
coherent file browser for an Obsidian vault. Keep the 3D graph as a separate
view. The replacement file list is now the default in the sidebar and the
workspace. Real-Obsidian and visual comparison against the approved mockup
remain required before this work is released.

## What the browser shows

The approved mockup is the visual target. Its composition is a narrow Obsidian
ribbon, a files sidebar, a wide central browser and a right-hand details
region, separated by straight hairlines. Keep the warm off-white ground,
near-black type and muted clay selection, square corners and unadorned controls.
Use the actual Obsidian workspace and tabs rather than reproducing the mockup's
application chrome inside a plugin view.

The sidebar has a `FILES` heading, an always-visible search field, a breadcrumb
and an expandable folder tree with persistent labels and folder/file icons.
The main browser has a large current-folder title, breadcrumb and a ruled list
of names with file types. The details region has a `DETAILS` heading and shows
the selected item's icon, filename and type. Match the mockup's alignment,
spacing and relative proportions while allowing panels to resize in Obsidian.

Use a labelled, compact list in both the sidebar and the main workspace. The
current folder is the context for the list. Each row identifies a folder or
file by name, has a distinct selected and keyboard-focus state, and opens it
on activation. Folder activation enters that folder; a breadcrumb and a back
control return to an ancestor. An empty folder stays visible and opens to an
empty state with a create-note action. Search is a single explicit field; the
results say where each file is located and open in Obsidian.

The main workspace uses its extra width for the details region for the selected
item, and uses the same model and actions as the sidebar. Do
not introduce a second set of grid, shelf, table, or custom-order modes. Use
clear names at rest, square controls, hairlines, flat surfaces and a small type
hierarchy. Keep Obsidian's note editor and file-opening behavior rather than
building a replacement editor.

## Interaction contract

- Navigate with a keyboard, visible focus, and semantic labels; activate with
  Enter or Space where appropriate. Preserve selection and a useful focus
  target after refresh, rename and delete.
- Open files through the workspace and preserve the modifier for opening a
  new tab. Use Obsidian's own file types and registered view handling, so a
  non-Markdown file is not silently treated as a note.
- Use Obsidian's file manager for rename and move operations so links can
  follow. Keep confirmation and undo where existing operations offer them.
- Respect the vault's hidden/configuration files and Obsidian's APIs. Never
  read, mutate or delete vault content merely to render the browser.
- Render both light and dark schemes, different sidebar widths and popout
  windows. Text, focus and selection must remain distinguishable without hover.

## Architecture

1. Extend the existing vault index with a typed, ordered view of direct child
   folders and files, including non-Markdown files. Keep its Markdown-only
   queries for note-specific features; do not change their meaning. Reuse its
   existing invalidation on vault events.
2. Use one `BrowserScreen` for navigation state, search, selection and actions,
   with a single row renderer shared by the sidebar and main view. Keep the
   `ItemView` wrappers responsible for Obsidian registration and lifecycle.
3. Separate a file's identity and supported actions from its presentation.
   Markdown-only metadata, property actions and reading estimates must not be
   requested for arbitrary attachments.
4. Remove the old layout-specific renderers, their segmented control and the
   obsolete cycle-layout action after the replacement covers the same core
   navigation. Keep or retire command IDs deliberately, with a documented
   replacement where a hotkey used to invoke the old behavior.
5. Retain the existing library and browse view identifiers where possible so
   saved Obsidian workspaces reopen. Migrate layout preferences to the single
   browser without discarding saved data. Preserve note and vault contents.
6. Retire the separate tree-map feature and its controls, while preserving the
   3D graph. Its saved workspace identifiers remain registered as retired views
   that close on opening; the former map command IDs are removed.

## Verification before cutover

Exercise nested and empty folders, Markdown and non-Markdown files, search,
creation, rename, move, delete, context menus, keyboard navigation, focus,
selection, persistence and plugin unload. Test sidebar and main view at
different widths and in light and dark themes. Run the simulation suite and
exercise opening/restoring views and files in the actual Obsidian app. Check
large vault performance and ensure the 3D graph remains usable. Update the
design specimen and screenshot baselines only after reviewing the new UI.
