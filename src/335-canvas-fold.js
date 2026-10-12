/* ------------------------------------------------------------------ */
/* Folding branches on a canvas                                        */
/*                                                                     */
/* A card's branch — everything its arrows lead to — tucks into the    */
/* card, which then shows how many cards it holds where its arrows     */
/* left it, and sits on a little stack of them. What a fold took is    */
/* kept in the cards' own data in the canvas file, which Obsidian keeps */
/* as it is, so a fold travels with the canvas. What's beyond a fold    */
/* closes up the room it left, and moves back out when it unfolds —    */
/* gliding, not jumping; unfolding moves back exactly what folding    */
/* moved. A master card stays out of the folds above it, with what     */
/* hangs from it, and folds its own branch.                            */
/*                                                                     */
/* The file is written only when something is folded or unfolded by   */
/* hand; what a redraw changes is saved with the canvas's next change. */
/*                                                                     */
/* Cards and groups folded on their own by an earlier version open     */
/* again when the canvas is opened, so nothing stays folded out of     */
/* reach; a branch already folded can always be unfolded, whatever the */
/* settings say.                                                       */
/* ------------------------------------------------------------------ */

const FOLD_KEY = 'drFold';

/** A card or group folded on its own by an earlier version: its sizes, or null. */
function foldOf(node) {
  const kept = node && node.unknownData && node.unknownData[FOLD_KEY];
  return kept && typeof kept.height === 'number' ? kept : null;
}

/** How tall a group folded by an earlier version opens out: room round the cards tucked inside it, as they sit in it. */
function groupOpenHeight(model, rec) {
  const inside = model.nodes.filter((n) => n.tuck && n.tuck.by === rec.id);
  const bottom = Math.max(0, ...inside.map((n) => n.tuck.dy + n.height));
  return Math.max(rec.height, bottom + 40);
}

/** Whether a canvas card is a group. */
function isGroupNode(node) {
  try {
    const data = node && typeof node.getData === 'function' ? node.getData() : node;
    return !!data && data.type === 'group';
  } catch (err) {
    return false;
  }
}

/** Cards tucked straight into a record, in the order they sat beside it. */
function tuckedInto(model, id) {
  return model.nodes
    .filter((n) => n.tuck && n.tuck.by === id)
    .sort((a, b) => a.tuck.dy - b.tuck.dy || a.tuck.dx - b.tuck.dx);
}

/**
 * Folds an earlier version made of single cards and groups, opened on the
 * records: largest first, until none is left, since what comes out of
 * one may hold another. Returns whether any was.
 */
function openOldFolds(model, close) {
  let any = false;
  for (let round = 0; round < 50; round++) {
    let more = false;
    model.nodes
      .filter((r) => !r.tuck && (r.fold || (isGroupRecord(r) && tuckedCount(model, r.id) > 0)))
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .forEach((r) => {
        if (r.tuck) return;
        // A group holding cards with no record of its fold: rewritten
        // without it, folded still, to open round them.
        if (!r.fold && isGroupRecord(r)) r.fold = { height: groupOpenHeight(model, r), folded: r.height, measured: true };
        if (unfoldRecord(model, r, close)) more = true;
      });
    if (!more) break;
    any = true;
  }
  return any;
}

class CanvasFold extends CanvasFeature {
  constructor(plugin) {
    super(plugin);
    this.popover = new FoldPopover();
  }

  settingsSchema() {
    return [
      {
        key: 'canvasBranches',
        name: 'Fold branches',
        desc: 'Fold everything a card’s arrows lead to into it, from the bar above it or its menu. A crowned master card stays out of folds above it.',
      },
      {
        key: 'canvasCloseGaps',
        name: 'Close gaps',
        desc: 'Cards nearby move in when a branch folds, and back when it opens.',
      },
    ];
  }

  get canBranch() {
    return !!this.settings.canvasBranches;
  }

  get closing() {
    return this.settings.canvasCloseGaps !== false;
  }

