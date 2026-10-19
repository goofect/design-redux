/* ------------------------------------------------------------------ */
/* Study                                                               */
/*                                                                     */
/* You choose which collections are studied. A note read in one goes   */
/* on the revisit ladder (core 081) and comes back when it's due: on    */
/* Home's To revisit shelf, as a chip in the strip, and as a quiet row  */
/* of grades under its title. Off, nothing shows and nothing is kept.   */
/* ------------------------------------------------------------------ */

import { Modal, Notice, setIcon, Setting, TFile, TFolder } from 'obsidian';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { highlightsIn, passageHash } from '../core/047-helpers-text.js';
import { readingOf } from '../core/075-reading.js';
import { libraryIndex } from '../core/077-library-index.js';
import { actionsOn, addActionItems } from '../core/078-actions.js';
import { addTextCard, cardBox, liveCards, requestCanvasSave } from '../core/079-canvas-adapter.js';
import { Feature } from '../core/080-feature.js';
import { DAY, dueNotes, nextDue, sessionSummary, startOfDay, studiedAlbum, studyLadder, studyOf } from '../core/081-study.js';
import { BrowseScreen, copyText } from './110-browse-screens.js';
import { BROWSE_SCREENS } from './119-browse-registry.js';
import { Library } from './130-browse-filters.js';

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
        key: 'studyHighlights',
        showIf: 'studyEnabled',
        name: 'Highlighted passages',
        desc: 'Passages you mark ==like this== gathered on a screen of their own, and asked back as a quiz from the collections you study.',
      },
      {
        key: 'studyCardMax',
        type: 'number',
        showIf: 'studyEnabled',
        name: 'Quiz passages a day',
        desc: 'At most this many passages are asked in a day.',
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
      { id: 'study-start-session', name: 'Start a study session in this collection', icon: 'book-open-check', on: 'album', menu: 'Study session', when: (ctx) => on() && !this.store.session, run: (ctx) => this.startSession(ctx.folder) },
      { id: 'study-session-next', name: 'Next note in this study session', icon: 'skip-forward', menu: false, when: () => on() && !!this.store.session, run: () => this.openSessionNext() },
      { id: 'study-mark-revisit', name: 'Mark to revisit after this session', icon: 'bookmark-plus', on: 'note', menu: false, when: (ctx) => on() && this.inSession(ctx.file) && !this.isMarked(ctx.file), run: (ctx) => this.markForRevisit(ctx.file) },
      { id: 'study-end-session', name: 'End the study session', icon: 'square', menu: false, when: () => on() && !!this.store.session, run: () => this.endSession() },
      { id: 'study-highlights', name: 'Show highlighted passages', icon: 'highlighter', menu: false, when: () => this.highlightsOn, run: () => this.showHighlights(null) },
      { id: 'study-album-highlights', name: 'Show the highlighted passages in this collection', icon: 'highlighter', on: 'album', menu: 'Highlighted passages', when: () => this.highlightsOn, run: (ctx) => this.showHighlights(ctx.folder) },
      { id: 'study-quiz', name: 'Quiz me on highlighted passages', icon: 'help-circle', menu: false, when: () => this.highlightsOn && on(), run: () => this.quiz() },
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
        if (target instanceof TFolder && this.enabled) addActionItems(menu, actionsOn(this.actions(), 'album'), { folder: target, from: 'menu' }, 'Study', 'graduation-cap');
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

  get highlightsOn() {
    return this.enabled && this.settings.studyHighlights !== false;
  }

  /**
   * The passages marked in these notes: [{ file, text, line, before,
   * after }]. Each note read once as it is now and remembered by its
   * modified time; a few at a time, never the vault at once.
   */
  async highlightsOf(files) {
    if (!this.marks) this.marks = new Map();
    const vault = this.app.vault;
    const todo = files.filter((f) => {
      const kept = this.marks.get(f.path);
      return !kept || kept.mtime !== f.stat.mtime;
    });
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const f = todo[next++];
        let text = '';
        try {
          text = await vault.cachedRead(f);
        } catch (err) {
          text = '';
        }
        this.marks.set(f.path, { mtime: f.stat.mtime, list: highlightsIn(text) });
      }
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    const out = [];
    files.forEach((file) => (this.marks.get(file.path) || { list: [] }).list.forEach((h) => out.push(Object.assign({ file }, h))));
    return out;
  }

  showHighlights(folder) {
    const library = this.plugin.feature(Library);
    if (library) library.browseMode({ mode: 'highlights', property: folder ? folder.path : null });
  }

  /** A passage as a card on the canvas open now, beside what's there. */
  addToCanvas(h) {
    const leaf = this.app.workspace.getLeavesOfType('canvas').find((l) => !l.isDeferred && l.view && l.view.canvas);
    const canvas = leaf ? leaf.view.canvas : null;
    if (!canvas) return false;
    let right = 0;
    let top = null;
    liveCards(canvas).forEach((card) => {
      const box = cardBox(card);
      right = Math.max(right, box.maxX);
      top = top === null ? box.minY : Math.min(top, box.minY);
    });
    const card = addTextCard(canvas, { x: right + 60, y: top || 0, width: 320, height: 140 }, `> ${h.text}\n\n— [[${h.file.basename}]]`);
    if (!card) return false;
    requestCanvasSave(canvas);
    new Notice(`Added to ${leaf.view.file ? leaf.view.file.basename : 'the canvas'}.`);
    return true;
  }

  /** The passages to ask today: those due, then new ones, within the day's cap. */
  async quizCards(now = Date.now()) {
    await this.store.load();
    const albums = Object.keys(this.settings.studyAlbums || {})
      .map((p) => this.app.vault.getAbstractFileByPath(p))
      .filter((f) => f instanceof TFolder);
    const files = [];
    albums.forEach((folder) => this.notesIn(folder).forEach((f) => files.indexOf(f) === -1 && files.push(f)));
    const cards = this.store.data.cards;
    const all = (await this.highlightsOf(files)).map((h) => Object.assign(h, { key: `${h.file.path}#${passageHash(h.text)}` }));
    const today = startOfDay(now);
    const asked = Object.keys(cards).filter((k) => cards[k].last >= today && cards[k].grade).length;
    const room = Math.max(0, (Number(this.settings.studyCardMax) || 10) - asked);
    const due = all.filter((h) => cards[h.key] && cards[h.key].due <= now).sort((a, b) => cards[a.key].due - cards[b.key].due);
    const fresh = all.filter((h) => !cards[h.key]);
    return due.concat(fresh).slice(0, room);
  }

  /** A passage answered: on the same ladder as notes. A new one known already starts on the first rung. */
  gradeCard(key, grade, now = Date.now()) {
    const cards = this.store.data.cards;
    let card = cards[key] || null;
    if (!card) {
      card = nextDue(null, 'read', this.ladder, now);
      card = grade === 'got' ? Object.assign(card, { grade: 'got', last: now }) : nextDue(card, grade, this.ladder, now);
    } else {
      card = nextDue(card, grade, this.ladder, now);
    }
    cards[key] = card;
    this.store.save();
    return card;
  }

  async quiz() {
    const cards = await this.quizCards();
    if (!cards.length) {
      new Notice('Nothing to ask today: no highlighted passages due in the collections you study.');
      return;
    }
    new StudyQuiz(this, cards).open();
  }

  /** A collection's notes, however deep, in its own order, each folder's after the notes beside it. */
  notesIn(folder) {
    const out = [];
    const walk = (f) => {
      const files = (f.children || []).filter((c) => c instanceof TFile && c.extension === 'md' && !this.plugin.isFolderNote(c));
      const sort = (list) => list.slice().sort((a, b) => a.basename.localeCompare(b.basename));
      const ordered = this.plugin.orders && typeof this.plugin.orders.arrangeAlbum === 'function' ? this.plugin.orders.arrangeAlbum(f, files, sort) : sort(files);
      out.push(...ordered);
      (f.children || [])
        .filter((c) => c instanceof TFolder)
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(walk);
    };
    walk(folder);
    return out;
  }

  /** What a session goes through: the notes not read yet, then those due again. */
  sessionList(folder) {
    const reading = readingOf(this.plugin);
    const now = Date.now();
    const notes = this.notesIn(folder);
    const unread = notes.filter((f) => reading.state(f) !== 'read');
    const due = notes.filter((f) => reading.state(f) === 'read' && this.store.item(f) && this.store.item(f).due <= now);
    return unread.concat(due).map((f) => f.path);
  }

  async startSession(folder, list) {
    await this.store.load();
    const paths = list || this.sessionList(folder);
    if (!paths.length) {
      new Notice(`Nothing to study in ${folder.name}: every note is read, and none is due.`);
      return null;
    }
    // Study mode first, so the session's first note opens into it.
    await this.runAction('workspace-mode-study');
    this.store.session = { album: folder.path, startedAt: Date.now(), list: paths, marked: [] };
    this.openPath(paths[0]);
    this.changed();
    return this.store.session;
  }

  /** Another feature's action, by its id, without reaching into it. */
  async runAction(id) {
    for (const f of this.plugin.features || []) {
      const action = f.actions().find((a) => a.id === id);
      if (action && (!action.when || action.when({}))) return action.run({});
    }
    return null;
  }

  openPath(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) this.app.workspace.getLeaf(false).openFile(file);
  }

  inSession(file) {
    const s = this.store.session;
    return !!s && !!file && s.list.indexOf(file.path) !== -1;
  }

  isMarked(file) {
    const s = this.store.session;
    return !!s && !!file && s.marked.indexOf(file.path) !== -1;
  }

  markForRevisit(file) {
    if (!this.inSession(file) || this.isMarked(file)) return;
    this.store.session.marked.push(file.path);
    new Notice(`${file.basename}: marked to revisit.`);
    this.changed();
  }

  /** The next note in the session after the open one that isn't read yet; at the end, the session's end. */
  openSessionNext() {
    const s = this.store.session;
    if (!s) return;
    const reading = readingOf(this.plugin);
    const readAt = (p) => (reading.log[p] && reading.log[p].read) || 0;
    const active = this.app.workspace.getActiveFile();
    const at = active ? s.list.indexOf(active.path) : -1;
    const after = s.list.slice(at + 1).concat(s.list.slice(0, at + 1));
    const next = after.find((p) => readAt(p) < s.startedAt && (!active || p !== active.path));
    if (next) this.openPath(next);
    else this.endSession();
  }

  /** The session ended: kept, and summed up. */
  endSession() {
    const s = this.store.session;
    if (!s) return null;
    const reading = readingOf(this.plugin);
    const now = Date.now();
    const summary = sessionSummary(s, (p) => (reading.log[p] && reading.log[p].read) || 0, now);
    this.store.addSession({ album: s.album, startedAt: s.startedAt, endedAt: now, read: summary.read, revisit: summary.marked, minutes: summary.minutes });
    this.store.session = null;
    this.changed();
    const folder = this.app.vault.getAbstractFileByPath(s.album);
    if (typeof Modal === 'function') new StudySummary(this, folder instanceof TFolder ? folder : null, s, summary).open();
    return summary;
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

/** At a session's end: how it went, the marked notes to add, and another go at what's left. */
export class StudySummary extends Modal {
  constructor(study, folder, session, summary) {
    super(study.app);
    this.study = study;
    this.folder = folder;
    this.session = session;
    this.summary = summary;
  }

  onOpen() {
    const { contentEl, summary } = this;
    contentEl.empty();
    contentEl.addClass('dr-study-summary');
    if (this.titleEl) this.titleEl.setText(this.folder ? `Studied ${this.folder.name}` : 'Study session');
    const parts = [`${summary.read} of ${summary.total} read`];
    if (summary.marked) parts.push(`${summary.marked} marked to revisit`);
    parts.push(`${summary.minutes} min`);
    contentEl.createDiv({ cls: 'dr-study-summary-line', text: parts.join(' · ') });
    const buttons = new Setting(contentEl);
    if (summary.marked) {
      buttons.addButton((b) =>
        b
          .setButtonText(summary.marked === 1 ? 'Add it to the revisits' : `Add ${summary.marked} to the revisits`)
          .setCta()
          .onClick(async () => {
            await this.addMarked();
            b.setDisabled(true).setButtonText('Added');
          })
      );
    }
    if (summary.left.length && this.folder) {
      buttons.addButton((b) =>
        b.setButtonText(`Study the ${summary.left.length} left`).onClick(() => {
          this.close();
          this.study.startSession(this.folder, summary.left);
        })
      );
    }
    buttons.addButton((b) => b.setButtonText('Done').onClick(() => this.close()));
  }

  async addMarked() {
    const store = this.study.store;
    await store.load();
    this.session.marked.forEach((p) => {
      const file = this.app.vault.getAbstractFileByPath(p);
      if (file instanceof TFile && !store.item(file)) store.grade(file, 'read', this.study.ladder);
    });
    this.study.changed();
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** A passage asked back: its line with the marked words hidden; shown, then Got it or Again. */
export class StudyQuiz extends Modal {
  constructor(study, cards) {
    super(study.app);
    this.study = study;
    this.cards = cards;
    this.at = 0;
    this.right = 0;
  }

  onOpen() {
    this.contentEl.addClass('dr-study-quiz');
    if (this.titleEl) this.titleEl.setText('Quiz');
    this.draw();
  }

  draw(shown) {
    const { contentEl } = this;
    contentEl.empty();
    const card = this.cards[this.at];
    if (!card) {
      contentEl.createDiv({ cls: 'dr-study-quiz-done', text: `Done: ${this.right} of ${this.cards.length} known.` });
      new Setting(contentEl).addButton((b) => b.setButtonText('Close').setCta().onClick(() => this.close()));
      return;
    }
    contentEl.createDiv({ cls: 'dr-study-quiz-count', text: `${this.at + 1} of ${this.cards.length} · ${card.file.basename}` });
    const line = contentEl.createDiv({ cls: 'dr-study-quiz-line' });
    if (card.before) line.createSpan({ text: `${card.before} ` });
    const hidden = line.createSpan({ cls: shown ? 'dr-study-quiz-answer' : 'dr-study-quiz-blank', text: shown ? card.text : card.text.replace(/\S/g, '_') });
    hidden.setAttribute('aria-label', shown ? card.text : 'Hidden');
    if (card.after) line.createSpan({ text: ` ${card.after}` });
    const buttons = new Setting(contentEl);
    if (!shown) {
      buttons.addButton((b) => b.setButtonText('Show').setCta().onClick(() => this.draw(true)));
      return;
    }
    const answer = (grade) => {
      this.study.gradeCard(card.key, grade);
      if (grade === 'got') this.right++;
      this.at++;
      this.draw();
    };
    buttons.addButton((b) => b.setButtonText('Got it').setCta().onClick(() => answer('got')));
    buttons.addButton((b) => b.setButtonText('Again').onClick(() => answer('again')));
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Highlighted passages, vault-wide or in a collection: each with its note, a click from its line. */
export class HighlightsScreen extends BrowseScreen {
  title() {
    const folder = this.folder();
    return folder ? `Highlighted in ${folder.name}` : 'Highlighted passages';
  }

  folder() {
    const p = this.view.property;
    const f = p ? this.app.vault.getAbstractFileByPath(p) : null;
    return f instanceof TFolder ? f : null;
  }

  render(root) {
    const view = this.view;
    const study = this.plugin.feature(Study);
    view.renderTitleBar(root, this.title());
    if (!study || !study.highlightsOn) {
      root.createDiv({ cls: 'dr-empty', text: 'Highlighted passages are gathered once Study is on in settings.' });
      return;
    }
    const folder = this.folder();
    const files = folder ? study.notesIn(folder) : libraryIndex(this.plugin).notes();
    const box = root.createDiv({ cls: 'dr-highlights' });
    const wait = box.createDiv({ cls: 'dr-empty', text: 'Gathering highlighted passages…' });
    study.highlightsOf(files).then((found) => {
      // Drawn again since: this drawing's done with.
      if (!box.isConnected) return;
      wait.remove();
      if (!found.length) {
        box.createDiv({ cls: 'dr-empty', text: 'No highlighted passages yet. Mark one ==like this== in a note.' });
        return;
      }
      let current = null;
      let list = null;
      found.forEach((h) => {
        if (h.file !== current) {
          current = h.file;
          const head = box.createDiv({ cls: 'dr-highlights-note', text: h.file.basename });
          asButton(head);
          onActivate(head, () => this.app.workspace.getLeaf(false).openFile(h.file));
          list = box.createDiv({ cls: 'dr-highlights-list' });
        }
        const row = list.createDiv({ cls: 'dr-highlight' });
        asButton(row);
        row.createDiv({ cls: 'dr-highlight-text', text: h.text });
        onActivate(row, (evt) => {
          if (evt.target && evt.target.closest && evt.target.closest('.dr-highlight-actions')) return;
          this.app.workspace.getLeaf(false).openFile(h.file, { eState: { line: h.line } });
        });
        const actions = row.createDiv({ cls: 'dr-highlight-actions' });
        const act = (icon, label, run) => {
          const b = actions.createDiv({ cls: 'clickable-icon' });
          asButton(b, label);
          setIcon(b, icon);
          onActivate(b, (evt) => {
            evt.stopPropagation();
            run();
          });
        };
        act('quote', 'Copy as a quote', () => copyText(`> ${h.text}\n> — [[${h.file.basename}]]`));
        if (this.app.workspace.getLeavesOfType('canvas').length) act('sticky-note', 'Add to the open canvas', () => study.addToCanvas(h));
      });
    });
  }
}

BROWSE_SCREENS.highlights = HighlightsScreen;
