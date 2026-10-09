/* ------------------------------------------------------------------ */
/* Growing a mind map                                                  */
/*                                                                     */
/* With one card selected: Tab adds a card its arrow leads to, Enter   */
/* adds one beside it — the next of its parent's. Each goes in the     */
/* nearest free space round the card, out the way its branch grows     */
/* first; or, set so, in line with the cards already there, with room  */
/* made for it. It grows out of the card it hangs from and opens to be */
/* typed in. Alt and an arrow key moves to the next card that way.     */
/* Dropped onto another card, a card hangs from that one instead, its  */
/* branch coming along. The same from the card's right-click menu, and */
/* as commands to give other keys.                                    */
/* ------------------------------------------------------------------ */

/** A new id for a card or arrow, as the canvas makes them. */
function newCanvasId(canvas) {
  const taken = (id) => (canvas && canvas.nodes && canvas.nodes.has(id)) || (canvas && canvas.edges && canvas.edges.has(id));
  let id = '';
  do {
    id = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  } while (taken(id));
  return id;
}

/** Whether a key went to somewhere text is typed. */
function typingInto(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return !!target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], .cm-editor, .canvas-node.is-editing');
}

/**
 * The card nearest one way from another — 'up', 'down', 'left' or
 * 'right' — or null. Cards joined to it by an arrow count as nearer.
 */
function cardTowards(model, from, way, linked) {
  const cx = (r) => r.x + r.width / 2;
  const cy = (r) => r.y + r.height / 2;
  let best = null;
  let bestScore = Infinity;
  model.nodes.forEach((r) => {
    if (r === from || r.tuck || isGroupRecord(r)) return;
    const dx = cx(r) - cx(from);
    const dy = cy(r) - cy(from);
    const ahead = way === 'right' ? dx : way === 'left' ? -dx : way === 'down' ? dy : -dy;
    const aside = way === 'right' || way === 'left' ? Math.abs(dy) : Math.abs(dx);
    // In that direction, within a wide cone of it.
    if (ahead <= 1 || aside > ahead * 2) return;
    const score = (ahead + aside * 2) * (linked && linked.has(r.id) ? 0.5 : 1);
    if (score < bestScore) {
      best = r;
      bestScore = score;
    }
  });
  return best;
}

/* Between a card placed in free space and the cards round it. */
const FREE_GAP = 30;

/** A box as the canvas gives them: minX, minY, maxX, maxY. */
function boxEdges(r) {
  return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height };
}

/**
 * The nearest free place for a box of `size` round `anchor`: out of the
 * side `prefer` first — `away` from it — then the sides beside it, then
 * the far one; the place nearest the anchor that comes no nearer than
 * `gap` to a card, crosses no group's edge but its own group's (which
 * then grows round it), goes into no other group, and keeps clear of
 * where a folded card would come out. `skip`: ids that don't count, as
 * they're moving too; `beside` and `behind`, how much further the sides
 * beside the one asked for and the far side count; `align`, how much
 * further a place off the anchor's line counts. { x, y, side }, or null
 * for nowhere near.
 */
