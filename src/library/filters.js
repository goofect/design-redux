/* ------------------------------------------------------------------ */
/* Filters: notes from anywhere, by folder, tag, property and date     */
/*                                                                     */
/* A filter is { folder, tag, prop, date, loose }: `prop` is "key"     */
/* (has it), "!key" (lacks it) or "key=value"; `date` is week, month   */
/* or year since last edited; `loose` is notes in no folder. A sheet   */
/* sets it; kept with a name, a filter is a saved view.                */
/* ------------------------------------------------------------------ */

import { el, glyph } from '../core/dom.js';
import { noteProps, propOf, tagsOf, valuesOf } from '../core/notes.js';
import { foldersIfMixed } from '../core/text.js';
import { chooseFolder } from '../ui/choose.js';
import { chip, field } from '../ui/field.js';
import { row, rows } from '../ui/row.js';
import { Sheet } from '../ui/sheet.js';
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
  // Each part a plain chip with a close glyph; no fill.
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
  if (!notes.length) return void sayso(host, { label: 'No note passes the filter', text: 'Take a part of it off above.' });
  const list = rows(host);
  // A note's folder trails it only where what passes mixes folders; nothing else, no number.
  const folders = foldersIfMixed(notes);
  notes.forEach((note, i) => row(list, { name: note.basename, end: folders[i], path: note.path, current: note === open ? 'page' : false, run: (e) => screen.openNote(note, e) }));
  screen.roving(list, '.dr-row', () => 1);
}

/** The sheet that sets a screen's filter. */
export function editFilter(plugin, screen) {
  const draft = Object.assign({}, screen.filter || {});
  new Sheet(plugin.app, {
    title: 'Filter',
    build: (matter) => {
      const folder = field(matter, { label: 'In the folder', value: draft.folder || '', placeholder: 'Anywhere', onInput: (v) => (draft.folder = v.trim().replace(/\/$/, '')) });
      folder.drInput.addEventListener('dblclick', async () => { const f = await chooseFolder(plugin, { placeholder: 'In the folder…' }); if (f) folder.drInput.value = draft.folder = f.path === '/' ? '' : f.path; });
      field(matter, { label: 'With the tag', value: draft.tag || '', placeholder: 'Any', onInput: (v) => (draft.tag = v.trim()) });
      field(matter, { label: 'Property', value: draft.prop || '', placeholder: 'status=draft, status, or !status', note: 'A name alone: notes that have it. With ! before: notes that lack it.', onInput: (v) => (draft.prop = v.trim()) });
      field(matter, { label: 'Edited this', value: draft.date || '', placeholder: 'week, month or year', onInput: (v) => (draft.date = ['week', 'month', 'year'].includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : '') });
    },
    actions: [{ text: 'Clear', run: () => void screen.setFilter(null) }, { text: 'Cancel' }, { text: 'Show', run: () => void screen.setFilter(isFiltering(draft) ? draft : null) }],
  }).open();
}
