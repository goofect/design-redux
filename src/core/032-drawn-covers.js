/* ------------------------------------------------------------------ */
/* Drawn covers                                                        */
/*                                                                     */
/* For a note or folder without artwork: an album cover drawn for it — */
/* a sun on a horizon, a moon over the fields, a few Bauhaus shapes, a  */
/* stack of bars — in warm, printed colours on a backdrop that darkens */
/* downwards. The name picks the design and the colours, so the same    */
/* name always gets the same cover; one can be picked for it instead,  */
/* and a colour chosen for it paints the design in that colour. They're */
/* artwork rather than part of the page, so they keep their colours in  */
/* either theme.                                                       */
/* ------------------------------------------------------------------ */

import { hexToHsl } from './031-colours.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/*
 * A backdrop from top to bottom, and the inks it's printed in: `a` the
 * main one, `b` a second, `c` for lines and small things.
 */
export const COVER_PALETTES = [
  { id: 'ember', top: '#5c261e', bottom: '#281210', a: '#e8c48c', b: '#b4452f', c: '#f0dcc0' },
  { id: 'pine', top: '#24342c', bottom: '#121a16', a: '#ceaa6e', b: '#8f3b2e', c: '#e6dcc8' },
  { id: 'parchment', top: '#e9e0cc', bottom: '#cfc1a3', a: '#3c1e1a', b: '#a63a2c', c: '#3c1e1a', light: true },
  { id: 'midnight', top: '#1e223a', bottom: '#0e101e', a: '#f0e6d2', b: '#a5623f', c: '#f0e6d2' },
  { id: 'saddle', top: '#7a5134', bottom: '#452b1b', a: '#f5ebd7', b: '#d8a066', c: '#f5ebd7' },
  { id: 'plum', top: '#3e1f34', bottom: '#180c16', a: '#dcb478', b: '#b0577a', c: '#e9cfa0' },
  { id: 'holly', top: '#1f3d2b', bottom: '#0f2017', a: '#e8d9b5', b: '#c0392b', c: '#e8d9b5' },
  { id: 'cranberry', top: '#7a1f2b', bottom: '#3d0f16', a: '#f2e3c6', b: '#d9a441', c: '#f2e3c6' },
  { id: 'espresso', top: '#3b2a20', bottom: '#1c130e', a: '#d9b38c', b: '#9c5d3a', c: '#ecdcc4' },
  { id: 'harbour', top: '#2f4858', bottom: '#16222b', a: '#f2c57c', b: '#86bbd8', c: '#e8eef2' },
  { id: 'mustard', top: '#ebc56f', bottom: '#d29f45', a: '#264653', b: '#c8553d', c: '#264653', light: true },
  { id: 'blush', top: '#f1d9cc', bottom: '#ddb7a6', a: '#6d2e46', b: '#b5654f', c: '#6d2e46', light: true },
  { id: 'lagoon', top: '#1d4e4f', bottom: '#0d2627', a: '#f4d58d', b: '#d1603d', c: '#f4d58d' },
  { id: 'frost', top: '#eef0eb', bottom: '#d3dbd3', a: '#2f5d50', b: '#b23a48', c: '#2f5d50', light: true },
  // A second set.
  { id: 'gingerbread', top: '#8a4b2a', bottom: '#4a2614', a: '#f3e3c8', b: '#c0392b', c: '#f3e3c8' },
  { id: 'evergreen', top: '#2d4a3e', bottom: '#14241d', a: '#f1e6cf', b: '#d4a24c', c: '#f1e6cf' },
  { id: 'cocoa', top: '#4a3328', bottom: '#241812', a: '#e9c9a2', b: '#b5523b', c: '#f2e2cc' },
  { id: 'latte', top: '#efe2cf', bottom: '#d8c3a5', a: '#5a3a2a', b: '#a8642f', c: '#5a3a2a', light: true },
  { id: 'nightsky', top: '#14213d', bottom: '#0a1020', a: '#fca311', b: '#d9d9d9', c: '#e5e5e5' },
  { id: 'rosewood', top: '#5e2a35', bottom: '#2e131a', a: '#f0c9a0', b: '#d97b66', c: '#f5dcc4' },
  { id: 'sage', top: '#dfe5d6', bottom: '#c3cdb6', a: '#3e5641', b: '#a24936', c: '#3e5641', light: true },
];

/* The shapes a design is made of, on a square 100 across. */
export const coverRound = (v) => Math.round(v * 10) / 10;
export const shapeCircle = (cx, cy, r, fill, opacity) => ({ tag: 'circle', at: { cx, cy, r }, fill, opacity });
export const shapeRing = (cx, cy, r, stroke, width, opacity) => ({ tag: 'circle', at: { cx, cy, r }, fill: 'none', stroke, width, opacity });
export const shapeRect = (x, y, width, height, fill, opacity, extra) => ({ tag: 'rect', at: Object.assign({ x, y, width, height }, extra), fill, opacity });
export const shapePath = (d, fill, opacity, extra) => Object.assign({ tag: 'path', at: { d }, fill, opacity }, extra);
export const shapeLine = (x1, y1, x2, y2, stroke, width, opacity) => ({ tag: 'line', at: { x1, y1, x2, y2 }, stroke, width, opacity });

/** A quarter of a circle filling a square, round the corner named. */
export function quarterCircle(x, y, s, corner) {
  if (corner === 'bl') return `M${x} ${y + s}V${y}A${s} ${s} 0 0 1 ${x + s} ${y + s}Z`;
  if (corner === 'br') return `M${x + s} ${y + s}H${x}A${s} ${s} 0 0 1 ${x + s} ${y}Z`;
  if (corner === 'tl') return `M${x} ${y}H${x + s}A${s} ${s} 0 0 1 ${x} ${y + s}Z`;
  return `M${x + s} ${y}V${y + s}A${s} ${s} 0 0 1 ${x} ${y}Z`;
}

export const shapeEllipse = (cx, cy, rx, ry, fill, opacity, transform) => ({ tag: 'ellipse', at: { cx, cy, rx, ry, transform }, fill, opacity });

/** A line through points, closed. */
export const coverPoly = (pts) => `M${pts.map((pt) => `${coverRound(pt[0])} ${coverRound(pt[1])}`).join('L')}Z`;

/** A shape turned, moved or flipped (an SVG transform). */
export function coverTurn(shape, transform) {
  shape.at = Object.assign({}, shape.at, { transform });
  return shape;
}

/**
 * A ridge from edge to edge round height `y`, closed along the bottom:
 * peaks and dips by turns, or `smooth`, rolling hills.
 */
