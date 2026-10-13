/* ------------------------------------------------------------------ */
/* Canvas: how deep a card is                                          */
/*                                                                     */
/* A map reads from its root out: the card at the root of a tree gets  */
/* a larger, heavier title and border, the cards a step from it a      */
/* little more weight, and deeper ones none — no colour, so the cards' */
/* own colours still say what they say. A card in no tree is left be.  */
/* ------------------------------------------------------------------ */

import { arrowElements, cardElement } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { arrowLinks, canvasModel, isGroupRecord, shownChildren } from './316-canvas-tree.js';
import { siblingOrder } from './325-canvas-layouts.js';

/**
 * A tint for each card of a tree with no colour of its own, 1–6: by
 * the branch from its root it's in ('branch'), or how many steps out it
 * is ('depth'). id -> tint; roots and cards in no tree have none.
 */
export function cardTints(model, links, depths, by) {
  const out = new Map();
  if (by !== 'branch' && by !== 'depth') return out;
  const plain = (r) => r && !r.tuck && !isGroupRecord(r) && !r.color;
  if (by === 'depth') {
    depths.forEach((d, id) => d > 0 && plain(model.byId.get(id)) && out.set(id, ((d - 1) % 6) + 1));
    return out;
  }
  const branch = new Map();
  depths.forEach((d, id) => {
    if (d !== 0) return;
    const root = model.byId.get(id);
    siblingOrder(root, shownChildren(model, links, id).filter((c) => !isGroupRecord(c))).forEach((c, i) => {
      const queue = [c.id];
      while (queue.length) {
        const at = queue.shift();
        if (branch.has(at) || at === id) continue;
        branch.set(at, (i % 6) + 1);
        shownChildren(model, links, at).forEach((k) => queue.push(k.id));
      }
    });
  });
  branch.forEach((tint, id) => plain(model.byId.get(id)) && out.set(id, tint));
  return out;
}

/** How many steps each card in a tree is from its root: id -> depth. Cards in no tree aren't in it. */
export function treeDepths(model, links) {
  links = links || arrowLinks(model);
  const depth = new Map();
  const queue = [];
  model.nodes.forEach((n) => {
    if (n.tuck || isGroupRecord(n)) return;
    const parents = (links.parents.get(n.id) || []).filter((p) => model.byId.has(p));
    if (!parents.length && (links.children.get(n.id) || []).length) {
      depth.set(n.id, 0);
      queue.push(n.id);
    }
  });
  while (queue.length) {
    const id = queue.shift();
    (links.children.get(id) || []).forEach((c) => {
      if (depth.has(c)) return;
      depth.set(c, depth.get(id) + 1);
      queue.push(c);
    });
  }
  return depth;
}

/**
 * A card's part in the map: a tree's root, a card a step from it, one
 * deeper, or a reference — a note, a file or a link brought in, rather
 * than an idea written here. Null for a loose card or a group.
 */
export function cardRole(rec, depth) {
  if (!rec || isGroupRecord(rec)) return null;
  if (rec.type === 'file' || rec.type === 'link') return 'reference';
  if (depth === undefined) return null;
  return depth === 0 ? 'root' : depth === 1 ? 'primary' : 'secondary';
}

export class CanvasDepth extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasDepth',
        name: 'Show each card’s part',
        desc: 'By weight, not colour: a tree’s root larger, with a heavier border; the cards a step from it a little heavier; deeper ones lighter; notes and links shown as references, quieter. Arrows in a tree stay solid; associations are softer.',
      },
      {
        key: 'canvasColourBy',
        type: 'dropdown',
        name: 'Colour cards by',
        desc: 'A tint for each branch from a tree’s root, or each step out from it, so a big map reads at a glance. Cards given a colour keep theirs.',
        options: { none: 'Nothing', branch: 'Branch', depth: 'Depth' },
      },
    ];
  }

  get enabled() {
    return !!this.settings.canvasDepth || (this.settings.canvasColourBy || 'none') !== 'none';
  }

  // Each redraw: each card's depth on it, for the styles to read.
  pass(view) {
    if (!view || !view.canvas) return;
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    const weigh = !!this.settings.canvasDepth;
    const depths = this.enabled ? treeDepths(model, links) : new Map();
    const tints = cardTints(model, links, depths, this.settings.canvasColourBy);
    const set = (el, key, value) => {
      if (value === null) {
        if (key in el.dataset) delete el.dataset[key];
      } else if (el.dataset[key] !== value) el.dataset[key] = value;
    };
    model.nodes.forEach((rec) => {
      const el = rec.node ? cardElement(rec.node) : null;
      if (!el) return;
      const d = depths.get(rec.id);
      set(el, 'drDepth', d === undefined || !weigh ? null : String(Math.min(d, 2)));
      set(el, 'drRole', weigh ? cardRole(rec, d) : null);
      set(el, 'drTint', tints.has(rec.id) ? String(tints.get(rec.id)) : null);
    });
    // Arrows: the tree's, and the ones that only associate.
    model.edges.forEach((e) => {
      const els = e.edge ? arrowElements(e.edge).filter((x) => x.classList) : [];
      const reversed = e.fromEnd === 'arrow' && e.toEnd !== 'arrow';
      const parent = reversed ? e.to : e.from;
      const child = reversed ? e.from : e.to;
      const tree = weigh && (links.children.get(parent) || []).indexOf(child) !== -1;
      const loose = weigh && !tree && !!e.related;
      els.forEach((x) => {
        x.classList.toggle('dr-edge-tree', tree);
        x.classList.toggle('dr-edge-assoc', loose);
      });
    });
  }

  cleanup(view) {
    if (!view.contentEl) return;
    view.contentEl.querySelectorAll('[data-dr-depth], [data-dr-role], [data-dr-tint]').forEach((el) => {
      delete el.dataset.drDepth;
      delete el.dataset.drRole;
      delete el.dataset.drTint;
    });
    view.contentEl.querySelectorAll('.dr-edge-tree, .dr-edge-assoc').forEach((el) => el.classList.remove('dr-edge-tree', 'dr-edge-assoc'));
  }
}

CanvasDepth.settingKey = 'canvasDepth';
