/*
 * The icon grammar, checked on one SVG file's text (docs/design-language.md,
 * "Icons"): what the file may hold, where its points may sit, and how fine its
 * detail may be. Used by tests/test_glyphs.js; `lintGlyph(text)` returns the
 * list of what's wrong (empty when it's right) and what it measured.
 */
const STEP = 1.5; // the grid's rule: one pixel at 16px
const HALF = 0.75; // where a diagonal's ends may sit
const PER_UNIT = 4; // raster samples per unit
const SIZE = 24 * PER_UNIT;
const FINE = 2.6; // a run shorter than this many units is thin (the grammar's bar is 3)
const SLIVER = 3.2; // the most thin area, in square units, one corner may leave

const ROOT = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24" fill="currentColor">((?:<path(?: fill-rule="evenodd")? d="[^"]+"\/>)+)<\/svg>\n$/;
const on = (n, rule) => Math.abs(n / rule - Math.round(n / rule)) < 1e-9;

/** One path's data as subpaths of segments: { start: [x, y], segs: [['L', x, y] | ['A', r, large, sweep, x, y]] }. */
function parsePath(d, problems) {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) || [];
  const subs = [];
  let i = 0;
  let sub = null;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') subs.push((sub = { start: [num(), num()], segs: [] }));
    else if (cmd === 'L' && sub) sub.segs.push(['L', num(), num()]);
    else if (cmd === 'A' && sub) {
      const [rx, ry, turn, large, sweep, x, y] = [num(), num(), num(), num(), num(), num(), num()];
      if (rx !== ry || turn !== 0) problems.push(`an arc that isn't part of a circle (${rx} ${ry} ${turn})`);
      sub.segs.push(['A', rx, large, sweep, x, y]);
    } else if (cmd === 'Z' && sub) sub = null;
    else {
      problems.push(`path command ${cmd} (only M, L, A and Z, each closed with Z)`);
      break;
    }
  }
  if (sub) problems.push('a subpath left open');
  return subs;
}

/** An arc from one point to another as short straight pieces. */
function arcPoints([x0, y0], r, large, sweep, [x1, y1]) {
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const far = dx * dx + dy * dy;
  const rr = Math.max(r * r, far);
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rr - far) / far));
  const cx = coef * dy + (x0 + x1) / 2;
  const cy = -coef * dx + (y0 + y1) / 2;
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  let sweepBy = Math.atan2(y1 - cy, x1 - cx) - a0;
  if (sweep && sweepBy < 0) sweepBy += 2 * Math.PI;
  if (!sweep && sweepBy > 0) sweepBy -= 2 * Math.PI;
  const steps = Math.max(8, Math.ceil(Math.abs(sweepBy) / (Math.PI / 24)));
  const rad = Math.sqrt(rr);
  return Array.from({ length: steps }, (_, k) => {
    const a = a0 + (sweepBy * (k + 1)) / steps;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  });
}

/** Where the points sit: on the rules, inside the canvas, straight edges on the grid or at 45°. */
function checkLattice(subs, problems) {
  subs.forEach((sub) => {
    let at = sub.start;
    const point = (x, y) => {
      if (x < 0 || x > 24 || y < 0 || y > 24) problems.push(`a point outside the canvas (${x} ${y})`);
      if (!on(x, HALF) || !on(y, HALF)) problems.push(`a point off the grid's rules (${x} ${y})`);
    };
    const edge = (to) => {
      const dx = to[0] - at[0];
      const dy = to[1] - at[1];
      if (dx === 0 && dy === 0) return;
      if (dx === 0 && !on(at[0], STEP)) problems.push(`an upright edge between the rules (x ${at[0]})`);
      else if (dy === 0 && !on(at[1], STEP)) problems.push(`a level edge between the rules (y ${at[1]})`);
      else if (dx !== 0 && dy !== 0 && Math.abs(Math.abs(dx) - Math.abs(dy)) > 1e-9) problems.push(`a slope that isn't 45° (${at} to ${to})`);
    };
    point(...sub.start);
    sub.segs.forEach((seg) => {
      const to = seg[0] === 'A' ? [seg[4], seg[5]] : [seg[1], seg[2]];
      point(...to);
      if (seg[0] === 'A' && !on(seg[1], HALF)) problems.push(`an arc's radius off the rules (${seg[1]})`);
      if (seg[0] === 'L') edge(to);
      at = to;
    });
    edge(sub.start);
  });
}

/** The glyph as a bitmap, PER_UNIT samples a unit: each path filled even-odd, the paths laid over each other. */
function raster(paths) {
  const ink = new Uint8Array(SIZE * SIZE);
  paths.forEach((subs) => {
    const edges = [];
    subs.forEach((sub) => {
      let at = sub.start;
      const line = (to) => {
        if (at[1] !== to[1]) edges.push([at[0], at[1], to[0], to[1]]);
        at = to;
      };
      sub.segs.forEach((seg) => {
        if (seg[0] === 'L') line([seg[1], seg[2]]);
        else arcPoints(at, seg[1], seg[2], seg[3], [seg[4], seg[5]]).forEach(line);
      });
      line(sub.start);
    });
    for (let row = 0; row < SIZE; row++) {
      const y = (row + 0.5) / PER_UNIT;
      const xs = [];
      edges.forEach(([x0, y0, x1, y1]) => {
        if (y0 <= y !== y1 <= y) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      });
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil(xs[k] * PER_UNIT - 0.5));
        const to = Math.min(SIZE - 1, Math.floor(xs[k + 1] * PER_UNIT - 0.5));
        for (let col = from; col <= to; col++) ink[row * SIZE + col] = 1;
      }
    }
  });
  return ink;
}

