/* ------------------------------------------------------------------ */
/* Tree: layouts                                                      */
/*                                                                    */
/* Where a branch's cards go for each layout — to one side, both,     */
/* down, round, as an outline, as a concept map; on a mind map also   */
/* as an org chart, a fishbone, a timeline — and the order its cards  */
/* are walked in. Pure: given records and their sizes.                */
/* ------------------------------------------------------------------ */

import { arrowLinks, boundsOf, branchOf, canvasGap, indexModel, isGroupRecord, shownChildren, TIDY_DEPTH_GAP, TIDY_SIBLING_GAP, tidyOneWay } from './400-tree-model.js';

export const BRANCH_LAYOUTS = [
  ['right', 'To the right', 'arrow-right'],
  ['left', 'To the left', 'arrow-left'],
  ['bottom', 'Downward', 'arrow-down'],
  ['top', 'Upward', 'arrow-up'],
  ['both', 'Both sides', 'arrow-left-right'],
  ['radial', 'All round', 'sun'],
  ['outline', 'As an outline', 'list-tree'],
  ['concept', 'As a concept map', 'waypoints'],
];

/* Shapes only a mind map takes: its edges are drawn to suit them. */
export const SHAPED_LAYOUTS = [
  ['org', 'As an org chart', 'network'],
  ['fishbone', 'As a fishbone', 'fish'],
  ['spine', 'Along a timeline', 'milestone'],
];

/* Every layout a mind map can take. */
export const MAP_LAYOUTS = BRANCH_LAYOUTS.concat(SHAPED_LAYOUTS);

/* On a canvas, the nearest layout it has. */
const CANVAS_NEAREST = { org: 'bottom', fishbone: 'left', spine: 'right' };

/** A mind map's layout as a canvas can take it. */
export function canvasLayoutOf(mode) {
  return CANVAS_NEAREST[mode] || mode;
}

/* What each kind of layout is best for, as the Lay out… command offers them. */
export const LAYOUT_ENGINES = [
  { mode: 'radial', label: 'Radial', note: 'For brainstorming, broad topics, a subject explored from a central question' },
  { mode: 'right', label: 'Tree, to the right', note: 'For taxonomies, parent and child concepts, doctrines, structured notes' },
  { mode: 'bottom', label: 'Tree, downward', note: 'The same, top to bottom' },
  { mode: 'both', label: 'Tree, both sides', note: 'A mind map: branches either side of the centre' },
  { mode: 'concept', label: 'Concept map', note: 'For subjects whose ideas relate in many ways: theory, philosophy, law' },
  { mode: 'outline', label: 'Outline', note: 'For an essay plan, a study outline or an argument in order' },
];

export const OUTLINE_INDENT = 48;

export const OUTLINE_GAP = 16;

/**
 * A branch as an outline: each card below the one before it, in reading
 * order, set in by a step for each level below the root. id -> { x, y }.
 */
export function outlineLayout(model, rootId, links) {
  links = links || arrowLinks(model);
  const out = new Map();
  out.sides = new Map();
  out.both = false;
  const root = model.byId.get(rootId);
  if (!root) return out;
  const kids = orderedBranch(model, rootId, links, siblingOrder);
  let y = root.y + root.height + canvasGap(OUTLINE_GAP);
  const walk = (id, depth) =>
    (kids.get(id) || []).forEach((c) => {
      out.set(c.id, { x: Math.round(root.x + depth * canvasGap(OUTLINE_INDENT)), y: Math.round(y) });
      y += c.height + canvasGap(OUTLINE_GAP);
      walk(c.id, depth + 1);
    });
  walk(rootId, 1);
  return out;
}

/* A concept map's pull along arrows, and how far apart it would hold two cards. */
export const CONCEPT_ROUNDS = 240;

/**
 * A branch as a concept map: laid out round its card first, then drawn
 * together along every arrow among its cards — related ones too — and
 * pushed apart where they crowd, the card itself staying put; then no two
 * left touching. The same branch gives the same map. id -> { x, y }.
 */
