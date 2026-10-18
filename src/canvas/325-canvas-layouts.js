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

import { Notice } from 'obsidian';
import { addActionEntries, addActionItems, canvasMenuContext } from '../core/078-actions.js';
import { canvasReadonly } from '../core/079-canvas-adapter.js';
import { ComparePicker } from '../ui/230-pickers.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { canvasModel, tuckOf } from './316-canvas-tree.js';
import { fitGroups, placeBranch, shiftRecord, snapshotModel } from './317-canvas-room.js';
import { glideCanvasModel } from './318-canvas-motion.js';
import { canvasAction } from './321-canvas-extras.js';
import { isCanvasEdge, nearestSides } from './332-canvas-arrows.js';
import { boxEdges } from './334-canvas-mindmap.js';
import { afterCanvasChange, CanvasFold, glideAndSettle, isGroupNode } from './335-canvas-fold.js';
import { CanvasBranches, setEdgeSides } from './338-canvas-branches.js';
import { CanvasMap } from './348-canvas-map.js';
import { arrowLinks, branchOf, isGroupRecord, OPPOSITE_SIDE, shownChildren, sideAxes } from '../tree/400-tree-model.js';
import { BRANCH_LAYOUTS, LAYOUT_ENGINES, layoutPlaces, selectionLinks, spreadApart } from '../tree/403-tree-layouts.js';

/**
 * Cards that overlap eased apart, each pair along the way that's shorter,
 * a gap between them, until none touch; cards in `still` (and groups)
 * stay where they are. id -> { x, y } for those that move.
 */

export class CanvasLayouts extends CanvasFeature {
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

  /** Each kind of layout, for the selected branches or the cards alone, and the canvas's whole. */
  actions() {
    const open = (ctx) => this.enabled && !canvasReadonly(ctx.view.canvas);
    const cards = (ctx) => ctx.nodes.filter((n) => !isCanvasEdge(n) && !isGroupNode(n));
    const roots = (ctx) => (this.enabled ? this.rootsOf(ctx.view, ctx.nodes.filter((n) => !isCanvasEdge(n))) : []);
    const iconOf = (mode) => (BRANCH_LAYOUTS.find((b) => b[0] === mode) || BRANCH_LAYOUTS[0])[2];
    const branch = BRANCH_LAYOUTS.map(([mode, title, icon]) => ({
      id: `canvas-layout-${mode === 'bottom' ? 'down' : mode === 'top' ? 'up' : mode}`,
      name: `Lay out the selected cards’ branches: ${title.toLowerCase()}`,
      menu: title,
      icon,
      on: 'canvas',
      group: 'branch',
      when: (ctx) => roots(ctx).length > 0,
      run: (ctx) => this.layoutMany(ctx.view, roots(ctx), mode),
    }));
    // Several cards chosen: laid out among themselves alone, the rest left be.
    const alone = LAYOUT_ENGINES.map((engine) => ({
      id: `canvas-layout-cards-${engine.mode}`,
      name: engine.label,
      icon: iconOf(engine.mode),
      on: 'canvas',
      group: 'cards',
      palette: false,
      when: (ctx) => open(ctx) && cards(ctx).length > 1,
      run: (ctx) => this.layoutSelected(ctx.view, cards(ctx), engine.mode),
    }));
    return branch.concat(alone, [
      {
        // From a menu, the cards it's for, if they overlap; from the palette, those chosen or the whole canvas.
        id: 'canvas-spread-overlaps',
        name: 'Spread out overlapping cards',
        icon: 'move-diagonal',
        on: 'canvas',
        group: 'spread',
        when: (ctx) => open(ctx) && (cards(ctx).length > 1 ? ctx.from === 'palette' || this.overlapping(ctx.view, cards(ctx)) : ctx.from === 'palette'),
        run: (ctx) => this.spread(ctx.view, cards(ctx).length > 1 ? cards(ctx) : null),
      },
      {
        // Several trees: each tidied as it grows, one after another.
        id: 'canvas-tidy-branches',
        name: 'Tidy branches',
        icon: 'network',
        on: 'canvas',
        group: 'tidy',
        palette: false,
        when: (ctx) => {
          const branches = this.plugin.feature(CanvasBranches);
          return roots(ctx).length > 1 && !!branches && branches.enabled && !!this.settings.canvasTidy;
        },
        run: async (ctx) => {
          const branches = this.plugin.feature(CanvasBranches);
          for (const node of roots(ctx)) await branches.tidy(ctx.view, node);
        },
      },
      {
        id: 'canvas-layout-choose',
        name: 'Lay out…',
        menu: false,
        icon: 'layout-dashboard',
        on: 'canvas',
        when: (ctx) => this.enabled && this.scopes(ctx.view).length > 0,
        run: (ctx) => this.choose(ctx.view),
      },
      {
        id: 'canvas-layout-everything',
        name: 'Lay out the whole canvas…',
        menu: false,
        icon: 'layout-grid',
        on: 'canvas',
        when: (ctx) => this.enabled && this.wholeRoots(ctx.view).length > 0,
        run: (ctx) => {
          const items = BRANCH_LAYOUTS.map(([mode, title]) => ({ label: title, mode }));
          new ComparePicker(this.app, items, 'Lay out every tree on the canvas', (item) => this.layoutMany(ctx.view, this.wholeRoots(ctx.view), item.mode)).open();
        },
      },
    ]);
  }

