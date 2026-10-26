/* ------------------------------------------------------------------ */
/* Mind map: gliding into place                                        */
/*                                                                    */
/* When the map's laid out again, nodes glide from where they were to  */
/* where they go, their edges following; a node that wasn't shown      */
/* slides out of its parent. Only what's drawn moves: the layout's end */
/* is already the map's, so a click or a key meanwhile acts on it.     */
/* Not while typing, not with the setting off, and never when the      */
/* system asks for less motion.                                        */
/* ------------------------------------------------------------------ */

import { nodeById } from '../tree/400-tree-model.js';
import { MindMapSaving } from './427-mindmap-save.js';

export const MAP_GLIDE_MS = 240;

/** Whether a window drawing this element may move things: no ask for less motion. */
export function mayMove(el) {
  const win = el && el.ownerDocument && el.ownerDocument.defaultView;
  if (!win || !el.isConnected || typeof win.requestAnimationFrame !== 'function' || typeof win.matchMedia !== 'function') return false;
  try {
    return !win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (err) {
    return false;
  }
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** Boxes part of the way from where they were to where they go. */
export function glideBoxes(from, to, t) {
  const boxes = new Map();
  to.boxes.forEach((b, id) => {
    const a = from.get(id);
    if (!a) return boxes.set(id, b);
    boxes.set(
      id,
      Object.assign({}, b, {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        width: a.width + (b.width - a.width) * t,
        height: a.height + (b.height - a.height) * t,
      })
    );
  });
  return { boxes, bounds: to.bounds };
}

export class MindMapMotion extends MindMapSaving {
  /** Nodes glide from `before` to the map's new scene — or, with no `before`, are simply put there. */
  glideFrom(before) {
    this.stopGlide();
    const to = this.scene;
    const on = !this.plugin || this.plugin.settings.mindmapGlide !== false;
    if (!before || !to || !on || !this.camera || !mayMove(this.root)) return;
    // Where each node starts: where it was, or, new to the view, where its nearest shown parent was.
    const from = new Map();
    let moves = false;
    to.boxes.forEach((b, id) => {
      let a = before.boxes.get(id);
      if (!a) {
        const n = nodeById(this.model, id);
        for (let p = n && n.parent; p && !a; p = p.parent) a = before.boxes.get(p.id);
        if (a) a = { x: a.x, y: a.y, width: b.width, height: b.height };
      }
      if (!a) return;
      from.set(id, a);
      if (Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5 || Math.abs(a.width - b.width) > 0.5) moves = true;
    });
    if (!moves) return;
    const win = this.root.ownerDocument.defaultView;
    const start = win.performance && typeof win.performance.now === 'function' ? win.performance.now() : Date.now();
    const glide = { scene: glideBoxes(from, to, 0), frame: 0 };
    this.gliding = glide;
    const step = (now) => {
      if (this.gliding !== glide) return;
      const t = Math.min(1, ((typeof now === 'number' ? now : Date.now()) - start) / MAP_GLIDE_MS);
      if (t >= 1 || this.scene !== to) {
        this.gliding = null;
        this.draw();
        return;
      }
      glide.scene = glideBoxes(from, to, easeOut(t));
      this.draw();
      glide.frame = win.requestAnimationFrame(step);
    };
    glide.frame = win.requestAnimationFrame(step);
  }

  /** A glide under way stopped; what's drawn is the map as it is. */
  stopGlide() {
    const g = this.gliding;
    if (!g) return;
    this.gliding = null;
    const win = this.root && this.root.ownerDocument.defaultView;
    if (win && g.frame) win.cancelAnimationFrame(g.frame);
  }
}
