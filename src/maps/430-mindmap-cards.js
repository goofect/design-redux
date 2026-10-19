/* ------------------------------------------------------------------ */
/* Mind map: nodes as cards                                            */
/*                                                                    */
/* A node's first line is its title, the lines after it its details,  */
/* each as markdown — its links are links — where Obsidian can render */
/* it. A node is as big as its text: measured once off screen, kept by */
/* its text, and estimated from its length until then; when a measure  */
/* isn't what was guessed, the map's laid out again.                  */
/* ------------------------------------------------------------------ */

import { Component, Keymap, MarkdownRenderer } from 'obsidian';
import { plainMarkdownLine } from '../core/047-helpers-text.js';
import { mixInto } from '../core/080-feature.js';
import { nodeById } from '../tree/400-tree-model.js';
import { dueState, taskOf, taskText } from '../tree/415-tree-tasks.js';
import { MindMapView } from './421-mindmap-view.js';
import { estimateSize, nodeParts } from './423-mindmap-scene.js';

/** How a node's text is set: the root larger, and — with depth shown — the root's own children heavier. */
export function nodeTier(model, n, depth) {
  if (n === model.root) return 'R';
  return depth && n.parent === model.root ? '1' : '';
}

/** What a node's size is kept under: its text, and how it's set. */
export function sizeKey(model, n, depth) {
  return `${nodeTier(model, n, depth)}|${n.text || (n.virtual ? 'Untitled' : '')}${chipsKey(n)}`;
}

/** What chips under a node's text it has — a status, a due date — which make it taller. */
function chipsKey(n) {
  const a = n.attrs;
  return a && (a.status || a.due) ? `|${a.status || ''}|${dueState(n) ? a.due : ''}` : '';
}

/* How long a measure waits for a node's images to come in. */
const IMAGE_WAIT = 1500;

/** The images in some elements loaded, or given up on. */
function imagesIn(els) {
  const imgs = [];
  els.forEach((el) => el.querySelectorAll('img').forEach((img) => !img.complete && img.getAttribute('src') && imgs.push(img)));
  if (!imgs.length) return null;
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise((done) => {
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          window.setTimeout(done, IMAGE_WAIT);
        })
    )
  );
}

class MindMapCards {
  depthShown() {
    return !this.plugin || this.plugin.settings.mindmapDepth !== false;
  }

  /** What a linked note shows on a node, as its size is kept by. */
  notesKey(n) {
    return typeof this.noteKey === 'function' ? this.noteKey(n) : '';
  }

  /** A node's size: measured, or estimated until it is. */
  sizeOf(n) {
    // Kept on the node while its text and how it's set stay: thousands of nodes, no key made for each.
    const tier = this.model ? nodeTier(this.model, n, this.depthShown()) : '';
    const text = n.text || (n.virtual ? 'Untitled' : '');
    const notes = this.notesKey(n);
    const rich = this.richKey(n);
    const chips = chipsKey(n) + notes + rich;
    const memo = this.sizeMemo && this.sizeMemo.get(n);
    if (memo && memo.text === text && memo.tier === tier && memo.chips === chips) return memo.size;
    const size = (this.sizes && this.model && this.sizes.get(`${tier}|${text}${chips}`)) || estimateSize(text, (chipsKey(n) ? 1 : 0) + (notes ? 2 : 0), rich && n.attrs);
    if (!this.sizeMemo) this.sizeMemo = new WeakMap();
    this.sizeMemo.set(n, { text, tier, chips, size });
    return size;
  }

  /** What a node's shape, icon and image add to the key its size is kept under. */
  richKey(n) {
    return typeof this.richKeyOf === 'function' ? this.richKeyOf(n) : '';
  }

  /** A part of a node's text into an element: markdown where Obsidian renders it, plain text where not. Its promise, if it takes a moment. */
  renderText(el, n, part) {
    const whole = nodeParts(n)[part];
    // A task's box is drawn, not written.
    const text = part === 'title' && typeof this.tasksOn === 'function' && this.tasksOn() && taskOf(n) ? taskText(whole) : whole;
    const old = el.drText;
    if (old) {
      old.unload();
      if (this.textParts) this.textParts.delete(old);
    }
    el.drText = null;
    el.empty();
    const render = MarkdownRenderer && typeof MarkdownRenderer.render === 'function' && this.app ? MarkdownRenderer.render : null;
    if (!render || typeof Component !== 'function' || typeof Component.prototype.load !== 'function') {
      el.setText(part === 'title' ? plainMarkdownLine(text) || text : text.split('\n').map((l) => plainMarkdownLine(l)).join('\n'));
      return null;
    }
    const comp = new Component();
    comp.load();
    el.drText = comp;
    if (!this.textParts) this.textParts = new Set();
    this.textParts.add(comp);
    try {
      return Promise.resolve(render.call(MarkdownRenderer, this.app, text, el, this.file ? this.file.path : '', comp)).catch(() => el.setText(text));
    } catch (err) {
      el.setText(text);
      return null;
    }
  }