  actions() {
    const model = (ctx) => canvasModel(ctx.view.canvas);
    // On a card's menu, its own branch; from the palette, any of the selected cards'.
    const folds = (ctx) => (ctx.from === 'palette' || ctx.nodes.length === 1 ? this.branchTargets(ctx.view, ctx.nodes) : []);
    const folded = (ctx) => folds(ctx).every((n) => tuckedCount(model(ctx), n.id) > 0);
    const masters = (ctx) => this.masterCandidates(ctx.view, ctx.nodes);
    const status = (ctx) => this.foldStatus(model(ctx));
    return [
      {
        id: 'fold-canvas-branch',
        name: 'Fold or unfold the selected card’s branch',
        menu: (ctx) => (folded(ctx) ? 'Unfold branch' : 'Fold branch'),
        menuIcon: (ctx) => (folded(ctx) ? 'chevrons-up-down' : 'chevrons-down-up'),
        icon: 'chevrons-down-up',
        on: 'canvas',
        when: (ctx) => folds(ctx).length > 0,
        run: (ctx) => this.foldBranches(ctx.view, folds(ctx), !folded(ctx)),
      },
      {
        id: 'fold-every-canvas-branch',
        name: 'Fold every branch on the canvas',
        menu: false,
        icon: 'chevrons-down-up',
        on: 'canvas',
        when: (ctx) => this.canBranch && status(ctx).roots > 0,
        run: (ctx) => this.foldEverything(ctx.view, 'branches'),
      },
      {
        id: 'toggle-canvas-master-card',
        name: 'Make the selected cards master cards, or not',
        menu: (ctx) => (ctx.nodes.length > 1 ? 'Master cards' : 'Master card'),
        icon: 'crown',
        on: 'canvas',
        checked: (ctx) => masters(ctx).every((r) => r.master),
        when: (ctx) => masters(ctx).length > 0,
        run: (ctx) => {
          const recs = masters(ctx);
          this.setMaster(ctx.view, recs.map((r) => r.node), !recs.every((r) => r.master));
        },
      },
      {
        id: 'unfold-canvas-everything',
        name: 'Unfold every branch on the canvas',
        menu: false,
        icon: 'chevrons-up-down',
        on: 'canvas',
        when: (ctx) => status(ctx).anything,
        run: (ctx) => this.foldEverything(ctx.view, 'everything'),
      },
    ];
  }

  /** The selected cards — or these — whose branch can be folded, or is. */
  branchTargets(view, nodes) {
    const selected = nodes || this.selectedNodes(view);
    if (!view || !selected.length) return [];
    const model = canvasModel(view.canvas);
    const links = arrowLinks(model);
    return selected.filter((n) => {
      const rec = model.byId.get(n.id);
      if (!rec || rec.tuck || isGroupRecord(rec)) return false;
      if (tuckedCount(model, rec.id)) return true;
      return this.canBranch && foldableBranch(model, rec.id, links).length > 0;
    });
  }

  /** The selected cards that can be master cards, or are: shown cards that aren't groups. */
  masterTargets(view) {
    if (!view || !this.canBranch) return [];
    const model = canvasModel(view.canvas);
    return this.selectedNodes(view).filter((n) => {
      const rec = model.byId.get(n.id);
      return rec && !rec.tuck && !isGroupRecord(rec);
    });
  }

  /** Cards made master cards, or not. Kept in their data: saved, and a step of Undo. */
  setMaster(view, nodes, on) {
    if (!view || !view.canvas || !nodes.length) return;
    this.settle(view);
    nodes.forEach((node) => {
      if (!node.unknownData) node.unknownData = {};
      if (on) node.unknownData[MASTER_KEY] = true;
      else delete node.unknownData[MASTER_KEY];
    });
    // Made master with no arrow leading into it: said why nothing above folds it yet.
    if (on) {
      const model = canvasModel(view.canvas);
      const links = arrowLinks(model);
      const loose = nodes.map((n) => model.byId.get(n.id)).filter((rec) => rec && !(links.parents.get(rec.id) || []).length);
      if (loose.length && typeof Notice === 'function') {
        const what = loose.length === 1 ? `“${canvasCardLabel(loose[0])}” has` : `${loose.length} of them have`;
        new Notice(`Master card set. ${what} no arrow pointing into it yet, so no fold above can take it: point one at it from the card it belongs under.`, 8000);
      }
    }
    this.save(view);
    this.pass(view);
    const ws = this.app && this.app.workspace;
    if (ws && typeof ws.trigger === 'function') ws.trigger('design-redux:canvas-changed', view);
  }

  /** A canvas still gliding from the last fold, put where it's going: what's next starts from there. */
  settle(view) {
    const state = view && this.watched.get(view);
    if (state && state.glide) state.glide.finish();
  }