export function conceptLayout(model, rootId, links) {
  links = links || arrowLinks(model);
  const start = radialLayout(model, rootId, links);
  const out = new Map();
  out.sides = new Map();
  out.both = true;
  const root = model.byId.get(rootId);
  if (!root || !start.size) return start;
  const ids = [rootId].concat(Array.from(start.keys()));
  const inside = new Set(ids);
  const pos = new Map(ids.map((id) => {
    const r = model.byId.get(id);
    const at = id === rootId ? r : start.get(id);
    return [id, { x: at.x + r.width / 2, y: at.y + r.height / 2, w: r.width, h: r.height }];
  }));
  const pairs = [];
  model.edges.forEach((e) => {
    if (inside.has(e.from) && inside.has(e.to) && e.from !== e.to) pairs.push([e.from, e.to]);
  });
  // Pushed apart by k²/d, pulled along arrows by d²/k, and a little toward the card at the root.
  const k = 220;
  const centre = pos.get(rootId);
  for (let round = 0; round < CONCEPT_ROUNDS; round++) {
    const heat = 60 * (1 - round / CONCEPT_ROUNDS) + 1;
    const push = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]);
        const b = pos.get(ids[j]);
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 1) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const f = (k * k) / d / d;
        push.get(ids[i]).x += dx * f;
        push.get(ids[i]).y += dy * f;
        push.get(ids[j]).x -= dx * f;
        push.get(ids[j]).y -= dy * f;
      }
    }
    pairs.forEach(([x, y]) => {
      const a = pos.get(x);
      const b = pos.get(y);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const f = Math.hypot(dx, dy) / k;
      push.get(x).x += dx * f;
      push.get(x).y += dy * f;
      push.get(y).x -= dx * f;
      push.get(y).y -= dy * f;
    });
    ids.forEach((id) => {
      if (id === rootId) return;
      const p = pos.get(id);
      const m = push.get(id);
      m.x += (centre.x - p.x) * 0.05;
      m.y += (centre.y - p.y) * 0.05;
      const len = Math.hypot(m.x, m.y);
      const step = Math.min(len, heat);
      if (len > 0) {
        p.x += (m.x / len) * step;
        p.y += (m.y / len) * step;
      }
    });
  }
  // Then nothing touching: each pair that meets eased apart, the root staying put.
  const gap = canvasGap(TIDY_SIBLING_GAP);
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i]);
        const b = pos.get(ids[j]);
        const ox = (a.w + b.w) / 2 + gap - Math.abs(a.x - b.x);
        const oy = (a.h + b.h) / 2 + gap - Math.abs(a.y - b.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const alongX = ox < oy;
        const sign = alongX ? (a.x <= b.x ? -1 : 1) : a.y <= b.y ? -1 : 1;
        const amount = (alongX ? ox : oy) / (ids[i] === rootId || ids[j] === rootId ? 1 : 2);
        if (ids[i] !== rootId) a[alongX ? 'x' : 'y'] += sign * amount;
        if (ids[j] !== rootId) b[alongX ? 'x' : 'y'] -= sign * amount;
      }
    }
    if (!moved) break;
  }
  ids.forEach((id) => {
    if (id === rootId) return;
    const p = pos.get(id);
    out.set(id, { x: Math.round(p.x - p.w / 2), y: Math.round(p.y - p.h / 2) });
  });
  return out;
}

