/* ------------------------------------------------------------------ */
/* Study                                                               */
/*                                                                     */
/* You choose which collections are studied. A note read in one goes   */
/* on the revisit ladder (core 081) and comes back when it's due: on    */
/* Home's To revisit shelf, as a chip in the strip, and as a quiet row  */
/* of grades under its title. Off, nothing shows and nothing is kept.   */
/* ------------------------------------------------------------------ */

import { Notice, Setting, TFile, TFolder } from 'obsidian';
import { actionsOn, addActionEntries } from '../core/078-actions.js';
import { Feature } from '../core/080-feature.js';
import { DAY, dueNotes, studiedAlbum, studyLadder, studyOf } from '../core/081-study.js';

/* What a grade is called, on its button and in the palette. */
export const STUDY_GRADES = [
  { id: 'got', label: 'Got it', icon: 'check' },
  { id: 'again', label: 'Again', icon: 'rotate-ccw' },
  { id: 'later', label: 'Later', icon: 'clock' },
];

/** When an item's next due, in words: "tomorrow", "in 3 days". */
export function dueIn(due, now) {
  const days = Math.max(0, Math.round((due - now) / DAY));
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export class Study extends Feature {
  settingsSchema() {
    return [
      {
        key: 'studyEnabled',
        name: 'Study',
        desc: 'Notes you want to remember come back when you’re about to forget them. Choose the collections to study from their menus; a note read in one comes back on the ladder below. Kept in the plugin’s own file, never in your notes.',
      },
      {
        key: 'studyLadder',
        type: 'text',
        showIf: 'studyEnabled',
        name: 'Days between revisits',
        desc: 'After reading, a note is due after the first; each Got it moves it to the next. Again starts it over.',
        placeholder: '1, 3, 7, 21, 60',
      },
      {
        key: 'studyDailyMax',
        type: 'number',
        showIf: 'studyEnabled',
        name: 'Revisits a day',
        desc: 'At most this many come back in a day, so a long backlog doesn’t arrive at once.',
      },
      {
        key: 'studyAlbums',
        type: 'custom',
        showIf: 'studyEnabled',
        name: 'Studied collections',
        render: (containerEl) => this.renderAlbums(containerEl),
      },
    ];
  }

  get ladder() {
    return studyLadder(this.settings.studyLadder);
  }

  get store() {
    return studyOf(this.plugin);
  }

  actions() {
    const on = () => this.enabled && this.store.loaded;
    const item = (ctx) => (ctx.file ? this.store.item(ctx.file) : null);
    const grade = (g) => ({
      id: `study-grade-${g.id === 'got' ? 'got-it' : g.id}`,
      name: `Revisit: ${g.label}`,
      icon: g.icon,
      on: 'note',
      menu: false,
      when: (ctx) => on() && !!item(ctx),
      run: (ctx) => this.gradeNote(ctx.file, g.id),
    });
    return [
      { id: 'study-album', name: 'Study this collection', icon: 'graduation-cap', on: 'album', menu: 'Study this collection', when: (ctx) => this.enabled && !this.isStudied(ctx.folder), run: (ctx) => this.setStudied(ctx.folder, true) },
      { id: 'study-album-stop', name: 'Stop studying this collection', icon: 'graduation-cap', on: 'album', menu: 'Stop studying', when: (ctx) => this.enabled && this.isStudied(ctx.folder), run: (ctx) => this.setStudied(ctx.folder, false) },
      { id: 'study-add-every-note', name: 'Add every note in this collection to the revisits', icon: 'list-plus', on: 'album', menu: 'Add every note to the revisits', when: (ctx) => on() && this.isStudied(ctx.folder), run: (ctx) => this.addEvery(ctx.folder) },
      { id: 'study-add-note', name: 'Add this note to the revisits', icon: 'calendar-plus', on: 'note', menu: false, when: (ctx) => on() && ctx.file.extension === 'md' && !item(ctx), run: (ctx) => this.addNote(ctx.file) },
      ...STUDY_GRADES.map(grade),
      { id: 'study-open-next-due', name: 'Open the next note to revisit', icon: 'graduation-cap', menu: false, when: () => on() && dueNotes(this.plugin).length > 0, run: () => this.openNextDue() },
    ];
  }

  register() {
    const ws = this.app.workspace;
    // A note read in a studied collection goes on the ladder.
    this.plugin.registerEvent(ws.on('design-redux:read', (file) => this.onRead(file)));
    // Renamed and deleted notes keep, or lose, their schedule — even with study off, once there is one.
    this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.follow((s) => s.followRename(file, oldPath))));
    this.plugin.registerEvent(this.app.vault.on('delete', (file) => this.follow((s) => s.followDelete(file))));
    this.plugin.registerEvent(
      ws.on('file-menu', (menu, target) => {
        if (target instanceof TFolder && this.enabled) addActionEntries(menu, actionsOn(this.actions(), 'album'), { folder: target, from: 'menu' }, 'action');
      })
    );
    this.plugin.register(() => this.store.flush());
  }

  enable() {
    if (this.store.loaded) return;
    this.store.load().then(() => this.changed());
  }

  disable() {
    if (this.plugin.study) this.plugin.study.flush();
    this.changed();
  }

  /** Something about what's due changed: what shows it, drawn again. */
  changed() {
    this.app.workspace.trigger('design-redux:study-changed');
    if (typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
  }

  async follow(change) {
    const store = this.store;
    if (!store.loaded && !(await store.exists())) return;
    await store.load();
    change(store);
  }

  isStudied(folder) {
    return !!folder && !!(this.settings.studyAlbums || {})[folder.path];
  }

  async setStudied(folder, on) {
    const albums = Object.assign({}, this.settings.studyAlbums || {});
    if (on) albums[folder.path] = { added: Date.now() };
    else delete albums[folder.path];
    this.settings.studyAlbums = albums;
    await this.plugin.saveSettings();
    new Notice(on ? `Studying ${folder.name}: notes you read there will come back to be revisited.` : `${folder.name} is no longer studied. What’s scheduled stays.`);
    this.changed();
  }

  onRead(file) {
    if (!this.enabled || !(file instanceof TFile) || !studiedAlbum(this.plugin, file)) return;
    const store = this.store;
    store.load().then(() => {
      if (store.item(file)) return;
      store.grade(file, 'read', this.ladder);
      this.changed();
    });
  }

  async addNote(file) {
    await this.store.load();
    const item = this.store.grade(file, 'read', this.ladder);
    new Notice(`${file.basename} will come back ${dueIn(item.due, Date.now())}.`);
    this.changed();
    return item;
  }

  /** Every note in a collection, however deep, put on the ladder — those not on it already. */
  async addEvery(folder) {
    await this.store.load();
    let n = 0;
    const walk = (f) =>
      (f.children || []).forEach((c) => {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md' && !this.plugin.isFolderNote(c) && !this.store.item(c)) {
          this.store.grade(c, 'read', this.ladder);
          n++;
        }
      });
    walk(folder);
    new Notice(n === 1 ? '1 note added to the revisits.' : `${n} notes added to the revisits.`);
    this.changed();
  }

  gradeNote(file, grade) {
    const item = this.store.grade(file, grade, this.ladder);
    new Notice(`${file.basename}: back ${dueIn(item.due, Date.now())}.`);
    this.changed();
    return item;
  }

  openNextDue() {
    const next = dueNotes(this.plugin)[0];
    if (next) this.app.workspace.getLeaf(false).openFile(next);
  }

  /** The studied collections, each with a way to stop. */
  renderAlbums(containerEl) {
    const block = containerEl.appendChild(containerEl.ownerDocument.createElement('div'));
    block.className = 'dr-study-albums';
    const draw = () => {
      block.empty();
      const albums = Object.keys(this.settings.studyAlbums || {}).sort();
      const setting = new Setting(block).setName('Studied collections');
      if (!albums.length) {
        setting.setDesc('None yet: choose Study this collection from a collection’s menu.');
        return;
      }
      setting.setDesc('Notes read in these come back to be revisited.');
      albums.forEach((path) => {
        new Setting(block)
          .setName(path)
          .setClass('dr-setting-sub')
          .addExtraButton((b) =>
            b
              .setIcon('x')
              .setTooltip('Stop studying')
              .onClick(async () => {
                const next = Object.assign({}, this.settings.studyAlbums);
                delete next[path];
                this.settings.studyAlbums = next;
                await this.plugin.saveSettings();
                this.changed();
                draw();
              })
          );
      });
    };
    draw();
  }
}

Study.settingKey = 'studyEnabled';
