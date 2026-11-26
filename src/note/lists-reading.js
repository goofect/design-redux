/* ------------------------------------------------------------------ */
/* Lettered, roman and outline lists: in reading view                  */
/*                                                                     */
/* Markdown reads "a. one" lines as a paragraph, or as more text of    */
/* the numbered item they sit under. Where a block's lines from some   */
/* point on are all items, those lines are rebuilt in place as a list  */
/* of the kind Obsidian renders its own numbered lists as, an ol of    */
/* li, so its styles (and a theme's) draw it: each marker as written   */
/* in the place of the number, a long item wrapping under its words, a */
/* deeper item (by the note's own indent) in a list under the one      */
/* above. What the block held before the first item stays where it    */
/* is; links and the like are moved into the list, never copied. This  */
/* is the note's rendered text, which Obsidian hands a post-processor  */
/* to change; nothing of its own interface is touched.                 */
/* ------------------------------------------------------------------ */

import { depth, isMarker } from './list-markers.js';

// A letter or numeral with its stop, or an outline number with its stop or without (lists-markers.js reads which are items).
const MARK = /^\s*([a-z]+(?=[.)])|\d+(?:\.\d+)+)([.)]?)[ \t]+/i;
const SOURCE_ITEM = /^([ \t]*)([a-z]+(?=[.)])|\d+(?:\.\d+)+)[.)]?[ \t]/i;
// An outline number that can open a list with nothing above it: one ending in .1.
const OPENS = /^\d+(?:\.\d+)*\.1$/;

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
  // A lone item is a sentence's start more often than a list, but not in lines drawn as text under a list (outline-text.js).
  if (items.length < 2 && !(block.closest && block.closest('.dr-as-text'))) return null;
  return { first: filled[start], items };
}

/** Each item's depth, by the note's source lines: the next line opening with its marker. */
function depths(items, source) {
  // No source (an embed): an outline number says how deep it is (3.1.1 is three parts), and a letter or numeral sits under it.
  if (!source.length) {
    let outline = -1;
    return items.map(({ mark }) => {
      if (/^\d+(?:\.\d+)+$/.test(mark.marker)) return (outline = mark.marker.split('.').length - 2) * 4;
      return (outline + 1) * 4;
    });
  }
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

/** A list as Obsidian renders its own numbered ones: an ol, its items li. */
function listEl(doc) {
  const el = doc.createElement('ol');
  el.className = 'dr-marked-list';
  return el;
}

/** An item: an li, its marker as written in the place of the number, its words moved in, a text slice made a node of its own. */
function rowOf(doc, item) {
  const row = doc.createElement('li');
  row.className = 'dr-list-row';
  row.dataset.marker = `${item.mark.marker}${item.mark.stop}`;
  item.lines.forEach((line, n) => {
    if (n) row.appendChild(doc.createElement('br'));
    line.forEach((part, i) => {
      if (part.to === undefined) return row.appendChild(part.node);
      const text = textOf(part);
      row.appendChild(doc.createTextNode(i === 0 && n === 0 ? text.slice(item.mark.length) : text));
    });
  });
  return row;
}

/** Room for a list's widest marker, in figures' widths, a space after it: where it is wider than Obsidian's own indent, the words step in. */
function roomFor(list) {
  const widest = Math.max(...Array.from(list.children).map((li) => li.dataset.marker.length));
  list.style.setProperty('--dr-marker', `${widest + 1}ch`);
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
    const { marker, stop } = items[i].mark;
    if (!isMarker(marker, level.marker, stop) && !(level.marker === null && OPENS.test(marker))) return null;
    level.marker = marker;
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
  [top].concat(Array.from(subs.values())).forEach(roomFor);
  // A list in one of Obsidian's own items is a list in a list, as its own nested lists are.
  if (block.closest('li')) top.classList.add('dr-marked-sublist');
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
