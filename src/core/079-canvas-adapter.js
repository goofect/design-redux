/* ------------------------------------------------------------------ */
/* Canvas internals, in one place                                     */
/*                                                                    */
/* Obsidian's canvas isn't public API. What the plugin asks of a live */
/* canvas — its cards and arrows, what's selected, a card's data, box */
/* and element, an arrow's ends, saving, the view — goes through      */
/* here, each ask guarded, with a fallback, so a change in Obsidian    */
/* is mended here rather than across every canvas feature. The rest   */
/* works on records (canvasModel) or asks these. Modules still        */
/* reaching in themselves are counted (tests/map.js --internals), and */
/* the count only goes down.                                          */
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

/* -- the canvas ---------------------------------------------------- */

/** Every card on a canvas: [node]. */
export function liveCards(canvas) {
  return guarded(() => (canvas && canvas.nodes ? Array.from(canvas.nodes.values()) : []), []);
}

/** Every arrow on a canvas: [edge]. */
export function liveArrows(canvas) {
  return guarded(() => (canvas && canvas.edges ? Array.from(canvas.edges.values()) : []), []);
}

/** A card by its id, or null. */
export function liveCard(canvas, id) {
  return guarded(() => (canvas && canvas.nodes && typeof canvas.nodes.get === 'function' ? canvas.nodes.get(id) || null : null), null);
}

/** The cards and arrows selected: [node or edge]. */
export function pickedOnCanvas(canvas) {
  return guarded(() => (canvas && canvas.selection ? Array.from(canvas.selection) : []), []);
}

/** Only these selected — or nothing, given none. */
export function pickOnCanvas(canvas, items) {
  const list = (items || []).filter(Boolean);
  guarded(() => {
    if (!list.length) {
      if (typeof canvas.deselectAll === 'function') canvas.deselectAll();
    } else if (list.length === 1 && typeof canvas.selectOnly === 'function') {
      canvas.selectOnly(list[0]);
    } else {
      if (typeof canvas.deselectAll === 'function') canvas.deselectAll();
      list.forEach((item) => typeof canvas.addToSelection === 'function' ? canvas.addToSelection(item) : typeof canvas.select === 'function' && canvas.select(item));
    }
    if (typeof canvas.requestFrame === 'function') canvas.requestFrame();
  }, null);
}

/** Saved — Obsidian's own save, a step of its Undo — or, where it can't be now, with the canvas's next change. */
export function requestCanvasSave(canvas) {
  guarded(() => typeof canvas.requestSave === 'function' && canvas.requestSave(), null);
}

/** What the canvas holds, as its file would: { nodes, edges }, or null. */
export function canvasDataOf(canvas) {
  return guarded(() => (typeof canvas.getData === 'function' ? canvas.getData() : null), null);
}

/** The canvas set to hold this, as its file would; false if it can't be. */
export function loadCanvasData(canvas, data) {
  return guarded(() => {
    if (typeof canvas.importData !== 'function') return false;
    canvas.importData(data);
    if (typeof canvas.requestFrame === 'function') canvas.requestFrame();
    return true;
  }, false);
}

/** Whether the canvas can't be changed now (being read, not edited). */
export function canvasReadonly(canvas) {
  return guarded(() => !!canvas.readonly, false);
}

/** The view brought to a box: { minX, minY, maxX, maxY }. */
export function zoomCanvasTo(canvas, box) {
  guarded(() => typeof canvas.zoomToBbox === 'function' && canvas.zoomToBbox(box), null);
}

/** What the view shows, as a box, or null. */
export function canvasViewBox(canvas) {
  return guarded(() => (typeof canvas.getViewportBBox === 'function' ? canvas.getViewportBBox() : null), null);
}

/** A pointer event's place on the canvas: { x, y }, or null. */
export function canvasPoint(canvas, evt) {
  return guarded(() => (typeof canvas.posFromEvt === 'function' ? canvas.posFromEvt(evt) : null), null);
}

/** The cards within a box: [node]. */
export function cardsWithin(canvas, box) {
  return guarded(() => (typeof canvas.getIntersectingNodes === 'function' ? Array.from(canvas.getIntersectingNodes(box)) : []), []);
}

/* -- a card -------------------------------------------------------- */

/** A card's data, as its file holds it: { id, type, text, file, x, y, … }. */
export function cardData(card) {
  return guarded(() => (card && typeof card.getData === 'function' ? card.getData() || {} : {}), {});
}

/** A card's data set; false if it can't be. */
export function setCardData(card, data) {
  return guarded(() => {
    if (typeof card.setData !== 'function') return false;
    card.setData(data);
    return true;
  }, false);
}

/** A value the plugin keeps on a card, beside what Obsidian knows of it. */
export function cardKept(card, key) {
  return guarded(() => (card && card.unknownData ? card.unknownData[key] : undefined), undefined);
}

/** Kept on a card, or taken off it (undefined). */
export function keepOnCard(card, key, value) {
  guarded(() => {
    if (!card.unknownData) card.unknownData = {};
    if (value === undefined) delete card.unknownData[key];
    else card.unknownData[key] = value;
  }, null);
}

/** A card's box: { minX, minY, maxX, maxY }, from its own measure or its place and size. */
export function cardBox(card) {
  return guarded(
    () => (typeof card.getBBox === 'function' ? card.getBBox() : null),
    null
  ) || { minX: card.x, minY: card.y, maxX: card.x + card.width, maxY: card.y + card.height };
}

/** A card moved and sized: { x, y, width, height }. */
export function placeCard(card, rect) {
  guarded(() => {
    if (typeof card.moveAndResize === 'function') card.moveAndResize(rect);
    else Object.assign(card, rect);
  }, null);
}

/** A card's element, or null. */
export function cardElement(card) {
  return guarded(() => card.nodeEl || null, null);
}

/** A card drawn again. */
export function redrawCard(card) {
  guarded(() => typeof card.render === 'function' && card.render(), null);
}

/* -- an arrow ------------------------------------------------------ */

/** An arrow's ends: { from, to } cards, their sides and heads; null without both. */
export function liveArrowEnds(edge) {
  return guarded(() => {
    const from = edge.from && edge.from.node;
    const to = edge.to && edge.to.node;
    if (!from || !to) return null;
    return { from, to, fromSide: edge.from.side, toSide: edge.to.side, fromEnd: edge.from.end || 'none', toEnd: edge.to.end || 'arrow' };
  }, null);
}

/** A value the plugin keeps on an arrow. */
export function arrowKept(edge, key) {
  return guarded(() => (edge && edge.unknownData ? edge.unknownData[key] : undefined), undefined);
}

/** An arrow's drawn line, or null. */
export function arrowElement(edge) {
  return guarded(() => edge.lineGroupEl || null, null);
}
