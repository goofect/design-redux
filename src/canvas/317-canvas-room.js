/* ------------------------------------------------------------------ */
/* Folds, and the room they leave                                      */
/*                                                                     */
/* Folding a branch and unfolding it — and opening a card or group     */
/* folded by an earlier version — as changes to a canvas's records:    */
/* then the cards beyond close up the room it left, or move back out   */
/* of the way of the room it takes, and the groups they're in keep the */
/* margin they had round their cards. The changes are made to the     */
/* records; `applyCanvasModel` puts them on the live canvas.           */
/*                                                                     */
/* A tucked card keeps its own place in the file — it's only drawn as  */
/* though it were the fold — and where it sits beside what it's tucked */
/* into, so it comes back there even after that's been moved. A fold   */
/* notes what it moved, and by how much, and unfolding moves exactly   */
/* that back: moves add up, so whatever order branches are folded and  */
/* opened in, opening them all leaves the canvas as it was. Closing    */
/* up, nothing is run into: what's in the way comes along, or the gap  */
/* closes only as far as it can.                                       */
/* ------------------------------------------------------------------ */

import { cardMovable, keepOnCard, placeCard } from '../core/079-canvas-adapter.js';
import { arrowLinks, boundsOf, branchOf, branchSide, canvasGap, canvasHomes, foldableBranch, groupContents, indexModel, isGroupRecord, ROOM_KEY, sideAxes, TIDY_SIBLING_GAP, tidyBranch, TUCK_KEY, withinRect } from './316-canvas-tree.js';
import { FOLD_KEY } from './335-canvas-fold.js';

/** Each record's place and whether it's tucked, to compare with later. */
export function snapshotModel(model) {
  const snap = new Map();
  model.nodes.forEach((n) => {
    snap.set(n.id, {
      id: n.id,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      tucked: !!n.tuck,
      tuck: n.tuck ? JSON.stringify(n.tuck) : '',
      fold: n.fold ? JSON.stringify(n.fold) : '',
      room: n.room ? JSON.stringify(n.room) : '',
    });
  });
  return snap;
}

export function axisParts(axis) {
  const cross = axis === 'y' ? 'x' : 'y';
  const size = axis === 'y' ? 'height' : 'width';
  const crossSize = axis === 'y' ? 'width' : 'height';
  return {
    near: (r) => r[axis],
    far: (r) => r[axis] + r[size],
    lo: (r) => r[cross],
    hi: (r) => r[cross] + r[crossSize],
    size,
  };
}

/**
 * A record and what moves with it: a group's contents, and whatever is
 * tucked into any of them — a tucked card only ever moves with its fold.
 * `alone`: not what lies in a group, only what's tucked into it — for a
 * group coming out of a fold, whose own cards come out with it.
 */
export function carriedBy(model, rec, alone) {
  const carried = [rec];
  if (isGroupRecord(rec) && !alone) groupContents(model, rec, false).forEach((n) => carried.push(n));
  for (let i = 0; i < carried.length; i++) {
    const id = carried[i].id;
    model.nodes.forEach((n) => {
      if (n.tuck && n.tuck.by === id && carried.indexOf(n) === -1) carried.push(n);
    });
  }
  return carried;
}

/** Move a record, and what moves with it. */
export function shiftRecord(model, rec, axis, delta, moved, alone) {
  carriedBy(model, rec, alone).forEach((n) => {
    if (moved.has(n.id)) return;
    moved.add(n.id);
    n[axis] += delta;
  });
}

/* Closing up: how near a card may come to one that stays put. */
export const CLOSE_KEEP = 20;

/** Where a tucked card would come out: beside its fold, as it sits now. */
export function outBox(model, n, depth) {
  const by = n.tuck && (depth || 0) < 50 ? model.byId.get(n.tuck.by) : null;
  if (!by) return n;
  const at = outBox(model, by, (depth || 0) + 1);
  return { x: at.x + n.tuck.dx, y: at.y + n.tuck.dy, width: n.width, height: n.height };
}

/**
 * Whether a tucked card was folded away elsewhere already: tucked, as
 * every fold it's in was, before this change, and not into one of
 * `ids` — what the change is about — at any depth.
 */
