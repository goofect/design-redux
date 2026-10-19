/* ------------------------------------------------------------------ */
/* Tree: a mind map as a markdown note                                 */
/*                                                                    */
/* The nodes are a nested list: one item each, indentation for depth;  */
/* a ^id only where something points to the node, its attributes in    */
/* one trailing %%{…}%%. Free nodes and relations have sections of     */
/* their own, and nudges and the last view a design-redux-layout block */
/* at the end. Whatever else the note holds is left alone.            */
/*                                                                    */
/* Written back, a node nothing changed keeps its lines exactly — its  */
/* marker, indentation, spacing and the blank lines after it — so a    */
/* note parsed and written with no change comes out byte for byte, and */
/* a change touches only the lines it has to.                         */
/* ------------------------------------------------------------------ */

import { newId, newNode, orderedAttrs } from './400-tree-model.js';

const ITEM = /^([ \t]*)([-*+]|\d+[.)])(?:([ \t]+)(.*))?$/;
const FENCE = /^[ \t]*(```|~~~)/;
const ANCHOR_AT_END = /[ \t]+\^([A-Za-z0-9-]+)[ \t]*$/;
// Text ending in what looks like an id: written with a backslash more before the ^, read with one less.
const LIKE_ANCHOR = /([ \t]+)(\\*)(\^[A-Za-z0-9-]+[ \t]*)$/;
const FREE_HEAD = /^#{1,6}[ \t]+Free nodes[ \t]*$/i;
const RELATIONS_HEAD = /^#{1,6}[ \t]+Relations[ \t]*$/i;
const LAYOUT_OPEN = /^```design-redux-layout[ \t]*$/;
const RELATION = /^[ \t]*[-*+][ \t]+\^([A-Za-z0-9-]+)[ \t]*->[ \t]*\^([A-Za-z0-9-]+)(?:[ \t]+"([^"]*)")?(?:[ \t]*%%(\{.*\})%%)?[ \t]*$/;

/** How wide an indentation is, a tab counting four. */
function widthOf(indent) {
  let w = 0;
  for (const ch of indent) w += ch === '\t' ? 4 : 1;
  return w;
}

/**
 * Where a line's attributes would begin: the last %%{ from which the rest
 * of the line is a JSON object closed by %% — { at, attrs, slashes }, with
 * how many backslashes stand before it — or null. Text that only looks
 * like attributes is written with a backslash before it, and read with
 * one less.
 */
function attrsTail(text) {
  for (let at = text.lastIndexOf('%%{'); at >= 0; at = at > 0 ? text.lastIndexOf('%%{', at - 1) : -1) {
    const m = /^%%(\{.*\})%%[ \t]*$/.exec(text.slice(at));
    if (!m) continue;
    let attrs;
    try {
      attrs = JSON.parse(m[1]);
    } catch (err) {
      continue;
    }
    if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) continue;
    let slashes = 0;
    while (at - slashes - 1 >= 0 && text[at - slashes - 1] === '\\') slashes++;
    return { at, attrs, slashes };
  }
  return null;
}

/** A node's first line as written: an ending that would read as an id or attributes, escaped. */
export function escapeItemEnd(text) {
  const tail = attrsTail(text);
  if (tail) return `${text.slice(0, tail.at)}\\${text.slice(tail.at)}`;
  if (LIKE_ANCHOR.test(text)) return text.replace(LIKE_ANCHOR, (all, space, slashes, rest) => `${space}\\${slashes}${rest}`);
  return text;
}

/** A node's first line as read: an escaped ending put back as typed. */
export function unescapeItemEnd(text) {
  // Nothing escaped without a backslash: most lines.
  if (text.indexOf('\\') < 0) return text;
  const tail = attrsTail(text);
  if (tail && tail.slashes) return text.slice(0, tail.at - 1) + text.slice(tail.at);
  const b = /([ \t]+)(\\+)(\^[A-Za-z0-9-]+[ \t]*)$/.exec(text);
  if (b) return text.slice(0, b.index) + b[1] + b[2].slice(1) + b[3];
  return text;
}

