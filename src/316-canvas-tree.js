/* ------------------------------------------------------------------ */
/* A canvas as a hierarchy                                             */
/*                                                                     */
/* Cards hang under cards by their arrows and sit inside groups; a     */
/* fold tucks some of them away into the card or group folded. All of  */
/* this works on the canvas as plain records — { id, type, x, y,       */
/* width, height, label, text, file, color, tuck, fold } and arrows    */
/* { from, to, fromSide, toSide, fromEnd, toEnd } — so it's the same   */
/* for a live canvas, its file and a test. Nothing here changes the    */
/* records unless it says so.                                          */
/* ------------------------------------------------------------------ */

/* Where a tucked card keeps what it's tucked into, and where it was beside it. */
const TUCK_KEY = 'drTuck';

/** A card's tuck — { by, dx, dy } — or null. */
function tuckOf(node) {
  const kept = node && node.unknownData && node.unknownData[TUCK_KEY];
  return kept && typeof kept.by === 'string' && typeof kept.dx === 'number' && typeof kept.dy === 'number' ? kept : null;
}

/** A canvas's cards and arrows as records, read from the live canvas. */
function canvasModel(canvas) {
  const nodes = [];
  const edges = [];
  try {
    canvas.nodes.forEach((node, key) => {
      let data = {};
      try {
        data = (typeof node.getData === 'function' && node.getData()) || {};
      } catch (err) {
        data = {};
      }
      nodes.push({
        id: node.id || key,
        type: data.type || 'text',
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        label: data.label,
        text: data.text,
        file: data.file,
        subpath: data.subpath,
        url: data.url,
        color: node.color !== undefined ? node.color : data.color,
        tuck: tuckOf(node),
        fold: foldOf(node),
        node,
      });
    });
  } catch (err) {
    /* no cards to be had */
  }
  try {
    canvas.edges.forEach((edge, key) => {
      const from = edge.from && edge.from.node;
      const to = edge.to && edge.to.node;
      if (!from || !to) return;
      edges.push({
        id: edge.id || key,
        from: from.id,
        to: to.id,
        fromSide: edge.from.side,
        toSide: edge.to.side,
        fromEnd: edge.from.end || 'none',
        toEnd: edge.to.end || 'arrow',
        edge,
      });
    });
  } catch (err) {
    /* no arrows to be had */
  }
  return indexModel({ nodes, edges });
}

/** The same, from what a canvas file holds. */
function modelFromData(data) {
  const nodes = ((data && data.nodes) || []).map((n) =>
    Object.assign({}, n, {
      tuck: n[TUCK_KEY] && typeof n[TUCK_KEY].by === 'string' ? n[TUCK_KEY] : null,
      fold: n[FOLD_KEY] && typeof n[FOLD_KEY].height === 'number' ? n[FOLD_KEY] : null,
    })
  );
  const edges = ((data && data.edges) || []).map((e) => ({
    id: e.id,
    from: e.fromNode,
    to: e.toNode,
    fromSide: e.fromSide,
    toSide: e.toSide,
    fromEnd: e.fromEnd || 'none',
    toEnd: e.toEnd || 'arrow',
  }));
  return indexModel({ nodes, edges });
}

function indexModel(model) {
  model.byId = new Map(model.nodes.map((n) => [n.id, n]));
  return model;
}

function isGroupRecord(rec) {
  return !!rec && rec.type === 'group';
}

/** The card or group a tucked card shows as: what it's tucked into, followed to one that's shown. */
function shownAs(model, rec) {
  let at = rec;
  const seen = new Set();
  while (at && at.tuck && !seen.has(at.id)) {
    seen.add(at.id);
    const next = model.byId.get(at.tuck.by);
    if (!next) return at;
    at = next;
  }
  return at;
}

/** Whether one box lies inside another; touching edges count. */
function withinRect(inner, outer) {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5
  );
}

