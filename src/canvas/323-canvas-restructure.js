/* ------------------------------------------------------------------ */
/* Canvas: restructuring a branch                                      */
/*                                                                     */
/* What a mind map's outline does with its indents, done to cards.     */
/* Shift+Enter puts a new card before the selected one: in its place,  */
/* between it and the card it hangs from, its branch moving a level    */
/* out. Shift+Tab moves a card up a level, to hang from the card its   */
/* own hangs from; and from its menu, under the card above it. Its     */
/* branch comes along, as when a card is dropped onto another.         */
/* ------------------------------------------------------------------ */

import { addArrows, addTextCard, arrowData, canvasReadonly, cardEditing, colourCard, removeArrow } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { canvasModel } from './316-canvas-tree.js';
import { axisParts, fitGroups, makeRoom, shiftRecord, snapshotModel } from './317-canvas-room.js';
import { glideCanvasModel } from './318-canvas-motion.js';
import { ARROW_KEY, soleCard } from './332-canvas-arrows.js';
import { arrowsInto, CanvasMindMap, freeSpot, newCanvasId, typingInto } from './334-canvas-mindmap.js';
import { CanvasFold, glideAndSettle } from './335-canvas-fold.js';
import { arrowLinks, boundsOf, branchOf, branchSide, canvasGap, canvasHomes, isGroupRecord, OPPOSITE_SIDE, shownChildren, sideAxes, TIDY_DEPTH_GAP } from '../tree/400-tree-model.js';

/** The shown card a card hangs from, and the arrow that makes it: { parent, edge }, or null. */
export function hangsFrom(model, id) {
  const found = arrowsInto(model, id).find(([, p]) => {
    const r = model.byId.get(p);
    return r && !r.tuck;
  });
  return found ? { parent: model.byId.get(found[1]), edge: found[0] } : null;
}

/** A card's parent's shown children, in the order they line up. */
export function siblingsOf(model, links, parent) {
  const across = sideAxes(branchSide(model, parent.id, links)).across;
  const other = across === 'x' ? 'y' : 'x';
  return shownChildren(model, links, parent.id)
    .filter((c) => !isGroupRecord(c))
    .sort((a, b) => a[across] - b[across] || a[other] - b[other]);
}

