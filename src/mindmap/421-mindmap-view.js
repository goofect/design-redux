/* ------------------------------------------------------------------ */
/* Mind map: the view                                                  */
/*                                                                    */
/* One view for a flagged note and for a .mindmap file alike: the file */
/* read through its format into the tree, laid out, and drawn. Pan by  */
/* dragging the background or scrolling, zoom with a pinch or Ctrl and  */
/* the wheel; click a node to select it, its knob to fold it; arrow     */
/* keys walk the tree, Space folds. A file that can't be read is shown */
/* as it is, with what went wrong, and never written over.             */
/* ------------------------------------------------------------------ */

import { setIcon, TextFileView } from 'obsidian';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { nodeById, walk } from '../tree/400-tree-model.js';
import { bindSource, parseOutline, writeOutline } from '../tree/401-tree-outline.js';
import { parseMindmapJson, writeMindmapJson } from '../tree/402-tree-json.js';
import { estimateSize, fitCamera, layoutScene, nodeLabel, screenToPlane } from './423-mindmap-scene.js';
import { MindMapRenderer } from './424-mindmap-render.js';

export const MINDMAP_VIEW = 'design-redux-mindmap';
export const MINDMAP_EXTENSION = 'mindmap';

/* How each kind of file is read and written: the view knows nothing else about files. */
export const FILE_FORMATS = {
  md: {
    id: 'md',
    parse: (text, file) => parseOutline(text, { title: file ? file.basename : '' }).model,
    write: (model, previous, file) => {
      const text = writeOutline(model, previous, { title: file ? file.basename : '' });
      bindSource(model, text, { title: file ? file.basename : '' });
      return text;
    },
  },
  mindmap: {
    id: 'mindmap',
    parse: (text) => parseMindmapJson(text),
    write: (model) => writeMindmapJson(model),
  },
};

