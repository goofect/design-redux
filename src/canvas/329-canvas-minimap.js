/* ------------------------------------------------------------------ */
/* Canvas: the minimap                                                 */
/*                                                                     */
/* The whole canvas small, in its corner, with the part on screen      */
/* outlined: pressing or dragging on it goes there. It's there only    */
/* while the cards don't all fit on screen. The canvas's view — where  */
/* it's looking, how near — isn't public: it's asked carefully, and    */
/* without it the map still shows the cards and goes to them.          */
/* ------------------------------------------------------------------ */

import { SVG_NS } from '../core/032-drawn-covers.js';
import { canvasViewport, lookAt } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { canvasModel } from './316-canvas-tree.js';
import { stopCanvasPointer } from './335-canvas-fold.js';
import { boundsOf, isGroupRecord, withinRect } from '../tree/400-tree-model.js';

export const MINIMAP_SIZE = { width: 200, height: 136 };

/**
 * How the canvas maps onto the minimap: its cards' box, scaled to fit,
 * centred. { scale, x, y, width, height, toMap(p), toCanvas(p) }.
 */
export function minimapFrame(box, size) {
  const pad = 8;
  const scale = Math.min((size.width - pad * 2) / Math.max(box.width, 1), (size.height - pad * 2) / Math.max(box.height, 1));
  const ox = (size.width - box.width * scale) / 2;
  const oy = (size.height - box.height * scale) / 2;
  return {
    scale,
    toMap: (p) => ({ x: ox + (p.x - box.x) * scale, y: oy + (p.y - box.y) * scale }),
    toCanvas: (p) => ({ x: box.x + (p.x - ox) / scale, y: box.y + (p.y - oy) / scale }),
  };
}