/** A node's first line taken apart: its text, its ^id, its attributes. */
export function splitItemText(raw) {
  let rest = raw;
  let attrs = {};
  const tail = attrsTail(rest);
  if (tail && !tail.slashes) {
    attrs = tail.attrs;
    rest = rest.slice(0, tail.at).replace(/[ \t]+$/, '');
  }
  let anchor = null;
  const m = rest.indexOf('^') >= 0 ? ANCHOR_AT_END.exec(rest) : null;
  if (m) {
    anchor = m[1];
    rest = rest.slice(0, m.index);
  }
  return { text: unescapeItemEnd(rest), attrs, anchor, attrsOk: true };
}

/** The lines of a list block made into nodes: the top ones, each node's source lines kept by its id. */
function readList(lines, from, to, sources, used) {
  const tops = [];
  const stack = [];
  let current = null;
  for (let i = from; i < to; i++) {
    const line = lines[i];
    const item = ITEM.exec(line);
    if (item) {
      const width = widthOf(item[1]);
      const parts = splitItemText(item[4] || '');
      let id = parts.anchor;
      if (!id || used.has(id)) id = newId();
      used.add(id);
      const node = newNode(parts.text, parts.attrs, id);
      node.anchor = !!parts.anchor && id === parts.anchor;
      while (stack.length && stack[stack.length - 1].width >= width) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].node : null;
      if (parent) {
        node.parent = parent;
        parent.children.push(node);
      } else tops.push(node);
      stack.push({ width, node });
      current = { node, lines: [line], marker: item[2], indent: item[1] };
      sources.set(id, current);
      continue;
    }
    // A blank line, or one set in: the node's text goes on.
    if (current && (line.trim() === '' || /^[ \t]+/.test(line))) {
      current.lines.push(line);
      if (line.trim() !== '') current.node.text += '\n' + line.replace(/^[ \t]*/, '');
      continue;
    }
    break;
  }
  return tops;
}

/** Where a list block ends: past its items, their continuations and the blank lines between them. */
function listEnd(lines, from, stop) {
  let last = from;
  let i = from;
  while (i < stop) {
    const line = lines[i];
    if (ITEM.exec(line) || (line.trim() !== '' && /^[ \t]+/.test(line))) {
      last = i + 1;
      i++;
      continue;
    }
    if (line.trim() === '') {
      i++;
      continue;
    }
    break;
  }
  return last;
}

/**
 * A note read as a mind map: { model, source }. `title` names the root
 * when the list has none of its own (no list, or several items at the top).
 */
