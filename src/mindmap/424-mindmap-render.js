/* ------------------------------------------------------------------ */
/* Mind map: drawing                                                   */
/*                                                                    */
/* Nodes as elements, edges as one SVG layer, all on one plane that a  */
/* pan or zoom moves with a single transform — nothing is laid out     */
/* while it moves. Only what meets the view (and a margin) is drawn;   */
/* elements of nodes gone off screen are kept to be used again.        */
/* ------------------------------------------------------------------ */

import { NODE_ROLES, nodeRole, roleLabel } from '../tree/407-tree-relations.js';
import { colourKey, DRAW_MARGIN, edgePath, meets, nodeLabel, pinOf, viewBox, visibleChildren } from './423-mindmap-scene.js';

const SVG = 'http://www.w3.org/2000/svg';

/* Below this zoom, nodes are drawn as plain blocks. */
export const FAR_ZOOM = 0.4;

/* How many elements of nodes off screen are kept for those nodes to come back to. */
export const PARKED_MOST = 3000;

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
    this.parked = new Map();
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
    this.host.toggleClass('is-far', camera.zoom < FAR_ZOOM);
  }

  /** Everything on screen drawn: nodes, edges, which is selected. */
  draw(state) {
    const { model, scene, camera, selected, mode } = state;
    // Zoomed far out, a node is a plain block: its text would be too small to read, and costs the most to draw.
    this.far = camera.zoom < FAR_ZOOM;
    this.tints = state.tints || new Map();
    this.fade = state.fade || null;
    this.roles = state.roles !== false;
    this.marks = state.marks || null;
    this.present = state.present || null;
    this.focus = state.focus || null;
    this.place(camera);
    const { width, height } = this.size();
    const view = viewBox(camera, width, height, DRAW_MARGIN / camera.zoom);
    const seen = new Set();
    const nodes = [];
    const visit = (n) => {
      const b = scene.boxes.get(n.id);
      if (b && meets(b, view)) nodes.push([n, b]);
      if (b) visibleChildren(n).forEach(visit);
    };
    // From the branch shown alone, if one is.
    const top = state.top || model.root;
    if (top) visit(top);
    (model.free || []).forEach((n) => {
      const b = scene.boxes.get(n.id);
      if (b && meets(b, view)) nodes.push([n, b]);
    });
    nodes.forEach(([n, b]) => {
      seen.add(n.id);
      this.drawNode(n, b, selected === n.id);
    });
    // Off screen now: their elements parked by node, for when they come back — the oldest given over to others past a limit.
    this.nodeEls.forEach((el, id) => {
      if (seen.has(id)) return;
      el.remove();
      this.nodeEls.delete(id);
      this.parked.set(id, el);
    });
    while (this.parked.size > PARKED_MOST) {
      const [id, el] = this.parked.entries().next().value;
      this.parked.delete(id);
      this.spare.push(el);
    }
    this.drawn = seen.size;
    this.drawGroups(model, scene);
    this.drawEdges(model, scene, view, mode);
  }

  drawNode(n, b, isSelected) {
    let el = this.nodeEls.get(n.id);
    if (!el) {
      el = this.parked.get(n.id);
      if (el) this.parked.delete(n.id);
      else {
        el = this.spare.pop() || this.host.ownerDocument.createElement('div');
        el.className = 'dr-mindmap-node';
        el.drState = '';
      }
      this.layer.appendChild(el);
      this.nodeEls.set(n.id, el);
    }
    const label = nodeLabel(n);
    const key = `${this.far ? 'far|' : ''}${n.text}|${n.virtual ? 'v' : ''}|${n.children.length}|${n.attrs && n.attrs.fold ? 1 : 0}|${n.attrs && n.attrs.color !== undefined ? n.attrs.color : ''}|${this.hooks.cardKey && !this.far ? this.hooks.cardKey(n) : ''}`;
    if (el.dataset.key !== key || el.dataset.id !== n.id) {
      el.dataset.id = n.id;
      el.dataset.key = key;
      if (this.hooks.drop) this.hooks.drop(el);
      el.empty();
      if (this.far) el.createDiv({ cls: 'dr-mindmap-text' });
      else if (this.hooks.card) this.hooks.card(el, n);
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
    // What's shown of it besides its text, all at once: nothing touched when nothing changed.
    const pr = this.present;
    const role = this.roles ? nodeRole(n) : null;
    const look = {
      root: !n.parent && !b.free,
      virtual: !!n.virtual,
      free: !!b.free,
      folded: !!(n.attrs && n.attrs.fold),
      selected: isSelected,
      color: n.attrs && n.attrs.color !== undefined && n.attrs.color !== '' ? String(n.attrs.color) : '',
      depth: String(Math.min(b.depth, 4)),
      tint: this.tints.get(n.id) || '',
      faded: !!this.fade && (colourKey(n) || 'none') !== this.fade,
      pinned: !!pinOf(n),
      unfocused: !!this.focus && !this.focus.has(n.id),
      now: !!pr && pr.now === n.id,
      dim: !!pr && !pr.lit.has(n.id),
      hidden: !!pr && pr.reveal && !pr.seen.has(n.id),
      mark: (this.marks && this.marks.get(n.id)) || '',
      role: role || '',
      roleLabel: role ? roleLabel(n) : '',
      level: String(b.depth + 1),
      pos: n.parent ? String(n.parent.children.indexOf(n) + 1) : '',
      size: n.parent ? String(n.parent.children.length) : '',
    };
    const state = `${Object.values(look).join('|')}|${b.x}|${b.y}|${b.width}|${b.height}`;
    if (el.drState === state) return;
    el.drState = state;
    el.toggleClass('is-root', look.root);
    el.toggleClass('is-virtual', look.virtual);
    el.toggleClass('is-free', look.free);
    el.toggleClass('is-folded', look.folded);
    el.toggleClass('is-selected', look.selected);
    el.setAttribute('aria-selected', String(look.selected));
    const data = (key, value) => {
      if (value) el.dataset[key] = value;
      else delete el.dataset[key];
    };
    data('color', look.color);
    el.dataset.depth = look.depth;
    data('tint', look.tint);
    el.toggleClass('is-faded', look.faded);
    el.toggleClass('is-pinned', look.pinned);
    el.toggleClass('is-unfocused', look.unfocused);
    el.toggleClass('dr-present-now', look.now);
    el.toggleClass('dr-present-dim', look.dim);
    el.toggleClass('dr-present-hidden', look.hidden);
    data('mark', look.mark);
    data('role', look.role);
    data('roleLabel', look.roleLabel);
    // Where it sits in the tree, for a screen reader walking it.
    el.setAttribute('aria-level', look.level);
    if (look.pos) {
      el.setAttribute('aria-posinset', look.pos);
      el.setAttribute('aria-setsize', look.size);
    } else {
      el.removeAttribute('aria-posinset');
      el.removeAttribute('aria-setsize');
    }
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
      const from = scene.boxes.get(n.id);
      visibleChildren(n).forEach((c) => {
        const own = colourKey(c) || colour;
        const to = scene.boxes.get(c.id);
        if (from && to && (meets(from, view) || meets(to, view))) {
          const role = this.roles ? nodeRole(c) : null;
          want.push({ d: edgePath(from, to, to.way || mode), cls: 'dr-mindmap-edge', colour: own || this.tints.get(c.id) || null, label: role ? NODE_ROLES[role].edge : '', from, to });
        }
        walk(c, own);
      });
    };
    if (model.root) walk(model.root, colourKey(model.root));
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
        label: r.label || '',
        from,
        to,
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
        if (p.drLook !== 'hidden') p.style.display = 'none';
        p.drLook = 'hidden';
        return;
      }
      // An edge as it was last time: nothing to write.
      const look = `${w.d}|${w.cls}|${w.colour || ''}|${w.line || ''}|${w.head || ''}`;
      if (p.drLook === look) return;
      p.drLook = look;
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
    this.drawLabels(want.filter((w) => w.label));
  }

  /** A frame round each branch whose first node names a group, with the group's name: behind the nodes. */
  drawGroups(model, scene) {
    const want = [];
    const branchBoxes = (n, out) => {
      const b = scene.boxes.get(n.id);
      if (b) out.push(b);
      visibleChildren(n).forEach((c) => branchBoxes(c, out));
      return out;
    };
    const go = (n) => {
      const name = n.attrs && n.attrs.group;
      if (name && scene.boxes.has(n.id)) {
        const boxes = branchBoxes(n, []);
        const minX = Math.min(...boxes.map((b) => b.x));
        const minY = Math.min(...boxes.map((b) => b.y));
        const maxX = Math.max(...boxes.map((b) => b.x + b.width));
        const maxY = Math.max(...boxes.map((b) => b.y + b.height));
        want.push({ name: String(name), minX, minY, maxX, maxY });
      }
      visibleChildren(n).forEach(go);
    };
    if (model.root) go(model.root);
    (model.free || []).forEach(go);
    if (!want.length && !this.groupLayer) return;
    if (!this.groupLayer) {
      this.groupLayer = this.host.ownerDocument.createElement('div');
      this.groupLayer.className = 'dr-mindmap-groups';
      this.plane.insertBefore(this.groupLayer, this.layer);
      this.frames = [];
    }
    while (this.frames.length < want.length) this.frames.push(this.groupLayer.createDiv({ cls: 'dr-mindmap-group' }));
    const pad = 16;
    this.frames.forEach((el, k) => {
      const g = want[k];
      if (!g) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.style.left = `${g.minX - pad}px`;
      el.style.top = `${g.minY - pad - 14}px`;
      el.style.width = `${g.maxX - g.minX + pad * 2}px`;
      el.style.height = `${g.maxY - g.minY + pad * 2 + 14}px`;
      if (el.dataset.name !== g.name) {
        el.dataset.name = g.name;
        el.setText(g.name);
      }
    });
  }

  /** What an edge or relation says, written halfway along it. */
  drawLabels(labelled) {
    if (!this.labels) this.labels = [];
    const doc = this.host.ownerDocument;
    while (this.labels.length < labelled.length) {
      const t = doc.createElementNS(SVG, 'text');
      t.setAttribute('class', 'dr-mindmap-label');
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('dominant-baseline', 'central');
      this.svg.appendChild(t);
      this.labels.push(t);
    }
    this.labels.forEach((t, k) => {
      const w = labelled[k];
      if (!w) {
        t.style.display = 'none';
        return;
      }
      const x = (w.from.x + w.from.width / 2 + w.to.x + w.to.width / 2) / 2;
      const y = (w.from.y + w.from.height / 2 + w.to.y + w.to.height / 2) / 2;
      t.setAttribute('x', String(Math.round(x)));
      t.setAttribute('y', String(Math.round(y)));
      t.classList.toggle('is-relation', w.cls === 'dr-mindmap-relation');
      if (t.textContent !== w.label) t.textContent = w.label;
      t.style.display = '';
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
