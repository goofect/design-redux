/* ------------------------------------------------------------------ */
/* Canvas: find, focus and duplicate                                   */
/*                                                                     */
/* Three small things a large canvas wants. Find goes to a card by its */
/* words, opening the folds it's tucked into. Focus dims everything    */
/* but a card's branch. Duplicate copies a card with everything its    */
/* arrows lead to, set beside the original.                            */
/* ------------------------------------------------------------------ */

/** The cards below some cards by their arrows, shown and tucked alike, with them. Ids. */
function branchWithin(model, ids, links) {
  links = links || arrowLinks(model);
  const seen = new Set(ids);
  const queue = ids.slice();
  while (queue.length) {
    (links.children.get(queue.shift()) || []).forEach((c) => {
      if (seen.has(c) || !model.byId.has(c)) return;
      seen.add(c);
      queue.push(c);
    });
  }
  return Array.from(seen);
}

/** The cards within `steps` arrows of some cards, either way, related arrows too. Ids, with them. */
function neighbourhood(model, ids, steps) {
  const next = new Map();
  const join = (a, b) => {
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  };
  model.edges.forEach((e) => {
    join(e.from, e.to);
    join(e.to, e.from);
  });
  const seen = new Set(ids);
  let ring = ids.slice();
  for (let s = 0; s < steps && ring.length; s++) {
    const out = [];
    ring.forEach((id) =>
      (next.get(id) || []).forEach((c) => {
        if (seen.has(c) || !model.byId.has(c)) return;
        seen.add(c);
        out.push(c);
      })
    );
    ring = out;
  }
  return Array.from(seen);
}

/** A menu entry in the canvas menu's own actions section. */
function canvasAction(item) {
  if (typeof item.setSection === 'function') item.setSection('action');
  return item;
}

/* -- find --------------------------------------------------------------- */

class CanvasCardPicker extends FuzzySuggestModal {
  constructor(app, items, onChoose) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.setPlaceholder('Find a card on this canvas');
  }

  getItems() {
    return this.items;
  }

  getItemText(item) {
    return item.text;
  }

  renderSuggestion(match, el) {
    super.renderSuggestion(match, el);
    if (match.item.where) el.createDiv({ cls: 'dr-find-where', text: match.item.where });
  }

  onChooseItem(item) {
    this.onChoose(item);
  }
}

class CanvasFind extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasFind',
        name: 'Find a card',
        desc: 'A command to jump to a card by its text, opening any fold it’s in.',
      },
    ];
  }

  // Nothing drawn on the canvas.
  sync() {}

  commands() {
    return [
      {
        id: 'find-canvas-card',
        name: 'Find a card on the canvas',
        icon: 'search',
        check: () => this.enabled && !!this.pageCanvas(),
        run: () => this.open(this.pageCanvas()),
      },
    ];
  }

  open(view) {
    if (!view || !view.canvas) return;
    const model = canvasModel(view.canvas);
    const items = model.nodes.map((rec) => {
      const body = rec.type === 'text' ? String(rec.text || '').replace(/\s+/g, ' ').trim() : '';
      const label = canvasCardLabel(rec);
      const holder = rec.tuck ? shownAs(model, rec) : null;
      return {
        id: rec.id,
        // The whole of a text card's words can be searched, not only its first line.
        text: body && body !== label ? `${label} — ${body}` : label,
        where: rec.type === 'group' ? 'Group' : holder && holder !== rec ? `Folded into “${canvasCardLabel(holder)}”` : '',
      };
    });
    new CanvasCardPicker(this.app, items, (item) => this.goTo(view, item.id)).open();
  }

  /** The card brought out of any folds it's in, selected and in view. */
  async goTo(view, id) {
    const canvas = view.canvas;
    const fold = this.plugin.feature(CanvasFold);
    for (let i = 0; i < 20; i++) {
      const model = canvasModel(canvas);
      const rec = model.byId.get(id);
      if (!rec || !rec.tuck || !fold) break;
      const holder = shownAs(model, rec);
      if (!holder || holder === rec || !holder.node) break;
      await fold.foldBranches(view, [holder.node], false);
    }
    const node = canvas.nodes.get(id);
    if (!node) return;
    try {
      if (typeof canvas.selectOnly === 'function') canvas.selectOnly(node);
      if (typeof canvas.zoomToSelection === 'function') canvas.zoomToSelection();
      else if (typeof canvas.panIntoView === 'function') canvas.panIntoView(node.getBBox());
    } catch (err) {
      /* left where it was */
    }
  }
}

CanvasFind.settingKey = 'canvasFind';

/* -- focus ---------------------------------------------------------------- */

