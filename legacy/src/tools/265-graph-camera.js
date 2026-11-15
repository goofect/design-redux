/* ------------------------------------------------------------------ */
/* The graph in three dimensions: the camera                          */
/*                                                                    */
/* A camera on a sphere round the point it looks at, and what follows */
/* from it: where each note lands on the screen (into flat arrays,    */
/* kept from frame to frame), which note is under the pointer, the    */
/* point a zoom keeps still, which names fit without covering one     */
/* another, and the matrices WebGL draws with.                        */
/* ------------------------------------------------------------------ */

/** Turned by yaw (round the upright) and pitch (up and down), as far off as distance. */
export class Camera {
  constructor() {
    this.yaw = 0.6;
    this.pitch = 0.35;
    this.distance = 400;
    this.target = { x: 0, y: 0, z: 0 };
    this.fov = 0.9;
  }

  /** Where it is, and the screen's right, up and the way it looks, as unit vectors. */
  frame() {
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const t = this.target;
    const d = this.distance;
    return {
      eye: { x: t.x + cp * sy * d, y: t.y + sp * d, z: t.z + cp * cy * d },
      right: { x: cy, y: 0, z: -sy },
      up: { x: -sp * sy, y: cp, z: -sp * cy },
      ahead: { x: -cp * sy, y: -sp, z: -cp * cy },
    };
  }

  /** Pixels per unit at a unit's depth, for a screen this tall. */
  focal(height) {
    return height / 2 / Math.tan(this.fov / 2);
  }

  turn(dx, dy) {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + dy * 0.006));
  }

  zoom(factor) {
    this.distance = Math.max(5, Math.min(50000, this.distance * factor));
  }

  /** Slide what it looks at by a drag of dx, dy pixels. */
  pan(dx, dy, height) {
    const { right, up } = this.frame();
    const k = this.distance / this.focal(height);
    this.target = {
      x: this.target.x - right.x * dx * k + up.x * dy * k,
      y: this.target.y - right.y * dx * k + up.y * dy * k,
      z: this.target.z - right.z * dx * k + up.z * dy * k,
    };
  }

  /** Closer or further by factor, keeping still what's under the screen point x, y (at the depth looked at). */
  zoomAt(factor, x, y, width, height) {
    const before = this.distance;
    this.zoom(factor);
    const ratio = this.distance / before;
    const { right, up } = this.frame();
    const k = before / this.focal(height);
    const px = (x - width / 2) * k;
    const py = (height / 2 - y) * k;
    const t = this.target;
    const p = { x: t.x + right.x * px + up.x * py, y: t.y + right.y * px + up.y * py, z: t.z + right.z * px + up.z * py };
    this.target = { x: p.x + (t.x - p.x) * ratio, y: p.y + (t.y - p.y) * ratio, z: p.z + (t.z - p.z) * ratio };
  }

  toJSON() {
    return { yaw: this.yaw, pitch: this.pitch, distance: this.distance, target: Object.assign({}, this.target) };
  }

  /** Back where a saved camera was; what isn't a number is left. */
  restore(saved) {
    if (!saved) return this;
    ['yaw', 'pitch', 'distance'].forEach((k) => {
      if (Number.isFinite(saved[k])) this[k] = saved[k];
    });
    const t = saved.target;
    if (t && [t.x, t.y, t.z].every(Number.isFinite)) this.target = { x: t.x, y: t.y, z: t.z };
    return this;
  }
}

/**
 * Where it would look from, and how far off, to take in these notes
 * (indices into pos, x y z a note; all n when none are given), turned as it is.
 */
export function fitView(camera, pos, n, width, height, only) {
  const list = only || null;
  const count = list ? list.length : n;
  if (!count) return null;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let k = 0; k < count; k++) {
    const p = (list ? list[k] : k) * 3;
    mx += pos[p];
    my += pos[p + 1];
    mz += pos[p + 2];
  }
  mx /= count;
  my /= count;
  mz /= count;
  let r2 = 0;
  for (let k = 0; k < count; k++) {
    const p = (list ? list[k] : k) * 3;
    const dx = pos[p] - mx;
    const dy = pos[p + 1] - my;
    const dz = pos[p + 2] - mz;
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  const narrow = Math.min(1, width / Math.max(height, 1));
  const half = Math.atan(Math.tan(camera.fov / 2) * narrow);
  // A margin round it, so the notes at the edge and their names aren't cut off.
  return { target: { x: mx, y: my, z: mz }, distance: Math.max(40, ((Math.sqrt(r2) + 14) / Math.sin(half)) * 1.15) };
}

