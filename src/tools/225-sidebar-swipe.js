/* ------------------------------------------------------------------ */
/* The sidebars swiped out and back in                                 */
/*                                                                     */
/* Two fingers sideways on a trackpad, or one on a touch screen, pull  */
/* the left and right sidebars out and push them back in, so their     */
/* buttons go. What's under the hand says which: over a sidebar, it    */
/* goes back in; over the page, a swipe right brings the left one out  */
/* (or puts the right one away), a swipe left the right one. Anything  */
/* that scrolls or pans sideways itself keeps its swipe. The phone and */
/* tablet app swipe their drawers already; there only the buttons go.  */
/* ------------------------------------------------------------------ */

import { Platform } from 'obsidian';
import { INSPECTOR_VIEW } from '../core/020-constants.js';
import { openInspector } from '../core/076-selection.js';
import { Feature } from '../core/080-feature.js';

// How far sideways, in pixels, makes a swipe, and how long a pause ends one.
const WHEEL_PULL = 60;
const WHEEL_GAP = 250;
const TOUCH_PULL = 60;
const TOUCH_TIME = 700;

// What pans or drags sideways itself: a canvas, the graph, menus and dialogs.
const OWN_SWIPE = '.canvas-wrapper, canvas, .modal-container, .menu, .suggestion-container, .prompt';

export class SidebarSwipe extends Feature {
  constructor(plugin) {
    super(plugin);
    this.wheel = null;
    this.touch = null;
  }

  settingsSchema() {
    return [
      {
        key: 'swipeSidebars',
        name: 'Swipe the sidebars',
        desc: 'Two fingers sideways on the trackpad pull the left and right sidebars out and push them back in, so their buttons go.',
      },
    ];
  }

  register() {
    if (Platform.isMobile) return;
    const doc = document;
    this.plugin.registerDomEvent(doc, 'wheel', (e) => this.onWheel(e), { passive: true });
    this.plugin.registerDomEvent(doc, 'touchstart', (e) => this.onTouchStart(e), { passive: true });
    this.plugin.registerDomEvent(doc, 'touchend', (e) => this.onTouchEnd(e), { passive: true });
  }

  enable() {
    document.body.addClass('dr-swipe-sidebars');
  }

  disable() {
    document.body.removeClass('dr-swipe-sidebars');
    this.wheel = null;
    this.touch = null;
  }

  /** One gesture's sideways scroll, added up until it's far enough, then acted on once. */
  onWheel(e) {
    if (!this.enabled || e.ctrlKey) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    let g = this.wheel;
    if (!g || e.timeStamp - g.last > WHEEL_GAP) {
      g = this.wheel = { x: 0, y: 0, done: !this.swipeable(e.target), target: e.target };
    }
    g.last = e.timeStamp;
    g.x += e.deltaX * unit;
    g.y += e.deltaY * unit;
    if (g.done || Math.abs(g.x) < WHEEL_PULL || Math.abs(g.x) < Math.abs(g.y) * 2) return;
    g.done = true;
    // Fingers moving right scroll the page left: deltaX below zero.
    this.swipe(g.x < 0, g.target);
  }

  onTouchStart(e) {
    if (!this.enabled || e.touches.length !== 1) {
      this.touch = null;
      return;
    }
    const t = e.touches[0];
    this.touch = { x: t.clientX, y: t.clientY, at: e.timeStamp, target: e.target };
  }

  onTouchEnd(e) {
    const g = this.touch;
    this.touch = null;
    if (!g || !this.enabled || e.timeStamp - g.at > TOUCH_TIME) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (Math.abs(dx) < TOUCH_PULL || Math.abs(dx) < Math.abs(dy) * 2) return;
    if (!this.swipeable(g.target)) return;
    this.swipe(dx > 0, g.target);
  }

  /** Not when what's under the hand scrolls or pans sideways itself. */
  swipeable(target) {
    let el = target && target.nodeType === 1 ? target : target && target.parentElement;
    if (!el || (el.closest && el.closest(OWN_SWIPE))) return false;
    const win = el.ownerDocument.defaultView;
    for (; el && el !== el.ownerDocument.body; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const overflow = win.getComputedStyle(el).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') return false;
    }
    return true;
  }

  /** A swipe, toward the right or the left, begun over target. */
  swipe(toRight, target) {
    const ws = this.app.workspace;
    const left = ws.leftSplit;
    const right = ws.rightSplit;
    const over = (split) => !!(split && split.containerEl && split.containerEl.contains(target));
    const out = (split) => !!(split && !split.collapsed);
    const near = toRight ? right : left;
    const far = toRight ? left : right;
    // Over a sidebar that's out: it goes back in toward its own edge, or stays.
    if (over(near) && out(near)) return this.pushIn(near);
    if (over(far)) return;
    if (far && far.collapsed) return this.pullOut(far);
    if (out(near)) this.pushIn(near);
  }

  pushIn(split) {
    split.collapse();
    this.changed(split);
  }

  /** The right one brings the inspector with it when there's none in it yet. */
  async pullOut(split) {
    const ws = this.app.workspace;
    if (split === ws.rightSplit && this.settings.inspector !== false && !ws.getLeavesOfType(INSPECTOR_VIEW).length) {
      await openInspector(this.app);
    } else {
      split.expand();
    }
    this.changed(split);
  }

  /** The browse view clicks pick while the inspector shows: told when that changes. */
  changed(split) {
    if (split === this.app.workspace.rightSplit && typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
  }
}

SidebarSwipe.settingKey = 'swipeSidebars';
