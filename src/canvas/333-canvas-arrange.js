/* ------------------------------------------------------------------ */
/* Arranging cards                                                     */
/*                                                                     */
/* Selected cards lined up by an edge or their middles, spaced evenly, */
/* made the same size, or laid out in a grid, a row or a column. From  */
/* a button in the bar above them, their right-click menu, or commands */
/* to give keys to. A group moves with what's in it; cards glide into  */
/* place, and the whole arrangement is one step of Undo.               */
/* ------------------------------------------------------------------ */

import { drawnMenu, menuGroup } from '../core/030-helpers-art.js';
import { cardElement } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { boundsOf, canvasGap, canvasModel, isGroupRecord, withinRect } from './316-canvas-tree.js';
import { shiftRecord, snapshotModel } from './317-canvas-room.js';
import { isCanvasEdge } from './332-canvas-arrows.js';
import { CanvasFold, glideAndSettle, menuButton } from './335-canvas-fold.js';

/* The room left between cards laid out in a grid, a row or a column. */
export const ARRANGE_GAP = 40;

/* Arrange's own icon: cards lined up on an edge, as the menu's icons each show their arrangement. */
export const ARRANGE_ICON = 'align-start-vertical';

/* What can be done, in the order the menu shows it; a blank line between sets. */
export const ARRANGE_ACTIONS = [
  { id: 'left', title: 'Align left edges', icon: 'align-start-vertical' },
  { id: 'center', title: 'Align centres', icon: 'align-center-vertical' },
  { id: 'right', title: 'Align right edges', icon: 'align-end-vertical' },
  null,
  { id: 'top', title: 'Align tops', icon: 'align-start-horizontal' },
  { id: 'middle', title: 'Align middles', icon: 'align-center-horizontal' },
  { id: 'bottom', title: 'Align bottoms', icon: 'align-end-horizontal' },
  null,
  { id: 'space-across', title: 'Space evenly across', icon: 'align-horizontal-distribute-center', least: 3 },
  { id: 'space-down', title: 'Space evenly down', icon: 'align-vertical-distribute-center', least: 3 },
  null,
  { id: 'width', title: 'Same width', icon: 'stretch-horizontal' },
  { id: 'height', title: 'Same height', icon: 'stretch-vertical' },
  null,
  { id: 'grid', title: 'Arrange in a grid', icon: 'layout-grid' },
  { id: 'row', title: 'Arrange in a row', icon: 'align-horizontal-justify-start' },
  { id: 'column', title: 'Arrange in a column', icon: 'align-vertical-justify-start' },
];

/** Cards in the order they're read: in rows, top to bottom, each left to right. */
export function readingOrder(recs) {
  const rows = [];
  recs
    .slice()
    .sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2))
    .forEach((r) => {
      const mid = r.y + r.height / 2;
      const row = rows.find((w) => mid >= w.top && mid <= w.bottom);
      if (row) {
        row.cards.push(r);
        row.top = Math.min(row.top, r.y);
        row.bottom = Math.max(row.bottom, r.y + r.height);
      } else rows.push({ top: r.y, bottom: r.y + r.height, cards: [r] });
    });
  return rows.reduce((all, row) => all.concat(row.cards.sort((a, b) => a.x - b.x)), []);
}

/**
 * Where each card goes, and its size: id -> { x, y, width, height }.
 * `recs` are the cards' records; what isn't returned stays as it is.
 */
