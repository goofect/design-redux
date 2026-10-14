/* ------------------------------------------------------------------ */
/* Canvas: live mind maps                                              */
/*                                                                     */
/* A canvas made a mind map lays itself out from its arrows, all the   */
/* time, so it can't drift. Each card's place is worked out from its   */
/* parent, its order among its siblings and its tree's layout; how far */
/* a card has been moved by hand from that spot is kept on it, as an   */
/* adjustment from its parent's, so its branch moves with it and every */
/* layout after respects it. Tidy clears them. A change to the tree —  */
/* a card added, taken away, re-linked, resized, folded — lays the map */
/* out again, gliding, in the same step of Undo as the change. Folding */
/* hides a branch and the map closes up; a group round a branch is     */
/* drawn round its cards wherever they go. Making a canvas a map keeps */
/* every card where it is; canvases not made maps aren't touched.      */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { canvasReadonly, cardElement, cardKept, keepOnCard, liveCards, saveInCurrentStep } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { arrowLinks, boundsOf, BRANCH_SIDES, canvasModel, groupContents, indexModel, isGroupRecord, ROOM_KEY, saveCanvas, shownChildren } from './316-canvas-tree.js';
import { shiftRecord, snapshotModel } from './317-canvas-room.js';
import { glideCanvasModel } from './318-canvas-motion.js';
import { BRANCH_LAYOUTS, faceArrows, layoutPlaces, orderedBranch, siblingOrder } from './325-canvas-layouts.js';
import { CanvasFold } from './335-canvas-fold.js';

/* On a card: how far it was moved by hand from its spot, from its parent's: { dx, dy }. */
export const NUDGE_KEY = 'drNudge';
/* On a tree's first card, or any card whose branch grows its own way: how it's laid out, one of BRANCH_LAYOUTS. */
export const MAP_LAYOUT_KEY = 'drLayout';
/* On a group: the branch it's drawn round, and the room it leaves round it: { id, pad: [left, top, right, bottom] }. */
export const FRAME_KEY = 'drFrames';

/** A card's adjustment, or none. */
export function nudgeOf(rec) {
  const n = rec && rec.node ? cardKept(rec.node, NUDGE_KEY) : null;
  return n && typeof n.dx === 'number' && typeof n.dy === 'number' ? n : null;
}

/** A tree's layout as kept on its first card, or null. */
export function keptLayout(rec) {
  const mode = rec && rec.node ? cardKept(rec.node, MAP_LAYOUT_KEY) : null;
  return BRANCH_LAYOUTS.some((b) => b[0] === mode) ? mode : null;
}

/** The branch a group is drawn round, or null. */
export function frameOf(rec) {
  const f = rec && rec.node ? cardKept(rec.node, FRAME_KEY) : null;
  return f && typeof f.id === 'string' && Array.isArray(f.pad) && f.pad.length === 4 ? f : null;
}

/** A card of a map and the cards below it, as laid out: [id]. */
export function branchIds(layout, id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) layout.parents.forEach((p, c) => p === out[i] && out.push(c));
  return out;
}

/**
 * Whether a group holds one branch of a map and nothing else, as the
 * cards lie now: { id, pad } — the card the branch starts at and the
 * room round it — or null.
 */
export function framedBranch(model, layout, group) {
  const ids = new Set(groupContents(model, group, false).filter((r) => !isGroupRecord(r)).map((r) => r.id));
  const tops = Array.from(ids).filter((id) => !ids.has(layout.parents.get(id)));
  if (tops.length !== 1 || !layout.spots.has(tops[0])) return null;
  const branch = branchIds(layout, tops[0]);
  if (branch.length !== ids.size || branch.some((id) => !ids.has(id))) return null;
  const box = boundsOf(branch.map((id) => model.byId.get(id)));
  const pad = [box.x - group.x, box.y - group.y, group.x + group.width - box.x - box.width, group.y + group.height - box.y - box.height];
  return { id: tops[0], pad: pad.map((v) => Math.round(v)) };
}

