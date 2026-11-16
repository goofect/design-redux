/* ------------------------------------------------------------------ */
/* The graph in three dimensions: the layout                          */
/*                                                                    */
/* Linked notes pulled together, every note pushed off the others,    */
/* and all of them drawn gently to the middle, step by step as the    */
/* layout cools. Far notes push as one clump (a tree of boxes, kept   */
/* in flat arrays reused from step to step), so a step costs about    */
/* n log n, not n²; positions and speeds are flat arrays too.         */
/*                                                                    */
/* The kernel is one function holding everything it needs, so the    */
/* same code runs in a worker — the layout off the main thread, the   */
/* drawing smooth however big the vault — or, where a worker can't be */
/* had, right here, a few milliseconds a frame.                       */
/* ------------------------------------------------------------------ */

/** The forces: d3's measures, in three dimensions. */
export const LAYOUT = {
  repel: 45, // how hard notes push off one another
  reach: 600, // how far a push reaches
  length: 34, // the length a link settles at
  gravity: 0.03, // the pull to the middle, which keeps notes linked to nothing near
  friction: 0.4, // how much of its speed a note loses each step
  theta: 0.9, // how far off a clump of notes is taken as one
  cool: 0.0228, // how fast the layout calms down
  cold: 0.003, // calm enough to stop
  still: 0.01, // moving less than this much of a link a step, on average: as good as settled, so it cools faster
  group: 0.07, // the pull of a note's anchor, while grouping is on
};

/** The forces, as a view's sliders scale them. */
export function layoutOptions(scale) {
  const s = scale || {};
  const by = (k) => (typeof s[k] === 'number' ? s[k] : 1);
  return Object.assign({}, LAYOUT, { repel: LAYOUT.repel * by('repel'), length: LAYOUT.length * by('linkLength'), gravity: LAYOUT.gravity * by('centre'), group: s.group ? LAYOUT.group : 0 });
}

/**
 * Where each note starts: where it was, if it was drawn before
 * (before: id → [x, y, z]); else beside a note it links to that was;
 * else on a spiral round a sphere. The same notes start in the same
 * places, so a layout comes out the same each time.
 */
export function startPositions(nodes, before) {
  const n = nodes.length;
  const pos = new Float64Array(n * 3);
  const total = Math.max(n, 1);
  const radius = 14 * Math.cbrt(total);
  let known = 0;
  nodes.forEach((node, i) => {
    const y = 1 - (2 * (i + 0.5)) / total;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const turn = i * 2.399963;
    const u = [Math.cos(turn) * ring, y, Math.sin(turn) * ring];
    const was = before && before.get(node.id);
    let from = null;
    let off = 0;
    if (was) {
      from = was;
      known++;
    } else if (before) {
      for (const j of node.near) {
        const by = before.get(nodes[j].id);
        if (by) {
          from = by;
          off = 8;
          break;
        }
      }
    }
    for (let d = 0; d < 3; d++) pos[i * 3 + d] = from ? from[d] + u[d] * off : u[d] * radius;
  });
  return { pos, known };
}

/**
 * The layout's working part: load(count, links, positions), step(alpha,
 * forces) → how far the notes moved on average, fix(i, x, y, z) and
 * release(i) for a note held by the pointer, positions(). Nothing
 * outside this function is used inside it: it's sent to a worker as text.
 */