export class MindMapView extends TextFileView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
    this.plugin = feature ? feature.plugin : null;
    this.model = null;
    this.scene = null;
    this.camera = null;
    this.selected = null;
    this.failure = null;
    this.frame = 0;
    this.data = '';
  }

  getViewType() {
    return MINDMAP_VIEW;
  }

  getDisplayText() {
    return this.file ? this.file.basename : 'Mind map';
  }

  getIcon() {
    return 'network';
  }

  canAcceptExtension(ext) {
    return ext === MINDMAP_EXTENSION || ext === 'md';
  }

  get format() {
    return FILE_FORMATS[this.file && this.file.extension === MINDMAP_EXTENSION ? 'mindmap' : 'md'];
  }

  get mode() {
    return (this.model && this.model.mode) || (this.plugin && this.plugin.settings.mindmapLayout) || 'right';
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('dr-mindmap-view');
    this.root = this.contentEl.createDiv({ cls: 'dr-mindmap' });
    this.root.setAttribute('tabindex', '0');
    this.root.setAttribute('role', 'tree');
    this.renderer = new MindMapRenderer(this.root);
    this.bar = this.root.createDiv({ cls: 'dr-mindmap-bar' });
    this.tool('Fit the map', 'maximize', () => this.fit());
    this.tool('Fold every branch', 'chevrons-down-up', () => this.foldAll(true));
    this.tool('Unfold everything', 'chevrons-up-down', () => this.foldAll(false));
    this.tool('Outline', 'list-tree', () => this.toggleOutline());
    if (typeof this.addAction === 'function') this.addAction('file-text', 'Open as text', () => this.feature && this.feature.openAsText(this.leaf));
    this.listen();
  }

  tool(label, icon, run) {
    const b = this.bar.createDiv({ cls: 'clickable-icon dr-mindmap-tool' });
    asButton(b, label);
    b.dataset.icon = icon;
    if (typeof b.setAttribute === 'function') b.setAttribute('data-tooltip-position', 'bottom');
    setIcon(b, icon);
    onActivate(b, run);
    return b;
  }

  getViewData() {
    return this.data;
  }

  /** The file's text, read into the map. A new file centres the view; the same one keeps where it was. */
  setViewData(data, clear) {
    this.data = data;
    try {
      const model = this.format.parse(data, this.file);
      if (this.format.id === 'md' && !model.source) bindSource(model, data);
      const keep = this.selected;
      this.model = model;
      this.failure = null;
      this.selected = keep && nodeById(model, keep) ? keep : null;
    } catch (err) {
      this.model = null;
      this.failure = err;
    }
    this.relayout();
    if (clear || !this.camera) this.fit(true);
    this.draw();
  }

  clear() {
    this.data = '';
    this.model = null;
    this.camera = null;
    this.selected = null;
  }

  /** The map written back to its file — only the lines that changed, for a note. */
  commit() {
    if (!this.model || this.failure) return;
    this.data = this.format.write(this.model, this.data, this.file);
    if (typeof this.requestSave === 'function') this.requestSave();
  }

  relayout() {
    if (!this.model) {
      this.scene = null;
      return;
    }
    this.scene = layoutScene(this.model, (n) => estimateSize(nodeLabel(n)), this.mode);
  }

  fit(quiet) {
    if (!this.scene) return;
    const { width, height } = this.renderer.size();
    this.camera = fitCamera(this.scene.bounds, width, height);
    if (!quiet) this.draw();
  }

  /** Drawn on the next frame, once, however many asks came. */
  draw() {
    if (!this.renderer) return;
    this.showFailure();
    if (!this.model || !this.scene || !this.camera) return;
    this.renderer.draw({ model: this.model, scene: this.scene, camera: this.camera, selected: this.selected, mode: this.mode });
    if (this.outlineEl) this.drawOutline();
  }

  queueDraw() {
    if (this.frame) return;
    const win = this.contentEl.ownerDocument.defaultView || window;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  showFailure() {
    let banner = this.root.querySelector(':scope > .dr-mindmap-failure');
    if (!this.failure) {
      if (banner) banner.remove();
      this.root.removeClass('has-failure');
      return;
    }
    this.root.addClass('has-failure');
    if (!banner) banner = this.root.createDiv({ cls: 'dr-mindmap-failure' });
    banner.empty();
    banner.createDiv({ cls: 'dr-mindmap-failure-head', text: 'This map can’t be read, so it’s shown as text and won’t be written to.' });
    const copy = banner.createEl('button', { text: 'Copy what went wrong' });
    copy.addEventListener('click', () => {
      const clip = typeof navigator !== 'undefined' && navigator.clipboard;
      if (clip) clip.writeText(String(this.failure && this.failure.message));
    });
    banner.createEl('pre', { cls: 'dr-mindmap-failure-text', text: this.data });
  }

  /* -- folding ------------------------------------------------------ */

  toggleFold(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n || !n.children.length) return;
    if (n.attrs.fold) delete n.attrs.fold;
    else n.attrs.fold = 1;
    // The selection, if it was folded away, goes to the fold.
    if (this.selected && this.selected !== id) {
      const sel = nodeById(this.model, this.selected);
      for (let p = sel && sel.parent; p; p = p.parent) if (p === n && n.attrs.fold) this.selected = id;
    }
    this.changed();
  }

  /** Every branch folded below the root's own children — or everything unfolded. */
  foldAll(on) {
    if (!this.model) return;
    let any = false;
    walk(this.model, (n, depth) => {
      if (!n.children.length) return;
      if (on && depth >= 1 && !n.attrs.fold) {
        n.attrs.fold = 1;
        any = true;
      }
      if (!on && n.attrs.fold) {
        delete n.attrs.fold;
        any = true;
      }
    });
    if (on && this.selected) {
      const sel = nodeById(this.model, this.selected);
      const path = [];
      for (let p = sel; p; p = p.parent) path.unshift(p);
      const fold = path.find((p) => p.attrs.fold && p !== sel);
      if (fold) this.selected = fold.id;
    }
    if (any) this.changed();
  }

  /** The map changed: laid out, drawn, written. */
  changed() {
    this.relayout();
    this.draw();
    this.commit();
  }

  /* -- input -------------------------------------------------------- */

  listen() {
    const root = this.root;
    let drag = null;
    this.registerDomEvent(root, 'pointerdown', (evt) => {
      if (evt.button !== 0 || (evt.target.closest && evt.target.closest('.dr-mindmap-bar, .dr-mindmap-outline, .dr-mindmap-failure'))) return;
      if (typeof root.focus === 'function') root.focus();
      const knob = evt.target.closest && evt.target.closest('.dr-mindmap-knob');
      const id = this.renderer.nodeAt(evt.target);
      if (knob && id) {
        this.toggleFold(id);
        return;
      }
      if (id) {
        this.select(id);
        return;
      }
      if (!this.camera) return;
      drag = { x: evt.clientX, y: evt.clientY, cx: this.camera.x, cy: this.camera.y, moved: false };
      if (typeof root.setPointerCapture === 'function' && evt.pointerId !== undefined) {
        try {
          root.setPointerCapture(evt.pointerId);
        } catch (err) {
          /* not captured: the moves still come while over it */
        }
      }
    });
    this.registerDomEvent(root, 'pointermove', (evt) => {
      if (!drag) return;
      const dx = evt.clientX - drag.x;
      const dy = evt.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      this.camera = { x: drag.cx - dx / this.camera.zoom, y: drag.cy - dy / this.camera.zoom, zoom: this.camera.zoom };
      this.queueDraw();
    });
    const end = () => {
      if (drag && !drag.moved) this.select(null);
      drag = null;
    };
    this.registerDomEvent(root, 'pointerup', end);
    this.registerDomEvent(root, 'pointercancel', () => (drag = null));
    this.registerDomEvent(root, 'wheel', (evt) => this.wheel(evt), { passive: false });
    this.registerDomEvent(root, 'keydown', (evt) => this.key(evt));
  }

  /** Scrolling pans; with Ctrl or a pinch, it zooms about the pointer. */
  wheel(evt) {
    if (!this.camera) return;
    evt.preventDefault();
    if (evt.ctrlKey || evt.metaKey) {
      const box = typeof this.root.getBoundingClientRect === 'function' ? this.root.getBoundingClientRect() : { left: 0, top: 0 };
      const { width, height } = this.renderer.size();
      const sx = evt.clientX - box.left;
      const sy = evt.clientY - box.top;
      const before = screenToPlane(this.camera, width, height, sx, sy);
      const zoom = Math.max(0.1, Math.min(3, this.camera.zoom * Math.exp(-evt.deltaY * 0.01)));
      // The point under the pointer stays under it.
      this.camera = { zoom, x: before.x - (sx - width / 2) / zoom, y: before.y - (sy - height / 2) / zoom };
    } else {
      this.camera = { x: this.camera.x + evt.deltaX / this.camera.zoom, y: this.camera.y + evt.deltaY / this.camera.zoom, zoom: this.camera.zoom };
    }
    this.queueDraw();
  }

  select(id) {
    if (this.selected === id) return;
    this.selected = id;
    this.draw();
  }

  /** Arrow keys walk the tree as it's laid out; Space folds; Escape lets go. */
  key(evt) {
    if (!this.model || evt.metaKey || evt.ctrlKey || evt.altKey) return;
    const sel = this.selected ? nodeById(this.model, this.selected) : null;
    const go = (n) => {
      if (!n) return;
      evt.preventDefault();
      this.select(n.id);
      this.reveal(n.id);
    };
    if (!sel) {
      if (evt.key.startsWith('Arrow')) go(this.model.root);
      return;
    }
    const siblings = sel.parent ? sel.parent.children : [sel];
    const at = siblings.indexOf(sel);
    const open = sel.children.length && !sel.attrs.fold ? sel.children[0] : null;
    const vertical = this.mode === 'bottom' || this.mode === 'top' || this.mode === 'outline';
    const leftward = this.mode === 'left';
    const keys = vertical
      ? { ArrowDown: open, ArrowUp: sel.parent, ArrowRight: siblings[at + 1], ArrowLeft: siblings[at - 1] }
      : { [leftward ? 'ArrowLeft' : 'ArrowRight']: open, [leftward ? 'ArrowRight' : 'ArrowLeft']: sel.parent, ArrowDown: siblings[at + 1], ArrowUp: siblings[at - 1] };
    if (evt.key in keys) return go(keys[evt.key]);
    if (evt.key === ' ') {
      evt.preventDefault();
      this.toggleFold(sel.id);
    } else if (evt.key === 'Escape') this.select(null);
  }

  /** The view moved, as little as it takes, to show a node. */
  reveal(id) {
    const b = this.scene && this.scene.boxes.get(id);
    if (!b || !this.camera) return;
    const { width, height } = this.renderer.size();
    const pad = 40 / this.camera.zoom;
    const halfW = width / 2 / this.camera.zoom;
    const halfH = height / 2 / this.camera.zoom;
    let { x, y } = this.camera;
    if (b.x - pad < x - halfW) x = b.x - pad + halfW;
    if (b.x + b.width + pad > x + halfW) x = b.x + b.width + pad - halfW;
    if (b.y - pad < y - halfH) y = b.y - pad + halfH;
    if (b.y + b.height + pad > y + halfH) y = b.y + b.height + pad - halfH;
    this.camera = { x, y, zoom: this.camera.zoom };
    this.draw();
  }

  /* -- the outline beside it ---------------------------------------- */

  toggleOutline() {
    if (this.outlineEl) {
      this.outlineEl.remove();
      this.outlineEl = null;
      return;
    }
    this.outlineEl = this.root.createDiv({ cls: 'dr-mindmap-outline' });
    this.drawOutline();
  }

  /** The same tree, as a list: a row goes to its node. */
  drawOutline() {
    const box = this.outlineEl;
    box.empty();
    const row = (n, depth, parent) => {
      const el = parent.createDiv({ cls: 'dr-mindmap-outline-row', text: nodeLabel(n) });
      el.style.setProperty('--dr-depth', String(depth));
      el.toggleClass('is-selected', this.selected === n.id);
      asButton(el);
      onActivate(el, () => {
        this.select(n.id);
        this.reveal(n.id);
      });
      if (!n.attrs.fold) n.children.forEach((c) => row(c, depth + 1, parent));
    };
    if (this.model && this.model.root) row(this.model.root, 0, box);
  }

  async onClose() {
    if (this.frame) (this.contentEl.ownerDocument.defaultView || window).cancelAnimationFrame(this.frame);
  }
}
