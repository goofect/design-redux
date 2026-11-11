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

/** How many times a note's text has been read for its pages (the editor keeps this near zero as you type). */
export const pageStats = { parses: 0 };

/** Where a note's body begins: after its properties block. */
export function bodyStart(text) {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  return m ? m[0].length : 0;
}

/**
 * A note's pages: [{ name, marker: [from, to], from, to }] — the marker's own range, and the
 * page's text from after it to the next marker. Text before the first marker belongs to the
 * first page (its `preface`). No markers, no pages. Names are unique: a second marker of the
 * same name is that name 2, 3…, as a new page would be.
 */
export function parsePages(text) {
  pageStats.parses++;
  const start = bodyStart(text);
  const found = [];
  let fence = null;
  let pos = start;
  const lines = text.slice(start).split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
    }
    const m = !fence && !f ? PAGE_MARKER.exec(line) : null;
    if (m) found.push({ name: m[1] || 'Untitled', marker: [pos, pos + raw.length] });
    pos += raw.length + 1;
  }
  const names = found.map((f) => f.name);
  const taken = [];
  found.forEach((f) => {
    if (taken.includes(f.name)) f.name = uniqueName(f.name, names.concat(taken));
    taken.push(f.name);
  });
  return pageLayout(found, start, text.length);
}

/** Where each page's text runs, from its marker ([{ name, marker }], in order), where the body starts and how long the note is. */
export function pageLayout(found, start, length) {
  const pages = found.map((f) => ({ name: f.name, marker: [f.marker[0], f.marker[1]], from: Math.min(f.marker[1] + 1, length), to: length }));
  pages.forEach((p, i) => {
    if (i + 1 < pages.length) p.to = Math.max(p.from, pages[i + 1].marker[0] - 1);
  });
  if (pages.length && start < pages[0].marker[0]) pages[0].preface = [start, pages[0].marker[0]];
  return pages;
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