export function centreOf(r) {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** An angle from straight up, going clockwise, in [0, 2π). */
export function clockwiseFromTop(from, to) {
  const a = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2;
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * Cards in the order they're in now: lying out one side of their card,
 * along the row or column they make; spread round it, clockwise from
 * the top.
 */
export function siblingOrder(parent, cards) {
  if (cards.length < 2) return cards.slice();
  const from = centreOf(parent);
  const ways = cards.map((c) => {
    const m = centreOf(c);
    return { c, dx: m.x - from.x, dy: m.y - from.y };
  });
  const mx = ways.reduce((s, w) => s + w.dx, 0);
  const my = ways.reduce((s, w) => s + w.dy, 0);
  // One side: every card less than a right angle from the way they lie on the whole.
  if ((mx || my) && ways.every((w) => w.dx * mx + w.dy * my > 0)) {
    const across = Math.abs(mx) >= Math.abs(my) ? 'y' : 'x';
    const other = across === 'x' ? 'y' : 'x';
    return cards.slice().sort((a, b) => a[across] - b[across] || a[other] - b[other]);
  }
  return cards.slice().sort((a, b) => clockwiseFromTop(from, centreOf(a)) - clockwiseFromTop(from, centreOf(b)));
}

/**
 * A branch as a tree: each shown card once, under the first card to
 * reach it, children in `order`. Map id -> [records]; groups take no part.
 */
export function orderedBranch(model, rootId, links, order) {
  const root = model.byId.get(rootId);
  const kids = new Map();
  if (!root) return kids;
  const mine = new Set(branchOf(model, rootId, links));
  const seen = new Set([rootId]);
  const queue = [root];
  for (let at = 0; at < queue.length; at++) {
    const n = queue[at];
    const cs = shownChildren(model, links, n.id).filter((c) => mine.has(c.id) && !seen.has(c.id) && !isGroupRecord(c));
    cs.forEach((c) => seen.add(c.id));
    const sorted = order(n, cs);
    kids.set(n.id, sorted);
    sorted.forEach((c) => queue.push(c));
  }
  return kids;
}

/**
 * The cards as a presentation steps through them: depth first from the
 * root, children in the order they lie, each card once — a card reached
 * by more than one arrow under the first, a cycle walked once. A folded
 * branch is one step: its tucked cards aren't shown. With no root, every
 * tree on the canvas, the top-left first. [{ id, ancestors }], the
 * ancestors root first.
 */
export function presentationOrder(model, rootId, links) {
  links = links || arrowLinks(model);
  const out = [];
  const seen = new Set();
  const card = (n) => n && !n.tuck && !isGroupRecord(n);
  const reading = (a, b) => a.y - b.y || a.x - b.x;
  const visit = (id) => {
    const kids = orderedBranch(model, id, links, siblingOrder);
    const walk = (at, ancestors) => {
      if (seen.has(at)) return;
      seen.add(at);
      out.push({ id: at, ancestors });
      (kids.get(at) || []).forEach((c) => walk(c.id, ancestors.concat([at])));
    };
    walk(id, []);
  };
  if (rootId) {
    if (card(model.byId.get(rootId))) visit(rootId);
    return out;
  }
  const hasParent = (n) => (links.parents.get(n.id) || []).some((p) => card(model.byId.get(p)));
  model.nodes.filter((n) => card(n) && !hasParent(n)).sort(reading).forEach((n) => visit(n.id));
  // Cards only in a cycle, or reached only across trees: on their own, after.
  model.nodes.filter((n) => card(n) && !seen.has(n.id)).sort(reading).forEach((n) => visit(n.id));
  return out;
}

/**
 * A branch as a tidy tree growing one way, or — 'both' — out both sides,
 * its first cards to the right and the rest to the left, by how many
 * cards each takes. id -> { x, y }, with `sides` and `both` as tidyBranch.
 */
export function directedLayout(model, rootId, way, links) {
  links = links || arrowLinks(model);
  const root = model.byId.get(rootId);
  if (!root) return Object.assign(new Map(), { sides: new Map(), both: way === 'both' });
  return directedPlaces(root, way, orderedBranch(model, rootId, links, siblingOrder));
}

/**
 * The same, for a tree already known: `kids` is id -> [records], each
 * card's children in their order. A mind map, a tree already, starts here.
 */
export function directedPlaces(root, way, kids) {
  const rootId = root.id;
  const out = new Map();
  out.sides = new Map();
  out.both = way === 'both';
  // Copies lined up in their order the way their siblings will, so the tidy keeps it.
  const ways = way === 'both' ? ['right', 'left'] : [way];
  const copies = new Map();
  const copy = (r) => {
    if (!copies.has(r.id)) copies.set(r.id, Object.assign({}, r));
    return copies.get(r.id);
  };
  const lined = new Map();
  kids.forEach((cs, id) => {
    lined.set(
      id,
      cs.map((c, i) => {
        const k = copy(c);
        k.x = i * 100000;
        k.y = i * 100000;
        return k;
      })
    );
  });
  const first = lined.get(rootId) || [];
  if (way !== 'both') {
    tidyOneWay(root, way, first, lined, out);
    return out;
  }
  // The first cards, by how many cards hang from them, out the right; the rest the left.
  const size = (id) => 1 + (kids.get(id) || []).reduce((n, c) => n + size(c.id), 0);
  const total = first.reduce((n, c) => n + size(c.id), 0);
  const right = [];
  const left = [];
  let taken = 0;
  first.forEach((c, i) => {
    const last = i === first.length - 1;
    if (!right.length || (taken < total / 2 && !(last && !left.length))) {
      right.push(c);
      taken += size(c.id);
    } else {
      left.push(c);
    }
  });
  // Clockwise, as a mind map reads: the left side from the bottom up.
  left.forEach((c, j) => {
    c.y = (left.length - j) * 100000;
  });
  if (right.length) tidyOneWay(root, ways[0], right, lined, out);
  if (left.length) tidyOneWay(root, ways[1], left, lined, out);
  return out;
}

/**
 * A branch round its card: each card at a distance from it by how many
 * steps away it is, in a share of the circle as large as the cards
 * at the ends of its own branch are many, clockwise from the top. Rings
 * far enough apart, and wide enough round, that no two cards meet.
 * id -> { x, y }.
 */
export function radialLayout(model, rootId, links) {
  links = links || arrowLinks(model);
  const out = new Map();
  out.sides = new Map();
  out.both = true;
  const root = model.byId.get(rootId);
  if (!root) return out;
  const middle = centreOf(root);
  const around = (n) => clockwiseFromTop(middle, centreOf(n));
  // Around the root, clockwise from where each card's parent lies.
  const order = (parent, cards) => {
    const base = parent === root ? 0 : around(parent);
    const rel = (c) => {
      const a = around(c) - base + (parent === root ? 0 : Math.PI);
      return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    };
    return cards.slice().sort((a, b) => rel(a) - rel(b) || a.y - b.y || a.x - b.x);
  };
  const kids = orderedBranch(model, rootId, links, order);
  const leaves = new Map();
  const count = (id) => {
    const cs = kids.get(id) || [];
    const n = cs.length ? cs.reduce((s, c) => s + count(c.id), 0) : 1;
    leaves.set(id, n);
    return n;
  };
  const total = count(rootId);
  if (!(kids.get(rootId) || []).length) return out;
  // How far out each ring is.
  const half = (r) => Math.hypot(r.width, r.height) / 2;
  const reach = [half(root)];
  let widest = 0;
  const depthOf = new Map([[rootId, 0]]);
  kids.forEach((cs, id) => {
    cs.forEach((c) => {
      const d = depthOf.get(id) + 1;
      depthOf.set(c.id, d);
      reach[d] = Math.max(reach[d] || 0, half(c));
      widest = Math.max(widest, half(c) * 2);
    });
  });
  // Wide enough round that the narrowest share fits a card.
  const least = (total * (widest + canvasGap(TIDY_SIBLING_GAP))) / (2 * Math.PI);
  const radius = [0];
  for (let d = 1; d < reach.length; d++) {
    radius[d] = Math.max(radius[d - 1] + reach[d - 1] + reach[d] + canvasGap(TIDY_DEPTH_GAP), d === 1 ? least : 0);
  }
  const place = (id, start, span) => {
    let at = start;
    (kids.get(id) || []).forEach((c) => {
      const share = (span * leaves.get(c.id)) / leaves.get(id);
      const angle = at + share / 2 - Math.PI / 2;
      const r = radius[depthOf.get(c.id)];
      out.set(c.id, { x: Math.round(middle.x + r * Math.cos(angle) - c.width / 2), y: Math.round(middle.y + r * Math.sin(angle) - c.height / 2) });
      place(c.id, at, share);
      at += share;
    });
  };
  // The first card straight up from the root.
  const first = kids.get(rootId)[0];
  const firstShare = (2 * Math.PI * leaves.get(first.id)) / total;
  place(rootId, -firstShare / 2, 2 * Math.PI);
  return out;
}

/**
 * Arrows among some cards only, as a tree: the first in reading order
 * at its top, any card not reached from it — the top of another tree
 * among them, or a ring with no top — hung from it too.
 */
export function selectionLinks(model, recs) {
  const full = arrowLinks(model);
  const ids = recs.map((r) => r.id);
  const set = new Set(ids);
  const children = new Map(ids.map((id) => [id, (full.children.get(id) || []).filter((c) => set.has(c) && c !== id)]));
  const ordered = recs.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const parents = new Map();
  children.forEach((kids, id) => kids.forEach((c) => parents.set(c, (parents.get(c) || []).concat(id))));
  const root = (ordered.find((r) => !(parents.get(r.id) || []).length) || ordered[0]).id;
  const reached = new Set([root]);
  const walk = [root];
  while (walk.length) children.get(walk.pop()).forEach((c) => !reached.has(c) && (reached.add(c), walk.push(c)));
  ordered.forEach((r) => {
    if (reached.has(r.id)) return;
    children.get(root).push(r.id);
    reached.add(r.id);
    const below = [r.id];
    while (below.length) children.get(below.pop()).forEach((c) => !reached.has(c) && (reached.add(c), below.push(c)));
  });
  // Parents again, as the tree now is: one each, the first that reaches it.
  const tree = new Map(ids.map((id) => [id, []]));
  const seen = new Set([root]);
  const queue = [root];
  for (let at = 0; at < queue.length; at++) {
    const id = queue[at];
    tree.get(id).length = 0;
    children.get(id).forEach((c) => {
      if (seen.has(c)) return;
      seen.add(c);
      tree.get(id).push(c);
      queue.push(c);
    });
  }
  const up = new Map();
  tree.forEach((kids, id) => kids.forEach((c) => up.set(c, [id])));
  return { root, children: tree, parents: up };
}

export function spreadApart(cards, still, gap) {
  gap = gap === undefined ? canvasGap(TIDY_SIBLING_GAP) : gap;
  const pos = cards.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.width, h: r.height, fixed: still.has(r.id) }));
  for (let pass = 0; pass < 100; pass++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i];
        const b = pos[j];
        if (a.fixed && b.fixed) continue;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
        if (ox <= gap || oy <= gap) continue;
        moved = true;
        const alongX = ox < oy;
        const axis = alongX ? 'x' : 'y';
        const sign = (alongX ? a.x + a.w / 2 <= b.x + b.w / 2 : a.y + a.h / 2 <= b.y + b.h / 2) ? -1 : 1;
        const amount = alongX ? ox : oy;
        if (a.fixed) b[axis] -= sign * amount;
        else if (b.fixed) a[axis] += sign * amount;
        else {
          a[axis] += (sign * amount) / 2;
          b[axis] -= (sign * amount) / 2;
        }
      }
    }
    if (!moved) break;
  }
  const out = new Map();
  pos.forEach((p, i) => {
    if (Math.round(p.x) !== cards[i].x || Math.round(p.y) !== cards[i].y) out.set(p.id, { x: Math.round(p.x), y: Math.round(p.y) });
  });
  return out;
}

