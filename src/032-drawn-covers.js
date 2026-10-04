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

const SVG_NS = 'http://www.w3.org/2000/svg';

/*
 * A backdrop from top to bottom, and the inks it's printed in: `a` the
 * main one, `b` a second, `c` for lines and small things.
 */
const COVER_PALETTES = [
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
];

/* The shapes a design is made of, on a square 100 across. */
const coverRound = (v) => Math.round(v * 10) / 10;
const shapeCircle = (cx, cy, r, fill, opacity) => ({ tag: 'circle', at: { cx, cy, r }, fill, opacity });
const shapeRing = (cx, cy, r, stroke, width, opacity) => ({ tag: 'circle', at: { cx, cy, r }, fill: 'none', stroke, width, opacity });
const shapeRect = (x, y, width, height, fill, opacity, extra) => ({ tag: 'rect', at: Object.assign({ x, y, width, height }, extra), fill, opacity });
const shapePath = (d, fill, opacity, extra) => Object.assign({ tag: 'path', at: { d }, fill, opacity }, extra);
const shapeLine = (x1, y1, x2, y2, stroke, width, opacity) => ({ tag: 'line', at: { x1, y1, x2, y2 }, stroke, width, opacity });

/** A quarter of a circle filling a square, round the corner named. */
function quarterCircle(x, y, s, corner) {
  if (corner === 'bl') return `M${x} ${y + s}V${y}A${s} ${s} 0 0 1 ${x + s} ${y + s}Z`;
  if (corner === 'br') return `M${x + s} ${y + s}H${x}A${s} ${s} 0 0 1 ${x + s} ${y}Z`;
  if (corner === 'tl') return `M${x} ${y}H${x + s}A${s} ${s} 0 0 1 ${x} ${y + s}Z`;
  return `M${x + s} ${y}V${y + s}A${s} ${s} 0 0 1 ${x} ${y}Z`;
}

/* Each design: what it's called where one is picked, and its shapes, from a palette and a little chance. */
const COVER_DESIGNS = [
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
];

/** A number from a name, stable between runs, spread across its bits. */
function coverSeed(name) {
  let h = 2166136261;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Chance that comes out the same for the same seed. */
function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function coverDesignById(id) {
  return COVER_DESIGNS.find((d) => d.id === id) || null;
}

/** The design a name gets of itself. */
function namedCoverDesign(name) {
  return COVER_DESIGNS[coverSeed(name) % COVER_DESIGNS.length];
}

/**
 * A palette in one colour — a chosen one, or the theme's accent, read
 * live — dark below, with that colour's pale tints to print in.
 */
function tintedPalette(tint) {
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
function namedPalette(name) {
  return COVER_PALETTES[Math.floor(coverSeed(name) / 97) % COVER_PALETTES.length];
}

/**
 * A cover drawn into an element for `look.art`, the name: its own design
 * or `look.design`, in its own colours or `tint`'s.
 */
function drawnArt(el, look, tint) {
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
function drawnShape(doc, shape) {
  const node = doc.createElementNS(SVG_NS, shape.tag);
  Object.keys(shape.at).forEach((key) => {
    if (shape.at[key] !== undefined) node.setAttribute(key, String(shape.at[key]));
  });
  const style = [];
  style.push(`fill: ${shape.fill || 'none'}`);
  if (shape.stroke) {
    style.push(`stroke: ${shape.stroke}`, `stroke-width: ${shape.width || 1}`, 'stroke-linecap: round');
  }
  if (shape.fillOpacity !== undefined) style.push(`fill-opacity: ${shape.fillOpacity}`);
  if (shape.opacity !== undefined && shape.opacity < 1) style.push(`opacity: ${shape.opacity}`);
  node.setAttribute('style', style.join('; '));
  return node;
}
