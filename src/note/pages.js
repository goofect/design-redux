/* ------------------------------------------------------------------ */
/* Pages: one note, several pages                                      */
/*                                                                     */
/* A note with page markers shows one page at a time, switched by a    */
/* row of tabs in its head. The file stays one ordinary note. Editing, */
/* the other pages are folded away by the editor; reading, their       */
/* blocks are marked and left undrawn. The page left open is           */
/* remembered by the note's path. Nothing is added to a note until it  */
/* is given a second page.                                             */
/* ------------------------------------------------------------------ */

import { Menu, Notice } from 'obsidian';
import { clear } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { segments } from '../ui/segments.js';
import { ask } from '../ui/sheet.js';
import { noteHeads, noteViews, tidyNoteHeads } from './note-head.js';
import { addPage, parsePages, removePage, renamePage } from './page-text.js';
import { hiddenLines, pagesField, showPage } from './pages-editor.js';

export class NotePages extends Feature {
  register() {
    this.registerEditor();
    this.known = new Map(); // by path: the pages last read from the note
    this.drawn = new WeakMap(); // by view: the note, page open and pages it was last drawn with
    this.plugin.registerMarkdownPostProcessor((el, ctx) => this.onRendered(el, ctx));
  }

  enable() {
    const ws = this.app.workspace;
    this.useEditor(pagesField);
    const draw = () => this.drawAll();
    this.listen(ws, ['file-open', 'layout-change', 'design-redux:renamed'], draw);
    // Saved while typing: only that note's views, and drawn again only if its pages are not as they were.
    this.listen(ws, 'design-redux:modified', (file) => noteViews(this.app).filter((view) => view.file === file).forEach((view) => this.draw(view, true)));
    this.add(() => {
      this.drawn = new WeakMap();
      noteViews(this.app).forEach((view) => {
        noteHeads(view).forEach(({ head }) => clear(head.querySelector('.dr-note-pages')));
        tidyNoteHeads(view);
        this.show(view, null);
      });
    });
    this.drawAll();
  }

  async textOf(view) {
    if (view.editor && typeof view.editor.getValue === 'function') return view.editor.getValue();
    return this.app.vault.cachedRead(view.file);
  }

  /** The page of a note that is open: the one remembered, if the note still has it. */
  openOf(file, pages) {
    const kept = (this.settings.pagesOpen || {})[file.path];
    return (pages.find((p) => p.name === kept) || pages[0] || {}).name || null;
  }

  drawAll() {
    return Promise.all(noteViews(this.app).map((view) => this.draw(view)));
  }

  /** Draws a note's pages in a view: its tabs, and the page open. `ifChanged`, only when the pages or the page open are not what the view shows. */
  async draw(view, ifChanged) {
    const file = view.file;
    const pages = parsePages(await this.textOf(view));
    if (view.file !== file) return;
    this.known.set(file.path, pages.map((p) => p.name));
    const open = this.openOf(file, pages);
    const drawn = [file.path, open].concat(pages.map((p) => p.name)).join('\n');
    const shown = this.drawn.get(view) === drawn;
    if (ifChanged && shown && noteHeads(view).every(({ head }) => !pages.length || head.querySelector('.dr-note-pages').firstChild)) return void tidyNoteHeads(view);
    this.drawn.set(view, drawn);
    // Shown first: showing a page draws reading view again, and the tabs are drawn into what it draws.
    this.show(view, pages.length ? open : null);
    noteHeads(view).forEach(({ head }) => {
      const slot = clear(head.querySelector('.dr-note-pages'));
      if (!pages.length) return;
      const tabs = segments(slot, { label: 'Pages', options: pages.map((p) => ({ id: p.name, text: p.name })), value: open, onChange: (name) => this.open(file, name) });
      tabs.addEventListener('contextmenu', (e) => {
        const tab = e.target.closest ? e.target.closest('.dr-segment') : null;
        if (!tab) return;
        e.preventDefault();
        this.pageMenu(file, tab.textContent).showAtMouseEvent(e);
      });
    });
    tidyNoteHeads(view);
  }