export function layoutKernel() {
  let n = 0;
  let pos = new Float64Array(0);
  let vel = new Float64Array(0);
  let deg = new Float64Array(0);
  let links = new Int32Array(0);
  let fixed = new Uint8Array(0);
  // The notes in the tree's order, and which of them a walk of it reached.
  let order = new Int32Array(0);
  let seen = new Uint8Array(0);
  // Where each note is pulled to while grouping (NaN: nowhere); null when not grouping.
  let anchors = null;
  // The tree: a box per index, eight children made at once, side by side.
  let cap = 0;
  let used = 0;
  let mass, cx, cy, cz, ox, oy, oz, size, body, kid;
  const stack = new Int32Array(2048);

  function grow(min) {
    const next = Math.max(min, cap * 2, 256);
    const f = (old) => {
      const a = new Float64Array(next);
      if (old) a.set(old.subarray(0, used));
      return a;
    };
    const g = (old) => {
      const a = new Int32Array(next);
      if (old) a.set(old.subarray(0, used));
      return a;
    };
    mass = f(mass);
    cx = f(cx);
    cy = f(cy);
    cz = f(cz);
    ox = f(ox);
    oy = f(oy);
    oz = f(oz);
    size = f(size);
    body = g(body);
    kid = g(kid);
    cap = next;
  }

  function box(x, y, z, s) {
    if (used >= cap) grow(used + 1);
    const c = used++;
    mass[c] = 0;
    cx[c] = 0;
    cy[c] = 0;
    cz[c] = 0;
    ox[c] = x;
    oy[c] = y;
    oz[c] = z;
    size[c] = s;
    body[c] = -1;
    kid[c] = -1;
    return c;
  }

  function octant(c, i) {
    const h = size[c] / 2;
    return (pos[i * 3] >= ox[c] + h ? 1 : 0) | (pos[i * 3 + 1] >= oy[c] + h ? 2 : 0) | (pos[i * 3 + 2] >= oz[c] + h ? 4 : 0);
  }

  function split(c) {
    const h = size[c] / 2;
    const x = ox[c];
    const y = oy[c];
    const z = oz[c];
    const first = used;
    for (let k = 0; k < 8; k++) box(x + (k & 1 ? h : 0), y + (k & 2 ? h : 0), z + (k & 4 ? h : 0), h);
    kid[c] = first;
  }

  function insert(i) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    let c = 0;
    for (let depth = 0; ; depth++) {
      const m = mass[c];
      cx[c] = (cx[c] * m + x) / (m + 1);
      cy[c] = (cy[c] * m + y) / (m + 1);
      cz[c] = (cz[c] * m + z) / (m + 1);
      mass[c] = m + 1;
      if (kid[c] < 0) {
        if (m === 0) {
          body[c] = i;
          return;
        }
        // Notes in one spot: kept as a clump, past a depth.
        if (depth > 20) return;
        const old = body[c];
        body[c] = -1;
        split(c);
        const k = kid[c] + octant(c, old);
        mass[k] = 1;
        cx[k] = pos[old * 3];
        cy[k] = pos[old * 3 + 1];
        cz[k] = pos[old * 3 + 2];
        body[k] = old;
      }
      c = kid[c] + octant(c, i);
    }
  }

  function build() {
    used = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < n * 3; k++) {
      const v = pos[k];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!cap) grow(n * 4);
    box(lo, lo, lo, Math.max(hi - lo, 1) * 1.0001 + 1e-9);
    for (let i = 0; i < n; i++) insert(i);
  }

  function repel(i, push, reach2, theta2) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    let fx = 0;
    let fy = 0;
    let fz = 0;
    let top = 0;
    stack[top++] = 0;
    while (top) {
      const c = stack[--top];
      if (!mass[c]) continue;
      const dx = cx[c] - x;
      const dy = cy[c] - y;
      const dz = cz[c] - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (kid[c] >= 0 && size[c] * size[c] > theta2 * d2) {
        for (let k = 0; k < 8; k++) stack[top++] = kid[c] + k;
        continue;
      }
      if (body[c] === i || d2 > reach2 || d2 === 0) continue;
      const w = (push * mass[c]) / (d2 < 1 ? 1 : d2);
      fx -= dx * w;
      fy -= dy * w;
      fz -= dz * w;
    }
    vel[i * 3] += fx;
    vel[i * 3 + 1] += fy;
    vel[i * 3 + 2] += fz;
  }

  function step(alpha, o) {
    if (!n) return 0;
    build();
    const push = o.repel * alpha;
    const reach2 = o.reach * o.reach;
    const theta2 = o.theta * o.theta;
    // Pushed in the tree's order: notes near one another one after another, so the boxes
    // each visits are still in the cache from the last. The same sums, in a third less time.
    let m = 0;
    let top = 0;
    stack[top++] = 0;
    while (top) {
      const c = stack[--top];
      if (!mass[c]) continue;
      if (kid[c] >= 0) for (let k = 7; k >= 0; k--) stack[top++] = kid[c] + k;
      else if (body[c] >= 0) order[m++] = body[c];
    }
    // A clump's other notes have no leaf of their own: they go last.
    if (m < n) {
      seen.fill(0);
      for (let k = 0; k < m; k++) seen[order[k]] = 1;
      for (let i = 0; i < n; i++) if (!seen[i]) order[m++] = i;
    }
    for (let k = 0; k < n; k++) repel(order[k], push, reach2, theta2);
    for (let k = 0; k < links.length; k += 2) {
      const a = links[k];
      const b = links[k + 1];
      const pa = a * 3;
      const pb = b * 3;
      const dx = pos[pb] + vel[pb] - pos[pa] - vel[pa];
      const dy = pos[pb + 1] + vel[pb + 1] - pos[pa + 1] - vel[pa + 1];
      const dz = pos[pb + 2] + vel[pb + 2] - pos[pa + 2] - vel[pa + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      // A link between a hub and a leaf moves the leaf, mostly.
      const l = (((d - o.length) / d) * alpha) / Math.min(deg[a], deg[b]);
      const toB = deg[a] / (deg[a] + deg[b]);
      vel[pb] -= dx * l * toB;
      vel[pb + 1] -= dy * l * toB;
      vel[pb + 2] -= dz * l * toB;
      vel[pa] += dx * l * (1 - toB);
      vel[pa + 1] += dy * l * (1 - toB);
      vel[pa + 2] += dz * l * (1 - toB);
    }
    if (anchors && o.group > 0) {
      const k = o.group * alpha;
      for (let p = 0; p < n * 3; p++) if (anchors[p] === anchors[p]) vel[p] += (anchors[p] - pos[p]) * k;
    }
    const pull = o.gravity * alpha;
    const keep = 1 - o.friction;
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const p = i * 3;
      if (fixed[i]) {
        vel[p] = vel[p + 1] = vel[p + 2] = 0;
        continue;
      }
      const vx = (vel[p] - pos[p] * pull) * keep;
      const vy = (vel[p + 1] - pos[p + 1] * pull) * keep;
      const vz = (vel[p + 2] - pos[p + 2] * pull) * keep;
      vel[p] = vx;
      vel[p + 1] = vy;
      vel[p + 2] = vz;
      pos[p] += vx;
      pos[p + 1] += vy;
      pos[p + 2] += vz;
      moved += Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
    return moved / n;
  }

  function load(count, pairs, start) {
    n = count;
    pos = Float64Array.from(start);
    vel = new Float64Array(n * 3);
    links = Int32Array.from(pairs);
    fixed = new Uint8Array(n);
    order = new Int32Array(n);
    seen = new Uint8Array(n);
    deg = new Float64Array(n);
    anchors = null;
    for (let k = 0; k < links.length; k++) deg[links[k]]++;
  }

  function anchor(list) {
    anchors = list && list.length === n * 3 ? Float64Array.from(list) : null;
  }

  function fix(i, x, y, z) {
    if (i < 0 || i >= n) return;
    fixed[i] = 1;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
  }

  function release(i) {
    if (i >= 0 && i < n) fixed[i] = 0;
  }

  /** The heat after a step that moved the notes this far, on average: it cools, faster once they're barely moving. */
  // Faster once the notes are barely moving — but not just after it's warmed by a hand (a force changed,
  // a note dragged: gentle, steps of it), when the few notes that move would pass for none and it would
  // stop before they'd gone anywhere.
  function cool(alpha, moved, o, gentle) {
    return alpha * (1 - (!gentle && moved < o.length * o.still ? o.cool * 4 : o.cool));
  }

  return { load, step, fix, release, anchor, cool, positions: () => pos };
}

