/* ------------------------------------------------------------------ */
/* The 3D graph: what is drawn, and where                              */
/*                                                                     */
/* The notes and the links between them, gathered from the index; cut  */
/* down, when asked, to what is round one note; then laid out in       */
/* space: linked notes pulled together, every note pushed off the      */
/* others, all drawn gently to the middle. Worked out once, to the     */
/* end, before anything is drawn: the cloud doesn't move by itself.    */
/* The same vault gives the same cloud on every run.                   */
/* ------------------------------------------------------------------ */

/** { nodes: [{ id, name, degree }], links: [[i, j]] }. `around` (a file) keeps what is within `depth` links of it. */
export function graphSpace(plugin, around, depth = 2) {
  const resolved = plugin.index.linkMaps().resolved;
  let files = plugin.index.markdown();
  if (around) {
    const near = new Set([around.path]);
    let frontier = [around.path];
    const back = plugin.index.linkMaps().incoming;
    for (let d = 0; d < depth; d++) {
      const next = [];
      frontier.forEach((p) => Object.keys(resolved[p] || {}).concat(back.get(p) || []).forEach((q) => { if (!near.has(q)) { near.add(q); next.push(q); } }));
      frontier = next;
    }
    files = files.filter((f) => near.has(f.path));
  }
  const at = new Map(files.map((f, i) => [f.path, i]));
  const nodes = files.map((f) => ({ id: f.path, name: f.basename, degree: 0 }));
  const links = [];
  const seen = new Set();
  files.forEach((f, i) => Object.keys(resolved[f.path] || {}).forEach((to) => {
    const j = at.get(to);
    if (j === undefined || j === i || seen.has(`${Math.min(i, j)}-${Math.max(i, j)}`)) return;
    seen.add(`${Math.min(i, j)}-${Math.max(i, j)}`);
    links.push([i, j]);
    nodes[i].degree++;
    nodes[j].degree++;
  }));
  return { nodes, links };
}

/**
 * Positions for n notes: a Float32Array of x, y, z. Starts on a sphere (the
 * same every time), then `steps` rounds of pulling and pushing as it cools.
 * Past a thousand notes each is pushed off a sample of the rest, so a round
 * stays quick.
 */
export function layoutSpace(n, links, steps = 80) {
  const pos = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const radius = 40 * Math.cbrt(Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const y = n > 1 ? 1 - (i / (n - 1)) * 2 : 0;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    pos[i * 3] = Math.cos(golden * i) * r * radius;
    pos[i * 3 + 1] = y * radius;
    pos[i * 3 + 2] = Math.sin(golden * i) * r * radius;
  }
  const move = new Float32Array(n * 3);
  const sample = n > 1000 ? Math.ceil(1000000 / n) : n;
  const stride = Math.max(1, Math.floor(n / sample));
  for (let step = 0; step < steps; step++) {
    const heat = 1 - step / steps;
    move.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = (i + step) % stride; j < n; j += stride) {
        if (i === j) continue;
        const dx = pos[i * 3] - pos[j * 3];
        const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
        const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const push = (900 * stride) / d2;
        move[i * 3] += dx * push;
        move[i * 3 + 1] += dy * push;
        move[i * 3 + 2] += dz * push;
      }
    }
    for (const [a, b] of links) {
      const dx = pos[b * 3] - pos[a * 3];
      const dy = pos[b * 3 + 1] - pos[a * 3 + 1];
      const dz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const pull = 0.02;
      move[a * 3] += dx * pull; move[a * 3 + 1] += dy * pull; move[a * 3 + 2] += dz * pull;
      move[b * 3] -= dx * pull; move[b * 3 + 1] -= dy * pull; move[b * 3 + 2] -= dz * pull;
    }
    for (let k = 0; k < n * 3; k++) {
      const m = move[k] - pos[k] * 0.01;
      const cap = 30 * heat + 1;
      pos[k] += Math.max(-cap, Math.min(cap, m));
    }
  }
  // Centred on its own middle, so the camera turns it about what it holds.
  for (let axis = 0; axis < 3; axis++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += pos[i * 3 + axis];
    for (let i = 0; i < n; i++) pos[i * 3 + axis] -= sum / Math.max(1, n);
  }
  return pos;
}