export class CanvasRestructure extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasRestructure',
        name: 'Restructure branches',
        desc: 'Shift+Enter puts a new card before the selected one; Shift+Tab moves it up a level; Alt+Shift and an arrow moves it before or after the card beside it. Its menu can also move it under the card above.',
      },
    ];
  }

  actions() {
    // The one card it's for — not a group, nor one in a fold — on a canvas that can be changed.
    const one = (ctx) => (this.enabled && !canvasReadonly(ctx.view.canvas) ? soleCard(ctx.nodes) : null);
    const act = (id, name, menu, icon, can, run) => ({ id, name, menu, icon, on: 'canvas', when: (ctx) => !!one(ctx) && (!can || !!can(ctx.view, one(ctx))), run: (ctx) => run(ctx.view, one(ctx)) });
    return [
      act('canvas-add-parent-card', 'Add a card before the selected card', 'Add card before', 'git-pull-request-arrow', null, (v, n) => this.addParent(v, n)),
      act('canvas-promote-card', 'Move the selected card up a level', 'Move up a level', 'arrow-up-left', (v, n) => this.promoteTarget(v, n), (v, n) => this.promote(v, n)),
      Object.assign(act('canvas-card-earlier', 'Move the selected card before the card beside it', '', 'arrow-up', (v, n) => this.swapTarget(v, n, -1), (v, n) => this.reorder(v, n, -1)), { menu: false }),
      Object.assign(act('canvas-card-later', 'Move the selected card after the card beside it', '', 'arrow-down', (v, n) => this.swapTarget(v, n, 1), (v, n) => this.reorder(v, n, 1)), { menu: false }),
      act('canvas-demote-card', 'Move the selected card under the one above it', 'Move under the card above', 'arrow-down-right', (v, n) => this.demoteTarget(v, n), (v, n) => this.demote(v, n)),
    ];
  }

  // Nothing drawn on the canvas: only keys and menus.
  pass() {}

  /** The one card of these — not a group, nor one in a fold — or null. */

  mount(view, state) {
    if (!view.containerEl) return;
    state.keys = (evt) => this.onKey(view, evt);
    view.containerEl.addEventListener('keydown', state.keys);
  }

  cleanup(view, state) {
    if (state && state.keys && view.containerEl) view.containerEl.removeEventListener('keydown', state.keys);
  }

  onKey(view, evt) {
    if (evt.defaultPrevented || evt.isComposing || typingInto(evt.target)) return;
    if (!evt.shiftKey || evt.ctrlKey || evt.metaKey) return;
    const arrow = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[evt.key];
    if (evt.altKey ? !arrow : evt.key !== 'Enter' && evt.key !== 'Tab') return;
    if (!view.canvas || canvasReadonly(view.canvas)) return;
    const node = soleCard(this.selectedNodes(view));
    if (!node || cardEditing(node)) return;
    evt.preventDefault();
    evt.stopPropagation();
    if (evt.altKey) this.reorder(view, node, arrow);
    else if (evt.key === 'Enter') this.addParent(view, node);
    else this.promote(view, node);
  }

  /** The card beside this one under the same parent, before (-1) or after (1) it; or null. */
  swapTarget(view, node, dir) {
    if (!view || !view.canvas || !node) return null;
    const model = canvasModel(view.canvas);
    const up = hangsFrom(model, node.id);
    if (!up) return null;
    const row = siblingsOf(model, arrowLinks(model), up.parent);
    const at = row.findIndex((r) => r.id === node.id);
    return at === -1 ? null : row[at + dir] || null;
  }

  /**
   * The card and the one beside it change places, each with its branch:
   * the earlier takes the first one's place, the gap between them kept.
   * Glides there; one step of Undo.
   */
  reorder(view, node, dir) {
    const other = this.swapTarget(view, node, dir);
    if (!other) return Promise.resolve(false);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    const up = hangsFrom(model, node.id);
    const across = sideAxes(branchSide(model, up.parent.id, links)).across;
    const p = axisParts(across);
    const branch = (id) => [model.byId.get(id)].concat(branchOf(model, id, links).map((x) => model.byId.get(x)).filter((r) => r && !r.tuck));
    const [first, second] = dir < 0 ? [branch(other.id), branch(node.id)] : [branch(node.id), branch(other.id)];
    const a = boundsOf(first);
    const b = boundsOf(second);
    const gap = p.near(b) - p.far(a);
    const before = snapshotModel(model);
    const moved = new Set();
    // The second to where the first began; the first after it.
    second.forEach((r) => shiftRecord(model, r, across, p.near(a) - p.near(b), moved));
    first.forEach((r) => shiftRecord(model, r, across, p.near(a) + b[p.size] + gap - p.near(a), moved));
    return glideAndSettle(this.plugin, view, model, before);
  }

  /** The card a card would hang from a level up: the one its parent hangs from. */
  promoteTarget(view, node) {
    if (!view || !view.canvas || !node) return null;
    const model = canvasModel(view.canvas);
    const up = hangsFrom(model, node.id);
    const upper = up ? hangsFrom(model, up.parent.id) : null;
    return upper ? upper.parent : null;
  }

  /** The card a card would hang from a level down: the one before it under the same parent. */
  demoteTarget(view, node) {
    if (!view || !view.canvas || !node) return null;
    const model = canvasModel(view.canvas);
    const up = hangsFrom(model, node.id);
    if (!up) return null;
    const row = siblingsOf(model, arrowLinks(model), up.parent);
    const at = row.findIndex((r) => r.id === node.id);
    return at > 0 ? row[at - 1] : null;
  }

  /** Moved to hang from a card, its branch along with it — as a drop onto that card does. */
  rehang(view, node, target) {
    const mind = this.plugin.feature(CanvasMindMap);
    if (!mind || !target || !target.node) return Promise.resolve(false);
    return mind.relink(view, { id: node.id, x: node.x, y: node.y }, target.node);
  }

  promote(view, node) {
    return this.rehang(view, node, this.promoteTarget(view, node));
  }

  demote(view, node) {
    return this.rehang(view, node, this.demoteTarget(view, node));
  }

  /**
   * A new card before this one. Where the card hangs from another, the
   * new one takes its place between them, and the card and its branch
   * move a level further out, with room made beyond; a card hanging
   * from nothing gets one in the free space behind it. Then it's open
   * to type in, as a card added with Tab is.
   */
  addParent(view, node) {
    const canvas = view && view.canvas;
    const mind = this.plugin.feature(CanvasMindMap);
    if (!canvas || !node || !mind) return Promise.resolve(null);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    let model = canvasModel(canvas);
    const rec = model.byId.get(node.id);
    if (!rec || rec.tuck || isGroupRecord(rec)) return Promise.resolve(null);
    const links = arrowLinks(model);
    const up = hangsFrom(model, rec.id);
    const side = up ? branchSide(model, up.parent.id, links) : mind.growthSide(model, links, rec);
    const size = mind.sizeFor(view, null, rec);
    let box;
    if (up) {
      box = { x: rec.x, y: rec.y, width: size.width, height: size.height };
    } else {
      const spot = freeSpot(model, rec, size, OPPOSITE_SIDE[side]);
      if (!spot) return Promise.resolve(null);
      box = { x: spot.x, y: spot.y, width: size.width, height: size.height };
    }
    const made = addTextCard(canvas, box);
    if (!made) return Promise.resolve(null);
    if (rec.color) colourCard(made, rec.color);
    model = canvasModel(canvas);
    const before = snapshotModel(model);
    const card = model.byId.get(rec.id);
    if (up) this.moveOut(model, before, card, made, side, links);
    // Its arrows: what led to the card now leads to the new one, and the new one to the card.
    const edges = [];
    try {
      if (up) {
        const e = up.edge;
        // The arrow as it was — its sides, ends, label, colour and style — now ending at the new card.
        const old = { fromNode: e.from, fromSide: e.fromSide, toNode: e.to, toSide: e.toSide };
        if (e.fromEnd !== 'none') old.fromEnd = e.fromEnd;
        if (e.toEnd !== 'arrow') old.toEnd = e.toEnd;
        // Or, where its data can't be had, its ends and sides.
        if (e.edge) Object.assign(old, arrowData(e.edge));
        if (old.fromNode === rec.id) old.fromNode = made.id;
        else old.toNode = made.id;
        old.id = newCanvasId(canvas);
        edges.push(old);
        if (e.edge) removeArrow(canvas, e.edge);
        const style = {};
        ['color', ARROW_KEY].forEach((k) => {
          if (old[k] !== undefined) style[k] = old[k];
        });
        edges.push(Object.assign(style, { id: newCanvasId(canvas), fromNode: made.id, fromSide: side, toNode: rec.id, toSide: OPPOSITE_SIDE[side] }));
      } else {
        edges.push({ id: newCanvasId(canvas), fromNode: made.id, fromSide: side, toNode: rec.id, toSide: OPPOSITE_SIDE[side] });
      }
      addArrows(canvas, edges);
    } catch (err) {
      /* the card made, its arrows as they could be */
    }
    const state = fold ? fold.watched.get(view) : null;
    return new Promise((resolve) => {
      glideCanvasModel(view, model, before, state, () => resolve(mind.opened(view, made, true)));
    });
  }

  /** The card and its branch a level further out from where it was, room made beyond them. */
  moveOut(model, before, card, made, side, links) {
    const axes = sideAxes(side);
    const deep = axes.depth === 'x' ? 'width' : 'height';
    const delta = (made[deep] + canvasGap(TIDY_DEPTH_GAP)) * (axes.forward ? 1 : -1);
    const members = [card].concat(branchOf(model, card.id, links).map((id) => model.byId.get(id)).filter((r) => r && !r.tuck));
    const p = axisParts(axes.depth);
    const cross = axisParts(axes.across);
    const at = axes.forward ? Math.max(...members.map(p.far)) : Math.min(...members.map(p.near));
    const span = [Math.min(...members.map(cross.near)), Math.max(...members.map(cross.far))];
    const moved = new Set();
    members.forEach((r) => shiftRecord(model, r, axes.depth, delta, moved));
    if (this.settings.canvasCloseGaps === false) return;
    const origin = new Set(members.map((r) => r.id).concat([made.id]));
    makeRoom(model, before, {
      origin,
      home: canvasHomes(model).get(made.id) || null,
      axis: axes.depth,
      side: axes.forward ? 'after' : 'before',
      at,
      delta,
      span,
    });
    if (this.sticksOut(model, before)) fitGroups(model, before);
  }

  sticksOut(model, before) {
    const mind = this.plugin.feature(CanvasMindMap);
    return !!mind && mind.sticksOut(model, before);
  }
}

CanvasRestructure.settingKey = 'canvasRestructure';
