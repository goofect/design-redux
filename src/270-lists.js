/* ------------------------------------------------------------------ */
/* Lettered and roman numeral lists                                    */
/*                                                                     */
/* Markdown numbers lists 1., 2., 3. and nothing else, so a list       */
/* written a., b., c. or i., ii., iii. is plain paragraphs to          */
/* Obsidian. This makes it a list in the three places one shows:       */
/* drawn as one in reading view, styled as one in the editor, and      */
/* continued with the next letter or numeral when Enter is pressed.    */
/* The note's text is never changed — what you wrote is what's shown,  */
/* and any other markdown app reads the same file.                     */
/*                                                                     */
/* Some letters are numerals too — i, v, x, l, c, d, m — so what one   */
/* is depends on the item before it: "i" after "h" is the ninth        */
/* letter, and on its own it's the numeral one. Every item is read     */
/* against the one above it for that reason.                           */
/* ------------------------------------------------------------------ */

const ROMAN_DIGITS = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

const ROMAN_VALUES = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

/** Which kinds are recognised; the feature sets these from settings. */
const LIST_KINDS = { roman: true, alpha: true };

/*
 * "a." "a)" or "(a)" — letters in one case, at the start of a line
 * after any indentation, then at least one space. The same shapes legal
 * and academic writing number with.
 */
const LIST_ITEM = /^([ \t]*)(?:\(([a-z]+|[A-Z]+)\)|([a-z]+|[A-Z]+)([.)]))([ \t]+)/;

