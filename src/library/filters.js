/* ------------------------------------------------------------------ */
/* Filters: notes from anywhere, by folder, tag, property and date     */
/*                                                                     */
/* A filter is { folder, tag, prop, date, loose }: `prop` is "key"     */
/* (has it), "!key" (lacks it) or "key=value"; `date` is week, month   */
/* or year since last edited; `loose` is notes in no folder. Kept with */
/* a name, a filter is a saved view.                                   */
/* ------------------------------------------------------------------ */

import { el, glyph } from '../core/dom.js';
import { noteProps, propOf, tagsOf, valuesOf } from '../core/notes.js';
import { counted, foldersIfMixed, readingMinutes } from '../core/text.js';
import { chip } from '../ui/field.js';
import { row, rows } from '../ui/row.js';
import { sayso } from '../ui/state.js';

const DAYS = { week: 7, month: 31, year: 366 };

export const isFiltering = (f) => !!f && !!(f.folder || f.tag || f.prop || f.date || f.loose);

/** The notes a filter lets through, by name. `now` is the time dates are counted from. */
export function matchNotes(plugin, filter, now = Date.now()) {
  const f = filter || {};
  const prop = String(f.prop || '').trim();
  const [key, value] = prop.replace(/^!/, '').split('=').map((s) => s.trim());
  const tag = String(f.tag || '').replace(/^#/, '').toLowerCase();
  return plugin.index.markdown().filter((note) => {
    if (f.loose && note.parent && note.parent.path !== '/') return false;
    if (f.folder && !(note.path.startsWith(`${f.folder}/`))) return false;
    if (tag && !tagsOf(plugin.app, note).some((t) => t === tag || t.startsWith(`${tag}/`))) return false;
    if (key) {
      const values = valuesOf(propOf(noteProps(plugin.app, note), key));
      if (prop.startsWith('!') ? values.length > 0 : value !== undefined ? !values.some((v) => v.toLowerCase() === value.toLowerCase()) : !values.length) return false;
    }
    if (f.date && DAYS[f.date] && now - note.stat.mtime > DAYS[f.date] * 864e5) return false;
    return true;
  });
}

/** What a filter says, part by part: [{ part, text }]. */
export function filterParts(filter) {
  const f = filter || {};
  return [
    f.loose ? { part: 'loose', text: 'In no folder' } : null,
    f.folder ? { part: 'folder', name: 'In', text: f.folder } : null,
    f.tag ? { part: 'tag', name: 'Tag', text: f.tag } : null,
    f.prop ? { part: 'prop', name: 'Property', text: f.prop } : null,
    f.date ? { part: 'date', name: 'Edited', text: `this ${f.date}` } : null,
  ].filter(Boolean);
}

/** Draws what a screen's filter lets through: the filter as chips (a press takes one off), then the notes. */
export function drawFiltered(screen, host) {
  const plugin = screen.plugin;
  const open = screen.openFile();
  const bar = el(host, 'div', 'dr-filter-bar');
  // Each part a plain chip with a close glyph: the one fill on the screen stays the open note's.
  filterParts(screen.filter).forEach((p) => {
    const c = chip(bar, { name: p.name, value: p.text, run: () => {
      const next = Object.assign({}, screen.filter);
      delete next[p.part];
      screen.setFilter(isFiltering(next) ? next : null, screen.filterName);
    } });
    c.setAttribute('aria-label', `Take off: ${[p.name, p.text].filter(Boolean).join(' ')}`);
    glyph(c, 'close');
  });
  const notes = matchNotes(plugin, screen.filter);
  el(bar, 'span', 'dr-small dr-muted', counted(notes.length, 'note'));
  if (!notes.length) return void sayso(host, { glyph: 'filter', label: 'No note passes the filter', text: 'Take a part of it off above.' });
  const list = rows(host);
  // A note's folder trails it only where what passes mixes folders; otherwise its length does.
  const folders = foldersIfMixed(notes);
  notes.forEach((note, i) => row(list, { name: note.basename, end: folders[i] || `${readingMinutes(plugin.index.words(note))} min`, path: note.path, current: note === open ? 'page' : false, run: (e) => screen.openNote(note, e) }));
  screen.roving(list, '.dr-row', () => 1);
}
