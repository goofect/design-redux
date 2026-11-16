/* ------------------------------------------------------------------ */
/* Shelves: each folder a row of bars, one a note                      */
/* ------------------------------------------------------------------ */

import { barSize, counted } from '../core/text.js';
import { el } from '../core/dom.js';
import { shelf } from '../ui/shelf.js';
import { sayso } from '../ui/state.js';
import { shownFolders } from './level-objects.js';
import { sortedNotes } from './order.js';

export function drawShelves(screen, host, folder) {
  const plugin = screen.plugin;
  const open = screen.openFile();
  const list = el(host, 'div', 'dr-shelves');
  const one = (f, name) => {
    const notes = sortedNotes(plugin, f);
    shelf(list, {
      name,
      count: notes.length,
      current: f !== folder && !!plugin.openFolder && plugin.openFolder.path === f.path,
      onHead: () => (f === folder ? null : screen.go(f)),
      onNote: (path, e) => screen.openNote(plugin.app.vault.getAbstractFileByPath(path), e),
      notes: notes.map((n) => {
        const words = plugin.index.words(n);
        return { size: barSize(words), label: `${n.basename}, about ${counted(words, 'word')}`, path: n.path, current: n === open, selected: plugin.selection.is(n) };
      }),
    }).dataset.path = f.path;
  };
  const folders = shownFolders(plugin, folder);
  if (plugin.index.notes(folder).length) one(folder, folder.path === '/' ? 'Loose notes' : folder.name);
  folders.forEach((f) => one(f, f.name));
  if (!list.firstChild) return void sayso(host, { label: 'Nothing in this folder yet', button: { text: 'New note', run: () => plugin.files.newNote(folder) } });
  screen.roving(list, '.dr-shelf-head', () => 1);
  Array.from(list.querySelectorAll('.dr-shelf-bars')).forEach((bars) => screen.stops.push(rovingBars(screen, bars)));
}

/** A shelf's bars are one Tab stop; left and right move along them, however they wrap. */
function rovingBars(screen, bars) {
  const onKey = (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const bar = e.target.closest ? e.target.closest('.dr-bar') : null;
    const to = step && bar ? (step > 0 ? bar.nextElementSibling : bar.previousElementSibling) : null;
    if (!to) return;
    e.preventDefault();
    bar.setAttribute('tabindex', '-1');
    to.setAttribute('tabindex', '0');
    to.focus();
  };
  bars.addEventListener('keydown', onKey);
  return () => bars.removeEventListener('keydown', onKey);
}