class CanvasFocus extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasFocus',
        name: 'Focus on a branch',
        desc: 'Dim everything but a card’s branch, or the cards round it, from its right-click menu. + and − widen or narrow it; Escape ends it.',
      },
      {
        key: 'canvasFocusSelect',
        showIf: 'canvasFocus',
        name: 'Quieten what’s unrelated to the selected card',
        desc: 'With one card selected, cards and arrows not joined to it fade a little, so what it connects to stands out.',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'focus-canvas-branch',
        name: 'Focus on the selected card’s branch',
        icon: 'focus',
        check: () => {
          const view = this.pageCanvas();
          return this.enabled && !!view && (this.focusOf(view) !== null || this.selectedNodes(view).length > 0);
        },
        run: () => {
          const view = this.pageCanvas();
          if (this.focusOf(view)) this.setFocus(view, null);
          else this.setFocus(view, this.selectedNodes(view).map((n) => n.id));
        },
      },
    ];
  }

  focusOf(view) {
    const state = view && this.watched.get(view);
    return state && state.focus ? state.focus : null;
  }

  mount(view, state) {
    state.onKey = (evt) => {
      if (!state.focus || typingInto(evt.target)) return;
      if (evt.key === 'Escape') this.setFocus(view, null);
      else if (state.near && (evt.key === '+' || evt.key === '=')) this.widen(view, 1);
      else if (state.near && evt.key === '-') this.widen(view, -1);
    };
    view.containerEl.addEventListener('keydown', state.onKey);
  }

  addMenuItems(menu, nodes) {
    const first = nodes[0];
    const view = first && first.canvas && first.canvas.view;
    if (!view || !this.watched.has(view)) return;
    const on = !!this.focusOf(view);
    menu.addItem((item) =>
      canvasAction(item)
        .setTitle(on ? 'Stop focusing' : 'Focus on branch')
        .setIcon('focus')
        .onClick(() => this.setFocus(view, on ? null : nodes.map((n) => n.id)))
    );
    if (!on) {
      menu.addItem((item) =>
        canvasAction(item)
          .setTitle('Focus on neighbourhood')
          .setIcon('radar')
          .onClick(() => this.setFocus(view, nodes.map((n) => n.id), true))
      );
    }
  }

  /** A step further out round the cards focused on, or a step nearer; at least one. */
  widen(view, by) {
    const state = view && this.watched.get(view);
    if (!state || !state.focus || !state.near) return;
    const near = Math.max(1, Math.min(9, state.near + by));
    if (near === state.near) return;
    state.near = near;
    this.pass(view, state);
    new Notice(`${near} ${near === 1 ? 'step' : 'steps'} out. + and − widen and narrow it; Escape ends it.`);
  }

  /**
   * Focus on these cards' branches — or, `near`, on the cards round them
   * by any arrow, a step out to start — or, given null, on everything again.
   */
  setFocus(view, ids, near) {
    const state = view && this.watched.get(view);
    if (!state) return;
    state.focus = ids && ids.length ? ids : null;
    state.near = state.focus && near ? 1 : 0;
    this.pass(view, state);
  }

  /**
   * Each redraw: what's in the branch lit, the rest dimmed — cards drawn
   * later too. With no focus asked for, and the setting on, one card
   * selected lights it and the cards joined to it, the rest faded a little.
   */
  pass(view, state) {
    const host = view.contentEl;
    if (!state) return;
    let ids = state.focus;
    let near = state.near;
    const soft = !ids && !!this.settings.canvasFocusSelect;
    if (soft) {
      const picked = this.selectedNodes(view).filter((n) => !isCanvasEdge(n) && !isGroupNode(n));
      ids = picked.length === 1 && !picked[0].isEditing ? [picked[0].id] : null;
      near = 1;
    }
    if (!ids) {
      if (host.hasClass('dr-branch-focus')) this.cleanup(view);
      return;
    }
    const model = canvasModel(view.canvas);
    ids = ids.filter((id) => model.byId.has(id));
    const lit = new Set(near ? neighbourhood(model, ids, near) : branchWithin(model, ids));
    if (!lit.size || (soft && lit.size < 2)) {
      if (!soft) state.focus = null;
      this.cleanup(view);
      return;
    }
    host.addClass('dr-branch-focus');
    host.toggleClass('is-soft', soft);
    model.nodes.forEach((rec) => {
      if (rec.node && rec.node.nodeEl) rec.node.nodeEl.toggleClass('dr-focus-lit', lit.has(rec.id));
    });
    model.edges.forEach((e) => {
      const on = lit.has(e.from) && lit.has(e.to);
      const edge = e.edge;
      const label = edge && edge.labelElement && edge.labelElement.wrapperEl;
      [edge && edge.lineGroupEl, edge && edge.lineEndGroupEl, label].forEach((el) => {
        if (el && el.classList) el.classList.toggle('dr-focus-lit', on);
      });
    });
  }

  cleanup(view, state) {
    if (state && state.onKey && view.containerEl) view.containerEl.removeEventListener('keydown', state.onKey);
    const host = view.contentEl;
    if (!host) return;
    host.removeClass('dr-branch-focus', 'is-soft');
    host.querySelectorAll('.dr-focus-lit').forEach((el) => el.classList.remove('dr-focus-lit'));
  }
}

