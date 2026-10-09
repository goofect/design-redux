/* ------------------------------------------------------------------ */
/* Canvas: laying out a branch                                         */
/*                                                                     */
/* A branch laid out one way or another: as a tidy tree growing right, */
/* left, down or up, out both sides of its card, or round it. Its      */
/* cards keep the order they're in, so laying it out again the same    */
/* way changes nothing; the card stays where it is, the cards round    */
/* the branch keep their distance, and its arrows leave and arrive on  */
/* the sides that face. One step of Undo, gliding there as Tidy does.  */
/* ------------------------------------------------------------------ */

const BRANCH_LAYOUTS = [
  ['right', 'To the right', 'arrow-right'],
  ['left', 'To the left', 'arrow-left'],
  ['bottom', 'Downward', 'arrow-down'],
  ['top', 'Upward', 'arrow-up'],
  ['both', 'Both sides', 'arrow-left-right'],
  ['radial', 'All round', 'sun'],
];

function centreOf(r) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** An angle from straight up, going clockwise, in [0, 2π). */
function clockwiseFromTop(from, to) {
  const a = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2;
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Cards in the order they're in now: lying out one side of their card,
 * along the row or column they make; spread round it, clockwise from
 * the top.
 */
function siblingOrder(parent, cards) {
  if (cards.length < 2) return cards.slice();
  const from = centreOf(parent);
  const ways = cards.map((c) => {
    const m = centreOf(c);
    return { c, dx: m.x - from.x, dy: m.y - from.y };
  });
  const mx = ways.reduce((s, w) => s + w.dx, 0);
  const my = ways.reduce((s, w) => s + w.dy, 0);
  // One side: every card less than a right angle from the way they lie on the whole.
  if ((mx || my) && ways.every((w) => w.dx * mx + w.dy * my > 0)) {
    const across = Math.abs(mx) >= Math.abs(my) ? 'y' : 'x';
    const other = across === 'x' ? 'y' : 'x';
    return cards.slice().sort((a, b) => a[across] - b[across] || a[other] - b[other]);
  }
  return cards.slice().sort((a, b) => clockwiseFromTop(from, centreOf(a)) - clockwiseFromTop(from, centreOf(b)));
}

/**
 * A branch as a tree: each shown card once, under the first card to
 * reach it, children in `order`. Map id -> [records]; groups take no part.
 */
function orderedBranch(model, rootId, links, order) {
  const root = model.byId.get(rootId);
  const kids = new Map();
  if (!root) return kids;
  const mine = new Set(branchOf(model, rootId, links));
  const seen = new Set([rootId]);
  const queue = [root];
  while (queue.length) {
    const n = queue.shift();
    const cs = shownChildren(model, links, n.id).filter((c) => mine.has(c.id) && !seen.has(c.id) && !isGroupRecord(c));
    cs.forEach((c) => seen.add(c.id));
    const sorted = order(n, cs);
    kids.set(n.id, sorted);
    sorted.forEach((c) => queue.push(c));
  }
  return kids;
}

/**
 * A branch as a tidy tree growing one way, or — 'both' — out both sides,
 * its first cards to the right and the rest to the left, by how many
 * cards each takes. id -> { x, y }, with `sides` and `both` as tidyBranch.
 */
function directedLayout(model, rootId, way, links) {
  links = links || arrowLinks(model);
  const out = new Map();
  out.sides = new Map();
  out.both = way === 'both';
  const root = model.byId.get(rootId);
  if (!root) return out;
  const kids = orderedBranch(model, rootId, links, siblingOrder);
  // Copies lined up in their order the way their siblings will, so the tidy keeps it.
  const ways = way === 'both' ? ['right', 'left'] : [way];
  const copies = new Map();
  const copy = (r) => {
    if (!copies.has(r.id)) copies.set(r.id, Object.assign({}, r));
    return copies.get(r.id);
  };
  const lined = new Map();
  kids.forEach((cs, id) => {
    lined.set(
      id,
      cs.map((c, i) => {
        const k = copy(c);
        k.x = i * 100000;
        k.y = i * 100000;
        return k;
      })
    );
  });
  const first = lined.get(rootId) || [];
  if (way !== 'both') {
    tidyOneWay(root, way, first, lined, out);
    return out;
  }
  // The first cards, by how many cards hang from them, out the right; the rest the left.
  const size = (id) => 1 + (kids.get(id) || []).reduce((n, c) => n + size(c.id), 0);
  const total = first.reduce((n, c) => n + size(c.id), 0);
  const right = [];
  const left = [];
  let taken = 0;
  first.forEach((c, i) => {
    const last = i === first.length - 1;
    if (!right.length || (taken < total / 2 && !(last && !left.length))) {
      right.push(c);
      taken += size(c.id);
    } else {
      left.push(c);
    }
  });
  // Clockwise, as a mind map reads: the left side from the bottom up.
  left.forEach((c, j) => {
    c.y = (left.length - j) * 100000;
  });
  if (right.length) tidyOneWay(root, ways[0], right, lined, out);
  if (left.length) tidyOneWay(root, ways[1], left, lined, out);
  return out;
}

/**
 * A branch round its card: each card at a distance from it by how many
 * steps away it is, in a share of the circle as large as the cards
 * at the ends of its own branch are many, clockwise from the top. Rings
 * far enough apart, and wide enough round, that no two cards meet.
 * id -> { x, y }.
 */
function radialLayout(model, rootId, links) {
  links = links || arrowLinks(model);
  const out = new Map();
  out.sides = new Map();
  out.both = true;
  const root = model.byId.get(rootId);
  if (!root) return out;
  const middle = centreOf(root);
  const around = (n) => clockwiseFromTop(middle, centreOf(n));
  // Around the root, clockwise from where each card's parent lies.
  const order = (parent, cards) => {
    const base = parent === root ? 0 : around(parent);
    const rel = (c) => {
      const a = around(c) - base + (parent === root ? 0 : Math.PI);
      return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    };
    return cards.slice().sort((a, b) => rel(a) - rel(b) || a.y - b.y || a.x - b.x);
  };
  const kids = orderedBranch(model, rootId, links, order);
  const leaves = new Map();
  const count = (id) => {
    const cs = kids.get(id) || [];
    const n = cs.length ? cs.reduce((s, c) => s + count(c.id), 0) : 1;
    leaves.set(id, n);
    return n;
  };
  const total = count(rootId);
  if (!(kids.get(rootId) || []).length) return out;
  // How far out each ring is.
  const half = (r) => Math.hypot(r.width, r.height) / 2;
  const reach = [half(root)];
  let widest = 0;
  const depthOf = new Map([[rootId, 0]]);
  kids.forEach((cs, id) => {
    cs.forEach((c) => {
      const d = depthOf.get(id) + 1;
      depthOf.set(c.id, d);
      reach[d] = Math.max(reach[d] || 0, half(c));
      widest = Math.max(widest, half(c) * 2);
    });
  });
  // Wide enough round that the narrowest share fits a card.
  const least = (total * (widest + TIDY_SIBLING_GAP)) / (2 * Math.PI);
  const radius = [0];
  for (let d = 1; d < reach.length; d++) {
    radius[d] = Math.max(radius[d - 1] + reach[d - 1] + reach[d] + TIDY_DEPTH_GAP, d === 1 ? least : 0);
  }
  const place = (id, start, span) => {
    let at = start;
    (kids.get(id) || []).forEach((c) => {
      const share = (span * leaves.get(c.id)) / leaves.get(id);
      const angle = at + share / 2 - Math.PI / 2;
      const r = radius[depthOf.get(c.id)];
      out.set(c.id, { x: Math.round(middle.x + r * Math.cos(angle) - c.width / 2), y: Math.round(middle.y + r * Math.sin(angle) - c.height / 2) });
      place(c.id, at, share);
      at += share;
    });
  };
  // The first card straight up from the root.
  const first = kids.get(rootId)[0];
  const firstShare = (2 * Math.PI * leaves.get(first.id)) / total;
  place(rootId, -firstShare / 2, 2 * Math.PI);
  return out;
}

class CanvasLayouts extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasLayouts',
        name: 'Lay out a branch',
        desc: 'From a card’s menu: its branch as a tree to the right, left, down or up, out both sides, or all round it.',
      },
    ];
  }

  sync() {}

  commands() {
    return BRANCH_LAYOUTS.map(([mode, title, icon]) => ({
      id: `canvas-layout-${mode === 'bottom' ? 'down' : mode === 'top' ? 'up' : mode}`,
      name: `Lay out the selected card’s branch: ${title.toLowerCase()}`,
      icon,
      check: () => {
        const view = this.pageCanvas();
        const nodes = this.selectedNodes(view);
        return this.enabled && nodes.length === 1 && this.hasBranch(view, nodes[0]);
      },
      run: () => {
        const view = this.pageCanvas();
        this.layout(view, this.selectedNodes(view)[0], mode);
      },
    }));
  }

  hasBranch(view, node) {
    if (!view || !view.canvas || view.canvas.readonly || !node || isCanvasEdge(node) || isGroupNode(node) || tuckOf(node)) return false;
    const model = canvasModel(view.canvas);
    return shownChildren(model, arrowLinks(model), node.id).some((c) => !isGroupRecord(c));
  }

  addMenuItems(menu, nodes) {
    if (nodes.length !== 1) return;
    const node = nodes[0];
    const view = node && node.canvas && node.canvas.view;
    if (!this.hasBranch(view, node)) return;
    menuGroup(
      menu,
      'Lay out branch',
      'layout-grid',
      (into, nested) => {
        BRANCH_LAYOUTS.forEach(([mode, title, icon]) => {
          into.addItem((item) => {
            item.setTitle(nested ? title : `Lay out branch: ${title.toLowerCase()}`).setIcon(icon);
            if (!nested) canvasAction(item);
            item.onClick(() => this.layout(view, node, mode));
          });
        });
      },
      'action'
    );
  }

  /** Where the branch's cards go for a layout. */
  places(model, rootId, mode, links) {
    return mode === 'radial' ? radialLayout(model, rootId, links) : directedLayout(model, rootId, mode, links);
  }

  /** The branch laid out, gliding there; its arrows then set to the sides that face, and saved. */
  layout(view, node, mode) {
    if (!view || !view.canvas || !node) return Promise.resolve(false);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const rec = model.byId.get(node.id);
    if (!rec || rec.tuck) return Promise.resolve(false);
    const links = arrowLinks(model);
    const places = this.places(model, rec.id, mode, links);
    if (!places.size) return Promise.resolve(false);
    const axes =
      mode === 'radial'
        ? { depth: 'x', across: 'y', forward: true, both: true }
        : Object.assign(sideAxes(mode === 'both' ? 'right' : mode), { both: mode === 'both' });
    const before = snapshotModel(model);
    placeBranch(model, rec, places, axes, this.settings.canvasCloseGaps !== false);
    const state = fold ? fold.watched.get(view) : null;
    return new Promise((resolve) => {
      glideCanvasModel(view, model, before, state, (changed) => resolve(this.laidOut(view, model, rec, places, links, mode, changed)));
    });
  }

  /** Each arrow within the branch from the side facing its card to the side facing back. */
  laidOut(view, model, rec, places, links, mode, changed) {
    const inside = new Set(Array.from(places.keys()).concat([rec.id]));
    model.edges.forEach((e) => {
      const reversed = e.fromEnd === 'arrow' && e.toEnd !== 'arrow';
      const parent = reversed ? e.to : e.from;
      const child = reversed ? e.from : e.to;
      if (!inside.has(parent) || !inside.has(child) || (links.children.get(parent) || []).indexOf(child) === -1) return;
      let out;
      let back;
      if (mode === 'radial') {
        const sides = nearestSides(boxEdges(model.byId.get(parent)), boxEdges(model.byId.get(child)));
        out = sides.from;
        back = sides.to;
      } else {
        out = places.sides.get(child) || mode;
        back = OPPOSITE_SIDE[out];
      }
      const fromSide = reversed ? back : out;
      const toSide = reversed ? out : back;
      if (e.fromSide === fromSide && e.toSide === toSide) return;
      if (setEdgeSides(e.edge, fromSide, toSide)) changed = true;
    });
    if (changed) {
      try {
        view.canvas.requestSave();
      } catch (err) {
        /* saved with the canvas's next change */
      }
    }
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.schedule(view);
    this.app.workspace.trigger('design-redux:canvas-changed', view);
    return changed;
  }
}

CanvasLayouts.settingKey = 'canvasLayouts';
