/* ------------------------------------------------------------------ */
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
  missing: false,
  orphans: true,
  local: false,
  depth: 2,
  colourBy: 'folder',
  nodeSize: 1,
  names: 0.5,
  lines: 0.5,
  repel: 1,
  linkLength: 1,
  centre: 1,
  follow: false,
  spin: false,
  panel: false,
};

/** The colour keys that aren't a folder's or a tag's: each kind has the theme's colour for it. A space starts each, as no folder's or tag's can. */
export const KIND_KEYS = { tag: ' tag', file: ' file', missing: ' missing' };
const KIND_KEY_SET = new Set(Object.values(KIND_KEYS));

const topFolder = (path) => {
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
  const add = (id, kind, name, path, key, hay) => {
    if (at.has(id)) return at.get(id);
    at.set(id, all.length);
    all.push({ id, kind, name, path, key, hay });
    return all.length - 1;
  };
  notes.forEach((n) => add(n.path, 'note', n.name, n.path, colourKey(n, opts.colourBy), `${n.name} ${n.path} ${(n.tags || []).join(' ')}`.toLowerCase()));
  if (opts.attachments) files.forEach((f) => add(f.path, 'file', f.name, f.path, KIND_KEYS.file, `${f.name} ${f.path}`.toLowerCase()));

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
    if (opts.missing) Object.keys(n.missing || {}).forEach((name) => link(a, add(`missing:${name}`, 'missing', name, '', KIND_KEYS.missing, name.toLowerCase())));
    if (opts.tags) (n.tags || []).forEach((tag) => link(a, add(tag, 'tag', tag, '', KIND_KEYS.tag, tag.toLowerCase())));
  });

  const near = all.map(() => []);
  for (let k = 0; k < pairs.length; k += 2) {
    near[pairs[k]].push(pairs[k + 1]);
    near[pairs[k + 1]].push(pairs[k]);
  }

  // A search keeps the notes and files it matches; a tag or a missing
  // note stays if it matches, or a note kept links to it.
  let keep = all.map(() => true);
  const words = String(opts.search || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const matches = all.map((n) => words.every((w) => n.hay.includes(w)));
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
  return { nodes, links: Int32Array.from(kept), root: from >= 0 ? index[from] : -1 };
}

/**
 * What a 2D graph's options say, as the 3D graph's settings: what it can
 * read of them (they're Obsidian's own, so each is checked). A search
 * comes over only when it's plain words, as the 3D graph's search is.
 */
export function filtersFromGraph(o) {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  if (typeof o.search === 'string' && /^[^:"()\-]*$/.test(o.search)) out.search = o.search.trim();
  if (typeof o.showTags === 'boolean') out.tags = o.showTags;
  if (typeof o.showAttachments === 'boolean') out.attachments = o.showAttachments;
  if (typeof o.hideUnresolved === 'boolean') out.missing = !o.hideUnresolved;
  if (typeof o.showOrphans === 'boolean') out.orphans = o.showOrphans;
  if (typeof o.localJumps === 'number' && o.localJumps > 0) out.depth = Math.min(5, Math.round(o.localJumps));
  return out;
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
