/* ------------------------------------------------------------------ */
/* Arrow styles                                                        */
/*                                                                     */
/* How a canvas's arrows run and look: Obsidian's curves, straight      */
/* lines, or lines with square corners that keep to right angles round  */
/* the cards; solid, dashed or dotted; a triangle at the end, an open   */
/* head, a dot or a diamond. And where they join the cards: as drawn,   */
/* or at the sides that face each other, following the cards as they   */
/* move. Each arrow keeps its own style in its data in the canvas file, */
/* which Obsidian keeps as it is; arrows without one take the default   */
/* in settings.                                                        */
/*                                                                     */
/* The canvas draws an arrow itself; this redraws it, after, the way    */
/* its style says — behind a check that the canvas still draws arrows   */
/* the way it did, and falling back to its own drawing if not.          */
/* ------------------------------------------------------------------ */

const ARROW_KEY = 'drArrow';

const ARROW_SHAPES = { curve: 'Curved', straight: 'Straight', elbow: 'Square corners' };
const ARROW_LINES = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' };
const ARROW_HEADS = { arrow: 'Triangle head', open: 'Open head', dot: 'Dot', diamond: 'Diamond' };

/* Heads drawn from their tip at 0,0, back down the line: the canvas scales them from there. */
const ARROW_HEAD_POINTS = {
  arrow: '0,0 6.5,10.4 -6.5,10.4',
  open: '0,0 7,11 4.2,11 0,4.6 -4.2,11 -7,11',
  diamond: '0,0 5,7 0,14 -5,7',
  dot: Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    return `${Math.round(Math.sin(a) * 4.8 * 100) / 100},${Math.round((4.8 - Math.cos(a) * 4.8) * 100) / 100}`;
  }).join(' '),
};

/* How far an arrow with square corners runs straight out of a card before it turns, and how round its corners are. */
const ELBOW_STUB = 24;
const ELBOW_RADIUS = 14;
/* How far from the card an arrow's line stops under its head, as the canvas has it. */
const ARROW_INSET = 7;

const SIDE_OUT = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Where a side of a box is joined: its middle. */
function sidePoint(box, side) {
  if (side === 'top') return { x: (box.minX + box.maxX) / 2, y: box.minY };
  if (side === 'bottom') return { x: (box.minX + box.maxX) / 2, y: box.maxY };
  if (side === 'left') return { x: box.minX, y: (box.minY + box.maxY) / 2 };
  return { x: box.maxX, y: (box.minY + box.maxY) / 2 };
}

/** The sides two boxes face each other with: across the wider gap between them. */
function nearestSides(from, to) {
  const gapX = Math.max(to.minX - from.maxX, from.minX - to.maxX);
  const gapY = Math.max(to.minY - from.maxY, from.minY - to.maxY);
  const fx = (from.minX + from.maxX) / 2;
  const fy = (from.minY + from.maxY) / 2;
  const tx = (to.minX + to.maxX) / 2;
  const ty = (to.minY + to.maxY) / 2;
  if (gapX >= gapY) return tx >= fx ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  return ty >= fy ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

const movePoint = (p, dir, by) => ({ x: p.x + dir.x * by, y: p.y + dir.y * by });
const pointDistance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

/** Points in a row with repeats and straight-through middles taken out. */
function simplifyPoints(points) {
  const out = [];
  points.forEach((p) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) return;
    out.push(p);
  });
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(cross) < 0.01 && dot >= 0) out.splice(i, 1);
  }
  return out;
}

/**
 * The way from one card's side to another's in right angles: straight
 * out of the first, across, and straight into the second — round the
 * outside of both where they face away from each other.
 */
