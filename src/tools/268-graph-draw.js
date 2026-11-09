/* ------------------------------------------------------------------ */
/* The graph in three dimensions: drawing                             */
/*                                                                    */
/* WebGL where there is some, as Obsidian's own graph has: each note  */
/* a round point, shaded like a ball, the far ones sunk into the      */
/* background; the links as lines from one buffer of positions, which */
/* the layout fills once a step; what's behind hidden by depth. Where */
/* WebGL can't be had, the same on a 2D canvas, a path per depth band */
/* and colour rather than one per note. Over either, on a canvas of   */
/* its own, the rings round the open and picked notes, and the names. */
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
uniform vec2 u_fog;
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
  v_fog = 1.0 - 0.65 * clamp((depth - u_fog.x) / max(u_fog.y - u_fog.x, 1.0), 0.0, 1.0);
  v_colour = a_colour;
}`;

const NODE_FS = `
precision mediump float;
uniform vec3 u_ground;
varying vec4 v_colour;
varying float v_fog;
varying float v_px;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float shade = 0.8 + 0.2 * sqrt(1.0 - r2);
  float edge = 1.0 - smoothstep(1.0 - 4.0 / v_px, 1.0, r2);
  gl_FragColor = vec4(mix(u_ground, v_colour.rgb * shade, v_fog * v_colour.a * edge), 1.0);
}`;

const LINE_VS = `
attribute vec3 a_pos;
uniform mat4 u_matrix;
uniform vec3 u_eye;
uniform vec3 u_ahead;
uniform vec2 u_fog;
varying float v_fog;
void main() {
  float depth = dot(a_pos - u_eye, u_ahead);
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  v_fog = 1.0 - 0.7 * clamp((depth - u_fog.x) / max(u_fog.y - u_fog.x, 1.0), 0.0, 1.0);
}`;

const LINE_FS = `
precision mediump float;
uniform vec3 u_ground;
uniform vec3 u_colour;
uniform float u_strength;
varying float v_fog;
void main() {
  gl_FragColor = vec4(mix(u_ground, u_colour, u_strength * v_fog), 1.0);
}`;

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

/** Each note's colour and presence (1 as it is, less as it's dimmed), four numbers a note. */
function nodeColours(count, slots, presence, palette) {
  const out = new Float32Array(count * 4);
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
      line: glLocations(gl, this.lineProg, ['a_pos'], ['u_matrix', 'u_eye', 'u_ahead', 'u_fog', 'u_ground', 'u_colour', 'u_strength']),
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
    gl.bufferData(gl.ARRAY_BUFFER, nodeColours(this.count, slots, presence, palette), gl.DYNAMIC_DRAW);
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
      gl.uniform2f(L.u_fog, f.near, f.far);
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
    gl.depthMask(false);
    if (this.lineCount) {
      gl.uniform3f(L.u_colour, f.line[0], f.line[1], f.line[2]);
      gl.uniform1f(L.u_strength, f.lineStrength);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.index);
      gl.drawElements(gl.LINES, this.lineCount, this.indexType, 0);
    }
    if (this.litCount) {
      gl.uniform3f(L.u_colour, f.accent[0], f.accent[1], f.accent[2]);
      gl.uniform1f(L.u_strength, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buf.lit);
      gl.drawElements(gl.LINES, this.litCount, this.indexType, 0);
    }
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

/** The same on a 2D canvas: far bands first, a path per band and colour. */
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
    const bands = [[], [], [], []];
    for (let k = 0; k < this.links.length; k += 2) {
      const a = this.links[k];
      const b = this.links[k + 1];
      if (spots.scale[a] && spots.scale[b]) bands[band((spots.depth[a] + spots.depth[b]) / 2)].push(a, b);
    }
    bands.forEach((pairs, i) => stroke(pairs, f.lineCss, 1, f.lineStrength * (1 - i * 0.2)));
    const lit = [];
    for (let k = 0; k < this.lit.length; k += 2) if (spots.scale[this.lit[k]] && spots.scale[this.lit[k + 1]]) lit.push(this.lit[k], this.lit[k + 1]);
    stroke(lit, f.accentCss, 1.5, 0.9);

    const byBand = [new Map(), new Map(), new Map(), new Map()];
    for (let i = 0; i < this.count; i++) {
      const s = spots.scale[i];
      if (!s) continue;
      const r = Math.max(this.sizes[i] * s, 1.2);
      const x = spots.x[i];
      const y = spots.y[i];
      if (x < -r || y < -r || x > w + r || y > h + r || r > Math.max(w, h)) continue;
      const groups = byBand[band(spots.depth[i])];
      const key = this.slots[i] * 2 + (this.presence[i] < 1 ? 1 : 0);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    }
    for (let b = 3; b >= 0; b--) {
      byBand[b].forEach((list, key) => {
        ctx.globalAlpha = (1 - 0.65 * (b / 3)) * (key % 2 ? this.presence[list[0]] : 1);
        ctx.fillStyle = f.paletteCss[key >> 1] || f.paletteCss[0];
        ctx.beginPath();
        list.forEach((i) => {
          const r = Math.max(this.sizes[i] * spots.scale[i], 1.2);
          ctx.moveTo(spots.x[i] + r, spots.y[i]);
          ctx.arc(spots.x[i], spots.y[i], r, 0, Math.PI * 2);
        });
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
  }

  destroy() {}
}

/**
 * Over the graph: rings round the open note and the picked one, and the
 * names, each with a band of the background behind it to read on.
 *   o: { w, h, dpr, spots, radius(i), rings: [{ i, width }], names:
 *        [{ i, x, y }], text(i), alpha(i), focus, font, accent, text, ground }
 */
export function drawOverlay(ctx, o) {
  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  ctx.clearRect(0, 0, o.w, o.h);
  const { spots } = o;
  ctx.strokeStyle = o.accent;
  o.rings.forEach(({ i, width }) => {
    if (!spots.scale[i]) return;
    ctx.globalAlpha = 1;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(spots.x[i], spots.y[i], o.radius(i) + 2 + width, 0, Math.PI * 2);
    ctx.stroke();
  });
  if (o.names.length) {
    ctx.font = o.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    o.names.forEach(({ i, x, y }) => {
      const t = o.text(i);
      ctx.globalAlpha = o.alpha(i);
      ctx.strokeStyle = o.ground;
      ctx.strokeText(t, x, y);
      ctx.fillStyle = i === o.focus ? o.accent : o.textColour;
      ctx.fillText(t, x, y);
    });
  }
  ctx.globalAlpha = 1;
}