export function foldedElsewhere(model, before, n, ids) {
  const seen = new Set();
  let at = n;
  while (at && at.tuck && !seen.has(at.id)) {
    seen.add(at.id);
    const was = before.get(at.id);
    if (!was || !was.tucked || ids.has(at.tuck.by)) return false;
    at = model.byId.get(at.tuck.by);
  }
  return true;
}

/**
 * How far cards closing up may go — `room`, at most — without running
 * into, or coming nearer than CLOSE_KEEP to, what stays put across from
 * one of them on the way: a card or group, or where a card folded away
 * elsewhere would come out again.
 */
export function closeLimit(model, before, moving, room, side, p, origin) {
  const carried = new Set();
  moving.forEach((n) => carriedBy(model, n).forEach((c) => carried.add(c)));
  const going = Array.from(carried).filter((c) => !c.tuck);
  const still = [];
  model.nodes.forEach((n) => {
    if (carried.has(n) || origin.has(n.id)) return;
    if (!n.tuck) still.push(n);
    else if (foldedElsewhere(model, before, n, origin)) still.push(outBox(model, n));
  });
  going.forEach((m) => {
    still.forEach((s) => {
      // A group it's inside isn't in its way.
      if (s.type === 'group' && withinRect(m, s)) return;
      if (Math.min(p.hi(s), p.hi(m)) - Math.max(p.lo(s), p.lo(m)) <= 1) return;
      const gap = side === 'after' ? p.near(m) - p.far(s) : p.near(s) - p.far(m);
      // Not on its way: beyond it, or already over it.
      if (gap < -1) return;
      room = Math.min(room, Math.max(0, gap - canvasGap(CLOSE_KEEP)));
    });
  });
  return room;
}

/**
 * Room made or given back along one axis. The cards beyond `at` — in
 * the same group as what changed, overlapping `span` across the axis,
 * or beyond one of those and overlapping it, or led to by one's arrows
 * — move by `delta`. Cards off to the side stay put. Then the group they're
 * in keeps the margin it had round its cards, and any change that
 * makes to its size makes room beyond it, in its own group, in turn.
 *
 * change: { origin: Set of the ids that changed, home: their group's id
 * or null, axis: 'x' | 'y', side: 'after' | 'before', at, delta, span:
 * [lo, hi] }. `before` is the snapshot from before anything changed.
 */
