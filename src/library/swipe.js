/* ------------------------------------------------------------------ */
/* The library: a note swiped to the next one                          */
/*                                                                     */
/* Two fingers sideways on a trackpad over a note step to the note     */
/* after it in its folder (fingers to the left) or before it (to the   */
/* right), in that pane. One step a swipe, its glide included.         */
/* Anything under the hand that scrolls sideways itself keeps the      */
/* swipe. Nothing to look at.                                          */
/* ------------------------------------------------------------------ */

import { neighbours } from './order.js';

// How far sideways, in pixels, makes a swipe, and how long a pause ends one.
const PULL = 80;
const GAP = 250;

/** Whether something between the element and the page scrolls sideways (a wide table, a code block). */
function scrollsSideways(el) {
  const win = el.ownerDocument.defaultView;
  for (; el && el !== el.ownerDocument.body; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    const overflow = win.getComputedStyle(el).overflowX;
    if (overflow === 'auto' || overflow === 'scroll') return true;
  }
  return false;
}

export class NoteSwipe {
  constructor(feature) {
    this.feature = feature;
    this.gesture = null;
  }

  get app() {
    return this.feature.app;
  }

  /** Listens on every window while the library is on. */
  start() {
    this.feature.eachWindow((doc) => this.feature.listenDom(doc, 'wheel', (e) => this.onWheel(e), { passive: true }));
  }

  onWheel(e) {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    let g = this.gesture;
    if (!g || e.timeStamp - g.last > GAP) g = this.gesture = { x: 0, y: 0, leaf: this.leafUnder(e.target) };
    g.last = e.timeStamp;
    g.x += e.deltaX * unit;
    g.y += e.deltaY * unit;
    if (!g.leaf || Math.abs(g.x) < PULL || Math.abs(g.x) < Math.abs(g.y) * 2) return;
    const leaf = g.leaf;
    g.leaf = null;
    // Fingers moving left scroll the page right: deltaX above zero, the next note.
    this.step(leaf, g.x > 0 ? 1 : -1);
  }

  /** The pane in the main area whose note is under the hand, unless what's there scrolls sideways itself. */
  leafUnder(target) {
    const el = target && target.nodeType === 1 ? target : target && target.parentElement;
    if (!el || scrollsSideways(el)) return null;
    let found = null;
    const ws = this.app.workspace;
    if (typeof ws.iterateRootLeaves !== 'function') return null;
    ws.iterateRootLeaves((leaf) => {
      const view = leaf.view;
      if (!found && view && view.file && view.getViewType() === 'markdown' && view.containerEl.contains(el)) found = leaf;
    });
    return found;
  }

  step(leaf, by) {
    const [previous, next] = neighbours(this.feature.plugin, leaf.view.file);
    const to = by < 0 ? previous : next;
    if (to) leaf.openFile(to);
  }
}