  /** A card's branch tucked into it, or back out. By hand: one of the times the file is written. */
  foldBranches(view, nodes, on) {
    if (!view || !view.canvas) return Promise.resolve(false);
    this.settle(view);
    const model = canvasModel(view.canvas);
    const before = snapshotModel(model);
    let any = false;
    (nodes || []).forEach((node) => {
      const rec = model.byId.get(node.id);
      if (!rec || rec.tuck || isGroupRecord(rec)) return;
      const links = arrowLinks(model);
      const ids = on ? foldBranch(model, rec, this.closing, links) : unfoldBranch(model, rec, this.closing, links);
      any = any || ids.length > 0;
    });
    return this.finish(view, model, before, any);
  }

  /** What there is to fold and unfold on a canvas, for the button and its menu. */
  foldStatus(model) {
    const links = arrowLinks(model);
    const s = { roots: 0, tucked: 0, anything: false };
    model.nodes.forEach((rec) => {
      if (rec.tuck) {
        s.tucked++;
        return;
      }
      if (isGroupRecord(rec)) return;
      const parents = (links.parents.get(rec.id) || []).filter((p) => {
        const r = model.byId.get(p);
        return r && !r.tuck;
      });
      if ((!parents.length || rec.master) && foldableBranch(model, rec.id, links).length) s.roots++;
    });
    s.anything = s.tucked > 0;
    return s;
  }

  /**
   * Every branch folded, from the cards at the top of each tree and every
   * master card ('branches'), or every one unfolded ('everything').
   */
  foldEverything(view, what) {
    if (!view || !view.canvas) return Promise.resolve(false);
    this.settle(view);
    const model = canvasModel(view.canvas);
    const before = snapshotModel(model);
    const close = this.closing;
    const shown = () => model.nodes.filter((n) => !n.tuck);
    let any = false;
    if (what === 'branches') {
      const top = (r) => {
        const links = arrowLinks(model);
        return !(links.parents.get(r.id) || []).some((p) => model.byId.get(p) && !model.byId.get(p).tuck);
      };
      shown()
        .filter((r) => !isGroupRecord(r) && (top(r) || r.master))
        .forEach((r) => {
          if (!r.tuck && foldBranch(model, r, close, arrowLinks(model)).length) any = true;
        });
    } else if (what === 'everything') {
      // Unfolded until nothing's left folded: what comes out of one may hold another.
      for (let round = 0; round < 50; round++) {
        let more = false;
        shown()
          .filter((r) => !isGroupRecord(r) && tuckedCount(model, r.id))
          .forEach((r) => {
            if (!r.tuck && unfoldBranch(model, r, close, arrowLinks(model)).length) more = true;
          });
        if (!more) break;
        any = true;
      }
    }
    return this.finish(view, model, before, any);
  }

  /**
   * Changes onto the canvas — gliding there, then saved, which also makes
   * them one step of Undo — and everything redrawn. Settles once they're there.
   */
  finish(view, model, before, any) {
    return new Promise((resolve) => {
      const state = this.watched.get(view);
      const end = (changed) => {
        if (changed) this.save(view);
        this.pass(view);
        // The outline follows.
        const ws = this.app && this.app.workspace;
        if (ws && typeof ws.trigger === 'function') ws.trigger('design-redux:canvas-changed', view);
        resolve(changed);
      };
      if (!any) return end(false);
      this.popover.hide();
      glideCanvasModel(view, model, before, state, end);
    });
  }

  save(view) {
    try {
      if (typeof view.canvas.requestSave === 'function') view.canvas.requestSave();
    } catch (err) {
      /* saved with the canvas's next change */
    }
  }