export class CanvasMinimap extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasMinimap',
        name: 'Minimap',
        desc: 'The whole canvas small, in its corner, while the cards don’t all fit on screen. Press or drag on it to go there.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'toggle-canvas-minimap',
        name: 'Show or hide the canvas minimap',
        menu: false,
        icon: 'map',
        on: 'canvas',
        when: () => true,
        run: () => {
          this.settings.canvasMinimap = !this.settings.canvasMinimap;
          this.plugin.saveSettings();
        },
      },
    ];
  }

  mount(view, state) {
    const host = view.contentEl;
    host.addClass('dr-canvas-host');
    const el = host.createDiv({ cls: 'dr-minimap is-hidden' });
    el.setAttribute('aria-label', 'Minimap');
    const svg = el.ownerDocument.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(MINIMAP_SIZE.width));
    svg.setAttribute('height', String(MINIMAP_SIZE.height));
    const cards = el.ownerDocument.createElementNS(SVG_NS, 'g');
    cards.setAttribute('class', 'dr-minimap-cards');
    const port = el.ownerDocument.createElementNS(SVG_NS, 'rect');
    port.setAttribute('class', 'dr-minimap-view');
    port.setAttribute('rx', '2');
    svg.append(cards, port);
    el.appendChild(svg);
    Object.assign(state, { mini: el, svg, cards, port, sign: '', frame: null, follow: 0 });
    if (typeof stopCanvasPointer === 'function') stopCanvasPointer(el);
    el.addEventListener('wheel', (evt) => evt.stopPropagation());
    // Pressing goes there; dragging keeps going.
    const go = (evt) => {
      if (!state.frame) return;
      const r = svg.getBoundingClientRect();
      lookAt(view.canvas, state.frame.toCanvas({ x: evt.clientX - r.left, y: evt.clientY - r.top }));
      this.follow(view, state);
    };
    el.addEventListener('pointerdown', (evt) => {
      if (evt.button !== 0) return;
      evt.preventDefault();
      state.dragging = true;
      if (typeof el.setPointerCapture === 'function' && evt.pointerId !== undefined) {
        try {
          el.setPointerCapture(evt.pointerId);
        } catch (err) {
          /* dragging still works over the map */
        }
      }
      go(evt);
    });
    el.addEventListener('pointermove', (evt) => {
      if (state.dragging) go(evt);
    });
    const stop = () => {
      state.dragging = false;
    };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    // The canvas moved by hand: the outline follows, a frame at a time.
    state.moved = () => this.follow(view, state);
    state.inputsMoved = ['wheel', 'pointermove', 'pointerup', 'keyup'];
    state.inputsMoved.forEach((type) => view.containerEl.addEventListener(type, state.moved, { passive: true, capture: true }));
    // And moved any other way — Find, the outline, a command: looked at now and then, while it's on screen.
    state.win = view.containerEl.ownerDocument.defaultView || window;
    state.timer = state.win.setInterval(() => {
      if (state.dragging || state.following || !view.containerEl.isConnected || !view.containerEl.offsetParent) return;
      this.drawView(view, state);
    }, 300);
  }

  /** The outline kept up with the canvas while it moves, for a moment after. */
  follow(view, state) {
    state.follow = Date.now() + 400;
    if (state.following) return;
    state.following = true;
    const step = () => {
      if (this.watched.get(view) !== state) return;
      this.drawView(view, state);
      if (Date.now() < state.follow) window.requestAnimationFrame(step);
      else state.following = false;
    };
    window.requestAnimationFrame(step);
  }

  /** Each redraw: the cards drawn again, where any has changed. */
  pass(view, state) {
    if (!state || !state.mini) return;
    if (!this.enabled) {
      state.mini.addClass('is-hidden');
      return;
    }
    const model = canvasModel(view.canvas);
    const shown = model.nodes.filter((n) => !n.tuck);
    const selected = new Set(this.selectedNodes(view).map((n) => n.id));
    const sign = shown.map((n) => `${n.id}:${Math.round(n.x)}:${Math.round(n.y)}:${Math.round(n.width)}:${Math.round(n.height)}:${selected.has(n.id) ? 1 : 0}`).join('|');
    if (sign !== state.sign) {
      state.sign = sign;
      this.drawCards(state, shown, selected);
    }
    this.drawView(view, state);
  }

  drawCards(state, shown, selected) {
    const box = boundsOf(shown);
    while (state.cards.firstChild) state.cards.removeChild(state.cards.firstChild);
    state.box = box;
    if (!box) {
      state.frame = null;
      return;
    }
    const frame = minimapFrame(box, MINIMAP_SIZE);
    state.frame = frame;
    // Groups first, under the cards.
    shown
      .slice()
      .sort((a, b) => (isGroupRecord(b) ? 1 : 0) - (isGroupRecord(a) ? 1 : 0))
      .forEach((n) => {
        const at = frame.toMap(n);
        const rect = state.cards.ownerDocument.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', at.x.toFixed(1));
        rect.setAttribute('y', at.y.toFixed(1));
        rect.setAttribute('width', Math.max(1.5, n.width * frame.scale).toFixed(1));
        rect.setAttribute('height', Math.max(1.5, n.height * frame.scale).toFixed(1));
        rect.setAttribute('rx', '1');
        rect.setAttribute('class', isGroupRecord(n) ? 'dr-minimap-group' : selected.has(n.id) ? 'dr-minimap-card is-selected' : 'dr-minimap-card');
        state.cards.appendChild(rect);
      });
  }

  /** The part on screen outlined; the map shown only while the cards don't all fit. */
  drawView(view, state) {
    const port = canvasViewport(view.canvas);
    const box = state.box;
    const fits = !box || !port || withinRect(box, port);
    state.mini.toggleClass('is-hidden', fits || !this.enabled);
    if (fits || !state.frame) return;
    const a = state.frame.toMap(port);
    const w = port.width * state.frame.scale;
    const h = port.height * state.frame.scale;
    // Kept within the map, however far off it's looking.
    const x = Math.max(-1, Math.min(MINIMAP_SIZE.width - 2, a.x));
    const y = Math.max(-1, Math.min(MINIMAP_SIZE.height - 2, a.y));
    state.port.setAttribute('x', x.toFixed(1));
    state.port.setAttribute('y', y.toFixed(1));
    state.port.setAttribute('width', Math.max(2, Math.min(w - (x - a.x), MINIMAP_SIZE.width + 1 - x)).toFixed(1));
    state.port.setAttribute('height', Math.max(2, Math.min(h - (y - a.y), MINIMAP_SIZE.height + 1 - y)).toFixed(1));
  }

  cleanup(view, state) {
    if (state && state.timer) state.win.clearInterval(state.timer);
    if (state && state.inputsMoved && view.containerEl) {
      state.inputsMoved.forEach((type) => view.containerEl.removeEventListener(type, state.moved, { capture: true }));
    }
    if (state && state.mini) state.mini.remove();
    else view.contentEl.querySelectorAll('.dr-minimap').forEach((el) => el.remove());
  }
}

CanvasMinimap.settingKey = 'canvasMinimap';
CanvasMinimap.desktopOnly = true;
CanvasMinimap.watchInput = true;
