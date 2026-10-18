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
    const key = `${label}|${n.children.length}|${n.attrs && n.attrs.fold ? 1 : 0}|${n.attrs && n.attrs.color !== undefined ? n.attrs.color : ''}`;
    if (el.dataset.key !== key || el.dataset.id !== n.id) {
      el.dataset.id = n.id;
      el.dataset.key = key;
      el.empty();
      el.createDiv({ cls: 'dr-mindmap-text', text: label });
      if (n.children.length) {
        const knob = el.createDiv({ cls: 'dr-mindmap-knob' });
        knob.setAttribute('role', 'button');
        knob.setAttribute('aria-label', n.attrs && n.attrs.fold ? `Unfold (${n.children.length})` : 'Fold');
        if (n.attrs && n.attrs.fold) knob.setText(String(countBelow(n)));
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

  /** An edge for each shown node from its parent, drawn where either end is on screen; and the relations, dashed. */
  drawEdges(model, scene, view, mode) {
    const want = [];
    const walk = (n) => {
      if (n.attrs && n.attrs.fold) return;
      const from = scene.boxes.get(n.id);
      n.children.forEach((c) => {
        const to = scene.boxes.get(c.id);
        if (from && to && (meets(from, view) || meets(to, view))) want.push({ d: edgePath(from, to, mode), cls: 'dr-mindmap-edge' });
        walk(c);
      });
    };
    if (model.root) walk(model.root);
    (model.relations || []).forEach((r) => {
      const from = scene.boxes.get(r.from);
      const to = scene.boxes.get(r.to);
      if (from && to && (meets(from, view) || meets(to, view))) want.push({ d: edgePath(from, to, 'right'), cls: 'dr-mindmap-relation' });
    });
    while (this.paths.length < want.length) {
      const p = this.host.ownerDocument.createElementNS(SVG, 'path');
      this.svg.appendChild(p);
      this.paths.push(p);
    }
    this.paths.forEach((p, k) => {
      if (k < want.length) {
        p.setAttribute('d', want[k].d);
        p.setAttribute('class', want[k].cls);
        p.style.display = '';
      } else p.style.display = 'none';
    });
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