function freeSpot(model, anchor, size, prefer, opts) {
  opts = opts || {};
  const gap = opts.gap === undefined ? FREE_GAP : opts.gap;
  const away = opts.away === undefined ? TIDY_DEPTH_GAP : opts.away;
  const skip = opts.skip || new Set();
  const home = canvasHomes(model).get(anchor.id) || null;
  const homeRec = home ? model.byId.get(home) : null;
  const obstacles = [];
  const groups = [];
  model.nodes.forEach((n) => {
    if (skip.has(n.id) || (n.tuck && skip.has(shownAs(model, n).id))) return;
    if (n.tuck) obstacles.push(outBox(model, n));
    else if (isGroupRecord(n)) groups.push(n);
    else obstacles.push(n);
  });
  const free = (b) => {
    for (const o of obstacles) {
      if (b.x < o.x + o.width + gap && o.x < b.x + b.width + gap && b.y < o.y + o.height + gap && o.y < b.y + b.height + gap) return false;
    }
    for (const g of groups) {
      const outside = b.x >= g.x + g.width || b.x + b.width <= g.x || b.y >= g.y + g.height || b.y + b.height <= g.y;
      if (outside) continue;
      // Across another group's edge, or inside a group the anchor isn't in.
      const ours = g === homeRec || (homeRec && withinRect(homeRec, g));
      if (!withinRect(b, g) && g !== homeRec) return false;
      if (!ours) return false;
    }
    return true;
  };
  const cx = anchor.x + anchor.width / 2;
  const cy = anchor.y + anchor.height / 2;
  const side0 = BRANCH_SIDES.indexOf(prefer) === -1 ? 'right' : prefer;
  const beside = side0 === 'right' || side0 === 'left' ? ['bottom', 'top'] : ['right', 'left'];
  const sideways = opts.beside || 4;
  const sides = [[side0, 1], [beside[0], sideways], [beside[1], sideways], [OPPOSITE_SIDE[side0], opts.behind || 5]];
  const align = opts.align === undefined ? 0.25 : opts.align;
  const out = [];
  sides.forEach(([side, weight]) => {
    for (let d = 0; d <= 640; d += 20) {
      for (let a = -640; a <= 640; a += 20) {
        let x;
        let y;
        if (side === 'right') [x, y] = [anchor.x + anchor.width + away + d, cy - size.height / 2 + a];
        else if (side === 'left') [x, y] = [anchor.x - away - d - size.width, cy - size.height / 2 + a];
        else if (side === 'bottom') [x, y] = [cx - size.width / 2 + a, anchor.y + anchor.height + away + d];
        else [x, y] = [cx - size.width / 2 + a, anchor.y - away - d - size.height];
        const box = { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height };
        // Across its group's edge, growing it, a little further; outside it, further still.
        const inHome = !homeRec || withinRect(box, homeRec);
        const outHome = homeRec && (box.x >= homeRec.x + homeRec.width || box.x + box.width <= homeRec.x || box.y >= homeRec.y + homeRec.height || box.y + box.height <= homeRec.y);
        const leaves = inHome ? 1 : outHome ? 1.3 : 1.15;
        const dist = Math.hypot(box.x + size.width / 2 - cx, box.y + size.height / 2 - cy);
        // Nearest; after the anchor rather than before it, where that's all between them.
        out.push({ box, side, score: (dist + Math.abs(a) * align + (a < 0 ? 1 : 0)) * weight * leaves });
      }
    }
  });
  out.sort((p, q) => p.score - q.score);
  const found = out.find((c) => free(c.box));
  if (!found) return null;
  // Then as near as it goes, a step at a time: in line with the anchor, then toward it.
  const box = Object.assign({}, found.box);
  const vertical = found.side === 'top' || found.side === 'bottom';
  const across = vertical ? 'x' : 'y';
  const depth = vertical ? 'y' : 'x';
  const lineUp = vertical ? cx - size.width / 2 : cy - size.height / 2;
  const depthStart =
    found.side === 'right' ? anchor.x + anchor.width + away
      : found.side === 'left' ? anchor.x - away - size.width
        : found.side === 'bottom' ? anchor.y + anchor.height + away
          : anchor.y - away - size.height;
  [[across, Math.round(lineUp)], [depth, Math.round(depthStart)]].forEach(([axis, goal]) => {
    while (box[axis] !== goal) {
      const step = box[axis] > goal ? -1 : 1;
      box[axis] += step;
      if (!free(box)) {
        box[axis] -= step;
        break;
      }
    }
  });
  return { x: box.x, y: box.y, side: found.side };
}

/** The arrows that make a card hang from another: [edge record, parent id], as arrowLinks reads them. */
function arrowsInto(model, id) {
  const out = [];
  model.edges.forEach((e) => {
    const a = model.byId.get(e.from);
    const b = model.byId.get(e.to);
    if (!a || !b || a === b || isGroupRecord(a) || isGroupRecord(b)) return;
    const reversed = e.fromEnd === 'arrow' && e.toEnd !== 'arrow';
    const child = reversed ? e.from : e.to;
    if (child === id) out.push([e, reversed ? e.to : e.from]);
  });
  return out;
}

