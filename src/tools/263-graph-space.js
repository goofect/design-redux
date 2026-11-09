/* ------------------------------------------------------------------ */

import { matchQuery, parseQuery } from './277-graph-query.js';
/* The graph in three dimensions: what's drawn                        */
/*                                                                    */
/* The notes the 3D graph (269–275) shows and the links between them, */
/* worked out without Obsidian from what the view gathers of the      */
/* vault: notes, and as asked, attachments, tags and notes linked to  */
/* but not written yet; then cut down by a search, to what's around   */
/* one note, and without the notes linked to nothing. Each note gets  */
/* a colour key — its top folder or its first tag — and the keys are  */
/* given colours, the commonest first.                                */
/* ------------------------------------------------------------------ */

/** How a 3D graph starts: what it shows, how it's drawn, and its forces (each a multiple of the layout's own). */
export const GRAPH_3D_DEFAULTS = {
  search: '',
  tags: false,
  attachments: false,
  missing: true, // as the graph's own starts: Existing files only off, notes not written yet shown
  orphans: true,
  local: false,
  depth: 2,
  colourBy: 'community',
  nodeSize: 1,
  names: 0.5,
  lines: 0.5,
  repel: 1,
  linkLength: 1,
  centre: 1,
  follow: false,
  spin: false,
  panel: false,
  hidden: [], // top folders not drawn ('' for the notes at the vault's root)
  group: false, // each colour's notes pulled to a place of their own
  hubs: true, // the biggest notes named, with nothing picked
  links: true,
  folds: {}, // the settings' sections folded, by name
  colorGroups: [], // as the graph's own: [{ query, color: '#rrggbb' }], the first a note matches colouring it
  scene: 'night', // drawn on a night sky, as the graphify page is; 'theme': on the theme's background
};

/** The colour keys that aren't a folder's or a tag's: each kind has the theme's colour for it. A space starts each, as no folder's or tag's can. */
export const KIND_KEYS = { tag: ' tag', file: ' file', missing: ' missing' };
const KIND_KEY_SET = new Set(Object.values(KIND_KEYS));

export const topFolder = (path) => {
  const cut = path.indexOf('/');
  return cut > 0 ? path.slice(0, cut) : '';
};

function colourKey(note, by) {
  if (by === 'tag') return note.tags && note.tags.length ? note.tags[0] : '';
  if (by === 'folder') return topFolder(note.path);
  return '';
}

/**
 * The graph to draw.
 *   notes: [{ path, name, tags: ['#a'], links: { path: n }, missing: { linktext: n } }]
 *   files: [{ path, name }] — attachments, drawn when opts.attachments
 *   opts:  GRAPH_3D_DEFAULTS's shape
 *   root:  the id of the note the local graph is round
 * Gives { nodes: [{ id, kind, name, path, key, degree, near }], links:
 * Int32Array of index pairs, root: the root's index or -1 }. Links count
 * once whichever way they run; a note's link to itself is left out.
 */
