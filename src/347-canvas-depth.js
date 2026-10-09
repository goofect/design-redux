/* ------------------------------------------------------------------ */
/* Canvas: how deep a card is                                          */
/*                                                                     */
/* A map reads from its root out: the card at the root of a tree gets  */
/* a larger, heavier title and border, the cards a step from it a      */
/* little more weight, and deeper ones none — no colour, so the cards' */
/* own colours still say what they say. A card in no tree is left be.  */
/* ------------------------------------------------------------------ */

/** How many steps each card in a tree is from its root: id -> depth. Cards in no tree aren't in it. */
function treeDepths(model, links) {
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

class CanvasDepth extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasDepth',
        name: 'Show how deep a card is',
        desc: 'A tree’s root card gets a larger, heavier title and border, the cards a step from it a little more weight; no colour.',
      },
    ];
  }

  // Each redraw: each card's depth on it, for the styles to read.
  pass(view) {
    if (!view || !view.canvas || !view.canvas.nodes) return;
    const depths = this.enabled ? treeDepths(canvasModel(view.canvas)) : new Map();
    view.canvas.nodes.forEach((node) => {
      const el = node.nodeEl;
      if (!el) return;
      const d = depths.get(node.id);
      const value = d === undefined ? null : String(Math.min(d, 2));
      if (value === null) {
        if ('drDepth' in el.dataset) delete el.dataset.drDepth;
      } else if (el.dataset.drDepth !== value) {
        el.dataset.drDepth = value;
      }
    });
  }

  cleanup(view) {
    if (!view.contentEl) return;
    view.contentEl.querySelectorAll('[data-dr-depth]').forEach((el) => delete el.dataset.drDepth);
  }
}

CanvasDepth.settingKey = 'canvasDepth';