/** How far the farthest note is from the middle. */
export function spaceRadius(pos) {
  let r = 1;
  for (let i = 0; i < pos.length; i += 3) r = Math.max(r, Math.hypot(pos[i], pos[i + 1], pos[i + 2]));
  return r;
}

/** The camera stands this many cloud radii from the middle: near enough for depth to show, far enough not to bend it. */
export const CAMERA = 3;

/**
 * How the whole cloud fits a w × h view as the camera sees it from `look` ({ yaw, pitch }): the
 * zoom, and the shift (`panX`, `panY`) that puts the middle of what is seen in the middle of the view.
 */
export function fitView(pos, w, h, look = { yaw: 0.6, pitch: 0.35 }) {
  const seen = project(pos, { yaw: look.yaw, pitch: look.pitch, zoom: 1, w: 0, h: 0, radius: spaceRadius(pos) });
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < seen.length; i += 4) {
    x0 = Math.min(x0, seen[i]); x1 = Math.max(x1, seen[i]);
    y0 = Math.min(y0, seen[i + 1]); y1 = Math.max(y1, seen[i + 1]);
  }
  const zoom = Math.max(0.05, Math.min((w - 80) / Math.max(1, x1 - x0), (h - 80) / Math.max(1, y1 - y0)));
  return { zoom, panX: -((x0 + x1) / 2) * zoom, panY: -((y0 + y1) / 2) * zoom };
}

/** The zoom alone at which the cloud fits (see fitView). */
export function fitZoom(pos, w, h, look) {
  return fitView(pos, w, h, look).zoom;
}

/**
 * Where each note lands on the screen, seen in perspective from a camera turned by `yaw` and
 * `pitch`: a Float32Array of x, y, depth (larger is nearer) and scale (larger is nearer, 1 at
 * the middle's depth). `view` is { yaw, pitch, zoom, w, h, radius }.
 */
export function project(pos, view) {
  const n = pos.length / 3;
  const out = new Float32Array(n * 4);
  const d = CAMERA * (view.radius || spaceRadius(pos));
  const [cy, sy, cp, sp] = [Math.cos(view.yaw), Math.sin(view.yaw), Math.cos(view.pitch), Math.sin(view.pitch)];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3] * cy + pos[i * 3 + 2] * sy;
    const z0 = -pos[i * 3] * sy + pos[i * 3 + 2] * cy;
    const y = pos[i * 3 + 1] * cp - z0 * sp;
    const z = pos[i * 3 + 1] * sp + z0 * cp;
    const scale = d / Math.max(d * 0.2, d - z);
    out[i * 4] = view.w / 2 + (view.panX || 0) + x * view.zoom * scale;
    out[i * 4 + 1] = view.h / 2 + (view.panY || 0) + y * view.zoom * scale;
    out[i * 4 + 2] = z;
    out[i * 4 + 3] = scale;
  }
  return out;
}

/**
 * The size of a sphere in the cloud's own units: a part of the usual link's length, so linked
 * spheres stand apart along their lines; with no links, a part of the room each note has.
 */
export function sphereUnit(pos, links = []) {
  if (links.length) {
    const lengths = links.map(([a, b]) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2])).sort((x, y) => x - y);
    return Math.max(0.5, 0.1 * lengths[Math.floor(lengths.length / 2)]);
  }
  return (0.2 * spaceRadius(pos)) / Math.cbrt(Math.max(1, pos.length / 3));
}

/** A note's sphere, its radius on the screen: the more it links, the larger; scaled by the zoom and, nearer, larger still. */
export function sphereRadius(degree, scale, zoom, unit) {
  return Math.max(3, Math.min(48, unit * (1 + Math.sqrt(degree) * 0.3) * zoom * scale));
}

/**
 * What to draw, far to near: each sphere at its depth, each line at its middle's, so a nearer
 * sphere covers the lines and spheres behind it. [{ sphere: i } | { link: [a, b] }].
 */
export function drawOrder(screen, links) {
  const n = screen.length / 4;
  const items = [];
  for (let i = 0; i < n; i++) items.push({ depth: screen[i * 4 + 2], sphere: i });
  links.forEach(([a, b]) => items.push({ depth: (screen[a * 4 + 2] + screen[b * 4 + 2]) / 2 - 0.001, link: [a, b] }));
  return items.sort((p, q) => p.depth - q.depth);
}