CanvasFocus.settingKey = 'canvasFocus';
// A selection made by a click or a key changes no element the watcher sees.
CanvasFocus.watchInput = true;

/* -- duplicate ------------------------------------------------------------------ */

const DUPLICATE_GAP = 80;

class CanvasDuplicate extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasDuplicate',
        name: 'Duplicate branch',
        desc: 'Copy a card and its branch beside the original, from its right-click menu.',
      },
    ];
  }

  // Only the menus: nothing is drawn on the canvas.
  sync() {}

  commands() {
    return [
      {
        id: 'duplicate-canvas-branch',
        name: 'Duplicate the selected card’s branch',
        icon: 'copy-plus',
        check: () => {
          const view = this.pageCanvas();
          return this.enabled && !!view && this.selectedNodes(view).length === 1;
        },
        run: () => {
          const view = this.pageCanvas();
          this.duplicate(view, this.selectedNodes(view)[0]);
        },
      },
    ];
  }

  addMenuItems(menu, nodes) {
    if (nodes.length !== 1) return;
    const node = nodes[0];
    const view = node && node.canvas && node.canvas.view;
    if (!view || !view.canvas || isGroupNode(node)) return;
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    if (!(links.children.get(node.id) || []).length) return;
    menu.addItem((item) =>
      canvasAction(item)
        .setTitle('Duplicate branch')
        .setIcon('copy-plus')
        .onClick(() => this.duplicate(view, node))
    );
  }

  /** The card and its branch copied, set beyond the original on the side its siblings line up. */
  duplicate(view, node) {
    const canvas = view && view.canvas;
    if (!canvas || !node || typeof canvas.getData !== 'function' || typeof canvas.importData !== 'function') return;
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(canvas);
    const root = model.byId.get(node.id);
    if (!root || root.tuck || isGroupRecord(root)) return;
    const links = arrowLinks(model);
    const ids = branchWithin(model, [root.id], links).filter((id) => !isGroupRecord(model.byId.get(id)));
    const inBranch = new Set(ids);
    const data = canvas.getData();
    const byId = new Map((data.nodes || []).map((n) => [n.id, n]));
    // Where the copy goes: past the branch as it's drawn, across from where it grows.
    const shown = ids.map((id) => model.byId.get(id)).filter((r) => !r.tuck);
    const box = boundsOf(shown);
    const grows = branchSide(model, root.id, links);
    const across = grows === 'bottom' || grows === 'top';
    const dx = across ? box.width + DUPLICATE_GAP : 0;
    const dy = across ? 0 : box.height + DUPLICATE_GAP;
    const fresh = new Map(ids.map((id) => [id, newCanvasId(canvas)]));
    const nodes = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((n) => {
        const copy = JSON.parse(JSON.stringify(n));
        copy.id = fresh.get(n.id);
        copy.x = n.x + dx;
        copy.y = n.y + dy;
        // Folds inside the branch come along; one from outside it, or the room a fold noted, doesn't.
        const tuck = copy[TUCK_KEY];
        if (tuck && inBranch.has(tuck.by)) copy[TUCK_KEY] = Object.assign({}, tuck, { by: fresh.get(tuck.by) });
        else delete copy[TUCK_KEY];
        Object.keys(copy).forEach((k) => {
          if (/^drRoom/.test(k)) delete copy[k];
        });
        return copy;
      });
    const edges = (data.edges || [])
      .filter((e) => inBranch.has(e.fromNode) && inBranch.has(e.toNode))
      .map((e) => Object.assign(JSON.parse(JSON.stringify(e)), { id: newCanvasId(canvas), fromNode: fresh.get(e.fromNode), toNode: fresh.get(e.toNode) }));
    try {
      canvas.importData({ nodes, edges });
      canvas.requestSave();
      const copy = canvas.nodes.get(fresh.get(root.id));
      if (copy && typeof canvas.selectOnly === 'function') canvas.selectOnly(copy);
      if (copy && typeof canvas.panIntoView === 'function') canvas.panIntoView(copy.getBBox());
    } catch (err) {
      console.error('Design Redux: could not duplicate the branch', err);
      new Notice('Could not duplicate the branch.');
    }
    if (fold) fold.schedule(view);
  }
}

CanvasDuplicate.settingKey = 'canvasDuplicate';