/** A branch's cards under it in reading order, each set in a step a level: [{ r, dx, dy }] from its corner, and the block's size. */
function outlineBlock(r, kids) {
  const items = [];
  let y = r.height + canvasGap(OUTLINE_GAP);
  let width = r.width;
  const walk = (id, depth) =>
    (kids.get(id) || []).forEach((c) => {
      const dx = depth * canvasGap(OUTLINE_INDENT);
      items.push({ r: c, dx, dy: y });
      width = Math.max(width, dx + c.width);
      y += c.height + canvasGap(OUTLINE_GAP);
      walk(c.id, depth + 1);
    });
  walk(r.id, 1);
  return { items, width, height: items.length ? y - canvasGap(OUTLINE_GAP) : r.height };
}

/**
 * A branch as an org chart: each card over its children, centred on
 * the row they make; children with none of their own stacked in a
 * column under it instead, to keep it narrow. id -> { x, y }; `marks`
 * says which are stacked.
 */
function orgPlaces(root, kids) {
  const out = new Map();
  out.sides = new Map();
  out.marks = new Map();
  const depthGap = canvasGap(TIDY_DEPTH_GAP);
  const gap = canvasGap(TIDY_SIBLING_GAP);
  // Each card's block: its size, and where it and those below sit in it.
  const measure = (r) => {
    const cs = kids.get(r.id) || [];
    if (!cs.length) return { w: r.width, h: r.height, at: [[r, 0, 0]] };
    if (r !== root && cs.every((c) => !(kids.get(c.id) || []).length)) {
      const b = outlineBlock(r, kids);
      return { w: b.width, h: b.height, at: [[r, 0, 0]].concat(b.items.map((it) => [it.r, it.dx, it.dy, true])) };
    }
    const subs = cs.map(measure);
    const row = subs.reduce((n, b) => n + b.w, 0) + gap * (subs.length - 1);
    // The card over the middle of its children's cards, the row moved along if it would stick out.
    const first = subs[0].at[0];
    const lastSub = subs[subs.length - 1].at[0];
    const over = (first[1] + first[0].width / 2 + row - subs[subs.length - 1].w + lastSub[1] + lastSub[0].width / 2) / 2 - r.width / 2;
    const shift = Math.max(0, -over);
    const w = Math.max(row + shift, over + shift + r.width);
    const at = [[r, over + shift, 0]];
    let x = shift;
    subs.forEach((b) => {
      b.at.forEach(([c, dx, dy, stacked]) => at.push([c, x + dx, r.height + depthGap + dy, stacked]));
      x += b.w + gap;
    });
    return { w, h: r.height + depthGap + Math.max(...subs.map((b) => b.h)), at };
  };
  const block = measure(root);
  const [, rx, ry] = block.at[0];
  block.at.slice(1).forEach(([c, dx, dy, stacked]) => {
    out.set(c.id, { x: Math.round(root.x + dx - rx), y: Math.round(root.y + dy - ry) });
    out.sides.set(c.id, stacked ? 'left' : 'bottom');
    if (stacked) out.marks.set(c.id, { stacked: true });
  });
  return out;
}

