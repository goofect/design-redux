/* ------------------------------------------------------------------ */
/* Citations: a note cited as a source                                 */
/*                                                                     */
/* Any note can be a source; its citation is made from its properties: */
/* author, title, year, with a link to it. The first time a note cites */
/* a source it is in full; after that, short, as the Chicago notes     */
/* have it: the authors' surnames, the title without its subtitle,     */
/* where. A footnote cites a note when it links to it. Nothing is      */
/* drawn here.                                                         */
/* ------------------------------------------------------------------ */

import { noteProps, propOf, valuesOf } from '../core/notes.js';
import { findFootnotes, linkPaths } from './footnote-text.js';
import { valueShown } from './ledger.js';

/** A name's surname: before its comma when written "Hume, David", else its last word. */
const surname = (name) => (name.includes(',') ? name.split(',')[0] : name.split(/\s+/).pop()).trim();

/** Authors as a citation names them: one, "A and B", or the first "et al.". */
const named = (authors) => (authors.length > 2 ? `${authors[0]} et al.` : authors.join(' and '));

/** What a source is cited by, from its properties: { authors, author, title, year }; the title is the note's name when it has none. */
export function sourceOf(app, file) {
  const props = noteProps(app, file);
  // A date may come read as one: its day as written, not as the clock here has it.
  const plain = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);
  const first = (...keys) => {
    const v = keys.map((k) => propOf(props, k)).find((x) => valuesOf(x).length);
    return valuesOf(Array.isArray(v) ? v.map(plain) : plain(v)).map(valueShown);
  };
  const authors = first('author', 'authors', 'creator', 'by');
  const year = /\b\d{4}\b/.exec(first('year', 'date', 'published', 'issued')[0] || '');
  return { authors, author: named(authors), title: first('title')[0] || file.basename, year: year ? year[0] : '' };
}

/** A source's citation, as a footnote has it: its author, a link to it by its title, its year, then where in it; `short`, the surnames, the title without its subtitle, and where. */
export function citationOf(app, file, from, where, short) {
  const s = sourceOf(app, file);
  const title = short ? s.title.split(':')[0].trim() : s.title;
  const link = app.fileManager.generateMarkdownLink(file, from ? from.path : '', undefined, title === file.basename ? undefined : title);
  return [short ? named(s.authors.map(surname)) : s.author, link, short ? '' : s.year, where].filter(Boolean).join(', ');
}

/** The notes a note's footnotes link to. */
export function sourcesIn(app, text, from) {
  const found = new Set();
  findFootnotes(text).defs.forEach((d) => linkPaths(d.text).forEach((p) => {
    const dest = app.metadataCache.getFirstLinkpathDest(p.replace(/\.md$/, ''), from.path);
    if (dest) found.add(dest);
  }));
  return found;
}

/** The ids of a note's footnotes that cite a file: those whose citation links to it. */
export function citingIds(app, text, from, file) {
  const ids = new Set();
  findFootnotes(text).defs.forEach((d) => {
    if (linkPaths(d.text).some((p) => app.metadataCache.getFirstLinkpathDest(p.replace(/\.md$/, ''), from.path) === file)) ids.add(d.id);
  });
  return ids;
}
