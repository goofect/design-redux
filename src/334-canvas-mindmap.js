/* ------------------------------------------------------------------ */
/* Growing a mind map                                                  */
/*                                                                     */
/* With one card selected: Tab adds a card its arrow leads to, Enter   */
/* adds one beside it — the next of its parent's — each placed in line */
/* with the cards already there, the way the branch grows, with room   */
/* made for it and its group grown round it; it grows out of the card  */
/* it hangs from, and opens to be typed in. Alt and an arrow key moves */
/* to the next card that way. The same from the card's right-click     */
/* menu, and as commands to give other keys.                          */
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

class CanvasMindMap extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasMindMap',
        name: 'Build a mind map with keys',
        desc: 'With one card selected, Tab adds a card its arrow leads to and Enter one beside it, each placed in line with the others and opened to type in; Escape finishes typing, ready for the next. Alt and an arrow key moves to the next card that way. Also in a card’s right-click menu.',
      },
    ];
  }

  commands() {
    const one = () => this.selectedCard(this.pageCanvas());
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
  }

  cleanup(view, state) {
    if (state && state.keys && view.containerEl) view.containerEl.removeEventListener('keydown', state.keys);
    if (state && state.win && state.escape) state.win.removeEventListener('keydown', state.escape, true);
  }

  /** Escape in a card being typed in: done typing, the card still selected, for the next key. */
  onEscape(view, evt) {
    if (!this.enabled || evt.key !== 'Escape' || evt.isComposing || evt.shiftKey || evt.ctrlKey || evt.metaKey || evt.altKey) return;
    const editing = this.editingCard(view, evt.target);
    if (!editing) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.doneTyping(view, editing);
  }

  onKey(view, evt) {
    if (!this.enabled || evt.defaultPrevented || evt.isComposing || typingInto(evt.target)) return;
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
    if (nodes.length !== 1) return;
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
  grow(view, from, box, join, across, like) {
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
    const close = this.settings.canvasCloseGaps !== false;
    if (close) {
      this.makeWay(model, before, rec, holder, across || 'y');
      // Its group grown round it — and round what moved for it — only where something now sticks out.
      if (this.sticksOut(model, before)) fitGroups(model, before);
    }
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
