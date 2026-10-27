/* ------------------------------------------------------------------ */
/* Noticing what's read                                                */
/*                                                                     */
/* A note opened is noted as opened; reached to its end — scrolled to   */
/* the bottom, or short enough to fit and open a few seconds — as read. */
/* The line you're on is kept too, and a note opens there again.        */
/* A note you change while it's open stays read. The history itself is  */
/* in core (075); this is only what fills it, and redraws what shows    */
/* it when a note becomes read.                                        */
/* ------------------------------------------------------------------ */

import { MarkdownView, TFile } from 'obsidian';
import { noteLine, readingOf, scrollNoteTo } from '../core/075-reading.js';
import { Feature } from '../core/080-feature.js';

/* How near the bottom counts as the end, in pixels. */
export const READ_END = 48;

/* How long a note that fits on screen stays open before it counts as read. */
export const READ_GLANCE = 4000;

/* How often the line you're on is kept while you scroll. */
export const PLACE_EVERY = 5000;

/**
 * The notes your recent reading points to, that you haven't opened:
 * ranked by how many of the notes you read link to them, then by how
 * lately one of those was read. recent: [{ path, at }], read times;
 * outgoing(path) → { to: count }; opened(path) → whether it's been
 * opened. [{ path, count, from, at }], at most `limit`.
 */
export function fromReading(recent, outgoing, opened, now, days = 14, limit = 12) {
  const since = now - days * 86400000;
  const reading = recent.filter((r) => r.at >= since);
  const read = new Set(reading.map((r) => r.path));
  const found = new Map();
  reading.forEach((r) => {
    Object.keys(outgoing(r.path) || {}).forEach((to) => {
      if (to === r.path || read.has(to) || !/\.md$/i.test(to) || opened(to)) return;
      const f = found.get(to) || { path: to, count: 0, from: r.path, at: 0 };
      f.count++;
      if (r.at > f.at) {
        f.at = r.at;
        f.from = r.path;
      }
      found.set(to, f);
    });
  });
  return Array.from(found.values())
    .sort((a, b) => b.count - a.count || b.at - a.at || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, limit);
}

/** Whether a scroller shows its end. */
export function atEnd(el) {
  return !!el && el.scrollHeight - el.scrollTop - el.clientHeight <= READ_END;
}

/**
 * Whether a note's text is seen to its end in a scroller — its last
 * words on screen, whatever follows them (shelves, backlinks).
 */
export function textShown(scroller) {
  if (!scroller) return false;
  const sizer = scroller.querySelector('.cm-sizer, .markdown-preview-sizer');
  let last = sizer ? sizer.querySelector(':scope > .cm-contentContainer') : null;
  if (sizer && !last) {
    const kids = Array.from(sizer.children).filter((c) => !c.matches('.mod-footer, .dr-note-shelves, .embedded-backlinks, .markdown-preview-pusher'));
    last = kids[kids.length - 1] || null;
  }
  if (!last || typeof last.getBoundingClientRect !== 'function') return atEnd(scroller);
  return last.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + READ_END;
}

export class ReadingHistory extends Feature {
  settingsSchema() {
    return [
      {
        key: 'readingHistory',
        name: 'Reading history',
        desc: 'Notes you’ve read to the end are remembered — in the plugin’s data, never in your notes. Lists mark what’s new or changed, and a collection opens where you were.',
      },
      {
        key: 'rememberPlace',
        showIf: 'readingHistory',
        name: 'Open notes where you left off',
        desc: 'A note opens at the line you were on, unless a link names its own heading.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'resume-reading-place',
        name: 'Go to where I left off',
        icon: 'bookmark',
        on: 'note',
        menu: false,
        when: (ctx) => this.enabled && readingOf(this.plugin).where(ctx.file) !== null,
        run: (ctx) => this.resume(ctx.file),
      },
    ];
  }

  get remembers() {
    return this.enabled && !!this.settings.rememberPlace;
  }

