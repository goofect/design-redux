/* ------------------------------------------------------------------ */
/* Tree: branches and notes                                            */
/*                                                                    */
/* A note's outline read — its headings, by level, and list items, by  */
/* how far in they are — for a branch to be made from it; and a branch */
/* written as a note: each node a heading as deep as it is, past six a */
/* list item, its details under it. Pure: text in, text out.          */
/* ------------------------------------------------------------------ */

import { newId } from './400-tree-model.js';

/**
 * An outline from markdown: headings, by level, and list items, by how
 * far in they are, under the heading they follow. `lists`: 'always', or
 * 'fallback' — only where there are no headings. `lines`: plain lines
 * count as items too. `subpath` ("#A#B"):
 * only what's under that heading. [{ text, children }].
 */
export function outlineFromMarkdown(text, opts) {
  opts = opts || {};
  const lines = String(text || '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
    .split(/\r?\n/);
  const entries = [];
  let fence = null;
  lines.forEach((line) => {
    const fenced = /^[ \t]*(```|~~~)/.exec(line);
    if (fenced) {
      if (!fence) fence = fenced[1];
      else if (fenced[1] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (h) {
      entries.push({ kind: 'heading', level: h[1].length, text: h[2].trim() });
      return;
    }
    const li = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]+)?(.+)$/.exec(line);
    if (li) entries.push({ kind: 'item', indent: li[1].replace(/\t/g, '    ').length, text: li[2].trim() });
    // `lines`: any other line with words is an item too, as far in as it's indented.
    else if (opts.lines && line.trim()) entries.push({ kind: 'item', indent: /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length, text: line.trim() });
  });
  // Only what's under one heading, its levels counted from there.
  let range = entries;
  const want = String(opts.subpath || '').split('#').map((s) => s.trim().toLowerCase()).filter(Boolean).pop();
  if (want) {
    const at = entries.findIndex((e) => e.kind === 'heading' && e.text.toLowerCase() === want);
    if (at === -1) return [];
    const top = entries[at].level;
    const end = entries.findIndex((e, i) => i > at && e.kind === 'heading' && e.level <= top);
    range = entries.slice(at + 1, end === -1 ? entries.length : end).map((e) => (e.kind === 'heading' ? Object.assign({}, e, { level: e.level - top }) : e));
  }
  const headings = range.some((e) => e.kind === 'heading');
  const items = opts.lists === 'always' || !headings ? range : range.filter((e) => e.kind === 'heading');
  // How far in one step of a list is: the least any item is indented.
  const steps = items.filter((e) => e.kind === 'item' && e.indent > 0).map((e) => e.indent);
  const step = steps.length ? Math.min(...steps) : 4;
  const out = [];
  const stack = [{ level: 0, children: out }];
  let under = 0;
  items.forEach((e) => {
    let level;
    if (e.kind === 'heading') {
      level = e.level;
      under = e.level;
    } else {
      level = under + 1 + Math.round(e.indent / step);
    }
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node = { text: e.text, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push({ level, children: node.children });
  });
  return out;
}

/** How many cards an outline makes. */
export function outlineSize(items) {
  return items.reduce((n, it) => n + 1 + outlineSize(it.children), 0);
}

/** A node's text, if it's just a link to a note: { target, alias }, or null. */
export function noteLinkOf(text) {
  const m = /^[ \t]*!?\[\[([^\]|#^]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\][ \t]*$/.exec(String(text || '').split('\n')[0]);
  return m ? { target: m[1].trim(), subpath: m[2] || '', alias: m[3] || '' } : null;
}

/** An outline as nodes, new ids, ready to insert: [{ id, text, attrs, anchor, children }]. */
export function nodesFromOutline(items) {
  return items.map((it) => ({ id: newId(), text: it.text, attrs: {}, anchor: false, children: nodesFromOutline(it.children || []) }));
}

/**
 * A node's branch as markdown: its own details first, then each node
 * below it as a heading as deep as it is — past six, as a list item —
 * with its details beneath. Nodes' own headings become bold lines, so
 * they don't break the outline.
 */
export function branchNoteText(node) {
  const out = [];
  const words = (n) => {
    const lines = String(n.text || '').split(/\r?\n/);
    const title = (lines[0] || '').trim().replace(/^#{1,6}[ \t]+/, '') || 'Untitled';
    const body = lines.slice(1).map((l) => l.replace(/^[ \t]+/, '').replace(/^#{1,6}[ \t]+(.*)$/, '**$1**'));
    while (body.length && !body[0].trim()) body.shift();
    while (body.length && !body[body.length - 1].trim()) body.pop();
    return { title, body };
  };
  const walk = (n, depth) => {
    n.children.forEach((c) => {
      const { title, body } = words(c);
      if (depth <= 6) {
        out.push(`${'#'.repeat(depth)} ${title}`, '');
        if (body.length) out.push(...body, '');
      } else {
        const pad = '\t'.repeat(depth - 7);
        out.push(`${pad}- ${title}`);
        body.filter((l) => l.trim()).forEach((l) => out.push(`${pad}  ${l.trim()}`));
      }
      walk(c, depth + 1);
    });
  };
  const top = words(node);
  if (top.body.length) out.push(...top.body, '');
  walk(node, 1);
  const text = [];
  out.forEach((line, i) => {
    if (i > 0 && /^#/.test(line) && /^\t*- /.test(out[i - 1])) text.push('');
    text.push(line);
  });
  return (text.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n').replace(/^\n$/, '');
}

/** A text's [[links]] to any of `olds` pointed at `next` instead, the rest of each link kept: the text, changed or not. */
export function relinkText(text, olds, next) {
  const wanted = new Set(olds.map((o) => o.toLowerCase()));
  return String(text || '').replace(/(!?\[\[)([^\]|#^]+)([^\]]*\]\])/g, (all, open, target, rest) => (wanted.has(target.trim().toLowerCase()) ? `${open}${next}${rest}` : all));
}