  /**
   * Each redraw, in memory only: what changes here is saved with the
   * canvas's next change. That also keeps it out of Undo: a step of its
   * own, undone, would only bring the canvas back here to be changed
   * again. Not while cards glide: they're on their way.
   */
  pass(view, state) {
    if (!view || !view.canvas) return;
    state = state || this.watched.get(view);
    if (state && state.gliding) return;
    const model = canvasModel(view.canvas);
    const before = snapshotModel(model);
    let changed = state ? restoreOrphans(model, state, this.closing) : false;
    if (openOldFolds(model, this.closing)) changed = true;
    if (changed) applyCanvasModel(model, before);
    // Cards, not the groups folded away with them.
    const counts = new Map();
    model.nodes.forEach((n) => {
      if (n.tuck && !isGroupRecord(n)) counts.set(n.tuck.by, (counts.get(n.tuck.by) || 0) + 1);
    });
    let anyBranch = false;
    const links = arrowLinks(model);
    model.nodes.forEach((rec) => {
      const node = rec.node;
      if (!node || !node.nodeEl || rec.tuck) return;
      this.stack(node, (counts.get(rec.id) || 0) > 0);
      this.crown(node, this.canBranch && rec.master && !isGroupRecord(rec));
      if (!anyBranch && !isGroupRecord(rec) && ((counts.get(rec.id) || 0) > 0 || (links.children.get(rec.id) || []).length)) anyBranch = true;
    });
    this.knobs(view, model, counts);
    if (state) drawTucks(view, model, state);
    this.control(view, anyBranch);
    this.decorateMenu(view);
  }

  /** The cards tucked into a fold, by name: one picked opens the fold and goes to it. */
  fillTucked(view, holderId, pop) {
    pop.addClass('dr-fold-list');
    const model = canvasModel(view.canvas);
    const inside = tuckedInto(model, holderId).filter((rec) => !isGroupRecord(rec));
    pop.createDiv({ cls: 'dr-fold-list-head', text: inside.length === 1 ? '1 card tucked away' : `${inside.length} cards tucked away` });
    const list = pop.createDiv({ cls: 'dr-fold-list-rows' });
    const most = 14;
    inside.slice(0, most).forEach((rec) => {
      const row = list.createDiv({ cls: 'dr-fold-list-row' });
      asButton(row);
      colourMark(row, rec.color);
      row.createSpan({ cls: 'dr-fold-list-label', text: canvasCardLabel(rec) });
      const more = tuckedCount(model, rec.id);
      if (more) row.createSpan({ cls: 'dr-fold-list-count', text: `+${more}` });
      onActivate(row, () => this.openTo(view, holderId, rec.id));
    });
    if (inside.length > most) list.createDiv({ cls: 'dr-fold-list-more', text: `and ${inside.length - most} more` });
  }

  /** A branch opened, and the canvas brought round to one of the cards that came out of it. */
  async openTo(view, holderId, cardId) {
    this.popover.hide();
    const canvas = view.canvas;
    const holder = canvas.nodes.get(holderId);
    if (!holder) return;
    await this.foldBranches(view, [holder], false);
    const node = canvas.nodes.get(cardId);
    if (!node) return;
    try {
      if (typeof canvas.selectOnly === 'function') canvas.selectOnly(node);
      if (typeof canvas.panIntoView === 'function') canvas.panIntoView(node.getBBox());
    } catch (err) {
      /* left where it was */
    }
  }

  /** A master card: a crown on its top edge. */
  crown(node, on) {
    const el = node.nodeEl;
    const has = el.querySelector(':scope > .dr-master-mark');
    if (on && !has) {
      const mark = el.createDiv({ cls: 'dr-master-mark' });
      mark.setAttribute('aria-label', 'Master card: stays out of the folds above it');
      mark.setAttribute('data-tooltip-position', 'top');
      setIcon(mark, 'crown');
    } else if (!on && has) {
      has.remove();
    }
  }

  /** Something holding tucked cards: drawn as a little stack of them. */
  stack(node, on) {
    const el = node.nodeEl;
    const has = el.querySelector(':scope > .dr-stack');
    el.toggleClass('dr-holds', on);
    if (on && !has) {
      el.createDiv({ cls: 'dr-stack is-far' });
      el.createDiv({ cls: 'dr-stack is-near' });
      // Behind the card: first in it.
      el.querySelectorAll(':scope > .dr-stack').forEach((s) => el.insertBefore(s, el.firstChild));
    } else if (!on && has) {
      el.querySelectorAll(':scope > .dr-stack').forEach((s) => s.remove());
    }
  }

