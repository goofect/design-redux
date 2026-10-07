/* ------------------------------------------------------------------ */
/* Tidying and selecting a branch                                      */
/*                                                                     */
/* A card's branch — what its arrows lead to, and on — laid out as a   */
/* tidy tree growing the way its arrows leave it, with the cards round */
/* it kept as far off as they were; or selected with the card, to move */
/* or colour together. From the card's right-click menu, or commands.  */
/* ------------------------------------------------------------------ */

class CanvasBranches extends CanvasFeature {
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

  commands() {
    return [
      {
        id: 'tidy-canvas-branch',
        name: 'Tidy the selected card’s branch',
        icon: 'network',
        check: () => !!this.settings.canvasTidy && !!this.target(this.pageCanvas()),
        run: () => this.tidy(this.pageCanvas(), this.target(this.pageCanvas())),
      },
      {
        id: 'select-canvas-branch',
        name: 'Select the selected card’s branch',
        icon: 'git-branch',
        check: () => !!this.settings.canvasSelectBranch && !!this.target(this.pageCanvas()),
        run: () => this.selectBranch(this.pageCanvas(), this.target(this.pageCanvas())),
      },
    ];
  }

  /** The one selected card, if it has cards below it by its arrows. */
  target(view) {
    const selected = this.selectedNodes(view);
    if (selected.length !== 1) return null;
    return this.hasBranch(view, selected[0]) ? selected[0] : null;
  }

  hasBranch(view, node) {
    if (!view || !view.canvas || !node) return false;
    const model = canvasModel(view.canvas);
    const rec = model.byId.get(node.id);
    return !!rec && !rec.tuck && !isGroupRecord(rec) && shownChildren(model, arrowLinks(model), rec.id).length > 0;
  }

  addMenuItems(menu, nodes) {
    if (nodes.length !== 1) return;
    const node = nodes[0];
    const view = node && node.canvas && node.canvas.view;
    if (!this.hasBranch(view, node)) return;
    if (this.settings.canvasTidy) {
      menu.addItem((item) =>
        item
          .setTitle('Tidy branch')
          .setIcon('network')
          .onClick(() => this.tidy(view, node))
      );
    }
    if (this.settings.canvasSelectBranch) {
      menu.addItem((item) =>
        item
          .setTitle('Select branch')
          .setIcon('git-branch')
          .onClick(() => this.selectBranch(view, node))
      );
    }
  }

  /** The branch laid out as a tree, and its arrows leaving and arriving on the sides the tree grows by. */
  tidy(view, node) {
    if (!view || !view.canvas || !node) return Promise.resolve(false);
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
    try {
      if (typeof canvas.deselectAll === 'function') canvas.deselectAll();
      cards.forEach((n) => canvas.select(n));
    } catch (err) {
      /* left as it was */
    }
  }
}

/** An arrow's ends moved to other sides of its cards. */
function setEdgeSides(edge, fromSide, toSide) {
  try {
    if (!edge || typeof edge.getData !== 'function' || typeof edge.setData !== 'function') return false;
    edge.setData(Object.assign({}, edge.getData(), { fromSide, toSide }));
    if (typeof edge.render === 'function') edge.render();
    return true;
  } catch (err) {
    return false;
  }
}
