/* ------------------------------------------------------------------ */
/* The graph in three dimensions: drawing                             */
/*                                                                    */
/* WebGL where there is some, as Obsidian's own graph has: each note  */
/* a ball lit from the upper left — a soft light, a small shine, its  */
/* edge a little darker — the far ones sunk into the background; the  */
/* links as thin lines from one buffer of positions, which the layout */
/* fills once a step, fading as they go back; what's behind hidden by */
/* depth. Where WebGL can't be had, the same on a 2D canvas, a path  */
/* per depth band and colour rather than one per note, with a shade   */
/* and a shine laid over each band. Over either, on a canvas of its   */
/* own, a glow round the note in focus, rings round the open and      */
/* picked notes, and the names, each on a soft haze of the background.*/
/* ------------------------------------------------------------------ */

import { cameraMatrix } from './265-graph-camera.js';

const NODE_VS = `
  attribute vec3 a_pos;
  attribute float a_size;
  attribute vec4 a_colour;
  uniform mat4 u_matrix;
  uniform vec3 u_eye;
  uniform vec3 u_ahead;
  uniform float u_focal;
  uniform vec3 u_fog;
  uniform float u_maxPoint;
  varying vec4 v_colour;
  varying float v_fog;
  varying float v_px;
  void main() {
    float depth = dot(a_pos - u_eye, u_ahead);
    gl_Position = u_matrix * vec4(a_pos, 1.0);
    float px = clamp(a_size * 2.0 * u_focal / max(depth, 1.0), 2.0, u_maxPoint);
    gl_PointSize = px;
    v_px = px;
    v_fog = 1.0 - u_fog.z * clamp((depth - u_fog.x) / max(u_fog.y - u_fog.x, 1.0), 0.0, 1.0);
    v_colour = a_colour;
  }`;

// A ball: the point's square read as a sphere's face (y up), lit from the
// upper left and in front — ambient, diffuse, a Blinn shine — its rim a
// little darker, then sunk into the background by the fog and the dimming.
const NODE_FS = `
  precision mediump float;
  uniform vec3 u_ground;
  varying vec4 v_colour;
  varying float v_fog;
  varying float v_px;
  const vec3 LIGHT = vec3(-0.42, 0.55, 0.72);
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(p, p);
    if (r2 > 1.0) discard;
    vec3 n = vec3(p.x, -p.y, sqrt(1.0 - r2));
    vec3 l = normalize(LIGHT);
    float diffuse = max(dot(n, l), 0.0);
    float shine = pow(max(dot(n, normalize(l + vec3(0.0, 0.0, 1.0))), 0.0), 28.0);
    float rim = smoothstep(0.55, 1.0, r2);
    vec3 lit = v_colour.rgb * (0.5 + 0.6 * diffuse) * (1.0 - 0.18 * rim) + vec3(0.22 * shine);
    float edge = 1.0 - smoothstep(1.0 - 3.0 / v_px, 1.0, r2);
    gl_FragColor = vec4(mix(u_ground, clamp(lit, 0.0, 1.0), v_fog * v_colour.a * edge), 1.0);
  }`;

const LINE_VS = `
  attribute vec3 a_pos;
  attribute vec4 a_colour;
  uniform mat4 u_matrix;
  uniform vec3 u_eye;
  uniform vec3 u_ahead;
  uniform vec3 u_fog;
  varying float v_fog;
  varying vec4 v_colour;
  void main() {
    float depth = dot(a_pos - u_eye, u_ahead);
    gl_Position = u_matrix * vec4(a_pos, 1.0);
    v_colour = a_colour;
    v_fog = 1.0 - min(1.0, u_fog.z + 0.1) * clamp((depth - u_fog.x) / max(u_fog.y - u_fog.x, 1.0), 0.0, 1.0);
  }`;

