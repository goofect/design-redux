/* ------------------------------------------------------------------ */
/* Tucked cards on the canvas                                          */
/*                                                                     */
/* A tucked card isn't drawn, and an arrow to it from elsewhere ends   */
/* at the fold it's in: the card answers the canvas, when asked for    */
/* its box, with the fold's. Arrows between cards in the same fold     */
/* aren't drawn. A tucked card can't be selected — a box dragged round  */
/* the fold would otherwise take it along, and Delete with it — nor     */
/* found by the canvas under the pointer, so an arrow drawn from or to  */
/* the fold, or a card where a tucked one was, joins the card that's    */
/* there. One whose fold is gone, deleted, comes back where it was.     */
/* ------------------------------------------------------------------ */

/* A tucked card's box: the fold's. */
function tuckedBBox() {
  const into = this.drInto;
  if (into && into !== this && typeof into.getBBox === 'function') return into.getBBox();
  return Object.getPrototypeOf(this).getBBox.call(this);
}

function boxKey(node) {
  try {
    const b = node.getBBox();
    return `${b.minX},${b.minY},${b.maxX},${b.maxY}`;
  } catch (err) {
    return '';
  }
}

/** Whether a canvas card is tucked away, as drawn. */
function isTuckedNode(node) {
  return !!node && node.getBBox === tuckedBBox;
}

/**
 * The canvas finds cards under the pointer — to show a card's handles
 * for drawing an arrow, and to join an arrow to the card it's dropped
 * on — in an index of their boxes, where a tucked card is still listed:
 * where it was, or at its fold. Asked, it leaves tucked cards out.
 */
function keepTuckedUnfound(canvas) {
  if (!canvas || canvas.drFinding) return;
  const find = canvas.getIntersectingNodes;
  const hit = canvas.hitTestNode;
  if (typeof find !== 'function') return;
  const own = {
    find: Object.prototype.hasOwnProperty.call(canvas, 'getIntersectingNodes') ? find : null,
    hit: Object.prototype.hasOwnProperty.call(canvas, 'hitTestNode') ? hit : null,
  };
  canvas.drFinding = own;
  canvas.getIntersectingNodes = function (...args) {
    const found = find.apply(this, args);
    return Array.isArray(found) ? found.filter((n) => !isTuckedNode(n)) : found;
  };
  if (typeof hit !== 'function') return;
  canvas.hitTestNode = function (pos, pad) {
    const first = hit.call(this, pos, pad);
    if (!isTuckedNode(first) || !pos) return first;
    // Under the pointer, the shown card on top.
    const r = pad || 0;
    const found = this.getIntersectingNodes({ minX: pos.x - r, minY: pos.y - r, maxX: pos.x + r, maxY: pos.y + r });
    if (!Array.isArray(found) || !found.length) return null;
    return found.slice().sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0))[0];
  };
}

/** The canvas finding cards as it did. */
function findTuckedAgain(canvas) {
  const own = canvas && canvas.drFinding;
  if (!own) return;
  if (own.find) canvas.getIntersectingNodes = own.find;
  else delete canvas.getIntersectingNodes;
  if (own.hit) canvas.hitTestNode = own.hit;
  else delete canvas.hitTestNode;
  delete canvas.drFinding;
}

/** Tucked cards hidden, their arrows sent to their folds, and kept out of the selection and the canvas's finding. */
function drawTucks(view, model, state) {
  const canvas = view.canvas;
  if (!state.edgeKeys) state.edgeKeys = new Map();
  if (model.nodes.some((rec) => rec.tuck)) keepTuckedUnfound(canvas);
  model.nodes.forEach((rec) => {
    const node = rec.node;
    if (!node) return;
    const into = rec.tuck ? (shownAs(model, rec) || {}).node : null;
    if (node.nodeEl) node.nodeEl.toggleClass('dr-tucked', !!into);
    if (into && into !== node) {
      node.drInto = into;
      if (node.getBBox !== tuckedBBox) node.getBBox = tuckedBBox;
    } else if (node.getBBox === tuckedBBox) {
      delete node.getBBox;
      delete node.drInto;
      // Listed again where it is, for the canvas to find.
      try {
        if (typeof canvas.markMoved === 'function') canvas.markMoved(node);
      } catch (err) {
        /* listed with its next move */
      }
    }
  });
  model.edges.forEach((e) => {
    const a = model.byId.get(e.from);
    const b = model.byId.get(e.to);
    const edge = e.edge;
    if (!a || !b || !edge) return;
    const involved = !!(a.tuck || b.tuck);
    const inside = involved && shownAs(model, a) === shownAs(model, b);
    const label = edge.labelElement && edge.labelElement.wrapperEl;
    [edge.lineGroupEl, edge.lineEndGroupEl, label].forEach((el) => {
      if (el && el.classList) el.classList.toggle('dr-tucked-edge', inside);
    });
    // Drawn again when an end is now drawn somewhere else.
    const key = involved ? `${boxKey(a.node)}|${boxKey(b.node)}` : '';
    const was = state.edgeKeys.get(e.id);
    state.edgeKeys.set(e.id, key);
    if (was === undefined ? key : was !== key) {
      try {
        if (typeof edge.render === 'function') edge.render();
      } catch (err) {
        /* drawn with the canvas's next change */
      }
    }
  });
  try {
    const held = Array.from(canvas.selection || []).filter((n) => tuckOf(n));
    if (held.length && typeof canvas.deselect === 'function') held.forEach((n) => canvas.deselect(n));
  } catch (err) {
    /* nothing selected to speak of */
  }
}

