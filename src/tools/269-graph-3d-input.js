/* ------------------------------------------------------------------ */
/* The graph in three dimensions: the view, what the hand does        */
/*                                                                    */
/* The first part of the 3D graph's view (275 over 274 over this):    */
/* the pointer, the wheel and the keys. Drag the background to turn   */
/* the cloud, Shift- or middle-drag (two fingers on a phone) to move  */
/* it, scroll or pinch to come closer to what's under the pointer.    */
/* Drag a note to move it; the others follow, and it's let go when    */
/* the pointer is. A click picks a note; a click on the picked note   */
/* opens it (Ctrl or Cmd: in a new tab). Right-click, or a long press */
/* on a phone, gives a note's menu — Obsidian's own, for a file, with */
/* what the graph can do with it. Pointing at a note with Ctrl or Cmd */
/* held shows a preview, as links do.                                 */
/* ------------------------------------------------------------------ */

import { ItemView, Menu, TFile } from 'obsidian';
import { LONG_PRESS_MS, LONG_PRESS_SLOP, showMenuAt } from '../core/036-menus.js';
import { GRAPH_3D_DEFAULTS } from './263-graph-space.js';
import { Camera, hitNode } from './265-graph-camera.js';

export const GRAPH_3D_VIEW = 'design-redux-graph-3d';

