/* ------------------------------------------------------------------ */
/* What the inspector can be about                                    */
/*                                                                    */
/* A note, an album picked in the library, a text card on a canvas    */
/* (a map's node arrives as its note). Each is drawn its own way, but */
/* the panel holding it neither knows nor cares which: it asks the    */
/* inspectable whether it's already about a target, which note its    */
/* sections edit, and to draw itself. The panel keeps the rest —      */
/* popup or dock, where it sits, what it follows.                     */
/* ------------------------------------------------------------------ */

import { parseYaml, setIcon, stringifyYaml } from 'obsidian';
import { BROWSE_VIEW } from '../core/020-constants.js';
import { drawNoteArt, leadProperty } from '../core/030-helpers-art.js';
import { relativeDay } from '../core/040-helpers-sorting.js';
import { plainMarkdownLine } from '../core/047-helpers-text.js';
import { requestCanvasSave } from '../core/079-canvas-adapter.js';
import { sameTarget } from '../core/084-workspace-coordinator.js';

/** A text card's properties — written at its top between --- lines — and the rest: { data, body }; data null where they can't be read. */
export function cardFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(text || '');
  if (!m) return { data: {}, body: text || '' };
  let data = null;
  try {
    data = m[1].trim() ? parseYaml(m[1]) : {};
  } catch (err) {
    data = null;
  }
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) data = null;
  return { data, body: (text || '').slice(m[0].length) };
}

/** A text card's text with these properties at its top, or none. */
export function withCardFrontmatter(data, body) {
  if (!Object.keys(data).length) return body;
  return `---\n${stringifyYaml(data)}---\n${body}`;
}