export function coverRidge(r, y, amp, steps, smooth) {
  const up = r() < 0.5 ? 1 : -1;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const swing = smooth ? r() * 2 - 1 : (i % 2 ? up : -up) * (0.45 + 0.55 * r());
    pts.push([(i * 100) / steps, coverRound(y + swing * amp)]);
  }
  let d = `M0 100V${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = coverRound((x0 + x1) / 2);
    d += smooth ? `C${mx} ${y0} ${mx} ${y1} ${coverRound(x1)} ${y1}` : `L${coverRound(x1)} ${y1}`;
  }
  return `${d}V100Z`;
}

/** Waves along height `y`, `n` across, shifted by `phase` (0–1); closed below unless `open`. */
export function coverWave(y, amp, n, phase, open) {
  const len = 100 / n;
  let x = -len * (phase || 0);
  let d = `M${coverRound(x)} ${y}`;
  d += `Q${coverRound(x + len / 4)} ${y - amp} ${coverRound(x + len / 2)} ${y}`;
  x += len / 2;
  while (x < 100) {
    x += len / 2;
    d += `T${coverRound(x)} ${y}`;
  }
  return open ? d : `${d}V100H${coverRound(-len)}Z`;
}

/** A star of `n` points, out to `outer` and in to `inner`. */
export function coverStar(cx, cy, outer, inner, n, turn) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((turn || 0) - 90 + (i * 180) / n) * (Math.PI / 180);
    const rad = i % 2 ? inner : outer;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return coverPoly(pts);
}

/** A fir in three tiers, `w` across at the foot and `h` high, standing on `base`. */
export function coverPine(x, base, w, h) {
  const pts = [[0, -1], [0.3, -0.62], [0.16, -0.62], [0.42, -0.28], [0.24, -0.28], [0.5, 0]];
  const right = pts.map(([u, v]) => [x + u * w, base + v * h]);
  const left = pts.slice(1).reverse().map(([u, v]) => [x - u * w, base + v * h]);
  return coverPoly(right.concat(left));
}

/** A closed, rounded shape through points round a centre, each at its own distance. */
export function coverBlob(cx, cy, radii) {
  const n = radii.length;
  const pts = radii.map((rad, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  });
  const mid = (a, b) => [coverRound((a[0] + b[0]) / 2), coverRound((a[1] + b[1]) / 2)];
  const start = mid(pts[n - 1], pts[0]);
  let d = `M${start[0]} ${start[1]}`;
  pts.forEach((pt, i) => {
    const m = mid(pt, pts[(i + 1) % n]);
    d += `Q${coverRound(pt[0])} ${coverRound(pt[1])} ${m[0]} ${m[1]}`;
  });
  return `${d}Z`;
}

/** A hexagon, pointy side up. */
export function coverHex(cx, cy, rad) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (60 * i - 30) * (Math.PI / 180);
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return coverPoly(pts);
}

/** Half a ring, standing on `y`: an arch from `outer` in to `inner`. */
export function coverArch(cx, y, outer, inner) {
  return `M${cx - outer} ${y}A${outer} ${outer} 0 0 1 ${cx + outer} ${y}H${cx + inner}A${inner} ${inner} 0 0 0 ${cx - inner} ${y}Z`;
}

/* Each design: what it's called where one is picked, and its shapes, from a palette and a little chance. */
export const COVER_DESIGNS = [
  // Places.
  {
    id: 'daybreak',
    name: 'Daybreak',
    draw: (p, r) => [
      shapeCircle(coverRound(34 + r() * 32), 60, 20, p.a),
      shapePath(coverRidge(r, 60, 5, 3, true), p.c, 0.2),
      shapePath(coverRidge(r, 71, 5, 3, true), p.b, 0.9),
      shapePath(coverRidge(r, 84, 4, 2, true), p.bottom),
    ],
  },
  {
    id: 'alpine',
    name: 'Alpine',
    draw: (p, r) => [
      shapeCircle(coverRound(20 + r() * 60), 22, 6, p.c, 0.9),
      shapePath(coverRidge(r, 44, 10, 6), p.c, 0.18),
      shapePath(coverRidge(r, 58, 13, 4), p.a, 0.9),
      shapePath(coverRidge(r, 76, 8, 6), p.b),
      shapePath(coverRidge(r, 90, 3, 3, true), p.bottom),
    ],
  },
  {
    id: 'mesa',
    name: 'Mesa',
    draw: (p, r) => [
      shapeCircle(coverRound(58 + r() * 26), 28, 11, p.a),
      shapePath('M0 74H6L12 50H32L37 74H46L52 38H76L82 74H100V100H0Z', p.b),
      shapeLine(11, 58, 33, 58, p.bottom, 1.4, 0.35),
      shapeLine(51, 48, 77, 48, p.bottom, 1.4, 0.35),
      shapeLine(49, 60, 79, 60, p.bottom, 1.4, 0.35),
      shapeRect(0, 74, 100, 26, p.bottom),
      shapeLine(0, 82, 100, 82, p.a, 1, 0.25),
      shapeLine(0, 91, 100, 91, p.a, 1, 0.15),
    ],
  },
  {
    id: 'stillwater',
    name: 'Still water',
    draw: (p, r) => {
      const x = coverRound(42 + r() * 16);
      const h = coverRound(20 + r() * 10);
      const cap = coverRound(h + (60 - h) * 0.26);
      const flip = 'matrix(1 0 0 -1 0 120)';
      const back = `M${x + 2} 60L${x + 30} ${h + 14}L${x + 62} 60Z`;
      const peak = `M${x - 44} 60L${x} ${h}L${x + 44} 60Z`;
      const snow = `M${x} ${h}L${x + 11} ${cap}L${x + 5} ${cap - 2}L${x} ${cap + 2}L${x - 5} ${cap - 2}L${x - 11} ${cap}Z`;
      return [
        shapeCircle(18, 20, 5, p.c, 0.9),
        shapePath(back, p.b),
        shapePath(peak, p.a),
        shapePath(snow, p.c),
        coverTurn(shapePath(back, p.b, 0.3), flip),
        coverTurn(shapePath(peak, p.a, 0.3), flip),
        shapeLine(0, 60, 100, 60, p.c, 0.8, 0.45),
        shapeLine(10, 67, 38, 67, p.c, 1.2, 0.5),
        shapeLine(58, 73, 90, 73, p.c, 1.2, 0.4),
        shapeLine(22, 82, 50, 82, p.c, 1.2, 0.3),
      ];
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    draw: (p, r) => {
      const out = [];
      for (let i = 0; i < 14; i++) out.push(shapeCircle(coverRound(r() * 100), coverRound(r() * 56), coverRound(0.4 + r() * 0.7), p.c, 0.8));
      [0, 1, 2].forEach((i) => {
        const y = 24 + i * 10;
        out.push(shapePath(`M-5 ${y + 10}C25 ${y - 14} 45 ${y + 22} 70 ${y}S100 ${y - 6} 105 ${y - 2}`, 'none', 0.55 - i * 0.12, { stroke: i === 1 ? p.b : p.a, width: 8 - i * 2 }));
      });
      for (let x = 2; x < 104; x += 7) out.push(shapePath(coverPine(x, 94, 9, coverRound(12 + r() * 12)), p.bottom));
      return out.concat([shapeRect(0, 93, 100, 7, p.bottom)]);
    },
  },
  {
    id: 'island',
    name: 'Island',
    draw: (p, r) => [
      shapeCircle(coverRound(64 + r() * 16), 34, 12, p.a, 0.95),
      shapeRect(0, 63, 100, 37, p.b, 0.3),
      shapePath('M16 64Q38 50 60 64Z', p.a),
      shapePath('M38 58Q35 44 42 32', 'none', undefined, { stroke: p.c, width: 2.2 }),
      shapePath('M42 32Q32 24 21 30Q32 27 42 32Z', p.c),
      shapePath('M42 32Q48 21 59 24Q49 26 42 32Z', p.c),
      shapePath('M42 32Q55 30 61 39Q52 32 42 32Z', p.c),
      shapePath('M42 32Q33 34 29 43Q35 35 42 32Z', p.c),
      shapePath('M42 32Q39 22 44 15Q42 24 42 32Z', p.c),
      shapeLine(6, 72, 28, 72, p.c, 1.4, 0.5),
      shapeLine(58, 70, 92, 70, p.c, 1.4, 0.5),
      shapeLine(20, 81, 60, 81, p.c, 1.4, 0.35),
      shapeLine(64, 88, 90, 88, p.c, 1.4, 0.25),
    ],
  },
  {
    id: 'volcano',
    name: 'Volcano',
    draw: (p) => [
      shapeCircle(46, 26, 5, p.c, 0.3),
      shapeCircle(53, 20, 8, p.c, 0.3),
      shapeCircle(63, 13, 10, p.c, 0.3),
      shapeCircle(75, 8, 9, p.c, 0.25),
      shapePath('M12 86L42 38H58L88 86Z', p.b),
      shapePath('M42 38Q50 34 58 38Q50 42 42 38Z', p.bottom, 0.6),
      shapePath('M47 40Q44 50 46 60', 'none', undefined, { stroke: p.a, width: 2.2 }),
      shapePath('M53 40Q57 48 55 55', 'none', undefined, { stroke: p.a, width: 2.2 }),
      shapeRect(0, 86, 100, 14, p.bottom),
    ],
  },
  {
    id: 'canyon',
    name: 'Canyon',
    draw: (p) => [
      shapeCircle(52, 30, 8, p.a),
      shapeRect(30, 54, 42, 46, p.a, 0.3),
      shapePath('M48 54H54C55 62 46 66 46 74S56 88 54 100H36C40 90 34 80 38 72S48 62 48 54Z', p.c, 0.8),
      shapePath('M0 30H18V44H26V58H33V100H0Z', p.b),
      shapePath('M100 26H84V40H76V54H69V100H100Z', p.b, 0.9),
      shapeLine(0, 40, 18, 40, p.bottom, 1.2, 0.3),
      shapeLine(0, 52, 26, 52, p.bottom, 1.2, 0.3),
      shapeLine(0, 70, 33, 70, p.bottom, 1.2, 0.3),
      shapeLine(84, 34, 100, 34, p.bottom, 1.2, 0.3),
      shapeLine(76, 48, 100, 48, p.bottom, 1.2, 0.3),
      shapeLine(69, 66, 100, 66, p.bottom, 1.2, 0.3),
    ],
  },
  {
    id: 'furrows',
    name: 'Furrows',
    draw: (p, r) => {
      const out = [shapeCircle(coverRound(30 + r() * 40), 42, 14, p.a), shapePath('M0 56Q50 44 100 56V100H0Z', p.b)];
      for (let k = -6; k <= 6; k++) out.push(shapeLine(50 + k * 3, 52, 50 + k * 22, 100, p.a, 1.2, 0.4));
      return out;
    },
  },
  {
    id: 'snowfall',
    name: 'Snowfall',
    draw: (p, r) => {
      const out = [];
      for (let i = 0; i < 26; i++) out.push(shapeCircle(coverRound(r() * 100), coverRound(r() * 62), coverRound(0.6 + r()), p.c, coverRound(0.4 + r() * 0.5)));
      return out.concat([
        shapePath('M0 70Q40 56 100 66V100H0Z', p.c, 0.9),
        shapePath(coverPine(26, 70, 14, 26), p.b),
        shapeRect(52, 55, 22, 15, p.b),
        shapePath('M49 57L63 45L77 57Z', p.a),
        shapeRect(56, 59, 5, 5, p.a),
        shapeRect(65, 61, 5, 9, p.bottom),
      ]);
    },
  },
  {
    id: 'evening',
    name: 'Evening',
    draw: (p, r) => {
      const out = [shapeCircle(76, 22, 9, p.a), shapeCircle(80, 19, 8, p.top)];
      let x = 4;
      while (x < 96) {
        const w = coverRound(Math.min(10 + r() * 6, 96 - x));
        const h = coverRound(20 + r() * 36);
        out.push(shapeRect(x, 90 - h, w, h, p.b, 0.95));
        for (let wy = 94 - h; wy < 86; wy += 6) {
          for (let wx = x + 2; wx + 2 <= x + w - 1; wx += 4) if (r() < 0.32) out.push(shapeRect(wx, wy, 2, 2.6, p.a, 0.9));
        }
        x += w + 1.5;
      }
      return out.concat([shapeRect(0, 90, 100, 10, p.bottom)]);
    },
  },
  {
    id: 'woods',
    name: 'Woods',
    draw: (p, r) => {
      const out = [shapeCircle(coverRound(20 + r() * 60), 26, 9, p.a)];
      const row = (base, step, lo, hi, w, fill, opacity) => {
        for (let x = coverRound(-r() * step); x < 104; x += step) out.push(shapePath(coverPine(x, base, w, coverRound(lo + r() * (hi - lo))), fill, opacity));
        out.push(shapeRect(0, base, 100, 100 - base, fill, opacity));
      };
      row(58, 10, 18, 26, 13, p.c, 0.22);
      row(75, 13, 24, 34, 17, p.b, 0.85);
      row(95, 17, 34, 46, 23, p.bottom);
      return out;
    },
  },
  {
    id: 'swell',
    name: 'Swell',
    draw: (p) => [
      shapeCircle(80, 22, 8, p.a),
      shapePath('M0 100V70C10 50 30 34 54 34C74 34 84 48 78 58C74 64 64 62 64 54C64 48 70 46 72 50C70 42 58 40 50 46C38 54 40 74 56 82C68 88 84 84 100 76V100Z', p.b),
      shapePath('M6 80C16 60 32 46 52 44', 'none', 0.6, { stroke: p.c, width: 1.6 }),
      shapePath('M14 88C24 72 34 64 44 60', 'none', 0.4, { stroke: p.c, width: 1.6 }),
      shapePath(coverWave(92, 3, 4, 0.3), p.c, 0.3),
    ],
  },
  {
    id: 'falls',
    name: 'Falls',
    draw: (p) => [
      shapePath('M0 30H38V100H0Z', p.b),
      shapePath('M62 30H100V100H62Z', p.b),
      shapeRect(38, 30, 24, 52, p.c, 0.85),
      shapeLine(44, 34, 44, 78, p.a, 1, 0.35),
      shapeLine(51, 32, 51, 80, p.a, 1, 0.35),
      shapeLine(57, 36, 57, 76, p.a, 1, 0.35),
      shapeEllipse(50, 85, 32, 7, p.c, 0.45),
      shapeCircle(40, 81, 6, p.c, 0.3),
      shapeCircle(60, 80, 7, p.c, 0.3),
      shapeCircle(50, 78, 5, p.c, 0.3),
      shapeCircle(8, 30, 7, p.a, 0.9),
      shapeCircle(20, 27, 9, p.a, 0.9),
      shapeCircle(32, 31, 6, p.a, 0.9),
      shapeCircle(70, 31, 7, p.a, 0.9),
      shapeCircle(84, 27, 9, p.a, 0.9),
      shapeCircle(96, 31, 6, p.a, 0.9),
    ],
  },
  {
    id: 'balloon',
    name: 'Balloon',
    draw: (p, r) => [
      shapeEllipse(24, 30, 10, 3.5, p.c, 0.22),
      shapeEllipse(80, 46, 12, 4, p.c, 0.18),
      shapeCircle(82, 26, 4, p.c, 0.5),
      shapeRect(81, 32, 2, 2, p.c, 0.5),
      shapePath('M50 16C64 16 72 26 72 37C72 49 58 57 54 63H46C42 57 28 49 28 37C28 26 36 16 50 16Z', p.a),
      shapePath('M50 16C56 16 60 26 60 37C60 49 54 57 52 63H48C46 57 40 49 40 37C40 26 44 16 50 16Z', p.b),
      shapeLine(46, 63, 47, 70, p.c, 0.8),
      shapeLine(54, 63, 53, 70, p.c, 0.8),
      shapeRect(45.5, 70, 9, 6, p.c, 1, { rx: 1 }),
      shapePath(coverRidge(r, 88, 4, 3, true), p.bottom),
    ],
  },
  {
    id: 'kite',
    name: 'Kite',
    draw: (p) => [
      shapePath('M62 52C56 66 40 64 34 78S24 94 20 104', 'none', 0.8, { stroke: p.c, width: 1 }),
      shapePath('M62 14L76 30L62 52L48 30Z', p.a),
      shapePath('M62 14L76 30H62Z', p.b),
      shapePath('M48 30H62V52Z', p.b),
      shapeLine(62, 14, 62, 52, p.bottom, 0.8, 0.4),
      shapeLine(48, 30, 76, 30, p.bottom, 0.8, 0.4),
      shapePath('M54 60l-4 -3v6zM54 60l4 -3v6z', p.b),
      shapePath('M40 68l-4 -3v6zM40 68l4 -3v6z', p.a),
      shapePath('M30 82l-4 -3v6zM30 82l4 -3v6z', p.b),
      shapePath('M0 100V90Q50 82 100 92V100Z', p.bottom),
    ],
  },
  {
    id: 'campfire',
    name: 'Campfire',
    draw: (p, r) => {
      const out = [];
      for (let i = 0; i < 9; i++) out.push(shapeCircle(coverRound(r() * 100), coverRound(r() * 36), coverRound(0.5 + r() * 0.6), p.c, 0.7));
      return out.concat([
        shapePath(coverPine(10, 80, 14, 34), p.b, 0.7),
        shapePath(coverPine(92, 80, 12, 28), p.b, 0.7),
        shapeCircle(76, 74, 13, p.a, 0.12),
        shapePath('M22 80L44 44L66 80Z', p.a),
        shapePath('M38 80L44 62L50 80Z', p.bottom, 0.8),
        shapeLine(44, 44, 41, 39, p.c, 1.2),
        shapeLine(44, 44, 47, 39, p.c, 1.2),
        shapeRect(0, 80, 100, 20, p.bottom),
        shapePath('M76 80C70 74 73 68 76 61C79 68 84 73 78 80Z', p.b),
        shapePath('M76 80C74 76 75 72 76 69C78 72 79 77 77 80Z', p.a),
        shapeLine(70, 83, 82, 79, p.c, 2),
        shapeLine(70, 79, 82, 83, p.c, 2),
      ]);
    },
  },
  {
    id: 'paperplane',
    name: 'Paper plane',
    draw: (p) => [
      shapePath('M22 56C6 64 8 80 22 78S36 88 24 98', 'none', 0.6, { stroke: p.c, width: 1.4, dash: '3 3' }),
      shapePath('M24 52L82 26L56 70Z', p.a),
      shapePath('M82 26L46 58L56 70Z', p.c, 0.7),
      shapePath('M46 58L48 70L56 66Z', p.b),
    ],
  },
  {
    id: 'rainfall',
    name: 'Rainfall',
    draw: (p, r) => {
      const out = [
        shapeCircle(40, 38, 11, p.c, 0.9),
        shapeCircle(54, 31, 14, p.c, 0.9),
        shapeCircle(67, 39, 10, p.c, 0.9),
        shapeRect(32, 38, 42, 11, p.c, 0.9, { rx: 5.5 }),
      ];
      for (let i = 0; i < 9; i++) {
        const x = coverRound(34 + r() * 38);
        const y = coverRound(56 + r() * 16);
        out.push(shapeLine(x, y, x - 3, y + 8, p.a, 1.4, 0.7));
      }
      return out.concat([shapeEllipse(52, 90, 24, 3.5, p.b, 0.5)]);
    },
  },

  // Patterns.
  {
    id: 'quarters',
    name: 'Quarters',
    draw: (p, r) => {
      const inks = [p.a, p.b, p.c];
      const out = [];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const x = 11 + i * 26;
          const y = 11 + j * 26;
          const ink = inks[Math.floor(r() * 3)];
          const kind = Math.floor(r() * 6);
          if (kind < 4) out.push(shapePath(quarterCircle(x, y, 26, ['tl', 'tr', 'br', 'bl'][kind]), ink));
          else if (kind === 4) out.push(shapeCircle(x + 13, y + 13, 12, ink));
          else out.push(shapeRect(x + 1, y + 1, 24, 24, ink, 0.35));
        }
      }
      return out;
    },
  },
  {
    id: 'overlap',
    name: 'Overlap',
    draw: (p) => [shapeCircle(39, 41, 22, p.a, 0.85), shapeCircle(61, 41, 22, p.b, 0.75), shapeCircle(50, 60, 22, p.c, 0.55)],
  },
  {
    id: 'waveform',
    name: 'Waveform',
    draw: (p, r) => {
      const out = [];
      const n = 21;
      for (let i = 0; i < n; i++) {
        const h = coverRound((5 + 34 * Math.sin((Math.PI * i) / (n - 1))) * (0.45 + 0.55 * r()));
        out.push(shapeRect(coverRound(9 + i * 4), coverRound(50 - h), 2.6, coverRound(h * 2), i > 6 && i < 14 ? p.b : p.a, 1, { rx: 1.3 }));
      }
      return out;
    },
  },
  {
    id: 'contours',
    name: 'Contours',
    draw: (p, r) => {
      const cx = coverRound(36 + r() * 28);
      const cy = coverRound(38 + r() * 24);
      const bumps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(() => 0.8 + r() * 0.4);
      const out = [];
      for (let k = 1; k <= 8; k++) out.push(shapePath(coverBlob(cx, cy, bumps.map((b) => k * 7 * b)), 'none', coverRound(1 - k * 0.08), { stroke: k === 3 ? p.b : p.a, width: k === 3 ? 2 : 1.2 }));
      return out.concat([shapeCircle(cx, cy, 2, p.b)]);
    },
  },
  {
    id: 'cubes',
    name: 'Cubes',
    draw: (p) => {
      const s = 16;
      const w = s * 0.866;
      const cube = (cx, cy) => [
        shapePath(coverPoly([[cx, cy - s], [cx + w, cy - s / 2], [cx, cy], [cx - w, cy - s / 2]]), p.a),
        shapePath(coverPoly([[cx - w, cy - s / 2], [cx, cy], [cx, cy + s], [cx - w, cy + s / 2]]), p.b),
        shapePath(coverPoly([[cx, cy], [cx + w, cy - s / 2], [cx + w, cy + s / 2], [cx, cy + s]]), p.b, 0.55),
      ];
      return [].concat(cube(50, 46), cube(50 + w, 54), cube(50 - w, 54), cube(50, 62), cube(50 + w, 38));
    },
  },
  {
    id: 'vortex',
    name: 'Vortex',
    draw: (p) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => {
      const size = 84 - k * 9;
      return shapeRect(50 - size / 2, 50 - size / 2, size, size, k % 2 ? p.b : p.a, 1, { transform: `rotate(${k * 7} 50 50)` });
    }),
  },
  {
    id: 'confetti',
    name: 'Confetti',
    draw: (p, r) => {
      const inks = [p.a, p.b, p.c];
      const out = [];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const x = coverRound(14 + i * 24 + (r() - 0.5) * 10);
          const y = coverRound(14 + j * 24 + (r() - 0.5) * 10);
          const ink = inks[Math.floor(r() * 3)];
          const kind = Math.floor(r() * 5);
          const turn = `rotate(${Math.floor(r() * 360)} ${x} ${y})`;
          if (kind === 0) out.push(shapeCircle(x, y, 4, ink));
          else if (kind === 1) out.push(shapeRing(x, y, 4.5, ink, 1.8));
          else if (kind === 2) out.push(coverTurn(shapePath(coverPoly([[x, y - 5], [x + 5, y + 4], [x - 5, y + 4]]), ink), turn));
          else if (kind === 3) out.push(coverTurn(shapePath(`M${x - 7} ${y}q3.5 -5 7 0t7 0`, 'none', 1, { stroke: ink, width: 1.8 }), turn));
          else out.push(coverTurn(shapeRect(x - 5, y - 1.5, 10, 3, ink, 1, { rx: 1.5 }), turn));
        }
      }
      return out;
    },
  },
  {
    id: 'bands',
    name: 'Bands',
    draw: (p) => [p.a, p.b, p.c, p.a, p.b].map((ink, i) => shapeRect(-30, 6 + i * 20, 160, 12, ink, [0.95, 0.9, 0.5, 0.6, 0.35][i], { transform: 'rotate(-24 50 50)' })),
  },
  {
    id: 'orbits',
    name: 'Orbits',
    draw: (p, r) => {
      const turn = 'rotate(-20 50 50)';
      const out = [shapeCircle(50, 50, 7, p.a)];
      [14, 23, 32, 41].forEach((rx, i) => {
        const ry = rx * 0.42;
        out.push(coverTurn(Object.assign(shapeEllipse(50, 50, rx, ry, 'none'), { stroke: p.c, width: 0.8, opacity: 0.5 }), turn));
        const a = r() * Math.PI * 2;
        out.push(coverTurn(shapeCircle(coverRound(50 + rx * Math.cos(a)), coverRound(50 + ry * Math.sin(a)), 2 + (i % 2), i % 2 ? p.b : p.a), turn));
      });
      return out;
    },
  },
  {
    id: 'constellation',
    name: 'Constellation',
    draw: (p, r) => {
      const out = [];
      for (let i = 0; i < 16; i++) out.push(shapeCircle(coverRound(r() * 100), coverRound(r() * 100), 0.5, p.c, 0.5));
      const pts = [0, 1, 2, 3, 4, 5, 6].map((i) => [coverRound(14 + i * 12 + (r() - 0.5) * 6), coverRound(24 + r() * 52)]);
      pts.slice(1).forEach((pt, i) => out.push(shapeLine(pts[i][0], pts[i][1], pt[0], pt[1], p.c, 0.8, 0.5)));
      pts.forEach((pt, i) => {
        out.push(shapeCircle(pt[0], pt[1], i % 3 ? 1.6 : 2.6, p.a));
        if (!(i % 3)) out.push(shapeCircle(pt[0], pt[1], 5, p.a, 0.18));
      });
      return out;
    },
  },
  {
    id: 'arches',
    name: 'Arches',
    draw: (p) => {
      const out = [];
      [[27, 46], [73, 46], [27, 92], [73, 92]].forEach(([x, y], i) => {
        const inks = i % 3 ? [p.a, p.b, p.c] : [p.b, p.c, p.a];
        out.push(shapePath(coverArch(x, y, 21, 14), inks[0]), shapePath(coverArch(x, y, 14, 7), inks[1]), shapePath(coverArch(x, y, 7, 0.01), inks[2]));
      });
      return out;
    },
  },
  {
    id: 'pills',
    name: 'Pills',
    draw: (p, r) => [0, 1, 2, 3, 4, 5].map((i) => {
      const x = coverRound(12 + r() * 22);
      const w = coverRound(Math.min(30 + r() * 40, 88 - x));
      return shapeRect(x, 17 + i * 12, w, 7, [p.a, p.b, p.c][i % 3], i % 3 === 2 ? 0.6 : 1, { rx: 3.5 });
    }),
  },
  {
    id: 'weave',
    name: 'Weave',
    draw: (p) => {
      const at = [17, 39, 61, 83];
      const out = [];
      at.forEach((x) => out.push(shapeRect(x - 5, 0, 10, 100, p.b)));
      at.forEach((y) => out.push(shapeRect(0, y - 5, 100, 10, p.a)));
      at.forEach((x, i) => at.forEach((y, j) => {
        if ((i + j) % 2) out.push(shapeRect(x - 5, y - 5, 10, 10, p.b));
      }));
      return out;
    },
  },
  {
    id: 'argyle',
    name: 'Argyle',
    draw: (p) => {
      const out = [];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          const x = (i * 100) / 3;
          const y = j * 50 + (i % 2 ? 0 : 25) - 25;
          out.push(shapePath(coverPoly([[x, y], [x + 16.7, y + 25], [x, y + 50], [x - 16.7, y + 25]]), (i + j) % 2 ? p.a : p.b, (i + j) % 2 ? 0.9 : 0.75));
        }
      }
      out.push(shapePath('M0 0L66.7 100M33.3 0L100 100M66.7 0L0 100M100 0L33.3 100', 'none', 0.5, { stroke: p.c, width: 0.8, dash: '2 2' }));
      return out;
    },
  },
  {
    id: 'ripple',
    name: 'Ripple',
    draw: (p) => {
      const out = [];
      for (let k = 5; k >= 1; k--) {
        const ring = shapeEllipse(50, 70, k * 9, k * 2.8, 'none');
        out.push(Object.assign(ring, { stroke: p.c, width: 1.2, opacity: coverRound(1 - k * 0.15) }));
      }
      return out.concat([shapePath('M50 16C50 16 39 32 39 40A11 11 0 0 0 61 40C61 32 50 16 50 16Z', p.a), shapeCircle(46, 40, 2.4, p.c, 0.6)]);
    },
  },
  {
    id: 'rosette',
    name: 'Rosette',
    draw: (p) => {
      const out = [];
      for (let i = 0; i < 8; i++) out.push(shapeEllipse(50, 31, 7, 18, i % 2 ? p.b : p.a, 0.85, `rotate(${i * 45} 50 50)`));
      for (let i = 0; i < 8; i++) out.push(shapeEllipse(50, 39, 4, 10, p.c, 0.6, `rotate(${i * 45 + 22.5} 50 50)`));
      return out.concat([shapeCircle(50, 50, 6, p.b), shapeCircle(50, 50, 2.4, p.c)]);
    },
  },
  {
    id: 'composition',
    name: 'Composition',
    draw: (p, r) => {
      const x1 = coverRound(28 + r() * 12);
      const x2 = coverRound(70 + r() * 12);
      const y1 = coverRound(28 + r() * 12);
      const y2 = coverRound(60 + r() * 12);
      const line = (a, b, c, d) => shapeLine(a, b, c, d, p.bottom, 3);
      return [
        shapeRect(0, 0, 100, 100, p.c),
        shapeRect(0, 0, x1, y1, p.b),
        shapeRect(x2, y2, 100 - x2, 100 - y2, p.a),
        shapeRect(0, y2 + (100 - y2) / 2, x1, (100 - y2) / 2, p.a, 0.9),
        line(x1, -2, x1, 102),
        line(-2, y1, x1, y1),
        line(x1, y2, 102, y2),
        line(x2, y2, x2, 102),
        line(-2, y2 + (100 - y2) / 2, x1, y2 + (100 - y2) / 2),
      ];
    },
  },
  {
    id: 'ridgelines',
    name: 'Ridgelines',
    draw: (p, r) => {
      const out = [];
      for (let k = 0; k < 12; k++) {
        const base = 26 + k * 5.4;
        let d = '';
        for (let x = 12; x <= 88; x += 4) {
          const bump = Math.exp(-(((x - 50) / 13) ** 2)) * 14 * (0.4 + r()) + r() * 1.4;
          d += `${d ? 'L' : 'M'}${x} ${coverRound(base - bump)}`;
        }
        out.push(shapePath(d, 'none', 0.9, { stroke: k === 6 ? p.b : p.c, width: 1.1 }));
      }
      return out;
    },
  },
  {
    id: 'corona',
    name: 'Corona',
    draw: (p, r) => {
      const out = [];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const len = 30 + r() * 12;
        out.push(shapeLine(coverRound(50 + 24 * Math.cos(a)), coverRound(50 + 24 * Math.sin(a)), coverRound(50 + len * Math.cos(a)), coverRound(50 + len * Math.sin(a)), p.a, 1.2, 0.65));
      }
      return out.concat([shapeCircle(50, 50, 24, p.a, 0.25), shapeCircle(50, 50, 21, p.bottom), shapeRing(50, 50, 21, p.a, 1.6)]);
    },
  },
  {
    id: 'terrazzo',
    name: 'Terrazzo',
    draw: (p, r) => {
      const inks = [p.a, p.b, p.c];
      const out = [];
      for (let i = 0; i < 26; i++) {
        const x = r() * 100;
        const y = r() * 100;
        const s = 2.5 + r() * 4;
        const n = 3 + Math.floor(r() * 2);
        const pts = [];
        for (let k = 0; k < n; k++) {
          const a = ((k + r() * 0.6) / n) * Math.PI * 2;
          pts.push([x + s * Math.cos(a), y + s * Math.sin(a)]);
        }
        out.push(shapePath(coverPoly(pts), inks[i % 3], i % 3 === 2 ? 0.6 : 0.9));
      }
      return out;
    },
  },
  {
    id: 'honeycomb',
    name: 'Honeycomb',
    draw: (p, r) => {
      const out = [];
      const rad = 10;
      const w = rad * 1.732;
      for (let j = -1; j < 8; j++) {
        for (let i = -1; i < 7; i++) {
          const x = coverRound(i * w + (j % 2 ? w / 2 : 0));
          const y = coverRound(j * rad * 1.5);
          const v = r();
          if (v < 0.2) out.push(shapePath(coverHex(x, y, rad - 1.2), v < 0.08 ? p.b : p.a, 0.9));
          else out.push(shapePath(coverHex(x, y, rad - 1.2), 'none', 0.35, { stroke: p.c, width: 0.8 }));
        }
      }
      return out;
    },
  },
  {
    id: 'citrus',
    name: 'Citrus',
    draw: (p) => {
      const out = [shapeCircle(50, 50, 32, p.a), shapeCircle(50, 50, 28, p.c, 0.85)];
      for (let i = 0; i < 9; i++) {
        const a0 = ((i + 0.08) / 9) * Math.PI * 2;
        const a1 = ((i + 0.92) / 9) * Math.PI * 2;
        const pt = (a, rad) => `${coverRound(50 + rad * Math.cos(a))} ${coverRound(50 + rad * Math.sin(a))}`;
        out.push(shapePath(`M${pt((a0 + a1) / 2, 4)}L${pt(a0, 25)}A25 25 0 0 1 ${pt(a1, 25)}Z`, p.b, 0.85));
      }
      return out.concat([shapeCircle(50, 50, 3, p.c)]);
    },
  },
  {
    id: 'gem',
    name: 'Gem',
    draw: (p) => [
      shapePath('M30 34L40 22H60L70 34L50 80Z', p.a),
      shapePath('M30 34H70L50 80Z', p.b, 0.85),
      shapePath('M40 34L50 22L60 34Z', p.c, 0.6),
      shapePath('M40 34L50 80L60 34Z', p.a, 0.5),
      shapeLine(30, 34, 70, 34, p.c, 0.8, 0.6),
      shapePath(coverStar(74, 20, 5, 1.2, 4), p.c),
      shapePath(coverStar(24, 64, 3, 0.8, 4), p.c, 0.7),
    ],
  },

  // Things.
  {
    id: 'sleeve',
    name: 'Sleeve',
    draw: (p) => [
      shapeCircle(64, 50, 30, '#17120f'),
      shapeRing(64, 50, 26, p.c, 0.6, 0.15),
      shapeRing(64, 50, 21, p.c, 0.6, 0.15),
      shapeRing(64, 50, 16, p.c, 0.6, 0.15),
      shapeCircle(64, 50, 9, p.b),
      shapeCircle(64, 50, 1.2, '#17120f'),
      shapeRect(12, 20, 60, 60, p.a),
      shapeRing(42, 50, 16, p.bottom, 2, 0.45),
      shapeCircle(42, 50, 6, p.b),
    ],
  },
  {
    id: 'cassette',
    name: 'Cassette',
    draw: (p) => [
      shapeRect(14, 28, 72, 46, p.a, 1, { rx: 4 }),
      shapeRect(20, 33, 60, 25, p.b, 1, { rx: 2 }),
      shapeLine(25, 37, 54, 37, p.a, 1, 0.7),
      shapeRect(32, 41, 36, 10, p.bottom, 1, { rx: 5 }),
      shapeCircle(40, 46, 3.6, p.c),
      shapeCircle(60, 46, 3.6, p.c),
      shapeCircle(40, 46, 1.2, p.bottom),
      shapeCircle(60, 46, 1.2, p.bottom),
      shapePath('M28 74L32 64H68L72 74Z', p.b, 0.7),
      shapeCircle(18, 32, 1, p.bottom, 0.5),
      shapeCircle(82, 32, 1, p.bottom, 0.5),
    ],
  },
  {
    id: 'headphones',
    name: 'Headphones',
    draw: (p) => [
      shapePath('M25 60V48A25 25 0 0 1 75 48V60', 'none', 1, { stroke: p.a, width: 5 }),
      shapeRect(17, 54, 14, 26, p.b, 1, { rx: 5 }),
      shapeRect(69, 54, 14, 26, p.b, 1, { rx: 5 }),
      shapeRect(28, 57, 6, 20, p.a, 1, { rx: 2 }),
      shapeRect(66, 57, 6, 20, p.a, 1, { rx: 2 }),
    ],
  },
  {
    id: 'keys',
    name: 'Keys',
    draw: (p) => {
      const out = [shapeRect(4, 22, 92, 8, p.b)];
      for (let i = 0; i < 7; i++) out.push(shapeRect(8 + i * 12, 30, 11, 56, p.c, 1, { rx: 1.5 }));
      [0, 1, 3, 4, 5].forEach((k) => out.push(shapeRect(8 + (k + 1) * 12 - 4, 30, 7, 32, p.bottom, 1, { rx: 1 })));
      return out;
    },
  },
  {
    id: 'stack',
    name: 'Stack',
    draw: (p, r) => {
      const out = [];
      let y = 84;
      for (let i = 0; i < 5; i++) {
        const h = coverRound(8 + r() * 3);
        const w = coverRound(46 + r() * 18);
        const x = coverRound(50 - w / 2 + (r() - 0.5) * 8);
        y -= h;
        out.push(shapeRect(x, y, w, h, [p.a, p.b, p.c][i % 3], i % 3 === 2 ? 0.75 : 1, { rx: 1 }));
        out.push(shapeLine(x + 4, y + 1.5, x + 4, y + h - 1.5, p.bottom, 0.8, 0.35));
        out.push(shapeLine(x + w - 4, y + 1.5, x + w - 4, y + h - 1.5, p.bottom, 0.8, 0.35));
      }
      return out.concat([
        shapeCircle(52, y - 6, 6, p.b),
        shapePath(`M52 ${y - 12}q4 -4 7 -2q-3 3 -7 2z`, p.a),
        shapeLine(8, 84, 92, 84, p.c, 1, 0.5),
      ]);
    },
  },
  {
    id: 'shelf',
    name: 'Shelf',
    draw: (p, r) => {
      const out = [];
      let x = 12;
      let i = 0;
      while (x < 80) {
        const w = coverRound(6 + r() * 4);
        const h = coverRound(30 + r() * 20);
        const ink = [p.a, p.b, p.c][i % 3];
        out.push(shapeRect(x, 80 - h, w, h, ink, i % 3 === 2 ? 0.75 : 1, { rx: 0.8 }));
        out.push(shapeRect(x + 1.5, 84 - h, w - 3, 3, p.bottom, 0.3));
        x += w + 1;
        i++;
      }
      out.push(coverTurn(shapeRect(x + 2, 36, 8, 44, p.b, 1, { rx: 0.8 }), `rotate(-14 ${x + 10} 80)`));
      return out.concat([shapeRect(8, 80, 84, 3, p.c, 0.8)]);
    },
  },
  {
    id: 'lamp',
    name: 'Lamp',
    draw: (p) => [
      shapePath('M44 47L52 44L86 86H50Z', p.a, 0.14),
      shapeLine(8, 88, 92, 88, p.c, 1, 0.5),
      shapeEllipse(36, 86, 14, 3.5, p.b),
      shapePath('M36 85L46 58L32 37', 'none', 1, { stroke: p.a, width: 2.6 }),
      shapeCircle(46, 58, 2, p.c),
      shapeCircle(32, 37, 2, p.c),
      shapePath('M24 35L38 26L52 44Q44 50 36 48Z', p.b),
      shapeCircle(45, 46, 3, p.a),
    ],
  },
  {
    id: 'pencil',
    name: 'Pencil',
    draw: (p) => [
      shapeRect(8, 44, 8, 12, p.b, 1, { rx: 2 }),
      shapeRect(15, 44, 6, 12, p.c, 0.8),
      shapeRect(21, 44, 50, 12, p.a),
      shapeLine(21, 50, 71, 50, p.bottom, 0.8, 0.25),
      shapePath('M71 44L85 50L71 56Z', p.c, 0.9),
      shapePath('M81 48.3L85 50L81 51.7Z', p.bottom),
    ].map((s) => coverTurn(s, 'rotate(-35 50 50)')),
  },
  {
    id: 'magnifier',
    name: 'Magnifier',
    draw: (p) => [
      shapeLine(61, 61, 82, 82, p.b, 7),
      shapeCircle(44, 44, 20, p.c, 0.15),
      shapeRing(44, 44, 22, p.a, 5),
      shapePath('M31 39A14 14 0 0 1 39 30', 'none', 0.6, { stroke: p.c, width: 2 }),
    ],
  },
  {
    id: 'globe',
    name: 'Globe',
    draw: (p) => [
      shapeCircle(48, 46, 22, p.a),
      shapePath('M36 32C43 28 51 33 48 40S37 47 33 41Z', p.b, 0.85),
      shapePath('M53 50C59 46 66 52 61 59S50 63 53 54Z', p.b, 0.85),
      shapePath('M40 60C43 58 46 61 44 64Z', p.b, 0.85),
      Object.assign(shapeEllipse(48, 46, 22, 7, 'none'), { stroke: p.bottom, width: 0.8, opacity: 0.3 }),
      shapePath('M22 46A26 26 0 0 0 74 46', 'none', 1, { stroke: p.c, width: 2 }),
      shapeLine(48, 72, 48, 82, p.c, 2.4),
      shapeEllipse(48, 84, 12, 3, p.c),
    ],
  },
  {
    id: 'key',
    name: 'Key',
    draw: (p) => [
      shapeRing(30, 50, 12, p.a, 6),
      shapeRect(40, 47, 46, 6, p.a),
      shapeRect(72, 53, 5, 10, p.a),
      shapeRect(80, 53, 5, 7, p.a),
      shapeCircle(30, 50, 3, p.b),
    ].map((s) => coverTurn(s, 'rotate(-24 50 50)')),
  },
  {
    id: 'letter',
    name: 'Letter',
    draw: (p) => [
      shapeRect(16, 30, 68, 44, p.c, 1, { rx: 2 }),
      shapePath('M16 74L44 52M84 74L56 52', 'none', 0.3, { stroke: p.bottom, width: 1.4 }),
      shapePath('M16 31L50 56L84 31Z', p.a),
      shapeCircle(50, 54, 5, p.b),
    ],
  },
  {
    id: 'monstera',
    name: 'Houseplant',
    draw: (p) => [
      shapeLine(50, 66, 50, 42, p.a, 1.4),
      shapeLine(50, 66, 37, 50, p.a, 1.4),
      shapeLine(50, 66, 63, 50, p.a, 1.4),
      shapeLine(50, 66, 42, 32, p.a, 1.4),
      shapeEllipse(50, 36, 9, 17, p.a),
      shapeEllipse(34, 46, 8, 15, p.a, 0.9, 'rotate(-48 34 46)'),
      shapeEllipse(66, 46, 8, 15, p.a, 0.9, 'rotate(48 66 46)'),
      shapeEllipse(40, 28, 6, 12, p.a, 0.8, 'rotate(-22 40 28)'),
      shapeLine(50, 22, 50, 52, p.bottom, 0.8, 0.3),
      shapeRect(34, 66, 32, 6, p.b, 1, { rx: 1.5 }),
      shapePath('M36 71H64L60 90H40Z', p.b),
      shapeRect(34, 66, 32, 2, p.c, 0.25),
    ],
  },
  {
    id: 'cactus',
    name: 'Cactus',
    draw: (p) => [
      shapeRect(43, 30, 14, 46, p.a, 1, { rx: 7 }),
      shapePath('M43 56H38A6 6 0 0 1 32 50V42A4 4 0 0 1 40 42V48H43Z', p.a),
      shapePath('M57 50H62V38A4 4 0 0 1 70 38V46A8 8 0 0 1 62 54H57Z', p.a),
      shapeLine(50, 36, 50, 72, p.bottom, 0.8, 0.25),
      shapeLine(46.5, 40, 46.5, 72, p.bottom, 0.8, 0.2),
      shapeLine(53.5, 40, 53.5, 72, p.bottom, 0.8, 0.2),
      shapeCircle(50, 30, 3.5, p.b),
      shapePath('M35 74H65L61 91H39Z', p.b),
      shapeLine(8, 91, 92, 91, p.c, 1, 0.4),
    ],
  },
  {
    id: 'moka',
    name: 'Moka pot',
    draw: (p) => [
      shapePath('M30 25C27 21 33 18 30 13', 'none', 0.5, { stroke: p.c, width: 1.4 }),
      shapePath('M36 22C33 18 39 15 36 10', 'none', 0.4, { stroke: p.c, width: 1.4 }),
      shapePath('M63 38H70V52L60 56', 'none', 1, { stroke: p.b, width: 3.4 }),
      shapePath('M36 86L40 62H60L64 86Z', p.a),
      shapeRect(39, 58, 22, 4, p.b),
      shapePath('M40 58L37 34H63L60 58Z', p.a),
      shapePath('M37 34L31 30L38 39Z', p.a),
      shapePath('M38 34L42 28H58L62 34Z', p.b),
      shapeCircle(50, 26, 2.4, p.b),
      shapeLine(50, 37, 50, 55, p.bottom, 0.8, 0.2),
      shapeLine(50, 65, 50, 83, p.bottom, 0.8, 0.2),
      shapeLine(20, 86, 80, 86, p.c, 1, 0.45),
    ],
  },
  {
    id: 'fir',
    name: 'Fir',
    draw: (p) => [
      shapePath(coverPine(50, 82, 52, 60), p.a, 0.95),
      shapePath('M38 44Q50 50 62 42', 'none', 0.7, { stroke: p.b, width: 1.2 }),
      shapePath('M33 62Q50 70 68 58', 'none', 0.7, { stroke: p.b, width: 1.2 }),
      shapeCircle(46, 39, 2, p.b),
      shapeCircle(56, 53, 2, p.b),
      shapeCircle(42, 59, 2, p.b),
      shapeCircle(60, 70, 2, p.b),
      shapeCircle(45, 76, 2, p.b),
      shapeCircle(62, 62, 1.6, p.c),
      shapeCircle(38, 72, 1.6, p.c),
      shapePath(coverStar(50, 20, 6, 2.6, 5), p.b),
      shapeRect(46, 82, 8, 6, p.b),
      shapeLine(14, 88, 86, 88, p.c, 1, 0.4),
    ],
  },
  {
    id: 'wreath',
    name: 'Wreath',
    draw: (p) => {
      const out = [];
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * 360;
        const rad = (a * Math.PI) / 180;
        const x = coverRound(50 + 22 * Math.cos(rad));
        const y = coverRound(48 + 22 * Math.sin(rad));
        out.push(shapeEllipse(x, y, 9, 4.5, p.a, i % 2 ? 0.7 : 1, `rotate(${a + 90 + (i % 2 ? 30 : -30)} ${x} ${y})`));
      }
      [30, 100, 160, 220, 300].forEach((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x = 50 + 23 * Math.cos(rad);
        const y = 48 + 23 * Math.sin(rad);
        out.push(shapeCircle(coverRound(x), coverRound(y), 2, p.b), shapeCircle(coverRound(x + 3), coverRound(y + 1.5), 1.6, p.b));
      });
      return out.concat([
        shapePath('M48 74L42 88L46 86L48 90L50 76Z', p.b),
        shapePath('M52 74L58 88L54 86L52 90L50 76Z', p.b),
        shapePath('M50 72C42 64 35 70 40 76C44 80 48 76 50 72Z', p.b),
        shapePath('M50 72C58 64 65 70 60 76C56 80 52 76 50 72Z', p.b),
        shapeCircle(50, 73, 2.6, p.b),
      ]);
    },
  },
  {
    id: 'candycane',
    name: 'Candy cane',
    draw: (p, r) => {
      const out = [];
      for (let i = 0; i < 14; i++) out.push(shapeCircle(coverRound(r() * 100), coverRound(r() * 100), coverRound(0.5 + r() * 0.8), p.c, 0.4));
      const d = 'M58 86V38A12 12 0 0 0 34 38V44';
      return out.concat([
        shapePath(d, 'none', 1, { stroke: p.c, width: 10 }),
        shapePath(d, 'none', 1, { stroke: p.b, width: 10, dash: '5 5' }),
        shapePath('M58 64l-6 -4l-4 8z', p.a),
        shapePath('M58 64l6 -4l4 8z', p.a),
      ]);
    },
  },
  {
    id: 'northstar',
    name: 'North star',
    draw: (p, r) => {
      const out = [];
      for (let i = 0; i < 12; i++) out.push(shapeCircle(coverRound(r() * 100), coverRound(r() * 70), coverRound(0.4 + r() * 0.6), p.c, 0.7));
      return out.concat([
        shapeCircle(50, 40, 14, p.a, 0.12),
        shapePath(coverStar(50, 40, 28, 4, 4), p.a),
        shapePath(coverStar(50, 40, 12, 3, 4, 45), p.c, 0.7),
        shapePath(coverRidge(r, 86, 4, 3, true), p.bottom),
      ]);
    },
  },
  {
    id: 'bells',
    name: 'Bells',
    draw: (p) => {
      const bell = 'M0 -16C-8 -16 -10 -8 -10 0C-10 6 -13 9 -15 11H15C13 9 10 6 10 0C10 -8 8 -16 0 -16Z';
      const at = (x, turn) => `translate(${x} 54) rotate(${turn})`;
      return [
        shapeLine(50, 31, 36, 38.5, p.b, 1.6),
        shapeLine(50, 31, 64, 38.5, p.b, 1.6),
        coverTurn(shapeCircle(0, 13, 3, p.b), at(40, -14)),
        coverTurn(shapeCircle(0, 13, 3, p.b), at(60, 14)),
        coverTurn(shapePath(bell, p.a), at(40, -14)),
        coverTurn(shapePath(bell, p.a), at(60, 14)),
        shapePath('M50 31C43 23 37 28 41 33C44 36 48 33 50 31Z', p.b),
        shapePath('M50 31C57 23 63 28 59 33C56 36 52 33 50 31Z', p.b),
        shapeCircle(50, 31, 2.4, p.b),
      ];
    },
  },
  {
    id: 'cocoa',
    name: 'Cocoa',
    draw: (p) => [
      shapePath('M40 34C37 30 43 27 40 22', 'none', 0.5, { stroke: p.c, width: 1.4 }),
      shapePath('M50 32C47 28 53 25 50 20', 'none', 0.4, { stroke: p.c, width: 1.4 }),
      shapePath('M64 52H70A8 8 0 0 1 70 70H64', 'none', 1, { stroke: p.a, width: 4 }),
      shapeRect(28, 44, 36, 40, p.a, 1, { rx: 4 }),
      shapeRect(28, 60, 36, 6, p.b, 0.9),
      shapeRect(33, 39, 6, 6, p.c, 1, { rx: 1, transform: 'rotate(-12 36 42)' }),
      shapeRect(43, 38, 6, 6, p.c, 1, { rx: 1, transform: 'rotate(10 46 41)' }),
      shapeRect(52, 40, 6, 6, p.c, 1, { rx: 1, transform: 'rotate(-6 55 43)' }),
      shapeEllipse(46, 88, 26, 3.5, p.b, 0.6),
    ],
  },
  {
    id: 'clock',
    name: 'Clock',
    draw: (p, r) => {
      const out = [shapeCircle(50, 50, 30, p.c), shapeRing(50, 50, 30, p.a, 4)];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const inner = i % 3 ? 24.5 : 22;
        out.push(shapeLine(coverRound(50 + inner * Math.sin(a)), coverRound(50 - inner * Math.cos(a)), coverRound(50 + 26 * Math.sin(a)), coverRound(50 - 26 * Math.cos(a)), p.bottom, i % 3 ? 1 : 1.8, 0.7));
      }
      const hour = r() * Math.PI * 2;
      const minute = r() * Math.PI * 2;
      return out.concat([
        shapeLine(50, 50, coverRound(50 + 13 * Math.sin(hour)), coverRound(50 - 13 * Math.cos(hour)), p.bottom, 3),
        shapeLine(50, 50, coverRound(50 + 20 * Math.sin(minute)), coverRound(50 - 20 * Math.cos(minute)), p.bottom, 2),
        shapeCircle(50, 50, 2.4, p.b),
      ]);
    },
  },
  {
    id: 'camera',
    name: 'Camera',
    draw: (p) => [
      shapePath('M36 37L40 28H60L64 37Z', p.a),
      shapeRect(22, 31, 8, 5, p.b),
      shapeRect(16, 36, 68, 40, p.a, 1, { rx: 5 }),
      shapeRect(16, 44, 68, 4, p.bottom, 0.25),
      shapeCircle(50, 56, 15, p.b),
      shapeCircle(50, 56, 10, p.bottom),
      shapeCircle(50, 56, 5, p.b, 0.6),
      shapeCircle(46, 52, 2, p.c, 0.7),
      shapeRect(70, 40, 9, 5, p.c, 0.8),
    ],
  },
  {
    id: 'bulb',
    name: 'Bulb',
    draw: (p) => {
      const out = [shapeCircle(50, 38, 28, p.a, 0.12)];
      [-150, -120, -90, -60, -30].forEach((deg) => {
        const a = (deg * Math.PI) / 180;
        out.push(shapeLine(coverRound(50 + 30 * Math.cos(a)), coverRound(38 + 30 * Math.sin(a)), coverRound(50 + 37 * Math.cos(a)), coverRound(38 + 37 * Math.sin(a)), p.a, 1.6, 0.7));
      });
      return out.concat([
        shapePath('M50 16C38 16 30 25 30 36C30 44 35 49 39 54C41 57 42 60 42 63H58C58 60 59 57 61 54C65 49 70 44 70 36C70 25 62 16 50 16Z', p.a),
        shapePath('M45 60L46 42L50 46L54 42L55 60', 'none', 1, { stroke: p.b, width: 1.3 }),
        shapeRect(42, 64, 16, 4, p.c, 0.9, { rx: 1 }),
        shapeRect(43, 69, 14, 4, p.c, 0.75, { rx: 1 }),
        shapeRect(45, 74, 10, 3, p.c, 0.6, { rx: 1 }),
      ]);
    },
  },
  {
    id: 'quill',
    name: 'Quill',
    draw: (p) => [
      shapePath('M74 12C60 16 42 32 34 58L38 60C50 44 66 30 74 12Z', p.a),
      shapePath('M74 12C60 26 46 42 32 70', 'none', 0.7, { stroke: p.c, width: 1 }),
      shapeLine(34, 63, 30, 72, p.c, 1.4),
      shapeRect(28, 70, 10, 5, p.b),
      shapeRect(22, 74, 22, 14, p.b, 1, { rx: 3 }),
      shapePath('M52 84C58 80 62 88 68 84S78 80 84 84', 'none', 0.45, { stroke: p.c, width: 1.2 }),
    ],
  },
  {
    id: 'notes',
    name: 'Notes',
    draw: (p) => [
      ...[30, 40, 50, 60, 70].map((y) => shapeLine(8, y, 92, y, p.c, 0.8, 0.25)),
      shapeLine(43, 68, 43, 31, p.a, 3.4),
      shapeLine(73, 60, 73, 23, p.a, 3.4),
      shapePath('M41.3 26L74.7 18V26L41.3 34Z', p.a),
      shapeEllipse(36, 70, 8, 5.6, p.a, 1, 'rotate(-20 36 70)'),
      shapeEllipse(66, 62, 8, 5.6, p.a, 1, 'rotate(-20 66 62)'),
    ],
  },
  {
    id: 'tulips',
    name: 'Tulips',
    draw: (p) => {
      const tulip = (x, y, ink) =>
        shapePath(`M${x - 6} ${y}C${x - 6} ${y - 8} ${x - 6} ${y - 12} ${x - 6} ${y - 14}L${x - 3} ${y - 10}L${x} ${y - 15}L${x + 3} ${y - 10}L${x + 6} ${y - 14}C${x + 6} ${y - 12} ${x + 6} ${y - 8} ${x + 6} ${y}C${x + 6} ${y + 5} ${x - 6} ${y + 5} ${x - 6} ${y}Z`, ink);
      return [
        shapePath('M50 88C50 70 34 62 32 46', 'none', 0.8, { stroke: p.c, width: 1.6 }),
        shapePath('M50 88C50 66 50 50 50 36', 'none', 0.8, { stroke: p.c, width: 1.6 }),
        shapePath('M50 88C52 72 66 64 68 52', 'none', 0.8, { stroke: p.c, width: 1.6 }),
        shapeEllipse(42, 78, 4, 12, p.c, 0.5, 'rotate(-30 42 78)'),
        shapeEllipse(58, 80, 4, 12, p.c, 0.5, 'rotate(30 58 80)'),
        tulip(32, 46, p.b),
        tulip(50, 36, p.a),
        tulip(68, 52, p.b),
        shapeLine(14, 88, 86, 88, p.c, 1, 0.4),
      ];
    },
  },
  // Subjects I.
  {
    id: 'openbook',
    name: 'Open book',
    draw: (p, r) => {
      const out = [
        shapeCircle(coverRound(42 + r() * 16), 54, 36, p.c, 0.1),
        shapePath('M12 48Q31 42 50 50Q69 42 88 48V78Q69 72 50 80Q31 72 12 78Z', p.b),
        shapePath('M15 46Q32 40 49 48V75Q32 68 15 74Z', p.a),
        shapePath('M85 46Q68 40 51 48V75Q68 68 85 74Z', p.a),
        shapeLine(50, 48, 50, 77, p.bottom, 0.8, 0.4),
      ];
      const rows = 2 + Math.floor(r() * 2);
      [0, 6, 12].forEach((k, i) => {
        out.push(shapePath(`M20 ${51 + k}Q32 ${46 + k} 44 ${52 + k}`, 'none', 0.35, { stroke: p.bottom, width: 1.2 }));
        if (i < rows) out.push(shapePath(`M80 ${51 + k}Q68 ${46 + k} 56 ${52 + k}`, 'none', 0.35, { stroke: p.bottom, width: 1.2 }));
      });
      return out.concat([shapePath('M54 76V90L57 87L60 90V76Z', p.c)]);
    },
  },
  {
    id: 'inkwell',
    name: 'Inkwell',
    draw: (p, r) => {
      const tip = coverRound(68 + r() * 14);
      return [
        shapeLine(8, 82, 92, 82, p.c, 1, 0.5),
        shapeLine(52, 60, tip, 14, p.b, 3.4),
        shapeCircle(tip, 14, 2.6, p.c),
        shapePath('M32 82V64Q32 56 40 56H60Q68 56 68 64V82Z', p.a),
        shapeRect(42, 48, 16, 9, p.a),
        shapeRect(39, 45, 22, 4, p.b, 1, { rx: 1 }),
        shapeRect(32, 68, 36, 7, p.b, 0.85),
        shapePath('M36 64Q36 60 40 59', 'none', 0.5, { stroke: p.c, width: 1.6 }),
        shapeCircle(22, 80, 2, p.b),
        shapeCircle(27, 81, 1.2, p.b),
      ];
    },
  },
  {
    id: 'dialogue',
    name: 'Dialogue',
    draw: (p, r) => {
      const w = coverRound(14 + r() * 14);
      return [
        shapeRect(12, 20, 50, 32, p.a, 1, { rx: 10 }),
        shapePath('M22 50L18 64L34 51Z', p.a),
        shapeCircle(26, 36, 3.2, p.bottom, 0.55),
        shapeCircle(37, 36, 3.2, p.bottom, 0.55),
        shapeCircle(48, 36, 3.2, p.bottom, 0.55),
        shapeRect(38, 46, 50, 30, p.b, 1, { rx: 10 }),
        shapePath('M78 74L84 88L68 75Z', p.b),
        shapeLine(48, 56, 78, 56, p.c, 2.6, 0.85),
        shapeLine(48, 65, 48 + w, 65, p.c, 2.6, 0.85),
      ];
    },
  },
  {
    id: 'letterform',
    name: 'Letterform',
    draw: (p, r) => [
      shapeCircle(coverRound(44 + r() * 12), coverRound(44 + r() * 8), 30, p.b, 0.9),
      shapePath('M10 18H90', 'none', 0.4, { stroke: p.c, width: 0.8, dash: '2 2' }),
      shapeLine(10, 82, 90, 82, p.c, 0.8, 0.4),
      shapePath('M27 80H31L52 24L50 18Z', p.a),
      shapePath('M46 18H54L76 80H65Z', p.a),
      shapeRect(34, 58, 26, 4, p.a),
      shapeRect(21, 79, 16, 3, p.a),
      shapeRect(59, 79, 23, 3, p.a),
    ],
  },
  {
    id: 'geometry',
    name: 'Geometry',
    draw: (p, r) => {
      const flip = r() < 0.5;
      const sq = flip ? 72 : 14;
      const ring = flip ? 22 : 80;
      return [
        shapePath('M50 16L86 78H14Z', p.a),
        shapeCircle(50, 57.3, 20.7, p.b),
        shapePath('M50 16V78', 'none', 0.6, { stroke: p.bottom, width: 1, dash: '2 2' }),
        shapePath('M50 74H54V78', 'none', 0.6, { stroke: p.bottom, width: 1 }),
        shapePath(`M${sq} 14h14v14h-14z`, 'none', 0.8, { stroke: p.c, width: 1.6 }),
        shapeRing(ring, 21, 7, p.c, 1.6, 0.8),
        shapeCircle(50, 16, 2.2, p.c),
        shapeCircle(86, 78, 2.2, p.c),
        shapeCircle(14, 78, 2.2, p.c),
      ];
    },
  },
  {
    id: 'compass',
    name: 'Compass',
    draw: (p, r) => {
      const s = coverRound(14 + r() * 6);
      const ticks = [...Array(13)].map((_, i) => `M${14 + i * 6} 76v${i % 2 ? 3 : 5}`).join('');
      return [
        shapePath(`M${50 + s} 70A${2 * s} ${2 * s} 0 0 0 ${coverRound(50 - 2.29 * s)} ${coverRound(70 - 1.53 * s)}`, 'none', 0.6, { stroke: p.c, width: 1.2, dash: '3 2' }),
        shapeRect(8, 76, 84, 10, p.b, 1, { rx: 1 }),
        shapePath(ticks, 'none', 0.5, { stroke: p.bottom, width: 1 }),
        shapeLine(50, 24, 50 - s, 70, p.a, 3.2),
        shapeLine(50, 24, 50 + s, 70, p.a, 3.2),
        shapeLine(50 - s, 70, 50 - s, 74, p.c, 1.2),
        shapePath(`M${50 + s - 2} 66H${50 + s + 2}L${50 + s} 72Z`, p.c),
        shapeLine(50 - s / 2, 47, 50 + s / 2, 47, p.a, 1.4, 0.8),
        shapeCircle(50, 24, 5, p.b),
        shapeRect(48.5, 12, 3, 9, p.a, 1, { rx: 1.5 }),
      ];
    },
  },
  {
    id: 'atom',
    name: 'Atom',
    draw: (p, r) => {
      const out = [shapeCircle(50, 50, 40, p.c, 0.08)];
      const dots = [];
      [0, 60, 120].forEach((t, i) => {
        out.push(Object.assign(shapeEllipse(50, 50, 36, 13, 'none', 1, `rotate(${t} 50 50)`), { stroke: p.a, width: 2 }));
        const a = r() * Math.PI * 2;
        dots.push(coverTurn(shapeCircle(coverRound(50 + 36 * Math.cos(a)), coverRound(50 + 13 * Math.sin(a)), 3, i % 2 ? p.c : p.b), `rotate(${t} 50 50)`));
      });
      return out.concat([shapeCircle(50, 50, 8, p.b), shapeCircle(47.5, 47.5, 3, p.a, 0.7)], dots);
    },
  },
  {
    id: 'prism',
    name: 'Prism',
    draw: (p, r) => {
      const f = coverRound(7 + r() * 4);
      const e = [0, 1, 2, 3].map((k) => 40 + k * f);
      return [
        shapeLine(8, 70, 92, 70, p.c, 1, 0.4),
        shapePath('M0 60L35 51V53.5L0 64Z', p.c, 0.85),
        shapePath(`M63 46.5L100 ${e[0]}V${e[1]}L63 48Z`, p.a),
        shapePath(`M63 48L100 ${e[1]}V${e[2]}L63 49.5Z`, p.b),
        shapePath(`M63 49.5L100 ${e[2]}V${e[3]}L63 51Z`, p.c, 0.6),
        shapePath('M35 51L63 46.5V51L35 53.5Z', p.c, 0.35),
        shapePath('M50 22L74 70H26Z', p.c, 1, { fillOpacity: 0.15, stroke: p.a, width: 2 }),
      ];
    },
  },
  {
    id: 'flask',
    name: 'Flask',
    draw: (p, r) => {
      const y = coverRound(56 + r() * 10);
      const x = coverRound(44 - ((y - 40) / 38) * 20);
      return [
        shapeLine(10, 84, 90, 84, p.c, 1, 0.5),
        shapePath(`M${x} ${y}H${100 - x}L76 78Q78 84 72 84H28Q22 84 24 78Z`, p.b),
        shapeLine(x, y, 100 - x, y, p.a, 1.2, 0.6),
        shapeCircle(44, 74, 2.6, p.c, 0.7),
        shapeCircle(56, 70, 1.8, p.c, 0.7),
        shapePath('M42 16H58V21H56V40L76 78Q78 84 72 84H28Q22 84 24 78L44 40V21H42Z', p.c, 1, { fillOpacity: 0.15, stroke: p.a, width: 2.2 }),
        shapeCircle(52, 10, 2.4, p.c, 0.6),
        shapeCircle(47, 4, 1.6, p.c, 0.45),
      ];
    },
  },
  {
    id: 'cell',
    name: 'Cell',
    draw: (p, r) => [
      Object.assign(shapeRect(16, 20, 68, 60, p.c, 1, { rx: 10 }), { fillOpacity: 0.12, stroke: p.a, width: 3 }),
      Object.assign(shapeRect(21, 25, 58, 50, 'none', 0.5, { rx: 7 }), { stroke: p.a, width: 1 }),
      shapePath(coverBlob(57, 54, [15, 13, 16, 12, 15, 13].map((v) => v + r() * 3)), p.c, 0.28),
      shapeCircle(33, 38, 9, p.b),
      shapeCircle(35, 36, 3, p.a, 0.8),
      shapeEllipse(30, 64, 6, 3, p.a, 0.9, 'rotate(30 30 64)'),
      shapeEllipse(68, 31, 6, 3, p.a, 0.9, 'rotate(-20 68 31)'),
      shapeEllipse(73, 67, 5, 2.6, p.a, 0.9, 'rotate(60 73 67)'),
      shapeEllipse(50, 31, 5, 2.6, p.a, 0.9, 'rotate(10 50 31)'),
    ],
  },
  {
    id: 'helix',
    name: 'Helix',
    draw: (p, r) => {
      const turn = `rotate(${coverRound(60 + r() * 50)} 50 50)`;
      let rungs = '';
      for (let x = 3; x < 100; x += 5.5) {
        const u = (x % 25) / 25;
        const d = 72 * u * (1 - u);
        if (d > 5) rungs += `M${coverRound(x)} ${coverRound(50 - d)}V${coverRound(50 + d)}`;
      }
      const out = [
        shapeCircle(50, 50, 30, p.c, 0.08),
        shapePath(rungs, 'none', 0.55, { stroke: p.c, width: 1.6 }),
        shapePath(coverWave(50, 36, 2, 0.5, true), 'none', 0.9, { stroke: p.b, width: 3.2 }),
        shapePath(coverWave(50, 36, 2, 0, true), 'none', 1, { stroke: p.a, width: 3.2 }),
      ];
      [12.5, 37.5, 62.5, 87.5].forEach((x, i) => {
        const up = i % 2 ? 18 : -18;
        out.push(shapeCircle(x, 50 + up, 2.8, p.a), shapeCircle(x, 50 - up, 2.8, p.b));
      });
      return out.map((s) => coverTurn(s, turn));
    },
  },
  {
    id: 'telescope',
    name: 'Telescope',
    draw: (p, r) => {
      const turn = 'rotate(-28 46 50)';
      return [
        shapePath(coverStar(22, 18, 3, 1.2, 4), p.c, 0.8),
        shapePath(coverStar(coverRound(40 + r() * 14), 12, 2.2, 0.9, 4), p.c, 0.6),
        shapeCircle(coverRound(66 + r() * 18), 20, 8, p.a),
        shapeLine(46, 52, 30, 84, p.c, 2),
        shapeLine(46, 52, 62, 84, p.c, 2),
        shapeLine(46, 52, 46, 86, p.c, 2),
        shapePath(coverRidge(r, 84, 2, 3, true), p.b),
        coverTurn(shapeRect(20, 44, 46, 10, p.a, 1, { rx: 2 }), turn),
        coverTurn(shapeRect(62, 41, 10, 16, p.b, 1, { rx: 1.5 }), turn),
        coverTurn(shapeRect(14, 46, 7, 6, p.c), turn),
        shapeCircle(46, 51, 3, p.c),
      ];
    },
  },
  {
    id: 'ringed',
    name: 'Ringed planet',
    draw: (p, r) => {
      const turn = `rotate(${coverRound(-12 - r() * 14)} 50 50)`;
      return [
        shapeCircle(16, 20, 1.4, p.c, 0.8),
        shapeCircle(84, 78, 1.2, p.c, 0.7),
        shapeCircle(coverRound(20 + r() * 20), 84, 1, p.c, 0.6),
        coverTurn(shapePath('M8 50A42 10 0 0 1 92 50', 'none', 0.9, { stroke: p.b, width: 4 }), turn),
        shapeCircle(50, 50, 22, p.a),
        coverTurn(shapePath('M28 50A22 22 0 0 0 72 50Z', p.b, 0.35), turn),
        coverTurn(shapePath('M8 50A42 10 0 0 0 92 50', 'none', 1, { stroke: p.b, width: 4 }), turn),
        shapeCircle(coverRound(74 + r() * 8), 22, 4, p.c),
      ];
    },
  },
  {
    id: 'brackets',
    name: 'Brackets',
    draw: (p, r) => {
      const w = [r(), r(), r()].map((v) => coverRound(8 + v * 14));
      return [
        shapePath('M34 18Q24 18 24 28V42Q24 50 16 50Q24 50 24 58V72Q24 82 34 82', 'none', 1, { stroke: p.a, width: 5 }),
        shapePath('M66 18Q76 18 76 28V42Q76 50 84 50Q76 50 76 58V72Q76 82 66 82', 'none', 1, { stroke: p.a, width: 5 }),
        shapeLine(36, 36, 36 + w[0], 36, p.c, 3.2, 0.85),
        shapeLine(42, 46, 42 + w[1], 46, p.b, 3.2),
        shapeLine(42, 56, 42 + w[2], 56, p.c, 3.2, 0.85),
        shapeLine(36, 66, 48, 66, p.c, 3.2, 0.85),
        shapeRect(51, 62, 4, 8, p.b),
      ];
    },
  },
  {
    id: 'circuit',
    name: 'Circuit',
    draw: (p, r) => {
      const pins = [40, 47, 54, 61].map((v) => `M${v} 34V29M${v} 66V71M34 ${v}H29M66 ${v}H71`).join('');
      const ends = [[24, 10], [61, 12], [86, 30], [90, 61], [76, 86], [40, 90], [12, 70], [12, 40]];
      return [
        shapePath('M47 29V18H24V10M61 29V12M71 47H86V30M71 61H90M54 71V86H76M40 71V90M29 54H12V70M29 40H12', 'none', 0.7, { stroke: p.c, width: 1.4 }),
        shapePath(pins, 'none', 1, { stroke: p.a, width: 2.4 }),
        shapeRect(34, 34, 32, 32, p.a, 1, { rx: 2 }),
        shapeRect(42, 42, 16, 16, p.bottom, 0.25, { rx: 1 }),
        shapeCircle(38.5, 38.5, 1.6, p.bottom, 0.5),
      ].concat(ends.map(([x, y]) => shapeRing(x, y, 2.6, r() < 0.5 ? p.b : p.a, 1.8)));
    },
  },
  {
    id: 'scales',
    name: 'Scales',
    draw: (p, r) => {
      const dy = coverRound((r() - 0.5) * 10);
      const pan = (x, y) => [
        shapePath(`M${x - 9} ${y}L${x} ${y - 26}L${x + 9} ${y}`, 'none', 0.8, { stroke: p.c, width: 1 }),
        shapePath(`M${x - 11} ${y}A11 6 0 0 0 ${x + 11} ${y}Z`, p.b),
      ];
      return [
        shapeCircle(50, 52, 34, p.c, 0.08),
        shapePath('M32 86H68L61 79H39Z', p.a),
        shapeRect(48, 24, 4, 56, p.a),
        shapeLine(20, 30 + dy, 80, 30 - dy, p.a, 2.6),
        shapeCircle(50, 20, 4, p.b),
        ...pan(20, 56 + dy),
        ...pan(80, 56 - dy),
      ];
    },
  },
  {
    id: 'column',
    name: 'Column',
    draw: (p, r) => [
      shapeCircle(coverRound(40 + r() * 20), coverRound(36 + r() * 8), 30, p.c, 0.12),
      shapeRect(16, 82, 68, 6, p.b),
      shapeRect(22, 76, 56, 6, p.b, 0.85),
      shapeRect(33, 71, 34, 5, p.a),
      shapePath('M37 71L39 30H61L63 71Z', p.a),
      shapePath('M44.5 33V68M50 33V68M55.5 33V68', 'none', 0.3, { stroke: p.bottom, width: 1.2 }),
      shapePath('M36 30Q36 25 31 24H69Q64 25 64 30Z', p.a),
      shapeRect(28, 18, 44, 6, p.a),
    ],
  },
  {
    id: 'scroll',
    name: 'Scroll',
    draw: (p, r) => {
      const lines = [36, 43, 50, 57].map((y) => `M31 ${y}H${coverRound(52 + r() * 18)}`).join('');
      return [
        shapeRect(24, 24, 52, 52, p.a),
        shapePath(lines, 'none', 0.35, { stroke: p.bottom, width: 2 }),
        shapeRect(20, 19, 60, 9, p.b, 1, { rx: 4.5 }),
        shapeRect(20, 72, 60, 9, p.b, 1, { rx: 4.5 }),
        shapeCircle(17, 23.5, 3.2, p.c),
        shapeCircle(83, 23.5, 3.2, p.c),
        shapeCircle(17, 76.5, 3.2, p.c),
        shapeCircle(83, 76.5, 3.2, p.c),
        shapeCircle(62, 64, 5, p.b),
      ];
    },
  },
  {
    id: 'ruins',
    name: 'Ruins',
    draw: (p, r) => {
      const broken = (x, top) => shapePath(`M${x} 78V${top}L${x + 3} ${top - 3}L${x + 6} ${top + 1}L${x + 10} ${top - 2}V78Z`, p.a);
      return [
        shapeCircle(coverRound(56 + r() * 24), 54, 18, p.b, 0.9),
        shapePath(coverRidge(r, 66, 4, 4, true), p.c, 0.15),
        shapeRect(0, 78, 100, 22, p.bottom),
        broken(16, 46),
        shapeRect(38, 30, 10, 48, p.a),
        shapeRect(35, 25, 16, 5, p.a),
        broken(60, 62),
        coverTurn(shapeRect(74, 72, 20, 6, p.a), 'rotate(-6 84 75)'),
        shapeLine(0, 78, 100, 78, p.c, 1, 0.4),
      ];
    },
  },
  {
    id: 'owl',
    name: 'Owl',
    draw: (p, r) => {
      const look = coverRound((r() - 0.5) * 3);
      return [
        shapeCircle(coverRound(22 + r() * 56), 26, 14, p.c, 0.15),
        shapePath('M30 28L37 40Q28 50 30 66Q34 84 50 84Q66 84 70 66Q72 50 63 40L70 28L58 35Q50 32 42 35Z', p.a),
        shapeEllipse(50, 70, 12, 11, p.b, 0.45),
        shapeCircle(41, 47, 8, p.bottom),
        shapeCircle(59, 47, 8, p.bottom),
        shapeCircle(41 + look, 47, 3.6, p.b),
        shapeCircle(59 + look, 47, 3.6, p.b),
        shapePath('M47 53H53L50 59Z', p.b),
        shapeRect(12, 84, 76, 4, p.b, 1, { rx: 2 }),
      ];
    },
  },
  {
    id: 'map',
    name: 'Map',
    draw: (p, r) => {
      const bend = coverRound(36 + r() * 16);
      return [
        shapePath('M14 24L38 30V80L14 74Z', p.a),
        shapePath('M38 30L62 24V74L38 80Z', p.a),
        shapePath('M62 24L86 30V80L62 74Z', p.a),
        shapePath(coverBlob(40, 52, [12, 9, 14, 10, 13, 8, 11].map((v) => v + r() * 3)), p.b, 0.3),
        shapePath('M38 30L62 24V74L38 80Z', p.bottom, 0.18),
        shapePath(`M20 68Q32 ${bend} 48 58T78 40`, 'none', 1, { stroke: p.b, width: 1.8, dash: '3 2.5' }),
        shapeCircle(20, 68, 2.2, p.b),
        shapePath('M78 42C74 36 70 33 70 28A8 8 0 0 1 86 28C86 33 82 36 78 42Z', p.b),
        shapeCircle(78, 28, 3, p.a),
      ];
    },
  },
  {
    id: 'coins',
    name: 'Coins',
    draw: (p, r) => {
      const out = [shapeLine(8, 84, 92, 84, p.c, 1, 0.5)];
      [24, 48, 72].forEach((cx) => {
        const n = 3 + Math.floor(r() * 6);
        const top = 82 - n * 4;
        const edges = [...Array(n - 1)].map((_, i) => `M${cx - 10} ${top + (i + 1) * 4}h20`).join('');
        out.push(
          shapeRect(cx - 10, top, 20, n * 4, p.a),
          shapePath(edges, 'none', 0.35, { stroke: p.bottom, width: 0.8 }),
          Object.assign(shapeEllipse(cx, top, 10, 3, p.c), { stroke: p.bottom, width: 0.8 }),
        );
      });
      return out.concat([shapeCircle(60, 72, 12, p.b), shapeRing(60, 72, 8.5, p.a, 1.4, 0.8), shapePath(coverStar(60, 72, 5, 2.2, 5), p.a)]);
    },
  },
  {
    id: 'barchart',
    name: 'Bar chart',
    draw: (p, r) => {
      const tops = [0, 1, 2, 3, 4].map((k) => coverRound(70 - k * 11 - r() * 8));
      const pts = tops.map((y, k) => [26.5 + k * 13, y - 7]);
      const [[x0, y0], [x1, y1]] = pts.slice(3);
      const turn = coverRound((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI);
      return [
        shapePath('M16 16V82H88', 'none', 0.7, { stroke: p.c, width: 1.6 }),
        ...tops.map((y, k) => shapeRect(22 + k * 13, y, 9, coverRound(82 - y), k === 4 ? p.b : p.a)),
        shapePath(`M${pts.map((pt) => pt.join(' ')).join('L')}`, 'none', 1, { stroke: p.c, width: 2 }),
        coverTurn(shapePath('M0 -4L7 0L0 4Z', p.c), `translate(${x1} ${y1}) rotate(${turn})`),
      ];
    },
  },
  {
    id: 'briefcase',
    name: 'Briefcase',
    draw: (p, r) => {
      const turn = `rotate(${coverRound((r() - 0.5) * 8)} 50 80)`;
      return [shapeEllipse(50, 82, 38, 4, p.bottom, 0.5)].concat(
        [
          shapePath('M40 34V28Q40 24 44 24H56Q60 24 60 28V34', 'none', 1, { stroke: p.a, width: 4 }),
          shapeRect(18, 32, 64, 48, p.b, 1, { rx: 5 }),
          shapeRect(18, 32, 64, 20, p.bottom, 0.15, { rx: 5 }),
          shapeLine(18, 52, 82, 52, p.bottom, 1.2, 0.4),
          shapeRect(29, 32, 5, 48, p.a, 0.9),
          shapeRect(66, 32, 5, 48, p.a, 0.9),
          shapeRect(45, 47, 10, 10, p.a, 1, { rx: 1.5 }),
          shapeRect(48.5, 51, 3, 3, p.b),
        ].map((s) => coverTurn(s, turn)),
      );
    },
  },
  {
    id: 'pulse',
    name: 'Pulse',
    draw: (p, r) => {
      const beat = `M0 54H30L36 44L42 66L50 ${coverRound(22 + r() * 10)}L58 ${coverRound(70 + r() * 8)}L64 50L68 54H86`;
      return [
        shapeCircle(50, 50, 32, p.c, 0.1),
        shapePath('M40 18H60V40H82V60H60V82H40V60H18V40H40Z', p.b),
        shapePath('M44 22H56V44H78V56H56V78H44V56H22V44H44Z', 'none', 0.4, { stroke: p.a, width: 1 }),
        shapePath(beat, 'none', 0.35, { stroke: p.bottom, width: 7 }),
        shapePath(beat, 'none', 1, { stroke: p.a, width: 3 }),
        shapeCircle(88, 54, 2.8, p.a),
      ];
    },
  },
  {
    id: 'psi',
    name: 'Psyche',
    draw: (p, r) => [
      shapeRing(50, 50, coverRound(36 + r() * 6), p.c, 1, 0.2),
      shapeRing(50, 50, coverRound(44 + r() * 6), p.c, 1, 0.12),
      shapeCircle(50, 50, 28, p.b, 0.9),
      shapePath('M30 26V40Q30 60 50 60Q70 60 70 40V26', 'none', 1, { stroke: p.a, width: 6 }),
      shapeLine(50, 20, 50, 80, p.a, 6),
      shapeLine(42, 80, 58, 80, p.a, 4),
      shapeLine(25, 26, 35, 26, p.a, 3),
      shapeLine(65, 26, 75, 26, p.a, 3),
      shapeLine(45, 20, 55, 20, p.a, 3),
    ],
  },
  {
    id: 'blackboard',
    name: 'Blackboard',
    draw: (p, r) => {
      const [tx, cx] = r() < 0.5 ? [52, 34] : [22, 66];
      return [
        shapeLine(26, 70, 18, 90, p.b, 3),
        shapeLine(74, 70, 82, 90, p.b, 3),
        shapeRect(12, 18, 76, 52, p.b, 1, { rx: 2 }),
        shapeRect(16, 22, 68, 44, p.bottom),
        shapePath(`M${tx} 56L${tx + 12} 32L${tx + 24} 56Z`, 'none', 0.85, { stroke: p.c, width: 1.4 }),
        shapeRing(cx, 42, 9, p.c, 1.4, 0.85),
        shapePath(`M${cx - 9} 59q3 -4 6 0t6 0t6 0`, 'none', 0.85, { stroke: p.c, width: 1.4 }),
        shapeRect(10, 70, 80, 3, p.b),
        shapeRect(62, 67.5, 8, 2.5, p.c),
      ];
    },
  },
  {
    id: 'microscope',
    name: 'Microscope',
    draw: (p, r) => {
      const turn = `rotate(${coverRound(-14 - r() * 12)} 44 52)`;
      return [
        shapeCircle(46, 60, 14, p.c, 0.12),
        shapePath('M58 76Q76 58 50 38', 'none', 1, { stroke: p.a, width: 7 }),
        shapePath('M24 84H76Q76 76 68 76H32Q24 76 24 84Z', p.a),
        shapeRect(28, 60, 36, 4, p.c),
        shapeRect(36, 57.5, 16, 2.5, p.b, 0.9),
        coverTurn(shapeRect(38, 20, 12, 30, p.b, 1, { rx: 2 }), turn),
        coverTurn(shapeRect(40, 13, 8, 8, p.a, 1, { rx: 1 }), turn),
        coverTurn(shapeRect(41, 49, 6, 6, p.c), turn),
        shapeCircle(66, 54, 4, p.b),
      ];
    },
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    draw: (p, r) => {
      const wx = coverRound(42 + r() * 14);
      const grid = [18, 26, 34, 42, 50, 58, 66, 74, 82].map((v) => `M${v} 14V86M10 ${v}H90`).join('');
      return [
        shapeRect(10, 14, 80, 72, p.b, 0.85),
        shapePath(grid, 'none', 0.18, { stroke: p.c, width: 0.5 }),
        shapePath(`M20 24H80V76H20ZM${wx} 24V48M${wx} 58V76M${wx} 48H${wx + 12}M${wx + 22} 48H80`, 'none', 1, { stroke: p.c, width: 2.4 }),
        shapeLine(wx, 58, wx + 10, 58, p.c, 1.2),
        shapePath(`M${wx + 10} 58A10 10 0 0 0 ${wx} 48`, 'none', 0.7, { stroke: p.c, width: 1, dash: '2 1.5' }),
        shapeLine(28, 24, 40, 24, p.a, 4),
        shapeLine(20, 82, 80, 82, p.a, 1),
        shapePath('M20 79V85M80 79V85', 'none', 1, { stroke: p.a, width: 1 }),
      ];
    },
  },
  {
    id: 'gear',
    name: 'Gear',
    draw: (p, r) => {
      const cog = (cx, cy, outer, inner, n, turn) => {
        const pitch = (Math.PI * 2) / n;
        const pts = [];
        for (let i = 0; i < n; i++) {
          [[-0.3, inner], [-0.17, outer], [0.17, outer], [0.3, inner]].forEach(([k, rad]) => pts.push([cx + rad * Math.cos(turn + (i + k) * pitch), cy + rad * Math.sin(turn + (i + k) * pitch)]));
        }
        return coverPoly(pts);
      };
      const turn = r() * Math.PI;
      const holes = [0, 1, 2, 3].map((i) => turn + 0.3 + (i * Math.PI) / 2);
      return [shapePath(cog(40, 58, 27, 21, 10, turn), p.a)]
        .concat(holes.map((a) => shapeCircle(coverRound(40 + 13 * Math.cos(a)), coverRound(58 + 13 * Math.sin(a)), 3.2, p.bottom, 0.45)))
        .concat([
          shapeCircle(40, 58, 7, p.b),
          shapeCircle(40, 58, 2.6, p.bottom),
          shapePath(cog(66, 30, 16, 11.5, 7, (-turn * 10) / 7), p.b),
          shapeCircle(66, 30, 4.5, p.a),
          shapeCircle(66, 30, 1.8, p.bottom),
        ]);
    },
  },
];

/** A number from a name, stable between runs, spread across its bits. */
export function coverSeed(name) {
  let h = 2166136261;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Chance that comes out the same for the same seed. */
export function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function coverDesignById(id) {
  return COVER_DESIGNS.find((d) => d.id === id) || null;
}

/*
 * Designs and palettes come in sets, added over time. A name keeps the
 * one it had as a new set arrives, unless it's one of the share of names
 * the new set takes over — so covers people know stay as they were.
 */
export const COVER_DESIGN_SETS = [COVER_DESIGNS.length];
export const COVER_PALETTE_SETS = [14, COVER_PALETTES.length - 14];

/** Makes the designs from the one called `id` on a set of their own, split off the last set. */
export function splitCoverSet(sets, id) {
  const start = COVER_DESIGNS.findIndex((d) => d.id === id);
  const before = sets.slice(0, -1).reduce((sum, n) => sum + n, 0);
  if (start > before) sets.splice(-1, 1, start - before, COVER_DESIGNS.length - start);
}

// Subjects I: study and work, from Open book on.
splitCoverSet(COVER_DESIGN_SETS, 'openbook');

/** Bits of a seed stirred with a salt, for a second, unrelated choice from the same name. */
export function stirSeed(seed, salt) {
  let h = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Which one of a list in sets a name gets: `first`, its pick from the first set, or one from a later set that takes it over. */
export function stablePick(seed, sets, first, salt) {
  let index = first;
  let total = sets[0];
  for (let g = 1; g < sets.length; g++) {
    if (sets[g] <= 0) continue;
    total += sets[g];
    if (stirSeed(seed, salt + g) % total >= total - sets[g]) index = total - sets[g] + (stirSeed(seed, salt + 50 + g) % sets[g]);
  }
  return index;
}

/** The design a name gets of itself. */
export function namedCoverDesign(name) {
  const seed = coverSeed(name);
  return COVER_DESIGNS[stablePick(seed, COVER_DESIGN_SETS, seed % COVER_DESIGN_SETS[0], 1)];
}

/**
 * A palette in one colour — a chosen one, or the theme's accent, read
 * live — dark below, with that colour's pale tints to print in.
 */
export function tintedPalette(tint) {
  if (tint === 'accent') {
    const h = 'var(--accent-h, 258)';
    const s = 'var(--accent-s, 88%)';
    return {
      id: 'accent',
      top: `hsl(${h} calc(${s} * 0.6) 30%)`,
      bottom: `hsl(${h} calc(${s} * 0.55) 13%)`,
      a: `hsl(${h} 50% 87%)`,
      b: `hsl(${h} ${s} 62%)`,
      c: `hsl(${h} 35% 92%)`,
    };
  }
  const hsl = hexToHsl(tint);
  if (!hsl) return null;
  const s = Math.min(hsl.s, 70);
  return {
    id: 'tint',
    top: `hsl(${hsl.h} ${s}% 30%)`,
    bottom: `hsl(${hsl.h} ${Math.round(s * 0.9)}% 13%)`,
    a: `hsl(${hsl.h} 55% 86%)`,
    b: `hsl(${hsl.h} ${hsl.s}% ${Math.max(45, Math.min(65, hsl.l))}%)`,
    c: `hsl(${hsl.h} 40% 93%)`,
  };
}

/** The palette a name gets of itself. */
export function namedPalette(name) {
  const seed = coverSeed(name);
  return COVER_PALETTES[stablePick(seed, COVER_PALETTE_SETS, Math.floor(seed / 97) % COVER_PALETTE_SETS[0], 7)];
}

/**
 * A cover drawn into an element for `look.art`, the name: its own design
 * or `look.design`, in its own colours or `tint`'s.
 */
export function drawnArt(el, look, tint) {
  const name = String(look.art);
  const design = coverDesignById(look.design) || namedCoverDesign(name);
  const palette = (tint && tint !== 'icon' && tintedPalette(tint)) || namedPalette(name);
  el.addClass('is-drawn');
  el.toggleClass('is-light', !!palette.light);
  el.dataset.design = design.id;
  el.style.backgroundColor = palette.bottom;
  el.style.backgroundImage = `linear-gradient(180deg, ${palette.top}, ${palette.bottom})`;
  const doc = el.ownerDocument;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'dr-drawn');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  design.draw(palette, seededRandom(coverSeed(name))).forEach((shape) => svg.appendChild(drawnShape(doc, shape)));
  el.appendChild(svg);
  return el;
}

/* Colours go in as style, which reads the theme's variables; attributes wouldn't. */
export function drawnShape(doc, shape) {
  const node = doc.createElementNS(SVG_NS, shape.tag);
  Object.keys(shape.at).forEach((key) => {
    if (shape.at[key] !== undefined) node.setAttribute(key, String(shape.at[key]));
  });
  const style = [];
  style.push(`fill: ${shape.fill || 'none'}`);
  if (shape.stroke) {
    style.push(`stroke: ${shape.stroke}`, `stroke-width: ${shape.width || 1}`, `stroke-linecap: ${shape.dash ? 'butt' : 'round'}`, 'stroke-linejoin: round');
    if (shape.dash) style.push(`stroke-dasharray: ${shape.dash}`);
  }
  if (shape.fillOpacity !== undefined) style.push(`fill-opacity: ${shape.fillOpacity}`);
  if (shape.opacity !== undefined && shape.opacity < 1) style.push(`opacity: ${shape.opacity}`);
  node.setAttribute('style', style.join('; '));
  return node;
}