function elbowPoints(a, fromSide, l, toSide, fromBox, toBox) {
  const o1 = SIDE_OUT[fromSide] || SIDE_OUT.right;
  const o2 = SIDE_OUT[toSide] || SIDE_OUT.left;
  const h1 = o1.x !== 0;
  const h2 = o2.x !== 0;
  const toward = (from, to, dir) => (to.x - from.x) * dir.x + (to.y - from.y) * dir.y > 0;
  if (h1 === h2) {
    const axis = h1 ? 'x' : 'y';
    // Facing each other: out, across halfway between, and in.
    if (toward(a, l, o1) && toward(l, a, o2)) {
      const m = (a[axis] + l[axis]) / 2;
      return simplifyPoints([a, Object.assign({}, a, { [axis]: m }), Object.assign({}, l, { [axis]: m }), l]);
    }
  } else {
    // One out sideways, the other up or down: a single corner, where it can go straight there.
    const corner = h1 ? { x: l.x, y: a.y } : { x: a.x, y: l.y };
    if (toward(a, corner, o1) && toward(corner, l, { x: -o2.x, y: -o2.y })) return simplifyPoints([a, corner, l]);
  }
  // Otherwise out of each card a little way first, then round.
  const A = movePoint(a, o1, ELBOW_STUB);
  const B = movePoint(l, o2, ELBOW_STUB);
  let mid;
  if (h1 === h2) {
    const cross = h1 ? 'y' : 'x';
    const lo = h1 ? 'minY' : 'minX';
    const hi = h1 ? 'maxY' : 'maxX';
    let m = (A[cross] + B[cross]) / 2;
    // Side by side across the way: round the far side of both.
    if (Math.min(fromBox[hi], toBox[hi]) > Math.max(fromBox[lo], toBox[lo]) - ELBOW_STUB) {
      m = Math.max(fromBox[hi], toBox[hi]) + ELBOW_STUB;
    }
    mid = [Object.assign({}, A, { [cross]: m }), Object.assign({}, B, { [cross]: m })];
  } else {
    const corner = h1 ? { x: B.x, y: A.y } : { x: A.x, y: B.y };
    const firstOk = h1 ? (corner.x - A.x) * o1.x >= 0 : (corner.y - A.y) * o1.y >= 0;
    const lastOk = h1 ? (B.y - corner.y) * -o2.y >= 0 : (B.x - corner.x) * -o2.x >= 0;
    mid = firstOk && lastOk ? [corner] : [h1 ? { x: A.x, y: B.y } : { x: B.x, y: A.y }];
  }
  return simplifyPoints([a, A].concat(mid, [B, l]));
}

/** A line through points, its corners rounded. */
function roundedPath(points, radius) {
  const f = (v) => Math.round(v * 100) / 100;
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const p = points[i];
    const next = points[i + 1];
    const r = Math.min(radius, pointDistance(prev, p) / 2, pointDistance(p, next) / 2);
    const lin = pointDistance(prev, p) || 1;
    const lout = pointDistance(p, next) || 1;
    const a = { x: p.x - ((p.x - prev.x) / lin) * r, y: p.y - ((p.y - prev.y) / lin) * r };
    const b = { x: p.x + ((next.x - p.x) / lout) * r, y: p.y + ((next.y - p.y) / lout) * r };
    d += ` L${f(a.x)} ${f(a.y)} Q${f(p.x)} ${f(p.y)} ${f(b.x)} ${f(b.y)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${f(last.x)} ${f(last.y)}`;
}

/** Halfway along a line through points. */
function polylineMiddle(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += pointDistance(points[i - 1], points[i]);
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const step = pointDistance(points[i - 1], points[i]);
    if (step >= left && step > 0) {
      const t = left / step;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
    }
    left -= step;
  }
  return points[points.length - 1];
}

/** The turn that points a head, drawn pointing up, along `dir`. */
function headAngle(dir) {
  return (Math.atan2(dir.x, -dir.y) * 180) / Math.PI;
}

/** Whether something on a canvas is an arrow. */
function isCanvasEdge(item) {
  return !!item && !!item.from && !!item.to && !!item.from.node && !!item.to.node;
}

class CanvasArrows extends CanvasFeature {
  constructor(plugin) {
    super(plugin);
    this.unpatch = null;
  }

  settingsSchema() {
    return [
      {
        key: 'canvasArrows',
        name: 'Arrow styles',
        desc: 'Arrows on a canvas curved, straight or with square corners; solid, dashed or dotted; with a triangle, an open head, a dot or a diamond. Right-click an arrow, or select some and use the bar above them.',
      },
      {
        key: 'canvasArrowShape',
        type: 'dropdown',
        showIf: 'canvasArrows',
        name: 'Arrows are drawn',
        desc: 'For arrows without a style of their own.',
        options: ARROW_SHAPES,
      },
      {
        key: 'canvasArrowSides',
        showIf: 'canvasArrows',
        name: 'Join cards at the sides facing each other',
        desc: 'Arrows without a style of their own leave and reach each card on the side facing the other, and follow as cards move.',
      },
    ];
  }

