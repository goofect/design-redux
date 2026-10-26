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

import { MarkdownView, Notice, parseYaml, Platform, setIcon, Setting, stringifyYaml } from 'obsidian';
import { BROWSE_VIEW, INSPECTOR_VIEW } from '../core/020-constants.js';
import { drawNoteArt, leadProperty } from '../core/030-helpers-art.js';
import { makeTrigger, relativeDay } from '../core/040-helpers-sorting.js';
import { knownPropertyNames } from '../core/045-helpers-properties.js';
import { plainMarkdownLine } from '../core/047-helpers-text.js';
import { openInspector } from '../core/076-selection.js';
import { requestCanvasSave } from '../core/079-canvas-adapter.js';
import { Feature } from '../core/080-feature.js';
import { hostsPanel, originLabel } from '../core/084-workspace-coordinator.js';
import { PropertiesSection } from './160-panel-properties.js';
import { MentionsSection } from './170-panel-native.js';
import { PanelDockView } from './179-panel-dock.js';
import { drSheetIn } from '../ui/229-components.js';

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

/** Whether a view says what the panel is about itself: a mind map does. */
const EMPTY_TEXT = 'Open or pick a note to see its properties.';
const OFF_TEXT = 'Turn on “Properties button” in settings to see properties here.';

export class PropertiesPanel extends Feature {
  constructor(plugin) {
    super(plugin);
    this.popupEl = null;
    this.file = null;
    this.leaf = null;
    this.trigger = null;
    this.sections = [];
    // The sidebar view the panel is in, when it's docked there.
    this.dockView = null;
    // leaf -> its trigger element, so a fitted leaf costs a lookup
    // rather than a querySelector. Weak, so closing a tab drops it.
    this.fitted = new WeakMap();
  }

  settingsSchema() {
    return [
      {
        key: 'propertiesDropdown',
        name: 'Properties button',
        desc: 'A button in each note’s header that shows its properties in the inspector, or as a sheet on a phone.',
      },
      {
        key: 'hideNativeProperties',
        name: 'Hide the note’s own properties',
        desc: 'Obsidian’s properties block at the top of a note, hidden while the panel shows them.',
        showIf: 'propertiesDropdown',
      },
      {
        key: 'panelPropertiesView',
        type: 'dropdown',
        name: 'Properties shown',
        desc: 'The main ones, with the rest a press away, or all of them.',
        options: { compact: 'The main ones', all: 'All' },
        showIf: 'propertiesDropdown',
      },
      {
        key: 'panelPrimaryProps',
        type: 'custom',
        name: 'Main properties',
        showIf: 'propertiesDropdown',
        render: (containerEl) => this.renderMainChoice(containerEl),
      },
      {
        key: 'panelPropertyGroups',
        type: 'dropdown',
        name: 'Group properties',
        desc: 'Under the groups below — only how they show; the note is left as it is. Properties no group names go under Other.',
        options: { off: 'No', on: 'Yes' },
        showIf: 'propertiesDropdown',
      },
      {
        key: 'panelGroupList',
        type: 'custom',
        name: 'Property groups',
        showIf: (s) => s.propertiesDropdown && s.panelPropertyGroups === 'on',
        render: (containerEl) => this.renderGroupChoice(containerEl),
      },
      {
        key: 'showMentions',
        name: 'Mentions',
        desc: 'Below the properties, list notes that link to or name this one.',
        showIf: 'propertiesDropdown',
      },
    ];
  }

  /** A list of property names to choose from, for a field in the settings window. */
  nameChoices(doc, block) {
    const list = block.appendChild(doc.createElement('datalist'));
    list.id = `dr-names-${Math.random().toString(36).slice(2)}`;
    knownPropertyNames(this.app).forEach((n) => {
      const o = list.appendChild(doc.createElement('option'));
      o.value = n;
    });
    return list.id;
  }