export function makeRoom(model, before, change) {
  const { axis, side } = change;
  let delta = change.delta;
  if (!delta || Math.abs(delta) < 0.5) return;
  const p = axisParts(axis);
  const homes = homesBefore(model, before);
  const eps = 1;
  const closing = side === 'after' ? delta < 0 : delta > 0;
  const beyond = (n) => (side === 'after' ? p.near(n) >= change.at - eps : p.far(n) <= change.at + eps);
  const candidates = model.nodes
    .filter((n) => !n.tuck && !change.origin.has(n.id) && homes.get(n.id) === change.home && beyond(n))
    .sort((a, b) => (side === 'after' ? p.near(a) - p.near(b) : p.far(b) - p.far(a)));
  // What's in line with the change, what sits beyond something moving
  // in line with it, and what a moving card's arrows lead to — until
  // nothing more is taken along.
  const links = arrowLinks(model);
  const across = (n, lo, hi) => Math.min(p.hi(n), hi) - Math.max(p.lo(n), lo) > eps;
  const behind = (n, m) => (side === 'after' ? p.near(n) >= p.far(m) - eps : p.far(n) <= p.near(m) + eps);
  // Closing up, a card a moving one would run into on its way comes along.
  const inPath = (n, m) =>
    closing &&
    across(n, p.lo(m), p.hi(m)) &&
    (side === 'after'
      ? p.near(n) < p.near(m) && p.far(n) > p.near(m) + delta - canvasGap(CLOSE_KEEP)
      : p.far(n) > p.far(m) && p.near(n) < p.far(m) + delta + canvasGap(CLOSE_KEEP));
  const moving = [];
  const taken = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    candidates.forEach((n) => {
      if (taken.has(n.id)) return;
      const inLine = across(n, change.span[0], change.span[1]);
      const beyondMoving = !inLine && moving.some((m) => across(n, p.lo(m), p.hi(m)) && behind(n, m));
      const carried = !inLine && !beyondMoving && (links.parents.get(n.id) || []).some((id) => taken.has(id));
      const inWay = !inLine && !beyondMoving && !carried && moving.some((m) => inPath(n, m));
      if (!inLine && !beyondMoving && !carried && !inWay) return;
      taken.add(n.id);
      moving.push(n);
      grew = true;
    });
  }
  // As far as what stays put lets it.
  if (closing && moving.length) delta = Math.sign(delta) * closeLimit(model, before, moving, Math.abs(delta), side, p, change.origin);
  const moved = new Set();
  if (delta) moving.forEach((n) => shiftRecord(model, n, axis, delta, moved));

  // The group they're in: the same margin round its cards as before.
  const group = change.home ? model.byId.get(change.home) : null;
  const was = group ? before.get(group.id) : null;
  if (!group || !was) return;
  const wasIn = Array.from(before.values()).filter((r) => r.id !== group.id && !r.tucked && withinRect(r, was));
  const nowIn = model.nodes.filter((n) => n !== group && !n.tuck && withinRect(n, group));
  // Cards that changed may have left the group's bounds as it stands: they're still in it.
  change.origin.forEach((id) => {
    const rec = model.byId.get(id);
    const prior = before.get(id);
    if (rec && !rec.tuck && prior && withinRect(prior, was) && nowIn.indexOf(rec) === -1) nowIn.push(rec);
  });
  moving.forEach((rec) => {
    if (nowIn.indexOf(rec) === -1) nowIn.push(rec);
  });
  if (!wasIn.length || !nowIn.length) return;
  const oldNear = p.near(group);
  const oldFar = p.far(group);
  let newNear = oldNear;
  let newFar = oldFar;
  if (side === 'after') {
    const b = Math.max(...wasIn.map(p.far));
    const a = Math.max(...nowIn.map(p.far));
    if (Math.abs(a - b) > 0.5) newFar = a + (p.far(was) - b);
  } else {
    const b = Math.min(...wasIn.map(p.near));
    const a = Math.min(...nowIn.map(p.near));
    if (Math.abs(a - b) > 0.5) newNear = a - (b - p.near(was));
  }
  if (newNear === oldNear && newFar === oldFar) return;
  const home = homes.get(group.id) || null;
  group[axis] = newNear;
  group[p.size] = newFar - newNear;
  const span = [p.lo(group), p.hi(group)];
  if (newFar !== oldFar) {
    makeRoom(model, before, { origin: new Set([group.id]), home, axis, side: 'after', at: oldFar, delta: newFar - oldFar, span });
  }
  if (newNear !== oldNear) {
    makeRoom(model, before, { origin: new Set([group.id]), home, axis, side: 'before', at: oldNear, delta: newNear - oldNear, span });
  }
}

/** A record's group, as the canvas stands. */
export function homeIn(model, id) {
  return canvasHomes(model).get(id) || null;
}

/**
 * Every card's group as the canvas stood before the change: a group
 * just opened out doesn't take in the cards it's about to push aside,
 * and a card pushed out of its group's bounds is still in it.
 */
export function homesBefore(model, before) {
  const nodes = [];
  model.nodes.forEach((n) => {
    const was = before.get(n.id);
    if (was) nodes.push({ id: n.id, type: n.type, x: was.x, y: was.y, width: was.width, height: was.height, tuck: was.tucked ? {} : null });
  });
  return canvasHomes(indexModel({ nodes, edges: [] }));
}

/* -- folds an earlier version made of cards and groups ---------------- */

/**
 * A card or group an earlier version folded, back to the size it was —
 * a group's contents back where they were in it — and room made below.
 * A card's own fold and its branch's are two things: opening the card
 * leaves its branch folded.
 */
export function unfoldRecord(model, rec, close) {
  if (!rec || !rec.fold) return false;
  const before = snapshotModel(model);
  const home = homeIn(model, rec.id);
  const old = rec.height;
  const height = Math.max(rec.fold.height, rec.height);
  rec.fold = null;
  rec.height = height;
  const back = isGroupRecord(rec) ? untuckFrom(model, rec) : [];
  if (close) {
    makeRoom(model, before, {
      origin: new Set([rec.id].concat(back.map((n) => n.id))),
      home,
      axis: 'y',
      side: 'after',
      at: rec.y + old,
      delta: height - old,
      span: [rec.x, rec.x + rec.width],
    });
  }
  return true;
}