export function buildSpace(notes, files, opts = GRAPH_3D_DEFAULTS, root = '') {
  const all = [];
  const at = new Map();
  // Each with what the search looks at: name, path, tags, and a note's text and properties as read.
  const add = (id, kind, name, path, key, seen) => {
    if (at.has(id)) return at.get(id);
    at.set(id, all.length);
    all.push({ id, kind, name, path, key, seen });
    return all.length - 1;
  };
  const hidden = new Set(opts.hidden || []);
  notes = notes.filter((n) => !hidden.has(topFolder(n.path)));
  notes.forEach((n) => add(n.path, 'note', n.name, n.path, colourKey(n, opts.colourBy), { name: n.name, path: n.path, tags: n.tags || [], text: typeof n.text === 'string' ? n.text : null, props: n.props || null }));
  if (opts.attachments) files.forEach((f) => !hidden.has(topFolder(f.path)) && add(f.path, 'file', f.name, f.path, KIND_KEYS.file, { name: f.name, path: f.path, tags: [], text: null, props: null }));

  const pairs = [];
  const seen = new Set();
  const link = (a, b) => {
    if (a === b) return;
    const key = a < b ? a * 2097152 + b : b * 2097152 + a;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push(a, b);
  };
  notes.forEach((n) => {
    const a = at.get(n.path);
    Object.keys(n.links || {}).forEach((to) => {
      const b = at.get(to);
      if (b !== undefined) link(a, b);
    });
    if (opts.missing) Object.keys(n.missing || {}).forEach((name) => link(a, add(`missing:${name}`, 'missing', name, '', KIND_KEYS.missing, { name, path: '', tags: [], text: null, props: null })));
    if (opts.tags) (n.tags || []).forEach((tag) => link(a, add(tag, 'tag', tag, '', KIND_KEYS.tag, { name: tag, path: '', tags: [tag], text: null, props: null })));
  });

  const near = all.map(() => []);
  for (let k = 0; k < pairs.length; k += 2) {
    near[pairs[k]].push(pairs[k + 1]);
    near[pairs[k + 1]].push(pairs[k]);
  }

  // A search, as Obsidian's, keeps the notes and files it matches; a
  // tag or a missing note stays if it matches, or a note kept links to it.
  let keep = all.map(() => true);
  const query = parseQuery(opts.search);
  if (query) {
    const matches = all.map((n) => matchQuery(query, n.seen));
    keep = all.map((n, i) => matches[i] || ((n.kind === 'tag' || n.kind === 'missing') && near[i].some((j) => matches[j] && all[j].kind === 'note')));
  }

  // What's around one note: as many steps out as asked.
  const from = root && at.has(root) ? at.get(root) : -1;
  if (opts.local) {
    const reached = all.map(() => false);
    if (from >= 0) {
      reached[from] = true;
      let ring = [from];
      for (let step = 0; step < Math.max(1, opts.depth) && ring.length; step++) {
        const next = [];
        ring.forEach((i) =>
          near[i].forEach((j) => {
            if (reached[j] || !keep[j]) return;
            reached[j] = true;
            next.push(j);
          })
        );
        ring = next;
      }
    }
    keep = reached;
  }

  if (!opts.orphans) {
    keep = keep.map((k, i) => k && (i === from || near[i].some((j) => keep[j])));
  }

  const index = new Int32Array(all.length).fill(-1);
  const nodes = [];
  all.forEach((n, i) => {
    if (!keep[i]) return;
    index[i] = nodes.length;
    nodes.push({ id: n.id, kind: n.kind, name: n.name, path: n.path, key: n.key, degree: 0, near: [] });
  });
  const kept = [];
  for (let k = 0; k < pairs.length; k += 2) {
    const a = index[pairs[k]];
    const b = index[pairs[k + 1]];
    if (a < 0 || b < 0) continue;
    kept.push(a, b);
    nodes[a].degree++;
    nodes[b].degree++;
    nodes[a].near.push(b);
    nodes[b].near.push(a);
  }
  const names = new Map();
  if (opts.colourBy === 'community') {
    // Each community goes by its most-linked note: its key, and its name.
    const label = findCommunities(nodes);
    const hub = new Map();
    nodes.forEach((n, i) => {
      if (!n.degree) return;
      const h = hub.get(label[i]);
      if (h === undefined || n.degree > nodes[h].degree || (n.degree === nodes[h].degree && n.name < nodes[h].name)) hub.set(label[i], i);
    });
    nodes.forEach((n, i) => {
      if (n.kind !== 'note') return;
      const h = n.degree ? hub.get(label[i]) : undefined;
      n.key = h === undefined ? '' : `c:${nodes[h].id}`;
      if (h !== undefined) names.set(n.key, nodes[h].name);
    });
  }
  // Colour groups, as the graph's own: a note (or file) takes the colour of the first whose query it
  // matches; while there are any, the notes in none are drawn plain, so the groups stand out.
  const queries = (opts.colorGroups || []).map((g) => parseQuery(g && g.query));
  if (queries.some(Boolean)) {
    nodes.forEach((n) => {
      if (n.kind === 'note') n.key = '';
    });
    all.forEach((n, i) => {
      if (index[i] < 0 || (n.kind !== 'note' && n.kind !== 'file')) return;
      const k = queries.findIndex((q) => q && matchQuery(q, n.seen));
      if (k < 0) return;
      const key = `g:${k}`;
      nodes[index[i]].key = key;
      names.set(key, opts.colorGroups[k].query);
    });
  }
  return { nodes, links: Int32Array.from(kept), root: from >= 0 ? index[from] : -1, names };
}

