/* ------------------------------------------------------------------ */
/* Words: the plain outline                                            */
/*                                                                     */
/* Folders as one line each; one that is open lists its notes as       */
/* numbered rows; under the open note, its headings. The folder that   */
/* holds the open note starts open.                                    */
/* ------------------------------------------------------------------ */

import { readingMinutes } from '../core/text.js';
import { outlineFolder, row, rows } from '../ui/row.js';
import { sayso } from '../ui/state.js';
import { shownFolders } from './level-objects.js';
import { sortedNotes } from './order.js';

/** The rows of a folder's notes; under the open one, its headings (or whatever `plugin.partsOf` says a note is made of). */
export function noteRows(screen, list, folder) {
  const plugin = screen.plugin;
  const open = screen.openFile();
  sortedNotes(plugin, folder).forEach((note, i) => {
    row(list, {
      number: i + 1,
      name: note.basename,
      end: `${readingMinutes(plugin.index.words(note))} min`,
      path: note.path,
      current: note === open ? 'page' : false,
      selected: plugin.selection.is(note) && note !== open,
      run: (e) => screen.openNote(note, e),
    });
    if (note !== open) return;
    const parts = typeof plugin.partsOf === 'function' ? plugin.partsOf(note) : null;
    const cache = plugin.app.metadataCache.getFileCache(note);
    (parts || ((cache && cache.headings) || []).map((h) => ({ name: h.heading, subpath: `#${h.heading}` }))).forEach((part) => {
      row(list, { name: part.name, child: true, current: part.current ? 'location' : false, run: (e) => (part.run ? part.run(e) : screen.openNote(note, e, part.subpath)) }).setAttribute('tabindex', '-1');
    });
  });
}

export function drawWords(screen, host, folder) {
  const plugin = screen.plugin;
  const open = screen.openFile();
  const list = rows(host, { outline: true });
  noteRows(screen, list, folder);
  shownFolders(plugin, folder).forEach((f) => {
    const key = f.path;
    const holdsOpen = !!open && open.parent === f;
    const isOpen = screen.expanded.has(key) ? screen.expanded.get(key) : holdsOpen;
    outlineFolder(list, {
      name: f.name,
      count: plugin.index.count(f),
      open: isOpen,
      path: f.path,
      toggle: (e) => {
        // A second press on an open folder goes into it; the chevron's job is done by the first.
        if (e && e.detail === 2) return screen.go(f);
        screen.toggle(key, !isOpen);
      },
    });
    if (isOpen) noteRows(screen, list, f);
  });
  if (!list.firstChild) return void sayso(host, { label: 'Nothing in this folder yet', button: { text: 'New note', run: () => plugin.files.newNote(folder) } });
  screen.roving(list, '.dr-row, .dr-outline-folder', () => 1);
}
