/* ------------------------------------------------------------------ */
/* Mind map: drawing                                                   */
/*                                                                    */
/* Nodes as elements, edges as one SVG layer, all on one plane that a  */
/* pan or zoom moves with a single transform — nothing is laid out     */
/* while it moves. Only what meets the view (and a margin) is drawn;   */
/* elements of nodes gone off screen are kept to be used again.        */
/* ------------------------------------------------------------------ */

import { DRAW_MARGIN, edgePath, meets, nodeLabel, viewBox } from './423-mindmap-scene.js';

const SVG = 'http://www.w3.org/2000/svg';

/* What a relation's attributes may say, as the canvas's arrow styles do. */
export const RELATION_LINES = ['solid', 'dashed', 'dotted'];
export const RELATION_SHAPES = ['curve', 'straight', 'elbow'];
export const RELATION_HEADS = ['arrow', 'open', 'dot', 'diamond'];

export class MindMapRenderer {
  constructor(host, hooks) {
    this.host = host;
    this.hooks = hooks || {};
    const doc = host.ownerDocument;
    this.plane = host.createDiv({ cls: 'dr-mindmap-plane' });
    this.svg = doc.createElementNS(SVG, 'svg');
    this.svg.setAttribute('class', 'dr-mindmap-edges');
    this.plane.appendChild(this.svg);
    this.layer = this.plane.createDiv({ cls: 'dr-mindmap-nodes' });
    this.nodeEls = new Map();
    this.spare = [];
    this.paths = [];
    this.drawn = 0;
  }

  /** The view's size on screen; a stand-in where there's no layout to ask. */
  size() {
    const w = this.host.clientWidth || 1000;
    const h = this.host.clientHeight || 700;
    return { width: w, height: h };
  }

  /** The plane moved and scaled to the camera. */
  place(camera) {
    const { width, height } = this.size();
    const tx = width / 2 - camera.x * camera.zoom;
    const ty = height / 2 - camera.y * camera.zoom;
    this.plane.style.transform = `translate(${tx}px, ${ty}px) scale(${camera.zoom})`;
    this.host.toggleClass('is-far', camera.zoom < 0.4);
  }

  /** Everything on screen drawn: nodes, edges, which is selected. */
  draw(state) {
    const { model, scene, camera, selected, mode } = state;
    this.place(camera);
    const { width, height } = this.size();
    const view = viewBox(camera, width, height, DRAW_MARGIN / camera.zoom);
    const seen = new Set();
    const nodes = [];
    const visit = (n) => {
      const b = scene.boxes.get(n.id);
      if (b && meets(b, view)) nodes.push([n, b]);
      if (b && !(n.attrs && n.attrs.fold)) n.children.forEach(visit);
    };
    if (model.root) visit(model.root);
    (model.free || []).forEach((n) => {
      const b = scene.boxes.get(n.id);
      if (b && meets(b, view)) nodes.push([n, b]);
    });
    nodes.forEach(([n, b]) => {
      seen.add(n.id);
      this.drawNode(n, b, selected === n.id);
    });
    // Off screen now: their elements kept for others.
    this.nodeEls.forEach((el, id) => {
      if (seen.has(id)) return;
      el.remove();
      this.nodeEls.delete(id);
      this.spare.push(el);
    });
    this.drawn = seen.size;
    this.drawEdges(model, scene, view, mode);
  }

  drawNode(n, b, isSelected) {
    let el = this.nodeEls.get(n.id);
    if (!el) {
      el = this.spare.pop() || this.host.ownerDocument.createElement('div');
      el.className = 'dr-mindmap-node';
      this.layer.appendChild(el);
      this.nodeEls.set(n.id, el);
    }
    const label = nodeLabel(n);
    const key = `${n.text}|${n.virtual ? 'v' : ''}|${n.children.length}|${n.attrs && n.attrs.fold ? 1 : 0}|${n.attrs && n.attrs.color !== undefined ? n.attrs.color : ''}`;
    if (el.dataset.key !== key || el.dataset.id !== n.id) {
      el.dataset.id = n.id;
      el.dataset.key = key;
      if (this.hooks.drop) this.hooks.drop(el);
      el.empty();
      if (this.hooks.card) this.hooks.card(el, n);
      else el.createDiv({ cls: 'dr-mindmap-text', text: label });
      if (n.children.length) {
        const knob = el.createDiv({ cls: 'dr-mindmap-knob' });
        knob.setAttribute('role', 'button');
        knob.setAttribute('aria-label', n.attrs && n.attrs.fold ? `Unfold (${n.children.length})` : 'Fold');
        if (n.attrs && n.attrs.fold) knob.setText(String(countBelow(n)));
        if (this.hooks.knob) this.hooks.knob(knob, n.id);
      }
      el.setAttribute('role', 'treeitem');
      el.setAttribute('aria-label', label);
      if (n.children.length) el.setAttribute('aria-expanded', String(!(n.attrs && n.attrs.fold)));
      else el.removeAttribute('aria-expanded');
    }
    el.toggleClass('is-root', !n.parent && !b.free);
    el.toggleClass('is-virtual', !!n.virtual);
    el.toggleClass('is-free', !!b.free);
    el.toggleClass('is-folded', !!(n.attrs && n.attrs.fold));
    el.toggleClass('is-selected', isSelected);
    el.setAttribute('aria-selected', String(isSelected));
    if (n.attrs && n.attrs.color !== undefined && n.attrs.color !== '') el.dataset.color = String(n.attrs.color);
    else delete el.dataset.color;
    el.dataset.depth = String(Math.min(b.depth, 4));
    el.style.left = `${b.x}px`;
    el.style.top = `${b.y}px`;
    el.style.width = `${b.width}px`;
    el.style.minHeight = `${b.height}px`;
  }