/** For every sample, the squared distance (in samples) to the nearest marked one: Felzenszwalb's two passes. */
function distSq(mark, w, h) {
  const INF = 1e12;
  const out = new Float64Array(w * h);
  const pass = (f, n) => {
    const d = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s;
      do { const p = v[k]; s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p); } while (s <= z[k] && --k >= 0);
      k++;
      v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
    return d;
  };
  const col = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = mark[y * w + x] ? 0 : INF;
    const d = pass(col, h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  const row = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = out[y * w + x];
    const d = pass(row, w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
}

/**
 * The samples of one kind (ink, or ground) that a disc as wide as the finest
 * allowed detail can't reach while staying inside that kind: the thin parts.
 * Beyond the canvas is open ground. A sharp corner always leaves a sliver;
 * a hairline or a pinched gap leaves much more.
 */
function thinMap(ink, kind) {
  const PAD = 8;
  const w = SIZE + 2 * PAD;
  const is = new Uint8Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const inside = x >= PAD && x < SIZE + PAD && y >= PAD && y < SIZE + PAD;
    const v = inside ? ink[(y - PAD) * SIZE + (x - PAD)] : 0;
    is[y * w + x] = v === kind ? 1 : 0;
  }
  const reach = ((FINE * PER_UNIT) / 2) ** 2;
  const toOther = distSq(is.map((v) => 1 - v), w, w);
  const fits = is.map((v, i) => (v && toOther[i] > reach ? 1 : 0));
  const toFit = distSq(fits, w, w);
  const thin = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const i = (y + PAD) * w + (x + PAD);
    if (is[i] && toFit[i] > reach) thin[y * SIZE + x] = 1;
  }
  return thin;
}

/** The areas, in square units, of the connected groups of marked samples. */
function groups(mark) {
  const seen = new Uint8Array(SIZE * SIZE);
  const out = [];
  for (let i = 0; i < mark.length; i++) {
    if (!mark[i] || seen[i]) continue;
    let n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const x = p % SIZE;
      const y = (p - x) / SIZE;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const qx = x + dx;
        const qy = y + dy;
        if (qx < 0 || qx >= SIZE || qy < 0 || qy >= SIZE) return;
        const q = qy * SIZE + qx;
        if (mark[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      });
    }
    out.push(n / (PER_UNIT * PER_UNIT));
  }
  return out;
}

function lintGlyph(text) {
  const problems = [];
  const root = ROOT.exec(text);
  if (!root) return { problems: ['not the one allowed form: <svg xmlns viewBox="0 0 24 24" fill="currentColor"> holding only <path d> elements, on one line'], cover: 0 };
  const paths = [];
  root[1].replace(/<path(?: fill-rule="evenodd")? d="([^"]+)"\/>/g, (all, d) => {
    const subs = parsePath(d, problems);
    if (subs.length > 1 && !all.includes('evenodd')) problems.push('holes cut without fill-rule="evenodd"');
    checkLattice(subs, problems);
    paths.push(subs);
  });
  const ink = raster(paths);
  let area = 0;
  let x0 = SIZE, x1 = -1, y0 = SIZE, y1 = -1;
  ink.forEach((v, i) => {
    if (!v) return;
    area++;
    const x = i % SIZE;
    const y = (i - x) / SIZE;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  });
  const box = [x0, y0, x1 + 1, y1 + 1].map((n) => n / PER_UNIT);
  if (!area) problems.push('nothing drawn');
  else {
    if (box[0] < STEP || box[1] < STEP || box[2] > 24 - STEP || box[3] > 24 - STEP) problems.push(`drawn into the margin: one step is kept clear all round (${box})`);
    const off = [(box[0] + box[2]) / 2 - 12, (box[1] + box[3]) / 2 - 12];
    if (Math.abs(off[0]) > HALF + 1e-9 || Math.abs(off[1]) > HALF + 1e-9) problems.push(`off centre by ${off}`);
    const thinInk = Math.max(0, ...groups(thinMap(ink, 1)));
    const thinGap = Math.max(0, ...groups(thinMap(ink, 0)));
    if (thinInk > SLIVER) problems.push(`a part thinner than the bar (${thinInk.toFixed(1)} square units of it)`);
    if (thinGap > SLIVER) problems.push(`a gap narrower than the bar (${thinGap.toFixed(1)} square units of it)`);
    return { problems, cover: area / (SIZE * SIZE), box, thinInk, thinGap };
  }
  return { problems, cover: 0 };
}

module.exports = { lintGlyph };