  /** Makes one view show one page (null: the whole note). */
  show(view, name) {
    const cm = view.editor && view.editor.cm;
    if (cm && typeof cm.dispatch === 'function') {
      try {
        cm.dispatch({ effects: showPage.of(name) });
      } catch (err) {
        console.error('Design Redux: could not fold the pages', err);
      }
    }
    view.contentEl.dataset.drPage = name || '';
    const preview = view.previewMode;
    if (preview && typeof preview.rerender === 'function') preview.rerender(true);
  }

  /** Opens a page of a note, in every view of it, and remembers it. */
  async open(file, name) {
    (this.settings.pagesOpen || (this.settings.pagesOpen = {}))[file.path] = name;
    await this.plugin.saveData(this.settings);
    await Promise.all(noteViews(this.app).filter((v) => v.file === file).map((v) => this.draw(v)));
    this.app.workspace.trigger('design-redux:page', file, name);
  }

  /** Reading view: a block that belongs to another page is marked, and so left undrawn. */
  onRendered(el, ctx) {
    if (!this.on || !ctx || typeof ctx.getSectionInfo !== 'function') return;
    const info = ctx.getSectionInfo(el);
    const file = this.app.vault.getFileByPath(ctx.sourcePath);
    if (!info || !file) return;
    const pages = parsePages(info.text);
    if (!pages.length) return;
    const hidden = hiddenLines(info.text, this.openOf(file, pages));
    el.classList.toggle('dr-page-hidden', hidden.some(([from, to]) => info.lineStart >= from && info.lineStart < to));
  }

  /** Steps to the page before or after the one open. */
  step(file, by) {
    const names = this.known.get(file.path) || [];
    const at = names.indexOf(this.openOf(file, names.map((name) => ({ name }))));
    const to = names[at + by];
    if (to) this.open(file, to);
    return to || null;
  }

  hasPages(file) {
    return (this.known.get(file.path) || []).length > 0;
  }

  /** Asks for a new page's name and adds it at the note's end, open. */
  async addPageTo(file) {
    const name = await ask(this.app, { title: 'A new page', placeholder: 'Sources', action: 'Add page', check: (v) => (/%%/.test(v) ? 'A page’s name can’t hold %%.' : null) });
    if (!name) return null;
    let made = null;
    await this.app.vault.process(file, (text) => {
      const out = addPage(text, name);
      made = out.name;
      return out.text;
    });
    if (made) await this.open(file, made);
    return made;
  }

  pageMenu(file, name) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Rename page…').setSection('action').onClick(async () => {
      const to = await ask(this.app, { title: 'Rename page', value: name, action: 'Rename' });
      if (!to || to === name) return;
      await this.app.vault.process(file, (text) => renamePage(text, name, to));
      await this.open(file, to);
    }));
    menu.addItem((i) => i.setTitle('Join with the page before').setSection('danger').onClick(async () => {
      await this.app.vault.process(file, (text) => removePage(text, name));
      new Notice(`“${name}” is part of the page before it now.`);
      await this.drawAll();
    }));
    return menu;
  }

  actions() {
    const has = (ctx) => this.hasPages(ctx.file);
    return [
      { id: 'next-page', name: 'Next page of this note', on: 'note', menu: false, when: has, run: (ctx) => this.step(ctx.file, 1) },
      { id: 'previous-page', name: 'Previous page of this note', on: 'note', menu: false, when: has, run: (ctx) => this.step(ctx.file, -1) },
      { id: 'add-page', name: 'Add a page to this note', on: 'note', menu: 'Add a page…', run: (ctx) => this.addPageTo(ctx.file) },
    ];
  }
}
NotePages.key = 'notePages';
NotePages.title = 'Pages in a note';
NotePages.section = 'Notes';
NotePages.about = 'One note, several pages, one open at a time.';
