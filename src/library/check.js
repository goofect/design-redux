/* ------------------------------------------------------------------ */
/* Looking the library over                                            */
/*                                                                     */
/* What a growing library loses track of, in a report to go through:   */
/* folders with nothing in them, folders of one name, notes in no      */
/* folder, notes whose parents lead round in a circle, links that lead */
/* nowhere, covers that point nowhere. Things to look at, not rules:   */
/* the report changes nothing. And an inbox: the notes in no folder.   */
/* ------------------------------------------------------------------ */

import { Feature } from '../core/feature.js';
import { linkTarget, valuesOf } from '../core/notes.js';
import { row, rows, sectionTitle } from '../ui/row.js';
import { Sheet } from '../ui/sheet.js';
import { sayso } from '../ui/state.js';

export class LibraryCheck extends Feature {
  /** The findings: [{ title, items: [{ name, end, folder | file }] }], only those with something in them. */
  findings() {
    const { index, notes, files, settings } = this.plugin;
    const app = this.app;
    const out = [];
    const add = (title, items) => items.length && out.push({ title, items });
    const folders = index.folders();
    add('Folders with nothing in them', folders.filter((f) => !f.children.some((c) => !c.name.startsWith('.'))).map((f) => ({ name: f.path, folder: f })));
    const byName = new Map();
    folders.forEach((f) => byName.set(f.name.toLowerCase(), (byName.get(f.name.toLowerCase()) || []).concat(f)));
    add('Folders of one name', Array.from(byName.values()).filter((l) => l.length > 1).flat().map((f) => ({ name: f.path, folder: f })));
    add('Notes in no folder', index.notes(null).map((f) => ({ name: f.basename, file: f })));
    // A note's parent, by the property the vault nests by.
    const key = String(settings.graphRouteProperty || '').trim() || 'parent';
    const parentOf = (file) => {
      const first = valuesOf(notes.get(file, key))[0];
      return first ? app.metadataCache.getFirstLinkpathDest(linkTarget(first) || first, file.path) : null;
    };
    const circular = index.markdown().filter((file) => {
      const seen = new Set([file]);
      for (let at = parentOf(file); at; at = parentOf(at)) {
        if (at === file) return true;
        if (seen.has(at)) return false;
        seen.add(at);
      }
      return false;
    });
    add('Notes whose parents lead round in a circle', circular.map((f) => ({ name: f.basename, end: key, file: f })));
    const unresolved = app.metadataCache.unresolvedLinks || {};
    add('Links that lead nowhere', Object.keys(unresolved).filter((p) => Object.keys(unresolved[p]).length).map((p) => ({ name: p.split('/').pop().replace(/\.md$/, ''), end: Object.keys(unresolved[p]).slice(0, 2).join(', '), file: app.vault.getFileByPath(p) })).filter((i) => i.file && !files.isFolderNote(i.file) || i.file));
    return out;
  }

  report() {
    const found = this.findings();
    const library = this.plugin.features.find((f) => typeof f.browse === 'function');
    const sheet = new Sheet(this.app, {
      title: 'The library, looked over',
      build: (matter, s) => {
        if (!found.length) return void sayso(matter, { label: 'Nothing to look at', text: 'No empty folder, no loose note, no link that leads nowhere.' });
        found.forEach((group) => {
          sectionTitle(matter, { title: group.title });
          const list = rows(matter);
          group.items.slice(0, 50).forEach((item) => row(list, { name: item.name, end: item.end, run: () => {
            s.close();
            if (item.file) this.app.workspace.getLeaf(false).openFile(item.file);
            else if (item.folder && library) library.browse(item.folder);
          } }));
          if (group.items.length > 50) row(list, { name: 'and more', disabled: true });
        });
      },
      actions: [{ text: 'Close' }],
    });
    sheet.open();
    return sheet;
  }

  /** The notes in no folder, in the browse view, to be put in one a few at a time. */
  async inbox() {
    const views = this.plugin.features.find((f) => typeof f.screen === 'function' && typeof f.list === 'function');
    const library = this.plugin.features.find((f) => typeof f.browse === 'function');
    const screen = views ? await views.screen() : library ? (await library.browse(null)).view.screen : null;
    if (screen) screen.setFilter({ loose: true }, 'Inbox');
  }

  actions() {
    return [
      { id: 'library-check', name: 'Look the library over', run: () => this.report() },
      { id: 'library-inbox', name: 'Open the inbox: notes in no folder', when: () => this.settings.libraryInbox !== false, run: () => this.inbox() },
    ];
  }
}
LibraryCheck.title = 'Library check';
LibraryCheck.section = 'Library';
LibraryCheck.about = 'A report of what a growing library loses track of, and an inbox of loose notes.';