  /** An arrow's style: its own, over the default in settings. */
  styleOf(edge) {
    const own = (edge && edge.unknownData && edge.unknownData[ARROW_KEY]) || {};
    const s = this.settings;
    return {
      shape: ARROW_SHAPES[own.shape] ? own.shape : ARROW_SHAPES[s.canvasArrowShape] ? s.canvasArrowShape : 'curve',
      line: ARROW_LINES[own.line] ? own.line : 'solid',
      head: ARROW_HEADS[own.head] ? own.head : 'arrow',
      sides: own.sides === 'near' || own.sides === 'drawn' ? own.sides : s.canvasArrowSides ? 'near' : 'drawn',
    };
  }

  /** What an arrow's style is when it has none of its own. */
  defaults() {
    return this.styleOf(null);
  }

  register() {
    super.register();
    this.plugin.registerEvent(
      this.app.workspace.on('canvas:edge-menu', (menu, edge) => {
        if (this.enabled && edge) this.addMenuItems(menu, [edge]);
      })
    );
  }

  enable() {
    super.enable();
    // A new default: every arrow drawn again.
    this.watched.forEach((state, view) => this.redraw(view));
  }

  disable() {
    super.disable();
    if (this.unpatch) this.unpatch();
    this.unpatch = null;
  }

  /**
   * The canvas's way of drawing an arrow, taken over — once, for every
   * arrow there is — where it still looks as it did: a path to draw,
   * its middle, and its bounds.
   */
  patch(edge) {
    if (this.unpatch || !edge) return !!this.unpatch;
    const proto = Object.getPrototypeOf(edge);
    if (!proto || typeof proto.updatePath !== 'function' || typeof proto.getCenter !== 'function' || typeof proto.getBBox !== 'function') {
      return false;
    }
    const feature = this;
    const undo = [
      around(proto, 'updatePath', (original, self, args) => feature.drawEdge(self, original, args)),
      around(proto, 'getCenter', (original, self, args) =>
        feature.enabled && self.drPoints ? polylineMiddle(self.drPoints) : original.apply(self, args)
      ),
      around(proto, 'getBBox', (original, self, args) => {
        const box = original.apply(self, args);
        if (!feature.enabled || !self.drPoints || !box) return box;
        const xs = self.drPoints.map((p) => p.x);
        const ys = self.drPoints.map((p) => p.y);
        return {
          minX: Math.min(box.minX, ...xs),
          minY: Math.min(box.minY, ...ys),
          maxX: Math.max(box.maxX, ...xs),
          maxY: Math.max(box.maxY, ...ys),
        };
      }),
    ];
    this.unpatch = () => undo.forEach((u) => u());
    return true;
  }

  /** Every arrow on a canvas drawn again. */
  redraw(view) {
    try {
      view.canvas.edges.forEach((edge) => {
        if (typeof edge.render === 'function') edge.render();
      });
    } catch (err) {
      /* drawn as they are */
    }
  }

  /**
   * An arrow drawn as the canvas draws it, then again as its style says.
   * Anything unexpected leaves the canvas's own drawing.
   */
  drawEdge(edge, original, args) {
    if (!this.enabled || !isCanvasEdge(edge)) {
      if (edge) edge.drPoints = null;
      return original.apply(edge, args);
    }
    const style = this.styleOf(edge);
    // Not while either end is folded away: sides picked for the fold would
    // stay with the arrow, and its branch be read the wrong way once it's out.
    const away = (n) => !!n && n.getBBox === tuckedBBox;
    if (style.sides === 'near' && edge.from.node !== edge.to.node && !away(edge.from.node) && !away(edge.to.node)) {
      try {
        const sides = nearestSides(edge.from.node.getBBox(), edge.to.node.getBBox());
        if (edge.from.side !== sides.from) edge.from.side = sides.from;
        if (edge.to.side !== sides.to) edge.to.side = sides.to;
      } catch (err) {
        /* the sides it had */
      }
    }
    const result = original.apply(edge, args);
    edge.drPoints = null;
    try {
      this.restyle(edge, style);
    } catch (err) {
      edge.drPoints = null;
    }
    return result;
  }