  /** Settings: the main properties, in the order they show — each moved or taken off, others added by name. */
  renderMainChoice(containerEl) {
    const doc = containerEl.ownerDocument;
    const block = containerEl.appendChild(doc.createElement('div'));
    block.className = 'dr-main-props';
    const draw = () => {
      block.empty();
      const names = String(this.settings.panelPrimaryProps || '').split(',').map((n) => n.trim()).filter(Boolean);
      const save = () => {
        this.settings.panelPrimaryProps = names.join(', ');
        this.plugin.saveSettings();
        draw();
      };
      new Setting(block).setName('Main properties').setDesc('What a note shows first — and alone, while only the main ones show — in this order.').setHeading();
      names.forEach((name, i) => {
        const row = new Setting(block).setName(name).setClass('dr-main-prop');
        row.addExtraButton((b) => b.setIcon('arrow-up').setTooltip('Move up').setDisabled(i === 0).onClick(() => i > 0 && (names.splice(i - 1, 0, names.splice(i, 1)[0]), save())));
        row.addExtraButton((b) => b.setIcon('arrow-down').setTooltip('Move down').setDisabled(i === names.length - 1).onClick(() => i < names.length - 1 && (names.splice(i + 1, 0, names.splice(i, 1)[0]), save())));
        row.addExtraButton((b) => b.setIcon('x').setTooltip('Take off').onClick(() => (names.splice(i, 1), save())));
      });
      const listId = this.nameChoices(doc, block);
      new Setting(block).setName('Add a main property').addText((t) => {
        t.setPlaceholder('Search properties…');
        t.inputEl.setAttribute('list', listId);
        t.inputEl.addEventListener('keydown', (evt) => {
          if (evt.key !== 'Enter') return;
          const name = t.getValue().trim();
          if (!name || names.some((n) => n.toLowerCase() === name.toLowerCase())) return;
          names.push(name);
          save();
        });
      });
    };
    draw();
  }

  /** Settings: the groups, each a title and the properties under it, in the order they show. */
  renderGroupChoice(containerEl) {
    const doc = containerEl.ownerDocument;
    const block = containerEl.appendChild(doc.createElement('div'));
    block.className = 'dr-prop-groups';
    const draw = () => {
      block.empty();
      const groups = (Array.isArray(this.settings.panelGroupList) ? this.settings.panelGroupList : []).map((g) => ({ title: g.title || '', keys: g.keys || '' }));
      const save = (redraw) => {
        this.settings.panelGroupList = groups;
        this.plugin.saveSettings();
        if (redraw) draw();
      };
      const listId = this.nameChoices(doc, block);
      groups.forEach((g, i) => {
        const row = new Setting(block).setClass('dr-prop-group');
        row.addText((t) => t.setPlaceholder('Group').setValue(g.title).onChange((v) => ((g.title = v), save())));
        row.addText((t) => {
          t.setPlaceholder('Properties, by commas').setValue(g.keys).onChange((v) => ((g.keys = v), save()));
          t.inputEl.setAttribute('list', listId);
          t.inputEl.addClass('dr-prop-group-keys');
        });
        row.addExtraButton((b) => b.setIcon('arrow-up').setTooltip('Move up').setDisabled(i === 0).onClick(() => i > 0 && (groups.splice(i - 1, 0, groups.splice(i, 1)[0]), save(true))));
        row.addExtraButton((b) => b.setIcon('x').setTooltip('Remove the group').onClick(() => (groups.splice(i, 1), save(true))));
      });
      new Setting(block).addButton((b) => b.setButtonText('Add group').onClick(() => (groups.push({ title: '', keys: '' }), save(true))));
    };
    draw();
  }

