---
paths:
  - "src/core/079-canvas-adapter.js"
  - "src/tools/190-*.js"
  - "src/note/180-*.js"
---

# The canvas adapter

Canvas maps are gone (3.0), and mind maps since. What's left of Obsidian's
canvas is a few asks of a plain canvas, all through `core/079`:

- `liveCards`, `cardCount`: the strip's card count (190). A canvas can open
  before its cards are loaded; count them again when they arrive.
- `pickedOnCanvas`: the picked card for the note panel (180) and the
  `canvas` action context (078).
- `addTextCard`, `requestCanvasSave`: a study highlight added to the open
  canvas (147).
- `cardBox`, `cardElement`: where a card is.

Each ask is guarded, with a fallback, so a change in Obsidian is mended in
079 alone. `tests/test_layers.js` refuses a new direct use outside it.
