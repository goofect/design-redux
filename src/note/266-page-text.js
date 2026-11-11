/* ------------------------------------------------------------------ */
/* Pages: one note, several pages                                      */
/*                                                                     */
/* A page starts at a marker line, a comment that names it:            */
/* %%page: Sources%%. A note has pages as soon as it has markers. What */
/* is worked out here is the text's alone — where each page is, and    */
/* the text a change to the pages makes — so one note stays ordinary   */
/* markdown that opens, searches and links anywhere. A marker inside a  */
/* code fence doesn't count.                                           */
/* ------------------------------------------------------------------ */

export const PAGE_MARKER = /^%%page:[ \t]*(.*?)[ \t]*%%[ \t]*$/;

/** A page's name from its first heading, else Untitled. */
export function nameFromText(body) {
  const m = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(body || '');
  return m ? m[1].replace(/[*_`%]/g, '').trim() || 'Untitled' : 'Untitled';
}

/** A name nobody else has: the name, then the name 2, 3… */
export function uniqueName(name, taken) {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

/** A name a marker can hold: no `%%` or line break, which would end the comment early; nothing left, the fallback. */
export function cleanPageName(name, fallback = 'Untitled') {
  return String(name == null ? '' : name).replace(/(?:%%|[\r\n])+/g, ' ').trim() || fallback;
}

/** The text of a marker line for a page. */
export const pageMarker = (name) => `%%page: ${cleanPageName(name)}%%`;

/** The note's own line ending, so what's added matches it. */
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/** How many times a note's text has been read for its pages (the editor keeps this near zero as you type), and a view drawn whole. */
export const pageStats = { parses: 0, draws: 0 };

/** Where a note's body begins: after its properties block. */
export function bodyStart(text) {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  return m ? m[0].length : 0;
}

/**
 * A note's pages: [{ name, marker: [from, to], from, to, line, lines }] — the marker's own range,
 * the page's text from after it to the next marker, the marker's line and the lines the page
 * runs over (from its preface, to the next marker's line). Text before the first marker belongs to the
 * first page (its `preface`). No markers, no pages. Names are unique: a second marker of the
 * same name is that name 2, 3…, as a new page would be.
 */
export function parsePages(text) {
  pageStats.parses++;
  const start = bodyStart(text);
  const found = [];
  let fence = null;
  let pos = start;
  const startLine = text.slice(0, start).split('\n').length - 1;
  let n = startLine;
  const lines = text.slice(start).split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    const m = !fence && !f ? PAGE_MARKER.exec(line) : null;
    if (m) found.push({ name: m[1] || 'Untitled', marker: [pos, pos + raw.length], line: n });
    pos += raw.length + 1;
    n++;
  }
  const names = found.map((f) => f.name);
  const taken = [];
  found.forEach((f) => {
    if (taken.includes(f.name)) f.name = uniqueName(f.name, names.concat(taken));
    taken.push(f.name);
  });
  return pageLayout(found, start, text.length, startLine);
}

/** Where each page's text runs, from its marker ([{ name, marker, line }], in order), where the body starts and how long the note is, and the body's first line. */
export function pageLayout(found, start, length, startLine = 0) {
  const pages = found.map((f) => ({ name: f.name, marker: [f.marker[0], f.marker[1]], from: Math.min(f.marker[1] + 1, length), to: length, line: f.line, lines: [f.line, Infinity] }));
  pages.forEach((p, i) => {
    if (i + 1 < pages.length) {
      p.to = Math.max(p.from, pages[i + 1].marker[0] - 1);
      p.lines[1] = pages[i + 1].line;
    }
  });
  if (pages.length && start < pages[0].marker[0]) {
    pages[0].preface = [start, pages[0].marker[0]];
    pages[0].lines[0] = startLine;
  }
  return pages;
}

/** Which page a line is on, by index (-1 before the first): a binary search, the pages being in order. */
export function pageOfLine(pages, line) {
  let lo = 0;
  let hi = pages.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].lines[0] <= line) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at !== -1 && line < pages[at].lines[1] ? at : -1;
}

/** The page open: the one named if it's there, else the first. */
export function openPage(pages, name) {
  return pages.find((p) => p.name === name) || pages[0] || null;
}

/** Which page a place in the text is on, by index: -1 before the first (in the properties). */
export function pageAt(pages, pos) {
  let at = -1;
  pages.forEach((p, i) => {
    if (pos >= (i === 0 && p.preface ? p.preface[0] : p.marker[0])) at = i;
  });
  return at;
}

/** Is a cursor on a page's marker line (which shows it, to be edited)? */
export const onMarker = (p, c) => c > p.marker[0] && c <= p.marker[1] + 1;

/** Every range of text out of sight while `open` is the page shown: other pages' text, and the markers (but a marker the cursor is on). */
export function hiddenRanges(text, open, cursors = []) {
  return hiddenOf(parsePages(text), open, cursors, text.length);
}

/** The same, from pages already found, in a note `length` long. */
export function hiddenOf(pages, open, cursors, length) {
  if (!pages.length) return [];
  const shown = openPage(pages, open);
  const out = [];
  pages.forEach((p, i) => {
    if (p.preface && p !== shown) out.push([p.preface[0], p.preface[1] - 1 < p.preface[0] ? p.preface[0] : p.preface[1] - 1]);
    // The marker's line, whole, and the one break after it.
    // — shown only while the cursor is on it.
    if (!cursors.some((c) => onMarker(p, c))) out.push([p.marker[0], Math.min(p.marker[1] + 1, length)]);
    if (p !== shown && p.to > p.from) out.push([p.from, p.to]);
  });
  return out.filter(([a, b]) => b > a);
}

/** A name for a new page — nothing is on it yet, so Untitled — that no other page has. */
export function newPageName(pages) {
  return uniqueName('Untitled', pages.map((p) => p.name));
}

/** The text with a page added at the end — a plain note first gets a marker above what it has, named from its first heading. */
export function withPageAdded(text, name) {
  const pages = parsePages(text);
  const eol = eolOf(text);
  const tail = text.endsWith('\n') ? '' : eol;
  if (pages.length) return `${text}${tail}${eol}${pageMarker(name)}${eol}`;
  const start = bodyStart(text);
  const first = uniqueName(nameFromText(text.slice(start)), [name]);
  return `${text.slice(0, start)}${pageMarker(first)}${eol}${text.slice(start)}${tail}${eol}${pageMarker(name)}${eol}`;
}

/** The text with each marker naming its page as it's shown: a second "A" written "A 2", so a change to one page leaves the others' names as they were. */
export function withNamesWritten(text) {
  let out = text;
  parsePages(text)
    .reverse()
    .forEach((p) => {
      const m = PAGE_MARKER.exec(out.slice(p.marker[0], p.marker[1]).replace(/\r$/, ''));
      if (m && (m[1] || 'Untitled') !== p.name) out = remarked(out, p, p.name);
    });
  return out;
}

/** The text with a page's marker naming it `name` (its line ending kept). */
const remarked = (text, p, name) => text.slice(0, p.marker[0]) + pageMarker(name) + (text.slice(p.marker[0], p.marker[1]).endsWith('\r') ? '\r' : '') + text.slice(p.marker[1]);

/** The text with a page renamed. */
export function withPageRenamed(text, from, to) {
  text = withNamesWritten(text);
  const page = parsePages(text).find((p) => p.name === from);
  if (!page) return text;
  return remarked(text, page, to);
}

/** The text with a page and its marker taken away. One page left, its marker goes too: the note is one plain page. */
export function withPageRemoved(text, name) {
  text = withNamesWritten(text);
  const pages = parsePages(text);
  const i = pages.findIndex((p) => p.name === name);
  if (i === -1) return text;
  const unmark = (t, p) => t.slice(0, p.marker[0]) + t.slice(Math.min(p.marker[1] + 1, t.length));
  if (pages.length === 1) return unmark(text, pages[0]);
  const p = pages[i];
  const end = i + 1 < pages.length ? pages[i + 1].marker[0] : text.length;
  const begin = p.preface ? p.preface[0] : p.marker[0];
  const out = text.slice(0, begin) + text.slice(end);
  const left = parsePages(out);
  return left.length === 1 ? unmark(out, left[0]) : out;
}

/** The text with a page moved a step: -1 earlier, 1 later. */
export function withPageMoved(text, name, step) {
  text = withNamesWritten(text);
  const pages = parsePages(text);
  const i = pages.findIndex((p) => p.name === name);
  const j = i + step;
  if (i === -1 || j < 0 || j >= pages.length) return text;
  // The text before the first marker stays where it is, whichever page comes first now.
  const eol = eolOf(text);
  const blocks = pages.map((p, k) => {
    const to = k + 1 < pages.length ? pages[k + 1].marker[0] : text.length;
    return text.slice(p.marker[0], to).replace(/(\r?\n)*$/, eol + eol);
  });
  const head = text.slice(0, pages[0].marker[0]);
  const moved = blocks.slice();
  [moved[i], moved[j]] = [moved[j], moved[i]];
  const body = moved.join('').replace(/(\r?\n)+$/, eol);
  return head + body;
}

/** A text's lines, each with its own line ending: joined, they're the text again. */
const linesOf = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];

/**
 * What changed from text `a` to text `b`, by line: [{ at, old, now, pre, post }] — at line `at`
 * of `b`, the lines `now` stand where `a` had `old`; `pre` and `post` are the lines of `b` either
 * side (null at the start or end). Lines the same at both ends are set aside first, so a small
 * change costs little; past `limit` steps the middle is taken as one change.
 */
export function pageHunks(a, b, limit = 2000) {
  const A = linesOf(a);
  const B = linesOf(b);
  let head = 0;
  while (head < A.length && head < B.length && A[head] === B[head]) head++;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head && A[A.length - 1 - tail] === B[B.length - 1 - tail]) tail++;
  const xs = A.slice(head, A.length - tail);
  const ys = B.slice(head, B.length - tail);
  // Myers' diff of the middle: each step a line taken out of `a` or put in from `b`.
  const n = xs.length;
  const m = ys.length;
  const off = n + m + 1;
  const v = new Int32Array(2 * off + 1);
  const trace = [];
  let found = false;
  for (let d = 0; d <= n + m && d <= limit && !found; d++) {
    // Only the band of diagonals step d can reach, so the record grows with the steps, not the note.
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && xs[x] === ys[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  // Each line of the middle: of `a` only ('-'), of `b` only ('+') or of both ('='), in order.
  let ops = [];
  if (!found) ops = xs.map(() => '-').concat(ys.map(() => '+'));
  else {
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const band = trace[d];
      const at = (k) => band[k + d] || 0;
      const k = x - y;
      const pk = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
      const px = at(pk);
      const py = px - pk;
      while (x > px && y > py) {
        ops.push('=');
        x--;
        y--;
      }
      if (d > 0) ops.push(x === px ? '+' : '-');
      x = px;
      y = py;
    }
    ops.reverse();
  }
  const hunks = [];
  let i = head;
  let j = head;
  let cur = null;
  ops.forEach((op) => {
    if (op === '=') {
      cur = null;
      i++;
      j++;
      return;
    }
    if (!cur) hunks.push((cur = { at: j, old: [], now: [] }));
    if (op === '-') cur.old.push(A[i++]);
    else cur.now.push(B[j++]);
  });
  hunks.forEach((h) => {
    h.pre = h.at > 0 ? B[h.at - 1] : null;
    h.post = h.at + h.now.length < B.length ? B[h.at + h.now.length] : null;
  });
  return hunks;
}

/**
 * The text with the changes `hunks` (of `pageHunks`) put back: each found by its lines and the
 * lines either side as the change left them, wherever the rest has moved. Null when any isn't
 * there as it was: the text around it was edited since.
 */
export function withHunksUndone(text, hunks) {
  const L = linesOf(text);
  const at = [];
  for (const h of hunks) {
    const fits = (p) =>
      (h.pre === null ? p === 0 : p > 0 && L[p - 1] === h.pre) &&
      p + h.now.length <= L.length &&
      h.now.every((line, k) => L[p + k] === line) &&
      (h.post === null ? p + h.now.length === L.length : L[p + h.now.length] === h.post);
    let best = -1;
    for (let p = 0; p <= L.length; p++) if (fits(p) && (best === -1 || Math.abs(p - h.at) < Math.abs(best - h.at))) best = p;
    if (best === -1) return null;
    if (at.length && best < at[at.length - 1] + hunks[at.length - 1].now.length) return null;
    at.push(best);
  }
  for (let k = hunks.length - 1; k >= 0; k--) L.splice(at[k], hunks[k].now.length, ...hunks[k].old);
  return L.join('');
}
