/* ------------------------------------------------------------------ */
/* The note page: the note first                                       */
/*                                                                     */
/* A note opens with its album above its title, in the accent colour,  */
/* and one grey line beneath it: what it hangs from, how long it is,    */
/* when it was last edited. Its properties can sit there as quiet       */
/* chips, the full block a click away. At its end come shelves: what    */
/* it links to, where it's mentioned, and more in its album. In both    */
/* reading and editing views; the text itself is left alone.           */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { noteCoverSrc } from '../core/030-helpers-art.js';
import { relativeDay } from '../core/040-helpers-sorting.js';
import { fmGet, plainValue, valueList } from '../core/045-helpers-properties.js';
import { noteOpening } from '../core/047-helpers-text.js';
import { libraryIndex } from '../core/077-library-index.js';
import { Feature } from '../core/080-feature.js';
import { Library } from './130-browse-filters.js';

/* How many notes a shelf at a note's end shows. */
export const NOTE_SHELF_SIZE = 10;

/** A value as a chip says it. */
function chipValue(value) {
  if (Array.isArray(value)) return value.map(chipValue).filter(Boolean).join(', ');
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return plainValue(String(value).replace(/^#/, ''));
}

export class NotePage extends Feature {
  settingsSchema() {
    return [
      {
        key: 'notePage',
        name: 'The note page',
        desc: 'Above a note’s title, its album; under it, one grey line — what it hangs from, its length, when it was edited.',
      },
      {
        key: 'notePageTint',
        name: 'A tint from the cover',
        desc: 'Behind a note’s title, a soft glow of its cover, or its album’s. A note with neither stays plain.',
        showIf: 'notePage',
      },
      {
        key: 'notePageChips',
        name: 'Properties as chips',
        desc: 'A note’s properties as quiet chips under its title, the full block a click away.',
        showIf: 'notePage',
      },
      {
        key: 'notePageShelves',
        name: 'Shelves at the end',
        desc: 'At a note’s end: what it links to, where it’s mentioned, and more in its album.',
        showIf: 'notePage',
      },
    ];
  }

  register() {
    const queue = () => this.queue();
    const ws = this.app.workspace;
    ['layout-change', 'active-leaf-change', 'file-open'].forEach((type) => this.plugin.registerEvent(ws.on(type, queue)));
    this.plugin.registerEvent(this.app.metadataCache.on('changed', queue));
    this.plugin.registerEvent(this.app.metadataCache.on('resolved', queue));
  }

  enable() {
    this.queue();
  }

  disable() {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.views().forEach((view) => this.clear(view));
  }

  /** Drawn again on the next frame, once, however many asks came. */
  queue() {
    if (this.frame || typeof window === 'undefined') return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      if (this.enabled) this.sync();
    });
  }

  /** Every note open, in a view that's loaded. */
  views() {
    return this.app.workspace
      .getLeavesOfType('markdown')
      .map((leaf) => (leaf.isDeferred ? null : leaf.view))
      .filter((view) => view && view.containerEl && view.file instanceof TFile);
  }

  sync() {
    this.views().forEach((view) => this.draw(view));
  }

  /** What this adds to a view, taken away. */
  clear(view) {
    view.containerEl.querySelectorAll('.dr-note-glow, .dr-note-album, .dr-note-meta, .dr-note-chips, .dr-note-shelves').forEach((el) => el.remove());
    view.containerEl.querySelectorAll('.dr-has-glow').forEach((el) => el.removeClass('dr-has-glow'));
    view.containerEl.removeClass('dr-props-as-chips', 'dr-show-props');
  }

  /** The sizers a note's view lays its text in: editing's and reading's, each with where its header and end go. */
  places(view) {
    const out = [];
    // The note's own, not one inside it — an embed, the backlinks below it.
    const own = (sizer) => !sizer.parentElement || !sizer.parentElement.closest('.cm-sizer, .markdown-preview-sizer, .embedded-backlinks');
    view.containerEl.querySelectorAll('.markdown-source-view .cm-sizer').forEach((sizer) =>
      own(sizer) &&
      out.push({ root: sizer, head: sizer, title: sizer.querySelector(':scope > .inline-title'), end: sizer, after: sizer.querySelector(':scope > .cm-contentContainer') })
    );
    view.containerEl.querySelectorAll('.markdown-preview-view .markdown-preview-sizer').forEach((sizer) => {
      if (!own(sizer)) return;
      const head = sizer.querySelector(':scope > .mod-header') || sizer;
      const foot = sizer.querySelector(':scope > .mod-footer');
      out.push({ root: sizer, head, title: head.querySelector(':scope > .inline-title'), end: foot || sizer, after: null, first: !!foot });
    });
    return out;
  }

  /** The album a note is in, or null — the vault's top is none, and a folder note stands for its album. */
  albumOf(file) {
    const folder = file.parent;
    if (!folder || !folder.parent || folder.path === '/') return null;
    const own = typeof this.plugin.folderNote === 'function' ? this.plugin.folderNote(folder) : null;
    return own === file ? null : folder;
  }

  /** The picture a note's page takes its tint from: its own cover, else its album's; or null. */
  tintSource(file, album) {
    const own = noteCoverSrc(this.plugin, file);
    if (own) return own;
    return album && typeof this.plugin.folderCoverSrc === 'function' ? this.plugin.folderCoverSrc(album) || null : null;
  }

  /** The one grey line: what the note hangs from, its length, when it was edited. */
  metaLine(file) {
    const parts = [];
    const key = String(this.settings.albumNestBy || '').trim();
    const cache = this.app.metadataCache.getFileCache(file);
    const parent = key ? valueList(cache ? fmGet(cache.frontmatter, key) : undefined)[0] : null;
    if (parent) parts.push(`Under ${plainValue(parent)}`);
    const lengths = this.plugin.lengths;
    const length = lengths ? lengths.label(file, this.settings.trackLength === 'words' ? 'words' : 'time') : '';
    if (length) parts.push(length);
    else if (lengths && typeof lengths.measure === 'function') lengths.measure([file]).then((fresh) => fresh && this.queue());
    if (file.stat && file.stat.mtime) parts.push(`Edited ${relativeDay(file.stat.mtime)}`);
    return parts.join('  ·  ');
  }

  /** The properties shown as chips: [{ key, text }], leaving out what's said elsewhere. */
  chips(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    const skip = new Set(['position', 'aliases', 'cssclasses', String(this.settings.coverProperty || 'cover').toLowerCase(), String(this.settings.albumNestBy || '').toLowerCase()]);
    return Object.keys(fm)
      .filter((k) => !skip.has(k.toLowerCase()))
      .map((k) => ({ key: k, text: chipValue(fm[k]) }))
      .filter((c) => c.text);
  }

  /** The shelves at a note's end: [{ title, files }], the empty left out. */
  shelves(file) {
    const index = libraryIndex(this.plugin);
    const vault = this.app.vault;
    const notes = (paths) =>
      Object.keys(paths)
        .map((p) => vault.getAbstractFileByPath(p))
        .filter((f) => f instanceof TFile && f.extension === 'md' && f !== file)
        .slice(0, NOTE_SHELF_SIZE);
    const out = [
      { title: 'Linked from here', files: notes(index.outgoing(file)) },
      { title: 'Mentioned in', files: notes(index.incoming(file)) },
    ];
    const album = this.albumOf(file);
    if (album) {
      const more = index
        .notes()
        .filter((f) => f.parent === album && f !== file)
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, NOTE_SHELF_SIZE);
      out.push({ title: `More in ${album.name}`, files: more, album });
    }
    return out.filter((s) => s.files.length);
  }

  /** One element in a place, made or kept: made again only when what it says changed. */
  put(parent, cls, key, before, fill) {
    let el = parent.querySelector(`:scope > .${cls}`);
    if (!key) {
      if (el) el.remove();
      return null;
    }
    if (el && el.dataset.key === key) return el;
    if (el) el.remove();
    el = parent.ownerDocument.createElement('div');
    el.className = cls;
    el.dataset.key = key;
    if (before && before.parentElement === parent) parent.insertBefore(el, before);
    else parent.appendChild(el);
    fill(el);
    return el;
  }

  draw(view) {
    const file = view.file;
    const on = this.enabled;
    const album = on ? this.albumOf(file) : null;
    const meta = on ? this.metaLine(file) : '';
    const chips = on && this.settings.notePageChips ? this.chips(file) : [];
    const shelves = on && this.settings.notePageShelves ? this.shelves(file) : [];
    const glow = on && this.settings.notePageTint !== false ? this.tintSource(file, album) : null;
    view.containerEl.toggleClass('dr-props-as-chips', chips.length > 0);
    this.places(view).forEach((place) => {
      const title = place.title;
      // Behind the header, a soft glow of the note's cover, or its album's; without one, nothing.
      place.head.toggleClass('dr-has-glow', !!glow);
      this.put(place.head, 'dr-note-glow', glow || '', place.head.firstChild, (el) => {
        const img = el.ownerDocument.createElement('img');
        img.setAttribute('src', glow);
        img.setAttribute('alt', '');
        el.appendChild(img);
      });
      // Above the title: its album, a step to it.
      this.put(place.head, 'dr-note-album', album ? album.path : '', title || place.head.firstChild, (el) => {
        el.setText(album.name);
        el.setAttribute('role', 'link');
        el.setAttribute('tabindex', '0');
        const go = () => {
          const library = this.plugin.feature(Library);
          if (library) library.browseMode({ mode: 'folder', path: album.path });
        };
        el.addEventListener('click', go);
        el.addEventListener('keydown', (evt) => evt.key === 'Enter' && go());
      });
      // Under it, the one grey line, then the chips.
      const after = title ? title.nextSibling : place.head.firstChild;
      const line = this.put(place.head, 'dr-note-meta', meta, after, (el) => el.setText(meta));
      const chipKey = chips.map((c) => `${c.key}=${c.text}`).join('|');
      this.put(place.head, 'dr-note-chips', chipKey, line ? line.nextSibling : after, (el) => {
        chips.forEach((c) => {
          const chip = el.createSpan({ cls: 'dr-note-chip', text: c.text });
          chip.setAttribute('aria-label', c.key);
        });
        const more = el.createSpan({ cls: 'dr-note-chip is-more', text: 'Properties' });
        more.setAttribute('role', 'button');
        more.addEventListener('click', () => view.containerEl.toggleClass('dr-show-props', !view.containerEl.hasClass('dr-show-props')));
      });
      // At the end, the shelves.
      const shelfKey = shelves.map((s) => `${s.title}:${s.files.map((f) => f.path).join(',')}`).join('|');
      const before = place.after ? place.after.nextSibling : place.first ? place.end.firstChild : null;
      // Drawn before the view had its footer: moved there now it has.
      place.root.querySelectorAll('.dr-note-shelves').forEach((el) => el.parentElement !== place.end && el.remove());
      this.put(place.end, 'dr-note-shelves', shelfKey, before, (el) => shelves.forEach((s) => this.shelf(el, s)));
    });
  }

  /** A shelf: its title, and a row of notes, each its title and opening line. */
  shelf(el, s) {
    const box = el.createDiv({ cls: 'dr-note-shelf' });
    const head = box.createDiv({ cls: 'dr-note-shelf-head', text: `${s.title} ›` });
    if (s.album) {
      head.setAttribute('role', 'link');
      head.addEventListener('click', () => {
        const library = this.plugin.feature(Library);
        if (library) library.browseMode({ mode: 'folder', path: s.album.path });
      });
    }
    const row = box.createDiv({ cls: 'dr-note-shelf-row' });
    s.files.forEach((f) => {
      const tile = row.createDiv({ cls: 'dr-note-tile' });
      tile.setAttribute('role', 'link');
      tile.setAttribute('tabindex', '0');
      tile.createDiv({ cls: 'dr-note-tile-title', text: f.basename });
      const line = tile.createDiv({ cls: 'dr-note-tile-line' });
      this.opening(f, line);
      const open = () => this.app.workspace.getLeaf(false).openFile(f);
      tile.addEventListener('click', open);
      tile.addEventListener('keydown', (evt) => evt.key === 'Enter' && open());
    });
  }

  /** A note's opening line into an element, read once per change of the note. */
  opening(file, el) {
    const store = this.plugin.excerpts || (this.plugin.excerpts = new Map());
    const key = `${file.path}|${file.stat ? file.stat.mtime : 0}`;
    if (store.has(key)) return el.setText(store.get(key));
    if (typeof this.app.vault.cachedRead !== 'function') return;
    this.app.vault
      .cachedRead(file)
      .then((text) => {
        if (store.size > 4000) store.clear();
        store.set(key, noteOpening(text));
        el.setText(store.get(key));
      })
      .catch(() => {});
  }
}

NotePage.settingKey = 'notePage';