const LINE_FS = `
  precision mediump float;
  uniform vec3 u_ground;
  uniform vec3 u_colour;
  uniform float u_strength;
  uniform float u_tint;
  varying float v_fog;
  varying vec4 v_colour;
  void main() {
    // A link in its notes' colours, one end's fading into the other's; dimmed with them.
    vec3 c = mix(u_colour, v_colour.rgb, u_tint);
    float s = u_strength * mix(1.0, v_colour.a, u_tint);
    gl_FragColor = vec4(mix(u_ground, c, s * v_fog), 1.0);
  }`;

/** How much a link takes its notes' colours, against the plain line colour: most of the way, as on the graphify page. */
const GRAPH_3D_LINK_TINT = 0.85;

function glProgram(gl, vs, fs) {
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
    gl.deleteShader(s);
    return null;
  };
  const v = shader(gl.VERTEX_SHADER, vs);
  const f = shader(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS)) return p;
  gl.deleteProgram(p);
  return null;
}

function glLocations(gl, prog, attributes, uniforms) {
  const loc = {};
  attributes.forEach((a) => (loc[a] = gl.getAttribLocation(prog, a)));
  uniforms.forEach((u) => (loc[u] = gl.getUniformLocation(prog, u)));
  return loc;
}

/** Each note's colour and presence (1 as it is, less as it's dimmed), four numbers a note: into out, kept from call to call when it's big enough. */
function nodeColours(count, slots, presence, palette, out) {
  if (!out || out.length !== count * 4) out = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const c = palette[slots[i]] || palette[0];
    out[i * 4] = c[0];
    out[i * 4 + 1] = c[1];
    out[i * 4 + 2] = c[2];
    out[i * 4 + 3] = presence[i];
  }
  return out;
}

export class GLRenderer {
  /** A WebGL renderer on this canvas, or null where WebGL can't be had. */
  static create(canvas) {
    try {
      const r = new GLRenderer(canvas);
      return r.ready ? r : null;
    } catch (err) {
      return null;
    }
  }