  /**
   * A folded branch's count, where its arrows left the card — their
   * place, now they're tucked away with it. Pointed at, it names the
   * cards it holds; pressed, it opens. An open branch shows nothing on
   * the canvas: it's folded from the bar above the card, or its menu.
   */
  knobs(view, model, counts) {
    const sides = branchSides(model, arrowLinks(model));
    model.nodes.forEach((rec) => {
      const node = rec.node;
      if (!node || !node.nodeEl) return;
      let knob = node.nodeEl.querySelector(':scope > .dr-branch-knob');
      const count = !rec.tuck && !isGroupRecord(rec) ? counts.get(rec.id) || 0 : 0;
      if (!count) {
        if (knob) knob.remove();
        return;
      }
      if (!knob) {
        knob = node.nodeEl.createDiv({ cls: 'dr-branch-knob' });
        knob.setAttribute('role', 'button');
        stopCanvasPointer(knob);
        knob.addEventListener('click', (evt) => {
          evt.stopPropagation();
          evt.preventDefault();
          this.foldBranches(view, [node], false);
        });
        this.popover.attach(knob, () => knob.isConnected, (pop) => this.fillTucked(view, node.id, pop), 'below');
      }
      const side = sides.get(rec.id) || 'right';
      const state = `${side}:${count}`;
      if (knob.dataset.state === state) return;
      knob.dataset.state = state;
      knob.className = `dr-branch-knob is-${side} is-folded`;
      knob.empty();
      knob.createSpan({ cls: 'dr-branch-count', text: `+${count}` });
      knob.setAttribute('aria-label', `Unfold branch: ${count === 1 ? '1 card' : `${count} cards`}`);
    });
  }

  /**
   * Fold branch in the bar above the selected cards, beside Obsidian's
   * own buttons, and Master card.
   * Redrawn only when what it shows changes, since drawing it is itself
   * a change the watcher sees.
   */
  decorateMenu(view) {
    const bar = view.contentEl.querySelector('.canvas-menu');
    if (!bar) return;
    const roots = this.branchTargets(view);
    let branch = null;
    if (roots.length) {
      const model = canvasModel(view.canvas);
      const folded = roots.every((n) => tuckedCount(model, n.id) > 0);
      branch = { title: folded ? 'Unfold branch' : 'Fold branch', icon: folded ? 'chevrons-up-down' : 'chevrons-down-up' };
    }
    menuButton(bar, 'dr-branch-button', branch, () => {
      const now = this.branchTargets(view);
      const model = canvasModel(view.canvas);
      if (now.length) this.foldBranches(view, now, !now.every((n) => tuckedCount(model, n.id) > 0));
    });
    // Master card beside it.
    const these = this.masterCandidates(view);
    const on = these.length > 0 && these.every((r) => r.master);
    const many = these.length > 1;
    const title = on ? (many ? 'Master cards: on' : 'Master card: on') : many ? `Make ${these.length} master cards` : 'Make master card';
    menuButton(bar, 'dr-master-button', these.length ? { title, icon: 'crown' } : null, () => {
      const now = this.masterCandidates(view);
      if (now.length) this.setMaster(view, now.map((r) => r.node), !now.every((r) => r.master));
    });
    const crown = bar.querySelector('.dr-master-button');
    if (crown) crown.toggleClass('is-active', on);
  }

  /** The selected cards — or `nodes` — that can be master cards: any shown card but a group. Their records. */
  masterCandidates(view, nodes) {
    if (!view || !view.canvas || !this.canBranch) return [];
    const model = canvasModel(view.canvas);
    return (nodes || this.selectedNodes(view)).map((n) => model.byId.get(n.id)).filter((rec) => rec && !rec.tuck && !isGroupRecord(rec));
  }

  /** Beside the canvas's zoom controls: folding, for every branch at once. */
  control(view, any) {
    const controls = view.containerEl.querySelector('.canvas-controls');
    if (!controls) return;
    let group = controls.querySelector(':scope > .dr-fold-control');
    if (!any) {
      if (group) group.remove();
      return;
    }
    if (group) return;
    group = controls.createDiv({ cls: 'canvas-control-group dr-fold-control' });
    // Above the outline's button, which may have been put there first:
    // added once the cards have loaded, it would otherwise go below it,
    // where a short window cuts the column off.
    const outline = controls.querySelector(':scope > .dr-outline-control');
    if (outline) controls.insertBefore(group, outline);
    const item = group.createDiv({ cls: 'canvas-control-item' });
    asButton(item);
    item.setAttribute('data-tooltip-position', 'left');
    item.setAttribute('aria-label', 'Folding');
    setIcon(item, 'chevrons-down-up');
    onActivate(item, (evt) => this.foldMenu(view, item, evt));
  }

