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

import { MarkdownView, Notice, Platform, Setting } from 'obsidian';
import { INSPECTOR_VIEW } from '../core/020-constants.js';
import { makeTrigger } from '../core/040-helpers-sorting.js';
import { knownPropertyNames } from '../core/045-helpers-properties.js';
import { Feature } from '../core/080-feature.js';
import { hostsPanel } from '../core/084-workspace-coordinator.js';
import { PropertiesSection } from './160-panel-properties.js';
import { MentionsSection } from './170-panel-native.js';
import { inspectableOf } from './178-inspectables.js';
import { RetiredView } from './179-panel-dock.js';
import { drSheetIn } from '../ui/229-components.js';

const EMPTY_TEXT = 'Pick a note or a collection to see its properties.';
const OFF_TEXT = 'Turn on “Properties button” in settings to see properties here.';

export class PropertiesPanel extends Feature {
  constructor(plugin) {
    super(plugin);
    this.popupEl = null;
    this.file = null;
    this.leaf = null;
    this.trigger = null;
    this.sections = [];
    this.shown = null;
    // The library's pane the panel is in, when it's docked there; and
    // the pane it goes back to once it's done floating over a note.
    this.dockView = null;
    this.pane = null;
    // leaf -> its trigger element, so a fitted leaf costs a lookup
    // rather than a querySelector. Weak, so closing a tab drops it.
    this.fitted = new WeakMap();
  }