export function parseOutline(text, opts = {}) {
  const eol = /\r\n/.test(text) ? '\r\n' : '\n';
  const lines = String(text || '').split(eol);
  const segments = [];
  const sources = new Map();
  const used = new Set();
  let i = 0;
  let raw = [];
  const flushRaw = () => {
    if (raw.length) segments.push({ kind: 'raw', lines: raw });
    raw = [];
  };
  let frontmatter = null;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end !== -1) {
      frontmatter = lines.slice(0, end + 1);
      raw = frontmatter.slice();
      i = end + 1;
    }
  }
  const model = { root: null, free: [], relations: [], layout: null, rest: null, mode: null };
  if (frontmatter) {
    const m = frontmatter.map((l) => /^mindmap-layout:[ \t]*["']?([A-Za-z-]+)["']?[ \t]*$/.exec(l)).find(Boolean);
    if (m) model.mode = m[1];
  }
  let section = 'main';
  let mainTops = null;
  let fence = null;
  let layoutRaw = null;
  const relations = [];
  while (i < lines.length) {
    const line = lines[i];
    if (fence) {
      raw.push(line);
      if (FENCE.test(line) && line.trim().startsWith(fence)) fence = null;
      i++;
      continue;
    }
    if (LAYOUT_OPEN.test(line)) {
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== '```') end++;
      flushRaw();
      layoutRaw = lines.slice(i, Math.min(end + 1, lines.length));
      segments.push({ kind: 'layout', lines: layoutRaw });
      try {
        model.layout = JSON.parse(lines.slice(i + 1, end).join('\n'));
      } catch (err) {
        model.layout = null;
      }
      i = end + 1;
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      fence = f[1];
      raw.push(line);
      i++;
      continue;
    }
    if (FREE_HEAD.test(line)) section = 'free';
    else if (RELATIONS_HEAD.test(line)) section = 'relations';
    const isItem = ITEM.exec(line);
    if (isItem && widthOf(isItem[1]) < 4 && ((section === 'main' && !mainTops) || section === 'free') && !segments.some((s) => s.kind === section)) {
      const end = listEnd(lines, i, lines.length);
      flushRaw();
      const tops = readList(lines, i, end, sources, used);
      if (section === 'main') mainTops = tops;
      else model.free = tops;
      segments.push({ kind: section, from: i, to: end });
      i = end;
      continue;
    }
    if (isItem && section === 'relations' && !segments.some((s) => s.kind === 'relations')) {
      const end = listEnd(lines, i, lines.length);
      flushRaw();
      for (let k = i; k < end; k++) {
        const r = RELATION.exec(lines[k]);
        let attrs = {};
        if (r && r[4]) {
          try {
            attrs = JSON.parse(r[4]);
          } catch (err) {
            attrs = {};
          }
        }
        relations.push({ raw: lines[k], rel: r ? { from: r[1], to: r[2], label: r[3] || '', attrs } : null });
      }
      model.relations = relations.filter((e) => e.rel).map((e) => e.rel);
      segments.push({ kind: 'relations', from: i, to: end });
      i = end;
      continue;
    }
    raw.push(line);
    i++;
  }
  flushRaw();
  // The root: the list's one top item, or — with none or several — one standing for the note.
  if (mainTops && mainTops.length === 1) model.root = mainTops[0];
  else {
    const root = newNode(opts.title || '');
    root.virtual = true;
    (mainTops || []).forEach((n) => {
      n.parent = root;
      root.children.push(n);
    });
    model.root = root;
  }
  if (!segments.some((s) => s.kind === 'main')) segments.splice(frontmatter ? 1 : 0, 0, { kind: 'main', from: 0, to: 0, empty: true });
  const source = { text, eol, lines, segments, sources, relations, layoutJson: JSON.stringify(model.layout), mode: model.mode, frontmatter: !!frontmatter, indent: indentUnit(sources) };
  noteWhatWas(model, source);
  model.source = source;
  return { model, source };
}

/** Each node's source noted with what it was then — its text, attributes, id shown, depth and parent — to tell what changed. */
function noteWhatWas(model, source) {
  const note = (n, depth, parentId) => {
    const src = source.sources.get(n.id);
    if (src) src.then = { text: n.text, attrs: attrsText(n.attrs), anchor: !!n.anchor, depth, parentId };
    n.children.forEach((c) => note(c, depth + 1, n.id));
  };
  const r = model.root;
  if (r && r.virtual) r.children.forEach((c) => note(c, 0, null));
  else if (r) note(r, 0, null);
  (model.free || []).forEach((n) => note(n, 0, null));
}

/**
 * A model tied to the text it now matches — after it was written, or
 * when it was made some other way: each node to its lines, by place
 * where the two have the same shape, else by ^id and then by text.
 */
export function bindSource(model, text, opts = {}) {
  const read = parseOutline(text, opts);
  const src = read.source;
  const fresh = new Map();
  const pairs = [];
  const flat = (m) => {
    const out = [];
    const go = (n, d) => {
      out.push([n, d]);
      n.children.forEach((c) => go(c, d + 1));
    };
    if (m.root && m.root.virtual) m.root.children.forEach((c) => go(c, 0));
    else if (m.root) go(m.root, 0);
    (m.free || []).forEach((n) => go(n, 0));
    return out;
  };
  const mine = flat(model);
  const theirs = flat(read.model);
  const same = mine.length === theirs.length && mine.every(([n, d], k) => theirs[k][1] === d && theirs[k][0].text === n.text);
  if (same) mine.forEach(([n], k) => pairs.push([n, theirs[k][0]]));
  else {
    const left = new Map(theirs.map(([n]) => [n.id, n]));
    // Theirs by text, in order: the first still left with the same text.
    const byText = new Map();
    theirs.forEach(([n]) => (byText.get(n.text) || byText.set(n.text, []).get(n.text)).push(n));
    const firstLeft = (text) => {
      const list = byText.get(text);
      while (list && list.length && !left.has(list[0].id)) list.shift();
      return list && list.length ? list[0] : null;
    };
    mine.forEach(([n]) => {
      let t = n.anchor ? left.get(n.id) : null;
      if (!t) t = firstLeft(n.text);
      if (t) {
        pairs.push([n, t]);
        left.delete(t.id);
      }
    });
  }
  pairs.forEach(([n, t]) => {
    const s = src.sources.get(t.id);
    if (s) fresh.set(n.id, s);
  });
  src.sources = fresh;
  noteWhatWas(model, src);
  model.source = src;
  return model;
}

