/* ------------------------------------------------------------------ */
/* Reading outline                                                     */
/*                                                                     */
/* The open note's headings in the right sidebar, following you as     */
/* lyrics follow a song: the heading you're reading lit, with a thin   */
/* line for how far through its section you are, the ones above it     */
/* dimmed as done, and the words left in each. A row goes to its        */
/* heading. Scrolling the panel never moves the note, and it stops      */
/* following for a moment after you scroll it yourself.                 */
/* ------------------------------------------------------------------ */

import { ItemView, MarkdownView } from 'obsidian';
import { pageLeaf } from '../core/030-helpers-art.js';
import { onActivate } from '../core/040-helpers-sorting.js';
import { currentHeading, sectionEnds, sectionWords } from '../core/047-helpers-text.js';
import { noteLine, scrollNoteTo } from '../core/075-reading.js';
import { Feature } from '../core/080-feature.js';


export const READING_OUTLINE_VIEW = 'design-redux-outline';

/* How long the panel leaves its own scrolling alone after you scroll it. */
export const OUTLINE_HANDS_OFF = 3000;

/** A note's headings, as the cache has them: [{ heading, level, line }]. */
export function noteHeadings(app, file) {
  const cache = file ? app.metadataCache.getFileCache(file) : null;
  return ((cache && cache.headings) || []).map((h) => ({ heading: h.heading, level: h.level, line: h.position.start.line }));
}

/**
 * Which heading you're reading, by index, and the line you're at. In
 * reading view, a heading counts once its top is above the middle of
 * the page; in editing view, the heading at the top line.
 */
export function readingAt(view, headings) {
  const top = noteLine(view);
  if (top === null) return { index: -1, line: 0 };
  // A view scrolled to a heading can report a hair above its line.
  let index = currentHeading(headings, Math.ceil(top - 0.01));
  let line = top;
  const preview = typeof view.getMode === 'function' && view.getMode() === 'preview';
  const scroller = preview ? view.containerEl.querySelector('.markdown-preview-view') : null;
  if (scroller && typeof scroller.getBoundingClientRect === 'function') {
    const box = scroller.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const passed = Array.from(scroller.querySelectorAll('.markdown-preview-sizer > div > h1, .markdown-preview-sizer > div > h2, .markdown-preview-sizer > div > h3, .markdown-preview-sizer > div > h4, .markdown-preview-sizer > div > h5, .markdown-preview-sizer > div > h6')).filter((el) => {
      const t = el.getBoundingClientRect().top;
      return t > box.top + 4 && t <= middle;
    }).length;
    if (passed) {
      index = Math.min(headings.length - 1, index + passed);
      line = headings[index].line;
    }
  }
  return { index, line };
}

