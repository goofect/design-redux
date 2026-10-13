/* ------------------------------------------------------------------ */
/* The panel                                                           */
/*                                                                     */
/* Stacks sections and keeps them pointed at the active note. Nothing  */
/* is taken from the view, so the note keeps its own property block    */
/* and the panel can hold as many sections as it likes. On a canvas,   */
/* it's about the one card selected: a note's card shows the note's    */
/* properties; a text card, those written at its top, between ---      */
/* lines, which the card itself doesn't show.                          */
/* ------------------------------------------------------------------ */

import { MarkdownView, Notice, parseYaml, Platform, setIcon, stringifyYaml, TFile } from 'obsidian';
import { drawNoteArt, leadProperty } from '../core/030-helpers-art.js';
import { makeTrigger, relativeDay } from '../core/040-helpers-sorting.js';
import { plainMarkdownLine } from '../core/047-helpers-text.js';
import { cardElement, pickedOnCanvas, requestCanvasSave } from '../core/079-canvas-adapter.js';
import { Feature } from '../core/080-feature.js';
import { PropertiesSection } from './160-panel-properties.js';
import { MentionsSection } from './170-panel-native.js';

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
  const head = parentEl.createDiv({ cls: 'dr-props-head' });
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

export class PropertiesPanel extends Feature {
  constructor(plugin) {
    super(plugin);
    this.popupEl = null;
    this.file = null;
    this.leaf = null;
    this.trigger = null;
    this.sections = [];
    // leaf -> its trigger element, so a fitted leaf costs a lookup
    // rather than a querySelector. Weak, so closing a tab drops it.
    this.fitted = new WeakMap();
  }