/** The trees of a map: the cards with a branch that hang from nothing shown. */
export function mapRoots(model, links) {
  const shown = (id) => {
    const r = model.byId.get(id);
    return !!r && !r.tuck;
  };
  return model.nodes.filter(
    (r) =>
      !r.tuck &&
      !isGroupRecord(r) &&
      !(links.parents.get(r.id) || []).some(shown) &&
      shownChildren(model, links, r.id).some((c) => !isGroupRecord(c))
  );
}

/** How a tree grows as it lies now: the one way its cards lie, out both sides, or all round. */
export function guessLayout(model, links, root) {
  const mid = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const from = mid(root);
  const ways = new Set();
  shownChildren(model, links, root.id).forEach((c) => {
    const to = mid(c);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    ways.add(Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'bottom' : 'top');
  });
  if (ways.size > 2 || (ways.size === 2 && !(ways.has('left') && ways.has('right')))) return 'radial';
  if (ways.size === 2) return 'both';
  return BRANCH_SIDES.find((s) => ways.has(s)) || 'right';
}

/**
 * Where a tree's cards go by its layout, a branch with a layout of its
 * own laid out by itself first and then placed as one block, its cards
 * coming along: id -> { x, y }, with `sides` for the arrows and
 * `branches` — each branch laid out its own way: { rec, mode, ids }.
 */
export function composedLayout(model, root, mode, links, depth) {
  const kids = orderedBranch(model, root.id, links, siblingOrder);
  // The nearest cards below with a layout of their own.
  const own = [];
  const queue = [root.id];
  while (queue.length) {
    (kids.get(queue.shift()) || []).forEach((c) => (keptLayout(c) && (depth || 0) < 20 ? own.push(c) : queue.push(c.id)));
  }
  if (!own.length) {
    const laid = layoutPlaces(model, root.id, mode, links);
    laid.branches = [];
    return laid;
  }
  const blocks = own.map((c) => {
    const sub = composedLayout(model, c, keptLayout(c), links, (depth || 0) + 1);
    const box = boundsOf([c].concat(Array.from(sub.keys()).map((id) => Object.assign({}, model.byId.get(id), sub.get(id)))));
    return { c, sub, box };
  });
  const blockOf = new Map(blocks.map((b) => [b.c.id, b]));
  const below = new Set();
  blocks.forEach((b) => b.sub.forEach((at, id) => below.add(id)));
  // Each such card as the box its branch makes, what's below it out of the way.
  const proxy = indexModel({
    nodes: model.nodes.map((r) => {
      const b = blockOf.get(r.id);
      if (b) return Object.assign({}, r, b.box);
      return below.has(r.id) ? Object.assign({}, r, { tuck: r.tuck || { by: root.id, dx: 0, dy: 0 } }) : r;
    }),
    edges: model.edges,
  });
  const laid = layoutPlaces(proxy, root.id, mode, links);
  const out = new Map();
  out.sides = new Map(laid.sides || []);
  out.both = laid.both;
  out.branches = [];
  laid.forEach((at, id) => {
    const b = blockOf.get(id);
    if (!b) return out.set(id, at);
    const dx = at.x - b.box.x;
    const dy = at.y - b.box.y;
    out.set(id, { x: b.c.x + dx, y: b.c.y + dy });
    b.sub.forEach((p, sid) => out.set(sid, { x: p.x + dx, y: p.y + dy }));
    (b.sub.sides || new Map()).forEach((side, sid) => out.sides.set(sid, side));
    out.branches.push({ rec: b.c, mode: keptLayout(b.c), ids: Array.from(b.sub.keys()), sides: b.sub.sides });
    b.sub.branches.forEach((x) => out.branches.push(x));
  });
  return out;
}

/**
 * Where each card of a map's trees goes: its spot by the layout alone
 * (`spots`), the card it hangs from (`parents`), and its place, with its
 * adjustment and those of the cards above it added (`places`) — id ->
 * { x, y }. A tree's first card stays where it is, and so does a card
 * kept in place, its branch laid out from where it is. `roots` lists
 * each tree, its layout and the layout's own answer. `loose`: a card
 * whose own adjustment is left out — where it would land, let go.
 */