/** What's tucked into a record, back beside it where it was. */
export function untuckFrom(model, rec) {
  const back = model.nodes.filter((n) => n.tuck && n.tuck.by === rec.id);
  back.forEach((n) => {
    // Whatever is tucked into this one stays with it.
    const dx = rec.x + n.tuck.dx - n.x;
    const dy = rec.y + n.tuck.dy - n.y;
    n.tuck = null;
    const moved = new Set();
    if (dx) shiftRecord(model, n, 'x', dx, moved, true);
    moved.clear();
    if (dy) shiftRecord(model, n, 'y', dy, moved, true);
  });
  return back;
}

/* -- folding branches -------------------------------------------------- */

/**
 * The room a branch's cards took — the card's own box and theirs — closed
 * up or made again across the way its siblings line up: siblings beyond
 * it move in, or back out.
 */
export function branchRoom(model, before, rec, ids, side, home, folding) {
  const { across } = sideAxes(side);
  const p = axisParts(across);
  const own = { x: rec.x, y: rec.y, width: rec.width, height: rec.height };
  const cards = ids.map((id) => (folding ? before.get(id) : model.byId.get(id))).filter(Boolean);
  const whole = boundsOf([own].concat(cards));
  const origin = new Set([rec.id].concat(ids));
  const span = [p.lo(whole), p.hi(whole)];
  const farGap = p.far(whole) - p.far(own);
  const nearGap = p.near(own) - p.near(whole);
  if (farGap > 0.5) {
    makeRoom(model, before, {
      origin,
      home,
      axis: across,
      side: 'after',
      at: folding ? p.far(whole) : p.far(own),
      delta: folding ? -farGap : farGap,
      span,
    });
  }
  if (nearGap > 0.5) {
    makeRoom(model, before, {
      origin,
      home,
      axis: across,
      side: 'before',
      at: folding ? p.near(whole) : p.near(own),
      delta: folding ? nearGap : -nearGap,
      span,
    });
  }
}

/**
 * The groups holding nothing but cards of a branch being folded — or
 * such groups — innermost first: they fold away with it. Ids.
 */
export function groupsWithin(model, ids) {
  const going = new Set(ids);
  const out = [];
  model.nodes
    .filter((g) => isGroupRecord(g) && !g.tuck && !going.has(g.id))
    .sort((a, b) => a.width * a.height - b.width * b.height)
    .forEach((g) => {
      const inside = model.nodes.filter((n) => n !== g && !n.tuck && withinRect(n, g));
      if (inside.length && inside.every((n) => going.has(n.id))) {
        going.add(g.id);
        out.push(g.id);
      }
    });
  return out;
}

/**
 * A card's branch tucked into it — stopping at master cards — with the
 * groups that hold nothing else, and, if `close`, the room it took
 * closed up and the groups round it fitted; what that moved is noted on
 * the card. The tucked ids, or [].
 */
export function foldBranch(model, rec, close, links) {
  if (!rec || rec.tuck) return [];
  links = links || arrowLinks(model);
  const cards = foldableBranch(model, rec.id, links);
  if (!cards.length) return [];
  const ids = cards.concat(groupsWithin(model, cards));
  const side = branchSide(model, rec.id, links);
  const before = snapshotModel(model);
  const home = homeIn(model, rec.id);
  ids.forEach((id) => {
    const n = model.byId.get(id);
    n.tuck = { by: rec.id, dx: n.x - rec.x, dy: n.y - rec.y };
  });
  if (close) {
    branchRoom(model, before, rec, ids, side, home, true);
    fitGroups(model, before);
  }
  // Noted even when nothing moved: so nothing's moved back.
  rec.room = addRoom(rec.room || {}, roomMoved(model, before, new Set(ids)));
  return ids;
}

/**
 * A card's branch back out beside it. What its fold moved goes back as
 * it was; a fold that noted nothing — an earlier version's — makes room
 * the way it would have closed it, if `close`. The ids brought back.
 */