  settingsSchema() {
    return [
      {
        key: 'propertiesDropdown',
        name: 'Properties button',
        desc: 'A button in each note’s header that shows its properties in a panel under it, or as a sheet on a phone.',
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
    this.plugin.registerView(INSPECTOR_VIEW, (leaf) => new RetiredView(leaf, INSPECTOR_VIEW));
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (!this.enabled) return;
        // Back to a library page with a pane: the panel goes back into it, unless it's floating over a note.
        const pane = leaf && leaf.view && leaf.view.inspectorPane;
        if (pane && pane !== this.dockView && !(this.isOpen() && !this.dockView)) this.dock(pane);
        else if (!this.dockView) this.follow(leaf);
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
    // Floating, it follows what its tab says it's about: another node on a map, another card.
    this.plugin.register(this.plugin.coordinator.onChange((snap) => this.followFloat(snap)));
    // Docked in the library's pane, it draws what's picked there.
    this.plugin.register(this.plugin.selection.onChange((item) => this.showPick(item)));
    this.plugin.registerEvent(this.app.workspace.on('design-redux:pane-open', (pane) => this.paneOpened(pane)));
    this.plugin.registerEvent(this.app.workspace.on('design-redux:pane-close', (pane) => this.paneClosed(pane)));
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
    if (this.dockView) this.dockView.showEmpty(OFF_TEXT, this.toSettings());
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
    // Floating under the button, out of the library's pane while it does; on a phone, a sheet.
    if (this.dockView) {
      if (leaf === this.dockView.leaf) return;
      this.undock(this.dockView, true);
    } else if (this.isOpen() && ((target.file && this.file === target.file) || (target.card && this.card === target.card))) {
      this.close();
      return;
    }
    this.close(false);
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
    this.point(target);
    this.mount();
    if (this.dockView) {
      this.popupEl.addClass('is-open');
      this.dockView.showEmpty('');
      return;
    }

    // Shown first: the panel is display:none until then, and an
    // unrendered element measures zero, defeating the edge clamp.
    this.popupEl.addClass('is-open');
    this.place(trigger);
    drSheetIn(this.popupEl, trigger);
    this.setTrigger(trigger);
  }

  /** Pointed at `target`: what it is, drawn by mount. */
  point(target) {
    this.shown = inspectableOf(this.plugin, target);
    this.picked = !!target.picked;
    this.card = target.card || null;
    this.folder = target.folder || null;
    this.file = this.shown.file;
  }

  /** What it's pointed at, drawn afresh. */
  mount() {
    this.sections.forEach((sec) => sec.destroy());
    this.popupEl.empty();
    this.sections = this.shown.draw(this, this.popupEl);
  }

  /** Changed from inside — a card's property — so drawn again where it is. */
  redraw() {
    if (!this.shown || !this.isOpen()) return;
    this.mount();
    this.reposition();
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

    this.point({ file: target && target.file ? target.file : leaf.view.file });
    this.leaf = leaf;
    this.mount();

    const trigger = this.fitted.get(leaf);
    if (trigger && trigger.isConnected) {
      this.setTrigger(trigger);
      this.place(trigger);
    }
  }

  /** Floating over `snap.leaf`, what it shows moved on to what that tab is now about. */
  followFloat(snap) {
    if (this.dockView || !this.isOpen() || !snap.target || !snap.leaf || snap.leaf !== this.leaf) return;
    if (this.shown && this.shown.is(snap.target)) return;
    this.point(snap.target);
    this.mount();
    this.reposition();
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

  /** Closed; floating, it goes back into the library's pane, if there's one, unless `redock` is false. */
  close(redock = true) {
    const wasInside =
      this.popupEl && this.popupEl.contains(document.activeElement);

    this.sections.forEach((sec) => sec.destroy());
    this.sections = [];
    this.shown = null;
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
    if (this.dockView) this.dockView.showEmpty(EMPTY_TEXT);
    else if (redock && this.pane && this.pane.contentEl.isConnected && this.popupEl) this.dock(this.pane);
  }

  /** Turned off, the way to turn it on. */
  toSettings() {
    return { label: 'Open settings', run: () => this.plugin.openSettingsAt('propertiesDropdown') };
  }

  /** A file or folder deleted: if it's what's shown, it's let go of. */
  forget(file) {
    if (!this.isOpen() || !file || (file !== this.file && file !== this.folder)) return;
    this.close();
  }

  /** Docked, it draws what's picked in the library: a note or an album. Nothing picked, it says so. */
  showPick(item) {
    if (!this.dockView || !this.popupEl) return;
    const target =
      item && item.file && item.file.extension === 'md' ? { file: item.file, picked: true } : item && item.folder ? { folder: item.folder } : null;
    if (target) this.showDocked(this.dockView.leaf, target);
    else if (this.isOpen()) this.close();
    else this.dockView.showEmpty(EMPTY_TEXT);
  }

  /** A library page's pane opened: the panel goes in, unless it's floating over a note, when it goes in after. */
  paneOpened(pane) {
    this.pane = pane;
    if (this.dockView || !this.isOpen()) this.dock(pane);
    else pane.showEmpty(EMPTY_TEXT);
  }

  /** A pane closed, or its page did: the panel leaves it. */
  paneClosed(pane) {
    if (this.pane === pane) this.pane = null;
    this.undock(pane);
  }

  /** Into a library page's pane: shown there from now on, starting with what's picked. */
  dock(pane) {
    if (this.dockView && this.dockView !== pane) this.dockView.showEmpty(EMPTY_TEXT);
    this.dockView = pane;
    this.pane = pane;
    if (!this.popupEl) {
      pane.showEmpty(OFF_TEXT, this.toSettings());
      return;
    }
    this.close();
    this.popupEl.style.left = this.popupEl.style.top = this.popupEl.style.bottom = '';
    this.popupEl.addClass('is-docked');
    pane.contentEl.appendChild(this.popupEl);
    this.showPick(this.plugin.selection.get());
  }

  /** Out of the pane: a popup again. Kept, it goes back in when it's done floating. */
  undock(pane, keep = false) {
    if (this.dockView !== pane) return;
    this.close(false);
    this.dockView = null;
    if (!keep && this.pane === pane) this.pane = null;
    if (this.popupEl) {
      this.popupEl.removeClass('is-docked');
      document.body.appendChild(this.popupEl);
    }
  }

  /** Docked, show `target` — unless it already is, so what's being typed in it stays. */
  showDocked(leaf, target) {
    // A note picked is drawn with what the library can do with it, so it's not the same as that note open.
    if (this.isOpen() && this.shown && this.shown.is(target)) {
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

