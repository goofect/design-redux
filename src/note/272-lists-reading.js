/* ------------------------------------------------------------------ */
/* Lettered and roman numeral lists: in reading view                   */
/*                                                                     */
/* Lines Obsidian drew as paragraphs drawn as the list they are.       */
/* ------------------------------------------------------------------ */

import { leadingSpace, LIST_HINT, listItemAbove, parseListItem, sameListStyle } from './270-lists.js';

/* -- reading view ------------------------------------------------------- */

export const LIST_BLOCKS = new Set([
  'UL', 'OL', 'P', 'DIV', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'DETAILS',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

/** Obsidian's own furniture at the start of a list item. */
export function isListFurniture(node) {
  return (
    node.nodeType === 1 &&
    (node.classList.contains('list-bullet') ||
      node.classList.contains('list-collapse-indicator') ||
      node.classList.contains('collapse-indicator'))
  );
}

/**
 * An element's text as the lines it was written in. Obsidian renders a
 * single line break as <br>, so a list typed one item per line arrives
 * as one paragraph with a <br> between items. Stops at the first block,
 * such as a list nested under an item.
 */
export function renderedLines(container) {
  const lines = [{ br: null, nodes: [] }];
  let stop = null;
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 1 && node.tagName === 'BR') {
      lines.push({ br: node, nodes: [] });
      continue;
    }
    if (node.nodeType === 1 && !isListFurniture(node) && LIST_BLOCKS.has(node.tagName)) {
      stop = node;
      break;
    }
    lines[lines.length - 1].nodes.push(node);
  }
  return { lines, stop };
}

/**
 * The item a rendered line starts, if its marker is plain text. One in
 * bold, a link or code was written that way on purpose and is left be.
 */
export function renderedItem(line, prev) {
  const first = line.nodes.find(
    (n) => !isListFurniture(n) && !(n.nodeType === 3 && !n.textContent.trim())
  );
  if (!first || first.nodeType !== 3) return null;
  const own = first.textContent.replace(/^\s+/, '');
  if (!LIST_HINT.test(own)) return null;
  const text = line.nodes
    .filter((n) => !isListFurniture(n))
    .map((n) => n.textContent)
    .join('')
    .replace(/^\s+/, '');
  const item = parseListItem(text, prev);
  if (!item || item.indent) return null;
  // Content can be an element with no text of its own — an image, an
  // embed, maths — which still makes the line an item.
  const more = line.nodes.some(
    (n) => n !== first && n.nodeType === 1 && !isListFurniture(n) && n.tagName !== 'BR'
  );
  if (!text.slice(item.prefix).trim() && !more) return null;
  if (own.length < item.prefix) return null;
  return Object.assign(item, { textNode: first, own: own });
}

/** A rough width for the gutter, so the longest marker fits it. */
export function listGutter(markers) {
  const narrow = { i: 0.28, l: 0.28, j: 0.28, f: 0.3, t: 0.33, r: 0.36, I: 0.3, J: 0.5 };
  const wide = { m: 0.83, w: 0.75, M: 0.83, W: 0.95 };
  const widthOf = (ch) => {
    if (narrow[ch]) return narrow[ch];
    if (wide[ch]) return wide[ch];
    if (ch === '.' ) return 0.28;
    if (ch === ')' || ch === '(') return 0.33;
    return ch === ch.toUpperCase() ? 0.68 : 0.52;
  };
  const longest = Math.max(
    ...markers.map((m) => Array.from(m).reduce((sum, ch) => sum + widthOf(ch), 0))
  );
  return `max(var(--list-indent, 2.25em), ${(longest + 0.6).toFixed(2)}em)`;
}

/**
 * Turn the lettered lines in a paragraph or list item into lists. From
 * the first item on, every line is either an item or text continuing
 * the one above; lines before the first stay as they were. In a list
 * item its own first line is its text, never an item — "- a. something"
 * is a bullet that happens to start with a letter.
 *
 * `before` is the item above the first line in the note's source, when
 * that's known, so a list with blank lines between its items — where
 * each item is drawn on its own — still counts on from the last.
 */
export function convertListLines(container, before) {
  const inItem = container.tagName === 'LI';
  const { lines, stop } = renderedLines(container);
  const doc = container.ownerDocument;
  const lists = [];
  let ol = null;
  let li = null;
  let like = null;
  let prev = before || null;

  for (let i = inItem ? 1 : 0; i < lines.length; i++) {
    const line = lines[i];
    const item = renderedItem(line, prev);
    if (!item && !li) {
      // Only the very first line can follow on from the source.
      prev = null;
      continue;
    }

    if (!item) {
      if (line.br) li.appendChild(line.br);
      line.nodes.forEach((n) => li.appendChild(n));
      continue;
    }

    if (line.br) line.br.remove();
    if (!ol || !sameListStyle(item, like)) {
      ol = doc.createElement('ol');
      ol.className = [
        'dr-marked-list',
        item.kind === 'alpha' ? 'is-alpha' : 'is-roman',
        item.upper ? 'is-upper' : 'is-lower',
      ].join(' ');
      lists.push(ol);
      like = item;
    }
    li = ol.appendChild(doc.createElement('li'));
    li.className = 'dr-marked-item';
    li.setAttribute('value', String(item.value));
    const marker = li.appendChild(doc.createElement('span'));
    marker.className = 'dr-list-marker';
    marker.textContent = item.marker;

    // The marker comes out of the text; the rest moves in whole, so
    // links, bold and embeds keep working.
    item.textNode.textContent = item.own.slice(item.prefix);
    let started = false;
    line.nodes.forEach((n) => {
      if (n === item.textNode) started = true;
      // Only the line break's own whitespace, before the marker, goes;
      // spaces between words and formatting stay.
      if (!started && n.nodeType === 3) return;
      li.appendChild(n);
    });
    prev = item;
  }

  if (!lists.length) return false;
  lists.forEach((list) => {
    const markers = Array.from(list.querySelectorAll(':scope > li > .dr-list-marker')).map(
      (m) => m.textContent
    );
    list.style.setProperty('--dr-list-gutter', listGutter(markers));
  });

  if (inItem) {
    lists.forEach((list) => container.insertBefore(list, stop));
  } else {
    container.after(...lists);
    if (
      !container.textContent.trim() &&
      !container.querySelector('img, iframe, video, audio, .internal-embed')
    ) {
      container.remove();
    }
  }
  return true;
}

/**
 * The post-processor: every paragraph and list item in a rendered
 * block. A paragraph that is the whole block starts on a known line of
 * the note, so the item above it can be found in the source.
 */
export function renderLists(el, ctx) {
  const containers = Array.from(el.querySelectorAll('p, li'));
  if (el.matches && el.matches('p, li')) containers.unshift(el);

  const sourceAbove = (container) => {
    if (container.tagName !== 'P' || container.parentElement !== el) return null;
    if (container !== el.firstElementChild) return null;
    if (!ctx || typeof ctx.getSectionInfo !== 'function') return null;
    return () => {
      const info = ctx.getSectionInfo(el);
      if (!info || typeof info.text !== 'string') return null;
      const source = info.text.split('\n');
      const doc = { line: (n) => ({ text: source[n - 1] || '' }) };
      const indent = leadingSpace(source[info.lineStart] || '');
      return listItemAbove(doc, info.lineStart + 1, indent);
    };
  };

  containers
    .filter((c) => !c.closest('pre, code, table, .callout-title, .dr-marked-list'))
    .forEach((c) => convertListLines(c, sourceAbove(c)));
}