export function unfoldBranch(model, rec, close, links) {
  if (!rec) return [];
  const tucked = model.nodes.filter((n) => n.tuck && n.tuck.by === rec.id);
  if (!tucked.length) return [];
  const before = snapshotModel(model);
  const home = homeIn(model, rec.id);
  const back = untuckFrom(model, rec);
  const ids = back.map((n) => n.id);
  links = links || arrowLinks(model);
  if (rec.room) {
    giveRoomBack(model, rec.room);
    rec.room = null;
  } else if (close) {
    branchRoom(model, before, rec, ids, branchSide(model, rec.id, links), home, false);
    fitGroups(model, before);
  }
  return ids;
}

/** What moved since the snapshot, but `skip`: id -> [dx, dy, dw, dh], or null for nothing. */
export function roomMoved(model, before, skip) {
  const room = {};
  let any = false;
  model.nodes.forEach((n) => {
    const was = before.get(n.id);
    if (!was || (skip && skip.has(n.id))) return;
    const d = [n.x - was.x, n.y - was.y, n.width - was.width, n.height - was.height];
    if (d.some((v) => Math.abs(v) > 0.001)) {
      room[n.id] = d;
      any = true;
    }
  });
  return any ? room : null;
}

/** Two notes of what moved, as one. */
export function addRoom(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = {};
  Object.keys(a).forEach((id) => (out[id] = a[id].slice()));
  Object.keys(b).forEach((id) => {
    out[id] = out[id] ? out[id].map((v, i) => v + b[id][i]) : b[id].slice();
  });
  return out;
}

/**
 * What a fold moved, moved back. A card tucked away since keeps its
 * place beside its fold, and that place changes as either of them moves
 * back — so it comes out where it would have been had it been out.
 */
export function giveRoomBack(model, room) {
  const ids = Object.keys(room || {});
  ids.forEach((id) => {
    const n = model.byId.get(id);
    if (!n) return;
    const d = room[id];
    n.x -= d[0];
    n.y -= d[1];
    n.width = Math.max(1, n.width - d[2]);
    n.height = Math.max(1, n.height - d[3]);
  });
  const none = [0, 0, 0, 0];
  model.nodes.forEach((n) => {
    if (!n.tuck || (!room[n.id] && !room[n.tuck.by])) return;
    const d = room[n.id] || none;
    const h = room[n.tuck.by] || none;
    n.tuck = Object.assign({}, n.tuck, { dx: n.tuck.dx - d[0] + h[0], dy: n.tuck.dy - d[1] + h[1] });
  });
}

/** How many cards are tucked into a record. */
export function tuckedCount(model, id) {
  return model.nodes.filter((n) => n.tuck && n.tuck.by === id).length;
}

/* -- groups round what they hold ---------------------------------------- */

/**
 * Each record's group, for fitting groups after folds: as it was before
 * them for what was shown then; and for what was tucked away then, the
 * group of what it was tucked into — or that group itself — so a card
 * brought out of a fold belongs where its fold does, wherever it lands.
 */
export function foldHomes(model, before) {
  const shown = homesBefore(model, before);
  const memo = new Map();
  const homeOf = (id, seen) => {
    if (memo.has(id)) return memo.get(id);
    const was = before.get(id);
    let home = null;
    if (was && !was.tucked) home = shown.get(id) || null;
    else if (was && !seen.has(id)) {
      seen.add(id);
      let by = null;
      try {
        by = JSON.parse(was.tuck).by;
      } catch (err) {
        by = null;
      }
      const holder = by ? model.byId.get(by) : null;
      if (holder) home = isGroupRecord(holder) ? holder.id : homeOf(holder.id, seen);
    }
    memo.set(id, home);
    return home;
  };
  return (id) => homeOf(id, new Set());
}

/**
 * Every open group fitted round what it holds after folds and unfolds:
 * the margin it had round its cards before, on every side, kept — so a
 * branch folded down or across inside a group gives the group's room
 * back, and takes it again when it opens. Innermost
 * groups first; each one that changes size makes room beyond it, or
 * gives it back, in the group it's in.
 */
