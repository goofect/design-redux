/* ------------------------------------------------------------------ */
/* Pages: one note, several pages — the text, worked out               */
/*                                                                     */
/* A page starts at a marker line, a comment that names it:            */
/* %%page: Sources%%. A note has pages as soon as it has markers; what */
/* comes before the first belongs to the first. The note stays         */
/* ordinary markdown that opens, searches and links anywhere. A marker */
/* inside a code fence doesn't count. Everything here is the text's    */
/* alone: where each page is, and the text a change to the pages makes.*/
/* ------------------------------------------------------------------ */

export const PAGE_MARKER = /^%%page:[ \t]*(.*?)[ \t]*%%[ \t]*$/;

/** A name a marker can hold: no %% or line break, which would end the comment early. */
export function cleanPageName(name, fallback = 'Untitled') {
  return String(name == null ? '' : name).replace(/(?:%%|[\r\n])+/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
}

export const pageMarker = (name) => `%%page: ${cleanPageName(name)}%%`;

const uniqueName = (name, taken) => {
  if (!taken.includes(name)) return name;
  let n = 2;
  while (taken.includes(`${name} ${n}`)) n++;
  return `${name} ${n}`;
};

/** The line a note's body begins on: after its properties block. */
export function bodyLine(lines) {
  if (!/^---[ \t]*$/.test(lines[0] || '')) return 0;
  for (let i = 1; i < lines.length; i++) if (/^---[ \t]*$/.test(lines[i])) return i + 1;
  return 0;
}

/**
 * A note's pages: [{ name, line (its marker's), from, to }] — `from` and
 * `to` are the lines its text runs over, the marker left out; the first
 * page's text starts at the body. No markers, no pages. A name used twice
 * is that name 2, 3…
 */
export function parsePages(text) {
  const lines = String(text).split('\n');
  const start = bodyLine(lines);
  const found = [];
  let fence = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    const m = fence ? null : PAGE_MARKER.exec(line);
    if (m) found.push({ name: m[1] || 'Untitled', line: i });
  }
  const taken = [];
  found.forEach((page, i) => {
    page.name = uniqueName(page.name, taken);
    taken.push(page.name);
    page.from = i === 0 ? start : page.line + 1;
    page.to = i + 1 < found.length ? found[i + 1].line : lines.length;
  });
  return found;
}

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/** A page's name from its first heading, for a note that gets its first marker. */
function nameFromBody(lines, start) {
  for (let i = start; i < lines.length; i++) {
    const m = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(lines[i]);
    if (m) return cleanPageName(m[1].replace(/[*_`%]/g, ''));
  }
  return 'Page 1';
}

/**
 * The text with a page added at the end. A note without pages gets its
 * first marker too, over what it already holds, so that stays a page.
 */
export function addPage(text, name) {
  const eol = eolOf(text);
  const lines = String(text).split('\n');
  const pages = parsePages(text);
  let out = String(text);
  const taken = pages.map((p) => p.name);
  if (!pages.length) {
    const start = bodyLine(lines);
    const first = nameFromBody(lines, start);
    lines.splice(start, 0, pageMarker(first) + (eol === '\r\n' ? '\r' : ''));
    out = lines.join('\n');
    taken.push(first);
  }
  const fresh = uniqueName(cleanPageName(name, `Page ${taken.length + 1}`), taken);
  return { text: `${out.replace(/(\r?\n)*$/, '')}${eol}${eol}${pageMarker(fresh)}${eol}`, name: fresh };
}

/** The text with a page renamed. */
export function renamePage(text, from, to) {
  const pages = parsePages(text);
  const page = pages.find((p) => p.name === from);
  if (!page) return text;
  const lines = String(text).split('\n');
  const cr = lines[page.line].endsWith('\r') ? '\r' : '';
  lines[page.line] = pageMarker(uniqueName(cleanPageName(to), pages.filter((p) => p !== page).map((p) => p.name))) + cr;
  return lines.join('\n');
}

/** The text with a page's marker taken out: its text joins the page before it. The last marker gone, the note has no pages. */
export function removePage(text, name) {
  const page = parsePages(text).find((p) => p.name === name);
  if (!page) return text;
  const lines = String(text).split('\n');
  lines.splice(page.line, 1);
  return lines.join('\n');
}