/** A value typed for a card's property, made the kind it was: a list, a number, true or false, or text. */
export function cardValue(typed, was) {
  const text = String(typed).trim();
  if (Array.isArray(was)) return text ? text.split(',').map((t) => t.trim()).filter(Boolean) : [];
  if (typeof was === 'number' && text !== '' && !isNaN(Number(text))) return Number(text);
  if (typeof was === 'boolean' && /^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  return text;
}

/**
 * A note as an info sheet opens: its cover beside its name, one property
 * raised beneath in the accent — the title-and-artist shape an album
 * page opens with — and a line on where it lives, how long it is and
 * when it last changed. It says what you're looking at before the
 * details, which a bare list of fields never does. The note panel and
 * the inspector both open with it.
 */
export function drawNoteHead(plugin, parentEl, file) {
  const head = parentEl.createDiv({ cls: 'dr-props-head dr-props-identity' });
  const art = head.createDiv({ cls: 'dr-props-art' });
  drawNoteArt(plugin, art, file);
  // An image dropped here — or pasted, once it's clicked — becomes the note's cover.
  if (file.extension === 'md') {
    art.dataset.coverNote = file.path;
    art.setAttribute('tabindex', '-1');
  }

  const info = head.createDiv({ cls: 'dr-props-info' });
  info.createDiv({ cls: 'dr-props-title', text: file.basename });
  const lead = leadProperty(plugin.app, file, false);
  if (lead) info.createDiv({ cls: 'dr-props-lead', text: lead });
  fillNoteMeta(plugin, info.createDiv({ cls: 'dr-props-meta' }), file);
  return head;
}

/** "Folder · 4 min read · Edited Yesterday". The length arrives once it's counted. */
export function fillNoteMeta(plugin, meta, file) {
  const parts = [];
  const folder = file.parent;
  if (folder && !(folder.isRoot && folder.isRoot())) parts.push(folder.name);
  const style = plugin.settings.trackLength;
  const lengths = plugin.lengths;
  const counts = !!lengths && style !== 'none';
  const length = counts ? lengths.label(file, style === 'words' ? 'words' : 'time') : '';
  if (length) parts.push(style === 'words' ? length : `${length} read`);
  if (file.stat) parts.push(`Edited ${relativeDay(file.stat.mtime)}`);
  meta.setText(parts.join('  ·  '));
  if (!counts || lengths.words(file) !== null) return;
  lengths.measure([file]).then(
    (changed) => {
      if (changed && meta.isConnected) fillNoteMeta(plugin, meta, file);
    },
    () => {}
  );
}

/** A page of the library — the one last worked in — to draw what it picked. */
export function libraryPage(app) {
  const ws = app.workspace;
  const leaves = ws.getLeavesOfType(BROWSE_VIEW);
  const recent = typeof ws.getMostRecentLeaf === 'function' ? ws.getMostRecentLeaf() : null;
  const leaf = recent && leaves.includes(recent) ? recent : leaves[0];
  return leaf && leaf.view && typeof leaf.view.previewAlbum === 'function' ? leaf.view : null;
}

/** What `target` ({ file, picked } | { folder } | { card }) is, to be drawn. */
export function inspectableOf(plugin, target) {
  if (target.card) return new CardInspectable(plugin, target);
  if (target.folder) return new FolderInspectable(plugin, target);
  return new NoteInspectable(plugin, target);
}

class Inspectable {
  constructor(plugin, target) {
    this.plugin = plugin;
    this.target = target;
  }

  get kind() {
    return 'note';
  }

  /** The note its sections edit, if any. */
  get file() {
    return this.target.file || null;
  }

  /** Already about `target`: then it isn't drawn again, and what's being typed in it stays. */
  is(target) {
    return sameTarget(this.target, target);
  }

  /** Drawn into `el` for `panel`: the sections it mounted, for the panel to take away. */
  draw(panel, el) {
    const sections = this.file ? panel.build() : [];
    sections.forEach((sec) => sec.mount(el, this.file));
    return sections;
  }
}

/** A note, open or picked in the library. */
class NoteInspectable extends Inspectable {
  draw(panel, el) {
    drawNoteHead(this.plugin, el, this.file);
    // Picked in the library rather than open: what can be done with it, there.
    const view = this.target.picked ? libraryPage(this.plugin.app) : null;
    if (view && typeof view.inspectNoteActions === 'function') view.inspectNoteActions(el, this.file);
    return super.draw(panel, el);
  }
}

/** An album picked in the library: what it is, as the library tells it, then its folder note's properties. */
class FolderInspectable extends Inspectable {
  constructor(plugin, target) {
    super(plugin, target);
    this.note = typeof plugin.folderNote === 'function' ? plugin.folderNote(target.folder) || null : null;
  }

  get kind() {
    return 'folder';
  }

  get file() {
    return this.note;
  }

  draw(panel, el) {
    const folder = this.target.folder;
    const brief = el.createDiv({ cls: 'dr-inspector-brief' });
    const view = libraryPage(this.plugin.app);
    if (view) view.previewAlbum(brief, folder);
    else brief.createDiv({ cls: 'dr-preview-title', text: folder.name });
    return super.draw(panel, el);
  }
}

/**
 * A text card's properties: each as a row to change or take away, and
 * a row to add one. They're kept at the top of its text, which the card
 * itself doesn't show.
 */
class CardInspectable extends Inspectable {
  get kind() {
    return 'card';
  }

  get file() {
    return null;
  }

  draw(panel, el) {
    const node = this.target.card;
    const text = (node.getData() || {}).text || '';
    const parsed = cardFrontmatter(text);
    const head = el.createDiv({ cls: 'dr-props-head dr-props-identity' });
    // A card has no cover: in its place, what it is.
    setIcon(head.createDiv({ cls: 'dr-props-art is-blank', attr: { 'aria-hidden': 'true' } }).createSpan({ cls: 'dr-card-glyph' }), 'sticky-note');
    const info = head.createDiv({ cls: 'dr-props-info' });
    const first = parsed.body.split('\n').map((l) => plainMarkdownLine(l)).find(Boolean);
    info.createDiv({ cls: 'dr-props-title', text: first || 'Card' });
    info.createDiv({ cls: 'dr-props-meta', text: 'A card on this canvas' });
    const list = el.createDiv({ cls: 'dr-card-props' });
    if (!parsed.data) {
      list.createDiv({ cls: 'dr-card-props-note', text: 'Its properties can’t be read: look at the lines between --- at its top.' });
      return [];
    }
    const set = (key, value) => {
      this.setProperty(key, value);
      panel.redraw();
    };
    const keys = Object.keys(parsed.data);
    keys.forEach((key) => this.row(list, key, parsed.data[key], set));
    if (!keys.length) list.createDiv({ cls: 'dr-card-props-note', text: 'No properties yet.' });
    const add = el.createDiv({ cls: 'dr-card-props-add' });
    const keyIn = add.createEl('input', { type: 'text', cls: 'dr-card-props-key-in' });
    keyIn.placeholder = 'Property';
    const valIn = add.createEl('input', { type: 'text', cls: 'dr-card-props-value' });
    valIn.placeholder = 'Value';
    const button = add.createEl('button', { text: 'Add' });
    const commit = () => {
      const key = keyIn.value.trim();
      if (key) set(key, cardValue(valIn.value, parsed.data[key]));
    };
    button.addEventListener('click', commit);
    [keyIn, valIn].forEach((input) =>
      input.addEventListener('keydown', (evt) => {
        if (evt.key !== 'Enter') return;
        evt.preventDefault();
        commit();
      })
    );
    return [];
  }

  row(list, key, value, set) {
    const row = list.createDiv({ cls: 'dr-card-props-row' });
    row.createDiv({ cls: 'dr-card-props-key', text: key });
    const input = row.createEl('input', { type: 'text', cls: 'dr-card-props-value' });
    input.value = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value);
    input.addEventListener('change', () => set(key, cardValue(input.value, value)));
    const remove = row.createDiv({ cls: 'clickable-icon dr-card-props-remove' });
    remove.setAttribute('aria-label', 'Remove');
    setIcon(remove, 'x');
    remove.addEventListener('click', () => set(key, undefined));
  }

  /** A property set, or taken away (undefined), at the top of its text. Saved, a step of Undo. */
  setProperty(key, value) {
    const node = this.target.card;
    const text = (node.getData() || {}).text || '';
    const parsed = cardFrontmatter(text);
    if (!parsed.data) return;
    const data = Object.assign({}, parsed.data);
    if (value === undefined) delete data[key];
    else data[key] = value;
    const next = withCardFrontmatter(data, parsed.body);
    if (next !== text) {
      node.setText(next);
      if (node.canvas) requestCanvasSave(node.canvas);
    }
  }
}