/** The indentation the list uses for a level: the first step in from a parent, else a tab. */
function indentUnit(sources) {
  for (const src of sources.values()) {
    const parent = src.node.parent;
    const up = parent && sources.get(parent.id);
    if (up && src.indent.length > up.indent.length && src.indent.startsWith(up.indent)) return src.indent.slice(up.indent.length);
  }
  return '\t';
}

/** An attribute object as written: compact, in the fixed order. */
function attrsText(attrs) {
  // Most nodes have none: nothing to put in order.
  for (const k in attrs) if (attrs[k] !== undefined) return JSON.stringify(orderedAttrs(attrs));
  return '';
}

/** A node's lines, written new. */
function nodeLines(node, depth, unit, marker) {
  const indent = unit.repeat(depth);
  const [first, ...more] = String(node.text || '').split('\n');
  const tail = (node.anchor ? ` ^${node.id}` : '') + (attrsText(node.attrs) ? ` %%${attrsText(node.attrs)}%%` : '');
  const out = [`${indent}${marker} ${escapeItemEnd(first)}${tail}`.replace(/[ \t]+$/, (m) => (first || tail ? m : ''))];
  more.forEach((l) => out.push(`${indent}${' '.repeat(marker.length + 1)}${l}`));
  return out;
}

/** A node's branch as list lines, as the map writes them but with no ids: what Copy puts on the clipboard. */
export function branchLines(node, unit = '\t') {
  const out = [];
  const go = (n, depth) => {
    out.push(...nodeLines(Object.assign({}, n, { anchor: false }), depth, unit, '-'));
    n.children.forEach((c) => go(c, depth + 1));
  };
  go(node, 0);
  return out;
}

/** Whether a node is as it was read: the same text, attributes, id shown, depth and parent. */
function unchanged(node, src, depth, parentId) {
  const t = src && src.then;
  return !!t && t.depth === depth && t.parentId === parentId && t.text === node.text && t.attrs === attrsText(node.attrs) && t.anchor === !!node.anchor;
}

/** A relation as a line. */
function relationLine(r) {
  const label = r.label ? ` "${r.label}"` : '';
  const attrs = attrsText(r.attrs) ? ` %%${attrsText(r.attrs)}%%` : '';
  return `- ^${r.from} -> ^${r.to}${label}${attrs}`;
}

/** The layout block, as written. */
function layoutLines(layout) {
  return ['```design-redux-layout', JSON.stringify(layout), '```'];
}

/**
 * A map written as a note: given the text it was read from, every line
 * nothing changed is kept as it was, and only what changed is written new.
 */