export function mapLayout(model, links, opts = {}) {
  const spots = new Map();
  const parents = new Map();
  const places = new Map();
  const roots = [];
  const claimed = new Set();
  mapRoots(model, links).forEach((root) => {
    if (claimed.has(root.id)) return;
    const mode = keptLayout(root) || guessLayout(model, links, root);
    const laid = composedLayout(model, root, mode, links);
    const kids = orderedBranch(model, root.id, links, siblingOrder);
    roots.push({ rec: root, mode, laid });
    claimed.add(root.id);
    spots.set(root.id, { x: root.x, y: root.y });
    places.set(root.id, { x: root.x, y: root.y });
    // How far each card is from its spot: its adjustment and those above it.
    const off = new Map([[root.id, { dx: 0, dy: 0 }]]);
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift();
      (kids.get(id) || []).forEach((c) => {
        if (claimed.has(c.id) || !laid.has(c.id)) return;
        claimed.add(c.id);
        parents.set(c.id, id);
        const at = laid.get(c.id);
        const spot = { x: Math.round(at.x), y: Math.round(at.y) };
        spots.set(c.id, spot);
        const above = off.get(id);
        const own = c.pinned ? { dx: c.x - spot.x - above.dx, dy: c.y - spot.y - above.dy } : (opts.loose !== c.id && nudgeOf(c)) || { dx: 0, dy: 0 };
        const o = { dx: above.dx + own.dx, dy: above.dy + own.dy };
        off.set(c.id, o);
        places.set(c.id, { x: spot.x + o.dx, y: spot.y + o.dy });
        queue.push(c.id);
      });
    }
  });
  const layout = { roots, spots, parents, places };
  layout.frames = framePlaces(model, layout);
  return layout;
}

/** Where each group drawn round a branch goes, round its cards in their places: id -> { x, y, width, height }. */
export function framePlaces(model, layout) {
  const out = new Map();
  model.nodes.forEach((g) => {
    const f = !g.tuck && isGroupRecord(g) ? frameOf(g) : null;
    if (!f || !layout.places.has(f.id)) return;
    const box = boundsOf(
      branchIds(layout, f.id).map((id) => {
        const r = model.byId.get(id);
        const at = layout.places.get(id);
        return { x: at.x, y: at.y, width: r.width, height: r.height };
      })
    );
    out.set(g.id, { x: box.x - f.pad[0], y: box.y - f.pad[1], width: box.width + f.pad[0] + f.pad[2], height: box.height + f.pad[1] + f.pad[3] });
  });
  return out;
}

/** The adjustments that keep these cards where they are now, each from its parent's: id -> { dx, dy }. */
export function nudgesToKeep(model, layout, ids) {
  const off = (id) => {
    const r = model.byId.get(id);
    const s = layout.spots.get(id);
    return { dx: Math.round(r.x - s.x), dy: Math.round(r.y - s.y) };
  };
  const out = new Map();
  ids.forEach((id) => {
    const parent = layout.parents.get(id);
    if (!parent) return;
    const o = off(id);
    const p = off(parent);
    out.set(id, { dx: o.dx - p.dx, dy: o.dy - p.dy });
  });
  return out;
}

/** What a map's layout depends on, as a string to compare: its trees, each card's parent and size, which are kept in place. */
export function mapShape(model, layout) {
  const parts = layout.roots.map(({ rec, mode }) => `${rec.id}=${mode}:${rec.width}x${rec.height}`);
  layout.parents.forEach((parent, id) => {
    const r = model.byId.get(id);
    parts.push(`${id}<${parent}:${r.width}x${r.height}${r.pinned ? '!' : ''}`);
  });
  return parts.join('|');
}

/** The cards a card's arrows come from, as a string to compare. */
function arrowSources(links, id) {
  return (links.parents.get(id) || []).slice().sort().join(',');
}

/** Whether a card isn't at a place. */
function offPlace(rec, at) {
  return Math.abs(rec.x - at.x) > 0.5 || Math.abs(rec.y - at.y) > 0.5;
}