  /**
   * An edge for each shown node from its parent, in its branch's colour,
   * drawn where either end is on screen; and the relations, each as its
   * attributes say: line, shape, head and colour.
   */
  drawEdges(model, scene, view, mode) {
    const want = [];
    const walk = (n, colour) => {
      if (n.attrs && n.attrs.fold) return;
      const from = scene.boxes.get(n.id);
      n.children.forEach((c) => {
        const own = c.attrs && c.attrs.color !== undefined && c.attrs.color !== '' ? String(c.attrs.color) : colour;
        const to = scene.boxes.get(c.id);
        if (from && to && (meets(from, view) || meets(to, view))) want.push({ d: edgePath(from, to, to.way || mode), cls: 'dr-mindmap-edge', colour: own });
        walk(c, own);
      });
    };
    if (model.root) walk(model.root, model.root.attrs && model.root.attrs.color !== undefined && model.root.attrs.color !== '' ? String(model.root.attrs.color) : null);
    (model.relations || []).forEach((r) => {
      const from = scene.boxes.get(r.from);
      const to = scene.boxes.get(r.to);
      const a = r.attrs || {};
      if (!from || !to || !(meets(from, view) || meets(to, view))) return;
      want.push({
        d: edgePath(from, to, 'right', RELATION_SHAPES.includes(a.shape) ? a.shape : 'curve'),
        cls: 'dr-mindmap-relation',
        colour: a.color !== undefined && a.color !== '' ? String(a.color) : null,
        line: RELATION_LINES.includes(a.style) ? a.style : 'dashed',
        head: a.head === 'none' ? null : RELATION_HEADS.includes(a.head) ? a.head : 'arrow',
      });
    });
    if (want.some((w) => w.head)) this.markers();
    while (this.paths.length < want.length) {
      const p = this.host.ownerDocument.createElementNS(SVG, 'path');
      this.svg.appendChild(p);
      this.paths.push(p);
    }
    this.paths.forEach((p, k) => {
      const w = want[k];
      if (!w) {
        p.style.display = 'none';
        return;
      }
      p.setAttribute('d', w.d);
      p.setAttribute('class', w.cls);
      p.style.display = '';
      const preset = w.colour && /^[1-6]$/.test(w.colour);
      if (preset) p.setAttribute('data-color', w.colour);
      else p.removeAttribute('data-color');
      p.style.stroke = w.colour && !preset ? w.colour : '';
      if (w.line) p.setAttribute('data-line', w.line);
      else p.removeAttribute('data-line');
      if (w.head) p.setAttribute('marker-end', `url(#${this.markerId}-${w.head})`);
      else p.removeAttribute('marker-end');
    });
  }

  /** The heads a relation can end in, made once: they take the line's colour. */
  markers() {
    if (this.markerId) return;
    this.markerId = `dr-mm-${Math.random().toString(36).slice(2, 8)}`;
    const doc = this.host.ownerDocument;
    const defs = doc.createElementNS(SVG, 'defs');
    const shapes = {
      arrow: ['path', { d: 'M 0 0 L 10 5 L 0 10 z' }],
      open: ['path', { d: 'M 0 0 L 10 5 L 0 10', fill: 'none', 'stroke-width': '1.5' }],
      dot: ['circle', { cx: '5', cy: '5', r: '4' }],
      diamond: ['path', { d: 'M 0 5 L 5 0 L 10 5 L 5 10 z' }],
    };
    RELATION_HEADS.forEach((head) => {
      const m = doc.createElementNS(SVG, 'marker');
      m.setAttribute('id', `${this.markerId}-${head}`);
      m.setAttribute('viewBox', '0 0 10 10');
      m.setAttribute('refX', head === 'dot' || head === 'diamond' ? '5' : '9');
      m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '7');
      m.setAttribute('markerHeight', '7');
      m.setAttribute('orient', 'auto-start-reverse');
      m.setAttribute('class', 'dr-mindmap-head');
      const [tag, attrs] = shapes[head];
      const el = doc.createElementNS(SVG, tag);
      Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
      m.appendChild(el);
      defs.appendChild(m);
    });
    this.svg.insertBefore(defs, this.svg.firstChild);
  }

  /** The node an element is part of, by id, or null. */
  nodeAt(target) {
    const el = target && typeof target.closest === 'function' ? target.closest('.dr-mindmap-node') : null;
    return el ? el.dataset.id : null;
  }
}

/** How many nodes hang below one, however deep. */
export function countBelow(n) {
  return n.children.reduce((s, c) => s + 1 + countBelow(c), 0);
}
