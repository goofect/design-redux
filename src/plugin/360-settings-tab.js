/*
 * Where each setting sits: six tabs, by what they're for, of short sections. Features still
 * own their rows — name, control, description; this only decides where
 * each goes. A row shown only while another in its section is on sits
 * indented beneath that one.
 */

import { AbstractInputSuggest, Notice, Platform, PluginSettingTab, setIcon, Setting, TFolder } from 'obsidian';
import { DEFAULTS } from '../core/020-constants.js';
import { byName } from '../core/030-helpers-art.js';
import { normalHex } from '../core/031-colours.js';
import { roveFocus } from '../core/040-helpers-sorting.js';
import { knownPropertyNames } from '../core/045-helpers-properties.js';
import { confirmAction } from '../ui/230-pickers.js';

export const SETTINGS_TABS = [
  {
    id: 'library',
    title: 'Library',
    sections: [
      { switch: 'library', keys: ['library', 'libraryLayout', 'homePath'], more: ['homeShelves', 'inspector', 'inspectorClick', 'hideEmptyFolders', 'sidebarDrop'] },
      { title: 'Lists', keys: ['defaultSort'], more: ['albumSortMemory', 'typeToJump'] },
      { title: 'Screens', keys: ['searchNoteText'], more: ['albumColumns', 'albumExcerpts', 'albumStillToWrite', 'albumNestBy', 'trackLength', 'tileGroups', 'categoryProperty'] },
      { title: 'Collections', keys: ['smartAlbums'], more: ['albumStructure', 'albumRollups', 'albumRecents', 'libraryCheck', 'libraryInbox', 'albumRefactor'] },
      { title: 'Folder notes', keys: ['hideFolderNotes'], more: ['folderNoteName'] },
      { title: 'Covers', keys: ['coverDrop'], more: ['coverProperty', 'coverFromFirstImage', 'coverFromFolder', 'coverFallback', 'coverPrint'] },
      { title: 'Advanced', advanced: true, keys: [], more: ['fromReadingDays', 'librarySections', 'discNoteLimit', 'albumNoteLimit', 'tableColumns', 'albumKeyNames', 'rollupDateKey', 'thinNoteWords', 'generatedCoverColor'] },
    ],
  },
  {
    id: 'note',
    title: 'Note',
    sections: [
      { title: 'The note page', switch: 'notePage', keys: ['notePage', 'notePageShelves', 'readingHistory'], more: ['notePageTint', 'notePageChips', 'rememberPlace'] },
      { title: 'Reading outline', keys: ['readingOutline'] },
      { title: 'Study', switch: 'studyEnabled', keys: ['studyEnabled'], more: ['studyAlbums', 'studyHighlights'] },
      { title: 'Relationships', switch: 'knowledge', keys: ['knowledge'], more: ['canvasRelationTypes', 'knowledgeCheck'] },
      { title: 'Lists', keys: [], more: ['letterLists', 'romanLists'] },
      { title: 'Superscript and subscript', keys: [], more: ['scripts'] },
      { title: 'Properties', keys: ['propertiesDropdown'], more: ['panelPropertiesView', 'panelPrimaryProps', 'panelPropertyGroups', 'propertyForAlbum', 'propertySchemaMarks', 'propertyInspector', 'propertyInlineEdit', 'propertyLinks', 'propertyValueChips', 'propertyDueChips', 'propertyRulesOn', 'showMentions', 'panelRelationships', 'panelPlaces'] },
      { title: 'Links', keys: ['quietLinks'] },
      { title: 'Footnotes', switch: 'footnotes', keys: ['footnotes'], more: ['footnotesAside', 'footnoteOrder'] },
      { title: 'Images', keys: [], more: ['routeImages'] },
      { title: 'Advanced', advanced: true, keys: [], more: ['outlineWordCounts', 'studyLadder', 'studyDailyMax', 'studyCardMax', 'knowledgeTreeKinds', 'knowledgeBroader', 'scriptSyntax', 'autoOrdinals', 'panelGroupList', 'propertyHistoryLimit', 'propertyDueKeys', 'propertyRulesDryRun', 'imageFolder'] },
    ],
  },
  {
    id: 'maps',
    title: 'Maps',
    sections: [
      { title: 'Maps', desc: 'For every map: what a new one is, and how far apart things are put.', keys: ['mindmapDefaultFormat', 'canvasSpacing'], more: ['mindmapLayout'] },
      { title: 'Mind maps', switch: 'mindmaps', keys: ['mindmaps', 'mindmapTakeover'], more: ['mindmapGlide', 'mindmapPeek', 'mindmapLegend', 'mindmapDepth', 'mindmapColourBy', 'mindmapPins', 'mindmapViews', 'mindmapRelations', 'mindmapArguments', 'mindmapBranchNotes', 'mindmapCheck', 'mindmapCompare', 'mindmapVaultMap', 'mindmapMinimap', 'mindmapPresent', 'mindmapPresentSpotlight', 'mindmapPresentNotes', 'mindmapAlbumMap', 'mindmapConvert', 'mindmapTasks', 'mindmapOtherViews', 'mindmapLinkedCards', 'mindmapNodePanel', 'mindmapFilters', 'mindmapEmbeds', 'mindmapQueries', 'mindmapRichNodes', 'mindmapTheme'] },
      { title: 'Advanced', advanced: true, keys: [], more: ['mindmapTemplateFolder', 'presentDimLevel', 'albumMapAuto', 'albumMapWritesParent', 'mindmapHistory'] },
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    sections: [
      { title: 'Modes', keys: ['workspaceModes'] },
      { title: 'Page', switch: 'contextStrip', keys: ['contextStrip', 'onePage'], more: ['stripPlace', 'stripDetail', 'stripProgress', 'singleArea'] },
      { title: 'Sidebar header', keys: [], more: ['navDropdown', 'ribbonInMenu', 'settingsInHeader'] },
      { title: 'Graph', keys: ['graphProperties'], more: ['graphRoutes'] },
      { title: 'Links', keys: ['quietLinks'] },
      { title: 'Advanced', advanced: true, keys: [], more: ['graphRouteProperty', 'compatibility'] },
    ],
  },
];

/** The rows above every tab: how the plugin looks, wherever you are. */
export const LOOK_KEYS = ['look', 'lookScope', 'glassPanels', 'albumProgressRing', 'gridDensity', 'artworkSize', 'iconMode'];

/** Where each setting sat before the four places, so a search for the old tab's name still finds it. */
/** Every key a section holds: its front rows, then those folded under them. */
export const sectionKeys = (sec) => (sec.keys || []).concat(sec.more || []);

/** A section's name for remembering whether it's open. */
const sectionId = (tab, sec) => `${tab.id}:${sec.title || (sec.keys || [])[0] || ''}`;

export const FORMER_TABS = {
  Appearance: ['look', 'lookScope', 'glassPanels', 'albumProgressRing', 'gridDensity', 'artworkSize'],
  Library: ['library', 'libraryLayout', 'homePath', 'homeShelves', 'fromReadingDays', 'inspector', 'inspectorClick', 'hideEmptyFolders', 'sidebarDrop', 'librarySections', 'defaultSort', 'albumSortMemory', 'typeToJump', 'discNoteLimit', 'albumNoteLimit', 'albumColumns', 'albumExcerpts', 'albumStillToWrite', 'albumNestBy', 'trackLength', 'tileGroups', 'tableColumns', 'categoryProperty', 'searchNoteText', 'albumStructure', 'albumKeyNames', 'albumRollups', 'rollupDateKey', 'albumRecents', 'smartAlbums', 'libraryCheck', 'libraryInbox', 'thinNoteWords', 'albumRefactor', 'folderNoteName', 'hideFolderNotes', 'coverProperty', 'coverDrop', 'coverFromFirstImage', 'coverFromFolder', 'coverFallback', 'generatedCoverColor', 'coverPrint'],
  Notes: ['notePage', 'notePageTint', 'notePageChips', 'notePageShelves', 'readingHistory', 'rememberPlace', 'readingOutline', 'outlineWordCounts', 'studyEnabled', 'studyLadder', 'studyDailyMax', 'studyAlbums', 'studyHighlights', 'studyCardMax', 'knowledge', 'canvasRelationTypes', 'knowledgeCheck', 'knowledgeTreeKinds', 'knowledgeBroader', 'letterLists', 'romanLists', 'scripts', 'scriptSyntax', 'autoOrdinals', 'propertiesDropdown', 'panelPropertiesView', 'panelPrimaryProps', 'panelPropertyGroups', 'panelGroupList', 'propertyForAlbum', 'propertySchemaMarks', 'propertyInspector', 'propertyInlineEdit', 'propertyLinks', 'propertyValueChips', 'propertyHistoryLimit', 'propertyDueChips', 'propertyDueKeys', 'propertyRulesOn', 'propertyRulesDryRun', 'showMentions', 'panelRelationships', 'panelPlaces', 'quietLinks', 'footnotes', 'footnotesAside', 'footnoteOrder', 'routeImages', 'imageFolder'],
  Maps: ['mindmapDefaultFormat', 'mindmapLayout', 'mindmapTemplateFolder', 'canvasSpacing', 'mindmaps', 'mindmapTakeover', 'mindmapGlide', 'mindmapPeek', 'mindmapLegend', 'mindmapDepth', 'mindmapColourBy', 'mindmapPins', 'mindmapViews', 'mindmapRelations', 'mindmapArguments', 'mindmapBranchNotes', 'mindmapCheck', 'mindmapCompare', 'mindmapVaultMap', 'mindmapMinimap', 'mindmapPresent', 'presentDimLevel', 'mindmapPresentSpotlight', 'mindmapPresentNotes', 'mindmapAlbumMap', 'albumMapAuto', 'albumMapWritesParent', 'mindmapConvert', 'mindmapTasks', 'mindmapOtherViews', 'mindmapLinkedCards', 'mindmapNodePanel', 'mindmapFilters', 'mindmapEmbeds', 'mindmapQueries', 'mindmapHistory', 'mindmapRichNodes', 'mindmapTheme'],
  Workspace: ['workspaceModes', 'contextStrip', 'stripPlace', 'stripDetail', 'stripProgress', 'onePage', 'singleArea', 'navDropdown', 'ribbonInMenu', 'settingsInHeader', 'graphProperties', 'graphRoutes', 'graphRouteProperty'],
  Advanced: ['compatibility'],
};

/**
 * Suggestions under a settings field: notes, folders, or property names
 * — for a comma list, just the name being typed after the last comma.
 */
export class SettingSuggest extends (AbstractInputSuggest || class {}) {
  constructor(app, inputEl, kind, extra) {
    super(app, inputEl);
    this.app = app;
    this.inputEl = inputEl;
    this.kind = kind;
    this.extra = extra || [];
  }

  get isList() {
    return this.kind === 'properties';
  }

  candidates() {
    const vault = this.app.vault;
    if (this.kind === 'file') return vault.getMarkdownFiles().map((f) => f.path).sort(byName);
    if (this.kind === 'folder') {
      return vault
        .getAllLoadedFiles()
        .filter((f) => f instanceof TFolder && !f.isRoot())
        .map((f) => f.path)
        .sort(byName);
    }
    return this.extra.concat(knownPropertyNames(this.app).filter((n) => this.extra.indexOf(n) === -1));
  }

  getSuggestions() {
    const value = this.inputEl.value;
    const typed = (this.isList ? value.slice(value.lastIndexOf(',') + 1) : value).trim().toLowerCase();
    // In a list, what's already in it isn't offered again.
    const taken = this.isList
      ? value.split(',').slice(0, -1).map((v) => v.trim().toLowerCase())
      : [];
    return this.candidates()
      .filter((c) => c.toLowerCase().includes(typed) && taken.indexOf(c.toLowerCase()) === -1)
      .slice(0, 50);
  }

  renderSuggestion(value, el) {
    el.setText(value);
  }

  selectSuggestion(value) {
    const current = this.inputEl.value;
    const cut = current.lastIndexOf(',');
    this.inputEl.value = this.isList && cut !== -1 ? `${current.slice(0, cut + 1)} ${value}` : value;
    // The field's own listener saves it, as if typed.
    this.inputEl.dispatchEvent(new Event('input'));
    this.close();
  }
}

export class DesignReduxSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.tab = SETTINGS_TABS[0].id;
    /** The folded parts a person has opened, by section; kept while the page redraws. */
    this.opened = new Set();
  }

  get settings() {
    return this.plugin.settings;
  }

  /** Every row the features declare that belongs on this device. */
  rows() {
    // Settings for desktop chrome are left out on a phone or tablet,
    // where they'd do nothing; they keep their values for the desktop.
    const here = (desktopOnly) => !(desktopOnly && Platform.isMobile);
    const rows = [];
    this.plugin.features
      .filter((feature) => here(feature.constructor.desktopOnly))
      .forEach((feature) =>
        feature
          .settingsSchema()
          .filter((row) => here(row.desktopOnly))
          .forEach((row) => rows.push(row))
      );
    return rows;
  }

  shown(row) {
    if (!row.showIf) return true;
    return typeof row.showIf === 'function' ? !!row.showIf(this.settings) : !!this.settings[row.showIf];
  }

  display() {
    const { containerEl } = this;
    // Redrawn on every toggle; the place on the page stays put. Which
    // element scrolls depends on the version, so both are kept.
    const scroller = containerEl.parentElement;
    const tops = [containerEl.scrollTop, scroller ? scroller.scrollTop : 0];
    containerEl.empty();
    containerEl.addClass('dr-settings');
    const rows = this.rows();
    const placed = new Set();
    const resolve = (sec) => {
      const front = (sec.keys || []).map((key) => rows.find((row) => row.key === key)).filter(Boolean);
      const more = (sec.more || []).map((key) => rows.find((row) => row.key === key)).filter(Boolean);
      front.concat(more).forEach((row) => placed.add(row));
      return Object.assign({}, sec, { front, more });
    };
    const look = { spec: { id: 'look', title: 'Look' }, sections: [resolve({ title: 'Look', keys: LOOK_KEYS })] };
    const tabs = SETTINGS_TABS.map((spec) => ({ spec, sections: spec.sections.map(resolve) }));
    // Anything no tab claims still gets a place, at the end.
    const rest = rows.filter((row) => !placed.has(row));
    if (rest.length) tabs[tabs.length - 1].sections.push({ title: 'Other', advanced: true, front: [], more: rest });

    this.renderTools(containerEl);
    // The look, above the places: it's one setting for the whole window, not one tab's.
    const lookPane = containerEl.createDiv({ cls: 'dr-set-pane dr-set-look' });
    lookPane.dataset.tab = 'look';
    lookPane.dataset.always = 'true';
    this.renderPane(lookPane, look.spec, look.sections);
    const bar = containerEl.createDiv({ cls: 'dr-set-tabs' });
    bar.setAttribute('role', 'tablist');
    roveFocus(bar, '.dr-set-tab');
    const panes = [];

    tabs.forEach(({ spec, sections }) => {
      const on = spec.id === this.tab;
      const button = bar.createEl('button', { cls: 'dr-set-tab' });
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(on));
      button.id = `dr-set-tab-${spec.id}`;
      button.toggleClass('is-active', on);
      button.setText(spec.title);

      const pane = containerEl.createDiv({ cls: 'dr-set-pane' });
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', button.id);
      pane.dataset.tab = spec.id;
      pane.toggleClass('is-hidden', !on);
      panes.push(pane);
      // Named over its rows while searching, when every tab's are shown at once.
      pane.createDiv({ cls: 'dr-set-pane-title', text: spec.title });
      this.renderPane(pane, spec, sections);

      button.addEventListener('click', () => {
        this.tab = spec.id;
        bar.querySelectorAll('.dr-set-tab').forEach((b) => {
          const active = b === button;
          b.toggleClass('is-active', active);
          b.setAttribute('aria-selected', String(active));
        });
        panes.forEach((p) => p.toggleClass('is-hidden', p !== pane));
      });
    });

    containerEl.createDiv({ cls: 'dr-set-nothing', text: 'No settings match.' });
    this.search(this.query || '');
    containerEl.scrollTop = tops[0];
    if (scroller) scroller.scrollTop = tops[1];
    this.showRevealed();
  }

  hide() {
    if (typeof super.hide === 'function') super.hide();
  }

  /** Opened next at one setting: its tab, and its row scrolled to and marked. */
  reveal(key) {
    const spec = SETTINGS_TABS.find((tab) => tab.sections.some((sec) => sectionKeys(sec).indexOf(key) !== -1));
    if (spec) this.tab = spec.id;
    // One folded under its switch opens that part.
    SETTINGS_TABS.forEach((tab) => tab.sections.forEach((sec) => {
      if ((sec.more || []).indexOf(key) !== -1) this.opened.add(sectionId(tab, sec));
    }));
    this.query = '';
    this.revealKey = key;
  }

  showRevealed() {
    const key = this.revealKey;
    this.revealKey = null;
    if (!key) return;
    const el = Array.from(this.containerEl.querySelectorAll('[data-dr-key]')).find((e) => e.dataset.drKey === key);
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    el.addClass('is-revealed');
    window.setTimeout(() => el.removeClass('is-revealed'), 1600);
  }

  /** Above the tabs: a search through every tab's settings, and the settings out to a file and back. */
  renderTools(containerEl) {
    const tools = containerEl.createDiv({ cls: 'dr-set-tools' });
    const field = tools.createDiv({ cls: 'dr-set-search' });
    setIcon(field.createSpan({ cls: 'dr-set-search-icon' }), 'search');
    const input = field.createEl('input', { type: 'search' });
    input.placeholder = 'Search settings';
    input.setAttribute('aria-label', 'Search settings');
    input.value = this.query || '';
    input.addEventListener('input', () => {
      this.query = input.value;
      this.search(this.query);
    });
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Escape' && input.value) {
        evt.preventDefault();
        evt.stopPropagation();
        input.value = '';
        this.query = '';
        this.search('');
      }
    });

    const exportBtn = tools.createEl('button', { text: 'Export…' });
    exportBtn.setAttribute('aria-label', 'Save these settings to a file in the vault');
    exportBtn.addEventListener('click', () => this.exportSettings());

    const importBtn = tools.createEl('button', { text: 'Import…' });
    importBtn.setAttribute('aria-label', 'Replace these settings with ones from a file');
    // The settings window's own document: Obsidian 1.13 opens settings in a window of its own.
    const picker = containerEl.ownerDocument.createElement('input');
    picker.type = 'file';
    picker.accept = '.json,application/json';
    picker.className = 'dr-set-file';
    tools.appendChild(picker);
    picker.addEventListener('change', async () => {
      const file = picker.files && picker.files[0];
      picker.value = '';
      if (file) await this.importSettings(await file.text());
    });
    importBtn.addEventListener('click', () => picker.click());
  }

  /**
   * Rows whose name or description has every word typed, from every tab
   * at once; a section shows if its heading matches, or any of its rows.
   */
  search(query) {
    const containerEl = this.containerEl;
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const on = words.length > 0;
    containerEl.toggleClass('is-searching', on);
    const matches = (text) => words.every((w) => text.indexOf(w) !== -1);
    let any = false;
    containerEl.querySelectorAll('.dr-set-pane').forEach((pane) => {
      let paneAny = false;
      pane.querySelectorAll('.dr-set-block').forEach((section) => {
        const titled = on && matches(section.dataset.drSearch || '');
        let sectionAny = false;
        section.querySelectorAll('[data-dr-search]').forEach((el) => {
          if (el === section) return;
          const show = !on || titled || matches(el.dataset.drSearch);
          el.toggleClass('dr-set-unmatched', !show);
          if (show) sectionAny = true;
        });
        // A row shown beneath one it depends on shows that one too.
        section.querySelectorAll('.dr-set-children').forEach((kids) => {
          if (kids.querySelector('[data-dr-search]:not(.dr-set-unmatched)') && kids.previousElementSibling) {
            kids.previousElementSibling.removeClass('dr-set-unmatched');
          }
        });
        section.querySelectorAll('.dr-set-more').forEach((fold) => {
          fold.open = on ? !!fold.querySelector('[data-dr-search]:not(.dr-set-unmatched)') : this.opened.has(fold.dataset.drMore);
        });
        section.toggleClass('dr-set-unmatched', on && !sectionAny);
        if (sectionAny) paneAny = true;
      });
      pane.toggleClass('is-hidden', on ? !paneAny : !pane.dataset.always && pane.dataset.tab !== this.tab);
      if (paneAny) any = true;
    });
    containerEl.toggleClass('dr-set-none', on && !any);
  }

  /** The settings, as they are, to a file at the top of the vault. */
  async exportSettings() {
    const vault = this.app.vault;
    let path = 'Design Redux settings.json';
    for (let n = 2; vault.getAbstractFileByPath(path); n++) path = `Design Redux settings ${n}.json`;
    try {
      await vault.create(path, JSON.stringify(this.settings, null, 2));
      new Notice(`Settings saved to “${path}”.`);
    } catch (err) {
      console.error('Design Redux: could not export the settings', err);
      new Notice('Could not save the settings.');
    }
  }

  /** Settings from a file, in place of these — brought up to date and checked as on loading. */
  async importSettings(text) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = null;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).some((k) => DEFAULTS[k] !== undefined)) {
      new Notice('That file doesn\'t hold Design Redux settings.');
      return;
    }
    const yes = await confirmAction(this.app, {
      title: 'Import settings',
      text: 'Replace all of Design Redux\'s settings with the ones in this file? Anything the file leaves out goes back to its default.',
      button: 'Replace them',
    });
    if (!yes) return;
    try {
      await this.plugin.saveData(data);
      await this.plugin.loadSettings();
      await this.plugin.saveSettings();
      new Notice('Settings imported.');
    } catch (err) {
      console.error('Design Redux: could not import the settings', err);
      new Notice('Could not import the settings.');
    }
    this.display();
  }

  renderPane(pane, spec, sections) {
    if (spec.id === 'library' && !this.settings.library) {
      const note = pane.createDiv({ cls: 'dr-set-callout' });
      note.createSpan({ text: 'The library is off, so the settings for its screens are hidden.' });
      const on = note.createEl('button', { text: 'Turn it on' });
      on.addEventListener('click', async () => {
        this.settings.library = true;
        await this.plugin.saveSettings();
        this.display();
      });
    }

    sections.forEach((sec) => {
      const front = sec.front.filter((row) => this.shown(row));
      const more = sec.more.filter((row) => this.shown(row));
      if (!front.length && !more.length) return;
      // Each section in a block of its own, so a search can hide what has nothing to show.
      const section = pane.createDiv({ cls: 'dr-set-block' });
      section.dataset.drSearch = `${sec.title || ''} ${sec.desc || ''}`.toLowerCase();
      if (front.length) {
        if (sec.title) {
          const head = new Setting(section).setName(sec.title).setHeading();
          if (sec.desc) head.setDesc(sec.desc);
        }
        this.drawRows(section, front, spec);
      }
      if (!more.length) return;
      // What else the feature has sits folded under it, there only while its switch is on.
      const id = sectionId(spec, sec);
      const fold = section.createEl('details', { cls: 'dr-set-more' });
      fold.dataset.drMore = id;
      fold.open = this.opened.has(id);
      fold.toggleClass('is-off', !!sec.switch && !this.settings[sec.switch]);
      const label = front.length ? 'More options' : sec.title || 'More options';
      fold.createEl('summary', { text: label });
      fold.addEventListener('toggle', () => {
        // A search opens every fold it has something in, without that counting as a choice.
        if (this.containerEl.hasClass('is-searching')) return;
        if (fold.open) this.opened.add(id);
        else this.opened.delete(id);
      });
      this.drawRows(fold.createDiv({ cls: 'dr-set-more-body' }), more, spec);
    });

    if (spec.id === 'tools' && Platform.isMobile) {
      pane.createDiv({
        cls: 'setting-item-description dr-settings-note',
        text: 'Settings for the desktop app\'s tab bar and sidebar header aren\'t shown on a phone or tablet.',
      });
    }
  }

  /** Rows in a place, each beneath the one it depends on when that's here too. */
  drawRows(host, rows, spec) {
    const blocks = {};
    rows.forEach((row) => {
      const parent = row.parent || (typeof row.showIf === 'string' ? row.showIf : null);
      const into = parent && blocks[parent] ? blocks[parent]() : host;
      const el = this.row(into, row);
      if (el) {
        const former = Object.keys(FORMER_TABS).filter((name) => FORMER_TABS[name].indexOf(row.key) !== -1).join(' ');
        el.dataset.drSearch = `${row.name || ''} ${row.desc || ''} ${row.key || ''} ${former} ${spec.title}`.toLowerCase();
        if (row.key) el.dataset.drKey = row.key;
      }
      if (row.key && el) {
        let children = null;
        blocks[row.key] = () => {
          if (!children) {
            children = el.ownerDocument.createElement('div');
            children.className = 'dr-set-children';
            el.after(children);
          }
          return children;
        };
      }
    });
  }

  async set(key, value, redraw) {
    this.settings[key] = value;
    await this.plugin.saveSettings();
    if (redraw) this.display();
  }

  /** Back to the default, for a row that's been changed from it. */
  addReset(setting, row) {
    if (!(row.key in DEFAULTS)) return;
    const value = this.settings[row.key];
    if (JSON.stringify(value) === JSON.stringify(DEFAULTS[row.key])) return;
    setting.addExtraButton((b) =>
      b
        .setIcon('rotate-ccw')
        .setTooltip('Restore default')
        .onClick(() => this.set(row.key, JSON.parse(JSON.stringify(DEFAULTS[row.key])), true))
    );
  }

  /** One row; returns its element, so rows that depend on it can follow. */
  row(containerEl, row) {
    // A feature can render its own block when a toggle or text field
    // isn't enough to express the setting.
    if (row.type === 'custom') {
      const before = containerEl.lastElementChild;
      row.render(containerEl, this);
      return containerEl.lastElementChild !== before ? containerEl.lastElementChild : null;
    }

    const setting = new Setting(containerEl).setName(row.name).setDesc(row.desc || '');
    if (row.type) setting.setClass(`dr-set-${row.type}`);
    const value = this.settings[row.key];

    if (row.type === 'text') {
      this.addReset(setting, row);
      setting.addText((t) => {
        t.setPlaceholder(row.placeholder || '')
          .setValue(value == null ? '' : String(value))
          .onChange((v) => this.set(row.key, v.trim() || row.fallback || ''));
        if (row.suggest && AbstractInputSuggest) {
          new SettingSuggest(this.app, t.inputEl, row.suggest, row.suggestExtra);
        }
      });
    } else if (row.type === 'number') {
      this.addReset(setting, row);
      setting.addText((t) => {
        t.inputEl.type = 'number';
        t.inputEl.min = String(row.min || 1);
        t.inputEl.setAttribute('inputmode', 'numeric');
        t.setPlaceholder(String(DEFAULTS[row.key]))
          .setValue(String(value))
          .onChange((v) => {
            const n = parseInt(v, 10);
            // Mid-edit a field can be empty; it keeps the last good number.
            if (Number.isFinite(n) && n >= (row.min || 1)) this.set(row.key, n);
          });
      });
    } else if (row.type === 'dropdown') {
      this.addReset(setting, row);
      setting.addDropdown((d) => {
        Object.keys(row.options).forEach((v) => d.addOption(v, row.options[v]));
        // A choice can bring rows with it, as a toggle can.
        d.setValue(value).onChange((v) => this.set(row.key, v, true));
      });
    } else if (row.type === 'color') {
      this.addReset(setting, row);
      const hex = normalHex(value) || DEFAULTS[row.key];
      if (typeof setting.addColorPicker === 'function') {
        setting.addColorPicker((c) =>
          c.setValue(hex).onChange((v) => {
            if (normalHex(v)) this.set(row.key, normalHex(v));
          })
        );
      } else {
        setting.addText((t) =>
          t.setPlaceholder(DEFAULTS[row.key]).setValue(hex).onChange((v) => {
            if (normalHex(v)) this.set(row.key, normalHex(v));
          })
        );
      }
    } else {
      // Rows can be conditional on other rows, so a toggle redraws.
      setting.addToggle((t) => t.setValue(!!value).onChange((v) => this.set(row.key, v, true)));
    }
    return setting.settingEl || null;
  }
}

