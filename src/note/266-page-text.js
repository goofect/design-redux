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

/** The text of a marker line for a page. */
export const pageMarker = (name) => `%%page: ${name}%%`;

/** Where a note's body begins: after its properties block. */
export function bodyStart(text) {
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  return m ? m[0].length : 0;
}

/**
 * A note's pages: [{ name, marker: [from, to], from, to }] — the marker's own range, and the
 * page's text from after it to the next marker. Text before the first marker belongs to the
 * first page (`from` runs back to it). No markers, no pages.
 */
export function parsePages(text) {
  const start = bodyStart(text);
  const pages = [];
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
    if (m) pages.push({ name: m[1] || 'Untitled', marker: [pos, pos + raw.length], from: Math.min(pos + raw.length + 1, text.length), to: text.length });
    pos += raw.length + 1;
  }
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

/** Every range of text out of sight while `open` is the page shown: other pages' text, and the markers (but a marker the cursor is on). */
export function hiddenRanges(text, open, cursors = []) {
  const pages = parsePages(text);
  if (!pages.length) return [];
  const shown = openPage(pages, open);
  const out = [];
  pages.forEach((p, i) => {
    if (p.preface && p !== shown) out.push([p.preface[0], p.preface[1] - 1 < p.preface[0] ? p.preface[0] : p.preface[1] - 1]);
    // The marker's line, whole, and the one break after it.
    // — shown only while the cursor is on it.
    if (!cursors.some((c) => c > p.marker[0] && c <= p.marker[1] + 1)) out.push([p.marker[0], Math.min(p.marker[1] + 1, text.length)]);
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
  const tail = text.endsWith('\n') ? '' : '\n';
  if (pages.length) return `${text}${tail}\n${pageMarker(name)}\n`;
  const start = bodyStart(text);
  const first = uniqueName(nameFromText(text.slice(start)), [name]);
  return `${text.slice(0, start)}${pageMarker(first)}\n${text.slice(start)}${tail}\n${pageMarker(name)}\n`;
}

/** The text with a page renamed. */
export function withPageRenamed(text, from, to) {
  const page = parsePages(text).find((p) => p.name === from);
  if (!page) return text;
  return text.slice(0, page.marker[0]) + pageMarker(to) + text.slice(page.marker[1]);
}

/** The text with a page and its marker taken away. Taking the last leaves the note one plain page. */
export function withPageRemoved(text, name) {
  const pages = parsePages(text);
  const i = pages.findIndex((p) => p.name === name);
  if (i === -1) return text;
  if (pages.length === 1) return text.slice(0, pages[0].marker[0]) + text.slice(Math.min(pages[0].marker[1] + 1, text.length));
  const p = pages[i];
  const end = i + 1 < pages.length ? pages[i + 1].marker[0] : text.length;
  const begin = p.preface ? p.preface[0] : p.marker[0];
  return text.slice(0, begin) + text.slice(end);
}

/** The text with a page moved a step: -1 earlier, 1 later. */
export function withPageMoved(text, name, step) {
  const pages = parsePages(text);
  const i = pages.findIndex((p) => p.name === name);
  const j = i + step;
  if (i === -1 || j < 0 || j >= pages.length) return text;
  const blocks = pages.map((p, k) => {
    const from = k === 0 && p.preface ? p.preface[0] : p.marker[0];
    const to = k + 1 < pages.length ? pages[k + 1].marker[0] : text.length;
    return text.slice(from, to).replace(/\n*$/, '\n\n');
  });
  const head = text.slice(0, pages[0].preface ? pages[0].preface[0] : pages[0].marker[0]);
  const moved = blocks.slice();
  [moved[i], moved[j]] = [moved[j], moved[i]];
  const body = moved.join('').replace(/\n+$/, '\n');
  return head + body;
}
