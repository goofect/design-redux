/* ------------------------------------------------------------------ */
/* Saved views: a filter kept under a name                             */
/*                                                                     */
/* The same notes seen by subject, by status or by date without moving */
/* any. The list is the old plugin's (settings.smartAlbumList): each   */
/* { id, name, folder, tag, prop, date }.                              */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { Feature } from '../core/feature.js';
import { choose } from '../ui/choose.js';
import { ask } from '../ui/sheet.js';
import { isFiltering } from './filters.js';

const PARTS = ['folder', 'tag', 'prop', 'date', 'loose'];

export class SavedViews extends Feature {
  list() {
    return Array.isArray(this.settings.smartAlbumList) ? this.settings.smartAlbumList : [];
  }

  async open(view) {
    const picked = view || (await choose(this.app, this.list(), { placeholder: 'Open a saved view…', name: (v) => v.name }));
    if (!picked) return;
    const filter = {};
    PARTS.forEach((p) => picked[p] && (filter[p] = picked[p]));
    await this.plugin.showFiltered(filter, picked.name);
  }

  async save() {
    const screen = await this.plugin.libraryPage();
    if (!screen || !isFiltering(screen.filter)) return void new Notice('Set a filter first: there is nothing to keep.');
    const name = await ask(this.app, { title: 'Keep these filters as a saved view', value: screen.filterName || '', action: 'Keep' });
    if (!name) return;
    const list = this.list().filter((v) => v.name !== name);
    list.push(Object.assign({ id: `view-${Date.now().toString(36)}`, name }, screen.filter));
    this.settings.smartAlbumList = list;
    screen.filterName = name;
    await this.plugin.saveSettings();
  }

  actions() {
    return [
      { id: 'smart-album-open', name: 'Open a saved view…', when: () => this.list().length > 0, run: () => this.open() },
      { id: 'smart-album-save', name: 'Keep these filters as a saved view…', run: () => this.save() },
    ];
  }
}
SavedViews.title = 'Filters and saved views';
SavedViews.section = 'Library';
SavedViews.about = 'Notes from anywhere by folder, tag, property or date, kept under a name.';