/**
 * A branch as a fishbone, or along a timeline: its children either side
 * of a line from it — leftward from a fishbone's head, rightward from a
 * timeline's start — in order, above and below in turn, each with its
 * own branch as an outline under it. id -> { x, y }; `marks` gives each
 * child where its bone leaves the line (`bone`) or that it hangs from
 * the line (`rib`).
 */
function linePlaces(root, kids, mode) {
  const out = new Map();
  out.sides = new Map();
  out.marks = new Map();
  out.both = true;
  const gap = canvasGap(TIDY_DEPTH_GAP);
  const step = canvasGap(TIDY_SIBLING_GAP) + 10;
  const line = root.y + root.height / 2;
  const left = mode === 'fishbone';
  // How far along each side is taken; each block a little further along than the one before, whichever side.
  const reach = [null, null];
  let last = left ? root.x : root.x + root.width;
  (kids.get(root.id) || []).forEach((c, i) => {
    const side = i % 2;
    const b = outlineBlock(c, kids);
    const room = left ? gap / 2 : gap / 3;
    let x;
    if (left) {
      const right = Math.min(last - step, reach[side] === null ? root.x - gap : reach[side] - gap);
      x = right - b.width - room;
      last = right;
      reach[side] = x;
    } else {
      x = Math.max(last + step, reach[side] === null ? root.x + root.width + gap : reach[side] + gap / 2);
      last = x;
      reach[side] = x + b.width;
    }
    const y = side === 0 ? line - gap / 2 - b.height : line + gap / 2;
    out.set(c.id, { x: Math.round(x), y: Math.round(y) });
    out.sides.set(c.id, left ? 'left' : 'right');
    out.marks.set(c.id, left ? { bone: Math.round(x + b.width + room / 2) } : { rib: true });
    b.items.forEach((it) => {
      out.set(it.r.id, { x: Math.round(x + it.dx), y: Math.round(y + it.dy) });
      out.sides.set(it.r.id, 'left');
    });
  });
  return out;
}