class CanvasMindMap extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasMindMap',
        name: 'Mind map keys',
        desc: 'Tab adds a card below the selected one, Enter one beside it, and Alt and an arrow moves between cards.',
      },
      {
        key: 'canvasMindMapPlace',
        type: 'dropdown',
        name: 'New cards go',
        desc: 'Where Tab and Enter put the new card.',
        options: { free: 'In the nearest free space', line: 'In line, making room' },
        showIf: 'canvasMindMap',
      },
      {
        key: 'canvasRelink',
        name: 'Drop to re-link',
        desc: 'Drop a card onto another to make it hang from that one, its branch coming along. Undo puts it back.',
      },
    ];
  }

  /** On with either of its settings: the keys, or dropping onto a card. */
  get enabled() {
    return !!(this.settings.canvasMindMap || this.settings.canvasRelink);
  }

  get keys() {
    return !!this.settings.canvasMindMap;
  }

  commands() {
    const one = () => (this.keys ? this.selectedCard(this.pageCanvas()) : null);
    const ways = [
      ['left', 'Select the card to the left'],
      ['right', 'Select the card to the right'],
      ['up', 'Select the card above'],
      ['down', 'Select the card below'],
    ];
    return [
      {
        id: 'canvas-add-child-card',
        name: 'Add a card the selected card leads to',
        icon: 'git-branch-plus',
        check: () => !!one(),
        run: () => this.addChild(this.pageCanvas(), one()),
      },
      {
        id: 'canvas-add-sibling-card',
        name: 'Add a card beside the selected card',
        icon: 'list-plus',
        check: () => !!one(),
        run: () => this.addSibling(this.pageCanvas(), one()),
      },
    ].concat(
      ways.map(([way, name]) => ({
        id: `canvas-select-${way}`,
        name,
        icon: `arrow-${way}`,
        check: () => !!one(),
        run: () => this.step(this.pageCanvas(), way),
      }))
    );
  }

  /** The one selected card — not a group, nor one in a fold — or null. */
  selectedCard(view) {
    const selected = this.selectedNodes(view);
    if (selected.length !== 1) return null;
    const node = selected[0];
    if (!node || !node.nodeEl || isCanvasEdge(node) || isGroupNode(node) || tuckOf(node)) return null;
    return node;
  }

  mount(view, state) {
    if (!view.containerEl) return;
    state.keys = (evt) => this.onKey(view, evt);
    view.containerEl.addEventListener('keydown', state.keys);
    // A card being typed in may be a page of its own inside the canvas,
    // whose keys reach only the window: Escape is listened for there.
    state.win = view.containerEl.ownerDocument.defaultView;
    state.escape = (evt) => this.onEscape(view, evt);
    if (state.win) state.win.addEventListener('keydown', state.escape, true);
    // A card dragged, and dropped onto another.
    state.down = (evt) => this.onPointerDown(view, state, evt);
    state.move = (evt) => this.onPointerMove(view, state, evt);
    state.up = (evt) => this.onPointerUp(view, state, evt);
    view.contentEl.addEventListener('pointerdown', state.down, true);
    if (state.win) {
      state.win.addEventListener('pointermove', state.move, true);
      state.win.addEventListener('pointerup', state.up, true);
    }
  }

  cleanup(view, state) {
    if (state && state.keys && view.containerEl) view.containerEl.removeEventListener('keydown', state.keys);
    if (state && state.win && state.escape) state.win.removeEventListener('keydown', state.escape, true);
    if (state && state.down) view.contentEl.removeEventListener('pointerdown', state.down, true);
    if (state && state.win && state.move) {
      state.win.removeEventListener('pointermove', state.move, true);
      state.win.removeEventListener('pointerup', state.up, true);
    }
    if (state) this.markTarget(state, null);
  }

  /** The card of this canvas an element is part of, or null. */
  nodeFor(view, el) {
    const cardEl = el && typeof el.closest === 'function' ? el.closest('.canvas-node') : null;
    if (!cardEl || !view.canvas || !view.canvas.nodes) return null;
    let found = null;
    view.canvas.nodes.forEach((node) => {
      if (node.nodeEl === cardEl) found = node;
    });
    return found;
  }

  /** A press on a card: where it was, in case it's dragged onto another. */
  onPointerDown(view, state, evt) {
    state.drag = null;
    if (!this.settings.canvasRelink || evt.button !== 0 || (view.canvas && view.canvas.readonly)) return;
    const node = this.nodeFor(view, evt.target);
    if (!node || isGroupNode(node) || tuckOf(node) || node.isEditing) return;
    state.drag = { id: node.id, x: node.x, y: node.y, over: null, branch: null };
  }

  /** While it's dragged: the card it would hang from, dropped here, marked. */
  onPointerMove(view, state, evt) {
    const drag = state.drag;
    if (!drag) return;
    const canvas = view.canvas;
    const node = canvas && canvas.nodes && canvas.nodes.get(drag.id);
    const moved = !!node && (node.x !== drag.x || node.y !== drag.y);
    const alone = this.selectedNodes(view).length <= 1;
    this.markTarget(state, moved && alone ? this.dropTarget(view, node, drag, evt) : null);
  }

  onPointerUp(view, state) {
    const drag = state.drag;
    state.drag = null;
    const target = drag && drag.over;
    this.markTarget(state, null);
    if (!drag || !target) return;
    // Once the canvas has put the card down where it was dropped.
    window.setTimeout(() => this.relink(view, drag, target), 0);
  }

  /** The card under the pointer a dragged card could hang from: not itself, nor in its branch, nor a group. */
  dropTarget(view, node, drag, evt) {
    const canvas = view.canvas;
    if (!drag.branch) {
      const model = canvasModel(canvas);
      drag.branch = new Set(branchOf(model, node.id, arrowLinks(model)));
    }
    let pos = null;
    try {
      if (typeof canvas.posFromEvt === 'function') pos = canvas.posFromEvt(evt);
    } catch (err) {
      pos = null;
    }
    if (!pos) pos = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
    let found = null;
    canvas.nodes.forEach((n) => {
      if (n === node || drag.branch.has(n.id) || !n.nodeEl || isGroupNode(n) || tuckOf(n)) return;
      if (pos.x < n.x || pos.x > n.x + n.width || pos.y < n.y || pos.y > n.y + n.height) return;
      if (!found || (n.zIndex || 0) > (found.zIndex || 0)) found = n;
    });
    return found;
  }

  /** The card a dragged one would hang from, marked — by an attribute, as the canvas redraws a card's classes as it goes. */
  markTarget(state, target) {
    if (state.marked !== target && state.marked && state.marked.nodeEl) delete state.marked.nodeEl.dataset.drDropTarget;
    state.marked = target || null;
    if (target && target.nodeEl) target.nodeEl.dataset.drDropTarget = '';
    if (state.drag) state.drag.over = target || null;
  }

  /**
   * A card dropped onto another: made to hang from it — the arrows into
   * it from elsewhere taken away, one from the new card drawn — and put,
   * with its branch, in the nearest free space by its new card, gliding
   * there. Saved, so Undo puts it back.
   */
  relink(view, drag, targetNode) {
    const canvas = view.canvas;
    if (!canvas) return Promise.resolve(false);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(canvas);
    const rec = model.byId.get(drag.id);
    const target = model.byId.get(targetNode.id);
    if (!rec || !target || rec === target || rec.tuck || target.tuck || isGroupRecord(rec) || isGroupRecord(target)) return Promise.resolve(false);
    const links = arrowLinks(model);
    const branch = branchOf(model, rec.id, links);
    if (branch.indexOf(target.id) !== -1) return Promise.resolve(false);
    const before = snapshotModel(model);
    // Its branch stayed where the card was before it was dragged: the two go together.
    const members = [rec].concat(branch.map((id) => model.byId.get(id)).filter((r) => r && !r.tuck));
    const whole = boundsOf(members.map((r) => (r === rec ? { x: drag.x, y: drag.y, width: r.width, height: r.height } : r)));
    const spot = freeSpot(model, target, { width: whole.width, height: whole.height }, this.growthSide(model, links, target), {
      skip: new Set(members.map((r) => r.id)),
    });
    const dx = spot ? spot.x - whole.x : 0;
    const dy = spot ? spot.y - whole.y : 0;
    const moved = new Set();
    shiftRecord(model, rec, 'x', drag.x + dx - rec.x, moved);
    moved.clear();
    shiftRecord(model, rec, 'y', drag.y + dy - rec.y, moved);
    members.slice(1).forEach((r) => {
      const once = new Set();
      shiftRecord(model, r, 'x', dx, once);
      once.clear();
      shiftRecord(model, r, 'y', dy, once);
    });
    // Its arrows: from the new card only.
    const into = arrowsInto(model, rec.id);
    try {
      into.forEach(([e, parent]) => {
        if (parent !== target.id && e.edge && typeof canvas.removeEdge === 'function') canvas.removeEdge(e.edge);
      });
      if (!into.some(([, parent]) => parent === target.id) && typeof canvas.importData === 'function') {
        const sides = spot ? { from: spot.side, to: OPPOSITE_SIDE[spot.side] } : nearestSides(boxEdges(target), boxEdges(rec));
        canvas.importData({ nodes: [], edges: [{ id: newCanvasId(canvas), fromNode: target.id, fromSide: sides.from, toNode: rec.id, toSide: sides.to }] });
      }
    } catch (err) {
      /* the arrows as they were */
    }
    const state = fold ? fold.watched.get(view) : null;
    return new Promise((resolve) => {
      glideCanvasModel(view, model, before, state, () => {
        try {
          canvas.requestSave();
        } catch (err) {
          /* saved with the next change */
        }
        if (fold) fold.schedule(view);
        this.app.workspace.trigger('design-redux:canvas-changed', view);
        if (typeof Notice === 'function') new Notice(`“${canvasCardLabel(rec)}” now hangs from “${canvasCardLabel(target)}”. Undo puts it back.`);
        resolve(true);
      });
    });
  }

  /** The way a card's branch grows: its own, or the branch it's in, or rightwards. */
  growthSide(model, links, card) {
    if (shownChildren(model, links, card.id).length) return branchSide(model, card.id, links);
    const up = (links.parents.get(card.id) || []).map((id) => model.byId.get(id)).find((r) => r && !r.tuck);
    return up ? branchSide(model, up.id, links) : 'right';
  }

  /** Escape in a card being typed in: done typing, the card still selected, for the next key. */
  onEscape(view, evt) {
    if (!this.keys || evt.key !== 'Escape' || evt.isComposing || evt.shiftKey || evt.ctrlKey || evt.metaKey || evt.altKey) return;
    const editing = this.editingCard(view, evt.target);
    if (!editing) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.doneTyping(view, editing);
  }

  onKey(view, evt) {
    if (!this.keys || evt.defaultPrevented || evt.isComposing || typingInto(evt.target)) return;
    const canvas = view.canvas;
    if (!canvas || canvas.readonly) return;
    const node = this.selectedCard(view);
    if (!node || node.isEditing) return;
    const plain = !evt.shiftKey && !evt.ctrlKey && !evt.metaKey && !evt.altKey;
    const arrows = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    let done = null;
    if (plain && evt.key === 'Tab') done = () => this.addChild(view, node);
    else if (plain && evt.key === 'Enter') done = () => this.addSibling(view, node);
    else if (evt.altKey && !evt.ctrlKey && !evt.metaKey && !evt.shiftKey && arrows[evt.key]) done = () => this.step(view, arrows[evt.key]);
    if (!done) return;
    evt.preventDefault();
    evt.stopPropagation();
    done();
  }

  /** The card of this canvas being typed in that a key went to — in it, or in a page inside it — or null. */
  editingCard(view, target) {
    if (!target || !view.canvas || !view.canvas.nodes) return null;
    let frame = null;
    try {
      const win = target.ownerDocument && target.ownerDocument.defaultView;
      frame = win && win.frameElement ? win.frameElement : null;
    } catch (err) {
      frame = null;
    }
    let found = null;
    try {
      view.canvas.nodes.forEach((node) => {
        if (!node.isEditing || !node.nodeEl) return;
        if (node.nodeEl.contains(target) || (frame && node.nodeEl.contains(frame))) found = node;
      });
    } catch (err) {
      found = null;
    }
    return found;
  }

  /** Typing in a card ended, the card left selected, and the canvas given the keys again. */
  doneTyping(view, node) {
    const canvas = view.canvas;
    try {
      // Out of the editor, as clicking away puts it, but still selected.
      if (typeof node.blur === 'function') node.blur();
      if (typeof node.setIsEditing === 'function') node.setIsEditing(false);
      canvas.selectOnly(node);
      const wrapper = canvas.wrapperEl || view.contentEl.querySelector('.canvas-wrapper');
      if (wrapper && typeof wrapper.focus === 'function') wrapper.focus();
    } catch (err) {
      /* left as it was */
    }
  }

  addMenuItems(menu, nodes) {
    if (!this.keys || nodes.length !== 1) return;
    const node = nodes[0];
    const view = node && node.canvas && node.canvas.view;
    if (!view || !node.nodeEl || isCanvasEdge(node) || isGroupNode(node) || tuckOf(node) || (view.canvas && view.canvas.readonly)) return;
    menu.addItem((item) =>
      item
        .setTitle('Add card after')
        .setIcon('git-branch-plus')
        .setSection('action')
        .onClick(() => this.addChild(view, node))
    );
    menu.addItem((item) =>
      item
        .setTitle('Add card beside')
        .setIcon('list-plus')
        .setSection('action')
        .onClick(() => this.addSibling(view, node))
    );
  }

  /** Whether new cards go in free space, rather than in line. */
  get placesFreely() {
    return this.settings.canvasMindMapPlace !== 'line';
  }

  /** A card the selected card's arrow leads to, after any it leads to already. */
  addChild(view, node) {
    if (!view || !view.canvas || !node) return Promise.resolve(null);
    const model = canvasModel(view.canvas);
    const parent = model.byId.get(node.id);
    if (!parent) return Promise.resolve(null);
    const links = arrowLinks(model);
    const kids = shownChildren(model, links, parent.id);
    // The way it grows: its own branch's, or — a card with nothing after
    // it yet — the way the branch it's in grows, or rightwards.
    let side = kids.length ? branchSide(model, parent.id, links) : null;
    if (!side) {
      const up = (links.parents.get(parent.id) || []).map((id) => model.byId.get(id)).find((r) => r && !r.tuck);
      side = up ? branchSide(model, up.id, links) : 'right';
    }
    const axes = sideAxes(side);
    const size = this.sizeFor(view, kids.length ? kids[kids.length - 1] : null, parent);
    if (this.placesFreely) {
      // Level with the cards after it, where it has some.
      let away = TIDY_DEPTH_GAP;
      if (kids.length) {
        const depthSize = axes.depth === 'x' ? 'width' : 'height';
        away = axes.forward
          ? Math.min(...kids.map((k) => k[axes.depth])) - (parent[axes.depth] + parent[depthSize])
          : parent[axes.depth] - Math.max(...kids.map((k) => k[axes.depth] + k[depthSize]));
        if (!(away > 0)) away = TIDY_DEPTH_GAP;
      }
      const spot = freeSpot(model, parent, size, side, { away });
      if (spot) {
        const box = { x: spot.x, y: spot.y, width: size.width, height: size.height };
        // Its arrow out of the side it went out of, as the branch's others.
        return this.grow(view, parent, box, { from: parent, fromSide: spot.side, toSide: OPPOSITE_SIDE[spot.side] }, null, kids[kids.length - 1], true);
      }
    }
    const box = { width: size.width, height: size.height, x: 0, y: 0 };
    const depth = axes.depth;
    const across = axes.across;
    const dSize = depth === 'x' ? 'width' : 'height';
    const aSize = across === 'x' ? 'width' : 'height';
    if (kids.length) {
      // Level with the cards after it, past the last of them.
      const near = Math.min(...kids.map((k) => k[depth]));
      const far = Math.max(...kids.map((k) => k[depth] + k[dSize]));
      box[depth] = axes.forward ? near : far - box[dSize];
      box[across] = Math.max(...kids.map((k) => k[across] + k[aSize])) + TIDY_SIBLING_GAP;
    } else {
      box[depth] = axes.forward ? parent[depth] + parent[dSize] + TIDY_DEPTH_GAP : parent[depth] - TIDY_DEPTH_GAP - box[dSize];
      box[across] = Math.round(parent[across] + parent[aSize] / 2 - box[aSize] / 2);
    }
    return this.grow(view, parent, box, { from: parent, fromSide: side, toSide: OPPOSITE_SIDE[side] }, across, kids[kids.length - 1]);
  }

  /**
   * A card beside the selected one: the next of what its parent leads
   * to, joined to the parent as it is; or, a card nothing leads to, the
   * next card along, not joined to anything.
   */
  addSibling(view, node) {
    if (!view || !view.canvas || !node) return Promise.resolve(null);
    const model = canvasModel(view.canvas);
    const card = model.byId.get(node.id);
    if (!card) return Promise.resolve(null);
    const links = arrowLinks(model);
    const parent = (links.parents.get(card.id) || []).map((id) => model.byId.get(id)).find((r) => r && !r.tuck);
    let side;
    let join = null;
    if (parent) {
      const edge = model.edges.find((e) => e.from === parent.id && e.to === card.id) || model.edges.find((e) => e.to === parent.id && e.from === card.id);
      side = branchSide(model, parent.id, links);
      join = {
        from: parent,
        fromSide: edge && edge.from === parent.id ? edge.fromSide : side,
        toSide: edge && edge.from === parent.id ? edge.toSide : OPPOSITE_SIDE[side],
      };
    } else {
      side = shownChildren(model, links, card.id).length ? branchSide(model, card.id, links) : 'right';
    }
    const axes = sideAxes(side);
    const across = axes.across;
    const aSize = across === 'x' ? 'width' : 'height';
    const size = this.sizeFor(view, card, card);
    if (this.placesFreely) {
      // Beside it, after it the way its siblings line up, in the nearest free space.
      const after = across === 'y' ? 'bottom' : 'right';
      // In its column, rather than off to one side: beside it is the next of its parent's.
      const spot = freeSpot(model, card, size, after, { away: TIDY_SIBLING_GAP, beside: 2.5, behind: 2, align: 1 });
      if (spot) {
        const box = { x: spot.x, y: spot.y, width: size.width, height: size.height };
        // Joined as the card beside it is.
        return this.grow(view, parent || card, box, join, null, card, true);
      }
    }
    const box = { x: card.x, y: card.y, width: size.width, height: size.height };
    // Its own branch, if it has one, stays clear: the new card goes past it.
    const own = [card].concat(branchOf(model, card.id, links).map((id) => model.byId.get(id)).filter((r) => r && !r.tuck));
    box[across] = Math.max(...own.map((r) => r[across] + r[aSize])) + TIDY_SIBLING_GAP;
    return this.grow(view, parent || card, box, join, across, card);
  }

  /** The size of a new card: as the one beside it, or as wide as the one it hangs from and the canvas's height for a new card. */
  sizeFor(view, like, fallback) {
    const base = (view.canvas.config && view.canvas.config.defaultTextNodeDimensions) || { width: 250, height: 60 };
    const from = like && !isGroupRecord(like) ? like : null;
    if (from) return { width: from.width, height: from.fold ? base.height : from.height };
    return { width: fallback && !isGroupRecord(fallback) ? fallback.width : base.width, height: base.height };
  }

  /**
   * The new card made at `box` and joined to what it hangs from, with
   * room made for it where cards were in the way, and its group grown
   * round it. It comes out of the card it hangs from, as an unfolding
   * card does; saved as one step of Undo, then opened to type in.
   */
  grow(view, from, box, join, across, like, free) {
    const canvas = view.canvas;
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    if (typeof canvas.createTextNode !== 'function') return Promise.resolve(null);
    let node = null;
    try {
      node = canvas.createTextNode({ pos: { x: box.x, y: box.y }, size: { width: box.width, height: box.height }, text: '', focus: false, save: false });
      // The colour of the card beside it, as a branch keeps one.
      if (like && like.color && typeof node.setColor === 'function') node.setColor(like.color);
      if (join && typeof canvas.importData === 'function') {
        canvas.importData({
          nodes: [],
          edges: [{ id: newCanvasId(canvas), fromNode: join.from.id, fromSide: join.fromSide, toNode: node.id, toSide: join.toSide }],
        });
      }
    } catch (err) {
      return Promise.resolve(node);
    }
    if (!node) return Promise.resolve(null);
    const model = canvasModel(canvas);
    const rec = model.byId.get(node.id);
    const holder = model.byId.get(from.id);
    if (!rec || !holder) return Promise.resolve(this.opened(view, node, false));
    // As though it had been tucked into what it hangs from: so it comes
    // out of it, and its group takes it in.
    rec.tuck = { by: holder.id, dx: rec.x - holder.x, dy: rec.y - holder.y };
    const before = snapshotModel(model);
    rec.tuck = null;
    // In free space nothing's in its way; in line, room is made for it.
    const close = this.settings.canvasCloseGaps !== false;
    if (close && !free) this.makeWay(model, before, rec, holder, across || 'y');
    // Its group grown round it — and round what moved for it — only where something now sticks out.
    if ((close || free) && this.sticksOut(model, before)) fitGroups(model, before);
    const state = fold ? fold.watched.get(view) : null;
    return new Promise((resolve) => {
      glideCanvasModel(view, model, before, state, () => resolve(this.opened(view, node, true)));
    });
  }

  /** Cards where the new one lands moved on along `axis`, the way its neighbours line up, by its size and a gap. */
  makeWay(model, before, rec, holder, axis) {
    const homes = homesBefore(model, before);
    const home = homes.get(holder.id) || null;
    const pad = TIDY_SIBLING_GAP / 2;
    const hits = model.nodes.filter(
      (n) =>
        n !== rec &&
        n !== holder &&
        !n.tuck &&
        !isGroupRecord(n) &&
        homes.get(n.id) === home &&
        Math.min(n.x + n.width, rec.x + rec.width + pad) - Math.max(n.x, rec.x - pad) > 0 &&
        Math.min(n.y + n.height, rec.y + rec.height + pad) - Math.max(n.y, rec.y - pad) > 0
    );
    if (!hits.length) return;
    const p = axisParts(axis);
    makeRoom(model, before, {
      origin: new Set([rec.id, holder.id]),
      home,
      axis,
      side: 'after',
      at: Math.min(...hits.map(p.near)),
      delta: p.far(rec) + TIDY_SIBLING_GAP - Math.min(...hits.map(p.near)),
      span: [p.lo(rec), p.hi(rec)],
    });
  }

  /** Whether a card has ended up partly outside the group it belongs to. */
  sticksOut(model, before) {
    const homeOf = foldHomes(model, before);
    return model.nodes.some((n) => {
      const home = !n.tuck ? homeOf(n.id) : null;
      const group = home ? model.byId.get(home) : null;
      return !!group && !group.tuck && !withinRect(n, group);
    });
  }

  /** The new card saved, selected and opened to type in. */
  opened(view, node, changed) {
    const canvas = view.canvas;
    try {
      canvas.requestSave();
      if (typeof node.attach === 'function' && node.nodeEl && !node.nodeEl.isConnected) node.attach();
      if (typeof node.render === 'function') node.render();
      if (typeof canvas.selectOnly === 'function') canvas.selectOnly(node);
      if (typeof canvas.panIntoView === 'function') canvas.panIntoView(node.getBBox());
      if (typeof node.startEditing === 'function') node.startEditing();
    } catch (err) {
      /* made, if not opened */
    }
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.schedule(view);
    if (changed) this.app.workspace.trigger('design-redux:canvas-changed', view);
    return node;
  }

  /** The next card one way from the selected one, selected and brought into view. */
  step(view, way) {
    const node = this.selectedCard(view);
    if (!node) return null;
    const model = canvasModel(view.canvas);
    const from = model.byId.get(node.id);
    const links = arrowLinks(model);
    const linked = new Set((links.parents.get(node.id) || []).concat(links.children.get(node.id) || []));
    const to = from ? cardTowards(model, from, way, linked) : null;
    if (!to || !to.node) return null;
    try {
      view.canvas.selectOnly(to.node);
      if (typeof view.canvas.panIntoView === 'function') view.canvas.panIntoView(to.node.getBBox());
    } catch (err) {
      /* left where it was */
    }
    return to.node;
  }
}

CanvasMindMap.settingKey = 'canvasMindMap';
