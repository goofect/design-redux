/* ------------------------------------------------------------------ */
/* Canvas: find, focus and duplicate                                   */
/*                                                                     */
/* Three small things a large canvas wants. Find goes to a card by its */
/* words, opening the folds it's tucked into. Focus dims everything    */
/* but a card's branch. Duplicate copies a card with everything its    */
/* arrows lead to, set beside the original.                            */
/* ------------------------------------------------------------------ */

import { FuzzySuggestModal, Menu, Notice, setIcon } from 'obsidian';
import { menuGroup, showMenuAt } from '../core/030-helpers-art.js';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { actionContext, actionItem, actionLabel, applies } from '../core/078-actions.js';
import { addToCanvas, arrowElements, canvasDataOf, cardEditing, cardElement, liveCard, pickOnCanvas, requestCanvasSave, showCard, zoomCanvasToPicked } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { arrowLinks, boundsOf, branchSide, canvasCardLabel, canvasGap, canvasModel, isGroupRecord, shownAs, TUCK_KEY } from './316-canvas-tree.js';
import { isCanvasEdge } from './332-canvas-arrows.js';
import { newCanvasId, typingInto } from './334-canvas-mindmap.js';
import { CanvasFold, isGroupNode } from './335-canvas-fold.js';

/** The cards below some cards by their arrows, shown and tucked alike, with them. Ids. */
export function branchWithin(model, ids, links) {
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
export function neighbourhood(model, ids, steps) {
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
export function canvasAction(item) {
  if (typeof item.setSection === 'function') item.setSection('action');
  return item;
}

/* -- find --------------------------------------------------------------- */

export class CanvasCardPicker extends FuzzySuggestModal {
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

export class CanvasFind extends CanvasFeature {
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

  actions() {
    return [{ id: 'find-canvas-card', name: 'Find a card on the canvas', menu: false, icon: 'search', on: 'canvas', when: () => this.enabled, run: (ctx) => this.open(ctx.view) }];
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
    const node = liveCard(canvas, id);
    if (!node) return;
    pickOnCanvas(canvas, [node]);
    if (!zoomCanvasToPicked(canvas)) showCard(canvas, node);
  }
}

CanvasFind.settingKey = 'canvasFind';

/* -- focus ---------------------------------------------------------------- */

export class CanvasFocus extends CanvasFeature {
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

  actions() {
    const focused = (ctx) => !!this.focusOf(ctx.view);
    const on = (ctx) => this.enabled && this.watched.has(ctx.view);
    return [
      {
        id: 'focus-canvas-branch',
        name: 'Focus on the selected card’s branch',
        menu: (ctx) => (focused(ctx) ? 'Stop focusing' : 'Focus on branch'),
        icon: 'focus',
        on: 'canvas',
        when: (ctx) => on(ctx) && (focused(ctx) || ctx.nodes.length > 0),
        run: (ctx) => this.setFocus(ctx.view, focused(ctx) ? null : ctx.nodes.map((n) => n.id)),
      },
      {
        id: 'focus-canvas-near',
        name: 'Focus on neighbourhood',
        icon: 'radar',
        on: 'canvas',
        palette: false,
        when: (ctx) => on(ctx) && !focused(ctx) && ctx.nodes.length > 0,
        run: (ctx) => this.setFocus(ctx.view, ctx.nodes.map((n) => n.id), true),
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
      ids = picked.length === 1 && !cardEditing(picked[0]) ? [picked[0].id] : null;
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
      const el = rec.node ? cardElement(rec.node) : null;
      if (el) el.toggleClass('dr-focus-lit', lit.has(rec.id));
    });
    model.edges.forEach((e) => {
      const on = lit.has(e.from) && lit.has(e.to);
      const edge = e.edge;
      const label = edge && edge.labelElement && edge.labelElement.wrapperEl;
      (edge ? arrowElements(edge) : []).concat(label || []).forEach((el) => {
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

export const DUPLICATE_GAP = 80;

export class CanvasDuplicate extends CanvasFeature {
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

  actions() {
    // One card, not a group, that leads somewhere.
    const branch = (ctx) => {
      const node = ctx.node;
      if (!this.enabled || !node || isCanvasEdge(node) || isGroupNode(node)) return false;
      return (arrowLinks(canvasModel(ctx.view.canvas)).children.get(node.id) || []).length > 0;
    };
    return [{ id: 'duplicate-canvas-branch', name: 'Duplicate the selected card’s branch', menu: 'Duplicate branch', icon: 'copy-plus', on: 'canvas', when: branch, run: (ctx) => this.duplicate(ctx.view, ctx.node) }];
  }

  /** The card and its branch copied, set beyond the original on the side its siblings line up. */
  duplicate(view, node) {
    const canvas = view && view.canvas;
    if (!canvas || !node) return;
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(canvas);
    const root = model.byId.get(node.id);
    if (!root || root.tuck || isGroupRecord(root)) return;
    const links = arrowLinks(model);
    const ids = branchWithin(model, [root.id], links).filter((id) => !isGroupRecord(model.byId.get(id)));
    const inBranch = new Set(ids);
    const data = canvasDataOf(canvas);
    if (!data) return;
    const byId = new Map((data.nodes || []).map((n) => [n.id, n]));
    // Where the copy goes: past the branch as it's drawn, across from where it grows.
    const shown = ids.map((id) => model.byId.get(id)).filter((r) => !r.tuck);
    const box = boundsOf(shown);
    const grows = branchSide(model, root.id, links);
    const across = grows === 'bottom' || grows === 'top';
    const dx = across ? box.width + canvasGap(DUPLICATE_GAP) : 0;
    const dy = across ? 0 : box.height + canvasGap(DUPLICATE_GAP);
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
    if (addToCanvas(canvas, { nodes, edges })) {
      requestCanvasSave(canvas);
      const copy = liveCard(canvas, fresh.get(root.id));
      if (copy) {
        pickOnCanvas(canvas, [copy]);
        showCard(canvas, copy);
      }
    } else {
      new Notice('Could not duplicate the branch.');
    }
    if (fold) fold.schedule(view);
  }
}

CanvasDuplicate.settingKey = 'canvasDuplicate';

/* -- every tool, by what it's for ------------------------------------- */

/*
 * The canvas's tools by what they're for, rather than by which feature
 * has them: making cards, arranging them, finding your way, structure,
 * and looking the canvas over. Each tool says itself whether it fits
 * what's selected, so the menu is only ever what can be done now.
 */
export const CANVAS_TASKS = [
  {
    title: 'Add',
    icon: 'circle-plus',
    ids: ['canvas-quick-add', 'canvas-add-child-card', 'canvas-add-sibling-card', 'canvas-add-parent-card', 'duplicate-canvas-branch', 'canvas-outline-to-branch', 'canvas-make-claim', 'canvas-add-reason', 'canvas-add-objection', 'canvas-add-rebuttal', 'canvas-add-evidence'],
  },
  {
    title: 'Arrange',
    icon: 'layout-grid',
    ids: ['canvas-layout-choose', 'canvas-layout-everything', 'tidy-canvas-branch', 'canvas-spread-overlaps', 'fit-canvas-cards', 'center-canvas-text', 'canvas-promote-card', 'canvas-demote-card', 'canvas-card-earlier', 'canvas-card-later', 'canvas-toggle-keep-in-place', 'arrange-canvas-left', 'arrange-canvas-center', 'arrange-canvas-right', 'arrange-canvas-top', 'arrange-canvas-middle', 'arrange-canvas-bottom', 'arrange-canvas-space-across', 'arrange-canvas-space-down', 'arrange-canvas-width', 'arrange-canvas-height', 'arrange-canvas-grid', 'arrange-canvas-row', 'arrange-canvas-column'],
  },
  {
    title: 'Connect',
    icon: 'waypoints',
    ids: ['canvas-name-relationship', 'canvas-reverse-relationship', 'canvas-toggle-related', 'canvas-show-relationship', 'canvas-state-proposition'],
  },
  {
    title: 'Focus',
    icon: 'focus',
    ids: ['find-canvas-card', 'canvas-find-statement', 'focus-canvas-branch', 'canvas-zoom-to-branch', 'canvas-view-back', 'select-canvas-branch', 'open-canvas-outline', 'toggle-canvas-minimap', 'toggle-canvas-legend'],
  },
  {
    // Folding, master cards, notes from branches, checking and comparing: the rest, a press further.
    title: 'More',
    icon: 'ellipsis',
    ids: ['fold-canvas-branch', 'fold-every-canvas-branch', 'unfold-canvas-everything', 'toggle-canvas-master-card', 'canvas-branch-to-note', 'canvas-keep-outline', 'canvas-statements-note', 'check-canvas', 'canvas-compare-branches', 'canvas-keep-snapshot', 'canvas-compare', 'canvas-compare-done'],
  },
];

export class CanvasTools extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasTools',
        name: 'Canvas tools',
        desc: 'Buttons among the canvas’s controls for what you’re doing — Add, Arrange, Connect, Focus, More — each showing only when something in it fits what’s selected.',
      },
      {
        key: 'canvasToolButtons',
        type: 'dropdown',
        name: 'Canvas tool buttons',
        desc: 'A button for each task, or one button with every task in its menu.',
        options: { tasks: 'One for each task', one: 'One button' },
        showIf: 'canvasTools',
      },
    ];
  }

  actions() {
    return [{ id: 'canvas-tools', name: 'Canvas tools…', icon: 'wrench', on: 'canvas', menu: false, when: () => this.enabled, run: (ctx) => this.showMenu(ctx && ctx.evt) }];
  }

  /** The tools that fit now, a group for each task that has any: [{ task, items: [{ action, ctx }] }]. */
  toolsByTask() {
    const byId = new Map();
    (this.plugin.features || []).forEach((f) => {
      if (f === this || !f.enabled) return;
      let list = [];
      try {
        list = f.actions();
      } catch (err) {
        list = [];
      }
      list.forEach((a) => byId.set(a.id, a));
    });
    return CANVAS_TASKS.map((task) => ({
      task,
      items: task.ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((action) => ({ action, ctx: actionContext(this.app, action) }))
        .filter(({ action, ctx }) => ctx && applies(action, ctx)),
    })).filter((group) => group.items.length);
  }

  /** Every task's tools: a submenu for each — or, where menus can't nest, one list, each name after its task's. */
  showMenu(evt) {
    const menu = new Menu();
    const groups = this.toolsByTask();
    groups.forEach(({ task, items }) =>
      menuGroup(menu, task.title, task.icon, (m, nested) =>
        items.forEach(({ action, ctx }) => m.addItem((item) => actionItem(item, action, Object.assign(ctx, { from: 'tools' }), nested ? actionLabel(action, ctx) : `${task.title}: ${actionLabel(action, ctx)}`)))
      )
    );
    if (!groups.length) menu.addItem((item) => item.setTitle('Nothing to do here yet').setDisabled(true));
    this.settingsItem(menu);
    // From the palette there's no press to open it at: it opens at the button.
    if (!evt) {
      const view = this.pageCanvas();
      const state = view && this.watched.get(view);
      const button = state && state.control && state.control.querySelector('.canvas-control-item');
      if (button) evt = { currentTarget: button };
    }
    showMenuAt(menu, evt);
  }

  /** One task's tools, from its button. */
  showTask(evt, title) {
    const group = this.toolsByTask().find((g) => g.task.title === title);
    const menu = new Menu();
    (group ? group.items : []).forEach(({ action, ctx }) =>
      menu.addItem((item) => actionItem(item, action, Object.assign(ctx, { from: 'tools' }), actionLabel(action, ctx)))
    );
    if (!group) menu.addItem((item) => item.setTitle('Nothing to do here now').setDisabled(true));
    if (title === 'More') this.settingsItem(menu);
    showMenuAt(menu, evt);
  }

  settingsItem(menu) {
    if (typeof this.plugin.openSettingsAt !== 'function') return;
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('Canvas settings…').setIcon('settings').onClick(() => this.plugin.openSettingsAt('canvasTools')));
  }

  /** Among the canvas's controls, a group for the tools' buttons. */
  mount(view, state) {
    const controls = view.containerEl.querySelector('.canvas-controls');
    if (!controls) return;
    state.control = controls.createDiv({ cls: 'canvas-control-group dr-tools-control' });
    this.drawButtons(state);
  }

  /** Drawn again when what's selected changes what fits — only then: drawing is a change the watcher sees. */
  pass(view, state) {
    if (state && state.control) this.drawButtons(state);
  }

  drawButtons(state) {
    const one = this.settings.canvasToolButtons === 'one';
    const groups = one ? [] : this.toolsByTask();
    const key = one ? 'one' : groups.map((g) => g.task.title).join('|');
    const group = state.control;
    if (group.dataset.key === key) return;
    group.dataset.key = key;
    group.empty();
    const button = (label, icon, open, task) => {
      const item = group.createDiv({ cls: 'canvas-control-item dr-tool-task' });
      if (task) item.dataset.task = task;
      item.setAttribute('aria-label', label);
      item.setAttribute('data-tooltip-position', 'left');
      asButton(item);
      setIcon(item, icon);
      onActivate(item, open);
    };
    if (one) {
      button('Canvas tools', 'wrench', (evt) => this.showMenu(evt));
      return;
    }
    groups.forEach(({ task }) => button(task.title, task.icon, (evt) => this.showTask(evt, task.title), task.title));
  }

  cleanup(view, state) {
    if (state && state.control) state.control.remove();
  }
}

CanvasTools.settingKey = 'canvasTools';