  constructor(canvas) {
    this.canvas = canvas;
    this.kind = 'webgl';
    this.ready = false;
    this.count = 0;
    this.lineCount = 0;
    this.litCount = 0;
    const opts = { antialias: true, alpha: false, depth: true, premultipliedAlpha: false };
    const real = (g) => !!g && typeof g.createShader === 'function';
    let gl = canvas.getContext('webgl2', opts);
    if (!real(gl)) gl = canvas.getContext('webgl', opts);
    if (!real(gl)) return;
    this.gl = gl;
    this.gl2 = typeof gl.texStorage2D === 'function';
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = !this.init();
      if (!this.lost && this.saved) this.reload();
    });
    this.ready = this.init();
  }

  init() {
    const gl = this.gl;
    this.nodeProg = glProgram(gl, NODE_VS, NODE_FS);
    this.lineProg = glProgram(gl, LINE_VS, LINE_FS);
    if (!this.nodeProg || !this.lineProg) return false;
    this.uint = this.gl2 || !!gl.getExtension('OES_element_index_uint');
    this.buf = { pos: gl.createBuffer(), size: gl.createBuffer(), colour: gl.createBuffer(), index: gl.createBuffer(), lit: gl.createBuffer() };
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.maxPoint = range && range[1] ? range[1] : 64;
    this.loc = {
      node: glLocations(gl, this.nodeProg, ['a_pos', 'a_size', 'a_colour'], ['u_matrix', 'u_eye', 'u_ahead', 'u_focal', 'u_fog', 'u_maxPoint', 'u_ground']),
      line: glLocations(gl, this.lineProg, ['a_pos', 'a_colour'], ['u_matrix', 'u_eye', 'u_ahead', 'u_fog', 'u_ground', 'u_colour', 'u_strength', 'u_tint']),
    };
    this.saved = this.saved || {};
    return true;
  }

  /** What was given, given again: after the GPU took the context away and gave it back. */
  reload() {
    const s = this.saved;
    if (s.graph) this.setGraph(s.graph[0], s.graph[1]);
    if (s.pos) this.setPositions(s.pos);
    if (s.style) this.setStyle(s.style[0], s.style[1], s.style[2], s.style[3]);
    if (s.lit) this.setLit(s.lit);
  }

  indices(links) {
    if (this.count <= 65535) return Uint16Array.from(links);
    return this.uint ? Uint32Array.from(links) : null;
  }

  setGraph(count, links) {
    this.saved.graph = [count, links];
    this.count = count;
    const gl = this.gl;
    const data = this.indices(links);
    this.indexType = this.count <= 65535 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
    this.lineCount = data ? data.length : 0;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data || new Uint16Array(0), gl.STATIC_DRAW);
    this.setLit(new Int32Array(0));
  }

  setPositions(pos) {
    this.saved.pos = pos;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.pos);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  }

  setStyle(sizes, slots, presence, palette) {
    this.saved.style = [sizes, slots, presence, palette];
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.size);
    gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf.colour);
    // The colours worked out into the same array each time: a hover changes them, and shouldn't make garbage.
    this.colourData = nodeColours(this.count, slots, presence, palette, this.colourData);
    gl.bufferData(gl.ARRAY_BUFFER, this.colourData, gl.DYNAMIC_DRAW);
  }

  /** The links lit, as index pairs: drawn over the rest in the accent colour. */
  setLit(links) {
    this.saved.lit = links;
    const gl = this.gl;
    const data = this.indices(links);
    this.litCount = data ? data.length : 0;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.lit);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data || new Uint16Array(0), gl.DYNAMIC_DRAW);
  }

  draw(f) {
    const gl = this.gl;
    if (this.lost) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(f.ground[0], f.ground[1], f.ground[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.count) return;
    const matrix = cameraMatrix(f.camera, f.w, f.h, Math.max(0.5, f.near * 0.5), f.far * 1.5 + 50);
    const { eye, ahead } = f.camera.frame();
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    const attr = (buffer, loc, size) => {
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    const common = (L) => {
      gl.uniformMatrix4fv(L.u_matrix, false, matrix);
      gl.uniform3f(L.u_eye, eye.x, eye.y, eye.z);
      gl.uniform3f(L.u_ahead, ahead.x, ahead.y, ahead.z);
      // How far the far notes sink into the background: the view says (f.fog), else most of the way.
      gl.uniform3f(L.u_fog, f.near, f.far, f.fog === undefined ? 0.65 : f.fog);
      gl.uniform3f(L.u_ground, f.ground[0], f.ground[1], f.ground[2]);
    };

    const N = this.loc.node;
    gl.useProgram(this.nodeProg);
    common(N);
    gl.uniform1f(N.u_focal, f.camera.focal(f.h) * f.dpr);
    gl.uniform1f(N.u_maxPoint, this.maxPoint);
    attr(this.buf.pos, N.a_pos, 3);
    attr(this.buf.size, N.a_size, 1);
    attr(this.buf.colour, N.a_colour, 4);
    gl.depthMask(true);
    gl.drawArrays(gl.POINTS, 0, this.count);
    if (N.a_size >= 0) gl.disableVertexAttribArray(N.a_size);
    if (N.a_colour >= 0) gl.disableVertexAttribArray(N.a_colour);

    const L = this.loc.line;
    gl.useProgram(this.lineProg);
    common(L);
    attr(this.buf.pos, L.a_pos, 3);
    attr(this.buf.colour, L.a_colour, 4);
    gl.depthMask(false);
    // Links off: none drawn but the lit ones, which show what's picked.
    if (this.lineCount && f.lineStrength > 0) {
      gl.uniform3f(L.u_colour, f.line[0], f.line[1], f.line[2]);
      gl.uniform1f(L.u_strength, f.lineStrength);
      gl.uniform1f(L.u_tint, GRAPH_3D_LINK_TINT);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.index);
      gl.drawElements(gl.LINES, this.lineCount, this.indexType, 0);
    }
    if (this.litCount) {
      gl.uniform3f(L.u_colour, f.accent[0], f.accent[1], f.accent[2]);
      gl.uniform1f(L.u_strength, 1);
      gl.uniform1f(L.u_tint, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.lit);
      gl.drawElements(gl.LINES, this.litCount, this.indexType, 0);
    }
    if (L.a_colour >= 0) gl.disableVertexAttribArray(L.a_colour);
    gl.depthMask(true);
  }

  destroy() {
    const gl = this.gl;
    if (!gl || this.lost) return;
    Object.values(this.buf || {}).forEach((b) => gl.deleteBuffer(b));
    if (this.nodeProg) gl.deleteProgram(this.nodeProg);
    if (this.lineProg) gl.deleteProgram(this.lineProg);
  }
}