export class Graph3DInput extends ItemView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
    this.options = Object.assign({}, GRAPH_3D_DEFAULTS);
    this.camera = new Camera();
    this.graph = { nodes: [], links: new Int32Array(0), root: -1 };
    this.at = new Map();
    this.spots = null;
    this.sizes = new Float32Array(0);
    this.hover = -1;
    this.picked = -1;
    this.held = -1;
    this.root = '';
    this.focusKey = null;
    this.pointers = new Map();
    this.press = null;
    this.pinch = null;
    this.pointer = null;
    this.touched = false;
    this.easing = null;
    this.hoverPopover = null;
    this.menuShownAt = 0;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.raf = 0;
  }

  listen(el) {
    this.registerDomEvent(el, 'pointerdown', (e) => this.down(e));
    this.registerDomEvent(el, 'pointermove', (e) => this.move(e));
    this.registerDomEvent(el, 'pointerup', (e) => this.up(e, false));
    this.registerDomEvent(el, 'pointercancel', (e) => this.up(e, true));
    this.registerDomEvent(el, 'pointerleave', () => this.left());
    this.registerDomEvent(el, 'wheel', (e) => this.wheel(e), { passive: false });
    this.registerDomEvent(el, 'keydown', (e) => this.key(e));
    this.registerDomEvent(el, 'contextmenu', (e) => this.contextMenu(e));
    this.registerDomEvent(el, 'dblclick', (e) => this.doubleClick(e));
  }

  /** The note under a point of the view, or -1. */
  pointAt(x, y, slack) {
    return this.spots ? hitNode(this.spots, this.sizes, x, y, slack) : -1;
  }

  down(e) {
    if (this.overlay.focus) this.overlay.focus({ preventScroll: true });
    try {
      if (this.overlay.setPointerCapture) this.overlay.setPointerCapture(e.pointerId);
    } catch (err) {
      // A pointer that's gone already: nothing to hold on to.
    }
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    this.pinch = null;
    this.showTip(-1);
    if (this.pointers.size > 1) {
      if (this.press) this.press.moved = true;
      this.letGo();
      this.cancelLongPress();
      return;
    }
    const touch = e.pointerType === 'touch';
    const at = this.pointAt(e.offsetX, e.offsetY, touch ? 10 : 4);
    this.press = {
      x: e.offsetX,
      y: e.offsetY,
      at,
      moved: false,
      done: false,
      touch,
      button: e.button,
      node: e.button === 0 && !e.shiftKey ? at : -1,
      pan: e.shiftKey || e.button === 1,
      mod: e.ctrlKey || e.metaKey,
    };
    if (touch) {
      const press = this.press;
      const where = { clientX: e.clientX, clientY: e.clientY, drTouch: true };
      this.longPress = this.host().setTimeout(() => {
        this.longPress = 0;
        if (this.press !== press || press.moved) return;
        press.done = true;
        this.menuAt(press.at, where);
      }, LONG_PRESS_MS);
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType !== 'touch') {
        this.pointer = { x: e.offsetX, y: e.offsetY, evt: e };
        this.draw();
      }
      return;
    }
    const dx = e.offsetX - p.x;
    const dy = e.offsetY - p.y;
    p.x = e.offsetX;
    p.y = e.offsetY;
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const now = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      if (this.pinch) {
        this.camera.pan(now.x - this.pinch.x, now.y - this.pinch.y, this.h);
        this.camera.zoomAt(this.pinch.spread / now.spread, now.x, now.y, this.w, this.h);
      }
      this.pinch = now;
    } else {
      const press = this.press;
      if (!press || press.done) return;
      if (!press.moved && Math.hypot(e.offsetX - press.x, e.offsetY - press.y) > (press.touch ? LONG_PRESS_SLOP : 4)) {
        press.moved = true;
        this.cancelLongPress();
        if (press.node >= 0) this.hold(press.node);
      }
      if (!press.moved) return;
      if (this.held >= 0) this.dragHeld(dx, dy);
      else if (press.pan) this.camera.pan(dx, dy, this.h);
      else this.camera.turn(dx, dy);
    }
    this.touched = true;
    this.easing = null;
    this.draw();
  }

  up(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.pinch = null;
    if (this.pointers.size) return;
    this.cancelLongPress();
    this.letGo();
    const press = this.press;
    this.press = null;
    if (cancelled || !press || press.moved || press.done || press.button === 2) return;
    const i = press.at;
    if (i < 0) this.pick(-1);
    else if (press.mod) this.openNode(i, 'tab');
    else if (i === this.picked) this.openNode(i, false);
    else this.pick(i, true);
  }

  left() {
    this.pointer = null;
    this.showTip(-1);
    if (this.hover >= 0 && !this.pointers.size) {
      this.hover = -1;
      this.overlay.toggleClass('is-pointing', false);
      this.lightChanged();
    }
  }

  cancelLongPress() {
    if (this.longPress) this.host().clearTimeout(this.longPress);
    this.longPress = 0;
  }

  /** What's under the pointer, looked for once a frame rather than on every move. */
  updateHover() {
    const p = this.pointer;
    if (!p || this.pointers.size) return;
    const i = this.pointAt(p.x, p.y, 4);
    if (i !== this.hover) {
      this.hover = i;
      this.overlay.toggleClass('is-pointing', i >= 0);
      this.lightChanged();
      if (i >= 0) this.preview(i, p.evt);
    }
    this.showTip(i, p.x, p.y);
  }

  /** A note's preview, as for a link: Obsidian shows it when Ctrl or Cmd is held (or as its settings say). */
  preview(i, evt) {
    const node = this.graph.nodes[i];
    if (!evt || !node || node.kind !== 'note') return;
    this.app.workspace.trigger('hover-link', { event: evt, source: GRAPH_3D_VIEW, hoverParent: this, targetEl: this.overlay, linktext: node.path, sourcePath: '' });
  }

  /* -- holding a note ---------------------------------------------- */

  hold(i) {
    this.held = i;
    this.overlay.toggleClass('is-holding', true);
  }

  /** The held note moved with the pointer, across the screen at its depth. */
  dragHeld(dx, dy) {
    const i = this.held;
    const pos = this.runner.positions;
    const s = (this.spots && this.spots.scale[i]) || this.camera.focal(this.h) / this.camera.distance;
    const { right, up } = this.camera.frame();
    const mx = dx / s;
    const my = -dy / s;
    this.runner.fix(i, pos[i * 3] + right.x * mx + up.x * my, pos[i * 3 + 1] + right.y * mx + up.y * my, pos[i * 3 + 2] + right.z * mx + up.z * my);
  }

  letGo() {
    if (this.held < 0) return;
    this.runner.release(this.held);
    this.held = -1;
    this.overlay.toggleClass('is-holding', false);
  }

  /* -- wheel and keys ---------------------------------------------- */

  wheel(e) {
    e.preventDefault();
    const lines = e.deltaMode === 1 ? 16 : 1;
    // A trackpad's pinch comes as a wheel with Ctrl held: small steps, so it's faster.
    this.camera.zoomAt(Math.exp(e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.0015)), e.offsetX, e.offsetY, this.w, this.h);
    this.touched = true;
    this.easing = null;
    this.draw();
  }

  key(e) {
    const turns = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] };
    if (turns[e.key]) this.camera.turn(turns[e.key][0], turns[e.key][1]);
    else if (e.key === '+' || e.key === '=') this.camera.zoom(0.85);
    else if (e.key === '-') this.camera.zoom(1 / 0.85);
    else if (e.key === 'Enter' && this.picked >= 0) this.openNode(this.picked, e.ctrlKey || e.metaKey ? 'tab' : false);
    else if (e.key === 'Escape' && (this.picked >= 0 || this.focusKey)) this.clearFocus();
    else if (e.key === 'f' && !e.ctrlKey && !e.metaKey) this.fit();
    else return;
    e.preventDefault();
    this.touched = true;
    if (e.key !== 'f') this.easing = null;
    this.draw();
  }

  doubleClick(e) {
    if (this.pointAt(e.offsetX, e.offsetY, 4) < 0) this.fit();
  }

  /* -- menus and opening ------------------------------------------- */

  contextMenu(e) {
    e.preventDefault();
    // Android follows a long press with contextmenu: the menu's open already.
    if (Date.now() - this.menuShownAt < 800) return;
    this.menuAt(this.pointAt(e.offsetX, e.offsetY, 4), e);
  }

  menuAt(i, evt) {
    const menu = new Menu();
    const item = (section, title, icon, run) => menu.addItem((it) => it.setSection(section).setTitle(title).setIcon(icon).onClick(run));
    const node = i >= 0 ? this.graph.nodes[i] : null;
    if (node) {
      const file = node.path ? this.app.vault.getAbstractFileByPath(node.path) : null;
      if (node.kind === 'missing') item('open', 'Create this note', 'file-plus', () => this.openNode(i, false));
      else if (file instanceof TFile) {
        item('open', 'Open', 'file', () => this.openNode(i, false));
        item('open', 'Open in new tab', 'file-plus', () => this.openNode(i, 'tab'));
        item('open', 'Open to the right', 'separator-vertical', () => this.openNode(i, 'split'));
      }
      item('view', 'Centre on it', 'locate-fixed', () => this.centreOn(i));
      item('view', 'Show what’s around it', 'git-fork', () => this.showAround(node.id));
      if (file instanceof TFile) this.app.workspace.trigger('file-menu', menu, file, GRAPH_3D_VIEW, this.leaf);
    } else {
      item('view', 'Fit every note in view', 'scan', () => this.fit());
      if (this.options.local) item('view', 'Show every note', 'globe', () => this.setOption('local', false));
      item('view', 'Graph settings', 'sliders-horizontal', () => this.togglePanel(true));
    }
    this.menuShownAt = Date.now();
    showMenuAt(menu, evt);
  }

  /** A note opened (how: false here, 'tab', 'split'); a note not written yet, made; a tag, shown with what's round it. */
  openNode(i, how) {
    const node = this.graph.nodes[i];
    if (!node) return;
    if (node.kind === 'tag') {
      this.showAround(node.id);
      return;
    }
    if (node.kind === 'missing') {
      this.app.workspace.openLinkText(node.name, '', how);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(node.path);
    if (file instanceof TFile) this.app.workspace.getLeaf(how).openFile(file);
  }
}
