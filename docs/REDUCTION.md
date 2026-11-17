# Reducing Design Redux

## Direction

Keep the plugin centered on navigating a vault, reading and editing notes, and
working with their properties. Use Obsidian's own workspace, files, commands,
menus, and settings APIs as the foundation. The interface should make the
structure of the vault and the available actions clear: flat surfaces, a small
type hierarchy, consistent spacing, and explicit states. Preserve readable
labels, focus indicators, keyboard access, and theme contrast.

Give each behavior one owner. Share a component or lifecycle helper when two
places actually do the same work. Remove an alternative implementation only
after tracing its commands, saved settings, views, and data. Visual austerity
alone is not evidence that a feature or a user's data is unused.

## Current boundaries

- `core/`: Obsidian-facing services, data, settings migration, and lifecycle.
- `ui/`: shared controls used by plugin-owned surfaces.
- `library/`, `note/`, `tools/`: feature-specific behavior.
- `plugin/`: feature registration and the settings tab.

The separate tree map has been removed; saved map and outline tabs close through
a compatibility view. The 3D graph remains. Custom note ordering has been
removed from the interface; stored order data is retained for existing vaults.

## Candidates for a subsequent feature decision

The 3D graph stays. The file-browser replacement is specified in
`docs/FILE-BROWSER-REDESIGN.md`. The following are further candidates, not
removals in this change:

| Candidate | Simplification | Consequence to assess |
| --- | --- | --- |
| Property rules, schemas and history | Reduce overlapping property-management systems. | May remove automated changes, validation or history people rely on. |
| Saved views | Reduce ways of storing filtered vault views. | Can make existing saved views inaccessible. |
| Plugin-wide appearance | Limit styling to plugin-owned surfaces. | Stops changing Obsidian's chrome and other plugins' appearance. |

Before removing a candidate, specify its replacement or the lost behavior,
trace callers and registered commands, preserve or explicitly migrate saved
data, and test load, unload, existing vaults, keyboard use and the affected
view in Obsidian. Remove the related source, assets, tests and settings only
after those dependencies are resolved.