/** How many steps after a hand warms the layout it cools at its own pace, whatever the notes do. */
const GRAPH_3D_GENTLE = 150;

/** The worker's code: the kernel, stepping in batches of a dozen milliseconds, sending positions after each. */
function layoutWorkerSource() {
  // Each line indented: the code is text here, and nothing in it is this module's.
  return [
    `  const kernel = (${layoutKernel.toString()})();`,
    '  let alpha = 0, opts = null, gen = 0, timer = 0, floor = 0, gentle = 0;',
    '  const run = () => {',
    '    timer = 0;',
    '    if (!opts || alpha < opts.cold) return;',
    '    const start = Date.now();',
    '    do { alpha = Math.max(floor, kernel.cool(alpha, kernel.step(alpha, opts), opts, gentle > 0)); if (gentle > 0) gentle--; } while (Date.now() - start < 12 && alpha >= opts.cold);',
    '    const pos = Float32Array.from(kernel.positions());',
    "    self.postMessage({ type: 'positions', gen, pos, alpha }, [pos.buffer]);",
    '    if (alpha >= opts.cold) timer = setTimeout(run, 0);',
    '  };',
    '  self.onmessage = (e) => {',
    '    const m = e.data;',
    '    if (m.opts) opts = m.opts;',
    "    if (m.type === 'load') { gen = m.gen; kernel.load(m.count, m.links, m.pos); alpha = m.alpha; }",
    "    else if (m.type === 'fix') kernel.fix(m.i, m.x, m.y, m.z);",
    "    else if (m.type === 'release') kernel.release(m.i);",
    "    else if (m.type === 'floor') floor = m.floor;",
    "    if (m.gentle) gentle = m.gentle;",
    "    else if (m.type === 'anchor') kernel.anchor(m.anchors);",
    "    if (m.type !== 'load' && typeof m.alpha === 'number') alpha = Math.max(alpha, m.alpha);",
    '    if (!timer) timer = setTimeout(run, 0);',
    '  };',
  ].join('\n');
}

