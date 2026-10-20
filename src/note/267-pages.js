/* ------------------------------------------------------------------ */
/* Pages: one note, several pages                                      */
/*                                                                     */
/* A note can hold several separate pages, one open at a time, switched */
/* with a small segmented control under its title. The file stays one   */
/* ordinary markdown note: a page starts at a marker line, a comment    */
/* (%%page: Sources%%), and a page's icon and colour sit in the note's  */
/* `pages` property. Showing one page hides the rest — in editing view  */
/* by a decoration over their text, in reading view by a class on the   */
/* rendered blocks. Nothing is added to a note until it has a second    */
/* page. Pages are added, renamed, moved and removed from the control.  */
/* ------------------------------------------------------------------ */

import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { Menu, Notice, setIcon, TFile } from 'obsidian';
import { showMenuAt } from '../core/030-helpers-art.js';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { scriptLivePreview } from '../core/050-helpers-dom.js';
import { Feature } from '../core/080-feature.js';
import { bodyStart, hiddenRanges, nameFromText, newPageName, openPage, parsePages, uniqueName, withPageAdded, withPageMoved, withPageRemoved, withPageRenamed } from '../core/090-pages.js';
import { confirmAction, NamePrompt } from '../ui/230-pickers.js';

/** The icons a page can wear, from Obsidian's own set: a handful that read as kinds of page. */
export const PAGE_ICONS = ['file-text', 'table', 'network', 'check-square', 'image', 'list', 'book-open', 'quote', 'link', 'star', 'lightbulb', 'calendar'];

/** The colours a page can take: the theme's accents. */
export const PAGE_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];

/** Tells an editor which page is open. */
export const setOpenPage = StateEffect.define();