  /** A node's title and details into its element; promises for what's still rendering. */
  fillCard(el, n) {
    const waits = [];
    if (typeof this.richCard === 'function') this.richCard(el, n);
    if (typeof this.taskBox === 'function') this.taskBox(el, n);
    const title = el.createDiv({ cls: 'dr-mindmap-text' });
    const t = this.renderText(title, n, 'title');
    if (t) waits.push(t);
    if (nodeParts(n).details) {
      const details = el.createDiv({ cls: 'dr-mindmap-details' });
      const d = this.renderText(details, n, 'details');
      if (d) waits.push(d);
    }
    if (typeof this.taskChips === 'function') this.taskChips(el, n);
    if (typeof this.noteChips === 'function') this.noteChips(el, n);
    return waits;
  }

  /**
   * The drawn nodes whose size isn't known, measured off screen, all at
   * once; laid out again if any isn't as it was guessed. Nothing to do
   * where nothing has a size — the view hidden, or no layout at all.
   */
  measureShown() {
    // Zoomed far out, nodes are blocks without text: measured once they're near enough to read.
    if (!this.renderer || !this.model || !this.root.offsetWidth || this.renderer.far) return;
    if (!this.sizes) this.sizes = new Map();
    if (!this.measuring) this.measuring = new Set();
    const todo = [];
    this.renderer.nodeEls.forEach((el, id) => {
      const n = nodeById(this.model, id);
      if (!n) return;
      const key = sizeKey(this.model, n, this.depthShown()) + this.notesKey(n) + this.richKey(n);
      if (!this.sizes.has(key) && !this.measuring.has(key)) todo.push({ n, key });
    });
    if (!todo.length) return;
    if (!this.measureBox) this.measureBox = this.root.createDiv({ cls: 'dr-mindmap-measure' });
    const waits = [];
    todo.forEach((m) => {
      this.measuring.add(m.key);
      m.el = this.measureBox.createDiv({ cls: 'dr-mindmap-node' });
      const tier = nodeTier(this.model, m.n, this.depthShown());
      m.el.toggleClass('is-root', tier === 'R');
      m.el.dataset.depth = tier === 'R' ? '0' : tier === '1' ? '1' : '2';
      waits.push(...this.fillCard(m.el, m.n));
    });
    const model = this.model;
    Promise.all(waits)
      .then(() => imagesIn(todo.map((m) => m.el)))
      .then(() => {
      let changed = false;
      todo.forEach(({ n, key, el }) => {
        this.measuring.delete(key);
        const size = { width: Math.ceil(el.offsetWidth), height: Math.ceil(el.offsetHeight) };
        this.dropText(el);
        el.remove();
        if (!size.width || !size.height) return;
        const was = this.sizeOf(n);
        this.sizes.set(key, size);
        this.sizeMemo = null;
        if (Math.abs(was.width - size.width) > 1 || Math.abs(was.height - size.height) > 1) changed = true;
      });
      if (changed && this.model === model) {
        this.relayout(false);
        this.draw();
      }
      });
  }

  /** The rendered parts of an element let go. */
  dropText(el) {
    el.querySelectorAll('.dr-mindmap-text, .dr-mindmap-details').forEach((part) => {
      if (part.drText) {
        part.drText.unload();
        if (this.textParts) this.textParts.delete(part.drText);
        part.drText = null;
      }
    });
  }

  /** A link in a node, clicked: opened, as a link in a note is — in a new tab with Ctrl or Cmd. */
  linkClick(evt) {
    const a = evt.target && typeof evt.target.closest === 'function' ? evt.target.closest('a.internal-link') : null;
    if (!a || !this.app) return false;
    evt.preventDefault();
    evt.stopPropagation();
    const href = a.getAttribute('data-href') || a.getAttribute('href');
    const newTab = Keymap && typeof Keymap.isModEvent === 'function' ? Keymap.isModEvent(evt) : evt.ctrlKey || evt.metaKey;
    if (href) this.app.workspace.openLinkText(href, this.file ? this.file.path : '', newTab);
    return true;
  }

  /** Every rendered part let go, as the view closes. */
  dropAllText() {
    if (this.textParts) this.textParts.forEach((c) => c.unload());
    this.textParts = new Set();
  }
}

mixInto(MindMapView, MindMapCards);