/**
 * The layout for a view: in a worker where one can be had, else here.
 * positions is what to draw (Float32Array, x y z a note); version goes
 * up each time they change; onMove is told when they do from the worker.
 */
export class LayoutRunner {
  constructor(win, onMove) {
    this.win = win;
    this.onMove = onMove || (() => {});
    this.opts = layoutOptions();
    this.alpha = 0;
    this.count = 0;
    this.links = new Int32Array(0);
    this.positions = new Float32Array(0);
    this.version = 0;
    this.gen = 0;
    this.worker = null;
    try {
      if (typeof win.Worker === 'function' && win.Blob && win.URL && typeof win.URL.createObjectURL === 'function') {
        this.url = win.URL.createObjectURL(new win.Blob([layoutWorkerSource()], { type: 'text/javascript' }));
        this.worker = new win.Worker(this.url);
        this.worker.onmessage = (e) => this.receive(e.data);
        this.worker.onerror = (e) => {
          if (e && e.preventDefault) e.preventDefault();
          this.runHere();
        };
      }
    } catch (err) {
      this.worker = null;
    }
    if (!this.worker) this.runHere();
  }

  get hot() {
    return this.alpha >= this.opts.cold;
  }

  /** From now on, the layout steps here: where there's no worker, or the worker failed. */
  runHere() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    if (!this.kernel) this.kernel = layoutKernel();
    if (this.count) this.kernel.load(this.count, this.links, this.positions);
    if (this.anchors) this.kernel.anchor(this.anchors);
  }

  load(count, links, start, alpha) {
    this.count = count;
    this.links = links;
    this.positions = Float32Array.from(start);
    this.alpha = alpha;
    this.gen++;
    this.version++;
    this.steps = 0;
    this.anchors = null;
    if (this.worker) this.worker.postMessage({ type: 'load', gen: this.gen, count, links, pos: start, opts: this.opts, alpha });
    else this.kernel.load(count, links, start);
  }

  heat(alpha) {
    this.alpha = Math.max(this.alpha, alpha);
    if (this.worker) this.worker.postMessage({ type: 'heat', alpha });
  }

  setForces(opts, alpha) {
    this.opts = opts;
    this.alpha = Math.max(this.alpha, alpha);
    const gentle = alpha > 0 ? GRAPH_3D_GENTLE : 0;
    if (gentle) this.gentle = gentle;
    if (this.worker) this.worker.postMessage({ type: 'opts', opts, alpha, gentle });
  }

  /** A note held where the pointer has it, till released. */
  fix(i, x, y, z) {
    if (i < 0 || i >= this.count) return;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.version++;
    this.alpha = Math.max(this.alpha, 0.3);
    this.gentle = GRAPH_3D_GENTLE;
    if (this.worker) this.worker.postMessage({ type: 'fix', i, x, y, z, alpha: 0.3, gentle: GRAPH_3D_GENTLE });
    else this.kernel.fix(i, x, y, z);
  }

  release(i) {
    if (this.worker) this.worker.postMessage({ type: 'release', i });
    else this.kernel.release(i);
  }

  /** Where each note is pulled to while grouping (x y z a note, NaN for none), or null; warmed so it shows. */
  setAnchors(anchors, alpha) {
    this.anchors = anchors;
    this.alpha = Math.max(this.alpha, alpha || 0);
    if (this.worker) this.worker.postMessage({ type: 'anchor', anchors, alpha: alpha || 0 });
    else this.kernel.anchor(anchors);
  }

  /**
   * While a note is held, the layout stays warm — the heat never falls
   * below floor — so the notes round it keep following it, as on
   * Obsidian's graph; let go (0), it cools as before.
   */
  setFloor(floor) {
    this.floor = floor;
    this.alpha = Math.max(this.alpha, floor);
    if (this.worker) this.worker.postMessage({ type: 'floor', floor, alpha: floor });
  }

  /** Here, not in a worker: steps for up to budget milliseconds. Whether it moved. */
  pump(budget) {
    if (this.worker || !this.hot || !this.count) return false;
    const start = Date.now();
    do {
      this.alpha = Math.max(this.floor || 0, this.kernel.cool(this.alpha, this.kernel.step(this.alpha, this.opts), this.opts, this.gentle > 0));
      if (this.gentle > 0) this.gentle--;
      this.steps++;
    } while (Date.now() - start < budget && this.hot);
    this.positions.set(this.kernel.positions());
    this.version++;
    return true;
  }

  receive(m) {
    if (!m || m.type !== 'positions' || m.gen !== this.gen || m.pos.length !== this.count * 3) return;
    this.positions = m.pos;
    this.alpha = m.alpha;
    this.version++;
    this.onMove();
  }

  destroy() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    if (this.url && this.win.URL) this.win.URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