/** Which page an editor shows, and the other pages' text out of sight (in Live Preview). */
export function pagesExtension() {
  const build = (state, open) => {
    if (!scriptLivePreview(state)) return Decoration.none;
    const text = state.doc.toString();
    const ranges = hiddenRanges(text, open, state.selection.ranges.map((r) => r.head));
    if (!ranges.length) return Decoration.none;
    return Decoration.set(ranges.map(([from, to]) => Decoration.replace({ block: true }).range(from, to)), true);
  };
  const field = StateField.define({
    create: (state) => ({ open: null, deco: build(state, null) }),
    update(value, tr) {
      let open = value.open;
      tr.effects.forEach((e) => e.is(setOpenPage) && (open = e.value));
      if (!tr.docChanged && !tr.selection && open === value.open && scriptLivePreview(tr.startState) === scriptLivePreview(tr.state)) return value;
      return { open, deco: build(tr.state, open) };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
  return [field];
}

export class NotePages extends Feature {
  constructor(plugin) {
    super(plugin);
    /** Which page each view is showing, and where each page was left: scroll and cursor. */
    this.shown = new WeakMap();
    this.places_ = new Map();
  }

  settingsSchema() {
    return [
      {
        key: 'notePages',
        name: 'Pages',
        desc: 'A note with %%page: Name%% lines in it is several pages, one open at a time, switched by a small control under its title. A note with one page looks as it does now.',
      },
    ];
  }

  actions() {
    return [
      { id: 'next-page', name: 'Next page of this note', icon: 'chevron-right', on: 'note', menu: false, when: (ctx) => this.enabled && this.hasPages(ctx.file), run: (ctx) => this.step(ctx.file, 1) },
      { id: 'previous-page', name: 'Previous page of this note', icon: 'chevron-left', on: 'note', menu: false, when: (ctx) => this.enabled && this.hasPages(ctx.file), run: (ctx) => this.step(ctx.file, -1) },
      { id: 'add-page', name: 'Add a page to this note', icon: 'plus', on: 'note', when: (ctx) => this.enabled && !!ctx.file, run: (ctx) => this.add(ctx.file) },
    ];
  }

  registerTypes() {
    this.extensions = [];
    this.plugin.registerEditorExtension(this.extensions);
    this.plugin.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.enabled) return;
      const info = typeof ctx.getSectionInfo === 'function' ? ctx.getSectionInfo(el) : null;
      if (info) {
        el.dataset.drLine = String(info.lineStart);
        this.queue();
      }
    });
  }

  register() {
    const queue = () => this.queue();
    const ws = this.app.workspace;
    ['layout-change', 'active-leaf-change', 'file-open'].forEach((type) => this.plugin.registerEvent(ws.on(type, queue)));
    this.plugin.registerEvent(this.app.metadataCache.on('changed', queue));
    this.plugin.registerEvent(this.app.vault.on('modify', (file) => file instanceof TFile && queue()));
  }

  enable() {
    if (this.extensions && !this.extensions.length) {
      this.extensions.push(pagesExtension());
      this.app.workspace.updateOptions();
    }
    this.queue();
  }

  disable() {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.extensions && this.extensions.length) {
      this.extensions.length = 0;
      this.app.workspace.updateOptions();
    }
    this.views().forEach((view) => this.clear(view));
  }

  queue() {
    if (this.frame || typeof window === 'undefined') return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      if (this.enabled) this.sync();
    });
  }

  sync() {
    this.views().forEach((view) => this.draw(view));
  }

  views() {
    return this.app.workspace
      .getLeavesOfType('markdown')
      .map((leaf) => (leaf.isDeferred ? null : leaf.view))
      .filter((view) => view && view.containerEl && view.file instanceof TFile);
  }

  clear(view) {
    view.containerEl.querySelectorAll('.dr-pages').forEach((el) => el.remove());
    view.containerEl.querySelectorAll('.dr-page-off').forEach((el) => el.removeClass('dr-page-off'));
    view.containerEl.removeClass('dr-has-pages');
  }

  /** The note's text as the view holds it, else as Obsidian has it cached. */
  textOf(view) {
    if (view.editor && typeof view.editor.getValue === 'function') return view.editor.getValue();
    return typeof view.data === 'string' ? view.data : '';
  }

  hasPages(file) {
    const view = this.views().find((v) => v.file === file);
    return !!view && parsePages(this.textOf(view)).length > 1;
  }

  /** The name of the page open in a note: the last one chosen, else the first. */
  openName(file, pages) {
    const open = (this.settings.pagesOpen || {})[file.path];
    const page = openPage(pages, open);
    return page ? page.name : null;
  }

  /** A page's icon and colour, from the note's `pages` property. */
  look(file, name) {
    const meta = (this.plugin.notes.get(file, 'pages') || {})[name];
    return { icon: (meta && meta.icon) || '', color: (meta && meta.color) || '' };
  }

  /** The sizers a note's view lays its text in, with where the control goes in each. */
  places(view) {
    const out = [];
    const own = (sizer) => !sizer.parentElement || !sizer.parentElement.closest('.cm-sizer, .markdown-preview-sizer, .embedded-backlinks');
    view.containerEl.querySelectorAll('.markdown-source-view .cm-sizer').forEach((sizer) => own(sizer) && out.push({ head: sizer, before: sizer.querySelector(':scope > .cm-contentContainer') }));
    view.containerEl.querySelectorAll('.markdown-preview-view .markdown-preview-sizer').forEach((sizer) => {
      if (!own(sizer)) return;
      const head = sizer.querySelector(':scope > .mod-header') || sizer;
      out.push({ head, before: null });
    });
    return out;
  }

  draw(view) {
    const file = view.file;
    const text = this.textOf(view);
    const pages = parsePages(text);
    const many = pages.length > 1 || (pages.length === 1 && false);
    if (!many) {
      this.clear(view);
      return;
    }
    const open = this.openName(file, pages);
    view.containerEl.addClass('dr-has-pages');
    // The editor shows the page that's open.
    const cm = view.editor && view.editor.cm;
    if (cm && typeof cm.dispatch === 'function' && cm.state && cm.state.field) {
      try {
        const field = this.extensions[0] && this.extensions[0][0];
        const now = field ? cm.state.field(field, false) : null;
        if (now && now.open !== open) cm.dispatch({ effects: setOpenPage.of(open) });
      } catch (err) {
        /* an editor that isn't ours yet */
      }
    }
    // Reading view hides the blocks of other pages.
    const spans = pages.map((p, i) => ({ name: p.name, first: p.preface ? p.preface[0] : p.marker[0], last: i + 1 < pages.length ? pages[i + 1].marker[0] : text.length }));
    const startLines = (at) => text.slice(0, at).split('\n').length - 1;
    const bounds = spans.map((s) => ({ name: s.name, from: startLines(s.first), to: startLines(s.last) }));
    view.containerEl.querySelectorAll('.markdown-preview-sizer [data-dr-line]').forEach((el) => {
      const line = parseInt(el.dataset.drLine, 10);
      const page = bounds.find((b) => line >= b.from && line < b.to);
      el.toggleClass('dr-page-off', !!page && page.name !== open);
    });
    // What the control is made of, apart from which page is open: that only slides the pill.
    const struct = `${file.path}|${pages.map((p) => `${p.name}:${this.look(file, p.name).icon}:${this.look(file, p.name).color}`).join(',')}`;
    this.places(view).forEach((place) => {
      let bar = place.head.querySelector(':scope > .dr-pages');
      if (bar && bar.dataset.struct === struct) {
        if (bar.dataset.open !== open) this.select(bar, open, true);
        return;
      }
      if (bar) bar.remove();
      bar = place.head.ownerDocument.createElement('div');
      bar.className = 'dr-pages';
      bar.dataset.struct = struct;
      if (place.before && place.before.parentElement === place.head) place.head.insertBefore(bar, place.before);
      else place.head.appendChild(bar);
      this.drawBar(bar, file, pages, open);
    });
    // A page just chosen: the one before is put away with its scroll and cursor, this one's put back.
    if (this.shown.get(view) !== open) {
      const before = this.shown.get(view);
      if (before !== undefined) this.keepPlace(view, before);
      this.shown.set(view, open);
      if (before !== undefined) {
        view.containerEl.addClass('dr-page-fade');
        window.setTimeout(() => view.containerEl.removeClass('dr-page-fade'), 160);
        window.setTimeout(() => this.restorePlace(view, open), 60);
      }
    }
  }

  /** The scrolling element the note shows in: reading view's, or the editor's. */
  scroller(view) {
    return Array.from(view.containerEl.querySelectorAll('.markdown-preview-view, .cm-scroller')).find((el) => el.clientHeight > 0) || null;
  }

  /** Where a page was left: how far down, and the cursor. */
  keepPlace(view, name) {
    const scroller = this.scroller(view);
    const cm = view.editor && view.editor.cm;
    const head = cm && cm.state ? cm.state.selection.main.head : null;
    this.places_.set(`${view.file.path}|${name}`, { top: scroller ? scroller.scrollTop : 0, head });
  }

  restorePlace(view, name) {
    const place = this.places_.get(`${view.file.path}|${name}`);
    const scroller = this.scroller(view);
    if (scroller) scroller.scrollTop = place ? place.top : 0;
    const cm = view.editor && view.editor.cm;
    if (place && place.head !== null && cm && cm.state && place.head <= cm.state.doc.length) {
      try {
        cm.dispatch({ selection: { anchor: place.head } });
      } catch (err) {
        /* an editor that moved on */
      }
    }
  }

  /** The pill slides to the open page; the labels change colour. */
  select(bar, open, slide) {
    bar.dataset.open = open;
    let target = null;
    bar.querySelectorAll('.dr-page-tab').forEach((tab) => {
      const on = tab.dataset.page === open;
      tab.toggleClass('is-open', on);
      tab.setAttribute('aria-selected', String(on));
      tab.setAttribute('tabindex', on ? '0' : '-1');
      if (on) target = tab;
    });
    const pill = bar.querySelector('.dr-pages-pill');
    if (!pill || !target) return;
    // Not laid out yet (a tab not shown): the open page wears the thumb itself until it is.
    const capsule = pill.parentElement;
    if (!target.offsetWidth) {
      capsule.removeClass('has-pill');
      pill.toggleClass('is-set', false);
      return;
    }
    capsule.addClass('has-pill');
    pill.toggleClass('is-set', true);
    pill.toggleClass('is-sliding', !!slide);
    pill.style.setProperty('--dr-pill-x', `${target.offsetLeft}px`);
    pill.style.setProperty('--dr-pill-w', `${target.offsetWidth}px`);
    if (target.scrollIntoView) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  drawBar(bar, file, pages, open) {
    bar.setAttribute('role', 'tablist');
    const capsule = bar.createDiv({ cls: 'dr-pages-capsule' });
    capsule.createDiv({ cls: 'dr-pages-pill' });
    pages.forEach((p) => {
      const look = this.look(file, p.name);
      const tab = capsule.createDiv({ cls: 'dr-page-tab' });
      tab.dataset.page = p.name;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-label', p.name);
      if (look.color) tab.dataset.drColor = look.color;
      asButton(tab, p.name);
      // No icon until one is chosen: a control full of identical icons is clutter.
      if (look.icon) {
        tab.addClass('has-icon');
        setIcon(tab.createSpan({ cls: 'dr-page-icon' }), look.icon);
      }
      // The label, and beneath it the same words in the selected weight, unseen: they hold the
      // segment at its widest, so nothing shifts as the selection moves.
      const label = tab.createSpan({ cls: 'dr-page-name', text: p.name });
      label.dataset.label = p.name;
      onActivate(tab, () => this.open(file, p.name));
      tab.addEventListener('dblclick', () => this.renameInline(file, p.name, tab.querySelector('.dr-page-name')));
      if (this.fresh === `${file.path}:${p.name}`) {
        this.fresh = null;
        window.setTimeout(() => this.renameInline(file, p.name, tab.querySelector('.dr-page-name')), 50);
      }
      tab.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        this.menu(evt, file, p.name, pages);
      });
    });
    // Arrow keys move between pages, as in any segmented control.
    capsule.addEventListener('keydown', (evt) => {
      const keys = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity };
      if (!(evt.key in keys)) return;
      evt.preventDefault();
      const at = pages.findIndex((p) => p.name === bar.dataset.open);
      const by = keys[evt.key];
      const next = by === -Infinity ? 0 : by === Infinity ? pages.length - 1 : Math.max(0, Math.min(pages.length - 1, at + by));
      if (next === at) return;
      this.open(file, pages[next].name);
      const tab = capsule.querySelectorAll('.dr-page-tab')[next];
      if (tab) tab.focus();
    });
    // Adding sits beside the control, not in it: a small round button of its own.
    const add = bar.createDiv({ cls: 'dr-page-add' });
    asButton(add, 'Add a page');
    setIcon(add, 'plus');
    onActivate(add, () => this.add(file));
    // Laid out first, so the pill has somewhere to start from; measured again when its size
    // changes — shown at last, or its pages' words in a font that arrived late.
    window.requestAnimationFrame(() => this.select(bar, open, false));
    if (typeof ResizeObserver === 'function') {
      const watch = new ResizeObserver(() => {
        if (!capsule.isConnected) return watch.disconnect();
        this.select(bar, bar.dataset.open, false);
      });
      watch.observe(capsule);
    }
  }

  /** A page opened, and remembered for the note. */
  async open(file, name) {
    if (!this.settings.pagesOpen) this.settings.pagesOpen = {};
    this.settings.pagesOpen[file.path] = name;
    await this.plugin.saveSettings();
    this.queue();
  }

  /** The page a step away, wrapping at the ends. */
  step(file, by) {
    const view = this.views().find((v) => v.file === file);
    if (!view) return;
    const pages = parsePages(this.textOf(view));
    if (pages.length < 2) return;
    const at = pages.findIndex((p) => p.name === this.openName(file, pages));
    this.open(file, pages[(at + by + pages.length) % pages.length].name);
  }

  /** The note's text changed by `change(text)`, with a step of Undo to put it back. */
  async rewrite(file, change, message) {
    let before = null;
    let after = null;
    await this.app.vault.process(file, (text) => {
      before = text;
      after = change(text);
      return after;
    });
    if (before !== after && typeof this.plugin.offerUndo === 'function') {
      this.plugin.offerUndo(message, async () => {
        await this.app.vault.process(file, (text) => (text === after ? before : text));
        this.queue();
      });
    }
    this.queue();
  }

  /** A page's name edited where it stands: Enter keeps it, Escape leaves it as it was. */
  renameInline(file, name, el) {
    if (!el || el.isContentEditable) return;
    el.setAttribute('contenteditable', 'plaintext-only');
    el.addClass('is-editing');
    el.focus();
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const sel = el.ownerDocument.defaultView.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      el.removeAttribute('contenteditable');
      el.removeClass('is-editing');
      const next = el.textContent.trim();
      if (keep && next && next !== name) this.renameTo(file, name, next);
      else el.setText(name);
    };
    el.addEventListener('keydown', (evt) => {
      evt.stopPropagation();
      if (evt.key === 'Enter') {
        evt.preventDefault();
        finish(true);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        finish(false);
      }
    });
    el.addEventListener('blur', () => finish(true));
  }

  async add(file) {
    const view = this.views().find((v) => v.file === file);
    const text0 = view ? this.textOf(view) : await this.app.vault.read(file);
    const pages = parsePages(text0);
    const body = text0.slice(bodyStart(text0));
    const name = pages.length ? newPageName(pages) : uniqueName('Untitled', [nameFromText(body)]);
    await this.rewrite(file, (text) => withPageAdded(text, name), 'Page added.');
    // The new page opens with its name ready to type over, so naming it is the next keystroke.
    this.fresh = `${file.path}:${name}`;
    await this.open(file, name);
  }

  rename(file, name) {
    new NamePrompt(this.app, 'Rename the page', name, (to) => this.renameTo(file, name, String(to || '').trim()), { value: name }).open();
  }

  async renameTo(file, name, next) {
    if (!next || next === name) return;
    const pages = parsePages(await this.app.vault.read(file));
    if (pages.some((p) => p.name === next)) {
      new Notice('A page of that name is there already.');
      this.queue();
      return;
    }
    await this.rewrite(file, (text) => withPageRenamed(text, name, next), 'Page renamed.');
    // Its look, and its place as the page last open, go with the name.
    await this.plugin.notes.write(file, (fm) => {
      if (fm.pages && fm.pages[name]) {
        fm.pages[next] = fm.pages[name];
        delete fm.pages[name];
      }
    });
    if ((this.settings.pagesOpen || {})[file.path] === name) await this.open(file, next);
  }

  setLook(file, name, change) {
    return this.plugin.notes.write(file, (fm) => {
      const pages = fm.pages && typeof fm.pages === 'object' ? fm.pages : {};
      const mine = Object.assign({}, pages[name]);
      change(mine);
      if (!mine.icon && !mine.color) delete pages[name];
      else pages[name] = mine;
      if (Object.keys(pages).length) fm.pages = pages;
      else delete fm.pages;
    }, { undo: 'Page changed.', onUndo: () => this.queue() }).then(() => this.queue());
  }

  async remove(file, name) {
    const yes = await confirmAction(this.app, { title: 'Remove the page', text: `Take the page “${name}” out of this note, with what is on it?`, button: 'Remove it' });
    if (!yes) return;
    await this.rewrite(file, (text) => withPageRemoved(text, name), 'Page removed.');
    await this.plugin.notes.write(file, (fm) => {
      if (fm.pages) {
        delete fm.pages[name];
        if (!Object.keys(fm.pages).length) delete fm.pages;
      }
    });
  }

  menu(evt, file, name, pages) {
    const menu = new Menu();
    const item = (title, icon, run, disabled) =>
      menu.addItem((i) => {
        i.setTitle(title).setIcon(icon).onClick(run);
        if (disabled && typeof i.setDisabled === 'function') i.setDisabled(true);
        if (typeof i.setSection === 'function') i.setSection('action');
      });
    item('Rename', 'pencil', () => this.rename(file, name));
    const sub = (title, icon, build) =>
      menu.addItem((i) => {
        i.setTitle(title).setIcon(icon);
        if (typeof i.setSection === 'function') i.setSection('action');
        const inner = typeof i.setSubmenu === 'function' ? i.setSubmenu() : null;
        if (inner) build(inner);
      });
    sub('Icon', 'smile', (m) => PAGE_ICONS.forEach((icon) => m.addItem((i) => i.setTitle(icon).setIcon(icon).onClick(() => this.setLook(file, name, (mine) => (mine.icon = icon))))));
    sub('Colour', 'palette', (m) => PAGE_COLORS.forEach((color) => m.addItem((i) => i.setTitle(color).onClick(() => this.setLook(file, name, (mine) => (mine.color = color))))));
    const at = pages.findIndex((p) => p.name === name);
    item('Move left', 'arrow-left', () => this.rewrite(file, (t) => withPageMoved(t, name, -1), 'Page moved.'), at === 0);
    item('Move right', 'arrow-right', () => this.rewrite(file, (t) => withPageMoved(t, name, 1), 'Page moved.'), at === pages.length - 1);
    item('Remove', 'trash', () => this.remove(file, name));
    showMenuAt(menu, evt);
  }
}


NotePages.settingKey = 'notePages';