export class ReadingOutlineView extends ItemView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
    this.plugin = feature.plugin;
    this.noteView = null;
    this.file = null;
    this.headings = [];
    this.words = [];
    this.lines = 0;
    this.current = -2;
    this.timer = 0;
    this.frame = 0;
    this.ownScrollAt = 0;
    this.handsOffAt = 0;
  }

  getViewType() {
    return READING_OUTLINE_VIEW;
  }

  getDisplayText() {
    return 'Reading outline';
  }

  getIcon() {
    return 'list';
  }

  async onOpen() {
    this.containerEl.addClass('dr-reading-outline');
    const queue = () => this.queue();
    this.registerEvent(this.app.workspace.on('active-leaf-change', queue));
    this.registerEvent(this.app.workspace.on('file-open', queue));
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (file === this.file) queue();
      })
    );
    // The note scrolled: the lit row follows.
    this.registerDomEvent(
      document,
      'scroll',
      (evt) => {
        const view = this.noteView;
        if (view && view.containerEl && evt.target && evt.target !== this.contentEl && view.containerEl.contains(evt.target)) this.follow();
      },
      true
    );
    // The panel scrolled by you, not by itself: left alone a moment.
    this.registerDomEvent(this.contentEl, 'scroll', () => {
      if (Date.now() - this.ownScrollAt > 120) this.handsOffAt = Date.now();
    });
    this.render();
  }

  async onClose() {
    window.clearTimeout(this.timer);
    if (this.frame) window.cancelAnimationFrame(this.frame);
  }

  queue() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), 120);
  }

  /** On the next frame, the lit row brought up to date: scroll events come many to a frame. */
  follow() {
    if (this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.light();
    });
  }

  /** The note to outline: the page in use if it's one, or the last one that was. */
  findNote() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    if (view instanceof MarkdownView && view.file) return view;
    const last = this.noteView;
    if (last && last.file && last.containerEl && last.containerEl.isConnected) return last;
    return null;
  }

  render() {
    const root = this.contentEl;
    const view = this.findNote();
    const file = view ? view.file : null;
    const scroll = root.scrollTop;
    const same = file === this.file;
    this.noteView = view;
    this.file = file;
    this.headings = noteHeadings(this.app, file);
    this.current = -2;
    if (!same) this.words = [];
    root.empty();
    if (!file) {
      root.createDiv({ cls: 'pane-empty', text: 'Open a note to see its outline.' });
      return;
    }
    if (!this.headings.length) {
      root.createDiv({ cls: 'pane-empty', text: 'No headings in this note' });
      return;
    }
    root.createDiv({ cls: 'dr-outline-title', text: file.basename });
    const list = root.createDiv({ cls: 'dr-reading-list' });
    list.setAttribute('role', 'list');
    const least = Math.min(...this.headings.map((h) => h.level));
    this.rows = this.headings.map((h, i) => {
      const row = list.createDiv({ cls: 'dr-reading-row' });
      row.setAttribute('role', 'listitem');
      row.setAttribute('tabindex', '0');
      row.style.setProperty('--dr-depth', String(h.level - least));
      row.createSpan({ cls: 'dr-reading-name', text: h.heading });
      row.createSpan({ cls: 'dr-reading-words' });
      onActivate(row, () => this.jump(i));
      return row;
    });
    list.addEventListener('keydown', (evt) => {
      if (evt.key !== 'ArrowDown' && evt.key !== 'ArrowUp') return;
      const at = this.rows.indexOf(evt.target);
      if (at === -1) return;
      evt.preventDefault();
      const next = this.rows[Math.max(0, Math.min(this.rows.length - 1, at + (evt.key === 'ArrowDown' ? 1 : -1)))];
      next.focus();
    });
    root.scrollTop = scroll;
    this.count(file);
    this.light();
  }

  /** The words in each section, once the note's text is read. */
  count(file) {
    if (typeof this.app.vault.cachedRead !== 'function') return;
    this.app.vault.cachedRead(file).then((text) => {
      if (file !== this.file) return;
      this.lines = String(text).split('\n').length;
      this.words = sectionWords(text, this.headings);
      this.current = -2;
      this.light();
    });
  }

  /** The heading you're reading lit, the ones before it done, and the words left. */
  light() {
    if (!this.rows || !this.headings.length || !this.noteView) return;
    const { index, line } = readingAt(this.noteView, this.headings);
    const ends = sectionEnds(this.headings, this.lines || this.headings[this.headings.length - 1].line + 1);
    const showWords = !!this.plugin.settings.outlineWordCounts;
    this.rows.forEach((row, i) => {
      row.toggleClass('is-current', i === index);
      row.toggleClass('is-done', i < index);
      let words = this.words[i];
      if (i === index) {
        const h = this.headings[i];
        const through = Math.max(0, Math.min(1, (line - h.line) / Math.max(1, ends[i] - h.line)));
        row.style.setProperty('--dr-through-n', through.toFixed(3));
        if (typeof words === 'number') words = Math.round(words * (1 - through));
      }
      const label = row.querySelector('.dr-reading-words');
      if (label) label.textContent = showWords && typeof words === 'number' && words > 0 ? String(words) : '';
    });
    if (index !== this.current) {
      this.current = index;
      const row = this.rows[index];
      if (row && Date.now() - this.handsOffAt > OUTLINE_HANDS_OFF && typeof row.scrollIntoView === 'function') {
        this.ownScrollAt = Date.now();
        row.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  /** The note scrolled to a heading. */
  jump(i) {
    const h = this.headings[i];
    if (!h || !this.noteView) return;
    scrollNoteTo(this.noteView, h.line);
    this.current = -2;
    this.follow();
  }
}

export class ReadingOutline extends Feature {
  settingsSchema() {
    return [
      {
        key: 'readingOutline',
        name: 'Reading outline',
        desc: 'The open note’s headings in the right sidebar: the one you’re reading lit, the ones you’ve passed dimmed. Click one to go to it.',
      },
      {
        key: 'outlineWordCounts',
        showIf: 'readingOutline',
        name: 'Words left in each section',
        desc: 'A small count beside each heading.',
      },
    ];
  }

  registerTypes() {
    this.plugin.registerView(READING_OUTLINE_VIEW, (leaf) => new ReadingOutlineView(leaf, this));
  }

  actions() {
    return [{ id: 'open-reading-outline', name: 'Show or hide the reading outline', icon: 'list', on: 'note', menu: false, when: () => this.enabled, run: () => this.toggle() }];
  }

  enable() {
    this.views().forEach((view) => view.render());
  }

  disable() {
    // Closed when switched off — not when the plugin's only unloading, so it's back where it was after.
    if (!this.plugin.unloading) this.app.workspace.getLeavesOfType(READING_OUTLINE_VIEW).forEach((leaf) => leaf.detach());
  }

  views() {
    return this.app.workspace
      .getLeavesOfType(READING_OUTLINE_VIEW)
      .map((leaf) => leaf.view)
      .filter((view) => view instanceof ReadingOutlineView);
  }

  /** Open if it's closed, closed if it's open. */
  async toggle() {
    const open = this.app.workspace.getLeavesOfType(READING_OUTLINE_VIEW);
    if (open.length) {
      open.forEach((leaf) => leaf.detach());
      return null;
    }
    return this.show();
  }

  /** The outline in the right sidebar, opened if it isn't, and shown. */
  async show() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(READING_OUTLINE_VIEW)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: READING_OUTLINE_VIEW, active: false });
    }
    ws.revealLeaf(leaf);
    if (leaf.view instanceof ReadingOutlineView) leaf.view.render();
    return leaf;
  }
}

ReadingOutline.settingKey = 'readingOutline';
