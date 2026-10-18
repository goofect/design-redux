/* ------------------------------------------------------------------ */
/* Canvas: zoom to a branch, and back                                  */
/*                                                                     */
/* Zoom to branch fits a card and what's below it on screen. And the   */
/* canvas remembers where it was looking before each jump — zooming    */
/* to a branch, a selection or everything, finding a card, the outline */
/* — so Back returns there, a step at a time. The canvas's view isn't  */
/* public: asked carefully, and where it can't be, nothing's kept.     */
/* ------------------------------------------------------------------ */

import { setCanvasView, zoomCanvasTo } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { canvasModel } from './316-canvas-tree.js';
import { isCanvasEdge } from './332-canvas-arrows.js';
import { arrowLinks, boundsOf, branchOf } from '../tree/400-tree-model.js';

export const VIEW_HISTORY_LIMIT = 30;

/** Where a canvas is looking: { x, y, zoom }, or null. */
export function canvasLook(canvas) {
  if (!canvas || typeof canvas.x !== 'number' || typeof canvas.y !== 'number' || typeof canvas.zoom !== 'number') return null;
  return { x: canvas.x, y: canvas.y, zoom: typeof canvas.tZoom === 'number' ? canvas.tZoom : canvas.zoom };
}

export class CanvasViews extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasViews',
        name: 'Zoom to branch, and back',
        desc: 'A card’s menu fits it and its branch on screen; a command goes back to where the canvas was looking before each jump.',
      },
    ];
  }

  actions() {
    const card = (ctx) => (this.enabled && ctx.node && !isCanvasEdge(ctx.node) && this.watched.has(ctx.view) ? ctx.node : null);
    return [
      { id: 'canvas-zoom-to-branch', name: 'Zoom to the selected card’s branch', menu: 'Zoom to branch', icon: 'scan', on: 'canvas', when: (ctx) => !!card(ctx), run: (ctx) => this.zoomToBranch(ctx.view, card(ctx)) },
      {
        id: 'canvas-view-back',
        name: 'Back to where the canvas was looking',
        menu: false,
        icon: 'history',
        on: 'canvas',
        when: (ctx) => {
          const state = this.enabled && this.watched.get(ctx.view);
          return !!(state && state.history && state.history.length);
        },
        run: (ctx) => this.back(ctx.view),
      },
    ];
  }

  // Nothing drawn on the canvas.
  pass() {}

  /** The canvas's jumps, each noted first: where it was looking. */
  mount(view, state) {
    const canvas = view.canvas;
    state.history = [];
    state.wrapped = [];
    const feature = this;
    ['zoomToBbox', 'zoomToSelection', 'zoomToFit'].forEach((name) => {
      const original = canvas[name];
      if (typeof original !== 'function') return;
      const wrapper = function (...args) {
        feature.remember(state, canvas);
        return original.apply(this, args);
      };
      canvas[name] = wrapper;
      state.wrapped.push([name, original, wrapper]);
    });
  }

  cleanup(view, state) {
    const canvas = view.canvas;
    if (!state || !state.wrapped || !canvas) return;
    // Put back only what's still ours: something else may have wrapped it since.
    state.wrapped.forEach(([name, original, wrapper]) => {
      if (canvas[name] === wrapper) canvas[name] = original;
    });
    state.wrapped = [];
  }

  remember(state, canvas) {
    if (state.going) return;
    const look = canvasLook(canvas);
    if (!look) return;
    const last = state.history[state.history.length - 1];
    if (last && Math.abs(last.x - look.x) < 10 && Math.abs(last.y - look.y) < 10 && Math.abs(last.zoom - look.zoom) < 0.05) return;
    state.history.push(look);
    if (state.history.length > VIEW_HISTORY_LIMIT) state.history.shift();
  }

  /** Back to where it was looking before the last jump. */
  back(view) {
    const state = view && this.watched.get(view);
    const look = state && state.history.pop();
    if (!look) return false;
    state.going = true;
    try {
      return setCanvasView(view.canvas, look.x, look.y, look.zoom);
    } finally {
      state.going = false;
    }
  }

  /** The card and its branch, as drawn, fitted on screen. */
  zoomToBranch(view, node) {
    const canvas = view && view.canvas;
    if (!canvas || !node) return false;
    const model = canvasModel(canvas);
    const rec = model.byId.get(node.id);
    if (!rec) return false;
    const cards = [rec].concat(branchOf(model, rec.id, arrowLinks(model)).map((id) => model.byId.get(id)).filter((r) => r && !r.tuck));
    const box = boundsOf(cards);
    const pad = 40;
    return zoomCanvasTo(canvas, { minX: box.x - pad, minY: box.y - pad, maxX: box.x + box.width + pad, maxY: box.y + box.height + pad });
  }
}

CanvasViews.settingKey = 'canvasViews';