  /** What can be folded or unfolded all at once, as a menu. */
  foldMenu(view, anchor, evt) {
    this.settle(view);
    const s = this.foldStatus(canvasModel(view.canvas));
    const menu = new Menu();
    let count = 0;
    const add = (title, icon, what) => {
      count++;
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(icon)
          .onClick(() => this.foldEverything(view, what))
      );
    };
    if (this.canBranch && s.roots) add('Fold every branch', 'chevrons-down-up', 'branches');
    if (s.anything) add('Unfold every branch', 'chevrons-up-down', 'everything');
    if (!count) add('Nothing to fold', 'chevrons-down-up', 'none');
    if (typeof menu.addSeparator === 'function') menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle('How folding works')
        .setIcon('help-circle')
        .onClick(() => new FoldingHelpModal(this.app, this.closing).open())
    );
    if (evt && typeof evt.clientX === 'number' && evt.clientX && typeof menu.showAtMouseEvent === 'function') {
      menu.showAtMouseEvent(evt);
    } else if (typeof menu.showAtPosition === 'function') {
      const r = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: r.left, y: r.bottom });
    }
    return menu;
  }

  cleanup(view) {
    this.popover.hide();
    view.contentEl.querySelectorAll('.dr-branch-knob, .dr-stack, .dr-branch-button, .dr-master-button, .dr-master-mark').forEach((el) => el.remove());
    view.contentEl.querySelectorAll('.dr-holds').forEach((el) => el.removeClass('dr-holds'));
    undrawTucks(view);
    if (view.containerEl) view.containerEl.querySelectorAll('.dr-fold-control').forEach((el) => el.remove());
  }
}

/** A button of ours in the canvas's selection bar: `what` gives its title and icon, or null for none. */
function menuButton(bar, cls, what, run) {
  let button = bar.querySelector(`.${cls}`);
  if (!what) {
    if (button) button.remove();
    return;
  }
  if (!button) {
    button = bar.createEl('button', { cls: `clickable-icon ${cls}` });
    button.setAttribute('data-tooltip-position', 'top');
    button.addEventListener('click', (evt) => {
      evt.stopPropagation();
      run();
    });
  }
  const key = `${what.title}|${what.icon}`;
  if (button.dataset.key === key) return;
  button.dataset.key = key;
  button.empty();
  setIcon(button, what.icon);
  button.setAttribute('aria-label', what.title);
}

/* The canvas drags, selects and opens a card from a press on it: a button on the card keeps its presses. */
function stopCanvasPointer(el) {
  const stop = (evt) => evt.stopPropagation();
  el.addEventListener('pointerdown', stop);
  el.addEventListener('mousedown', stop);
  el.addEventListener('dblclick', stop);
}

/* Looked over after a drag or Undo, too: tucked cards' arrows follow their fold. */
CanvasFold.watchInput = true;

/* What folding does, said plainly, from the folding menu. */
class FoldingHelpModal extends Modal {
  constructor(app, closing) {
    super(app);
    this.closing = closing;
  }

  onOpen() {
    this.modalEl.addClass('dr-fold-help');
    this.titleEl.setText('Folding on a canvas');
    const list = this.contentEl.createEl('ul');
    [
      [
        'Branches',
        'Select a card and press Fold branch in the bar above it — or right-click it — to tuck everything its arrows lead to into the card, with any group holding nothing but those cards. Where the arrows were, it then says how many cards it holds: point at the number to see which, and pick one to open the branch there.',
      ],
      [
        'Master cards',
        'Select a card — or several — and press the crown in the bar above it, or right-click and pick Master card, to keep it out of the folds above it: folding a card it hangs from leaves it, and what hangs from it, out. Its own branch still folds into it. A crown marks it, and there can be as many as you like.',
      ],
      ['Arrows', 'A folded card joins up with arrows like any other: draw one from it, or drop one on it.'],
      ['Everything', 'The button beside the zoom controls folds every branch at once — from the top of each tree, and from each master card — or unfolds them all.'],
      [
        'Room',
        this.closing
          ? 'What’s beyond a fold moves in to the room it leaves — never onto another card — and back exactly where it was when it opens; the groups it’s in shrink and grow with it.'
          : 'Folds leave their room as it was: nothing else moves. Switch on “Close gaps” in settings to have what’s beyond move in.',
      ],
      ['Kept', 'Folds are saved with the canvas, and Undo puts one back.'],
    ].forEach(([what, how]) => {
      const li = list.createEl('li');
      li.createEl('strong', { text: `${what}. ` });
      li.appendChild(li.ownerDocument.createTextNode(how));
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