/**
 * The same on a 2D canvas: far bands first, a path per band and colour;
 * then, over each band's bigger notes, one path of shade (the side away
 * from the light) and one of shine — a few dozen fills a frame, however
 * many notes.
 */
export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.kind = 'canvas';
    this.ctx = canvas.getContext('2d');
    this.ready = !!this.ctx;
    this.count = 0;
    this.links = new Int32Array(0);
    this.lit = new Int32Array(0);
  }

  setGraph(count, links) {
    this.count = count;
    this.links = links;
    this.lit = new Int32Array(0);
  }

  setPositions() {}

  setStyle(sizes, slots, presence, palette) {
    this.sizes = sizes;
    this.slots = slots;
    this.presence = presence;
    this.palette = palette;
  }

  setLit(links) {
    this.lit = links;
  }

  draw(f) {
    const ctx = this.ctx;
    const { w, h, spots } = f;
    ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = f.groundCss;
    ctx.fillRect(0, 0, w, h);
    if (!this.count || !this.sizes) return;
    const span = Math.max(f.far - f.near, 1);
    // Depths are kept as 32-bit floats, the nearest as worked out in 64: a hair below it is still the first band.
    const band = (d) => Math.max(0, Math.min(3, Math.floor(((d - f.near) / span) * 4)));
    const stroke = (pairs, colour, width, alpha) => {
      if (!pairs.length) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let k = 0; k < pairs.length; k += 2) {
        ctx.moveTo(spots.x[pairs[k]], spots.y[pairs[k]]);
        ctx.lineTo(spots.x[pairs[k + 1]], spots.y[pairs[k + 1]]);
      }
      ctx.stroke();
    };
    // Links off: none drawn but the lit ones, which show what's picked.
    if (f.lineStrength > 0) {
      // A path a depth band and colour: each link in the colour of the note it starts from.
      const bands = [new Map(), new Map(), new Map(), new Map()];
      for (let k = 0; k < this.links.length; k += 2) {
        const a = this.links[k];
        const b = this.links[k + 1];
        if (!spots.scale[a] || !spots.scale[b]) continue;
        const groups = bands[band((spots.depth[a] + spots.depth[b]) / 2)];
        const key = this.slots[a] * 2 + (this.presence[a] < 1 ? 1 : 0);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a, b);
      }
      bands.forEach((groups, i) =>
        groups.forEach((pairs, key) => stroke(pairs, f.paletteCss[key >> 1] || f.lineCss, 1, f.lineStrength * (1 - i * 0.22) * (key % 2 ? this.presence[pairs[0]] : 1)))
      );
    }
    const lit = [];
    for (let k = 0; k < this.lit.length; k += 2) if (spots.scale[this.lit[k]] && spots.scale[this.lit[k + 1]]) lit.push(this.lit[k], this.lit[k + 1]);
    stroke(lit, f.accentCss, 1.5, 0.9);

    const byBand = [new Map(), new Map(), new Map(), new Map()];
    const shaded = [[], [], [], []];
    for (let i = 0; i < this.count; i++) {
      const s = spots.scale[i];
      if (!s) continue;
      const r = Math.max(this.sizes[i] * s, 1.2);
      const x = spots.x[i];
      const y = spots.y[i];
      if (x < -r || y < -r || x > w + r || y > h + r || r > Math.max(w, h)) continue;
      const b = band(spots.depth[i]);
      const groups = byBand[b];
      const key = this.slots[i] * 2 + (this.presence[i] < 1 ? 1 : 0);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
      // Too small to show a light, or dimmed: left flat.
      if (r >= 3 && this.presence[i] >= 1) shaded[b].push(i);
    }
    // Discs, each its own offset and size of the note: one path for all of a band's.
    const discs = (list, dx, dy, k) => {
      ctx.beginPath();
      list.forEach((i) => {
        const r = Math.max(this.sizes[i] * spots.scale[i], 1.2);
        const x = spots.x[i] + r * dx;
        const y = spots.y[i] + r * dy;
        ctx.moveTo(x + r * k, y);
        ctx.arc(x, y, r * k, 0, Math.PI * 2);
      });
      ctx.fill();
    };
    for (let b = 3; b >= 0; b--) {
      const fog = 1 - (f.fog === undefined ? 0.65 : f.fog) * (b / 3);
      byBand[b].forEach((list, key) => {
        ctx.globalAlpha = fog * (key % 2 ? this.presence[list[0]] : 1);
        ctx.fillStyle = f.paletteCss[key >> 1] || f.paletteCss[0];
        discs(list, 0, 0, 1);
      });
      if (!shaded[b].length) continue;
      // The side away from the light: all but a crescent at the upper left, a little darker.
      ctx.globalAlpha = 0.14 * fog;
      ctx.fillStyle = '#000000';
      discs(shaded[b], 0.1, 0.1, 0.88);
      // The shine, up and to the left.
      ctx.globalAlpha = 0.3 * fog;
      ctx.fillStyle = '#ffffff';
      discs(shaded[b], -0.32, -0.34, 0.34);
    }
    ctx.globalAlpha = 1;
  }

  destroy() {}
}