/** The opening or closing line of a fenced code block or a maths block. */
const LIST_FENCE = /^[ \t]*(```|~~~|\$\$)/;

/** A cheap test, run before anything that costs more. */
const LIST_HINT = /^[ \t]*(?:\([a-zA-Z]{1,15}\)|[a-zA-Z]{1,15}[.)])[ \t]/;

function toRoman(n) {
  let out = '';
  let rest = n;
  ROMAN_DIGITS.forEach(([value, digits]) => {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  });
  return out;
}

/**
 * A numeral's value, or 0 for anything not written the standard way —
 * "iiii", "vx" and "Iv" aren't numerals, and letting them through would
 * turn ordinary words at the start of a line into list items.
 */
function fromRoman(numeral) {
  if (!numeral || numeral.length > 15) return 0;
  const lower = numeral.toLowerCase();
  if (numeral !== lower && numeral !== numeral.toUpperCase()) return 0;
  let total = 0;
  for (let i = 0; i < lower.length; i++) {
    const here = ROMAN_VALUES[lower[i]];
    const next = ROMAN_VALUES[lower[i + 1]] || 0;
    if (!here) return 0;
    total += here < next ? -here : here;
  }
  if (total < 1 || total > 3999) return 0;
  return toRoman(total) === lower ? total : 0;
}

/** a–z, then aa, ab… as a spreadsheet's columns run. */
function toAlpha(n) {
  let out = '';
  let rest = n;
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

function fromAlpha(letters) {
  if (!letters || letters.length > 3) return 0;
  const lower = letters.toLowerCase();
  if (letters !== lower && letters !== letters.toUpperCase()) return 0;
  let total = 0;
  for (const ch of lower) {
    const code = ch.charCodeAt(0) - 96;
    if (code < 1 || code > 26) return 0;
    total = total * 26 + code;
  }
  return total;
}

/**
 * A line as a list item — { indent, kind, value, upper, style, marker,
 * prefix, content } — or null. `prev` is the item before it at the same
 * indent, as an item, null, or a function returning one; it's only
 * asked for when the line can't be read on its own.
 *
 * On its own, a line is an item only where lists start: at "a", or at
 * a numeral under 40 — so "i." is the numeral one. Anything else has to
 * follow the item before it, in the same style: "b" after "a", "i"
 * after "h", "xl" after "xxxix". That keeps words and names out — "etc."
 * "vs." "mix." "p. 12" and "J. Smith" don't follow anything — and a
 * single letter followed by another initial, "I. M. Pei" or
 * "A. B. Smith", is a name wherever it is.
 */
function parseListItem(text, prev) {
  const m = LIST_ITEM.exec(text);
  if (!m) return null;
  const token = m[2] || m[3];
  const content = text.slice(m[0].length);
  if (token.length === 1 && /^[A-Z]\.(\s|$)/.test(content)) return null;

  const roman = LIST_KINDS.roman ? fromRoman(token) : 0;
  const alpha = LIST_KINDS.alpha ? fromAlpha(token) : 0;
  if (!roman && !alpha) return null;

  const upper = token !== token.toLowerCase();
  const style = m[2] ? 'wrap' : m[4] === ')' ? 'paren' : 'dot';
  const make = (kind, value) => ({
    indent: m[1],
    kind: kind,
    value: value,
    upper: upper,
    style: style,
    marker: m[2] ? `(${token})` : token + m[4],
    prefix: m[0].length,
    content: content,
  });

  if (alpha === 1) return make('alpha', 1);
  if (roman && roman < 40 && token.length > 1) return make('roman', roman);

  const before = typeof prev === 'function' ? prev() : prev;
  if (before && before.upper === upper && before.style === style) {
    if (before.kind === 'alpha' && alpha === before.value + 1) return make('alpha', alpha);
    if (before.kind === 'roman' && roman === before.value + 1) return make('roman', roman);
  }
  if (roman && roman < 40) return make('roman', roman);
  return null;
}

/** The marker for a value, written the way `like` was. */
function listMarker(value, like) {
  let token = like.kind === 'alpha' ? toAlpha(value) : toRoman(value);
  if (like.upper) token = token.toUpperCase();
  if (like.style === 'wrap') return `(${token})`;
  return token + (like.style === 'paren' ? ')' : '.');
}

/** Whether two items belong to one list: same kind, case and punctuation. */
function sameListStyle(a, b) {
  return a.kind === b.kind && a.upper === b.upper && a.style === b.style;
}

/** The largest value a kind can be continued to. */
function listLimit(kind) {
  return kind === 'alpha' ? 18278 : 3999;
}

function leadingSpace(text) {
  return /^[ \t]*/.exec(text)[0];
}

/**
 * The item before a line, at its indent. The list is walked up to where
 * it starts and read back down, since what a letter is depends on what
 * came before it. Blank lines and deeper lines are passed over, and so
 * is text straight after an item, which continues it; the walk stops at
 * two blank lines, less indentation, or a paragraph that isn't part of
 * the list. `known` holds lines already read, by number.
 *
 * `doc` needs only line(n).text, numbered from 1 — an editor's document,
 * or a note's source seen from reading view.
 */
function listItemAbove(doc, lineNo, indent, known) {
  const run = [];
  let base = null;
  let blank = 0;
  let loose = false;
  for (let n = lineNo - 1; n >= 1 && n >= lineNo - 2000; n--) {
    const text = doc.line(n).text;
    if (!text.trim()) {
      // Plain text with a gap below and nothing above: a paragraph.
      if (loose) break;
      blank++;
      if (blank > 1) break;
      continue;
    }
    if (LIST_FENCE.test(text)) break;
    const own = leadingSpace(text);
    if (own.length > indent.length) {
      blank = 0;
      continue;
    }
    if (own === indent && LIST_ITEM.test(text)) {
      blank = 0;
      loose = false;
      const hit = known && known.has(n) ? known.get(n) : undefined;
      if (hit) {
        base = hit;
        break;
      }
      // Read already, and not an item: nothing to learn from it.
      if (hit === null) continue;
      run.push(text);
      continue;
    }
    if (own.length < indent.length) break;
    loose = true;
    blank = 0;
  }
  // A line shaped like an item that isn't one ("etc. and so on" under
  // an item) continues the item above rather than ending the list.
  let prev = base;
  for (let k = run.length - 1; k >= 0; k--) prev = parseListItem(run[k], prev) || prev;
  return prev;
}

/* -- the editor -------------------------------------------------------- */

/**
 * Code, maths, comments and frontmatter are left alone. Obsidian's
 * syntax tree names its nodes after the tokens they hold, so the names
 * say which of these a position is in.
 */
function listIgnored(state, pos) {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (/code|frontmatter|math|comment/i.test(node.name)) return true;
  }
  return false;
}

function listItemAt(state, lineNo, known) {
  if (known && known.has(lineNo)) return known.get(lineNo);
  const line = state.doc.line(lineNo);
  let item = null;
  if (LIST_HINT.test(line.text) && !listIgnored(state, line.from)) {
    item = parseListItem(line.text, () =>
      listItemAbove(state.doc, lineNo, leadingSpace(line.text), known)
    );
  }
  if (known) known.set(lineNo, item);
  return item;
}

/**
 * The items after an insertion move up one, so the list still counts
 * in order. Each is read against the item written before it, not the
 * new numbering, so "i" after "h" stays a letter as it moves. Nested
 * lines are passed over, text straight after an item is part of it,
 * and the list ends at anything else — a different kind of marker,
 * less indentation, or two blank lines.
 */
function renumberListAfter(state, lineNo, like, expected, changes) {
  const doc = state.doc;
  let next = expected;
  let blank = 0;
  let written = like;
  for (let n = lineNo + 1; n <= doc.lines && n <= lineNo + 2000; n++) {
    const line = doc.line(n);
    if (!line.text.trim()) {
      blank++;
      if (blank > 1) return;
      continue;
    }
    // A code or maths block ends the list: what's inside isn't items,
    // however much it looks like them.
    if (LIST_FENCE.test(line.text) || listIgnored(state, line.from)) return;
    const indent = leadingSpace(line.text);
    if (indent.length > like.indent.length) {
      blank = 0;
      continue;
    }
    const item = parseListItem(line.text, written);
    if (!item || item.indent !== like.indent || !sameListStyle(item, like)) {
      // Text straight after an item continues it; after a gap, it's not the list.
      if (item || blank || indent.length < like.indent.length) return;
      continue;
    }
    blank = 0;
    written = item;
    if (next > listLimit(like.kind)) return;
    if (item.value !== next) {
      const from = line.from + item.indent.length;
      changes.push({ from, to: from + item.marker.length, insert: listMarker(next, like) });
    }
    next++;
  }
}

/**
 * Enter on an item starts the next one, as it does for numbers: "b. "
 * after "a. …", "iv. " after "iii. …", in the same case and punctuation,
 * at the same indent. Whatever was after the cursor goes with it. Enter
 * on an item with nothing in it ends the list instead. Anything else is
 * left to Obsidian, including Vim's normal mode and text being composed.
 */
function listEnter(view) {
  const state = view.state;
  if (view.composing) return false;
  const vim = view.cm && view.cm.state && view.cm.state.vim;
  if (vim && !vim.insertMode) return false;

  const sel = state.selection.main;
  if (state.selection.ranges.length !== 1 || !sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const item = listItemAt(state, line.number);
  if (!item || sel.head < line.from + item.prefix) return false;

  if (!line.text.slice(item.prefix).trim()) {
    const from = line.from + item.indent.length;
    view.dispatch({
      changes: { from, to: line.to },
      selection: { anchor: from },
      userEvent: 'delete',
    });
    return true;
  }

  const value = item.value + 1;
  if (value > listLimit(item.kind)) return false;
  const after = state.doc.sliceString(sel.head, line.to);
  const skip = after.length - after.replace(/^[ \t]+/, '').length;
  const insert = `\n${item.indent}${listMarker(value, item)} `;
  const changes = [{ from: sel.head, to: sel.head + skip, insert }];
  renumberListAfter(state, line.number, item, value + 1, changes);

  view.dispatch({
    changes,
    selection: { anchor: sel.head + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
}

/**
 * Text widths in the editor's own font, for the hanging indent. A
 * canvas measures without touching the page; where there's none, an
 * estimate from the font size.
 */
function listMeasurer(view) {
  const style = window.getComputedStyle(view.contentDOM);
  const font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily]
    .filter(Boolean)
    .join(' ');
  const size = parseFloat(style.fontSize) || 16;
  let ctx = null;
  try {
    ctx = document.createElement('canvas').getContext('2d');
    if (ctx) ctx.font = font;
  } catch (err) {
    ctx = null;
  }
  const cache = new Map();
  const tab = ' '.repeat(view.state.tabSize || 4);
  return (text) => {
    const plain = text.replace(/\t/g, tab);
    if (!cache.has(plain)) {
      const width = ctx ? ctx.measureText(plain).width : plain.length * size * 0.5;
      cache.set(plain, Math.round(width * 10) / 10);
    }
    return cache.get(plain);
  };
}

const LIST_MARK = Decoration.mark({ class: 'dr-list-marker' });

/**
 * Each item line is given the marker's colour and a hanging indent, so
 * a long item wraps under its text rather than under its letter —
 * both as Obsidian does for its own numbered lists.
 */
function listDecorations(view, measure) {
  const builder = new RangeSetBuilder();
  const state = view.state;
  const known = new Map();
  let done = 0;
  view.visibleRanges.forEach(({ from, to }) => {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      // A fold inside a line splits it across two ranges; it's drawn once.
      if (line.number <= done) continue;
      done = line.number;
      const item = listItemAt(state, line.number, known);
      if (!item) continue;
      const width = measure(line.text.slice(0, item.prefix));
      builder.add(
        line.from,
        line.from,
        Decoration.line({
          class: 'dr-marked-line',
          attributes: { style: `--dr-list-hang: ${width}px` },
        })
      );
      const start = line.from + item.indent.length;
      builder.add(start, start + item.marker.length, LIST_MARK);
    }
  });
  return builder.finish();
}

function listEditorExtensions() {
  const decorations = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.measure = listMeasurer(view);
        this.decorations = listDecorations(view, this.measure);
      }

      update(u) {
        if (u.geometryChanged) this.measure = listMeasurer(u.view);
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.geometryChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        ) {
          this.decorations = listDecorations(u.view, this.measure);
        }
      }
    },
    { decorations: (v) => v.decorations }
  );
  // Ahead of Obsidian's own list handling, which would otherwise take
  // Enter and start a plain line.
  return [Prec.highest(keymap.of([{ key: 'Enter', run: listEnter }])), decorations];
}

/* -- reading view ------------------------------------------------------- */

const LIST_BLOCKS = new Set([
  'UL', 'OL', 'P', 'DIV', 'BLOCKQUOTE', 'PRE', 'TABLE', 'HR', 'DETAILS',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

/** Obsidian's own furniture at the start of a list item. */
function isListFurniture(node) {
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
function renderedLines(container) {
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
function renderedItem(line, prev) {
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
function listGutter(markers) {
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
function convertListLines(container, before) {
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
function renderLists(el, ctx) {
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

/* Obsidian's own bullet and number at the start of a line, and a task's box after one. */
const PLAIN_LIST_MARK = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+/;

/** Each line read as a list item against the one above it at its indent, or null. */
function readListLines(texts) {
  const prevAt = new Map();
  return texts.map((text) => {
    if (!text.trim()) return null;
    const indent = leadingSpace(text);
    // A shallower line ends the deeper lists below the one before it.
    Array.from(prevAt.keys()).forEach((k) => {
      if (k.length > indent.length) prevAt.delete(k);
    });
    const item = parseListItem(text, prevAt.get(indent) || null);
    prevAt.set(indent, item);
    return item;
  });
}

/** Whether every line but the blank ones is an item of one kind. */
function allListOf(texts, kind, read) {
  read = read || readListLines(texts);
  const filled = texts.filter((t) => t.trim()).length;
  const items = read.filter(Boolean);
  return filled > 0 && items.length === filled && items.every((it) => it.kind === kind);
}

/**
 * Lines made a list of one kind — 'alpha' or 'roman' — counted down each
 * indent: a., b., c. or i., ii., iii., in place of any bullet, number,
 * letter or numeral they had. If they're all that kind of list already,
 * they're made plain lines again. Blank lines stay as they are.
 */
function relistLines(texts, kind) {
  const read = readListLines(texts);
  if (allListOf(texts, kind, read)) return texts.map((text, i) => (read[i] ? read[i].indent + read[i].content : text));
  const counts = new Map();
  return texts.map((text, i) => {
    if (!text.trim()) return text;
    let indent;
    let content;
    if (read[i]) {
      indent = read[i].indent;
      content = read[i].content;
    } else {
      const plain = PLAIN_LIST_MARK.exec(text);
      indent = plain ? plain[1] : leadingSpace(text);
      content = plain ? text.slice(plain[0].length) : text.slice(indent.length);
    }
    Array.from(counts.keys()).forEach((k) => {
      if (k.length > indent.length) counts.delete(k);
    });
    const n = (counts.get(indent) || 0) + 1;
    counts.set(indent, n);
    return `${indent}${kind === 'alpha' ? toAlpha(n) : toRoman(n)}. ${content}`;
  });
}

/** A CodeMirror selection's lines — a selection ending at the start of a line doesn't take that line. */
function selectedLines(state) {
  const doc = state.doc;
  const sel = state.selection.main;
  const first = doc.lineAt(sel.from);
  let last = doc.lineAt(sel.to);
  if (last.number > first.number && sel.to === last.from) last = doc.line(last.number - 1);
  const texts = [];
  for (let n = first.number; n <= last.number; n++) texts.push(doc.line(n).text);
  return { from: first.from, to: last.to, texts };
}

/** The changes making a CodeMirror selection's lines a list of one kind, or plain again: { changes } or null. */
function relistSelection(state, kind) {
  const lines = selectedLines(state);
  const out = relistLines(lines.texts, kind);
  if (out.every((t, i) => t === lines.texts[i])) return null;
  return { changes: { from: lines.from, to: lines.to, insert: out.join('\n') } };
}

/* The right-click entries for each kind: toggles, as Obsidian's own Bullet and Numbered are. */
const LIST_MENU = {
  alpha: { setting: 'letterLists', title: 'Alphabetical', icon: 'case-lower' },
  roman: { setting: 'romanLists', title: 'Roman numerals', icon: 'list-ordered' },
};

/**
 * The list entries under Paragraph: "list" dropped from each of
 * Obsidian's own — Bullet, Numbered, Task — and ours put straight after
 * Numbered. Obsidian lays a menu out section by section, in the order
 * entries were added, so the order here is the order shown.
 */
function arrangeListEntries(host, section, ours) {
  try {
    const items = host && Array.isArray(host.items) ? host.items : null;
    if (!items) return;
    const theirs = items.filter((it) => it && it.section === section && ours.indexOf(it) === -1);
    const title = (it) => (it.titleEl ? it.titleEl.textContent || '' : '');
    theirs.forEach((it) => {
      const text = title(it);
      if (/ list$/i.test(text) && typeof it.setTitle === 'function') it.setTitle(text.replace(/ list$/i, ''));
    });
    const numbered = theirs.find((it) => /^numbered$/i.test(title(it))) || theirs[1];
    if (!numbered) return;
    ours.forEach((it) => {
      const at = items.indexOf(it);
      if (at !== -1) items.splice(at, 1);
    });
    items.splice(items.indexOf(numbered) + 1, 0, ...ours);
  } catch (err) {
    /* left where they were */
  }
}

class MarkedLists extends Feature {
  constructor(plugin) {
    super(plugin);
    // Registered once, filled and emptied: the way to switch an editor
    // extension on and off without registering it again.
    this.extensions = [];
    this.state = null;
  }

  /** On if either kind is. */
  get enabled() {
    return !!(this.settings.letterLists || this.settings.romanLists);
  }

  settingsSchema() {
    return [
      {
        key: 'letterLists',
        name: 'Alphabetical lists',
        desc: 'Lines starting a., b) or (c) become a list, continued when you press Enter.',
      },
      {
        key: 'romanLists',
        name: 'Roman numeral lists',
        desc: 'The same for i., ii) or (iii).',
      },
    ];
  }

  actions() {
    return ['alpha', 'roman'].map((kind) => ({
      id: kind === 'alpha' ? 'make-lettered-list' : 'make-roman-numeral-list',
      name: kind === 'alpha' ? 'Make the selected lines an alphabetical list, or plain again' : 'Make the selected lines a Roman numeral list, or plain again',
      menu: LIST_MENU[kind].title,
      icon: LIST_MENU[kind].icon,
      on: 'editor',
      when: (ctx) => !!this.settings[LIST_MENU[kind].setting] && !!ctx.cm,
      run: (ctx) => this.relist(ctx.cm, kind),
    }));
  }

  /**
   * In the editor's right-click menu, under Paragraph straight after
   * Obsidian's own Numbered where that can be found; otherwise beside its
   * other entries for a selection.
   */
  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, info) => {
        const ctx = this.enabled ? editorContext(editor, info, 'menu') : null;
        if (!ctx || !ctx.cm) return;
        // Older Obsidian builds Paragraph as a submenu of its own; newer
        // gathers a section into it, list entries in 'selection.paragraph.list'.
        const paragraph = findSubmenu(menu, 'Paragraph');
        const configs = !paragraph && menu.submenuConfigs && typeof menu.submenuConfigs === 'object' ? menu.submenuConfigs : null;
        const section = paragraph ? 'selection-list' : configs && configs['selection.paragraph'] ? 'selection.paragraph.list' : 'selection';
        const into = paragraph || menu;
        const ours = addActionEntries(into, this.actions(), ctx, section);
        if (section !== 'selection') arrangeListEntries(into, section, ours);
      })
    );
  }

  /** The selected lines — or the cursor's — made a list of one kind, or plain again. */
  relist(cm, kind) {
    if (!cm || !cm.state) return;
    const spec = relistSelection(cm.state, kind);
    if (!spec) return;
    cm.dispatch(Object.assign(spec, { scrollIntoView: true, userEvent: 'input' }));
    if (typeof cm.focus === 'function') cm.focus();
  }

  registerTypes() {
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (this.enabled) renderLists(el, ctx);
    });
  }

  enable() {
    this.apply(true);
  }

  disable() {
    this.apply(false);
  }

  /**
   * Also runs when either setting changes while the other stays on, so
   * editors and open notes are redrawn for the kinds now recognised.
   */
  apply(on) {
    const state = on ? `${!!this.settings.letterLists}/${!!this.settings.romanLists}` : 'off';
    if (this.state === state) return;
    const first = this.state === null;
    this.state = state;

    LIST_KINDS.alpha = !!this.settings.letterLists;
    LIST_KINDS.roman = !!this.settings.romanLists;
    this.extensions.length = 0;
    if (on) this.extensions.push(listEditorExtensions());
    this.app.workspace.updateOptions();
    // Notes already drawn were drawn with the old settings.
    if (!first || !on) rerenderReading(this.app);
  }
}
