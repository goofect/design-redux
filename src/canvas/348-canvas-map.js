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
/* out again, gliding, in the same step of Undo as the change. Making  */
/* a canvas a map keeps every card where it is; canvases not made maps */
/* aren't touched.                                                     */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { canvasReadonly, cardKept, keepOnCard, liveCards, saveInCurrentStep } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { arrowLinks, BRANCH_SIDES, canvasModel, isGroupRecord, saveCanvas, shownChildren } from './316-canvas-tree.js';
import { shiftRecord, snapshotModel } from './317-canvas-room.js';
import { glideCanvasModel } from './318-canvas-motion.js';
import { BRANCH_LAYOUTS, faceArrows, layoutPlaces, orderedBranch, siblingOrder } from './325-canvas-layouts.js';
import { CanvasFold } from './335-canvas-fold.js';

/* On a card: how far it was moved by hand from its spot, from its parent's: { dx, dy }. */
export const NUDGE_KEY = 'drNudge';
/* On a tree's first card: how the tree is laid out, one of BRANCH_LAYOUTS. */
export const MAP_LAYOUT_KEY = 'drLayout';

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
 * Where each card of a map's trees goes: its spot by the layout alone
 * (`spots`), the card it hangs from (`parents`), and its place, with its
 * adjustment and those of the cards above it added (`places`) — id ->
 * { x, y }. A tree's first card stays where it is, and so does a card
 * kept in place, its branch laid out from where it is. `roots` lists
 * each tree, its layout and the layout's own answer.
 */
export function mapLayout(model, links, modeOf) {
  const spots = new Map();
  const parents = new Map();
  const places = new Map();
  const roots = [];
  const claimed = new Set();
  mapRoots(model, links).forEach((root) => {
    if (claimed.has(root.id)) return;
    const mode = (modeOf && modeOf(root)) || keptLayout(root) || guessLayout(model, links, root);
    const laid = layoutPlaces(model, root.id, mode, links);
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
        const own = c.pinned ? { dx: c.x - spot.x - above.dx, dy: c.y - spot.y - above.dy } : nudgeOf(c) || { dx: 0, dy: 0 };
        const o = { dx: above.dx + own.dx, dy: above.dy + own.dy };
        off.set(c.id, o);
        places.set(c.id, { x: spot.x + o.dx, y: spot.y + o.dy });
        queue.push(c.id);
      });
    }
  });
  return { roots, spots, parents, places };
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

/** Whether a card isn't at a place. */
function offPlace(rec, at) {
  return Math.abs(rec.x - at.x) > 0.5 || Math.abs(rec.y - at.y) > 0.5;
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
    const map = plugin.feature(CanvasMap);
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

  /** The tree a card is in laid out another way from now on, every card of it to its place. One step of Undo. */
  setLayout(view, node, mode) {
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    let layout = mapLayout(model, links);
    let id = node.id;
    while (layout.parents.has(id)) id = layout.parents.get(id);
    const tree = layout.roots.find((t) => t.rec.id === id);
    if (!tree) return Promise.resolve(false);
    keepOnCard(tree.rec.node, MAP_LAYOUT_KEY, mode);
    layout.parents.forEach((p, c) => {
      let top = c;
      while (layout.parents.has(top)) top = layout.parents.get(top);
      if (top === id) keepOnCard(model.byId.get(c).node, NUDGE_KEY, undefined);
    });
    layout = mapLayout(model, links);
    return this.layOut(view, this.watched.get(view) || {}, model, layout, links, { save: true, changed: true });
  }

  mount(view, state) {
    // A card still held isn't where it's going: wait till it's let go.
    state.press = () => (state.pressing = true);
    state.release = () => {
      if (!state.pressing) return;
      state.pressing = false;
      state.schedule();
    };
    state.doc = view.containerEl.ownerDocument;
    view.containerEl.addEventListener('pointerdown', state.press, true);
    state.doc.addEventListener('pointerup', state.release, true);
    state.doc.addEventListener('pointercancel', state.release, true);
  }

  cleanup(view, state) {
    if (!state || !state.press) return;
    view.containerEl.removeEventListener('pointerdown', state.press, true);
    state.doc.removeEventListener('pointerup', state.release, true);
    state.doc.removeEventListener('pointercancel', state.release, true);
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
      if (!moved.length) {
        this.remember(state, model, stray.length ? mapLayout(model, links) : layout, shape);
        return;
      }
      // Moved by hand: kept as adjustments, their branches to follow.
      this.keep(model, layout, moved);
      layout = mapLayout(model, links);
      this.layOut(view, state, model, layout, links, { changed: true });
      return;
    }
    // The tree changed. A card hung somewhere new goes to its place there.
    let relinked = false;
    layout.parents.forEach((parent, id) => {
      const rec = model.byId.get(id);
      if (state.parents && state.parents.get(id) === parent) return;
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

  /** What the map looks like now, to tell what changes next. */
  remember(state, model, layout, shape) {
    state.laid = new Map(layout.places);
    state.parents = new Map(layout.parents);
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
    let moving = false;
    layout.places.forEach((at, id) => {
      const rec = model.byId.get(id);
      if (!rec || !offPlace(rec, at)) return;
      const once = new Set();
      shiftRecord(model, rec, 'x', at.x - rec.x, once);
      once.clear();
      shiftRecord(model, rec, 'y', at.y - rec.y, once);
      moving = true;
    });
    state.gliding = moving;
    return new Promise((resolve) => {
      const done = (glided) => {
        state.gliding = false;
        let changed = !!glided || !!opts.changed;
        layout.roots.forEach(({ rec, mode, laid }) => {
          if (faceArrows(model, rec.id, laid, links, mode)) changed = true;
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
