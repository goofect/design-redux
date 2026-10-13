---
paths:
  - "src/3*-canvas-*.js"
  - "tests/test_canvas.js"
---

# Canvas internals

- A canvas can open before its cards are loaded; count them again when they arrive.
- Canvas folds (`316`–`318`, `335`–`339`): a tucked card keeps its own place in
  the file and only answers `getBBox` with its fold's box, so arrows end at the
  fold. A pass never saves — only a fold, unfold or tidy by hand does: a canvas
  can be rewritten from outside while open, and each save is a step of Undo
  that, undone, would only start the pass again. Folds and tidies glide
  (`glideCanvasModel`); no pass runs while `state.gliding`, and anything new
  calls `settle(view)` first so it starts from where the cards are going.
  A fold notes what its closing-up moved (`drRoom` on the folded card) and
  unfolding moves exactly that back — never make room again by guessing, or
  layouts drift. A tucked card only moves with its fold. Obsidian finds cards
  under the pointer from an index that still lists tucked ones, so the
  canvas's `getIntersectingNodes` and `hitTestNode` are wrapped (`336`) to
  leave them out.
- Arrow styles (`332`): the canvas edge prototype's `updatePath`, `getCenter`
  and `getBBox` are wrapped once with `around()`, and an arrow is redrawn
  after Obsidian draws it; anything unexpected falls back to Obsidian's own
  drawing. An arrow's style is in its data as `drArrow`.
- After a change made by hand: `afterCanvasChange` or `glideAndSettle` (335),
  which save (`saveCanvas`, 316), tell the fold pass and announce
  `design-redux:canvas-changed`. Never from a pass.
- Live mind maps (`348`): a canvas listed in `canvasMapFiles` lays itself out.
  A card's place is its spot by its tree's layout (`layoutPlaces`, 325) plus
  its `drNudge` and those of the cards above it; a tree's first card stays
  put and its layout is `drLayout` on it; any other card's `drLayout` is its
  branch's own, laid out first and placed as a block (`composedLayout`). A pass turns cards moved by hand
  into nudges (their branches follow) and lays out again when the tree's
  shape changes; it saves only what it changed, with `saveInCurrentStep`
  (Obsidian's `overrideHistory`), so the layout joins the step of Undo the
  change made — never a step of its own. Cards off their places with
  nothing moved (Undo, a file from elsewhere) get nudges that keep them
  there, unsaved. Tidy and "Lay out branch" in a map go through the map.