/** A group's colour as a colour picker wants it: #rrggbb. */
export function hexColour(rgb) {
  return `#${rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Communities, by label propagation: each note takes the label most of
 * its links have — a hub's counting for less — till none changes. The
 * most linked go first and ties go to the lower label, so the same
 * graph gives the same communities. Propagation leaves a sparse vault in
 * crumbs (thousands of twos and threes), so then each community smaller
 * than about √n⁄2 notes joins a neighbour, the smallest first: the one
 * it links to most for its size, as modularity would have it (links to
 * a big community count for less, so hubs don't swallow the vault); a
 * cluster linked to nothing else stays its own. Flat arrays
 * throughout: a pass costs a look at each link. Gives each note's label.
 */
export function findCommunities(nodes) {
  const n = nodes.length;
  const label = new Int32Array(n);
  if (!n) return label;
  // The links as one flat list, each note's a run of it.
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + nodes[i].near.length;
  const near = new Int32Array(start[n]);
  const weight = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    near.set(nodes[i].near, start[i]);
    weight[i] = 1 / Math.sqrt(Math.max(1, nodes[i].degree));
    label[i] = i;
  }
  const order = Int32Array.from(nodes.keys()).sort((a, b) => nodes[b].degree - nodes[a].degree || a - b);
  // Each label's weight among a note's links, and which labels were touched, to clear after.
  const sum = new Float64Array(n);
  const touched = new Int32Array(n);
  for (let round = 0; round < 30; round++) {
    let changed = 0;
    for (let k = 0; k < n; k++) {
      const i = order[k];
      if (start[i] === start[i + 1]) continue;
      let t = 0;
      for (let e = start[i]; e < start[i + 1]; e++) {
        const j = near[e];
        const l = label[j];
        if (sum[l] === 0) touched[t++] = l;
        sum[l] += weight[j];
      }
      let best = label[i];
      let most = sum[best];
      for (let q = 0; q < t; q++) {
        const l = touched[q];
        const w = sum[l];
        if (w > most + 1e-9 || (Math.abs(w - most) <= 1e-9 && l < best)) {
          best = l;
          most = w;
        }
      }
      for (let q = 0; q < t; q++) sum[touched[q]] = 0;
      if (best !== label[i]) {
        label[i] = best;
        changed++;
      }
    }
    if (!changed) break;
  }

  // The crumbs joined up. Members kept as chains (first, next, last) so a merge is a splice.
  const smallest = Math.max(4, Math.round(Math.sqrt(n) / 2));
  const size = new Int32Array(n);
  const total = new Float64Array(n);
  const twice = Math.max(1, start[n]);
  const first = new Int32Array(n).fill(-1);
  const last = new Int32Array(n).fill(-1);
  const next = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const l = label[i];
    size[l]++;
    total[l] += start[i + 1] - start[i];
    if (first[l] < 0) first[l] = i;
    else next[last[l]] = i;
    last[l] = i;
  }
  const small = [];
  for (let l = 0; l < n; l++) if (size[l] && size[l] < smallest) small.push(l);
  small.sort((a, b) => size[a] - size[b] || a - b);
  const links = new Float64Array(n);
  small.forEach((l) => {
    if (!size[l] || size[l] >= smallest) return;
    let t = 0;
    for (let i = first[l]; i >= 0; i = next[i]) {
      for (let e = start[i]; e < start[i + 1]; e++) {
        const m = label[near[e]];
        if (m === l) continue;
        if (links[m] === 0) touched[t++] = m;
        links[m]++;
      }
    }
    let to = -1;
    let gain = -Infinity;
    for (let q = 0; q < t; q++) {
      const m = touched[q];
      const g = links[m] - (total[l] * total[m]) / twice;
      if (g > gain + 1e-9 || (Math.abs(g - gain) <= 1e-9 && m < to)) {
        to = m;
        gain = g;
      }
    }
    for (let q = 0; q < t; q++) links[touched[q]] = 0;
    if (to < 0) return;
    for (let i = first[l]; i >= 0; i = next[i]) label[i] = to;
    next[last[to]] = first[l];
    last[to] = last[l];
    size[to] += size[l];
    total[to] += total[l];
    size[l] = 0;
  });
  return label;
}

/** What a colour key is called: a community by its note, the vault's root notes as the vault, a folder or tag as itself. */
export function groupName(graph, key) {
  if (graph.names && graph.names.has(key)) return graph.names.get(key);
  return key || 'Vault';
}

/**
 * A group's colour, the rank-th of as many as there are: hues a golden
 * angle apart, so neighbours in the list never look alike; brighter on a
 * dark background. Gives { css, rgb }.
 */
export function groupColour(rank, dark) {
  const h = (rank * 137.508 + 205) % 360;
  const s = dark ? 0.68 : 0.6;
  const l = dark ? 0.62 : 0.45;
  const k = (m) => (m + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (m) => l - a * Math.max(-1, Math.min(k(m) - 3, Math.min(9 - k(m), 1)));
  const rgb = [f(0), f(8), f(4)];
  return { css: `rgb(${rgb.map((c) => Math.round(c * 255)).join(', ')})`, rgb };
}

/**
 * What a 2D graph's options say, as the 3D graph's settings: what it can
 * read of them (they're Obsidian's own, so each is checked). The search
 * comes over as it is: the 3D graph's takes what Obsidian's does.
 */
export function filtersFromGraph(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  if (typeof o.search === 'string') out.search = o.search.trim();
  if (typeof o.showTags === 'boolean') out.tags = o.showTags;
  if (typeof o.showAttachments === 'boolean') out.attachments = o.showAttachments;
  if (typeof o.hideUnresolved === 'boolean') out.missing = !o.hideUnresolved;
  if (typeof o.showOrphans === 'boolean') out.orphans = o.showOrphans;
  if (typeof o.localJumps === 'number' && o.localJumps > 0) out.depth = Math.min(5, Math.round(o.localJumps));
  return out;
}

/** What a graph is worked out from, as a short mark: the same notes, links, tags and settings give the same mark, so a rebuild can be skipped. */
export function inputSignature(notes, files, opts, root) {
  let h = 2166136261;
  const mix = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  const o = opts || {};
  mix(JSON.stringify([o.search, o.tags, o.attachments, o.missing, o.orphans, o.local, o.depth, o.colourBy, o.hidden, (o.colorGroups || []).map((g) => [g.query, g.color]), root || '']));
  notes.forEach((n) => {
    mix(n.path);
    mix('\u0001');
    for (const to in n.links || {}) mix(to);
    mix('\u0002');
    for (const name in n.missing || {}) mix(name);
    mix('\u0003');
    (n.tags || []).forEach(mix);
  });
  files.forEach((f) => mix(f.path));
  return `${notes.length}:${files.length}:${h >>> 0}`;
}

/** A short mark of which notes there are and how they link: the same while neither changes. */
export function spaceSignature(graph) {
  let h = 2166136261;
  const mix = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  graph.nodes.forEach((n) => mix(`${n.kind}:${n.id}\n`));
  mix(Array.prototype.join.call(graph.links, ','));
  return `${graph.nodes.length}:${graph.links.length}:${h >>> 0}`;
}

/**
 * The colour keys in use, the commonest first, each with its count and
 * its place among the colours to hand (`slots` of them, taken in turn).
 * The kinds' keys and no key at all take no place.
 */
export function colourGroups(nodes, slots) {
  const counts = new Map();
  nodes.forEach((n) => {
    if (!n.key || KIND_KEY_SET.has(n.key)) return;
    counts.set(n.key, (counts.get(n.key) || 0) + 1);
  });
  return [...counts.keys()]
    .sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b))
    .map((key, i) => ({ key, count: counts.get(key), slot: i % slots }));
}

/** A CSS colour as [r, g, b] from 0 to 1: hex and rgb() read here, anything else through normalize (a canvas's way of writing it). */
export function parseColour(text, normalize) {
  const read = (s) => {
    let m = /^#([0-9a-f]{3,8})$/i.exec(s);
    if (m) {
      let hex = m[1];
      if (hex.length < 6) hex = hex.split('').map((c) => c + c).join('');
      return [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
    }
    m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    return m ? [m[1], m[2], m[3]].map((v) => Math.min(255, parseFloat(v)) / 255) : null;
  };
  const s = String(text || '').trim();
  return read(s) || (normalize ? read(String(normalize(s) || '')) : null) || [0.5, 0.5, 0.5];
}
