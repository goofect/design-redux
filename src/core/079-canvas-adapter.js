/* ------------------------------------------------------------------ */
/* Canvas internals, in one place                                     */
/*                                                                    */
/* Obsidian's canvas isn't public API. What the plugin still asks of  */
/* a live canvas, now canvas maps are gone — its cards for a count, a  */
/* highlight added as a card, what's selected for the note panel and  */
/* the actions, saving — goes through here, each ask guarded, with a  */
/* fallback, so a change in Obsidian is mended here.                  */
/* ------------------------------------------------------------------ */

/** Run an ask of the canvas; anything it throws, the fallback instead. */
function guarded(ask, fallback) {
  try {
    const out = ask();
    return out === undefined ? fallback : out;
  } catch (err) {
    return fallback;
  }
}

/** Every card on a canvas: [node]. */
export function liveCards(canvas) {
  return guarded(() => (canvas && canvas.nodes ? Array.from(canvas.nodes.values()) : []), []);
}

/** How many cards a canvas holds, or null where it can't be asked. */
export function cardCount(canvas) {
  return guarded(() => (canvas.nodes && typeof canvas.nodes.size === 'number' ? canvas.nodes.size : null), null);
}

/** A new text card in a box, not yet saved or opened; null if one can't be made. */
export function addTextCard(canvas, box, text) {
  return guarded(() => {
    if (typeof canvas.createTextNode !== 'function') return null;
    const size = { width: box.width, height: box.height };
    return canvas.createTextNode({ pos: { x: box.x, y: box.y }, size, text: text || '', focus: false, save: false }) || null;
  }, null);
}

/** The cards and arrows selected: [node or edge]. */
export function pickedOnCanvas(canvas) {
  return guarded(() => (canvas && canvas.selection ? Array.from(canvas.selection) : []), []);
}

/** Saved — Obsidian's own save, a step of its Undo — or, where it can't be now, with the canvas's next change. */
export function requestCanvasSave(canvas) {
  guarded(() => typeof canvas.requestSave === 'function' && canvas.requestSave(), null);
}

/** A card's box: { minX, minY, maxX, maxY }, from its own measure or its place and size. */
export function cardBox(card) {
  return guarded(
    () => (typeof card.getBBox === 'function' ? card.getBBox() : null),
    null
  ) || { minX: card.x, minY: card.y, maxX: card.x + card.width, maxY: card.y + card.height };
}

/** A card's element, or null. */
export function cardElement(card) {
  return guarded(() => card.nodeEl || null, null);
}