export function fitGroups(model, before) {
  const homeOf = foldHomes(model, before);
  const groups = model.nodes
    .filter((g) => {
      const was = before.get(g.id);
      // Open before and now: a group an earlier version folded is sized by its fold.
      return isGroupRecord(g) && !g.tuck && !g.fold && was && !was.tucked && !was.fold;
    })
    .sort((a, b) => {
      const wa = before.get(a.id);
      const wb = before.get(b.id);
      return wa.width * wa.height - wb.width * wb.height;
    });
  let changed = false;
  groups.forEach((g) => {
    const members = model.nodes.filter((n) => n !== g && homeOf(n.id) === g.id);
    const was = members.map((n) => before.get(n.id)).filter((r) => r && !r.tucked);
    const now = members.filter((n) => !n.tuck);
    if (!was.length || !now.length) return;
    const box = before.get(g.id);
    const home = homeOf(g.id);
    ['y', 'x'].forEach((axis) => {
      const p = axisParts(axis);
      const farWas = Math.max(...was.map(p.far));
      const nearWas = Math.min(...was.map(p.near));
      const targetFar = Math.max(...now.map(p.far)) + (p.far(box) - farWas);
      const targetNear = Math.min(...now.map(p.near)) - (nearWas - p.near(box));
      const oldNear = p.near(g);
      const oldFar = p.far(g);
      const newFar = Math.abs(targetFar - oldFar) > 0.5 ? targetFar : oldFar;
      const newNear = Math.abs(targetNear - oldNear) > 0.5 ? targetNear : oldNear;
      if (newFar === oldFar && newNear === oldNear) return;
      g[axis] = newNear;
      g[p.size] = newFar - newNear;
      changed = true;
      const span = [p.lo(g), p.hi(g)];
      if (newFar !== oldFar) {
        makeRoom(model, before, { origin: new Set([g.id]), home, axis, side: 'after', at: oldFar, delta: newFar - oldFar, span });
      }
      if (newNear !== oldNear) {
        makeRoom(model, before, { origin: new Set([g.id]), home, axis, side: 'before', at: oldNear, delta: newNear - oldNear, span });
      }
    });
  });
  return changed;
}

/* -- tidying ----------------------------------------------------------- */

/**
 * A branch tidied into a tree, and the cards round it kept as far from
 * it as they were: the room it takes across, and beyond its deepest
 * cards, made or given back — both ways, for a tree growing both ways.
 * Cards caught where the tree now lies move out of its way, and the
 * groups its cards are in fit round them again. Returns whether
 * anything moved.
 */
export function tidyRecords(model, rec, close, links) {
  links = links || arrowLinks(model);
  const side = branchSide(model, rec.id, links);
  return placeBranch(model, rec, tidyBranch(model, rec.id, side, links), sideAxes(side), close);
}

/**
 * A branch's cards moved to `places` (id -> { x, y }), what they carry
 * with them, and — `close` — the cards round it kept as far from it as
 * they were; any caught where it now lies moved out of its way. `axes`
 * as sideAxes gives them, `both` for a branch growing more than one way.
 */
export function placeBranch(model, rec, places, axes, close) {
  // A card kept in place stays, and what hangs from it with it.
  const kept = new Set();
  const links = arrowLinks(model);
  places.forEach((at, id) => {
    const n = model.byId.get(id);
    if (!n || !n.pinned) return;
    kept.add(id);
    branchOf(model, id, links).forEach((x) => kept.add(x));
  });
  if (kept.size) {
    const free = new Map(Array.from(places.entries()).filter(([id]) => !kept.has(id)));
    free.sides = places.sides;
    free.both = places.both;
    places = free;
  }
  if (!places.size) return false;
  const before = snapshotModel(model);
  const home = homeIn(model, rec.id);
  const ids = Array.from(places.keys());
  const own = { x: rec.x, y: rec.y, width: rec.width, height: rec.height };
  const was = boundsOf([own].concat(ids.map((id) => before.get(id))));
  let changed = false;
  places.forEach((at, id) => {
    const n = model.byId.get(id);
    const moved = new Set();
    if (n.x !== at.x) {
      shiftRecord(model, n, 'x', at.x - n.x, moved);
      changed = true;
    }
    moved.clear();
    if (n.y !== at.y) {
      shiftRecord(model, n, 'y', at.y - n.y, moved);
      changed = true;
    }
  });
  if (!changed) return changed;
  // What's kept in place is still the tree's: never moved out of its way.
  const tree = ids.concat(Array.from(kept));
  const origin = new Set([rec.id].concat(tree));
  axes = Object.assign({}, axes, { both: !!(axes.both || places.both) });
  if (close) {
    const now = boundsOf([own].concat(ids.map((id) => model.byId.get(id))));
    roomAroundTidy(model, before, { origin, home, axes, was, now });
  }
  moveStrays(model, before, rec, tree, axes, home);
  if (close) fitGroups(model, before);
  return true;
}

