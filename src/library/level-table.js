/* ------------------------------------------------------------------ */
/* Words at the window's width: a folder's notes as the table          */
/* ------------------------------------------------------------------ */

import { byName, listOf } from '../core/text.js';
import { noteProps, propOf, valuesOf } from '../core/notes.js';
import { outlineFolder, rows } from '../ui/row.js';
import { table } from '../ui/table.js';
import { shownFolders } from './level-objects.js';
import { listedNotes, sortOf } from './order.js';

const title = (key) => key.charAt(0).toUpperCase() + key.slice(1);

/** The table's columns: the note's name, the properties the person listed, its length. */
export function tableColumns(plugin) {
  return [{ id: 'name', name: 'Name' }]
    .concat(listOf(plugin.settings.tableColumns).map((key) => ({ id: `p:${key}`, name: title(key) })))
    .concat([{ id: 'words', name: 'Words', number: true }]);
}

export function drawTable(screen, host, folder) {
  const plugin = screen.plugin;
  const open = screen.openFile();
  const folders = shownFolders(plugin, folder);
  if (folders.length) {
    const list = rows(host, { outline: true });
    folders.forEach((f) => outlineFolder(list, { name: f.name, count: plugin.index.count(f), open: false, path: f.path, toggle: () => screen.go(f) }));
    screen.roving(list, '.dr-outline-folder', () => 1);
  }
  const columns = tableColumns(plugin);
  const sort = screen.tableSort;
  let notes = listedNotes(plugin, folder);
  const cellsOf = (note) => {
    const props = noteProps(plugin.app, note);
    const cells = { name: note.basename, words: plugin.index.words(note).toLocaleString() };
    columns.filter((c) => c.id.startsWith('p:')).forEach((c) => (cells[c.id] = valuesOf(propOf(props, c.id.slice(2))).join(', ')));
    return cells;
  };
  let data = notes.map((note) => ({ note, cells: cellsOf(note) }));
  if (sort) {
    const value = (d) => (sort.id === 'words' ? plugin.index.words(d.note) : d.cells[sort.id] || '');
    data = data.slice().sort((a, b) => (sort.id === 'words' ? value(a) - value(b) : byName(String(value(a)), String(value(b)))) * (sort.down ? -1 : 1));
  }
  const t = table(host, {
    flush: true,
    // Numbers only where the order means something: the folder's own, and not re-sorted by a column.
    numbered: !sort && sortOf(plugin, folder) === 'own',
    columns,
    sort: sort || null,
    onSort: (id) => {
      screen.tableSort = sort && sort.id === id ? (sort.down ? null : { id, down: true }) : { id, down: false };
      screen.draw();
    },
    onRow: (r, e) => screen.openNote(plugin.app.vault.getAbstractFileByPath(r.path), e),
    rows: data.map((d, i) => ({ number: i + 1, path: d.note.path, cells: d.cells, current: d.note === open, selected: plugin.selection.is(d.note) && d.note !== open })),
    empty: { label: 'No notes in this folder' },
  });
  screen.roving(t, 'tbody tr', () => 1);
  notes = null;
}