  register() {
    const ws = this.app.workspace;
    this.plugin.registerEvent(ws.on('file-open', (file) => this.enabled && this.onOpen(file)));
    this.plugin.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (this.enabled && file instanceof TFile && file === this.activeFile()) readingOf(this.plugin).edited(file);
      })
    );
    // Scrolling in any note: the end reached is a note read.
    this.onScroll = (evt) => {
      if (!this.enabled) return;
      const el = evt.target;
      if (!el || !el.classList || !(el.classList.contains('cm-scroller') || el.classList.contains('markdown-preview-view'))) return;
      const file = this.fileOf(el);
      if (textShown(el)) this.read(file);
      this.track(file);
    };
    document.addEventListener('scroll', this.onScroll, true);
    this.plugin.register(() => document.removeEventListener('scroll', this.onScroll, true));
    // Kept on the way out too, not only every few seconds.
    this.plugin.register(() => {
      this.keepPlace();
      clearTimeout(this.restoring);
    });
  }

  disable() {
    this.keepPlace();
  }

  /** The view a note is open in, the active one first. */
  viewOf(file) {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active && active.file === file) return active;
    let found = null;
    this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (!found && view && view.file === file) found = view;
    });
    return found;
  }

  /** Where you are in a note as you scroll it: remembered, kept every few seconds. */
  track(file) {
    if (!this.remembers || !(file instanceof TFile)) return;
    const line = noteLine(this.viewOf(file));
    if (line === null) return;
    if (this.here && this.here.file !== file) this.keepPlace();
    this.here = { file, line };
    const now = Date.now();
    if (!this.keptAt || now - this.keptAt >= PLACE_EVERY) this.keepPlace();
  }

  /** The place last seen, kept. */
  keepPlace() {
    const here = this.here;
    if (!here || !this.settings.rememberPlace) return;
    this.keptAt = Date.now();
    readingOf(this.plugin).place(here.file, here.line);
  }

  /** The note scrolled to where you were. */
  resume(file) {
    const line = readingOf(this.plugin).where(file);
    const view = this.viewOf(file);
    if (line === null || !view) return;
    scrollNoteTo(view, line);
  }

  /**
   * A note just opened goes to where you were — once it's settled, and
   * only if it's still at the top: a link to a heading, or going back,
   * has already put it somewhere.
   */
  restorePlace(file) {
    clearTimeout(this.restoring);
    if (!this.remembers) return;
    const line = readingOf(this.plugin).where(file);
    if (!(line > 0)) return;
    this.restoring = setTimeout(() => {
      this.restoring = 0;
      if (this.activeFile() !== file) return;
      const view = this.viewOf(file);
      const at = noteLine(view);
      if (at === null || at >= 1) return;
      scrollNoteTo(view, line);
    }, 150);
  }

  activeFile() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view ? view.file : null;
  }

  /** The note a scroller belongs to. */
  fileOf(el) {
    let found = null;
    this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
      const view = leaf.isDeferred ? null : leaf.view;
      if (view && view.containerEl && view.containerEl.contains(el)) found = view.file;
    });
    return found;
  }

  onOpen(file) {
    if (this.here && this.here.file !== file) this.keepPlace();
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    readingOf(this.plugin).opened(file);
    this.restorePlace(file);
    // Short enough to fit: read once it's been open a moment.
    if (this.glance) clearTimeout(this.glance);
    this.glance = setTimeout(() => {
      this.glance = 0;
      if (this.activeFile() !== file) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const scroller = view && view.containerEl.querySelector(view.getMode && view.getMode() === 'preview' ? '.markdown-preview-view' : '.cm-scroller');
      if (textShown(scroller)) this.read(file);
    }, READ_GLANCE);
  }

  /** A note read: noted, and what shows it drawn again. */
  read(file) {
    if (!(file instanceof TFile) || !readingOf(this.plugin).markRead(file)) return;
    this.app.workspace.trigger('design-redux:read', file);
    if (typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
  }
}

ReadingHistory.settingKey = 'readingHistory';