  /** What a layout can be given now: the whole map, the selected branches, the selected cards alone. */
  scopes(view) {
    if (!view || !view.canvas || canvasReadonly(view.canvas)) return [];
    const picked = this.selectedNodes(view).filter((n) => !isCanvasEdge(n));
    const out = [];
    const whole = this.wholeRoots(view);
    if (whole.length) out.push({ id: 'whole', label: 'The whole map', note: `${whole.length} ${whole.length === 1 ? 'tree' : 'trees'}`, run: (mode) => this.layoutMany(view, whole, mode) });
    const roots = this.rootsOf(view, picked);
    if (roots.length) out.push({ id: 'branch', label: roots.length === 1 ? 'The selected branch' : 'The selected branches', note: 'Each card chosen, and everything below it', run: (mode) => this.layoutMany(view, roots, mode) });
    const cards = picked.filter((n) => !isGroupNode(n));
    if (cards.length > 1) out.push({ id: 'cards', label: 'The selected cards only', note: `${cards.length} cards, among themselves; the rest stay where they are`, run: (mode) => this.layoutSelected(view, cards, mode) });
    return out;
  }

  /** Which layout, then — where there's a choice — what to lay out. */
  choose(view) {
    const scopes = this.scopes(view);
    if (!scopes.length) return;
    new ComparePicker(this.app, LAYOUT_ENGINES, 'Which layout?', (engine) => {
      if (scopes.length === 1) {
        scopes[0].run(engine.mode);
        return;
      }
      new ComparePicker(this.app, scopes, `${engine.label}: lay out what?`, (scope) => scope.run(engine.mode)).open();
    }).open();
  }

  /**
   * The selected cards alone laid out among themselves: by the arrows
   * between them, the first in reading order at the centre, any not
   * joined to it hung from it. Nothing else moves; a card kept in place
   * stays. Glides; one step of Undo.
   */
  layoutSelected(view, nodes, mode) {
    if (!view || !view.canvas) return Promise.resolve(false);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const recs = nodes.map((n) => model.byId.get(n.id)).filter((r) => r && !r.tuck && !isGroupRecord(r));
    if (recs.length < 2) return Promise.resolve(false);
    const links = selectionLinks(model, recs);
    const root = model.byId.get(links.root);
    const places = this.places(model, root.id, mode, links);
    const before = snapshotModel(model);
    let changed = false;
    places.forEach((at, id) => {
      const n = model.byId.get(id);
      if (!n || n.pinned || !links.children.has(id)) return;
      const moved = new Set();
      ['x', 'y'].forEach((axis) => {
        if (n[axis] === at[axis]) return;
        moved.clear();
        shiftRecord(model, n, axis, at[axis] - n[axis], moved);
        changed = true;
      });
    });
    if (!changed) return Promise.resolve(false);
    const state = fold ? fold.watched.get(view) : null;
    return new Promise((resolve) => {
      glideCanvasModel(view, model, before, state, (moved) => resolve(this.laidOut(view, model, root, places, links, mode, moved || changed)));
    });
  }

  /** Of some cards, those with a branch, less any inside another's branch. */
  rootsOf(view, nodes) {
    if (!view || !view.canvas) return [];
    const withBranch = (nodes || []).filter((n) => this.hasBranch(view, n));
    if (withBranch.length < 2) return withBranch;
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    const inside = new Set();
    withBranch.forEach((n) => branchOf(model, n.id, links).forEach((id) => inside.add(id)));
    return withBranch.filter((n) => !inside.has(n.id));
  }

  /** Every tree on the canvas: the cards with a branch that hang from nothing, in reading order. */
  wholeRoots(view) {
    if (!view || !view.canvas) return [];
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    return model.nodes
      .filter((n) => !n.tuck && !isGroupRecord(n) && !(links.parents.get(n.id) || []).length && shownChildren(model, links, n.id).length)
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((n) => n.node)
      .filter(Boolean);
  }

  /** Whether any two of these cards overlap. */
  overlapping(view, nodes) {
    const model = canvasModel(view.canvas);
    const cards = nodes.map((n) => model.byId.get(n.id)).filter((r) => r && !r.tuck && !isGroupRecord(r));
    return spreadApart(cards, new Set(), 0).size > 0;
  }

