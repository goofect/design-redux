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
import { iconId } from '../core/icons.js';
import { iconButton } from '../ui/button.js';
import { segments } from '../ui/segments.js';
import { ask } from '../ui/sheet.js';
import { noteHead, noteViews, tidyNoteHead } from './note-head.js';
import { addPage, parsePages, removePage, renamePage } from './page-text.js';
import { hiddenLines, pagesField, showPage } from './pages-editor.js';

export class NotePages extends Feature {
  register() {
    this.extensions = [];
    this.known = new Map(); // by path: the pages last read from the note
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => this.onRendered(el, ctx));
  }

  enable() {
    const ws = this.app.workspace;
    this.extensions.push(pagesField);
    if (typeof ws.updateOptions === 'function') ws.updateOptions();
    const draw = () => this.drawAll();
    ['file-open', 'layout-change', 'design-redux:modified', 'design-redux:renamed'].forEach((name) => this.listen(ws, name, draw));
    this.plugin.partsOf = (file) => this.parts(file);
    this.add(() => {
      delete this.plugin.partsOf;
      this.extensions.length = 0;
      if (typeof ws.updateOptions === 'function') ws.updateOptions();
      noteViews(this.app).forEach((view) => {
        clear(noteHead(view).querySelector('.dr-note-pages'));
        tidyNoteHead(view);
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

  async draw(view) {
    const file = view.file;
    const pages = parsePages(await this.textOf(view));
    if (view.file !== file) return;
    this.known.set(file.path, pages.map((p) => p.name));
    const head = noteHead(view);
    const slot = clear(head.querySelector('.dr-note-pages'));
    const open = this.openOf(file, pages);
    if (pages.length) {
      const tabs = segments(slot, { tabs: true, label: 'Pages', options: pages.map((p) => ({ id: p.name, text: p.name })), value: open, onChange: (name) => this.open(file, name) });
      tabs.addEventListener('contextmenu', (e) => {
        const tab = e.target.closest ? e.target.closest('.dr-segment') : null;
        if (!tab) return;
        e.preventDefault();
        this.pageMenu(file, tab.textContent).showAtMouseEvent(e);
      });
      iconButton(slot, { glyph: 'plus', label: 'Add a page', run: () => this.add_(file) });
    }
    tidyNoteHead(view);
    this.show(view, pages.length ? open : null);
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

  async add_(file) {
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
    menu.addItem((i) => i.setTitle('Rename page…').setIcon(iconId('pencil')).setSection('action').onClick(async () => {
      const to = await ask(this.app, { title: 'Rename page', value: name, action: 'Rename' });
      if (!to || to === name) return;
      await this.app.vault.process(file, (text) => renamePage(text, name, to));
      await this.open(file, to);
    }));
    menu.addItem((i) => i.setTitle('Join with the page before').setIcon(iconId('merge')).setSection('danger').onClick(async () => {
      await this.app.vault.process(file, (text) => removePage(text, name));
      new Notice(`“${name}” is part of the page before it now.`);
      await this.drawAll();
    }));
    return menu;
  }

  /** For the library's outline: a note's pages, in place of its headings. */
  parts(file) {
    const names = this.known.get(file.path) || [];
    if (!names.length) return null;
    const open = this.openOf(file, names.map((name) => ({ name })));
    return names.map((name) => ({ name, current: name === open, run: () => this.open(file, name) }));
  }

  actions() {
    const has = (ctx) => this.hasPages(ctx.file);
    return [
      { id: 'next-page', name: 'Next page of this note', glyph: 'next', on: 'note', menu: false, when: has, run: (ctx) => this.step(ctx.file, 1) },
      { id: 'previous-page', name: 'Previous page of this note', glyph: 'previous', on: 'note', menu: false, when: has, run: (ctx) => this.step(ctx.file, -1) },
      { id: 'add-page', name: 'Add a page to this note', glyph: 'plus', on: 'note', menu: 'Add a page…', run: (ctx) => this.add_(ctx.file) },
    ];
  }
}
NotePages.key = 'notePages';
NotePages.title = 'Pages in a note';
NotePages.glyph = 'pages';
NotePages.section = 'Notes';
NotePages.about = 'One note, several pages, one open at a time.';
