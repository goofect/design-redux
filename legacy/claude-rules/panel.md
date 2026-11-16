---
paths:
  - "src/note/**"
  - "src/core/076-*"
  - "src/core/082-*"
  - "src/core/084-*"
  - "src/library/110-*"
  - "src/library/112-*"
  - "src/library/123-*"
  - "src/library/124-*"
  - "src/library/127-*"
  - "src/library/130-*"
  - "src/library/257-*"
  - "src/tools/30[56]-*"
  - "src/ui/225-sidebar-swipe.js"
---

# The note panel, the inspector and the pick

- A feature adds to the note panel with `panelSections(panel)`: `PanelSection`
  instances (082), drawn between the properties and the mentions. The panel
  is where a note is edited: it pops up above the button that asked (the
  note's header, the strip); on a phone, a sheet. The right sidebar's
  inspector (179, `INSPECTOR_VIEW`) is the library's: it shows what's picked
  there, as `plugin.coordinator` says (084: the pick and the pin, kept as a
  snapshot `{ target, leaf, origin, pinned }`). While it's open, a popup
  borrows the panel from it and gives it back on closing (`float`/`unfloat`).
- What's picked is `plugin.selection` (076), apart from what's open. In the
  browse view, rows and tiles go through `pickOrOpen`. While the inspector
  shows (`inspectorShowing`), a click picks and a double click or Enter
  opens. The browse view (124) draws what the library knows of a pick into
  the inspector: an album in brief, and a picked note's Open / Reveal in
  collection / More.