  /**
   * Overlapping cards — the ones given, or every card on the canvas —
   * eased apart until none touch; kept cards stay. Glides; one step of Undo.
   */
  spread(view, nodes) {
    if (!view || !view.canvas) return Promise.resolve(false);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const ids = nodes ? new Set(nodes.map((n) => n.id)) : null;
    const cards = model.nodes.filter((r) => !r.tuck && !isGroupRecord(r) && (!ids || ids.has(r.id)));
    const places = spreadApart(cards, new Set(cards.filter((r) => r.pinned).map((r) => r.id)));
    if (!places.size) {
      new Notice('No cards overlap.');
      return Promise.resolve(false);
    }
    const before = snapshotModel(model);
    places.forEach((at, id) => {
      const rec = model.byId.get(id);
      const moved = new Set();
      shiftRecord(model, rec, 'x', at.x - rec.x, moved);
      moved.clear();
      shiftRecord(model, rec, 'y', at.y - rec.y, moved);
    });
    fitGroups(model, before);
    return glideAndSettle(this.plugin, view, model, before);
  }

  /** Several branches laid out the same way, one after another. */
  async layoutMany(view, nodes, mode) {
    let any = false;
    for (const node of nodes) {
      if (await this.layout(view, node, mode)) any = true;
    }
    return any;
  }

  hasBranch(view, node) {
    if (!view || !view.canvas || canvasReadonly(view.canvas) || !node || isCanvasEdge(node) || isGroupNode(node) || tuckOf(node)) return false;
    const model = canvasModel(view.canvas);
    return shownChildren(model, arrowLinks(model), node.id).some((c) => !isGroupRecord(c));
  }

  addMenuItems(menu, nodes) {
    const ctx = canvasMenuContext(nodes);
    if (!ctx) return;
    const group = (name) => this.actions().filter((a) => a.group === name);
    addActionEntries(menu, group('spread'), ctx, canvasAction);
    addActionItems(menu, group('cards'), ctx, 'Lay out these cards only', 'layout-dashboard', canvasAction);
    const many = this.rootsOf(ctx.view, nodes.filter((n) => !isCanvasEdge(n))).length > 1;
    addActionItems(menu, group('branch'), ctx, many ? 'Lay out branches' : 'Lay out branch', 'layout-grid', canvasAction);
    addActionEntries(menu, group('tidy'), ctx, canvasAction);
  }

  /** Where the branch's cards go for a layout. */
  places(model, rootId, mode, links) {
    return layoutPlaces(model, rootId, mode, links);
  }

  /** The branch laid out, gliding there; its arrows then set to the sides that face, and saved. */
  layout(view, node, mode) {
    if (!view || !view.canvas || !node) return Promise.resolve(false);
    // In a mind map: its tree laid out that way from now on.
    const map = CanvasMap.of(this.plugin, view);
    if (map) return map.setLayout(view, node, mode);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const rec = model.byId.get(node.id);
    if (!rec || rec.tuck) return Promise.resolve(false);
    const links = arrowLinks(model);
    const places = this.places(model, rec.id, mode, links);
    if (!places.size) return Promise.resolve(false);
    const axes =
      mode === 'radial' || mode === 'concept'
        ? { depth: 'x', across: 'y', forward: true, both: true }
        : mode === 'outline'
          ? { depth: 'y', across: 'x', forward: true, both: false }
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
    if (faceArrows(model, rec.id, places, links, mode)) changed = true;
    afterCanvasChange(this.plugin, view, changed);
    return changed;
  }
}

/** Each arrow within a laid-out branch from the side facing its card to the side facing back; whether any changed. */
export function faceArrows(model, rootId, places, links, mode) {
  const inside = new Set(Array.from(places.keys()).concat([rootId]));
  let changed = false;
  model.edges.forEach((e) => {
    const reversed = e.fromEnd === 'arrow' && e.toEnd !== 'arrow';
    const parent = reversed ? e.to : e.from;
    const child = reversed ? e.from : e.to;
    if (!inside.has(parent) || !inside.has(child) || (links.children.get(parent) || []).indexOf(child) === -1) return;
    let out;
    let back;
    if (mode === 'radial' || mode === 'concept') {
      const sides = nearestSides(boxEdges(model.byId.get(parent)), boxEdges(model.byId.get(child)));
      out = sides.from;
      back = sides.to;
    } else if (mode === 'outline') {
      // Down out of the card, into the side of the one set in below it.
      out = 'bottom';
      back = 'left';
    } else {
      out = places.sides.get(child) || mode;
      back = OPPOSITE_SIDE[out];
    }
    const fromSide = reversed ? back : out;
    const toSide = reversed ? out : back;
    if (e.fromSide === fromSide && e.toSide === toSide) return;
    if (setEdgeSides(e.edge, fromSide, toSide)) changed = true;
  });
  return changed;
}

CanvasLayouts.settingKey = 'canvasLayouts';