/**
 * Where each note lands on a width × height screen, into flat arrays
 * (out, reused when big enough): x, y, depth along the way the camera
 * looks, and scale — pixels per unit there, 0 for what's behind it.
 * Also the nearest and furthest depth of what's in front.
 */
export function projectInto(camera, pos, n, width, height, out) {
  const o = out && out.x.length >= n ? out : { x: new Float32Array(n), y: new Float32Array(n), depth: new Float32Array(n), scale: new Float32Array(n) };
  const { eye, right, up, ahead } = camera.frame();
  const f = camera.focal(height);
  let near = Infinity;
  let far = 0;
  for (let i = 0; i < n; i++) {
    const vx = pos[i * 3] - eye.x;
    const vy = pos[i * 3 + 1] - eye.y;
    const vz = pos[i * 3 + 2] - eye.z;
    const depth = vx * ahead.x + vy * ahead.y + vz * ahead.z;
    if (depth < 1) {
      o.scale[i] = 0;
      continue;
    }
    const s = f / depth;
    o.x[i] = width / 2 + (vx * right.x + vy * right.y + vz * right.z) * s;
    o.y[i] = height / 2 - (vx * up.x + vy * up.y + vz * up.z) * s;
    o.depth[i] = depth;
    o.scale[i] = s;
    if (depth < near) near = depth;
    if (depth > far) far = depth;
  }
  o.n = n;
  o.near = near === Infinity ? 1 : near;
  o.far = Math.max(far, o.near + 1);
  return o;
}

/** The note under a point on the screen, the nearest the camera if several are: its index, or -1. sizes: each note's radius, in units. */
export function hitNode(spots, sizes, x, y, slack) {
  let best = -1;
  let bestDepth = Infinity;
  const extra = slack === undefined ? 4 : slack;
  for (let i = 0; i < spots.n; i++) {
    const s = spots.scale[i];
    if (!s) continue;
    const r = Math.max(sizes[i] * s, 2) + extra;
    const dx = spots.x[i] - x;
    const dy = spots.y[i] - y;
    if (dx * dx + dy * dy <= r * r && spots.depth[i] < bestDepth) {
      best = i;
      bestDepth = spots.depth[i];
    }
  }
  return best;
}

/**
 * Which names to draw, and where: each below its note, in the order
 * given (the most wanted first), left out where it would cover one
 * already placed — unless it's among those always named. widthOf(i)
 * and radiusOf(i) are in pixels. Gives [{ i, x, y }], x its middle.
 */
export function placeNames(order, spots, widthOf, radiusOf, lineHeight, width, height, always) {
  const placed = [];
  const grid = new Map();
  const CELL = 64;
  const cells = (b, fn) => {
    for (let gx = Math.floor(b[0] / CELL); gx <= Math.floor(b[2] / CELL); gx++) {
      for (let gy = Math.floor(b[1] / CELL); gy <= Math.floor(b[3] / CELL); gy++) {
        if (fn((gx + 1) * 100003 + gy + 1)) return true;
      }
    }
    return false;
  };
  const hits = (b) => cells(b, (key) => (grid.get(key) || []).some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]));
  order.forEach((i) => {
    if (!spots.scale[i]) return;
    const w = widthOf(i);
    const x = spots.x[i];
    const y = spots.y[i] + radiusOf(i) + 3;
    if (x + w / 2 < 0 || x - w / 2 > width || y > height || y + lineHeight < 0) return;
    const b = [x - w / 2 - 2, y - 1, x + w / 2 + 2, y + lineHeight + 1];
    if (!(always && always.has(i)) && hits(b)) return;
    cells(b, (key) => {
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(b);
      return false;
    });
    placed.push({ i, x, y });
  });
  return placed;
}

/** The camera as WebGL wants it: projection × view, column by column, for a screen this shape. */
export function cameraMatrix(camera, width, height, near, far) {
  const { eye, right, up, ahead } = camera.frame();
  const b = { x: -ahead.x, y: -ahead.y, z: -ahead.z };
  const dot = (v) => v.x * eye.x + v.y * eye.y + v.z * eye.z;
  const view = [right.x, up.x, b.x, 0, right.y, up.y, b.y, 0, right.z, up.z, b.z, 0, -dot(right), -dot(up), -dot(b), 1];
  const f = 1 / Math.tan(camera.fov / 2);
  const aspect = width / Math.max(height, 1);
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += proj[k * 4 + r] * view[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}