export function writeOutline(model, previousText, opts = {}) {
  let source;
  if (previousText === undefined || previousText === null) {
    source = { eol: '\n', lines: [], segments: [{ kind: 'raw', lines: ['---', 'mindmap: true'].concat(model.mode ? [`mindmap-layout: ${model.mode}`] : []).concat(['---']) }, { kind: 'main', empty: true, tight: true }, { kind: 'raw', lines: [''] }], sources: new Map(), relations: [], layoutJson: 'null', mode: null, frontmatter: true, indent: '\t' };
  } else if (model.source && model.source.text === previousText) {
    source = model.source;
  } else {
    // Made elsewhere, or the file changed since: tied to the text first.
    const keep = model.source;
    bindSource(model, previousText, opts);
    source = model.source;
    model.source = keep;
  }
  const unit = source.indent || '\t';
  const emit = (nodes, depth, parentId, out) =>
    nodes.forEach((node) => {
      const src = source.sources.get(node.id);
      if (unchanged(node, src, depth, parentId)) out.push(...src.lines);
      else out.push(...nodeLines(node, depth, unit, src ? src.marker.replace(/\d+/, '1') : '-'));
      emit(node.children, depth + 1, node.id, out);
    });
  const out = [];
  const tops = model.root ? (model.root.virtual ? model.root.children : [model.root]) : [];
  let wroteFree = false;
  let wroteRelations = false;
  let wroteLayout = false;
  const changedLayout = JSON.stringify(model.layout === undefined ? null : model.layout) !== source.layoutJson;
  source.segments.forEach((seg, k) => {
    if (seg.kind === 'raw') {
      let ls = seg.lines;
      // The layout's name lives in the properties: changed there, if it changed.
      if (k === 0 && source.frontmatter && (model.mode || null) !== (source.mode || null)) ls = withMode(ls, model.mode);
      out.push(...ls);
    } else if (seg.kind === 'main') {
      const ls = [];
      emit(tops, 0, null, ls);
      if (seg.empty && ls.length && !seg.tight) {
        if (out.length && out[out.length - 1].trim() !== '' && out[out.length - 1] !== '---') out.push('');
        out.push(...ls);
        if (k < source.segments.length - 1) out.push('');
      } else out.push(...ls);
    } else if (seg.kind === 'free') {
      emit(model.free, 0, null, out);
      wroteFree = true;
    } else if (seg.kind === 'relations') {
      // In the order they were, lines it can't read kept where they were; new relations after.
      const left = model.relations.slice();
      source.relations.forEach((e) => {
        if (!e.rel) return out.push(e.raw);
        const at = left.findIndex((r) => relationKey(r) === relationKey(e.rel));
        if (at !== -1) {
          out.push(e.raw);
          left.splice(at, 1);
        }
      });
      left.forEach((r) => out.push(relationLine(r)));
      wroteRelations = true;
    } else if (seg.kind === 'layout') {
      if (model.layout) out.push(...(changedLayout ? layoutLines(model.layout) : seg.lines));
      wroteLayout = true;
    }
  });
  // Sections the note didn't have yet, when there's something to put in them: under their heading if
  // it's there with nothing under it (all its items taken out since), else before the layout block.
  const tail = [];
  if (!wroteFree && model.free.length) {
    const lines = [];
    emit(model.free, 0, null, lines);
    if (!underHeading(out, FREE_HEAD, lines)) tail.push('', '## Free nodes', ...lines);
  }
  if (!wroteRelations && model.relations.length) {
    const lines = model.relations.map((r) => relationLine(r));
    if (!underHeading(out, RELATIONS_HEAD, lines)) tail.push('', '## Relations', ...lines);
  }
  if (tail.length) {
    const at = wroteLayout ? out.findIndex((l) => LAYOUT_OPEN.test(l)) : -1;
    if (at === -1) appendBlock(out, tail);
    else out.splice(at, 0, ...tail.slice(1), '');
  }
  if (!wroteLayout && model.layout) appendBlock(out, [''].concat(layoutLines(model.layout)));
  return out.join(source.eol);
}

/** Lines put straight under the first heading `re` matches outside a code block; whether there was one. */
function underHeading(out, re, lines) {
  let fence = null;
  for (let i = 0; i < out.length; i++) {
    const f = FENCE.exec(out[i]);
    if (fence) {
      if (f && out[i].trim().startsWith(fence)) fence = null;
    } else if (f) fence = f[1];
    else if (re.test(out[i])) {
      out.splice(i + 1, 0, ...lines);
      return true;
    }
  }
  return false;
}

/** Lines added at the end of the note, before the blank line it ends with, if it ends with one. */
function appendBlock(out, block) {
  const endsBlank = out.length && out[out.length - 1] === '';
  if (endsBlank) out.splice(out.length - 1, 0, ...block);
  else out.push(...block);
}

function relationKey(r) {
  return `${r.from}>${r.to}|${r.label || ''}|${attrsText(r.attrs)}`;
}

/** The properties with mindmap-layout set to `mode`, or taken out. */
function withMode(lines, mode) {
  const at = lines.findIndex((l) => /^mindmap-layout:/.test(l));
  const next = lines.slice();
  if (at !== -1) {
    if (mode) next[at] = `mindmap-layout: ${mode}`;
    else next.splice(at, 1);
  } else if (mode) next.splice(next.length - 1, 0, `mindmap-layout: ${mode}`);
  return next;
}