  restyle(edge, style) {
    const path = edge.path;
    const fromEnd = edge.fromLineEnd;
    const toEnd = edge.toLineEnd;
    if (style.shape !== 'curve' && path && path.display && path.interaction) {
      const F = edge.from.node.getBBox();
      const T = edge.to.node.getBBox();
      const a = sidePoint(F, edge.from.side);
      const l = sidePoint(T, edge.to.side);
      let points;
      if (style.shape === 'straight') {
        const length = pointDistance(a, l) || 1;
        const dir = { x: (l.x - a.x) / length, y: (l.y - a.y) / length };
        points = [fromEnd ? movePoint(a, dir, ARROW_INSET) : a, toEnd ? movePoint(l, dir, -ARROW_INSET) : l];
        // Heads along the line, not square to the card.
        if (fromEnd && fromEnd.el) fromEnd.el.style.transform = `translate(${a.x}px, ${a.y}px) rotate(${headAngle({ x: -dir.x, y: -dir.y })}deg)`;
        if (toEnd && toEnd.el) toEnd.el.style.transform = `translate(${l.x}px, ${l.y}px) rotate(${headAngle(dir)}deg)`;
      } else {
        points = elbowPoints(a, edge.from.side, l, edge.to.side, F, T);
        if (fromEnd) points[0] = movePoint(a, SIDE_OUT[edge.from.side] || SIDE_OUT.right, ARROW_INSET);
        if (toEnd) points[points.length - 1] = movePoint(l, SIDE_OUT[edge.to.side] || SIDE_OUT.left, ARROW_INSET);
      }
      const d = style.shape === 'straight' ? roundedPath(points, 0) : roundedPath(points, ELBOW_RADIUS);
      path.display.setAttribute('d', d);
      path.interaction.setAttribute('d', d);
      edge.drPoints = points;
    }
    [fromEnd, toEnd].forEach((end) => {
      const poly = end && end.el && typeof end.el.querySelector === 'function' ? end.el.querySelector('polygon') : null;
      const want = ARROW_HEAD_POINTS[style.head] || ARROW_HEAD_POINTS.arrow;
      if (poly && poly.getAttribute('points') !== want) poly.setAttribute('points', want);
    });
    const group = edge.lineGroupEl;
    if (group && group.classList) {
      group.classList.toggle('dr-line-dashed', style.line === 'dashed');
      group.classList.toggle('dr-line-dotted', style.line === 'dotted');
    }
  }

  mount(view) {
    this.firstArrows(view);
  }

  /** Once a canvas has arrows: the drawing taken over, and the ones there drawn again. */
  firstArrows(view) {
    const state = this.watched.get(view);
    if (!state || state.styled) return;
    const first = view.canvas && view.canvas.edges ? view.canvas.edges.values().next().value : null;
    if (!first) return;
    state.styled = true;
    if (this.patch(first)) this.redraw(view);
  }

  pass(view) {
    if (!view || !view.canvas) return;
    this.firstArrows(view);
    this.decorateMenu(view);
  }

  cleanup(view) {
    view.contentEl.querySelectorAll('.dr-arrow-button').forEach((el) => el.remove());
    try {
      view.canvas.edges.forEach((edge) => {
        edge.drPoints = null;
        if (edge.lineGroupEl && edge.lineGroupEl.classList) edge.lineGroupEl.classList.remove('dr-line-dashed', 'dr-line-dotted');
        [edge.fromLineEnd, edge.toLineEnd].forEach((end) => {
          const poly = end && end.el && end.el.querySelector ? end.el.querySelector('polygon') : null;
          if (poly) poly.setAttribute('points', ARROW_HEAD_POINTS.arrow);
        });
      });
    } catch (err) {
      /* nothing to put back */
    }
    // Drawn by the canvas alone again, once the drawing's given back.
    window.setTimeout(() => {
      if (!this.enabled && view.canvas) this.redraw(view);
    }, 0);
  }

  /** The selected arrows. */
  selectedEdges(view) {
    return this.selectedNodes(view).filter(isCanvasEdge);
  }