  settingsSchema() {
    return [
      {
        key: 'propertiesDropdown',
        name: 'Properties button',
        desc: 'Hide properties in the note and open them from a button in its header.',
      },
      {
        key: 'showMentions',
        name: 'Mentions',
        desc: 'Below the properties, list notes that link to or name this one.',
        showIf: 'propertiesDropdown',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'open-properties',
        name: 'Open properties',
        when: () => {
          const leaf = this.app.workspace.activeLeaf;
          return this.enabled && !!leaf && leaf.view instanceof MarkdownView;
        },
        run: () => {
          const leaf = this.app.workspace.activeLeaf;
          if (!leaf) return;
          const trigger = this.fitted.get(leaf);
          const box = trigger && trigger.isConnected ? trigger.getBoundingClientRect() : null;
          if (box && (box.width || box.height)) {
            trigger.click();
            return;
          }
          // Hidden while the strip is up: opened against the strip's button.
          const strip = document.querySelector('.dr-strip .dr-strip-btn[data-action="properties"]');
          this.toggleFrom(leaf, strip || trigger);
        },
      },
    ];
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (this.enabled) this.follow(leaf);
      })
    );
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        // Fires when a leaf loads a different file, which
        // active-leaf-change does not cover.
        if (!this.isOpen() || !file || file === this.file) return;
        const leaf = this.app.workspace.activeLeaf;
        if (leaf && leaf.view instanceof MarkdownView) this.follow(leaf, true);
        else this.close();
      })
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (this.isOpen()) this.sections.forEach((sec) => sec.refresh(file));
      })
    );
    // A change to any note but the open one may add or remove a mention
    // of it, so the unlinked search is only repeated after one of those.
    this.otherEdits = 0;
    const edited = (file) => {
      if (!this.file || !file || file.path !== this.file.path) this.otherEdits++;
    };
    ['modify', 'create', 'delete', 'rename'].forEach((type) =>
      this.plugin.registerEvent(this.app.vault.on(type, edited))
    );
    this.plugin.registerDomEvent(document, 'keydown', (evt) => {
      if (evt.key === 'Escape' && this.isOpen()) this.close();
    });

    /*
     * Close on a click outside.
     *
     * pointerdown rather than click, so the panel goes before whatever
     * was clicked reacts. The exceptions all live on <body> rather than
     * inside the panel — the type menu, the property suggestions, and
     * the trigger itself, which does its own toggling — so a click on
     * any of them looks outside without being outside.
     */
    this.plugin.registerDomEvent(document, 'pointerdown', (evt) => {
      if (!this.isOpen()) return;
      // Any element — an icon is SVG, not HTML — and from any window.
      const el = evt.target;
      if (!el || el.nodeType !== 1 || typeof el.closest !== 'function') return;
      if (this.popupEl.contains(el)) return;
      if (
        el.closest(
          '.menu, .suggestion-container, .dr-suggest, .dr-props-trigger, .dr-strip-btn[data-action="properties"]'
        )
      ) {
        return;
      }
      this.close();
    });
    this.plugin.registerDomEvent(window, 'resize', () => this.reposition());
  }

  enable() {
    document.body.addClass('dr-props-active');
    // Only while the panel is actually listing them.
    document.body.toggleClass('dr-mentions-active', !!this.settings.showMentions);
    if (!this.popupEl || !this.popupEl.isConnected) {
      this.popupEl = document.body.createDiv({ cls: 'dr-props-popup' });
    }
    this.sync();
  }

  disable() {
    document.body.removeClass('dr-props-active');
    document.body.removeClass('dr-mentions-active');
    this.close();
    if (this.popupEl) {
      this.popupEl.remove();
      this.popupEl = null;
    }
    document.querySelectorAll('.dr-props-trigger').forEach((el) => el.remove());
    this.fitted = new WeakMap();
  }

  /**
   * Give every rendered markdown leaf a trigger. Deferred leaves
   * (Obsidian 1.7.2+) have no header yet, so they are skipped here and
   * picked up when they become active.
   */
  sync() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.isDeferred) return;
      if (!(leaf.view instanceof MarkdownView)) return;

      const known = this.fitted.get(leaf);
      if (known && known.isConnected) return;

      // The mobile header may have no left group; the actions take it.
      const header = leaf.containerEl.querySelector('.view-header');
      const left = header && header.querySelector('.view-header-left');
      const actions = header && header.querySelector('.view-actions');
      if (!left && !actions) return;

      const trigger = makeTrigger('dr-props-trigger', 'Properties', 'info', (el) => {
        this.anchor = null;
        this.toggle(leaf, el);
      });
      if (left) left.appendChild(trigger);
      else actions.prepend(trigger);
      this.fitted.set(leaf, trigger);
    });
  }

  /**
   * Opened from somewhere other than the header — the strip. The header's
   * trigger is hidden while the strip is up, and a hidden element has no
   * position, so the panel is placed against the button that asked.
   */
  toggleFrom(leaf, anchor) {
    const trigger = this.fitted.get(leaf);
    this.anchor = anchor;
    this.toggle(leaf, trigger && trigger.isConnected ? trigger : anchor);
  }

  /**
   * What the panel is about from a page: its note; or on a canvas, the
   * one card selected — a note's card the note, a text card itself.
   * { file } or { card }, { none: why not } or null.
   */
  targetOf(leaf) {
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    if (view instanceof MarkdownView) return view.file ? { file: view.file } : null;
    const canvas = view && view.canvas;
    if (!canvas) return null;
    const picked = pickedOnCanvas(canvas).filter((n) => n && cardElement(n) && typeof n.getData === 'function');
    if (picked.length !== 1) return { none: 'Select a card to see its properties.' };
    const node = picked[0];
    let data = {};
    try {
      data = node.getData() || {};
    } catch (err) {
      data = {};
    }
    if (data.type === 'file') {
      const file = typeof data.file === 'string' ? this.app.vault.getAbstractFileByPath(data.file) : null;
      if (file instanceof TFile && file.extension === 'md') return { file };
      return { none: 'Only notes and text cards have properties.' };
    }
    if ((data.type || 'text') === 'text' && typeof node.setText === 'function') return { card: node };
    return { none: 'Only notes and text cards have properties.' };
  }

  toggle(leaf, trigger) {
    const target = this.targetOf(leaf);
    if (target && target.none) {
      new Notice(target.none);
      return;
    }
    if (!target) return;
    if (this.isOpen() && ((target.file && this.file === target.file) || (target.card && this.card === target.card))) {
      this.close();
      return;
    }
    this.close();
    this.open(leaf, trigger, target);
  }

  /** Sections in the order they appear, subject to settings. */
  build() {
    const sections = [new PropertiesSection(this)];
    // What the features add: a note's relationships, where it's kept.
    (this.plugin.features || []).forEach((f) => {
      if (f.enabled && typeof f.panelSections === 'function') sections.push(...f.panelSections(this));
    });
    if (this.settings.showMentions) sections.push(new MentionsSection(this));
    return sections;
  }

  open(leaf, trigger, target) {
    if (!this.popupEl) return;
    target = target || this.targetOf(leaf);
    if (!target || target.none) return;

    this.leaf = leaf;
    if (target.card) {
      this.card = target.card;
      this.file = null;
      this.mountCard();
    } else {
      this.card = null;
      this.file = target.file;
      this.mount();
    }

    // Shown first: the panel is display:none until then, and an
    // unrendered element measures zero, defeating the edge clamp.
    this.popupEl.addClass('is-open');
    this.place(trigger);
    this.setTrigger(trigger);
  }

  mount() {
    this.popupEl.empty();
    this.renderHead();
    this.sections = this.build();
    this.sections.forEach((sec) => sec.mount(this.popupEl, this.file));
  }

  /** The note as an info sheet opens: see drawNoteHead. */
  renderHead() {
    drawNoteHead(this.plugin, this.popupEl, this.file);
  }

  /**
   * A text card's properties: each as a row to change or take away, and
   * a row to add one. They're kept at the top of its text, which the card
   * itself doesn't show.
   */
  mountCard() {
    const node = this.card;
    this.popupEl.empty();
    this.sections = [];
    const text = (node.getData() || {}).text || '';
    const parsed = cardFrontmatter(text);
    const head = this.popupEl.createDiv({ cls: 'dr-props-head' });
    const info = head.createDiv({ cls: 'dr-props-info' });
    const first = parsed.body.split('\n').map((l) => plainMarkdownLine(l)).find(Boolean);
    info.createDiv({ cls: 'dr-props-title', text: first || 'Card' });
    info.createDiv({ cls: 'dr-props-meta', text: 'A card on this canvas' });
    const list = this.popupEl.createDiv({ cls: 'dr-card-props' });
    if (!parsed.data) {
      list.createDiv({ cls: 'dr-card-props-note', text: 'Its properties can’t be read: look at the lines between --- at its top.' });
      return;
    }
    const keys = Object.keys(parsed.data);
    keys.forEach((key) => this.cardRow(list, key, parsed.data[key]));
    if (!keys.length) list.createDiv({ cls: 'dr-card-props-note', text: 'No properties yet.' });
    const add = this.popupEl.createDiv({ cls: 'dr-card-props-add' });
    const keyIn = add.createEl('input', { type: 'text', cls: 'dr-card-props-key-in' });
    keyIn.placeholder = 'Property';
    const valIn = add.createEl('input', { type: 'text', cls: 'dr-card-props-value' });
    valIn.placeholder = 'Value';
    const button = add.createEl('button', { text: 'Add' });
    const commit = () => {
      const key = keyIn.value.trim();
      if (key) this.setCardProperty(key, cardValue(valIn.value, parsed.data[key]));
    };
    button.addEventListener('click', commit);
    [keyIn, valIn].forEach((input) =>
      input.addEventListener('keydown', (evt) => {
        if (evt.key !== 'Enter') return;
        evt.preventDefault();
        commit();
      })
    );
  }

  cardRow(list, key, value) {
    const row = list.createDiv({ cls: 'dr-card-props-row' });
    row.createDiv({ cls: 'dr-card-props-key', text: key });
    const input = row.createEl('input', { type: 'text', cls: 'dr-card-props-value' });
    input.value = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value);
    input.addEventListener('change', () => this.setCardProperty(key, cardValue(input.value, value)));
    const remove = row.createDiv({ cls: 'clickable-icon dr-card-props-remove' });
    remove.setAttribute('aria-label', 'Remove');
    setIcon(remove, 'x');
    remove.addEventListener('click', () => this.setCardProperty(key, undefined));
  }

  /** A text card's property set, or taken away (undefined), at the top of its text. Saved, a step of Undo. */
  setCardProperty(key, value) {
    const node = this.card;
    if (!node) return;
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
    this.mountCard();
    if (this.trigger && this.trigger.isConnected) this.place(this.trigger);
  }

  /** Switching notes moves the panel rather than closing it. */
  follow(leaf, force) {
    if (!this.isOpen()) return;
    if (!force && this.leaf === leaf) return;

    if (!leaf || !(leaf.view instanceof MarkdownView) || !leaf.view.file) {
      this.close();
      return;
    }

    this.file = leaf.view.file;
    this.leaf = leaf;
    this.mount();

    const trigger = this.fitted.get(leaf);
    if (trigger && trigger.isConnected) {
      this.setTrigger(trigger);
      this.place(trigger);
    }
  }

  /** Move the active marker and aria state onto a different trigger. */
  setTrigger(trigger) {
    document.querySelectorAll('.dr-props-trigger').forEach((el) => {
      el.removeClass('is-active');
      el.setAttribute('aria-expanded', 'false');
    });
    this.trigger = trigger;
    trigger.addClass('is-active');
    trigger.setAttribute('aria-expanded', 'true');
  }

  /**
   * Anchor under the trigger, flipping up when there's no room below.
   * On a phone it spans the screen, as a sheet would; the width comes
   * from the stylesheet.
   */
  place(trigger) {
    let r = trigger.getBoundingClientRect();
    if (!r.width && !r.height && this.anchor && this.anchor.isConnected) {
      r = this.anchor.getBoundingClientRect();
    }
    const el = this.popupEl;
    el.style.left = Platform.isPhone
      ? '8px'
      : `${Math.max(8, Math.min(r.left, window.innerWidth - 8 - el.offsetWidth))}px`;

    const below = window.innerHeight - r.bottom;
    if (below < 220 && r.top > below) {
      el.style.top = '';
      el.style.bottom = `${window.innerHeight - r.top + 6}px`;
    } else {
      el.style.bottom = '';
      el.style.top = `${r.bottom + 6}px`;
    }
  }

  reposition() {
    if (this.isOpen() && this.trigger && this.trigger.isConnected) {
      this.place(this.trigger);
    }
  }

  close() {
    const wasInside =
      this.popupEl && this.popupEl.contains(document.activeElement);

    this.sections.forEach((sec) => sec.destroy());
    this.sections = [];
    this.file = null;
    this.card = null;
    this.leaf = null;

    // Each section takes its own suggestion lists with it; other
    // features' lists, such as the graph's, are theirs to keep.

    if (this.popupEl) {
      this.popupEl.removeClass('is-open');
      this.popupEl.empty();
    }

    document.querySelectorAll('.dr-props-trigger').forEach((el) => {
      el.removeClass('is-active');
      el.setAttribute('aria-expanded', 'false');
    });

    // Only reclaim focus if the panel held it; otherwise closing on a
    // click elsewhere would yank the caret out of whatever was clicked.
    if (wasInside && this.trigger && this.trigger.isConnected) {
      this.trigger.focus();
    }
    this.trigger = null;
  }

  isOpen() {
    return !!this.popupEl && this.popupEl.hasClass('is-open');
  }
}

PropertiesPanel.settingKey = 'propertiesDropdown';

