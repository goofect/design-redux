/* ------------------------------------------------------------------ */
/* Tidying and selecting a branch                                      */
/*                                                                     */
/* A card's branch — what its arrows lead to, and on — laid out as a   */
/* tidy tree growing the way its arrows leave it, with the cards round */
/* it kept as far off as they were; or selected with the card, to move */
/* or colour together. From the card's right-click menu, or commands.  */
/* ------------------------------------------------------------------ */

import { pickOnCanvas } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { arrowLinks, branchSide, canvasModel, isGroupRecord, OPPOSITE_SIDE, shownChildren, tidyBranch } from './316-canvas-tree.js';
import { snapshotModel, tidyRecords } from './317-canvas-room.js';
import { glideCanvasModel } from './318-canvas-motion.js';
import { afterCanvasChange, CanvasFold } from './335-canvas-fold.js';
import { CanvasMap } from './348-canvas-map.js';

export class CanvasBranches extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasTidy',
        name: 'Tidy branch',
        desc: 'Lay out a card’s branch as a neat tree, from its right-click menu.',
      },
      {
        key: 'canvasSelectBranch',
        name: 'Select branch',
        desc: 'Select a card and everything below it, from its right-click menu.',
      },
    ];
  }

  get enabled() {
    return !!(this.settings.canvasTidy || this.settings.canvasSelectBranch);
  }

  // Only the menus: nothing is drawn on the canvas.
  sync() {}

  actions() {
    const one = (ctx) => (ctx.node && this.hasBranch(ctx.view, ctx.node) ? ctx.node : null);
    return [
      { id: 'tidy-canvas-branch', name: 'Tidy the selected card’s branch', menu: 'Tidy branch', icon: 'network', on: 'canvas', when: (ctx) => !!this.settings.canvasTidy && !!one(ctx), run: (ctx) => this.tidy(ctx.view, one(ctx)) },
      { id: 'select-canvas-branch', name: 'Select the selected card’s branch', menu: 'Select branch', icon: 'git-branch', on: 'canvas', when: (ctx) => !!this.settings.canvasSelectBranch && !!one(ctx), run: (ctx) => this.selectBranch(ctx.view, one(ctx)) },
    ];
  }

  hasBranch(view, node) {
    if (!view || !view.canvas || !node) return false;
    const model = canvasModel(view.canvas);
    const rec = model.byId.get(node.id);
    return !!rec && !rec.tuck && !isGroupRecord(rec) && shownChildren(model, arrowLinks(model), rec.id).length > 0;
  }

  /** The branch laid out as a tree, and its arrows leaving and arriving on the sides the tree grows by. */
  tidy(view, node) {
    if (!view || !view.canvas || !node) return Promise.resolve(false);
    // In a mind map: its cards back to their places.
    const map = CanvasMap.of(this.plugin, view);
    if (map) return map.tidy(view, node);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const rec = model.byId.get(node.id);
    if (!rec || rec.tuck) return Promise.resolve(false);
    const before = snapshotModel(model);
    const links = arrowLinks(model);
    const side = branchSide(model, rec.id, links);
    const plan = tidyBranch(model, rec.id, side, links);
    const placed = new Set(plan.keys());
    placed.sides = plan.sides;
    const moved = tidyRecords(model, rec, this.settings.canvasCloseGaps !== false, links);
    // Glided there, the fold feature's look-over held off till they're in place.
    const state = fold ? fold.watched.get(view) : null;
    return new Promise((resolve) => {
      if (!moved) return resolve(this.tidied(view, model, rec, placed, links, side, false));
      glideCanvasModel(view, model, before, state, (changed) => resolve(this.tidied(view, model, rec, placed, links, side, changed)));
    });
  }

  /** A tidy's arrows set to the sides the tree grows by, then saved and looked over. */
  tidied(view, model, rec, placed, links, side, changed) {
    // The arrows within the tree, from the side it grows by to the side facing back.
    placed.add(rec.id);
    model.edges.forEach((e) => {
      const reversed = e.fromEnd === 'arrow' && e.toEnd !== 'arrow';
      const parent = reversed ? e.to : e.from;
      const child = reversed ? e.from : e.to;
      if (!placed.has(parent) || !placed.has(child) || (links.children.get(parent) || []).indexOf(child) === -1) return;
      // The way this card's branch grows: a tree may grow both ways from its root.
      const way = (placed.sides && placed.sides.get(child)) || side;
      const fromSide = reversed ? OPPOSITE_SIDE[way] : way;
      const toSide = reversed ? way : OPPOSITE_SIDE[way];
      if (e.fromSide === fromSide && e.toSide === toSide) return;
      if (setEdgeSides(e.edge, fromSide, toSide)) changed = true;
    });
    afterCanvasChange(this.plugin, view, changed);
    return changed;
  }

  /** The card and every shown card below it by its arrows, selected. */
  selectBranch(view, node) {
    if (!view || !view.canvas || !node) return;
    const canvas = view.canvas;
    const model = canvasModel(canvas);
    const links = arrowLinks(model);
    const seen = new Set([node.id]);
    const queue = [node.id];
    while (queue.length) {
      shownChildren(model, links, queue.shift()).forEach((c) => {
        if (seen.has(c.id)) return;
        seen.add(c.id);
        queue.push(c.id);
      });
    }
    const cards = Array.from(seen).map((id) => (model.byId.get(id) || {}).node).filter(Boolean);
    pickOnCanvas(canvas, cards);
  }
}

/** An arrow's ends moved to other sides of its cards. */
export function setEdgeSides(edge, fromSide, toSide) {
  try {
    if (!edge || typeof edge.getData !== 'function' || typeof edge.setData !== 'function') return false;
    edge.setData(Object.assign({}, edge.getData(), { fromSide, toSide }));
    if (typeof edge.render === 'function') edge.render();
    return true;
  } catch (err) {
    return false;
  }
}
