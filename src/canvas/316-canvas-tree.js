/* ------------------------------------------------------------------ */
/* A canvas as a hierarchy                                             */
/*                                                                     */
/* Cards hang under cards by their arrows and sit inside groups; a     */
/* fold tucks some of them away into the card folded. All of this     */
/* works on the canvas as plain records — { id, type, x, y, width,     */
/* height, label, text, file, color, tuck, fold, room, master } and    */
/* arrows { from, to, fromSide, toSide, fromEnd, toEnd } — so it's the */
/* same for a live canvas, its file and a test. Nothing here changes   */
/* the records unless it says so.                                      */
/* ------------------------------------------------------------------ */

import { RELATED_KEY } from '../core/020-constants.js';
import { arrowKept, cardData, cardKept, liveArrowEnds, liveArrows, liveCards, requestCanvasSave } from '../core/079-canvas-adapter.js';
import { foldOf } from './335-canvas-fold.js';
import { indexModel, MASTER_KEY, PIN_KEY, ROOM_KEY, roomOf, TUCK_KEY } from '../tree/400-tree-model.js';

/**
 * The canvas saved — Obsidian's own save, a step of its Undo — or, where
 * it can't be now, with the canvas's next change. Only after a change
 * made by hand: a pass never saves.
 */
export function saveCanvas(canvas) {
  requestCanvasSave(canvas);
}

/** A card's tuck — { by, dx, dy } — or null. */
export function tuckOf(node) {
  const kept = cardKept(node, TUCK_KEY);
  return kept && typeof kept.by === 'string' && typeof kept.dx === 'number' && typeof kept.dy === 'number' ? kept : null;
}

/** A canvas's cards and arrows as records, read from the live canvas. */
export function canvasModel(canvas) {
  const nodes = [];
  const edges = [];
  liveCards(canvas).forEach((node) => {
    const data = cardData(node);
    nodes.push({
      id: node.id || data.id,
      type: data.type || 'text',
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      label: data.label,
      text: data.text,
      file: data.file,
      subpath: data.subpath,
      url: data.url,
      color: node.color !== undefined ? node.color : data.color,
      tuck: tuckOf(node),
      fold: foldOf(node),
      room: roomOf(cardKept(node, ROOM_KEY)),
      master: !!cardKept(node, MASTER_KEY),
      pinned: !!cardKept(node, PIN_KEY),
      node,
    });
  });
  liveArrows(canvas).forEach((edge) => {
    const ends = liveArrowEnds(edge);
    if (!ends) return;
    edges.push({
      id: edge.id,
      from: ends.from.id,
      to: ends.to.id,
      fromSide: ends.fromSide,
      toSide: ends.toSide,
      fromEnd: ends.fromEnd,
      toEnd: ends.toEnd,
      related: !!arrowKept(edge, RELATED_KEY),
      edge,
    });
  });
  return indexModel({ nodes, edges });
}

/* -- tidying a branch ------------------------------------------------- */

/* -- the outline ------------------------------------------------------- */

