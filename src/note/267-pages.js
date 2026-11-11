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

import { EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { Menu, Notice, setIcon, TFile } from 'obsidian';
import { showMenuAt } from '../core/036-menus.js';
import { asButton, onActivate } from '../core/042-controls.js';
import { scriptLivePreview } from '../core/050-helpers-dom.js';
import { Feature } from '../core/080-feature.js';
import { confirmAction, NamePrompt } from '../ui/230-pickers.js';
import { bodyStart, cleanPageName, hiddenOf, nameFromText, newPageName, onMarker, openPage, pageAt, pageLayout, pageOfLine, pageStats, parsePages, uniqueName, withPageAdded, withPageMoved, withPageRemoved, withPageRenamed } from './266-page-text.js';

/** The icons a page can wear, from Obsidian's own set: a handful that read as kinds of page. */
export const PAGE_ICONS = ['file-text', 'table', 'network', 'check-square', 'image', 'list', 'book-open', 'quote', 'link', 'star', 'lightbulb', 'calendar'];

/** The colours a page can take: the theme's accents. */
export const PAGE_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];

/** Tells an editor which page is open. */
export const setOpenPage = StateEffect.define();

/** A line the pages hang on: a marker, a code fence (a marker in one doesn't count), the properties' edge. */
const structural = (text) => text.includes('%%page') || /^ {0,3}(`{3,}|~{3,})/.test(text) || text.startsWith('---');

/** Does a change touch, before or after, a line the pages hang on? Only then is the note read again. */
function touchesPages(tr) {
  let hit = false;
  const lines = (doc, from, to) => {
    for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last && !hit; n++) hit = structural(doc.line(n).text);
  };
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!hit) lines(tr.startState.doc, fromA, toA);
    if (!hit) lines(tr.state.doc, fromB, toB);
  });
  return hit;
}

/** A selection made by hand — a click, a drag, the arrow keys, select all — rather than by undo, search or a link. */
const byHand = (tr) => {
  const event = tr.annotation(Transaction.userEvent);
  return event === 'select' || event === 'select.pointer';
};

/**
 * Which page an editor shows, and the other pages' text out of sight (in Live Preview). One rule
 * keeps what's edited in sight: the cursor's page is the page shown. A cursor moved by hand stays
 * on the page (select all takes just the page); one put elsewhere — by undo, search, a link, a
 * jump — opens the page it's on, and `onFollow(view, name)` hears of it. The note is read again
 * only when a change touches a marker or a fence; otherwise what's known is moved along.
 */
export function pagesExtension(onFollow) {
  const scan = (state) => {
    const text = state.doc.toString();
    return { pages: parsePages(text), start: bodyStart(text) };
  };
  const marksOf = (pages, sel) => pages.map((p, i) => (sel.ranges.some((r) => onMarker(p, r.head)) ? i : '')).join(',');
  const decorate = (state, pages, open) => {
    const ranges = hiddenOf(pages, open, state.selection.ranges.map((r) => r.head), state.doc.length);
    return ranges.length ? Decoration.set(ranges.map(([from, to]) => Decoration.replace({ block: true }).range(from, to)), true) : Decoration.none;
  };
  const field = StateField.define({
    create(state) {
      const { pages, start } = scan(state);
      const live = scriptLivePreview(state);
      return { open: null, pages, start, live, marks: marksOf(pages, state.selection), deco: live ? decorate(state, pages, null) : Decoration.none, followed: false };
    },
    update(value, tr) {
      let open = value.open;
      let chosen = false;
      tr.effects.forEach((e) => e.is(setOpenPage) && ((open = e.value), (chosen = true)));
      const live = scriptLivePreview(tr.state);
      let { pages, start } = value;
      let read = false;
      if (tr.docChanged) {
        if (touchesPages(tr)) {
          ({ pages, start } = scan(tr.state));
          read = true;
        } else if (pages.length) {
          const map = (pos) => tr.changes.mapPos(pos);
          const doc = tr.state.doc;
          const lineOf = (pos) => doc.lineAt(pos).number - 1;
          start = tr.changes.mapPos(start, -1);
          pages = pageLayout(
            pages.map((p) => {
              const at = map(p.marker[0]);
              return { name: p.name, marker: [at, map(p.marker[1])], line: lineOf(at) };
            }),
            start,
            doc.length,
            lineOf(start),
          );
        }
      }
      // A plain note: nothing more to do.
      if (!pages.length && !value.pages.length && open === value.open && live === value.live) return value;
      // The cursor put on another page, not by hand: that page opens.
      let followed = false;
      // A range across pages doesn't: it's kept to the page shown.
      if (live && pages.length && tr.selection && !chosen && !byHand(tr)) {
        const at = pageAt(pages, tr.state.selection.main.head);
        if (at !== -1 && at === pageAt(pages, tr.state.selection.main.anchor) && pages[at] !== openPage(pages, open)) {
          open = pages[at].name;
          followed = true;
        }
      }
      const marks = pages.length ? marksOf(pages, tr.state.selection) : '';
      let deco = value.deco;
      if (!live || !pages.length) deco = Decoration.none;
      else if (read || open !== value.open || live !== value.live || marks !== value.marks) deco = decorate(tr.state, pages, open);
      else if (tr.docChanged) deco = deco.map(tr.changes);
      else if (pages === value.pages) return value;
      return { open, pages, start, live, marks, deco, followed };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
  // The selection kept to the page shown, before it's made: a page chosen takes the cursor to it;
  // a range across pages (select all, a vim motion) keeps to this one; one wholly on another
  // page goes, but the main cursor, kept to this page.
  const keep = EditorState.transactionFilter.of((tr) => {
    const chose = tr.effects.find((e) => e.is(setOpenPage));
    if ((!chose && !tr.selection) || !scriptLivePreview(tr.startState)) return tr;
    const before = tr.startState.field(field, false);
    if (!before || !before.pages.length) return tr;
    if (chose && !tr.docChanged) {
      const page = openPage(before.pages, chose.value);
      const sel = tr.selection || tr.startState.selection;
      if (pageAt(before.pages, sel.main.head) !== before.pages.indexOf(page)) return [tr, { selection: { anchor: page.from }, sequential: true }];
    }
    const value = tr.state.field(field, false);
    if (!value || !value.pages.length) return tr;
    const pages = value.pages;
    const page = openPage(pages, value.open);
    const shown = pages.indexOf(page);
    const on = (pos) => [shown, -1].includes(pageAt(pages, pos));
    const clamp = (pos) => Math.max(page.from, Math.min(page.to, pos));
    const sel = tr.state.selection;
    const ranges = [];
    let main = 0;
    let changed = false;
    sel.ranges.forEach((r, i) => {
      const across = pageAt(pages, r.anchor) !== pageAt(pages, r.head);
      const mine = i === sel.mainIndex;
      if (mine) main = ranges.length;
      if (!across && on(r.head)) ranges.push(r);
      else {
        changed = true;
        if (across || mine) ranges.push(EditorSelection.range(clamp(r.anchor), clamp(r.head)));
      }
    });
    return changed ? [tr, { selection: EditorSelection.create(ranges, main), sequential: true }] : tr;
  });
  const follow = EditorView.updateListener.of((update) => {
    const now = update.state.field(field, false);
    if (now && now.followed && now !== update.startState.field(field, false) && typeof onFollow === 'function') onFollow(update.view, now.open);
  });
  return [field, keep, follow];
}

/** A sizer the note's own text is laid in, not one of an embed's inside it. */
const ownSizer = (sizer) => !sizer.parentElement || !sizer.parentElement.closest('.cm-sizer, .markdown-preview-sizer, .embedded-backlinks');

/** A block of the note's own, in reading view: straight in its own sizer, not in an embed or a hover preview. */
const topBlock = (el) => {
  const sizer = el.parentElement;
  return !!sizer && sizer.matches('.markdown-preview-sizer') && ownSizer(sizer) && !sizer.closest('.hover-popover');
};

export class NotePages extends Feature {
  constructor(plugin) {
    super(plugin);
    /** Which page each view is showing (of which note), and where each page was left in each view: scroll and cursor. */
    this.shown = new WeakMap();
    this.places_ = new WeakMap();
    /** What each view was last drawn from, so a draw with nothing new does nothing. */
    this.drawn = new WeakMap();
    /** Each note's pages, with the lines they run over, as last drawn: reading view's blocks are hidden by them as they come. */
    this.lines_ = new Map();
    /** The notes to draw at the next frame; all of them when `pendingAll`. */
    this.pending = new Set();
    this.pendingAll = false;
    /** Notes with blocks that came before they were laid anywhere: their views are drawn whole once more. */
    this.recheck = new Set();
  }

  settingsSchema() {
    return [
      {
        key: 'notePages',
        name: 'Pages',
        desc: 'Split a note into pages with %%page: Name%% lines.',
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
      if (!info) return;
      el.dataset.drLine = String(info.lineStart);
      // Hidden or not straight away, by the note's pages as last drawn — only a block of the note's
      // own reading view: an embed, a hover, a canvas card or an export shows the note whole.
      // The pages not known, or the note changed since: nothing hidden till it's drawn again.
      const path = ctx.sourcePath;
      const known = this.lines_.get(path);
      const fresh = !!known && (!known.file.stat || known.file.stat.mtime === known.mtime);
      const home = this.homeOf(el, ctx, path);
      if (fresh && home === true) this.hideBlock(el, known.pages, this.openName(known.file, known.pages));
      else if (fresh && home === null) {
        // Not laid anywhere yet: the view's own draw sorts it once it is.
        this.recheck.add(path);
        this.queue(path);
      }
      if (!fresh) this.queue(path);
    });
  }

  register() {
    const queue = () => this.queue();
    const ws = this.app.workspace;
    ['layout-change', 'active-leaf-change', 'file-open'].forEach((type) => this.plugin.registerEvent(ws.on(type, queue)));
    // A note changed: only the views showing it.
    this.plugin.registerEvent(this.app.metadataCache.on('changed', (file) => this.queue(file && file.path)));
    this.plugin.registerEvent(this.app.vault.on('modify', (file) => file instanceof TFile && this.queue(file.path)));
    // What's kept of a note's pages goes with it.
    this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.lines_.delete(oldPath)));
    this.plugin.registerEvent(this.app.vault.on('delete', (file) => file && this.lines_.delete(file.path)));
  }

  /**
   * Is a block reading view's of its own note, where its pages hide it? True: straight in the own
   * sizer of a view of the note. False: anywhere else — an embed, a hover, a canvas card, an export.
   * Null: not laid anywhere yet, and nothing says where it will be.
   */
  homeOf(el, ctx, path) {
    const where = ctx && ctx.containerEl && typeof ctx.containerEl.closest === 'function' ? ctx.containerEl : null;
    if (!el.parentElement && !where) return null;
    let sizer = el.parentElement;
    if (!sizer) sizer = where.matches('.markdown-preview-sizer') ? where : where.querySelector(':scope > .markdown-preview-sizer') || where.closest('.markdown-preview-sizer');
    if (!sizer || !sizer.matches('.markdown-preview-sizer') || !ownSizer(sizer) || sizer.closest('.hover-popover, .markdown-embed')) return false;
    return this.views().some((view) => view.file.path === path && view.containerEl.contains(sizer));
  }

  enable() {
    if (this.extensions && !this.extensions.length) {
      this.extensions.push(pagesExtension((cm, name) => this.follow(cm, name)));
      this.app.workspace.updateOptions();
    }
    this.queue();
  }

  disable() {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.pending.clear();
    this.pendingAll = false;
    this.lines_.clear();
    this.recheck.clear();
    if (this.extensions && this.extensions.length) {
      this.extensions.length = 0;
      this.app.workspace.updateOptions();
    }
    this.views().forEach((view) => this.clear(view));
  }

  /** A draw at the next frame: of the views showing the note at `path`, else of every view. */
  queue(path) {
    if (typeof window === 'undefined') return;
    if (typeof path === 'string') this.pending.add(path);
    else this.pendingAll = true;
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      const paths = this.pendingAll ? null : new Set(this.pending);
      this.pending.clear();
      this.pendingAll = false;
      if (this.enabled) this.sync(paths);
      if (paths) paths.forEach((p) => this.recheck.delete(p));
      else this.recheck.clear();
    });
  }

  sync(paths) {
    this.views().forEach((view) => (!paths || paths.has(view.file.path)) && this.draw(view));
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
    this.drawn.delete(view);
  }

  /** The note's text as the view holds it, else as Obsidian has it cached. */
  textOf(view) {
    if (view.editor && typeof view.editor.getValue === 'function') return view.editor.getValue();
    return typeof view.data === 'string' ? view.data : '';
  }

  /** The editor's own record of the pages, kept as you type: none if it isn't ours (yet). */
  editorPages(view) {
    const cm = view.editor && view.editor.cm;
    const field = this.extensions && this.extensions[0] && this.extensions[0][0];
    if (!field || !cm || !cm.state || typeof cm.state.field !== 'function') return null;
    try {
      const now = cm.state.field(field, false);
      return now ? { pages: now.pages, sig: cm.state.doc } : null;
    } catch (err) {
      return null;
    }
  }

  /** A view's pages, and what they were read from: the editor's record, else its text — read again only when it's changed since the view was drawn. */
  pagesOf(view) {
    const kept = this.editorPages(view);
    if (kept) return kept;
    const text = this.textOf(view);
    const last = this.drawn.get(view);
    if (last && last.sig === text) return { pages: last.pages || [], sig: text };
    return { pages: parsePages(text), sig: text };
  }

  hasPages(file) {
    const view = this.views().find((v) => v.file === file);
    return !!view && this.pagesOf(view).pages.length > 1;
  }

  /** The page a view shows of the note it has now: none for a note new to it. */
  shownIn(view) {
    const s = this.shown.get(view);
    return s && s.path === view.file.path ? s.name : undefined;
  }

  setShown(view, name) {
    this.shown.set(view, { path: view.file.path, name });
  }

  /** A block of reading view hidden when it's on a page other than the open one. */
  hideBlock(el, pages, open) {
    const at = pageOfLine(pages, parseInt(el.dataset.drLine, 10));
    el.toggleClass('dr-page-off', at !== -1 && pages[at].name !== open);
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
    view.containerEl.querySelectorAll('.markdown-source-view .cm-sizer').forEach((sizer) => ownSizer(sizer) && out.push({ head: sizer, before: sizer.querySelector(':scope > .cm-contentContainer') }));
    view.containerEl.querySelectorAll('.markdown-preview-view .markdown-preview-sizer').forEach((sizer) => {
      if (!ownSizer(sizer)) return;
      const head = sizer.querySelector(':scope > .mod-header') || sizer;
      out.push({ head, before: null });
    });
    return out;
  }

  draw(view) {
    const file = view.file;
    const last = this.drawn.get(view);
    const { pages, sig } = this.pagesOf(view);
    const mtime = file.stat ? file.stat.mtime : 0;
    if (pages.length < 2) {
      this.lines_.set(file.path, { file, mtime, pages: [] });
      if (last && last.plain && last.sig === sig && last.path === file.path) return;
      this.clear(view);
      this.drawn.set(view, { plain: true, sig, pages, path: file.path });
      return;
    }
    const open = this.openName(file, pages);
    // What the control is made of, apart from which page is open: that only slides the pill.
    const struct = `${file.path}|${pages
      .map((p) => {
        const look = this.look(file, p.name);
        return `${p.name}:${look.icon}:${look.color}`;
      })
      .join(',')}`;
    // Nothing new since the view was last drawn — its text, the page open, the pages' looks, the
    // control in place, no block waiting to be sorted: nothing to do.
    const places = this.places(view);
    const same = last && !last.plain && last.sig === sig && last.path === file.path && last.open === open && last.mtime === mtime && last.struct === struct;
    if (same && !this.recheck.has(file.path) && places.every((p) => p.head.querySelector(':scope > .dr-pages'))) return;
    pageStats.draws++;
    this.drawn.set(view, { sig, pages, path: file.path, open, mtime, struct });
    this.lines_.set(file.path, { file, mtime, pages });
    view.containerEl.addClass('dr-has-pages');
    // A page just chosen: the one before is put away with its scroll and cursor, this one's put back —
    // kept before the editor is told, which takes the cursor to the page chosen. A note new to the
    // view starts fresh: nothing of the note before is kept for it, nor put back.
    if (this.shownIn(view) !== open) {
      const before = this.shownIn(view);
      if (before !== undefined) this.keepPlace(view, before);
      this.setShown(view, open);
      if (before !== undefined) {
        view.containerEl.addClass('dr-page-fade');
        window.setTimeout(() => view.containerEl.removeClass('dr-page-fade'), 160);
        window.setTimeout(() => this.restorePlace(view, open), 60);
      }
    }
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
    // Reading view hides the blocks of other pages: the note's own, not an embed's, whose lines are its own note's.
    view.containerEl.querySelectorAll('.markdown-preview-view .markdown-preview-sizer').forEach((sizer) => {
      if (ownSizer(sizer)) sizer.querySelectorAll(':scope > [data-dr-line]').forEach((el) => this.hideBlock(el, pages, open));
    });
    view.containerEl.querySelectorAll('.dr-page-off').forEach((el) => !topBlock(el) && el.removeClass('dr-page-off'));
    places.forEach((place) => {
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
  }

  /** The editor's cursor went to another page (undo, search, a link): that page is the one open now. */
  follow(cm, name) {
    const view = this.views().find((v) => v.editor && v.editor.cm === cm);
    if (!view || !name) return;
    this.setShown(view, name);
    this.open(view.file, name);
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
    if (!this.places_.has(view)) this.places_.set(view, new Map());
    this.places_.get(view).set(`${view.file.path}|${name}`, { top: scroller ? scroller.scrollTop : 0, head });
  }

  restorePlace(view, name) {
    // Another page chosen since, or another note: this one's place is for later.
    if (this.shownIn(view) !== name) return;
    const place = (this.places_.get(view) || new Map()).get(`${view.file.path}|${name}`);
    const scroller = this.scroller(view);
    if (scroller) scroller.scrollTop = place ? place.top : 0;
    const cm = view.editor && view.editor.cm;
    // Put back only if it's still on this page: the text may have changed since.
    const field = this.extensions && this.extensions[0] && this.extensions[0][0];
    const now = field && cm && cm.state ? cm.state.field(field, false) : null;
    const onPage = (head) => !now || !now.pages.length || now.pages[pageAt(now.pages, head)] === openPage(now.pages, name);
    if (place && place.head !== null && cm && cm.state && place.head <= cm.state.doc.length && onPage(place.head)) {
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
    // The control alone scrolls, sideways, to show the page: never the note (this runs on every resize too).
    const left = target.offsetLeft;
    const right = left + target.offsetWidth;
    if (left < capsule.scrollLeft) capsule.scrollLeft = left;
    else if (right > capsule.scrollLeft + capsule.clientWidth) capsule.scrollLeft = right - capsule.clientWidth;
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
    // Measured once laid out — the observer's first call — and again when its size changes:
    // shown at last, or its pages' words in a font that arrived late.
    if (typeof ResizeObserver === 'function') {
      const watch = new ResizeObserver(() => {
        if (!capsule.isConnected) return watch.disconnect();
        this.select(bar, bar.dataset.open, false);
      });
      watch.observe(capsule);
    } else window.requestAnimationFrame(() => this.select(bar, open, false));
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
    const { pages } = this.pagesOf(view);
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
    if (!next) return;
    next = cleanPageName(next);
    if (next === name) return;
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
