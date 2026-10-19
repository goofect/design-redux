/* ------------------------------------------------------------------ */
/* Tree: a map written as OPML                                         */
/*                                                                    */
/* Each node an outline: its first line the text, its details the      */
/* _note, its attributes kept in an _attrs of their own so the plugin  */
/* reads them back as they were. Relations have no place in an outline */
/* and are left out. Pure.                                             */
/* ------------------------------------------------------------------ */

import { orderedAttrs } from './400-tree-model.js';

/** Text as an XML attribute's value. */
export function xmlAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;');
}

/** A map as an OPML document. `title` names it; a root standing for the note isn't an outline of its own. */
export function opmlFromMap(model, title) {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head>', `    <title>${xmlAttr(title || '')}</title>`, '  </head>', '  <body>'];
  const write = (n, depth) => {
    const [first, ...rest] = String(n.text || '').split('\n');
    const attrs = orderedAttrs(n.attrs || {});
    let tag = `${'  '.repeat(depth)}<outline text="${xmlAttr(first)}"`;
    if (rest.length && rest.join('\n').trim()) tag += ` _note="${xmlAttr(rest.join('\n'))}"`;
    if (Object.keys(attrs).length) tag += ` _attrs="${xmlAttr(JSON.stringify(attrs))}"`;
    if (!n.children.length) return lines.push(`${tag}/>`);
    lines.push(`${tag}>`);
    n.children.forEach((c) => write(c, depth + 1));
    lines.push(`${'  '.repeat(depth)}</outline>`);
  };
  const tops = model.root ? (model.root.virtual ? model.root.children : [model.root]) : [];
  tops.forEach((n) => write(n, 2));
  lines.push('  </body>', '</opml>');
  return lines.join('\n') + '\n';
}