/** Where a branch's cards go for a shape only a mind map takes, for a tree already known: `kids` as directedPlaces. */
export function shapedPlaces(root, mode, kids) {
  return mode === 'org' ? orgPlaces(root, kids) : linePlaces(root, kids, mode);
}

/** Where a branch's cards go for a layout: id -> { x, y }. */
export function layoutPlaces(model, rootId, mode, links) {
  if (SHAPED_LAYOUTS.some((b) => b[0] === mode)) {
    const root = model.byId.get(rootId);
    if (!root) return Object.assign(new Map(), { sides: new Map(), marks: new Map() });
    return shapedPlaces(root, mode, orderedBranch(model, rootId, links || arrowLinks(model), siblingOrder));
  }
  if (mode === 'radial') return radialLayout(model, rootId, links);
  if (mode === 'outline') return outlineLayout(model, rootId, links);
  if (mode === 'concept') return conceptLayout(model, rootId, links);
  return directedLayout(model, rootId, mode, links);
}

/**
 * Where a tree's cards go by its layout, a branch with a layout of its
 * own laid out by itself first and then placed as one block, its cards
 * coming along: id -> { x, y }, with `sides` for the arrows and
 * `branches` — each branch laid out its own way: { rec, mode, ids }.
 * `layoutOf(rec)` names a card's own layout, or nothing.
 */
