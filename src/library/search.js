/* ------------------------------------------------------------------ */
/* Search: folders and notes by name, then notes by what they say      */
/*                                                                     */
/* Read from the index and Obsidian's cache alone (names, headings,    */
/* property values), so it answers as the letters are typed, whatever  */
/* the vault's size. The last few searches are offered again.          */
/* ------------------------------------------------------------------ */

import { TFolder } from 'obsidian';
import { clear, el } from '../core/dom.js';
import { noteProps, valuesOf } from '../core/notes.js';
import { foldersIfMixed } from '../core/text.js';
import { field } from '../ui/field.js';
import { row, rows, sectionTitle } from '../ui/row.js';
import { sayso } from '../ui/state.js';

const LIMIT = 60;

/** What matches `query`: { folders, notes (by name), inside (by a heading or a value) }, best first. */
export function searchLibrary(plugin, query) {
  const want = query.trim().toLowerCase();
  const out = { folders: [], notes: [], inside: [] };
  if (!want) return out;
  const rank = (name) => { const at = name.toLowerCase().indexOf(want); return at < 0 ? -1 : at === 0 ? 0 : 1; };
  const ranked = (list, name) => list.map((x) => [rank(name(x)), x]).filter((r) => r[0] >= 0).sort((a, b) => a[0] - b[0]).map((r) => r[1]);
  out.folders = ranked(plugin.index.folders(), (f) => f.name).slice(0, LIMIT);
  const all = plugin.index.markdown();
  out.notes = ranked(all, (f) => f.basename).slice(0, LIMIT);
  if (plugin.settings.searchNoteText === false) return out;
  const named = new Set(out.notes);
  for (const file of all) {
    if (out.inside.length >= LIMIT) break;
    if (named.has(file)) continue;
    const cache = plugin.app.metadataCache.getFileCache(file);
    const heading = ((cache && cache.headings) || []).find((h) => h.heading.toLowerCase().includes(want));
    const props = noteProps(plugin.app, file);
    const key = heading ? null : Object.keys(props).find((k) => valuesOf(props[k]).some((v) => v.toLowerCase().includes(want)));
    if (heading) out.inside.push({ file, where: 'heading', subpath: `#${heading.heading}` });
    else if (key) out.inside.push({ file, where: key });
  }
  return out;
}

/** The values a property takes across the vault, most used first: [[value, count]]. */
export function categoryValues(plugin, key) {
  const counts = new Map();
  plugin.index.markdown().forEach((f) => valuesOf(noteProps(plugin.app, f)[key]).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1)));
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30);
}

/** Keeps a search among the last few, newest first. */
export function rememberSearch(plugin, query) {
  const q = query.trim();
  if (!q) return;
  plugin.settings.recentSearches = [q].concat((plugin.settings.recentSearches || []).filter((x) => x !== q)).slice(0, 8);
  plugin.saveData(plugin.settings);
}

/** The search field and what it finds. `idle(host)`, given, draws what stands there while nothing is typed (the sidebar: the folders). */
export function drawSearch(screen, host, idle) {
  const plugin = screen.plugin;
  const top = el(host, 'div', 'dr-search');
  const results = el(host, 'div', 'dr-search-results');
  const show = (query) => {
    clear(results);
    if (!query.trim()) {
      if (idle) return void idle(results);
      const recent = plugin.settings.recentSearches || [];
      const key = String(plugin.settings.categoryProperty || '').trim();
      const categories = key ? categoryValues(plugin, key) : [];
      if (!recent.length && !categories.length) return void sayso(results, { label: 'Folders and notes by name; notes by a heading or a property.' });
      if (recent.length) {
        sectionTitle(results, { title: 'Recent' });
        const list = rows(results);
        recent.forEach((q) => row(list, { name: q, run: () => { input.drInput.value = q; screen.query = q; show(q); } }));
      }
      if (categories.length) {
        sectionTitle(results, { title: `By ${key}` });
        const list = rows(results);
        categories.forEach(([value, n]) => row(list, { name: value, end: String(n), run: () => screen.setFilter({ prop: `${key}=${value}` }, value) }));
      }
      return;
    }
    const found = searchLibrary(plugin, query);
    if (!found.folders.length && !found.notes.length && !found.inside.length) return void sayso(results, { label: `No folder or note matches “${query.trim()}”.` });
    const group = (title, items, draw) => {
      if (!items.length) return;
      sectionTitle(results, { title });
      const list = rows(results);
      items.forEach((item, i) => draw(list, item, i));
      screen.roving(list, '.dr-row', () => 1);
    };
    const done = () => rememberSearch(plugin, query);
    group('Folders', found.folders, (list, f) => row(list, { name: f.path, path: f.path, run: () => { done(); screen.go(f); } }));
    const folders = foldersIfMixed(found.notes);
    group('Notes', found.notes, (list, f, i) => row(list, { name: f.basename, end: folders[i], path: f.path, run: (e) => { done(); screen.openNote(f, e); } }));
    group('In notes', found.inside, (list, hit) => row(list, { name: hit.file.basename, end: hit.where, path: hit.file.path, run: (e) => { done(); screen.openNote(hit.file, e, hit.subpath); } }));
  };
  // No name over the field: its placeholder says what it is for.
  const input = field(top, { value: screen.query || '', placeholder: 'Notes and folders', onInput: (v) => { screen.query = v; show(v); }, onEnter: () => { const first = results.querySelector('.dr-row'); if (first) first.click(); } });
  input.drInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') screen.search(null);
    if (e.key === 'ArrowDown') { const first = results.querySelector('.dr-row'); if (first) { e.preventDefault(); first.focus(); } }
  });
  screen.searchInput = input.drInput;
  show(screen.query || '');
  void TFolder;
}
