/* ------------------------------------------------------------------ */
/* Saved views: a filter kept under a name                             */
/*                                                                     */
/* The same notes seen by subject, by status or by date without moving */
/* any. The list is the old plugin's (settings.smartAlbumList): each   */
/* { id, name, folder, tag, prop, date }.                              */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { Feature } from '../core/feature.js';
import { choose, chooseFolder } from '../ui/choose.js';
import { field } from '../ui/field.js';
import { Sheet, ask } from '../ui/sheet.js';
import { isFiltering } from './filters.js';

const PARTS = ['folder', 'tag', 'prop', 'date', 'loose'];

export class SavedViews extends Feature {
  list() {
    return Array.isArray(this.settings.smartAlbumList) ? this.settings.smartAlbumList : [];
  }

  /** The screen filters are set on: the browse view, opened if it isn't. */
  async screen() {
    const library = this.plugin.features.find((f) => typeof f.browse === 'function');
    if (!library) return null;
    const active = library.activeScreen();
    if (active && active.opts.wide) return active;
    return (await library.browse(null)).view.screen;
  }

  async open(view) {
    const picked = view || (await choose(this.app, this.list(), { placeholder: 'Open a saved view…', name: (v) => v.name }));
    const screen = picked ? await this.screen() : null;
    if (!screen) return;
    const filter = {};
    PARTS.forEach((p) => picked[p] && (filter[p] = picked[p]));
    screen.setFilter(filter, picked.name);
  }

  async save() {
    const screen = await this.screen();
    if (!screen || !isFiltering(screen.filter)) return void new Notice('Set a filter first: there is nothing to keep.');
    const name = await ask(this.app, { title: 'Keep these filters as a saved view', value: screen.filterName || '', action: 'Keep' });
    if (!name) return;
    const list = this.list().filter((v) => v.name !== name);
    list.push(Object.assign({ id: `view-${Date.now().toString(36)}`, name }, screen.filter));
    this.settings.smartAlbumList = list;
    screen.filterName = name;
    await this.plugin.saveSettings();
  }

  /** The sheet that sets a screen's filter. */
  edit(screen) {
    const draft = Object.assign({}, screen.filter || {});
    new Sheet(this.app, {
      title: 'Filter',
      build: (matter) => {
        const folder = field(matter, { label: 'In the folder', value: draft.folder || '', placeholder: 'Anywhere', onInput: (v) => (draft.folder = v.trim().replace(/\/$/, '')) });
        folder.drInput.addEventListener('dblclick', async () => { const f = await chooseFolder(this.plugin, { placeholder: 'In the folder…' }); if (f) folder.drInput.value = draft.folder = f.path === '/' ? '' : f.path; });
        field(matter, { label: 'With the tag', value: draft.tag || '', placeholder: 'Any', onInput: (v) => (draft.tag = v.trim()) });
        field(matter, { label: 'Property', value: draft.prop || '', placeholder: 'status=draft, status, or !status', note: 'A name alone: notes that have it. With ! before: notes that lack it.', onInput: (v) => (draft.prop = v.trim()) });
        field(matter, { label: 'Edited this', value: draft.date || '', placeholder: 'week, month or year', onInput: (v) => (draft.date = ['week', 'month', 'year'].includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : '') });
      },
      actions: [{ text: 'Clear', run: () => void screen.setFilter(null) }, { text: 'Cancel' }, { text: 'Show', kind: 'primary', run: () => void screen.setFilter(isFiltering(draft) ? draft : null) }],
    }).open();
  }

  enable() {
    this.plugin.editFilter = (screen) => this.edit(screen);
    this.add(() => delete this.plugin.editFilter);
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