/** Whether a group isn't at a place, or its size. */
function offBox(rec, box) {
  return offPlace(rec, box) || Math.abs(rec.width - box.width) > 0.5 || Math.abs(rec.height - box.height) > 0.5;
}

/** The order of each card's children in a map, by where they lie: parent id -> [id]. */
export function siblingOrders(model, layout) {
  const kids = new Map();
  layout.parents.forEach((p, c) => {
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(model.byId.get(c));
  });
  const out = new Map();
  kids.forEach((cs, p) => out.set(p, siblingOrder(model.byId.get(p), cs).map((r) => r.id)));
  return out;
}

/** Arrows as they'd read with a card hung from another instead: { parents, children }. */
export function hungFrom(links, id, parent) {
  const parents = new Map(links.parents);
  const children = new Map();
  links.children.forEach((cs, p) => children.set(p, cs.filter((c) => c !== id)));
  parents.set(id, [parent]);
  children.set(parent, (children.get(parent) || []).concat([id]));
  return { parents, children };
}

/**
 * The card one arrow key's way along a map's tree from a card: the card
 * it hangs from, if that's the way; else the child that way nearest it;
 * else the next card that way of those it hangs beside. Or null.
 */
export function treeNeighbour(model, layout, id, way) {
  const rec = model.byId.get(id);
  if (!rec || !layout.places.has(id)) return null;
  const mid = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const wayTo = (b) => {
    const p = mid(rec);
    const q = mid(b);
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : dy >= 0 ? 'down' : 'up';
  };
  const gap = (b) => Math.hypot(mid(b).x - mid(rec).x, mid(b).y - mid(rec).y);
  const under = (p) => {
    const out = [];
    layout.parents.forEach((q, c) => q === p && c !== id && out.push(model.byId.get(c)));
    return out;
  };
  const parent = layout.parents.has(id) ? model.byId.get(layout.parents.get(id)) : null;
  if (parent && wayTo(parent) === way) return parent;
  const ahead = under(id).filter((k) => wayTo(k) === way).sort((a, b) => gap(a) - gap(b));
  if (ahead.length) return ahead[0];
  if (!parent) return null;
  const axis = way === 'up' || way === 'down' ? 'y' : 'x';
  const sign = way === 'down' || way === 'right' ? 1 : -1;
  const along = (b) => (mid(b)[axis] - mid(rec)[axis]) * sign;
  const beside = under(parent.id).filter((b) => along(b) > 0.5).sort((a, b) => along(a) - along(b));
  return beside[0] || null;
}

/**
 * A model's cards put in their places, and the groups drawn round
 * branches round them — moved with what's tucked into them, nothing
 * else. Whether anything moved.
 */
export function placeIn(model, layout) {
  let moving = false;
  const move = (rec, at, alone) => {
    const once = new Set();
    shiftRecord(model, rec, 'x', at.x - rec.x, once, alone);
    once.clear();
    shiftRecord(model, rec, 'y', at.y - rec.y, once, alone);
    moving = true;
  };
  layout.places.forEach((at, id) => {
    const rec = model.byId.get(id);
    if (rec && offPlace(rec, at)) move(rec, at, false);
  });
  layout.frames.forEach((box, id) => {
    const g = model.byId.get(id);
    if (!g || !offBox(g, box)) return;
    move(g, box, true);
    g.width = box.width;
    g.height = box.height;
  });
  return moving;
}

