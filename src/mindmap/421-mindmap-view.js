/* ------------------------------------------------------------------ */
/* Mind map: the view                                                  */
/*                                                                    */
/* One view for a flagged note and for a .mindmap file alike: the file */
/* read through its format into the tree, laid out, and drawn. Every    */
/* change is a patch, kept for Undo and written a moment later. Input   */
/* (425), the card editor (426) and saving (427) are parts put on it.   */
/* A file that can't be read is shown as it is, with what went wrong,  */
/* and never written over.                                            */
/* ------------------------------------------------------------------ */

import { setIcon, TextFileView } from 'obsidian';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { nodeById, walk } from '../tree/400-tree-model.js';
import { bindSource, parseOutline, writeOutline } from '../tree/401-tree-outline.js';
import { parseMindmapJson, writeMindmapJson } from '../tree/402-tree-json.js';
import { applyPatch, setAttr, undoPatch } from '../tree/404-tree-ops.js';
import { UndoStack } from '../tree/405-tree-history.js';
import { boundsOfBoxes, estimateSize, fitCamera, layoutScene, nodeLabel, nodeTints } from './423-mindmap-scene.js';
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
    this.text = '';
    this.undo = new UndoStack();
    // Changes since the file was last written: put again onto the file if it changes outside.
    this.pending = [];
    this.saveTimer = 0;
    this.lastWritten = null;
    this.editing = null;
    this.gliding = null;
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
    this.renderer = new MindMapRenderer(this.root, {
      knob: (el, id) => typeof this.peekOn === 'function' && this.peekOn(el, id),
      card: typeof this.fillCard === 'function' ? (el, n) => this.fillCard(el, n) : null,
      drop: typeof this.dropText === 'function' ? (el) => this.dropText(el) : null,
    });
    this.bar = this.root.createDiv({ cls: 'dr-mindmap-bar' });
    this.tool('Fit the map', 'maximize', () => this.fit());
    this.tool('Lay out…', 'layout-dashboard', () => this.feature && typeof this.feature.chooseLayout === 'function' && this.feature.chooseLayout(this));
    this.tool('Fold every branch', 'chevrons-down-up', () => this.foldAll(true));
    this.tool('Unfold everything', 'chevrons-up-down', () => this.foldAll(false));
    this.tool('Outline', 'list-tree', () => this.toggleOutline());
    if (typeof this.addAction === 'function') this.addAction('file-text', 'Open as text', () => this.feature && this.feature.openAsText(this.leaf));
    this.listen();
  }

  tool(label, icon, run) {
    const b = this.bar.createDiv({ cls: 'clickable-icon dr-mindmap-tool' });
    asButton(b, label);
    if (typeof b.setAttribute === 'function') b.setAttribute('data-tooltip-position', 'bottom');
    setIcon(b, icon);
    onActivate(b, run);
    return b;
  }

  getViewData() {
    return this.text;
  }

  clear() {
    this.text = '';
    this.model = null;
    this.camera = null;
    this.selected = null;
    this.pending = [];
    this.undo.clear();
  }

  /** Laid out again; nodes that moved glide to their places (428), unless `glide` is false. */
  relayout(glide = true) {
    const before = this.gliding ? this.gliding.scene : this.scene;
    if (!this.model) {
      this.scene = null;
      return;
    }
    const sizeOf = typeof this.sizeOf === 'function' ? (n) => this.sizeOf(n) : (n) => estimateSize(n.text || nodeLabel(n));
    this.scene = layoutScene(this.model, sizeOf, this.mode);
    if (typeof this.glideFrom === 'function') this.glideFrom(glide ? before : null);
  }

  fit(quiet) {
    if (!this.scene) return;
    if (!quiet && typeof this.rememberLook === 'function') this.rememberLook();
    const { width, height } = this.renderer.size();
    this.camera = fitCamera(this.scene.bounds, width, height);
    if (!quiet) this.draw();
  }

  draw() {
    if (!this.renderer) return;
    this.showFailure();
    if (!this.model || !this.scene || !this.camera) return;
    const scene = this.gliding ? this.gliding.scene : this.scene;
    const settings = this.plugin ? this.plugin.settings : {};
    this.root.toggleClass('is-depth', settings.mindmapDepth !== false);
    const tints = nodeTints(this.model, settings.mindmapColourBy);
    this.renderer.draw({ model: this.model, scene, camera: this.camera, selected: this.selected, mode: this.mode, tints, fade: this.fade || null, roles: settings.mindmapArguments !== false, marks: this.marks || null, present: typeof this.presentMarks === 'function' ? this.presentMarks() : null });
    if (typeof this.drawLegend === 'function') this.drawLegend();
    if (typeof this.drawMinimap === 'function') this.drawMinimap(this.scene);
    if (this.outlineEl) this.drawOutline();
    if (this.editing && typeof this.placeEditor === 'function') this.placeEditor();
    if (!this.gliding && typeof this.measureShown === 'function') this.measureShown();
  }

  /** The tab resized or shown again: what's on screen now drawn. */
  onResize() {
    this.draw();
  }

  /** The view brought to a node's branch, whole. */
  fitBranch(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n || !this.scene) return;
    if (typeof this.rememberLook === 'function') this.rememberLook();
    const boxes = [];
    const go = (x) => {
      const b = this.scene.boxes.get(x.id);
      if (b) boxes.push(b);
      if (!x.attrs.fold) x.children.forEach(go);
    };
    go(n);
    const { width, height } = this.renderer.size();
    this.camera = fitCamera(boundsOfBoxes(boxes), width, height);
    this.select(id);
    this.draw();
  }

  /** Drawn on the next frame, once, however many asks came. */
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
    banner.createEl('pre', { cls: 'dr-mindmap-failure-text', text: this.text });
  }

  /**
   * A change made to the map: kept for Undo, laid out, drawn and written
   * a moment later. `typing` names the node being typed in, so its
   * keystrokes join one step.
   */
  apply(patch, typing) {
    if (!patch || !this.model) return null;
    // A presentation changes nothing: what was made of the patch is put back.
    if (this.presenting) {
      undoPatch(this.model, patch);
      return null;
    }
    this.undo.push(patch, typing, this.selected ? [this.selected] : []);
    this.pending.push(patch);
    if (typeof this.afterChange === 'function') this.afterChange(patch);
    if (patch.selection && patch.selection.length && !typing) this.selected = patch.selection[0];
    this.relayout(!typing);
    this.draw();
    if (typeof this.scheduleSave === 'function') this.scheduleSave();
    return patch;
  }

  /**
   * A change the map makes to follow something outside it — its notes,
   * say: written like any other, but no step of Undo, as a change made
   * outside isn't.
   */
  applySync(patch) {
    if (!patch || !this.model) return null;
    this.pending.push(patch);
    this.undo.keepWhere((id) => !!nodeById(this.model, id));
    this.relayout();
    this.draw();
    if (typeof this.scheduleSave === 'function') this.scheduleSave();
    return patch;
  }

  undoStep(redo) {
    if (!this.model || this.presenting) return;
    // What the step will do, kept as a change not yet written, like any other.
    const step = redo ? this.undo.undone[this.undo.undone.length - 1] : this.undo.done[this.undo.done.length - 1];
    const ops = step ? (redo ? step.step.patch.ops : step.patch.inverse) : [];
    const ids = redo ? this.undo.redo(this.model) : this.undo.undo(this.model);
    if (ids === null) return;
    this.pending.push({ ops, inverse: [], selection: ids });
    this.selected = ids.find((id) => nodeById(this.model, id)) || (this.selected && nodeById(this.model, this.selected) ? this.selected : null);
    this.relayout();
    this.draw();
    if (typeof this.scheduleSave === 'function') this.scheduleSave();
  }

  /* -- folding ------------------------------------------------------ */

  toggleFold(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n || !n.children.length) return;
    const folding = !n.attrs.fold;
    // The selection, if it's folded away, goes to the fold.
    if (folding && this.selected && this.selected !== id) {
      const sel = nodeById(this.model, this.selected);
      for (let p = sel && sel.parent; p; p = p.parent) if (p === n) this.selected = id;
    }
    this.apply(setAttr(this.model, id, 'fold', folding ? 1 : undefined));
  }

  /** Every branch folded below the root's own children — or everything unfolded. One step of Undo. */
  foldAll(on) {
    if (!this.model) return;
    const ops = [];
    walk(this.model, (n, depth) => {
      if (!n.children.length) return;
      if (on && depth >= 1 && !n.attrs.fold) ops.push({ type: 'attr', id: n.id, key: 'fold', value: 1 });
      if (!on && n.attrs.fold) ops.push({ type: 'attr', id: n.id, key: 'fold', value: undefined });
    });
    if (!ops.length) return;
    if (on && this.selected) {
      const sel = nodeById(this.model, this.selected);
      const path = [];
      for (let p = sel; p; p = p.parent) path.unshift(p);
      const fold = path.find((p, k) => k >= 1 && p.children.length && p !== sel);
      if (fold) this.selected = fold.id;
    }
    this.apply(applyPatch(this.model, ops, this.selected ? [this.selected] : []));
  }

  select(id) {
    if (this.selected === id) return;
    this.selected = id;
    this.draw();
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
        if (typeof this.rememberLook === 'function') this.rememberLook();
        this.select(n.id);
        this.reveal(n.id);
      });
      if (!n.attrs.fold) n.children.forEach((c) => row(c, depth + 1, parent));
    };
    if (this.model && this.model.root) row(this.model.root, 0, box);
  }

  async onClose() {
    if (this.frame) (this.contentEl.ownerDocument.defaultView || window).cancelAnimationFrame(this.frame);
    if (typeof this.closeEditor === 'function') this.closeEditor(true);
    if (typeof this.stopGlide === 'function') this.stopGlide();
    if (typeof this.closePeek === 'function') this.closePeek();
    if (typeof this.closeFindings === 'function') this.closeFindings();
    if (typeof this.endPresent === 'function') this.endPresent();
    if (this.albumTimer) clearTimeout(this.albumTimer);
    if (typeof this.dropAllText === 'function') this.dropAllText();
    if (typeof this.flushSave === 'function') this.flushSave();
  }
}