export function arrangePlaces(recs, action) {
  const out = new Map();
  if (recs.length < 2) return out;
  const box = boundsOf(recs);
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const put = (r, change) => out.set(r.id, Object.assign({ x: r.x, y: r.y, width: r.width, height: r.height }, change));
  const round = (v) => Math.round(v);
  const spread = (axis) => {
    const size = axis === 'x' ? 'width' : 'height';
    const sorted = recs.slice().sort((a, b) => a[axis] - b[axis] || b[size] - a[size]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last[axis] + last[size] - first[axis];
    const total = sorted.reduce((s, r) => s + r[size], 0);
    let gap = (span - total) / (sorted.length - 1);
    // Overlapping already: a plain gap between them, from the first.
    if (gap < 0) gap = canvasGap(ARRANGE_GAP);
    let at = first[axis];
    sorted.forEach((r) => {
      put(r, { [axis]: round(at) });
      at += r[size] + gap;
    });
  };
  const line = (axis) => {
    const size = axis === 'x' ? 'width' : 'height';
    const cross = axis === 'x' ? 'y' : 'x';
    let at = box[axis];
    readingOrder(recs).forEach((r) => {
      put(r, { [axis]: at, [cross]: box[cross] });
      at += r[size] + canvasGap(ARRANGE_GAP);
    });
  };
  if (action === 'left') recs.forEach((r) => put(r, { x: box.x }));
  else if (action === 'right') recs.forEach((r) => put(r, { x: right - r.width }));
  else if (action === 'center') recs.forEach((r) => put(r, { x: round(box.x + box.width / 2 - r.width / 2) }));
  else if (action === 'top') recs.forEach((r) => put(r, { y: box.y }));
  else if (action === 'bottom') recs.forEach((r) => put(r, { y: bottom - r.height }));
  else if (action === 'middle') recs.forEach((r) => put(r, { y: round(box.y + box.height / 2 - r.height / 2) }));
  else if (action === 'space-across') spread('x');
  else if (action === 'space-down') spread('y');
  else if (action === 'width') {
    const w = Math.max(...recs.map((r) => r.width));
    recs.forEach((r) => put(r, { width: w }));
  } else if (action === 'height') {
    const h = Math.max(...recs.map((r) => r.height));
    recs.forEach((r) => put(r, { height: h }));
  } else if (action === 'row') line('x');
  else if (action === 'column') line('y');
  else if (action === 'grid') {
    const order = readingOrder(recs);
    const cols = Math.ceil(Math.sqrt(order.length));
    const widths = [];
    const heights = [];
    order.forEach((r, i) => {
      const c = i % cols;
      const w = Math.floor(i / cols);
      widths[c] = Math.max(widths[c] || 0, r.width);
      heights[w] = Math.max(heights[w] || 0, r.height);
    });
    order.forEach((r, i) => {
      const c = i % cols;
      const w = Math.floor(i / cols);
      const x = box.x + widths.slice(0, c).reduce((s, v) => s + v + canvasGap(ARRANGE_GAP), 0);
      const y = box.y + heights.slice(0, w).reduce((s, v) => s + v + canvasGap(ARRANGE_GAP), 0);
      put(r, { x, y });
    });
  }
  // Only what moves or changes size.
  out.forEach((to, id) => {
    const r = recs.find((n) => n.id === id);
    if (r && to.x === r.x && to.y === r.y && to.width === r.width && to.height === r.height) out.delete(id);
  });
  return out;
}

export class CanvasArrange extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasArrange',
        name: 'Arrange',
        desc: 'Align, space, size or grid selected cards from the bar above them or their right-click menu.',
      },
    ];
  }

  // On menus as the Arrange group, in its sets (fillMenu).
  actions() {
    return ARRANGE_ACTIONS.filter(Boolean).map((a) => ({
      id: `arrange-canvas-${a.id}`,
      name: `${a.title} of the selected cards`,
      menu: false,
      icon: a.icon,
      on: 'canvas',
      when: (ctx) => this.enabled && this.cards(ctx.view).length >= (a.least || 2),
      run: (ctx) => this.arrange(ctx.view, a.id),
    }));
  }

  /**
   * The selected cards that can be arranged, as records: shown ones, and
   * not one inside a group that's selected too — that moves with it.
   */
  cards(view) {
    if (!view || !view.canvas) return [];
    const ids = new Set(this.selectedNodes(view).filter((n) => n && cardElement(n) && !isCanvasEdge(n)).map((n) => n.id));
    if (ids.size < 2) return [];
    const model = canvasModel(view.canvas);
    const picked = model.nodes.filter((r) => ids.has(r.id) && !r.tuck);
    const groups = picked.filter(isGroupRecord);
    return picked.filter((r) => !groups.some((g) => g !== r && withinRect(r, g)));
  }

  /** Cards put in place as `action` says: gliding there, then saved as one step of Undo. */
  arrange(view, action) {
    if (!view || !view.canvas) return Promise.resolve(false);
    const fold = this.plugin.feature(CanvasFold);
    if (fold) fold.settle(view);
    const model = canvasModel(view.canvas);
    const ids = new Set(this.cards(view).map((r) => r.id));
    const recs = model.nodes.filter((r) => ids.has(r.id));
    const places = arrangePlaces(recs, action);
    if (!places.size) return Promise.resolve(false);
    const before = snapshotModel(model);
    places.forEach((to, id) => {
      const rec = model.byId.get(id);
      // A folded card keeps its folded height: pulled to another, it would open.
      const height = rec.fold ? rec.height : to.height;
      ['x', 'y'].forEach((axis) => {
        if (to[axis] !== rec[axis]) shiftRecord(model, rec, axis, to[axis] - rec[axis], new Set());
      });
      rec.width = to.width;
      rec.height = height;
    });
    // As it was written: the canvas outline isn't told of an arrangement.
    return glideAndSettle(this.plugin, view, model, before, { announce: false });
  }

  addMenuItems(menu, nodes) {
    const view = nodes[0] && nodes[0].canvas && nodes[0].canvas.view;
    if (!view || this.cards(view).length < 2) return;
    menuGroup(menu, 'Arrange', ARRANGE_ICON, (m, nested) => this.fillMenu(m, view, nested), 'action');
  }

  /** What can be done with the selected cards, in sets. */
  fillMenu(menu, view, nested) {
    const count = this.cards(view).length;
    let gap = false;
    ARRANGE_ACTIONS.forEach((a) => {
      if (!a) {
        gap = true;
        return;
      }
      if (count < (a.least || 2)) return;
      if (gap && nested && typeof menu.addSeparator === 'function') menu.addSeparator();
      gap = false;
      menu.addItem((item) => {
        item.setTitle(a.title).setIcon(a.icon);
        if (!nested && typeof item.setSection === 'function') item.setSection('action');
        item.onClick(() => this.arrange(view, a.id));
      });
    });
  }

  pass(view) {
    const bar = view.contentEl.querySelector('.canvas-menu');
    if (!bar) return;
    const many = this.cards(view).length >= 2;
    // Newer Obsidian has an Align of its own there; Arrange does all it does, and stands in for it.
    bar.toggleClass('dr-arranging', many);
    menuButton(bar, 'dr-arrange-button', many ? { title: 'Arrange', icon: ARRANGE_ICON } : null, () => {
      const button = bar.querySelector('.dr-arrange-button');
      if (!button || this.cards(view).length < 2) return;
      // Its icons show each arrangement: drawn by Obsidian, so they show with native menus too.
      const menu = drawnMenu();
      this.fillMenu(menu, view, true);
      const r = button.getBoundingClientRect();
      if (typeof menu.showAtPosition === 'function') menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
    });
  }

  cleanup(view) {
    view.contentEl.querySelectorAll('.dr-arrange-button').forEach((el) => el.remove());
    view.contentEl.querySelectorAll('.dr-arranging').forEach((el) => el.removeClass('dr-arranging'));
  }
}

CanvasArrange.settingKey = 'canvasArrange';