export function composedLayout(model, root, mode, links, layoutOf, depth) {
  const kids = orderedBranch(model, root.id, links, siblingOrder);
  // The nearest cards below with a layout of their own.
  const own = [];
  const queue = [root.id];
  while (queue.length) {
    (kids.get(queue.shift()) || []).forEach((c) => (layoutOf(c) && (depth || 0) < 20 ? own.push(c) : queue.push(c.id)));
  }
  if (!own.length) {
    const laid = layoutPlaces(model, root.id, mode, links);
    laid.branches = [];
    return laid;
  }
  const blocks = own.map((c) => {
    const sub = composedLayout(model, c, layoutOf(c), links, layoutOf, (depth || 0) + 1);
    const box = boundsOf([c].concat(Array.from(sub.keys()).map((id) => Object.assign({}, model.byId.get(id), sub.get(id)))));
    return { c, sub, box };
  });
  const blockOf = new Map(blocks.map((b) => [b.c.id, b]));
  const below = new Set();
  blocks.forEach((b) => b.sub.forEach((at, id) => below.add(id)));
  // Each such card as the box its branch makes, what's below it out of the way.
  const proxy = indexModel({
    nodes: model.nodes.map((r) => {
      const b = blockOf.get(r.id);
      if (b) return Object.assign({}, r, b.box);
      return below.has(r.id) ? Object.assign({}, r, { tuck: r.tuck || { by: root.id, dx: 0, dy: 0 } }) : r;
    }),
    edges: model.edges,
  });
  const laid = layoutPlaces(proxy, root.id, mode, links);
  const out = new Map();
  out.sides = new Map(laid.sides || []);
  out.marks = new Map(laid.marks || []);
  out.both = laid.both;
  out.branches = [];
  laid.forEach((at, id) => {
    const b = blockOf.get(id);
    if (!b) return out.set(id, at);
    const dx = at.x - b.box.x;
    const dy = at.y - b.box.y;
    out.set(id, { x: b.c.x + dx, y: b.c.y + dy });
    b.sub.forEach((p, sid) => out.set(sid, { x: p.x + dx, y: p.y + dy }));
    (b.sub.sides || new Map()).forEach((side, sid) => out.sides.set(sid, side));
    (b.sub.marks || new Map()).forEach((m, sid) => out.marks.set(sid, m.bone === undefined ? m : { bone: m.bone + dx }));
    out.branches.push({ rec: b.c, mode: layoutOf(b.c), ids: Array.from(b.sub.keys()), sides: b.sub.sides });
    b.sub.branches.forEach((x) => out.branches.push(x));
  });
  return out;
}