/** The cards round a tidied branch kept as far from it as they were. */
export function roomAroundTidy(model, before, { origin, home, axes, was, now }) {
  [axes.across, axes.depth].forEach((axis) => {
    const p = axisParts(axis);
    const span = [Math.min(p.lo(was), p.lo(now)), Math.max(p.hi(was), p.hi(now))];
    const deep = axis === axes.depth && !axes.both;
    if (!deep || axes.forward) {
      makeRoom(model, before, { origin, home, axis, side: 'after', at: p.far(was), delta: p.far(now) - p.far(was), span });
    }
    if (!deep || !axes.forward) {
      makeRoom(model, before, { origin, home, axis, side: 'before', at: p.near(was), delta: p.near(now) - p.near(was), span });
    }
  });
}

/**
 * Cards caught where the tree now lies, that aren't part of it: moved
 * out beyond its deepest cards on their side of the root, one after
 * another, where they're in nobody's way. A group caught there moves
 * with all it holds; one holding any of the tree stays, and fits round it.
 */
export function moveStrays(model, before, rec, ids, axes, home) {
  const tree = [rec].concat(ids.map((id) => model.byId.get(id)));
  const inTree = new Set(tree.map((n) => n.id));
  const homes = homesBefore(model, before);
  const overlap = (a, b) =>
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;
  const holdsTree = (g) => tree.some((c) => withinRect(c, g) || withinRect(before.get(c.id) || c, before.get(g.id) || g));
  const strays = model.nodes.filter(
    (n) =>
      !n.tuck &&
      !inTree.has(n.id) &&
      homes.get(n.id) === home &&
      (!isGroupRecord(n) || !holdsTree(n)) &&
      tree.some((c) => overlap(c, n))
  );
  if (!strays.length) return;
  const p = axisParts(axes.depth);
  const region = boundsOf(tree);
  const middle = p.near(rec) + rec[p.size] / 2;
  let ahead = p.far(region) + canvasGap(TIDY_SIBLING_GAP);
  let behind = p.near(region) - canvasGap(TIDY_SIBLING_GAP);
  strays.forEach((n) => {
    // Beyond the tree the way it grows — or, growing both ways, on the side the card was.
    const forward = axes.both ? p.near(n) + n[p.size] / 2 >= middle : axes.forward;
    const target = forward ? ahead : behind - n[p.size];
    shiftRecord(model, n, axes.depth, target - p.near(n), new Set());
    if (forward) ahead = target + n[p.size] + canvasGap(TIDY_SIBLING_GAP);
    else behind = target - canvasGap(TIDY_SIBLING_GAP);
  });
}

/* -- onto the canvas ----------------------------------------------------- */

/**
 * What changed in the records since the snapshot, put on the live
 * canvas: places and sizes, folds and tucks, kept in the cards' own data
 * so they're saved with the canvas. Returns whether anything changed.
 */
export function applyCanvasModel(model, before) {
  let changed = false;
  model.nodes.forEach((rec) => {
    const node = rec.node;
    const was = before.get(rec.id);
    if (!node || !was) return;
    if (rec.x !== was.x || rec.y !== was.y || rec.width !== was.width || rec.height !== was.height) {
      if (cardMovable(node)) {
        placeCard(node, { x: rec.x, y: rec.y, width: rec.width, height: rec.height });
        changed = true;
      }
    }
    const tuck = rec.tuck ? JSON.stringify(rec.tuck) : '';
    const fold = rec.fold ? JSON.stringify(rec.fold) : '';
    const room = rec.room ? JSON.stringify(rec.room) : '';
    if (tuck !== was.tuck || fold !== was.fold || room !== was.room) {
      keepOnCard(node, TUCK_KEY, rec.tuck ? Object.assign({}, rec.tuck) : undefined);
      keepOnCard(node, FOLD_KEY, rec.fold ? Object.assign({}, rec.fold) : undefined);
      keepOnCard(node, ROOM_KEY, rec.room ? JSON.parse(room) : undefined);
      changed = true;
    }
  });
  return changed;
}
