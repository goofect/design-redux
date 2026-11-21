/* ------------------------------------------------------------------ */
/* Lettered and roman lists: in reading view                           */
/*                                                                     */
/* Markdown reads "a. one" lines as a paragraph, or as more text of    */
/* the numbered item they sit under. Where a block's lines from some   */
/* point on are all items, those lines are rebuilt in place as a list: */
/* the markers in a column, as written, a long item wrapping under its */
/* words, a deeper item (by the note's own indent) in a list under the */
/* one above. What the block held before the first item stays where it */
/* is; links and the like are moved into the list, never copied. This  */
/* is the note's rendered text, which Obsidian hands a post-processor  */
/* to change; nothing of its own interface is touched.                 */
/* ------------------------------------------------------------------ */

import { depth, isMarker } from './list-markers.js';

const MARK = /^\s*([a-z]+)([.)])[ \t]+/i;
const SOURCE_ITEM = /^([ \t]*)([a-z]+)[.)][ \t]/i;

/**
 * A block's lines as parts, read without touching it: a <br> or a newline
 * ends a line, a text node gives the slice of it on that line. Reading
 * stops at a list of Obsidian's own inside the block.
 */
function readLines(block) {
  const lines = [[]];
  for (const node of Array.from(block.childNodes)) {
    if (node.nodeName === 'UL' || node.nodeName === 'OL') break;
    if (node.nodeName === 'BR') {
      lines.push([]);
      lines[lines.length - 1].br = node;
    } else if (node.nodeType === 3) {
      let from = 0;
      node.data.split('\n').forEach((piece, i) => {
        if (i) {
          lines.push([]);
          lines[lines.length - 1].cut = { node, at: from - 1 };
        }
        if (piece) lines[lines.length - 1].push({ node, from, to: from + piece.length });
        from += piece.length + 1;
      });
    } else {
      lines[lines.length - 1].push({ node });
    }
  }
  return lines;
}

const textOf = (part) => (part.to === undefined ? part.node.textContent : part.node.data.slice(part.from, part.to));

/** The marker a line opens with, or null. */
function markerOf(line) {
  const first = line[0];
  if (!first || first.to === undefined) return null;
  const m = MARK.exec(textOf(first));
  return m ? { marker: m[1], stop: m[2], length: m[0].length } : null;
}

/**
 * Where a block's list is: `start`, the line of its first item; `items`,
 * each item's lines; or null when the block is no list.
 */
export function findList(block) {
  const filled = readLines(block).filter((line) => line.some((p) => textOf(p).trim()));
  const start = filled.findIndex((line) => markerOf(line));
  if (start < 0) return null;
  const items = [];
  filled.slice(start).forEach((line) => {
    const mark = markerOf(line);
    if (mark) items.push({ mark, lines: [line] });
    else items[items.length - 1].lines.push(line); // text straight after an item goes on it
  });
  if (items.length < 2) return null;
  return { first: filled[start], items };
}

/** Each item's depth, by the note's source lines: the next line opening with its marker. */
function depths(items, source) {
  let at = 0;
  let last = 0;
  return items.map(({ mark }) => {
    for (let i = at; i < source.length; i++) {
      const m = SOURCE_ITEM.exec(source[i]);
      if (m && m[2] === mark.marker) {
        at = i + 1;
        last = depth(m[1]);
        return last;
      }
    }
    return last;
  });
}

function listEl(doc) {
  const el = doc.createElement('div');
  el.className = 'dr-marked-list';
  el.setAttribute('role', 'list');
  return el;
}

/** An item's row: its marker, as written, and its words; the parts are moved in, a text slice made a node of its own. */
function rowOf(doc, item) {
  const row = doc.createElement('div');
  row.className = 'dr-list-row';
  row.setAttribute('role', 'listitem');
  const marker = row.appendChild(doc.createElement('span'));
  marker.className = 'dr-list-marker';
  marker.textContent = `${item.mark.marker}${item.mark.stop}`;
  const words = doc.createElement('span');
  words.className = 'dr-list-text';
  item.lines.forEach((line, n) => {
    if (n) words.appendChild(doc.createElement('br'));
    line.forEach((part, i) => {
      if (part.to === undefined) return words.appendChild(part.node);
      const text = textOf(part);
      words.appendChild(doc.createTextNode(i === 0 && n === 0 ? text.slice(item.mark.length) : text));
    });
  });
  row.appendChild(words);
  return row;
}

/** Which item each sits under (-1 for none), by depth; null when a marker does not follow the one before it in its list. */
function nesting(items, levels) {
  const under = [];
  const stack = [{ depth: levels[0], at: -1, marker: null }];
  for (let i = 0; i < items.length; i++) {
    while (stack.length > 1 && levels[i] < stack[stack.length - 1].depth) stack.pop();
    let level = stack[stack.length - 1];
    if (levels[i] > level.depth && level.last !== undefined) {
      level = { depth: levels[i], at: level.last, marker: null };
      stack.push(level);
    }
    if (!isMarker(items[i].mark.marker, level.marker)) return null;
    level.marker = items[i].mark.marker;
    level.last = i;
    under.push(level.at);
  }
  return under;
}

/**
 * Rebuilds a block's items as a list in place. `source` is the note's
 * lines for the block, if known. Returns whether it did.
 */
export function rebuildList(block, source) {
  const found = findList(block);
  const under = found && nesting(found.items, depths(found.items, source || []));
  if (!under) return false;
  const doc = block.ownerDocument;
  const before = Array.from(block.childNodes);
  const first = found.first;
  const cut = first.br ? { node: first.br, at: 0 } : first.cut || { node: first[0].node, at: 0 };
  const from = before.indexOf(cut.node);
  const stop = before.findIndex((n, i) => i > from && (n.nodeName === 'UL' || n.nodeName === 'OL'));
  // The rows first, while the parts they move are still in the block.
  const rows = found.items.map((item) => rowOf(doc, item));
  const top = listEl(doc);
  const subs = new Map();
  rows.forEach((row, i) => {
    const parent = under[i] < 0 ? top : subs.get(under[i]) || subs.set(under[i], rows[under[i]].appendChild(listEl(doc))).get(under[i]);
    parent.appendChild(row);
  });
  // The rest of the items' lines go; a text node the first item starts in keeps what is before it.
  before.slice(from + 1, stop < 0 ? before.length : stop).forEach((n) => n.parentNode === block && n.remove());
  if (cut.node.nodeType === 3 && cut.at > 0) cut.node.data = cut.node.data.slice(0, cut.at);
  else if (cut.node.parentNode === block) cut.node.remove();
  const next = stop < 0 ? null : before[stop];
  // No break or blank is left hanging between what came before and the list.
  for (let n = next ? next.previousSibling : block.lastChild; n && (n.nodeName === 'BR' || (n.nodeType === 3 && !n.data.trim())); n = next ? next.previousSibling : block.lastChild) n.remove();
  block.insertBefore(top, next);
  return true;
}