/** Everything drawTucks did, undone: every card drawn as itself. */
function undrawTucks(view) {
  try {
    view.canvas.nodes.forEach((node) => {
      if (node.getBBox === tuckedBBox) {
        delete node.getBBox;
        delete node.drInto;
        if (typeof view.canvas.markMoved === 'function') view.canvas.markMoved(node);
      }
      if (node.nodeEl) node.nodeEl.removeClass('dr-tucked');
    });
  } catch (err) {
    /* no cards */
  }
  findTuckedAgain(view.canvas);
  if (view.contentEl) view.contentEl.querySelectorAll('.dr-tucked-edge').forEach((el) => el.classList.remove('dr-tucked-edge'));
}

/**
 * Cards tucked into something that's gone — a folded card or group
 * deleted — brought back beside where it last was, with room made for
 * them as unfolding it would. Then what each fold is like now is noted,
 * for next time. Returns whether any came back.
 */
function restoreOrphans(model, state, close) {
  const lost = new Map();
  model.nodes.forEach((n) => {
    if (!n.tuck || model.byId.has(n.tuck.by)) return;
    if (!lost.has(n.tuck.by)) lost.set(n.tuck.by, []);
    lost.get(n.tuck.by).push(n);
  });
  lost.forEach((cards, id) => {
    const was = state.tuckers && state.tuckers.get(id);
    const before = snapshotModel(model);
    cards.forEach((n) => {
      const tuck = n.tuck;
      n.tuck = null;
      if (!was) return;
      const moved = new Set();
      const dx = was.x + tuck.dx - n.x;
      const dy = was.y + tuck.dy - n.y;
      if (dx) shiftRecord(model, n, 'x', dx, moved, true);
      moved.clear();
      if (dy) shiftRecord(model, n, 'y', dy, moved, true);
    });
    // What the fold moved, moved back; or, for one that noted nothing, room made as unfolding it would.
    if (was && was.room) {
      giveRoomBack(model, was.room);
      return;
    }
    if (!was || !close) return;
    const home = was.home && model.byId.has(was.home) ? was.home : null;
    const ids = cards.map((n) => n.id);
    if (was.group) {
      makeRoom(model, before, {
        origin: new Set(ids),
        home,
        axis: 'y',
        side: 'after',
        at: was.y + was.height,
        delta: Math.max(0, was.full - was.height),
        span: [was.x, was.x + was.width],
      });
    } else {
      branchRoom(model, before, { id, x: was.x, y: was.y, width: was.width, height: was.height }, ids, was.side, home, false);
    }
  });
  rememberTuckers(model, state);
  return lost.size > 0;
}

/** Where each fold is and what it's like, so what's in it can come back if it's deleted. */
function rememberTuckers(model, state) {
  const holders = new Set(model.nodes.filter((n) => n.tuck).map((n) => n.tuck.by));
  state.tuckers = new Map();
  if (!holders.size) return;
  const homes = canvasHomes(model);
  const sides = branchSides(model);
  holders.forEach((id) => {
    const rec = model.byId.get(id);
    if (!rec || rec.tuck) return;
    state.tuckers.set(id, {
      x: rec.x,
      y: rec.y,
      width: rec.width,
      height: rec.height,
      group: isGroupRecord(rec),
      full: rec.fold ? rec.fold.height : rec.height,
      side: sides.get(id) || 'right',
      home: homes.get(id) || null,
      room: rec.room,
    });
  });
}