  actions() {
    return [
      {
        id: 'open-properties',
        name: 'Open properties',
        icon: 'list',
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

  registerTypes() {
    this.plugin.registerView(INSPECTOR_VIEW, (leaf) => new PanelDockView(leaf, this));
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (this.enabled && !this.dockView) this.follow(leaf);
      })
    );
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        // Fires when a leaf loads a different file, which
        // active-leaf-change does not cover. Docked, the coordinator follows.
        if (!this.isOpen() || this.dockView || !file || file === this.file) return;
        const leaf = this.app.workspace.activeLeaf;
        if (leaf && (leaf.view instanceof MarkdownView || hostsPanel(leaf.view))) this.follow(leaf, true);
        else this.close();
      })
    );
    // Docked, it draws what the coordinator says the inspector is about: the note worked in, a pick, a card, a map.
    this.plugin.register(this.plugin.coordinator.onChange((snap) => this.showSnapshot(snap)));
    this.plugin.registerEvent(this.app.workspace.on('design-redux:open-panel', (leaf, anchor) => this.enabled && this.toggleFrom(leaf, anchor)));
    this.plugin.registerEvent(
      this.app.workspace.on('design-redux:panel-changed', (file) => {
        if (this.isOpen() && file === this.file) this.sections.forEach((sec) => sec.refresh(file));
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
    // What it shows deleted, it lets go of — pinned or not.
    this.plugin.registerEvent(
      this.app.vault.on('delete', (file) => this.forget(file))
    );
    ['modify', 'create', 'delete', 'rename'].forEach((type) =>
      this.plugin.registerEvent(this.app.vault.on(type, edited))
    );
    this.plugin.registerDomEvent(document, 'keydown', (evt) => {
      if (evt.key === 'Escape' && this.isOpen() && !this.dockView) this.close();
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
      if (!this.isOpen() || this.dockView) return;
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
    document.body.toggleClass('dr-props-hide-native', !!this.settings.hideNativeProperties);
    // Only while the panel is actually listing them.
    document.body.toggleClass('dr-mentions-active', !!this.settings.showMentions);
    if (!this.popupEl || !this.popupEl.isConnected) {
      this.popupEl = document.body.createDiv({ cls: 'dr-props-popup' });
      if (this.dockView) this.dock(this.dockView);
    }
    this.sync();
  }

  disable() {
    document.body.removeClass('dr-props-active');
    document.body.removeClass('dr-props-hide-native');
    document.body.removeClass('dr-mentions-active');
    this.close();
    if (this.popupEl) {
      this.popupEl.remove();
      this.popupEl = null;
    }
    if (this.dockView) this.dockView.showEmpty(OFF_TEXT);
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

  /** What the panel is about from a page: the coordinator's answer. */
  targetOf(leaf) {
    return this.plugin.coordinator.targetOf(leaf);
  }

  toggle(leaf, trigger) {
    const target = this.targetOf(leaf);
    if (target && target.none) {
      new Notice(target.none);
      return;
    }
    if (!target) return;
    // On a computer it docks, as an inspector; on a phone it's a sheet.
    if (!this.dockView && !Platform.isPhone) {
      openInspector(this.app).then(() => this.showAsked(leaf, target));
      return;
    }
    if (this.dockView) {
      this.app.workspace.revealLeaf(this.dockView.leaf);
      this.showAsked(leaf, target);
      return;
    }
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
    this.picked = !!target.picked;
    if (target.card) {
      this.card = target.card;
      this.folder = null;
      this.file = null;
      this.mountCard();
    } else if (target.folder) {
      this.card = null;
      this.folder = target.folder;
      this.mountFolder();
    } else {
      this.card = null;
      this.folder = null;
      this.file = target.file;
      this.mount();
    }
    if (this.dockView) {
      this.popupEl.addClass('is-open');
      this.dockView.showEmpty('');
      this.dockView.showOrigin(originLabel(this.plugin.coordinator.originOf(leaf, target)), this.pinned);
      return;
    }

    // Shown first: the panel is display:none until then, and an
    // unrendered element measures zero, defeating the edge clamp.
    this.popupEl.addClass('is-open');
    this.place(trigger);
    drSheetIn(this.popupEl, trigger);
    this.setTrigger(trigger);
  }

  mount() {
    this.popupEl.empty();
    this.renderHead();
    // Picked in the library rather than open: what can be done with it, there.
    const view = this.picked ? this.browseView() : null;
    if (view && typeof view.inspectNoteActions === 'function') view.inspectNoteActions(this.popupEl, this.file);
    this.sections = this.build();
    this.sections.forEach((sec) => sec.mount(this.popupEl, this.file));
  }

  /** An album picked in the library: what it is, as the library tells it, then its folder note's properties. */
  mountFolder() {
    const folder = this.folder;
    this.popupEl.empty();
    const brief = this.popupEl.createDiv({ cls: 'dr-inspector-brief' });
    const view = this.browseView();
    if (view) view.previewAlbum(brief, folder);
    else brief.createDiv({ cls: 'dr-preview-title', text: folder.name });
    const note = typeof this.plugin.folderNote === 'function' ? this.plugin.folderNote(folder) : null;
    this.file = note || null;
    this.sections = note ? this.build() : [];
    this.sections.forEach((sec) => sec.mount(this.popupEl, note));
  }

  /** A page of the library — the one last worked in — to draw what it picked. */
  browseView() {
    const ws = this.app.workspace;
    const leaves = ws.getLeavesOfType(BROWSE_VIEW);
    const recent = typeof ws.getMostRecentLeaf === 'function' ? ws.getMostRecentLeaf() : null;
    const leaf = recent && leaves.includes(recent) ? recent : leaves[0];
    return leaf && leaf.view && typeof leaf.view.previewAlbum === 'function' ? leaf.view : null;
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
    if (this.dockView || !this.isOpen()) return;
    if (!force && this.leaf === leaf) return;

    const target = leaf && hostsPanel(leaf.view) ? leaf.view.panelTarget() : null;
    if (!leaf || !(leaf.view instanceof MarkdownView || (target && target.file)) || !leaf.view.file) {
      this.close();
      return;
    }

    this.file = target && target.file ? target.file : leaf.view.file;
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
    this.folder = null;
    this.picked = false;
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
    if (this.dockView) {
      this.dockView.showEmpty(EMPTY_TEXT);
      this.dockView.showOrigin('', this.pinned);
    }
  }

  /** A file or folder deleted: if it's what's shown, it's let go of. (Docked, the coordinator lets go, pinned or not.) */
  forget(file) {
    if (!this.isOpen() || !file || (file !== this.file && file !== this.folder)) return;
    this.close();
  }

  /** Pinned, the coordinator keeps what it shows while notes open and picks change. */
  get pinned() {
    return !!(this.plugin.coordinator && this.plugin.coordinator.state.pinned);
  }

  togglePin() {
    this.plugin.coordinator.pin(!this.pinned);
  }

  /** Docked, it draws the coordinator's snapshot: nothing to show, it shows that. */
  showSnapshot(snap) {
    if (!this.dockView || !this.popupEl) return;
    if (!snap.target) {
      if (this.isOpen()) this.close();
      else this.dockView.showOrigin('', false);
      return;
    }
    this.showDocked(snap.leaf, snap.target);
    this.dockView.showOrigin(originLabel(snap.origin), snap.pinned);
  }

  /** Asked for outright, from the Properties button: shown, and the coordinator told. */
  showAsked(leaf, target) {
    if (!this.dockView) return;
    this.plugin.coordinator.show(leaf, target);
    this.showSnapshot(this.plugin.coordinator.snapshot());
  }

  /** Into the sidebar view: shown there from now on, starting with the note last worked in. */
  dock(view) {
    this.dockView = view;
    if (!this.popupEl) {
      view.showEmpty(OFF_TEXT);
      return;
    }
    this.close();
    this.popupEl.style.left = this.popupEl.style.top = this.popupEl.style.bottom = '';
    this.popupEl.addClass('is-docked');
    view.contentEl.appendChild(this.popupEl);
    const ws = this.app.workspace;
    this.showSnapshot(this.plugin.coordinator.look(typeof ws.getMostRecentLeaf === 'function' ? ws.getMostRecentLeaf() : ws.activeLeaf));
  }

  /** The sidebar view closed: a popup again. */
  undock(view) {
    if (this.dockView !== view) return;
    this.close();
    this.dockView = null;
    this.plugin.coordinator.pin(false);
    if (this.popupEl) {
      this.popupEl.removeClass('is-docked');
      document.body.appendChild(this.popupEl);
    }
  }

  /** Docked, show `target` — unless it already is, so what's being typed in it stays. */
  showDocked(leaf, target) {
    // A note picked is drawn with what the library can do with it, so it's not the same as that note open.
    const same = target.folder ? target.folder === this.folder : !this.folder && !!target.picked === !!this.picked && ((target.file && target.file === this.file) || (target.card && target.card === this.card));
    if (this.isOpen() && same) {
      if (leaf) this.leaf = leaf;
      return;
    }
    this.sections.forEach((sec) => sec.destroy());
    this.sections = [];
    this.open(leaf, null, target);
  }

  isOpen() {
    return !!this.popupEl && this.popupEl.hasClass('is-open');
  }
}

PropertiesPanel.settingKey = 'propertiesDropdown';

