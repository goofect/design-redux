/* ------------------------------------------------------------------ */
/* Canvas: present a map                                               */
/*                                                                     */
/* A tree of cards stepped through like a talk or a revision pass: the */
/* view goes to one card at a time, it and the cards above it at full   */
/* strength, the rest faded back, and a trail at the foot says where    */
/* you are. Read-only while it runs; leaving puts back the view and     */
/* the selection, so a presentation never changes the canvas: it saves  */
/* nothing and adds no step of Undo.                                   */
/* ------------------------------------------------------------------ */

import { Notice, TFile } from 'obsidian';
import { pageLeaf } from '../core/030-helpers-art.js';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { canvasCamera, cardBox, cardData, cardElement, liveCard, liveCards, pickedOnCanvas, pickOnCanvas, setCanvasCamera, setCanvasReadonly, zoomCanvasTo, zoomToCard } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { canvasCardLabel, canvasModel } from './316-canvas-tree.js';
import { presentationOrder } from './325-canvas-layouts.js';

/* The classes a presentation puts on cards, all taken off when it ends. */
const PRESENT_CLASSES = ['dr-present-now', 'dr-present-dim', 'dr-present-hidden'];

export class CanvasPresent extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasPresent',
        name: 'Present a map',
        desc: 'Step through a tree of cards like a talk: one card at a time, the rest faded back, a trail at the foot. Arrow keys or Space to move, R to reveal cards as you reach them, O to see the whole map, Escape to leave. Nothing on the canvas is changed.',
      },
      {
        key: 'presentDimLevel',
        type: 'number',
        showIf: 'canvasPresent',
        name: 'How faint the other cards are',
        desc: 'From 0 (gone) to 1 (as they are).',
      },
      {
        key: 'presentCaption',
        showIf: 'canvasPresent',
        name: 'A note’s opening lines',
        desc: 'On a card that’s a note, its first lines at the foot as it’s shown.',
      },
    ];
  }

  actions() {
    const on = (ctx) => this.enabled && this.watched.has(ctx.view);
    const presenting = (ctx) => on(ctx) && !!this.presentation(ctx.view);
    return [
      { id: 'present-map', name: 'Present this map', menu: 'Present', icon: 'presentation', on: 'canvas', when: (ctx) => on(ctx) && !this.presentation(ctx.view), run: (ctx) => this.start(ctx.view, ctx.nodes.length === 1 ? ctx.nodes[0] : null) },
      { id: 'present-next', name: 'Presentation: next card', menu: false, icon: 'arrow-right', on: 'canvas', when: presenting, run: (ctx) => this.step(ctx.view, 1) },
      { id: 'present-back', name: 'Presentation: card before', menu: false, icon: 'arrow-left', on: 'canvas', when: presenting, run: (ctx) => this.step(ctx.view, -1) },
      { id: 'present-exit', name: 'Presentation: leave', menu: false, icon: 'x', on: 'canvas', when: presenting, run: (ctx) => this.exit(ctx.view) },
    ];
  }

  presentation(view) {
    const state = view && this.watched.get(view);
    return state ? state.present || null : null;
  }

  /** From the root of the canvas's trees, or from a card's branch. */
  start(view, from) {
    const state = this.watched.get(view);
    if (!state || state.present) return null;
    const canvas = view.canvas;
    const order = presentationOrder(canvasModel(canvas), from ? from.id : null);
    if (!order.length) {
      new Notice('Nothing to present: this canvas has no cards.');
      return null;
    }
    const p = {
      order,
      at: 0,
      reveal: false,
      overview: false,
      camera: canvasCamera(canvas),
      picked: pickedOnCanvas(canvas),
      readonly: setCanvasReadonly(canvas, true),
    };
    state.present = p;
    pickOnCanvas(canvas, []);
    const host = view.contentEl;
    host.addClass('dr-presenting');
    const dim = Number(this.settings.presentDimLevel);
    host.style.setProperty('--dr-present-dim', String(dim >= 0 && dim <= 1 ? dim : 0.15));
    p.bar = host.createDiv({ cls: 'dr-present-bar' });
    // Its keys before the canvas's own, so a stray one can't change the map.
    const win = host.ownerDocument.defaultView || window;
    p.keys = (evt) => this.key(view, evt);
    win.addEventListener('keydown', p.keys, true);
    p.win = win;
    this.show(view, true);
    return p;
  }

  key(view, evt) {
    const p = this.presentation(view);
    if (!p) return;
    const leaf = pageLeaf(this.app);
    if (!leaf || leaf.view !== view) return;
    const t = evt.target;
    if (t && (t.closest && t.closest('.modal-container, .prompt, .menu'))) return;
    const keys = {
      ArrowRight: () => this.step(view, 1),
      ' ': () => this.step(view, 1),
      ArrowLeft: () => this.step(view, -1),
      ArrowUp: () => this.toParent(view),
      ArrowDown: () => this.toChild(view),
      r: () => this.toggleReveal(view),
      R: () => this.toggleReveal(view),
      o: () => this.toggleOverview(view),
      O: () => this.toggleOverview(view),
      Escape: () => this.exit(view),
    };
    if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
    evt.preventDefault();
    evt.stopPropagation();
    if (keys[evt.key]) keys[evt.key]();
  }

  go(view, at) {
    const p = this.presentation(view);
    if (!p) return;
    p.at = Math.max(0, Math.min(p.order.length - 1, at));
    p.overview = false;
    this.show(view, true);
  }

  step(view, by) {
    const p = this.presentation(view);
    if (p) this.go(view, p.at + by);
  }

  toParent(view) {
    const p = this.presentation(view);
    const up = p && p.order[p.at].ancestors.slice(-1)[0];
    if (up) this.go(view, p.order.findIndex((s) => s.id === up));
  }

  toChild(view) {
    const p = this.presentation(view);
    const next = p && p.order[p.at + 1];
    if (next && next.ancestors[next.ancestors.length - 1] === p.order[p.at].id) this.go(view, p.at + 1);
  }

  toggleReveal(view) {
    const p = this.presentation(view);
    if (!p) return;
    p.reveal = !p.reveal;
    this.show(view, false);
  }

  /** The whole map, and back to the card. */
  toggleOverview(view) {
    const p = this.presentation(view);
    if (!p) return;
    p.overview = !p.overview;
    if (!p.overview) {
      this.show(view, true);
      return;
    }
    const boxes = liveCards(view.canvas).map(cardBox);
    if (!boxes.length) return;
    const pad = 80;
    zoomCanvasTo(view.canvas, {
      minX: Math.min(...boxes.map((b) => b.minX)) - pad,
      minY: Math.min(...boxes.map((b) => b.minY)) - pad,
      maxX: Math.max(...boxes.map((b) => b.maxX)) + pad,
      maxY: Math.max(...boxes.map((b) => b.maxY)) + pad,
    });
  }

  /** The card in hand lit, those above it kept, the rest faded — or hidden till reached — and the view taken to it. */
  show(view, move) {
    const p = this.presentation(view);
    if (!p) return;
    this.mark(view, p);
    const card = liveCard(view.canvas, p.order[p.at].id);
    if (move && card) zoomToCard(view.canvas, card, 120, this.stillness(view));
    this.drawBar(view, p, card);
  }

  /** Whether motion is asked to be kept down: the view jumps rather than glides. */
  stillness(view) {
    const win = view.contentEl.ownerDocument.defaultView || window;
    return !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** Only classes on the cards: what a redraw of the canvas repeats, adding nothing it would see. */
  mark(view, p) {
    const step = p.order[p.at];
    const lit = new Set(step.ancestors.concat([step.id]));
    const seen = new Set(p.order.slice(0, p.at + 1).map((s) => s.id));
    liveCards(view.canvas).forEach((card) => {
      const el = cardElement(card);
      if (!el) return;
      el.toggleClass('dr-present-now', card.id === step.id);
      el.toggleClass('dr-present-dim', !lit.has(card.id));
      el.toggleClass('dr-present-hidden', p.reveal && !seen.has(card.id));
    });
  }

  /** Root › Branch › Card · 7 of 23, each name a step back to it; a note's opening lines above. */
  drawBar(view, p, card) {
    const bar = p.bar;
    bar.empty();
    const model = canvasModel(view.canvas);
    const step = p.order[p.at];
    const caption = bar.createDiv({ cls: 'dr-present-caption' });
    const trail = bar.createDiv({ cls: 'dr-present-trail' });
    step.ancestors.concat([step.id]).forEach((id, i, all) => {
      const rec = model.byId.get(id);
      const name = trail.createSpan({ cls: 'dr-present-crumb', text: rec ? canvasCardLabel(rec) : '' });
      if (id === step.id) name.addClass('is-now');
      else {
        asButton(name, 'Go to this card');
        onActivate(name, () => this.go(view, p.order.findIndex((s) => s.id === id)));
      }
      if (i < all.length - 1) trail.createSpan({ cls: 'dr-present-sep', text: '›' });
    });
    trail.createSpan({ cls: 'dr-present-count', text: `${p.at + 1} of ${p.order.length}` });
    if (p.reveal) trail.createSpan({ cls: 'dr-present-mode', text: 'Reveal' });
    const exit = trail.createSpan({ cls: 'clickable-icon dr-present-exit', text: '×' });
    asButton(exit, 'Leave the presentation');
    onActivate(exit, () => this.exit(view));
    this.caption(caption, card);
  }

  /** A note's card: the note's first lines, once they're read. */
  caption(el, card) {
    if (!this.settings.presentCaption || !card) return;
    const data = cardData(card) || {};
    const file = data.type === 'file' && data.file ? this.app.vault.getAbstractFileByPath(data.file) : null;
    if (!(file instanceof TFile) || file.extension !== 'md' || typeof this.app.vault.cachedRead !== 'function') return;
    this.app.vault.cachedRead(file).then((text) => {
      if (!el.isConnected) return;
      const body = String(text).replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
      const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !/^#{1,6}\s/.test(l));
      const opening = lines.slice(0, 2).join(' ');
      el.setText(opening.length > 220 ? `${opening.slice(0, 217)}…` : opening);
    });
  }

  /** Back to the canvas as it was: the view, the selection, editable if it was. */
  exit(view, state = this.watched.get(view)) {
    const p = state && state.present;
    if (!p) return;
    state.present = null;
    if (p.win) p.win.removeEventListener('keydown', p.keys, true);
    if (p.bar) p.bar.remove();
    this.clearMarks(view);
    const canvas = view.canvas;
    if (p.readonly !== null) setCanvasReadonly(canvas, p.readonly);
    setCanvasCamera(canvas, p.camera);
    pickOnCanvas(canvas, p.picked);
  }

  clearMarks(view) {
    const host = view.contentEl;
    host.removeClass('dr-presenting');
    host.style.removeProperty('--dr-present-dim');
    host.querySelectorAll(PRESENT_CLASSES.map((c) => `.${c}`).join(', ')).forEach((el) => PRESENT_CLASSES.forEach((c) => el.removeClass(c)));
  }

  // Cards drawn later — scrolled into view — take the presentation's look too.
  pass(view, state) {
    if (state && state.present) this.mark(view, state.present);
  }

  cleanup(view, state) {
    this.exit(view, state);
  }
}

CanvasPresent.settingKey = 'canvasPresent';
