/* ------------------------------------------------------------------ */
/* The sidebars swiped out and back in                                 */
/*                                                                     */
/* Two fingers sideways on a trackpad, or one on a touch screen, pull  */
/* the left and right sidebars out and push them back in, so their     */
/* buttons go. The half of the window the pointer is in says which:    */
/* away from that sidebar's edge brings it out, toward it puts it      */
/* away. Anywhere, over anything: a sideways swipe is always the       */
/* sidebars', never a scroll or a pan. The phone and tablet app swipe  */
/* their drawers already; there only the buttons go.                   */
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
        desc: 'Two fingers sideways on the trackpad pull out and push in the sidebar on the pointer’s side, so their buttons go. Sideways scrolling gives way to it.',
      },
    ];
  }

  register() {
    if (Platform.isMobile) return;
    const doc = document;
    // Not passive, and first: a sideways swipe is kept from whatever is under it.
    this.plugin.registerDomEvent(doc, 'wheel', (e) => this.onWheel(e), { passive: false, capture: true });
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

  /**
   * One gesture's sideways scroll, added up until it's far enough, then
   * acted on once. Its sideways part goes no further, so nothing under it
   * scrolls or pans that way; pinching (Ctrl) and Shift with a mouse
   * wheel are left alone.
   */
  onWheel(e) {
    if (!this.enabled || e.ctrlKey || e.shiftKey) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    let g = this.wheel;
    if (!g || e.timeStamp - g.last > WHEEL_GAP) g = this.wheel = { x: 0, y: 0, done: false, at: e.clientX };
    g.last = e.timeStamp;
    g.x += dx;
    g.y += dy;
    if (Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (g.done || Math.abs(g.x) < WHEEL_PULL || Math.abs(g.x) < Math.abs(g.y) * 2) return;
    g.done = true;
    // Fingers moving right scroll the page left: deltaX below zero.
    this.swipe(g.x < 0, g.at, e.view || window);
  }

  onTouchStart(e) {
    if (!this.enabled || e.touches.length !== 1) {
      this.touch = null;
      return;
    }
    const t = e.touches[0];
    this.touch = { x: t.clientX, y: t.clientY, at: e.timeStamp };
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
    this.swipe(dx > 0, g.x, e.view || window);
  }

  /**
   * A swipe, toward the right or the left, begun at x across the window:
   * the sidebar on that half comes out going away from its edge, and goes
   * back in going toward it.
   */
  swipe(toRight, x, win) {
    const ws = this.app.workspace;
    const onLeft = x < (win.innerWidth || 0) / 2;
    const split = onLeft ? ws.leftSplit : ws.rightSplit;
    if (!split) return;
    const inward = onLeft ? !toRight : toRight;
    if (inward && !split.collapsed) this.pushIn(split);
    else if (!inward && split.collapsed) this.pullOut(split);
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