export class CanvasMap extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasMaps',
        name: 'Live mind maps',
        desc: 'A canvas you make a mind map lays itself out from its arrows as you change it, keeping how you moved cards by hand. Other canvases aren’t touched.',
      },
    ];
  }

  register() {
    super.register();
    this.plugin.registerEvent(this.app.workspace.on('design-redux:canvas-changed', (view) => this.schedule(view)));
  }

  actions() {
    const open = (ctx) => this.enabled && !!ctx.view && !!ctx.view.file && !canvasReadonly(ctx.view.canvas);
    return [
      {
        id: 'canvas-make-mind-map',
        name: 'Make this canvas a mind map',
        menu: 'Make the canvas a mind map',
        icon: 'network',
        on: 'canvas',
        when: (ctx) => open(ctx) && !this.isMap(ctx.view),
        run: (ctx) => this.makeMap(ctx.view),
      },
      {
        id: 'canvas-make-free-canvas',
        name: 'Make this canvas free again, not a mind map',
        menu: false,
        icon: 'move',
        on: 'canvas',
        when: (ctx) => open(ctx) && this.isMap(ctx.view),
        run: (ctx) => this.freeMap(ctx.view),
      },
      {
        id: 'canvas-map-tidy',
        name: 'Tidy the mind map: every card to its place',
        menu: false,
        icon: 'sparkles',
        on: 'canvas',
        when: (ctx) => open(ctx) && this.isMap(ctx.view),
        run: (ctx) => this.tidy(ctx.view, null),
      },
    ];
  }

  /** Whether a canvas is one made a mind map. */
  isMap(view) {
    return !!(view && view.file && (this.settings.canvasMapFiles || {})[view.file.path]);
  }

  /** The feature, if this canvas is a map it lays out. */
  static of(plugin, view) {
    const map = plugin && typeof plugin.feature === 'function' ? plugin.feature(CanvasMap) : null;
    return map && map.enabled && map.isMap(view) ? map : null;
  }

  async setMap(view, on) {
    const all = Object.assign({}, this.settings.canvasMapFiles || {});
    if (on) all[view.file.path] = true;
    else delete all[view.file.path];
    this.settings.canvasMapFiles = all;
    await this.plugin.saveSettings();
  }

  /**
   * The canvas made a mind map, every card where it is: each tree's
   * layout taken from how it grows now, and each card's distance from
   * its spot kept as its adjustment. One step of Undo.
   */
  async makeMap(view) {
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    mapRoots(model, links).forEach((root) => {
      if (!keptLayout(root)) keepOnCard(root.node, MAP_LAYOUT_KEY, guessLayout(model, links, root));
    });
    const layout = mapLayout(model, links);
    this.keep(model, layout, Array.from(layout.parents.keys()));
    // Folds made before stay folded; what they noted of the room they closed is dropped — the map closes up by itself.
    model.nodes.forEach((r) => r.node && cardKept(r.node, ROOM_KEY) !== undefined && keepOnCard(r.node, ROOM_KEY, undefined));
    this.frame(model, layout, model.nodes.filter((g) => isGroupRecord(g) && !g.tuck));
    saveCanvas(view.canvas);
    await this.setMap(view, true);
    const state = this.watched.get(view);
    if (state) this.remember(state, model, mapLayout(model, links));
    new Notice('This canvas is now a mind map: it lays itself out as you change it. Cards you move stay moved; “Tidy the mind map” puts each in its place.');
    return true;
  }

  /** The canvas a free one again: cards stay where they are, their adjustments forgotten. */
  async freeMap(view) {
    let any = false;
    liveCards(view.canvas).forEach((node) => {
      if (cardKept(node, NUDGE_KEY) === undefined) return;
      keepOnCard(node, NUDGE_KEY, undefined);
      any = true;
    });
    if (any) saveCanvas(view.canvas);
    await this.setMap(view, false);
    const state = this.watched.get(view);
    if (state) state.laid = null;
    new Notice('This canvas is free again: cards stay where you put them.');
    return true;
  }

  /** A branch's cards — or, given none, every card of the map — put back in their places, their adjustments cleared. One step of Undo. */
  tidy(view, node) {
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    let layout = mapLayout(model, links);
    const below = new Set();
    if (node) {
      const queue = [node.id];
      while (queue.length) {
        const id = queue.shift();
        layout.parents.forEach((p, c) => {
          if (p === id && !below.has(c)) {
            below.add(c);
            queue.push(c);
          }
        });
      }
    }
    let cleared = false;
    layout.parents.forEach((p, id) => {
      const rec = model.byId.get(id);
      if ((node && !below.has(id)) || !nudgeOf(rec)) return;
      keepOnCard(rec.node, NUDGE_KEY, undefined);
      cleared = true;
    });
    if (cleared) layout = mapLayout(model, links);
    const state = this.watched.get(view) || {};
    return this.layOut(view, state, model, layout, links, { save: true, changed: cleared });
  }

  /**
   * A card's branch laid out another way from now on — the tree's
   * layout, for its first card; one of its own, for any other, or none
   * if that's the way the branch above it grows — and every card of it
   * put in its place. One step of Undo.
   */
  setLayout(view, node, mode) {
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    let layout = mapLayout(model, links);
    const rec = model.byId.get(node.id);
    if (!rec || !layout.spots.has(rec.id)) return Promise.resolve(false);
    keepOnCard(rec.node, MAP_LAYOUT_KEY, layout.parents.has(rec.id) && mode === this.layoutAbove(model, layout, rec.id) ? undefined : mode);
    branchIds(layout, rec.id)
      .slice(1)
      .forEach((id) => keepOnCard(model.byId.get(id).node, NUDGE_KEY, undefined));
    layout = mapLayout(model, links);
    return this.layOut(view, this.watched.get(view) || {}, model, layout, links, { save: true, changed: true });
  }

  /** How the branch a card hangs in grows: the nearest card above with a layout of its own, or its tree's. */
  layoutAbove(model, layout, id) {
    let at = layout.parents.get(id);
    while (at) {
      const up = model.byId.get(at);
      if (!layout.parents.has(at)) return (layout.roots.find((t) => t.rec.id === at) || {}).mode;
      if (keptLayout(up)) return keptLayout(up);
      at = layout.parents.get(at);
    }
    return null;
  }

  mount(view, state) {
    // A card still held isn't where it's going: wait till it's let go.
    state.press = () => (state.pressing = true);
    state.release = () => {
      if (!state.pressing) return;
      state.pressing = false;
      this.ghost(state, null);
      state.schedule();
    };
    // While a card's dragged: a ghost where it would land, let go now.
    state.drag = () => {
      if (!state.pressing || state.previewing) return;
      state.previewing = window.requestAnimationFrame(() => {
        state.previewing = 0;
        if (state.pressing && this.watched.get(view) === state) this.preview(view, state);
      });
    };
    state.doc = view.containerEl.ownerDocument;
    view.containerEl.addEventListener('pointerdown', state.press, true);
    view.containerEl.addEventListener('pointermove', state.drag, { passive: true });
    state.doc.addEventListener('pointerup', state.release, true);
    state.doc.addEventListener('pointercancel', state.release, true);
  }

  cleanup(view, state) {
    if (!state || !state.press) return;
    view.containerEl.removeEventListener('pointerdown', state.press, true);
    view.containerEl.removeEventListener('pointermove', state.drag);
    state.doc.removeEventListener('pointerup', state.release, true);
    state.doc.removeEventListener('pointercancel', state.release, true);
    if (state.previewing) window.cancelAnimationFrame(state.previewing);
    this.ghost(state, null);
  }

  /**
   * Where the card being dragged would land if let go now — hung from
   * the card it's over, or put in its new place among the cards beside
   * it — shown as a ghost; none where it would stay where it's let go.
   */
  preview(view, state) {
    if (!this.enabled || !this.isMap(view) || !state.laid) return this.ghost(state, null);
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    const layout = mapLayout(model, links);
    const moved = Array.from(layout.parents.keys()).filter((id) => state.laid.has(id) && offPlace(model.byId.get(id), state.laid.get(id)));
    const movedSet = new Set(moved);
    const tops = moved.filter((id) => !movedSet.has(layout.parents.get(id)));
    if (tops.length !== 1) return this.ghost(state, null);
    const rec = model.byId.get(tops[0]);
    const over = view.contentEl.querySelector('[data-dr-drop-target]');
    const target = over ? model.nodes.find((r) => r.node && cardElement(r.node) === over) : null;
    let at = null;
    if (target && target.id !== rec.id) at = mapLayout(model, hungFrom(links, rec.id, target.id), { loose: rec.id }).places.get(rec.id);
    else if (this.reordered(state, model, layout, rec.id)) at = mapLayout(model, links, { loose: rec.id }).places.get(rec.id);
    this.ghost(state, at ? { x: at.x, y: at.y, width: rec.width, height: rec.height, host: cardElement(rec.node) } : null);
  }

  /** The ghost drawn at a box, beside the card it's for — or taken away. */
  ghost(state, box) {
    if (!box || !box.host || !box.host.parentElement) {
      if (state.ghostEl) state.ghostEl.remove();
      state.ghostEl = null;
      return;
    }
    if (!state.ghostEl || state.ghostEl.parentElement !== box.host.parentElement) {
      if (state.ghostEl) state.ghostEl.remove();
      state.ghostEl = box.host.parentElement.createDiv({ cls: 'dr-map-ghost' });
    }
    Object.assign(state.ghostEl.style, { transform: `translate(${box.x}px, ${box.y}px)`, width: `${box.width}px`, height: `${box.height}px` });
  }

  /** Whether a card now lies in another place among the cards beside it than it did. */
  reordered(state, model, layout, id) {
    const parent = layout.parents.get(id);
    const was = state.order && state.order.get(parent);
    if (!parent || !was) return false;
    const now = siblingOrders(model, layout).get(parent) || [];
    return was.indexOf(id) !== now.indexOf(id);
  }

  /** Whether cards are gliding somewhere: nothing's decided till they're there. */
  gliding(view, state) {
    const fold = this.plugin.feature(CanvasFold);
    const held = fold ? fold.watched.get(view) : null;
    return !!((held && held.gliding) || state.gliding);
  }

  /**
   * Each time the canvas may have changed. Cards moved by hand keep how
   * far they were moved, and their branches follow; a change to the
   * tree lays the map out again. A card not where its adjustment puts
   * it — Undo put back an older one, or the file came in from
   * elsewhere — keeps where it is, unsaved: only a change lays out.
   */
  pass(view, state) {
    if (!this.enabled || !this.isMap(view) || !view.canvas || canvasReadonly(view.canvas)) {
      state.laid = null;
      return;
    }
    if (state.pressing || this.gliding(view, state)) return;
    const model = canvasModel(view.canvas);
    // The file read in afresh: what was known of its cards is of others now.
    if (state.cards && model.nodes.some((r) => state.cards.has(r.id) && state.cards.get(r.id) !== r.node)) state.laid = null;
    // Opened before its cards came: they're as they were left.
    if (state.cards && !state.cards.size) state.laid = null;
    const links = arrowLinks(model);
    let layout = mapLayout(model, links);
    const shape = mapShape(model, layout);
    const tree = Array.from(layout.parents.keys());
    if (!state.laid || shape === state.shape) {
      const moved = state.laid ? tree.filter((id) => state.laid.has(id) && offPlace(model.byId.get(id), state.laid.get(id))) : [];
      const stray = tree.filter((id) => moved.indexOf(id) === -1 && offPlace(model.byId.get(id), layout.places.get(id)));
      if (stray.length) this.keep(model, layout, stray);
      // A group drawn round a branch, or sized by hand: drawn round it from now on, as it is.
      const groups = model.nodes.filter((g) => {
        if (!isGroupRecord(g) || g.tuck) return false;
        const was = state.framed && state.framed.get(g.id);
        return !frameOf(g) ? !was : !!was && offBox(g, was) && !moved.length;
      });
      const framed = this.frame(model, layout, groups);
      if (!moved.length) {
        this.remember(state, model, stray.length || framed ? mapLayout(model, links) : layout, shape);
        return;
      }
      // Moved past a card beside it: into its new place among them. Moved otherwise: kept as
      // adjustments, their branches to follow.
      const reordered = moved.filter((id) => !moved.some((m) => m === layout.parents.get(id)) && this.reordered(state, model, layout, id));
      this.keep(model, layout, moved.filter((id) => reordered.indexOf(id) === -1));
      reordered.forEach((id) => keepOnCard(model.byId.get(id).node, NUDGE_KEY, undefined));
      layout = mapLayout(model, links);
      this.layOut(view, state, model, layout, links, { changed: true });
      return;
    }
    // The tree changed. A card whose arrows now come from elsewhere goes to its place there.
    let relinked = false;
    layout.parents.forEach((parent, id) => {
      const rec = model.byId.get(id);
      if (state.arrows && state.arrows.get(id) === arrowSources(links, id)) return;
      if (!nudgeOf(rec)) return;
      keepOnCard(rec.node, NUDGE_KEY, undefined);
      relinked = true;
    });
    if (relinked) layout = mapLayout(model, links);
    this.layOut(view, state, model, layout, links, { changed: relinked });
  }

  /** These cards' adjustments set to keep them where they are; whether any changed. */
  keep(model, layout, ids) {
    let any = false;
    nudgesToKeep(model, layout, ids).forEach((n, id) => {
      const rec = model.byId.get(id);
      const was = nudgeOf(rec);
      const want = n.dx || n.dy ? n : undefined;
      if ((!was && !want) || (was && want && was.dx === want.dx && was.dy === want.dy)) return;
      keepOnCard(rec.node, NUDGE_KEY, want);
      any = true;
    });
    return any;
  }

  /** These groups drawn round the branch each holds, as they are, if one; whether any changed. */
  frame(model, layout, groups) {
    let any = false;
    groups.forEach((g) => {
      const f = framedBranch(model, layout, g);
      const was = frameOf(g);
      if (!f && !was) return;
      if (f && was && f.id === was.id && f.pad.every((v, i) => v === was.pad[i])) return;
      keepOnCard(g.node, FRAME_KEY, f || undefined);
      any = true;
    });
    return any;
  }

  /** What the map looks like now, to tell what changes next — and what each card's arrows come from, folded away or not. */
  remember(state, model, layout, shape) {
    const links = arrowLinks(model);
    state.arrows = new Map(model.nodes.map((r) => [r.id, arrowSources(links, r.id)]));
    state.framed = new Map(model.nodes.filter((g) => isGroupRecord(g)).map((g) => [g.id, (layout.frames && layout.frames.get(g.id)) || { x: g.x, y: g.y, width: g.width, height: g.height }]));
    state.laid = new Map(layout.places);
    state.order = siblingOrders(model, layout);
    state.shape = shape || mapShape(model, layout);
    state.cards = new Map(model.nodes.map((r) => [r.id, r.node]));
  }

  /**
   * Every card of the map glided to its place, the arrows of each tree
   * set to the sides that face, and the canvas saved — into the step of
   * Undo the change that set it off made, or, by hand (`save`), as a
   * step of its own. Resolves whether anything changed.
   */
  layOut(view, state, model, layout, links, opts = {}) {
    const fold = this.plugin.feature(CanvasFold);
    const holder = (fold && fold.watched.get(view)) || state;
    const before = snapshotModel(model);
    const moving = placeIn(model, layout);
    state.gliding = moving;
    return new Promise((resolve) => {
      const done = (glided) => {
        state.gliding = false;
        let changed = !!glided || !!opts.changed;
        layout.roots.forEach(({ rec, mode, laid }) => {
          // Each part of the tree as its own layout has it: a card belongs to the innermost branch growing its own way.
          const owner = new Map();
          laid.branches.forEach((b, i) => b.ids.forEach((id) => owner.set(id, i)));
          const parts = [{ rec, mode, places: new Map() }].concat(laid.branches.map((b) => ({ rec: b.rec, mode: b.mode, places: new Map() })));
          laid.forEach((at, id) => parts[owner.has(id) ? owner.get(id) + 1 : 0].places.set(id, at));
          parts.forEach((part) => {
            part.places.sides = laid.sides;
            if (faceArrows(model, part.rec.id, part.places, links, part.mode)) changed = true;
          });
        });
        this.remember(state, model, layout);
        if (opts.save) saveCanvas(view.canvas);
        else if (changed) saveInCurrentStep(view.canvas);
        if (changed || opts.save) this.app.workspace.trigger('design-redux:canvas-changed', view);
        resolve(changed);
      };
      if (!moving) return done(false);
      glideCanvasModel(view, model, before, holder, done);
    });
  }
}

CanvasMap.settingKey = 'canvasMaps';
CanvasMap.watchInput = true;
