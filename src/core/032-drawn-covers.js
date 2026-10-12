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

/* Each design: what it's called where one is picked, and its shapes, from a palette and a little chance. */
export const COVER_DESIGNS = [
  {
    id: 'sunset',
    name: 'Sunset',
    draw: (p, r) => {
      const y = coverRound(57 + r() * 8);
      return [
        shapeCircle(50, y, 25, p.a, 0.95),
        shapeRect(0, y, 100, 100 - y, p.bottom),
        shapeLine(36, y + 9, 64, y + 9, p.a, 2, 0.45),
        shapeLine(42, y + 16, 58, y + 16, p.a, 2, 0.28),
      ];
    },
  },
  {
    id: 'moonrise',
    name: 'Moonrise',
    draw: (p, r) => [
      shapeCircle(coverRound(60 + r() * 16), 27, 12, p.a),
      shapeLine(12, 76, 88, 76, p.c, 2.2, 0.85),
      shapeLine(12, 83, 60, 83, p.c, 2.2, 0.5),
    ],
  },
  {
    id: 'bauhaus',
    name: 'Bauhaus',
    draw: (p) => [shapeRect(17, 16, 32, 68, p.a), shapeCircle(62, 56, 21, p.b, 0.95)],
  },
  {
    id: 'night',
    name: 'Night',
    draw: (p) => [shapeCircle(30, 30, 15, p.a, 0.95), shapeRect(50, 50, 36, 36, p.b)],
  },
  {
    id: 'notebook',
    name: 'Notebook',
    draw: (p) => [0, 1, 2, 3, 4, 5].map((i) => shapeLine(14, 26 + i * 10, i === 5 ? 58 : 86, 26 + i * 10, p.c, 2, 0.85)),
  },
  {
    id: 'chart',
    name: 'Chart',
    draw: (p, r) =>
      [0, 1, 2, 3, 4]
        .map((i) => {
          const h = coverRound(18 + r() * 42);
          return shapeRect(15 + i * 15, 80 - h, 10, h, p.a);
        })
        .concat([shapeLine(10, 80, 90, 80, p.c, 1.2, 0.5)]),
  },
  {
    id: 'peaks',
    name: 'Peaks',
    draw: (p) => [
      shapeCircle(76, 24, 7, p.a),
      shapePath('M0 100V80L28 46L48 68L70 38L100 74V100Z', p.b, 0.85),
      shapePath('M0 100V88L22 66L44 86L66 62L100 92V100Z', p.a, 0.92),
    ],
  },
  {
    id: 'tide',
    name: 'Tide',
    draw: (p) =>
      [shapeCircle(72, 28, 8, p.a, 0.9)].concat(
        [52, 64, 76].map((y, i) =>
          shapePath(`M0 ${y}Q12.5 ${y - 6} 25 ${y}T50 ${y}T75 ${y}T100 ${y}V100H0Z`, i === 1 ? p.b : p.a, [0.35, 0.75, 0.95][i])
        )
      ),
  },
  {
    id: 'rings',
    name: 'Rings',
    draw: (p, r) => {
      const x = coverRound(34 + r() * 14);
      return [7, 15, 23, 31, 39, 47, 55].map((radius, i) => shapeRing(x, 62, radius, p.a, 2.2, 0.95 - i * 0.09));
    },
  },
  {
    id: 'halftone',
    name: 'Halftone',
    draw: (p) => {
      const out = [];
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
          const x = 11 + i * 13;
          const y = 11 + j * 13;
          const d = Math.hypot(x - 11, y - 89) / 110;
          out.push(shapeCircle(x, y, coverRound(Math.max(0.6, 5 * (1 - d))), p.a));
        }
      }
      return out;
    },
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    draw: (p) =>
      [
        [40, p.a, 1],
        [31, p.b, 1],
        [22, p.a, 0.55],
        [13, p.bottom, 1],
      ]
        .map(([R, fill, o]) => shapePath(`M${50 - R} 82A${R} ${R} 0 0 1 ${50 + R} 82Z`, fill, o))
        .concat([shapeLine(6, 82, 94, 82, p.c, 1.4, 0.5)]),
  },
  {
    id: 'stripes',
    name: 'Stripes',
    draw: (p) =>
      [-2, -1, 0, 1, 2, 3].map((k) =>
        shapeRect(k * 22 + 6, -40, 11, 180, k % 2 ? p.b : p.a, 0.9, { transform: 'rotate(35 50 50)' })
      ),
  },
  {
    id: 'eclipse',
    name: 'Eclipse',
    draw: (p) => [
      shapeCircle(46, 52, 25, p.a),
      shapeCircle(57, 45, 23, p.bottom),
      shapeCircle(18, 20, 1.2, p.c, 0.8),
      shapeCircle(84, 80, 1, p.c, 0.7),
      shapeCircle(86, 20, 1.4, p.c, 0.8),
    ],
  },
  {
    id: 'steps',
    name: 'Steps',
    draw: (p) => [shapePath('M12 86V70H30V54H48V38H66V22H84V86Z', p.a, 0.92), shapeCircle(28, 30, 7, p.b)],
  },
  {
    id: 'bloom',
    name: 'Bloom',
    draw: (p, r) => {
      const turn = r() * 30;
      const petals = [0, 1, 2, 3, 4, 5].map((k) => {
        const angle = ((k * 60 + turn) * Math.PI) / 180;
        return shapeCircle(coverRound(50 + 17 * Math.cos(angle)), coverRound(50 + 17 * Math.sin(angle)), 13, p.a, 0.72);
      });
      return petals.concat([shapeCircle(50, 50, 8, p.b)]);
    },
  },
  {
    id: 'split',
    name: 'Split',
    draw: (p) => [shapeRect(0, 0, 50, 100, p.b, 0.9), shapeCircle(50, 50, 22, p.a)],
  },
  {
    id: 'sea',
    name: 'Sea',
    draw: (p) =>
      [shapeCircle(50, 40, 15, p.a), shapeLine(8, 56, 92, 56, p.c, 0.8, 0.45)].concat(
        [
          [62, 36],
          [68, 26],
          [74, 18],
          [80, 10],
          [86, 5],
        ].map(([y, w]) => shapeLine(50 - w / 2, y, 50 + w / 2, y, p.a, 2.2, 0.8))
      ),
  },
  {
    id: 'prism',
    name: 'Prism',
    draw: (p) => [
      shapePath('M50 22L80 76H20Z', p.a, undefined, { stroke: p.c, width: 2, fillOpacity: 0.12 }),
      shapeLine(4, 58, 36, 50, p.c, 1.6, 0.9),
      shapeLine(64, 50, 96, 46, p.a, 2.4),
      shapeLine(64, 52, 96, 58, p.b, 2.4),
      shapeLine(64, 54, 96, 70, p.c, 2.4, 0.7),
    ],
  },
  {
    id: 'orbit',
    name: 'Orbit',
    draw: (p) => [
      { tag: 'ellipse', at: { cx: 50, cy: 50, rx: 38, ry: 14, transform: 'rotate(-22 50 50)' }, fill: 'none', stroke: p.c, width: 1.4, opacity: 0.7 },
      shapeCircle(50, 50, 9, p.a),
      shapeCircle(76.1, 30.9, 4.5, p.b),
    ],
  },
  {
    id: 'tiles',
    name: 'Tiles',
    draw: (p) =>
      [
        [14, 14, 'bl', p.a],
        [50, 14, 'br', p.b],
        [14, 50, 'tl', p.b],
        [50, 50, 'tr', p.a],
      ].map(([x, y, corner, fill]) => shapePath(quarterCircle(x, y, 36, corner), fill, 0.95)),
  },
  {
    id: 'columns',
    name: 'Columns',
    draw: (p) =>
      [shapePath('M12 30L50 13L88 30Z', p.a)]
        .concat([0, 1, 2, 3].map((i) => shapeRect(16 + i * 18, 31, 14, 3.5, p.a)))
        .concat([0, 1, 2, 3].map((i) => shapeRect(19 + i * 18, 34, 8, 43, p.a, 0.92)))
        .concat([shapeRect(10, 78, 80, 5, p.a), shapeRect(6, 84, 88, 4, p.a, 0.7)]),
  },
  {
    id: 'stars',
    name: 'Stars',
    draw: (p, r) => {
      const dots = [0, 1, 2, 3, 4, 5, 6].map(() =>
        shapeCircle(coverRound(8 + r() * 84), coverRound(8 + r() * 56), coverRound(0.8 + r() * 0.8), p.c, 0.7)
      );
      return dots.concat([
        shapePath('M66 21Q67.5 32.5 79 34Q67.5 35.5 66 47Q64.5 35.5 53 34Q64.5 32.5 66 21Z', p.a),
        shapePath('M30 56Q30.7 61.3 36 62Q30.7 62.7 30 68Q29.3 62.7 24 62Q29.3 61.3 30 56Z', p.c, 0.85),
        shapePath('M0 100V84Q50 68 100 84V100Z', p.b, 0.6),
      ]);
    },
  },
  {
    id: 'pines',
    name: 'Pines',
    draw: (p) => {
      const tree = (x, base, h, fill, o) => shapePath(`M${x} ${base - h}L${x + h * 0.32} ${base}H${x - h * 0.32}Z`, fill, o);
      return [
        shapeCircle(80, 20, 6, p.c, 0.8),
        tree(30, 84, 44, p.a, 0.9),
        tree(74, 84, 38, p.a, 0.75),
        tree(52, 84, 58, p.b),
        shapeRect(0, 84, 100, 16, p.bottom),
      ];
    },
  },
  {
    id: 'arch',
    name: 'Arch',
    draw: (p) => [
      shapePath('M30 86V46A20 20 0 0 1 70 46V86Z', p.a),
      shapeLine(50, 26, 50, 86, p.bottom, 2),
      shapeLine(30, 58, 70, 58, p.bottom, 2),
      shapeRect(22, 86, 56, 3, p.c, 0.6),
    ],
  },
  {
    id: 'record',
    name: 'Record',
    draw: (p) => [
      shapeCircle(50, 50, 39, '#141010'),
      shapeRing(50, 50, 33, p.c, 0.6, 0.18),
      shapeRing(50, 50, 27, p.c, 0.6, 0.14),
      shapeRing(50, 50, 21, p.c, 0.6, 0.12),
      shapeCircle(50, 50, 12, p.b),
      shapeCircle(50, 50, 1.8, p.top),
    ],
  },
  // A second set.
  {
    id: 'dunes',
    name: 'Dunes',
    draw: (p) => [
      shapeCircle(70, 30, 10, p.a),
      shapePath('M0 70Q30 52 60 66T100 62V100H0Z', p.b, 0.7),
      shapePath('M0 82Q40 66 70 80T100 78V100H0Z', p.a, 0.9),
      shapePath('M0 92Q50 84 100 94V100H0Z', p.b),
    ],
  },
  {
    id: 'retro',
    name: 'Retro sun',
    draw: (p) =>
      [shapeCircle(50, 52, 28, p.a)]
        .concat(
          // Slices across the sun, only as wide as the sun is there.
          [
            [56, 2],
            [62, 3],
            [68, 4],
            [74, 5],
          ].map(([y, h]) => {
            const half = Math.sqrt(Math.max(0, 28 * 28 - Math.pow(Math.min(y, 80) - 52, 2)));
            const below = Math.sqrt(Math.max(0, 28 * 28 - Math.pow(Math.min(y + h, 80) - 52, 2)));
            const w = Math.max(half, below) + 1;
            return shapeRect(coverRound(50 - w), y, coverRound(w * 2), h, p.bottom);
          })
        )
        .concat([shapeRect(0, 80, 100, 20, p.bottom), shapeLine(8, 80, 92, 80, p.b, 1.6)]),
  },
  {
    id: 'squares',
    name: 'Squares',
    draw: (p) => [shapeRect(12, 12, 76, 76, p.b), shapeRect(22, 26, 56, 56, p.a), shapeRect(32, 40, 36, 36, p.bottom)],
  },
  {
    id: 'checker',
    name: 'Checker',
    draw: (p) => {
      const out = [];
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) if ((i + j) % 2 === 0) out.push(shapeRect(20 + i * 12, 20 + j * 12, 12, 12, p.a));
      }
      return out.concat([{ tag: 'rect', at: { x: 20, y: 20, width: 60, height: 60 }, fill: 'none', stroke: p.a, width: 1 }]);
    },
  },
  {
    id: 'chevrons',
    name: 'Chevrons',
    draw: (p) =>
      [40, 55, 70, 85].map((y, i) => shapePath(`M20 ${y}L50 ${y - 18}L80 ${y}`, 'none', 1 - i * 0.2, { stroke: i % 2 ? p.b : p.a, width: 5 })),
  },
  {
    id: 'sunburst',
    name: 'Sunburst',
    draw: (p) => {
      const rays = [];
      for (let k = 0; k < 9; k += 2) {
        const a1 = Math.PI + (k * Math.PI) / 9;
        const a2 = Math.PI + ((k + 1) * Math.PI) / 9;
        const pt = (a) => `${coverRound(50 + 130 * Math.cos(a))} ${coverRound(96 + 130 * Math.sin(a))}`;
        rays.push(shapePath(`M50 96L${pt(a1)}L${pt(a2)}Z`, p.a, 0.22));
      }
      return rays.concat([shapeCircle(50, 96, 20, p.a), shapeRect(0, 96, 100, 4, p.bottom)]);
    },
  },
  {
    id: 'phases',
    name: 'Phases',
    draw: (p) => {
      const out = [shapeLine(10, 66, 90, 66, p.c, 0.8, 0.4)];
      [0, 5, 8, 12, 99].forEach((shift, i) => {
        const x = 14 + i * 18;
        if (!shift) out.push(shapeRing(x, 50, 7.4, p.a, 1.2));
        else {
          out.push(shapeCircle(x, 50, 8, p.a));
          if (shift < 99) out.push(shapeCircle(x - shift, 50, 8, p.bottom));
        }
      });
      return out;
    },
  },
  {
    id: 'planet',
    name: 'Planet',
    draw: (p) => [
      { tag: 'ellipse', at: { cx: 0, cy: 0, rx: 36, ry: 9, transform: 'translate(50 50) rotate(-18)' }, fill: 'none', stroke: p.b, width: 3 },
      shapeCircle(50, 50, 20, p.a),
      shapePath('M-36 0A36 9 0 0 0 36 0', 'none', undefined, { stroke: p.b, width: 3, at: { d: 'M-36 0A36 9 0 0 0 36 0', transform: 'translate(50 50) rotate(-18)' } }),
      shapeCircle(82, 22, 3, p.c),
      shapeCircle(16, 78, 1.4, p.c, 0.7),
    ],
  },
  {
    id: 'skyline',
    name: 'Skyline',
    draw: (p, r) => {
      const out = [shapeCircle(78, 22, 6, p.c, 0.9)];
      let x = 6;
      let i = 0;
      while (x < 94) {
        const w = coverRound(9 + r() * 8);
        const h = coverRound(18 + r() * 34);
        out.push(shapeRect(x, 88 - h, Math.min(w, 94 - x), h, i % 2 ? p.b : p.a, i % 2 ? 0.95 : 0.9));
        x += w + 2;
        i++;
      }
      return out.concat([shapeRect(0, 88, 100, 12, p.bottom), shapeLine(4, 88, 96, 88, p.c, 1, 0.5)]);
    },
  },
  {
    id: 'sailboat',
    name: 'Sailboat',
    draw: (p) => [
      shapeCircle(24, 26, 6, p.b, 0.9),
      shapePath('M51 24L51 64L76 64Z', p.a),
      shapePath('M49 32L49 64L31 64Z', p.a, 0.75),
      shapeLine(50, 22, 50, 66, p.c, 1.4),
      shapePath('M28 66H74L67 76H35Z', p.b),
      shapeLine(14, 82, 86, 82, p.c, 1.6, 0.55),
      shapeLine(26, 88, 74, 88, p.c, 1.6, 0.35),
    ],
  },
  {
    id: 'lighthouse',
    name: 'Lighthouse',
    draw: (p) => {
      const left = (y) => coverRound(44 - ((y - 34) * 4) / 50);
      const right = (y) => coverRound(56 + ((y - 34) * 4) / 50);
      const band = (y1, y2) => shapePath(`M${left(y1)} ${y1}H${right(y1)}L${right(y2)} ${y2}H${left(y2)}Z`, p.b);
      return [
        shapePath('M57 29L98 18L98 40Z', p.a, 0.22),
        shapePath('M44 34H56L60 84H40Z', p.a),
        band(46, 52),
        band(62, 68),
        shapeRect(43, 26, 14, 8, p.c),
        shapePath('M41 26L50 18L59 26Z', p.b),
        shapePath('M24 86Q50 78 76 86V92H24Z', p.b, 0.85),
        shapeLine(4, 92, 96, 92, p.c, 1.2, 0.5),
      ];
    },
  },
  {
    id: 'compass',
    name: 'Compass',
    draw: (p) => [
      shapeRing(50, 50, 32, p.c, 1.6, 0.8),
      shapeLine(50, 14, 50, 20, p.c, 1.6),
      shapeLine(50, 80, 50, 86, p.c, 1.6),
      shapeLine(14, 50, 20, 50, p.c, 1.6),
      shapeLine(80, 50, 86, 50, p.c, 1.6),
      shapePath('M50 24L56 50H44Z', p.b),
      shapePath('M44 50H56L50 76Z', p.a),
      shapeCircle(50, 50, 2.5, p.c),
    ],
  },
  {
    id: 'hourglass',
    name: 'Hourglass',
    draw: (p) => [
      shapePath('M38 30Q50 34 62 30Q58 42 50 47Q42 42 38 30Z', p.a),
      shapePath('M37 78Q50 62 63 78Z', p.a),
      shapeLine(50, 47, 50, 74, p.a, 1),
      shapePath('M34 22C34 40 48 44 48 50C48 56 34 60 34 78M66 22C66 40 52 44 52 50C52 56 66 60 66 78', 'none', undefined, { stroke: p.c, width: 1.5 }),
      shapeRect(28, 17, 44, 5, p.b),
      shapeRect(28, 78, 44, 5, p.b),
    ],
  },
  {
    id: 'book',
    name: 'Book',
    draw: (p) =>
      [
        shapePath('M50 34Q36 28 18 32V72Q36 68 50 74Z', p.a),
        shapePath('M50 34Q64 28 82 32V72Q64 68 50 74Z', p.a, 0.85),
        shapeLine(50, 34, 50, 74, p.bottom, 1.2),
      ].concat(
        [42, 49, 56, 63].map((y) => shapeLine(24, y, 43, y + 1.5, p.bottom, 1, 0.35)),
        [42, 49, 56].map((y) => shapeLine(57, y + 1.5, 76, y, p.bottom, 1, 0.35))
      ),
  },
  {
    id: 'leaf',
    name: 'Leaf',
    draw: (p) =>
      [shapePath('M50 82C20 62 22 30 50 16C78 30 80 62 50 82Z', p.a), shapeLine(50, 22, 50, 80, p.bottom, 1.5)]
        .concat(
          [
            [40, 36, 32],
            [54, 34, 46],
            [68, 40, 62],
          ].reduce((all, [y, x1, y1]) => all.concat([shapeLine(50, y, x1, y1, p.bottom, 1.2), shapeLine(50, y, 100 - x1, y1, p.bottom, 1.2)]), [])
        )
        .concat([shapeLine(50, 80, 50, 90, p.b, 2)]),
  },
  {
    id: 'scales',
    name: 'Scales',
    draw: (p) => {
      const out = [];
      [40, 52, 64, 76, 88].forEach((y, row) => {
        for (let x = row % 2 ? 0 : 10; x <= 100; x += 20) {
          out.push({ tag: 'circle', at: { cx: x, cy: y, r: 10 }, fill: p.bottom, stroke: p.a, width: 1.2 });
          out.push(shapeRing(x, y, 5.5, p.a, 1.2));
        }
      });
      return [shapeCircle(72, 20, 7, p.b)].concat(out);
    },
  },
  {
    id: 'zigzag',
    name: 'Zigzag',
    draw: (p) =>
      [40, 56, 72].map((y, i) => {
        let d = `M0 ${y}`;
        for (let k = 1; k <= 8; k++) d += `L${k * 12.5} ${k % 2 ? y - 8 : y}`;
        return shapePath(d, 'none', undefined, { stroke: i === 1 ? p.b : p.a, width: 4.5 });
      }),
  },
  {
    id: 'spiral',
    name: 'Spiral',
    draw: (p) => {
      let d = '';
      for (let i = 0; i <= 90; i++) {
        const t = (i / 90) * Math.PI * 6;
        const radius = 2 + 5.2 * t / 2;
        d += `${i ? 'L' : 'M'}${coverRound(50 + radius * Math.cos(t))} ${coverRound(50 + radius * Math.sin(t))}`;
      }
      return [shapePath(d, 'none', undefined, { stroke: p.a, width: 2.4 }), shapeCircle(50, 50, 3, p.b)];
    },
  },
  {
    id: 'house',
    name: 'House',
    draw: (p) => [
      shapeCircle(80, 20, 5, p.c, 0.9),
      shapeRect(60, 32, 6, 12, p.b),
      shapeRect(30, 50, 40, 32, p.a),
      shapePath('M24 52L50 28L76 52Z', p.b),
      shapeRect(45, 64, 10, 18, p.bottom),
      shapeRect(34, 58, 8, 8, p.bottom, 0.8),
      shapeRect(58, 58, 8, 8, p.bottom, 0.8),
      shapeLine(10, 82, 90, 82, p.c, 1.2, 0.6),
    ],
  },
  {
    id: 'bridge',
    name: 'Bridge',
    draw: (p) => {
      const out = [shapeRect(0, 86, 100, 14, p.b, 0.45), shapePath('M8 86Q50 26 92 86', 'none', undefined, { stroke: p.a, width: 3 })];
      for (let x = 20; x <= 80; x += 10) {
        const t = (x - 8) / 84;
        const y = 86 - 120 * t * (1 - t);
        if (y > 60) out.push(shapeLine(x, 59, x, coverRound(y), p.a, 1.2));
      }
      return out.concat([shapeRect(0, 54, 100, 5, p.a), shapeLine(20, 92, 80, 92, p.c, 1, 0.4)]);
    },
  },
  {
    id: 'cup',
    name: 'Coffee',
    draw: (p) =>
      [
        { tag: 'ellipse', at: { cx: 50, cy: 80, rx: 30, ry: 5 }, fill: p.b },
        shapeRing(72, 61, 7, p.a, 3),
        shapePath('M30 50H70V66Q70 78 50 78Q30 78 30 66Z', p.a),
      ].concat([40, 50, 60].map((x) => shapePath(`M${x} 44Q${x - 4} 38 ${x} 32T${x} 20`, 'none', 0.7, { stroke: p.c, width: 1.8 }))),
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    draw: (p, r) => {
      const out = [];
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3 - Math.PI / 2;
        const at = (d, turn) => ({ x: coverRound(50 + d * Math.cos(a + turn)), y: coverRound(50 + d * Math.sin(a + turn)) });
        const tip = at(30, 0);
        const fork = at(18, 0);
        out.push(shapeLine(50, 50, tip.x, tip.y, p.a, 2.4));
        [-0.7, 0.7].forEach((turn) => {
          const end = { x: coverRound(fork.x + 8 * Math.cos(a + turn)), y: coverRound(fork.y + 8 * Math.sin(a + turn)) };
          out.push(shapeLine(fork.x, fork.y, end.x, end.y, p.a, 2));
        });
      }
      const flakes = [0, 1, 2, 3, 4, 5].map(() => shapeCircle(coverRound(8 + r() * 84), coverRound(8 + r() * 84), coverRound(0.8 + r()), p.c, 0.5));
      return flakes.concat(out, [shapeCircle(50, 50, 3.4, p.a)]);
    },
  },
  {
    id: 'ornament',
    name: 'Ornament',
    draw: (p) => [
      shapeLine(50, 4, 50, 31, p.c, 1, 0.8),
      shapeRect(45, 30, 10, 7, p.b),
      shapeCircle(50, 58, 22, p.a),
      shapePath('M28.8 52H71.2L71.9 60H28.1Z', p.b),
      shapeCircle(42, 48, 4, p.c, 0.5),
    ],
  },
  {
    id: 'candle',
    name: 'Candle',
    draw: (p) => [
      shapeCircle(50, 30, 15, p.a, 0.18),
      shapeRect(42, 40, 16, 44, p.a),
      shapePath('M42 44Q46 50 48 44V40H42Z', p.c, 0.5),
      shapeLine(50, 35, 50, 40, p.c, 1),
      shapePath('M50 20Q57 30 50 36Q43 30 50 20Z', p.b),
      { tag: 'ellipse', at: { cx: 50, cy: 84, rx: 17, ry: 4 }, fill: p.b },
    ],
  },
  {
    id: 'gift',
    name: 'Gift',
    draw: (p) => [
      shapeRect(26, 48, 48, 36, p.a, 0.88),
      shapeRect(22, 38, 56, 11, p.a),
      shapeRect(46, 38, 8, 46, p.b),
      shapePath('M50 38Q36 22 31 33Q37 40 50 38Z', p.b),
      shapePath('M50 38Q64 22 69 33Q63 40 50 38Z', p.b),
    ],
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
export const COVER_DESIGN_SETS = [25, COVER_DESIGNS.length - 25];
export const COVER_PALETTE_SETS = [14, COVER_PALETTES.length - 14];

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
    style.push(`stroke: ${shape.stroke}`, `stroke-width: ${shape.width || 1}`, 'stroke-linecap: round', 'stroke-linejoin: round');
  }
  if (shape.fillOpacity !== undefined) style.push(`fill-opacity: ${shape.fillOpacity}`);
  if (shape.opacity !== undefined && shape.opacity < 1) style.push(`opacity: ${shape.opacity}`);
  node.setAttribute('style', style.join('; '));
  return node;
}
