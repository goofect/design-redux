/* ------------------------------------------------------------------ */
/* Cards gliding into place                                            */
/*                                                                     */
/* A fold, an unfold or a tidy moves cards. Rather than jump, they     */
/* glide there over a moment, their arrows following: cards going into */
/* a fold slide into it as they fade, and cards coming out of one      */
/* slide out of it. Only the end is put on the canvas as its records,  */
/* and only then is anything saved. With less motion asked for — or    */
/* nothing on screen to watch — they're simply put there.              */
/* ------------------------------------------------------------------ */

import { shownAs } from './316-canvas-tree.js';
import { applyCanvasModel } from './317-canvas-room.js';
import { tuckedBBox } from './336-canvas-tucks.js';

export const GLIDE_MS = 240;

/** Whether a canvas's cards should glide: a window drawing it, and no ask for less motion. */
export function canvasMotion(view) {
  const el = view && view.containerEl;
  const win = el && el.ownerDocument && el.ownerDocument.defaultView;
  if (!win || !el.isConnected || typeof win.requestAnimationFrame !== 'function' || typeof win.matchMedia !== 'function') {
    return false;
  }
  try {
    return !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    return false;
  }
}

export function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function boxOf(r) {
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function sameBox(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * The records' changes since `before` put on the canvas, gliding there
 * where there's motion, then `done(changed)` — at once, without. While
 * it glides, `state.gliding` is set, and `state.glide.finish()` ends it
 * on the spot.
 */
export function glideCanvasModel(view, model, before, state, done) {
  const land = () => done(applyCanvasModel(model, before));
  if (!canvasMotion(view)) return land();
  const tracks = [];
  model.nodes.forEach((rec) => {
    const node = rec.node;
    const was = before.get(rec.id);
    if (!node || !node.nodeEl || !was || typeof node.moveAndResize !== 'function') return;
    const own = boxOf(rec);
    if (rec.tuck && !was.tucked) {
      // Into the fold it's going into, fading.
      const into = shownAs(model, rec);
      if (into && into !== rec) tracks.push({ node, from: boxOf(was), to: boxOf(into), fade: -1, end: own });
      return;
    }
    if (!rec.tuck && was.tucked) {
      // Out of the fold it was in, as it was then.
      let by = null;
      try {
        by = JSON.parse(was.tuck).by;
      } catch (err) {
        by = null;
      }
      const holder = by && before.get(by);
      tracks.push({ node, from: holder ? boxOf(holder) : own, to: own, fade: 1, end: own });
      return;
    }
    if (rec.tuck) return;
    if (!sameBox(was, own)) tracks.push({ node, from: boxOf(was), to: own, fade: 0, end: own });
  });
  if (!tracks.length) return land();

  const win = view.containerEl.ownerDocument.defaultView;
  const holder = state || {};
  let frame = 0;
  let over = false;
  const step = (t) => {
    const e = easeInOut(t);
    const at = (a, b) => Math.round(a + (b - a) * e);
    tracks.forEach(({ node, from, to, fade }) => {
      node.moveAndResize({ x: at(from.x, to.x), y: at(from.y, to.y), width: at(from.width, to.width), height: at(from.height, to.height) });
      if (fade) node.nodeEl.style.opacity = String(fade > 0 ? e : 1 - e);
    });
  };
  const finish = () => {
    if (over) return;
    over = true;
    if (frame) win.cancelAnimationFrame(frame);
    tracks.forEach(({ node, end, fade }) => {
      node.moveAndResize(end);
      if (fade) node.nodeEl.style.removeProperty('opacity');
    });
    holder.gliding = false;
    holder.glide = null;
    land();
  };
  holder.gliding = true;
  holder.glide = { finish };
  // Coming out of a fold: drawn again, from nothing, its arrows drawn to it again.
  const coming = new Set();
  tracks.forEach(({ node, fade }) => {
    if (fade <= 0) return;
    coming.add(node);
    node.nodeEl.style.opacity = '0';
    node.nodeEl.removeClass('dr-tucked');
    if (typeof tuckedBBox === 'function' && node.getBBox === tuckedBBox) {
      delete node.getBBox;
      delete node.drInto;
    }
  });
  if (coming.size) {
    model.edges.forEach((e) => {
      const a = model.byId.get(e.from);
      const b = model.byId.get(e.to);
      const edge = e.edge;
      if (!edge || !a || !b || !(coming.has(a.node) || coming.has(b.node))) return;
      const label = edge.labelElement && edge.labelElement.wrapperEl;
      [edge.lineGroupEl, edge.lineEndGroupEl, label].forEach((el) => {
        if (el && el.classList) el.classList.remove('dr-tucked-edge');
      });
    });
  }
  const start = win.performance.now();
  const tick = (now) => {
    frame = 0;
    if (over) return;
    const t = Math.min(1, (now - start) / GLIDE_MS);
    step(t);
    if (t < 1) frame = win.requestAnimationFrame(tick);
    else finish();
  };
  frame = win.requestAnimationFrame(tick);
}