/** The smallest box round some boxes, or null for none. */
function boundsOf(rects) {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Each shown card's innermost shown group, as Obsidian has it: a group
 * holds what lies wholly inside it. Two groups the same size: the one
 * further back holds the other. id -> group id, or null.
 */
function canvasHomes(model) {
  const shown = model.nodes.filter((n) => !n.tuck);
  const order = new Map(shown.map((n, i) => [n.id, i]));
  const groups = shown.filter(isGroupRecord);
  const homes = new Map();
  shown.forEach((n) => {
    let best = null;
    groups.forEach((g) => {
      if (g === n || !withinRect(n, g)) return;
      if (isGroupRecord(n) && withinRect(g, n) && order.get(g.id) > order.get(n.id)) return;
      if (!best || g.width * g.height < best.width * best.height) best = g;
    });
    homes.set(n.id, best ? best.id : null);
  });
  return homes;
}

/** Every card lying inside a group, at any depth. */
function groupContents(model, group, includeTucked) {
  return model.nodes.filter((n) => n !== group && (includeTucked || !n.tuck) && withinRect(n, group));
}

/**
 * Arrows as parent → child: the way the arrowhead points, or from → to
 * when it points both ways or neither. Groups take no part: they hold
 * cards by placing, not by arrows.
 */
function arrowLinks(model) {
  const children = new Map();
  const parents = new Map();
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    if (map.get(key).indexOf(value) === -1) map.get(key).push(value);
  };
  model.edges.forEach((e) => {
    const a = model.byId.get(e.from);
    const b = model.byId.get(e.to);
    if (!a || !b || a === b || isGroupRecord(a) || isGroupRecord(b)) return;
    const reversed = e.fromEnd === 'arrow' && e.toEnd !== 'arrow';
    const parent = reversed ? b : a;
    const child = reversed ? a : b;
    add(children, parent.id, child.id);
    add(parents, child.id, parent.id);
  });
  return { children, parents };
}

/** A card's shown children by its arrows. */
function shownChildren(model, links, id) {
  return (links.children.get(id) || []).map((c) => model.byId.get(c)).filter((c) => c && !c.tuck);
}

/**
 * The cards a card's branch fold tucks away: everything below it by its
 * arrows, but not a card that also hangs from a shown card outside the
 * branch — that one's still reached another way. Ids, in reach order.
 */
function branchOf(model, rootId, links) {
  links = links || arrowLinks(model);
  const found = [];
  const set = new Set();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift();
    (links.children.get(id) || []).forEach((c) => {
      const rec = model.byId.get(c);
      if (!rec || rec.tuck || c === rootId || set.has(c)) return;
      set.add(c);
      found.push(c);
      queue.push(c);
    });
  }
  let changed = true;
  while (changed) {
    changed = false;
    found.forEach((id) => {
      if (!set.has(id)) return;
      const elsewhere = (links.parents.get(id) || []).some((p) => {
        const rec = model.byId.get(p);
        return p !== rootId && !set.has(p) && rec && !rec.tuck;
      });
      if (elsewhere) {
        set.delete(id);
        changed = true;
      }
    });
  }
  return found.filter((id) => set.has(id));
}

const BRANCH_SIDES = ['bottom', 'right', 'top', 'left'];

/**
 * The side each card's branch grows from: where its arrows to its
 * children leave it, by most of them — or, with no sides to go on, the
 * way its children lie. id -> side, for every card with children.
 */
function branchSides(model, links) {
  links = links || arrowLinks(model);
  const votes = new Map();
  model.edges.forEach((e) => {
    const reversed = e.fromEnd === 'arrow' && e.toEnd !== 'arrow';
    const parent = reversed ? e.to : e.from;
    const child = reversed ? e.from : e.to;
    const side = reversed ? e.toSide : e.fromSide;
    if (BRANCH_SIDES.indexOf(side) === -1 || (links.children.get(parent) || []).indexOf(child) === -1) return;
    if (!votes.has(parent)) votes.set(parent, { bottom: 0, right: 0, top: 0, left: 0 });
    votes.get(parent)[side]++;
  });
  const out = new Map();
  links.children.forEach((kids, id) => {
    const v = votes.get(id);
    const best = v ? BRANCH_SIDES.slice().sort((a, b) => v[b] - v[a])[0] : null;
    out.set(id, best && v[best] ? best : childrenLie(model, id, kids));
  });
  return out;
}

