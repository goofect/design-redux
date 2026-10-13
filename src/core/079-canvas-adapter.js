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

/** How many cards a canvas holds, or null where it can't be asked. */
export function cardCount(canvas) {
  return guarded(() => (canvas.nodes && typeof canvas.nodes.size === 'number' ? canvas.nodes.size : null), null);
}

/** An arrow by its id, or null. */
export function liveArrow(canvas, id) {
  return guarded(() => (canvas && canvas.edges && typeof canvas.edges.get === 'function' ? canvas.edges.get(id) || null : null), null);
}

/** A new text card in a box, not yet saved or opened; null if one can't be made. */
export function addTextCard(canvas, box, text) {
  return guarded(() => {
    if (typeof canvas.createTextNode !== 'function') return null;
    const size = { width: box.width, height: box.height };
    return canvas.createTextNode({ pos: { x: box.x, y: box.y }, size, text: text || '', focus: false, save: false }) || null;
  }, null);
}

/** Arrows added, as its file writes them: [{ id, fromNode, fromSide, toNode, toSide }]. */
export function addArrows(canvas, edges) {
  return addToCanvas(canvas, { nodes: [], edges });
}

/** An arrow taken off. */
export function removeArrow(canvas, edge) {
  guarded(() => typeof canvas.removeEdge === 'function' && canvas.removeEdge(edge), null);
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

/** These taken out of what's selected. */
export function unpickOnCanvas(canvas, items) {
  guarded(() => typeof canvas.deselect === 'function' && (items || []).forEach((item) => canvas.deselect(item)), null);
}

/** Saved — Obsidian's own save, a step of its Undo — or, where it can't be now, with the canvas's next change. */
export function requestCanvasSave(canvas) {
  guarded(() => typeof canvas.requestSave === 'function' && canvas.requestSave(), null);
}

/**
 * Saved as part of the step of Undo now made — the change that set this
 * off — rather than as a step of its own; or, where the canvas can't,
 * saved without one.
 */
export function saveInCurrentStep(canvas) {
  guarded(() => {
    if (typeof canvas.overrideHistory === 'function') canvas.overrideHistory();
    else if (typeof canvas.requestSave === 'function') canvas.requestSave(false);
  }, null);
}

/** What the canvas holds, as its file would: { nodes, edges }, or null. */
export function canvasDataOf(canvas) {
  return guarded(() => (typeof canvas.getData === 'function' ? canvas.getData() : null), null);
}

/** Cards and arrows added, as its file writes them: { nodes, edges }; false if they can't be. */
export function addToCanvas(canvas, data) {
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

/** The view brought to a box: { minX, minY, maxX, maxY }; false if it can't be. */
export function zoomCanvasTo(canvas, box) {
  return guarded(() => {
    if (typeof canvas.zoomToBbox !== 'function') return false;
    canvas.zoomToBbox(box);
    return true;
  }, false);
}

/** The view set to look at a point, at a zoom; false if it can't be. */
export function setCanvasView(canvas, x, y, zoom) {
  return guarded(() => {
    if (typeof canvas.setViewport !== 'function') return false;
    canvas.setViewport(x, y, zoom);
    return true;
  }, false);
}

/** The view brought to what's selected; false if it can't be. */
export function zoomCanvasToPicked(canvas) {
  return guarded(() => {
    if (typeof canvas.zoomToSelection !== 'function') return false;
    canvas.zoomToSelection();
    return true;
  }, false);
}

/** What part of the canvas is on screen, as a box, or null. */
export function canvasViewport(canvas) {
  try {
    if (typeof canvas.getViewportBBox === 'function') {
      const b = canvas.getViewportBBox();
      if (b && isFinite(b.minX) && isFinite(b.maxX)) return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
    }
    const el = canvas.wrapperEl;
    if (typeof canvas.x === 'number' && typeof canvas.y === 'number' && typeof canvas.zoom === 'number' && el && el.clientWidth) {
      const scale = Math.pow(2, canvas.zoom);
      const width = el.clientWidth / scale;
      const height = el.clientHeight / scale;
      return { x: canvas.x - width / 2, y: canvas.y - height / 2, width, height };
    }
  } catch (err) {
    /* not to be had */
  }
  return null;
}

/** The canvas looking at a point, as near as it was. */
export function lookAt(canvas, point) {
  try {
    if (typeof canvas.setViewport === 'function' && typeof canvas.zoom === 'number') {
      const zoom = typeof canvas.tZoom === 'number' ? canvas.tZoom : canvas.zoom;
      canvas.setViewport(point.x, point.y, zoom);
      return true;
    }
    const view = canvasViewport(canvas);
    if (view && typeof canvas.zoomToBbox === 'function') {
      canvas.zoomToBbox({ minX: point.x - view.width / 2, minY: point.y - view.height / 2, maxX: point.x + view.width / 2, maxY: point.y + view.height / 2 });
      return true;
    }
  } catch (err) {
    /* left where it was */
  }
  return false;
}

/** The view moved, as little as it takes, to show a card. */
export function showCard(canvas, card) {
  guarded(() => typeof canvas.panIntoView === 'function' && canvas.panIntoView(cardBox(card)), null);
}

/** The element the canvas takes its keys in, or null. */
export function canvasWrapper(canvas) {
  return guarded(() => canvas.wrapperEl || null, null);
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

/** Whether a card can be moved and sized as the canvas does it. */
export function cardMovable(card) {
  return guarded(() => typeof card.moveAndResize === 'function', false);
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

/** A card listed again where it now is, for the canvas to find it there. */
export function markCardMoved(canvas, card) {
  guarded(() => typeof canvas.markMoved === 'function' && canvas.markMoved(card), null);
}

/** A card just made put on the page, if the canvas hasn't yet. */
export function mountCard(card) {
  guarded(() => typeof card.attach === 'function' && card.nodeEl && !card.nodeEl.isConnected && card.attach(), null);
}

/** A card given a colour: '1'–'6' or a hex. */
export function colourCard(card, color) {
  guarded(() => typeof card.setColor === 'function' && card.setColor(color), null);
}

/** Whether a card is being typed in. */
export function cardEditing(card) {
  return guarded(() => !!card.isEditing, false);
}

/** A card opened to type in. */
export function editCard(card) {
  guarded(() => typeof card.startEditing === 'function' && card.startEditing(), null);
}

/** Typing in a card ended, as clicking away ends it. */
export function stopEditingCard(card) {
  guarded(() => {
    if (typeof card.blur === 'function') card.blur();
    if (typeof card.setIsEditing === 'function') card.setIsEditing(false);
  }, null);
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

/** An arrow's data, as its file holds it: { id, fromNode, toNode, label, … }. */
export function arrowData(edge) {
  return cardData(edge);
}

/** An arrow's data set; false if it can't be. */
export function setArrowData(edge, data) {
  return setCardData(edge, data);
}

/** A value the plugin keeps on an arrow. */
export function arrowKept(edge, key) {
  return guarded(() => (edge && edge.unknownData ? edge.unknownData[key] : undefined), undefined);
}

/** Kept on an arrow, or taken off it (undefined). */
export function keepOnArrow(edge, key, value) {
  guarded(() => {
    if (!edge.unknownData) edge.unknownData = {};
    if (value === undefined) delete edge.unknownData[key];
    else edge.unknownData[key] = value;
  }, null);
}

/** An arrow's drawn line, or null. */
export function arrowElement(edge) {
  return guarded(() => edge.lineGroupEl || null, null);
}

/** An arrow's drawn line and head: [element]. */
export function arrowElements(edge) {
  return guarded(() => [edge.lineGroupEl, edge.lineEndGroupEl].filter(Boolean), []);
}

/** An arrow drawn again. */
export function redrawArrow(edge) {
  guarded(() => typeof edge.render === 'function' && edge.render(), null);
}