/**
 * Over the graph: a glow round the note in focus, rings round the open
 * note and the picked one — each on a band of the background, so it
 * reads on light and dark alike — and the names, each on a soft haze of
 * the background (a wide faint stroke under a narrow one).
 *   o: { w, h, dpr, spots, radius(i), rings: [{ i, width }], names:
 *        [{ i, x, y }], text(i), alpha(i), focus, font, accent, text, ground }
 */
export function drawOverlay(ctx, o) {
  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  ctx.clearRect(0, 0, o.w, o.h);
  const { spots } = o;
  const TAU = Math.PI * 2;
  if (o.focus >= 0 && spots.scale[o.focus]) {
    // The glow: three rings of the accent outside the note, each fainter, so it never covers the ball.
    const x = spots.x[o.focus];
    const y = spots.y[o.focus];
    const r = o.radius(o.focus);
    ctx.fillStyle = o.accent;
    [[2, 5, 0.3], [5, 9, 0.16], [9, 14, 0.07]].forEach(([from, to, alpha]) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r + to, 0, TAU);
      ctx.arc(x, y, r + from, 0, TAU, true);
      ctx.fill();
    });
  }
  o.rings.forEach(({ i, width }) => {
    if (!spots.scale[i]) return;
    const at = o.radius(i) + 2 + width;
    ctx.beginPath();
    ctx.arc(spots.x[i], spots.y[i], at, 0, TAU);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = o.ground;
    ctx.lineWidth = width + 3;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = width;
    ctx.stroke();
  });
  if (o.names.length) {
    ctx.font = o.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = o.ground;
    o.names.forEach(({ i, x, y }) => {
      const t = o.text(i);
      const alpha = o.alpha(i);
      ctx.globalAlpha = alpha * 0.35;
      ctx.lineWidth = 6;
      ctx.strokeText(t, x, y);
      ctx.globalAlpha = alpha * 0.85;
      ctx.lineWidth = 2.5;
      ctx.strokeText(t, x, y);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = i === o.focus ? o.accent : o.textColour;
      ctx.fillText(t, x, y);
    });
  }
  ctx.globalAlpha = 1;
}
