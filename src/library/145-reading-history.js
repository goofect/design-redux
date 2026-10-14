/* ------------------------------------------------------------------ */
/* Noticing what's read                                                */
/*                                                                     */
/* A note opened is noted as opened; reached to its end — scrolled to   */
/* the bottom, or short enough to fit and open a few seconds — as read. */
/* A note you change while it's open stays read. The history itself is  */
/* in core (075); this is only what fills it, and redraws what shows    */
/* it when a note becomes read.                                        */
/* ------------------------------------------------------------------ */

import { MarkdownView, TFile } from 'obsidian';
import { readingOf } from '../core/075-reading.js';
import { Feature } from '../core/080-feature.js';

/* How near the bottom counts as the end, in pixels. */
export const READ_END = 48;

/* How long a note that fits on screen stays open before it counts as read. */
export const READ_GLANCE = 4000;

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
        desc: 'Notes you’ve read to the end are remembered — in the plugin’s data, never in your notes. Albums show how far through you are, lists mark what’s new or changed, and an album opens where you were.',
      },
    ];
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
      if (textShown(el)) this.read(this.fileOf(el));
    };
    document.addEventListener('scroll', this.onScroll, true);
    this.plugin.register(() => document.removeEventListener('scroll', this.onScroll, true));
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
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    readingOf(this.plugin).opened(file);
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
    if (typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
  }
}

ReadingHistory.settingKey = 'readingHistory';