  /** A button in the bar above selected arrows, for their style. */
  decorateMenu(view) {
    const bar = view.contentEl.querySelector('.canvas-menu');
    if (!bar) return;
    const edges = this.selectedEdges(view);
    menuButton(bar, 'dr-arrow-button', edges.length ? { title: 'Arrow style', icon: 'spline' } : null, () => {
      const now = this.selectedEdges(view);
      const button = bar.querySelector('.dr-arrow-button');
      if (!now.length || !button) return;
      const menu = new Menu();
      this.fillStyleMenu(menu, view, now, true);
      const r = button.getBoundingClientRect();
      if (typeof menu.showAtPosition === 'function') menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
    });
  }

  addMenuItems(menu, items) {
    const edges = (items || []).filter(isCanvasEdge);
    const view = edges[0] && edges[0].canvas && edges[0].canvas.view;
    if (!edges.length || !view || !view.canvas) return;
    menuGroup(menu, 'Arrow style', 'spline', (m, nested) => this.fillStyleMenu(m, view, edges, nested), 'action');
  }

  /** Shapes, lines, heads and sides, the current ones ticked; then the style for every arrow, or back to the default. */
  fillStyleMenu(menu, view, edges, nested) {
    const styles = edges.map((e) => this.styleOf(e));
    const all = (key, value) => styles.every((s) => s[key] === value);
    const add = (title, checked, change) =>
      menu.addItem((item) => {
        item.setTitle(nested ? title : `Arrow: ${title.toLowerCase()}`);
        if (!nested && typeof item.setSection === 'function') item.setSection('action');
        if (typeof item.setChecked === 'function') item.setChecked(checked);
        item.onClick(() => this.setStyle(view, edges, change));
      });
    const gap = () => {
      if (nested && typeof menu.addSeparator === 'function') menu.addSeparator();
    };
    Object.keys(ARROW_SHAPES).forEach((k) => add(ARROW_SHAPES[k], all('shape', k), { shape: k }));
    gap();
    Object.keys(ARROW_LINES).forEach((k) => add(ARROW_LINES[k], all('line', k), { line: k }));
    gap();
    Object.keys(ARROW_HEADS).forEach((k) => add(ARROW_HEADS[k], all('head', k), { head: k }));
    gap();
    const near = all('sides', 'near');
    add('Join at the facing sides', near, { sides: near ? 'drawn' : 'near' });
    gap();
    menu.addItem((item) => {
      item.setTitle(nested ? 'Use for every arrow here' : 'Arrow: use this style for every arrow here').setIcon('copy');
      if (!nested && typeof item.setSection === 'function') item.setSection('action');
      item.onClick(() => this.styleEverything(view, edges[0]));
    });
    if (edges.some((e) => e.unknownData && e.unknownData[ARROW_KEY])) {
      menu.addItem((item) => {
        item.setTitle(nested ? 'Back to the default' : 'Arrow: back to the default').setIcon('rotate-ccw');
        if (!nested && typeof item.setSection === 'function') item.setSection('action');
        item.onClick(() => this.setStyle(view, edges, null));
      });
    }
  }

  /**
   * A change of style onto some arrows — or, with none, their own style
   * taken away; `replace` puts the change in place of their own rather
   * than over it. What matches the default isn't kept, so it follows the
   * default. By hand: saved, as a step of Undo.
   */
  setStyle(view, edges, change, replace) {
    const defaults = this.defaults();
    edges.forEach((edge) => {
      if (!edge.unknownData) edge.unknownData = {};
      const own = change ? Object.assign({}, replace ? {} : edge.unknownData[ARROW_KEY] || {}, change) : {};
      Object.keys(own).forEach((k) => {
        if (own[k] === defaults[k]) delete own[k];
      });
      if (Object.keys(own).length) edge.unknownData[ARROW_KEY] = own;
      else delete edge.unknownData[ARROW_KEY];
      if (typeof edge.render === 'function') edge.render();
    });
    this.save(view);
  }

  /** One arrow's style for every arrow on its canvas. */
  styleEverything(view, model) {
    const edges = Array.from(view.canvas.edges.values()).filter(isCanvasEdge);
    this.setStyle(view, edges, this.styleOf(model), true);
  }

  save(view) {
    try {
      if (typeof view.canvas.requestSave === 'function') view.canvas.requestSave();
    } catch (err) {
      /* saved with the canvas's next change */
    }
  }
}

CanvasArrows.settingKey = 'canvasArrows';
