/* ------------------------------------------------------------------ */
/* The note page: the note first                                       */
/*                                                                     */
/* A note opens with its album above its title, in the accent colour,  */
/* and one grey line beneath it: what it hangs from, where it sits in   */
/* its album, when it was last edited. Its properties can sit there as quiet       */
/* chips, the full block a click away. At its end, the notes before and */
/* after it in its album, then shelves: what it links to, where it's    */
/* mentioned, and more in its album. In both reading and editing views;  */
/* the text itself is left alone.                                      */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { pageLeaf } from '../core/034-tabs.js';
import { fmGet, plainValue, valueList } from '../core/045-helpers-properties.js';
import { noteOpening, relativeDay } from '../core/047-helpers-text.js';
import { albumNeighbours } from '../core/070-orders.js';
import { libraryIndex } from '../core/077-library-index.js';
import { Feature } from '../core/080-feature.js';
import { ask } from '../core/081-capabilities.js';
import { paintValue } from '../ui/248-value-options.js';

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
  constructor(plugin) {
    super(plugin);
    // Each note's shelves, by its path: { file, steps, shelves, linked }, linked the paths it links to and is linked from.
    this.shelvesKept = new Map();
  }

  settingsSchema() {
    return [
      {
        key: 'notePage',
        name: 'The note page',
        desc: 'The collection above a note’s title, and a line of details below.',
      },
      {
        key: 'notePageChips',
        name: 'Properties as chips',
        desc: 'Properties as chips under a note’s title.',
        showIf: 'notePage',
      },
      {
        key: 'notePageNext',
        name: 'Next in the collection',
        desc: 'The notes before and after this one in its collection, at its end, and its place in the line of details.',
        showIf: 'notePage',
      },
      {
        key: 'notePageShelves',
        name: 'Shelves at the end',
        desc: 'Links, mentions and more from its collection, at a note’s end.',
        showIf: 'notePage',
      },
    ];
  }

  /** The way through a collection from the keyboard: the note before or after this one, opened in its place. */
  actions() {
    const step = (ctx, dir) => (ctx.file ? this.neighbours(ctx.file, this.albumOf(ctx.file))[dir] : null);
    const go = (ctx, dir) => {
      const target = step(ctx, dir);
      const leaf = pageLeaf(this.app);
      if (target && leaf) leaf.openFile(target);
    };
    return [
      { id: 'previous-in-album', name: 'Previous note in collection', icon: 'chevrons-left', on: 'file', menu: false, when: (ctx) => !!step(ctx, 'previous'), run: (ctx) => go(ctx, 'previous') },
      { id: 'next-in-album', name: 'Next note in collection', icon: 'chevrons-right', on: 'file', menu: false, when: (ctx) => !!step(ctx, 'next'), run: (ctx) => go(ctx, 'next') },
    ];
  }

  register() {
    const queue = () => this.queue();
    const fresh = () => this.queue(null, true);
    const ws = this.app.workspace;
    ['layout-change', 'active-leaf-change', 'file-open'].forEach((type) => this.plugin.registerEvent(ws.on(type, queue)));
    // What every shelf was worked out from may have changed: worked out again.
    this.plugin.registerEvent(ws.on('design-redux:albums-changed', fresh));
    ['create', 'delete', 'rename'].forEach((type) => this.plugin.registerEvent(this.app.vault.on(type, fresh)));
    // A note edited, or its links resolved: only the pages it could show on, before the edit and after.
    const meta = this.app.metadataCache;
    this.plugin.registerEvent(meta.on('changed', (file) => this.touched(file)));
    this.plugin.registerEvent(meta.on('resolve', (file) => this.touched(file)));
    // All resolved: the first time since switched on (the vault's first load), everything; after that, each note was seen to as it resolved.
    this.plugin.registerEvent(
      meta.on('resolved', () => {
        if (this.resolvedOnce) return;
        this.resolvedOnce = true;
        fresh();
      })
    );
  }

  enable() {
    this.resolvedOnce = false;
    this.queue(null, true);
  }

  disable() {
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.shelvesKept.clear();
    this.views().forEach((view) => this.clear(view));
  }

  /** Drawn again on the next frame, once, however many asks came: the pages of the paths given, or every one; fresh, with no shelf kept. */
  queue(paths, fresh) {
    if (fresh) this.shelvesKept.clear();
    if (!paths) this.all = true;
    else {
      if (!this.some) this.some = new Set();
      paths.forEach((p) => this.some.add(p));
    }
    if (this.frame || typeof window === 'undefined') return;
    this.frame = window.requestAnimationFrame(() => {
      const all = this.all;
      const some = this.some;
      this.frame = 0;
      this.all = false;
      this.some = null;
      if (!this.enabled) return;
      this.views().forEach((view) => (all || (some && some.has(view.file.path))) && this.draw(view));
    });
  }

  /** A note changed: the pages that could show something of it drawn again, their shelves worked out anew. */
  touched(file) {
    if (!file || typeof file.path !== 'string') return this.queue(null, true);
    const paths = this.views()
      .map((view) => view.file)
      .filter((own) => this.shows(own, file))
      .map((own) => own.path);
    this.shelvesKept.forEach((kept, path) => this.shows(kept.file, file) && this.shelvesKept.delete(path));
    if (paths.length) this.queue(paths);
  }

  /** Whether a note's page could show something of another: itself, a note of its album, one it links to or is linked from. */
  shows(own, file) {
    if (own.path === file.path) return true;
    const album = this.albumOf(own);
    if (album && file.parent === album) return true;
    const links = this.app.metadataCache.resolvedLinks || {};
    if ((links[own.path] || {})[file.path] || (links[file.path] || {})[own.path]) return true;
    // Linked when its shelves were worked out, though not now.
    const kept = this.shelvesKept.get(own.path);
    return !!kept && kept.linked.has(file.path);
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
    view.containerEl.querySelectorAll('.dr-note-album, .dr-note-meta, .dr-note-chips, .dr-note-rule, .dr-note-next, .dr-note-shelves').forEach((el) => el.remove());
    view.containerEl.removeClass('dr-props-as-chips');
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

  /** The notes before and after this one in its album, when that's asked for; otherwise none. */
  neighbours(file, album) {
    if (!album || this.settings.notePageNext === false) return { previous: null, next: null, index: -1, total: 0 };
    return albumNeighbours(this.plugin, file);
  }

  /** The one grey line: what the note hangs from, where it sits in its album, when it was edited. */
  metaLine(file, near) {
    const parts = [];
    const key = String(this.settings.albumNestBy || '').trim();
    const cache = this.app.metadataCache.getFileCache(file);
    const parent = key ? valueList(cache ? fmGet(cache.frontmatter, key) : undefined)[0] : null;
    if (parent) parts.push(`Under ${plainValue(parent)}`);
    if (near && near.index >= 0 && near.total > 1) parts.push(`${near.index + 1} of ${near.total}`);
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
      .map((k) => ({ key: k, text: chipValue(fm[k]), raw: Array.isArray(fm[k]) && fm[k].length === 1 ? fm[k][0] : fm[k] }))
      .filter((c) => c.text);
  }

  /** The shelves at a note's end: [{ title, files }], the empty left out; the steps either side aren't listed again. */
  shelves(file, near) {
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
        .filter((f) => f.parent === album && f !== file && f !== near.previous && f !== near.next)
        .sort((a, b) => b.stat.mtime - a.stat.mtime)
        .slice(0, NOTE_SHELF_SIZE);
      out.push({ title: `More in ${album.name}`, files: more, album });
    }
    return out.filter((s) => s.files.length);
  }

  /** A note's shelves, kept until something they show changes — or the steps either side, which they leave out, move. */
  keptShelves(file, near) {
    const steps = [near.previous, near.next].map((f) => (f ? f.path : '')).join('|');
    const kept = this.shelvesKept.get(file.path);
    if (kept && kept.file === file && kept.steps === steps) return kept.shelves;
    const shelves = this.shelves(file, near);
    const index = libraryIndex(this.plugin);
    const linked = new Set(Object.keys(index.outgoing(file)).concat(Object.keys(index.incoming(file))));
    if (this.shelvesKept.size >= 100) this.shelvesKept.clear();
    this.shelvesKept.set(file.path, { file, steps, shelves, linked });
    return shelves;
  }

  /** One element in a place, made or kept: made again only when what it says changed. */
  put(parent, cls, key, before, fill) {
    let el = parent.querySelector(`:scope > .${cls}`);
    if (!key) {
      if (el) el.remove();
      return null;
    }
    if (el && el.dataset.key === key) {
      // Kept as it is, but put back where it belongs if the view has laid out around it since.
      if (before && before !== el && before.parentElement === parent && el.nextSibling !== before) parent.insertBefore(el, before);
      return el;
    }
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
    const near = on ? this.neighbours(file, album) : { previous: null, next: null };
    const meta = on ? this.metaLine(file, near) : '';
    const chips = on && this.settings.notePageChips ? this.chips(file) : [];
    const shelves = on && this.settings.notePageShelves ? this.keptShelves(file, near) : [];
    view.containerEl.toggleClass('dr-props-as-chips', chips.length > 0);
    this.places(view).forEach((place) => {
      const title = place.title;
      // Above the title: its album, a step to it.
      this.put(place.head, 'dr-note-album', album ? album.path : '', title || place.head.firstChild, (el) => {
        el.setText(album.name);
        el.setAttribute('role', 'link');
        el.setAttribute('tabindex', '0');
        const go = () => {
          const library = ask(this.plugin, 'library');
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
          if (c.raw !== null && typeof c.raw !== 'object') {
            paintValue(chip, this.plugin, c.key, String(c.raw));
          }
        });
      });
      // The grey line: a hairline closing the header, under the chips; the page control sits right under it.
      const last = ['dr-note-chips', 'dr-note-meta'].map((c) => place.head.querySelector(`:scope > .${c}`)).find(Boolean) || title;
      this.put(place.head, 'dr-note-rule', last ? 'rule' : '', last ? last.nextSibling : null, () => {});
      // At the end: the notes either side of this one in its album, then the shelves — each made again when a note on it is edited, so its opening line is fresh.
      const before = place.after ? place.after.nextSibling : place.first ? place.end.firstChild : null;
      // Drawn before the view had its footer: moved there now it has.
      place.root.querySelectorAll('.dr-note-next, .dr-note-shelves').forEach((el) => el.parentElement !== place.end && el.remove());
      const steps = [near.previous && ['previous', near.previous], near.next && ['next', near.next]].filter(Boolean);
      const stepKey = steps.map(([dir, f]) => `${dir}:${f.path}@${f.stat ? f.stat.mtime : 0}`).join('|');
      const next = this.put(place.end, 'dr-note-next', stepKey, before, (el) => steps.forEach(([dir, f]) => this.step(el, dir, f, album)));
      const shelfKey = shelves.map((s) => `${s.title}:${s.files.map((f) => `${f.path}@${f.stat ? f.stat.mtime : 0}`).join(',')}`).join('|');
      this.put(place.end, 'dr-note-shelves', shelfKey, next ? next.nextSibling : before, (el) => shelves.forEach((s) => this.shelf(el, s)));
    });
  }

  /** A step through the album: the note before or after, as a row — Previous or Next, its title, its opening line. */
  step(el, dir, file, album) {
    const row = el.createDiv({ cls: `dr-note-step is-${dir}` });
    row.setAttribute('role', 'link');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-label', `${dir === 'next' ? 'Next' : 'Previous'} in ${album.name}: ${file.basename}`);
    const text = row.createDiv({ cls: 'dr-note-step-text' });
    text.createDiv({ cls: 'dr-note-step-label', text: dir === 'next' ? 'Next' : 'Previous' });
    text.createDiv({ cls: 'dr-note-step-title', text: file.basename });
    this.opening(file, text.createDiv({ cls: 'dr-note-step-line' }));
    const open = () => this.app.workspace.getLeaf(false).openFile(file);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (evt) => evt.key === 'Enter' && open());
  }

  /** A shelf: its title, and a row of notes, each its title and opening line. */
  shelf(el, s) {
    const box = el.createDiv({ cls: 'dr-note-shelf' });
    const head = box.createDiv({ cls: 'dr-note-shelf-head', text: `${s.title} ›` });
    if (s.album) {
      head.setAttribute('role', 'link');
      head.addEventListener('click', () => {
        const library = ask(this.plugin, 'library');
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
    // Only a note has an opening line: a PDF or an image would be its bytes.
    if (!file || file.extension !== 'md') return;
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
