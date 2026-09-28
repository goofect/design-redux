/*
 * Where each setting sits: four tabs of short sections. Features still
 * own their rows — name, control, description; this only decides where
 * each goes. A row shown only while another in its section is on sits
 * indented beneath that one.
 */
const SETTINGS_TABS = [
  {
    id: 'library',
    title: 'Library',
    icon: 'library',
    sections: [
      { keys: ['library', 'homePath', 'hideEmptyFolders'] },
      {
        title: 'Layout',
        desc: 'What the library lists, under headings of your own.',
        keys: ['librarySections'],
      },
    ],
  },
  {
    id: 'browsing',
    title: 'Browsing',
    icon: 'layout-grid',
    sections: [
      { title: 'Lists', keys: ['defaultSort', 'discNoteLimit', 'albumNoteLimit'] },
      { title: 'Screens', keys: ['albumColumns', 'trackLength', 'tableColumns', 'categoryProperty'] },
      { title: 'Folder notes', keys: ['folderNoteName', 'hideFolderNotes'] },
      { title: 'Covers', keys: ['coverProperty', 'coverFallback', 'generatedCoverColor'] },
    ],
  },
  {
    id: 'notes',
    title: 'Notes',
    icon: 'file-text',
    sections: [
      { title: 'Lists', keys: ['letterLists', 'romanLists'] },
      { title: 'Superscript and subscript', keys: ['scripts', 'scriptSyntax', 'autoOrdinals'] },
      { title: 'Properties', keys: ['propertiesDropdown', 'showMentions'] },
      { title: 'Links', keys: ['quietLinks'] },
      { title: 'Images', keys: ['routeImages', 'imageFolder'] },
    ],
  },
  {
    id: 'interface',
    title: 'Interface',
    icon: 'app-window',
    sections: [
      { title: 'Page', keys: ['contextStrip', 'onePage', 'singleArea'] },
      { title: 'Sidebar header', keys: ['navDropdown', 'ribbonInMenu', 'settingsInHeader'] },
      { title: 'Graph', keys: ['graphProperties'] },
      { title: 'Canvas', keys: ['canvasLegend', 'canvasTextAlign'] },
      {
        title: 'Compatibility',
        desc: 'Parts of Obsidian that Design Redux uses but plugins aren’t officially meant to. If an Obsidian update changes one, this shows what stops working.',
        keys: ['compatibility'],
      },
    ],
  },
];

/**
 * Suggestions under a settings field: notes, folders, or property names
 * — for a comma list, just the name being typed after the last comma.
 */
class SettingSuggest extends (AbstractInputSuggest || class {}) {
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

class DesignReduxSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.tab = SETTINGS_TABS[0].id;
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
    const tabs = SETTINGS_TABS.map((spec) => ({
      spec,
      sections: spec.sections.map((sec) => {
        const members = sec.keys
          .map((key) => rows.find((row) => row.key === key))
          .filter(Boolean);
        members.forEach((row) => placed.add(row));
        return Object.assign({}, sec, { rows: members });
      }),
    }));
    // Anything no tab claims still gets a place, at the end.
    const rest = rows.filter((row) => !placed.has(row));
    if (rest.length) tabs[tabs.length - 1].sections.push({ title: 'Other', rows: rest });

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
      setIcon(button.createSpan({ cls: 'dr-set-tab-icon' }), spec.icon);
      button.createSpan({ text: spec.title });

      const pane = containerEl.createDiv({ cls: 'dr-set-pane' });
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', button.id);
      pane.dataset.tab = spec.id;
      pane.toggleClass('is-hidden', !on);
      panes.push(pane);
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

    containerEl.scrollTop = tops[0];
    if (scroller) scroller.scrollTop = tops[1];
  }

  renderPane(pane, spec, sections) {
    if (spec.id === 'browsing' && !this.settings.library) {
      const note = pane.createDiv({ cls: 'dr-set-callout' });
      note.createSpan({ text: 'The Library view is off, so the settings for its screens are hidden.' });
      const on = note.createEl('button', { text: 'Turn it on' });
      on.addEventListener('click', async () => {
        this.settings.library = true;
        await this.plugin.saveSettings();
        this.display();
      });
    }

    sections.forEach((sec) => {
      const visible = sec.rows.filter((row) => this.shown(row));
      if (!visible.length) return;
      if (sec.title) {
        const head = new Setting(pane).setName(sec.title).setHeading();
        if (sec.desc) head.setDesc(sec.desc);
      }
      // A row sits beneath the one it depends on, when that's here too.
      const blocks = {};
      visible.forEach((row) => {
        const parent = row.parent || (typeof row.showIf === 'string' ? row.showIf : null);
        const host = parent && blocks[parent] ? blocks[parent]() : pane;
        const el = this.row(host, row);
        if (row.key && el) {
          let children = null;
          blocks[row.key] = () => {
            if (!children) {
              children = document.createElement('div');
              children.className = 'dr-set-children';
              el.after(children);
            }
            return children;
          };
        }
      });
    });

    if (spec.id === 'interface' && Platform.isMobile) {
      pane.createDiv({
        cls: 'setting-item-description dr-settings-note',
        text: 'Settings for the desktop app\'s tab bar and sidebar header aren\'t shown on a phone or tablet.',
      });
    }
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