/** The side of a card its children lie on, taken together. */
function childrenLie(model, id, kids) {
  const root = model.byId.get(id);
  const shown = kids.map((k) => model.byId.get(k)).filter(Boolean);
  if (!root || !shown.length) return 'right';
  const cx = (r) => r.x + r.width / 2;
  const cy = (r) => r.y + r.height / 2;
  const dx = shown.reduce((s, k) => s + cx(k) - cx(root), 0);
  const dy = shown.reduce((s, k) => s + cy(k) - cy(root), 0);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** The side one card's branch grows from. */
function branchSide(model, rootId, links) {
  return branchSides(model, links).get(rootId) || 'right';
}

/** For a side a branch grows from: the axis it grows along, and the one its siblings line up on. */
function sideAxes(side) {
  const vertical = side === 'bottom' || side === 'top';
  return { depth: vertical ? 'y' : 'x', across: vertical ? 'x' : 'y', forward: side === 'bottom' || side === 'right' };
}

/* -- tidying a branch ------------------------------------------------- */

const TIDY_DEPTH_GAP = 80;
const TIDY_SIBLING_GAP = 30;

/**
 * A branch laid out as a tree, growing from the side its arrows leave:
 * each card's children in a row beyond it, in the order they're in now,
 * centred on it, with room for their own children. The card itself stays
 * where it is. Only the cards its fold would take are moved — one that
 * also hangs from elsewhere is left be. id -> { x, y }.
 */
function tidyBranch(model, rootId, side, links) {
  links = links || arrowLinks(model);
  const root = model.byId.get(rootId);
  const out = new Map();
  if (!root) return out;
  const mine = new Set(branchOf(model, rootId, links));
  const vertical = side === 'bottom' || side === 'top';
  const breadth = (n) => (vertical ? n.width : n.height);
  const middle = (n) => (vertical ? n.x + n.width / 2 : n.y + n.height / 2);
  const kids = new Map();
  const seen = new Set([rootId]);
  const queue = [root];
  while (queue.length) {
    const n = queue.shift();
    const cs = shownChildren(model, links, n.id).filter((c) => mine.has(c.id) && !seen.has(c.id));
    cs.sort((a, b) => middle(a) - middle(b));
    cs.forEach((c) => seen.add(c.id));
    kids.set(n.id, cs);
    cs.forEach((c) => queue.push(c));
  }
  const room = new Map();
  const measure = (n) => {
    const cs = kids.get(n.id) || [];
    const sum = cs.reduce((s, c, i) => s + measure(c) + (i ? TIDY_SIBLING_GAP : 0), 0);
    const r = Math.max(breadth(n), sum);
    room.set(n.id, r);
    return r;
  };
  measure(root);
  const place = (n, nx, ny) => {
    const cs = kids.get(n.id) || [];
    if (!cs.length) return;
    const total = cs.reduce((s, c, i) => s + room.get(c.id) + (i ? TIDY_SIBLING_GAP : 0), 0);
    let start = (vertical ? nx + n.width / 2 : ny + n.height / 2) - total / 2;
    cs.forEach((c) => {
      const across = start + (room.get(c.id) - breadth(c)) / 2;
      let cx;
      let cy;
      if (side === 'bottom') {
        cx = across;
        cy = ny + n.height + TIDY_DEPTH_GAP;
      } else if (side === 'top') {
        cx = across;
        cy = ny - TIDY_DEPTH_GAP - c.height;
      } else if (side === 'right') {
        cx = nx + n.width + TIDY_DEPTH_GAP;
        cy = across;
      } else {
        cx = nx - TIDY_DEPTH_GAP - c.width;
        cy = across;
      }
      cx = Math.round(cx);
      cy = Math.round(cy);
      out.set(c.id, { x: cx, y: cy });
      place(c, cx, cy);
      start += room.get(c.id) + TIDY_SIBLING_GAP;
    });
  };
  place(root, root.x, root.y);
  return out;
}

/* -- the outline ------------------------------------------------------- */

/** What a card is called in the outline: a group's label, a note's name, a text card's first line. */
function canvasCardLabel(rec) {
  if (!rec) return '';
  if (rec.type === 'group') return String(rec.label || '').trim() || 'Untitled group';
  if (rec.type === 'file') {
    const name = String(rec.file || '').split('/').pop().replace(/\.md$/i, '');
    return (name || 'File') + (rec.subpath ? ` › ${String(rec.subpath).replace(/^#+/, '')}` : '');
  }
  if (rec.type === 'link') return String(rec.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || 'Link';
  const line = markdownLines(rec.text)[0] || '';
  const plain = plainMarkdownLine(line);
  return plain.length > 120 ? plain.slice(0, 119) + '…' : plain || 'Empty card';
}

/** Markdown's lines that hold something, its front matter left out. */
function markdownLines(text) {
  return String(text || '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l);
}

/** One line of markdown as the words it shows: no marks, links as their text. */
function plainMarkdownLine(line) {
  return String(line || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s*(\[![^\]]*\][+-]?\s*)?/, '')
    .replace(/^[-*+]\s+(\[.\]\s+)?/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~=]/g, '')
    .trim();
}

/**
 * The canvas as a tree, for the outline: groups hold what's inside them,
 * and a card holds the cards its arrows lead to in the same group. Only
 * shown cards are in it; a fold says how many it has tucked away.
 * [{ id, type, label, color, folded, count, children }], in reading order.
 */
function outlineTree(model, links) {
  links = links || arrowLinks(model);
  const shown = model.nodes.filter((n) => !n.tuck);
  const homes = canvasHomes(model);
  const reading = (a, b) => a.y - b.y || a.x - b.x;
  const tucked = new Map();
  model.nodes.forEach((n) => {
    if (n.tuck) tucked.set(n.tuck.by, (tucked.get(n.tuck.by) || 0) + 1);
  });
  // A card's place is under a shown parent in the same group — not one
  // whose branch is folded, which shows it closed though this card's
  // still out, reached another way.
  const parentOf = new Map();
  shown.forEach((n) => {
    if (isGroupRecord(n)) return;
    const ps = (links.parents.get(n.id) || [])
      .map((p) => model.byId.get(p))
      .filter((p) => p && !p.tuck && !isGroupRecord(p) && !tucked.get(p.id) && homes.get(p.id) === homes.get(n.id))
      .sort(reading);
    if (ps.length) parentOf.set(n.id, ps[0].id);
  });
  const below = (pick) => shown.filter(pick).sort(reading);
  const placed = new Set();
  const item = (n) => {
    placed.add(n.id);
    const count = tucked.get(n.id) || 0;
    const under = isGroupRecord(n)
      ? below((c) => homes.get(c.id) === n.id && !parentOf.has(c.id))
      : below((c) => parentOf.get(c.id) === n.id);
    return {
      id: n.id,
      type: n.type,
      label: canvasCardLabel(n),
      color: n.color,
      folded: isGroupRecord(n) ? !!n.fold : count > 0,
      count,
      children: under.filter((c) => !placed.has(c.id)).map(item),
    };
  };
  const tree = below((n) => homes.get(n.id) === null && !parentOf.has(n.id)).map(item);
  // Cards whose arrows only go round in a circle: the first of each, at the top of its group.
  let rest = shown.filter((n) => !placed.has(n.id)).sort(reading);
  while (rest.length) {
    const first = rest[0];
    parentOf.delete(first.id);
    const home = homes.get(first.id);
    const holder = home ? findOutlineItem(tree, home) : null;
    if (holder) holder.children.push(item(first));
    else tree.push(item(first));
    rest = rest.filter((n) => !placed.has(n.id));
  }
  return tree;
}

function findOutlineItem(items, id) {
  for (const it of items) {
    if (it.id === id) return it;
    const found = findOutlineItem(it.children, id);
    if (found) return found;
  }
  return null;
}
