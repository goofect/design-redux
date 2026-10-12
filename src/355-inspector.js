/* ------------------------------------------------------------------ */
/* Inspector                                                          */
/*                                                                    */
/* What's picked — the note opened last, a note or album picked in    */
/* the library, a card on a canvas — described in the right sidebar   */
/* without opening it. A note gets the note panel's own sections; an  */
/* album its kind, what it's for, its properties and the albums it    */
/* points to. Picking is `plugin.selection`; this only shows it.      */
/* ------------------------------------------------------------------ */

const INSPECTOR_VIEW = 'design-redux-inspector';

/** References: the notes linking to this one, and those it links to. */
class ReferencesSection extends PanelSection {
  get cls() {
    return 'dr-references-section';
  }

  render() {
    const file = this.file;
    const links = this.app.metadataCache.resolvedLinks || {};
    const files = (paths) => paths.filter((p) => p !== file.path).map((p) => this.app.vault.getAbstractFileByPath(p)).filter((f) => f instanceof TFile);
    const incoming = files(Object.keys(links).filter((from) => links[from] && links[from][file.path]));
    const outgoing = files(Object.keys(links[file.path] || {}));
    this.renderLabel('References');
    this.renderList('refs-in', 'Linked from', incoming, (list, f) => this.fileRow(list, f));
    this.renderList('refs-out', 'Links to', outgoing, (list, f) => this.fileRow(list, f));
  }
}

/** An album's albums beside it and notes from elsewhere, each to open. */
class AlbumLinksSection extends PanelSection {
  constructor(panel, about) {
    super(panel);
    this.about = about;
  }

  get cls() {
    return 'dr-album-links-section';
  }

  render() {
    const related = this.about.related.filter((t) => t instanceof TFolder);
    const includes = this.about.includes.filter((t) => t instanceof TFile);
    if (!related.length && !includes.length) return;
    this.renderLabel('Organisation');
    if (related.length) {
      this.renderList('album-related', 'Albums beside it', related, (list, folder) => {
        const row = list.createDiv({ cls: 'dr-mention' });
        asButton(row, `Open the album ${folder.name}`);
        row.createSpan({ cls: 'dr-mention-name', text: folder.name });
        onActivate(row, () => openAlbum(this.plugin, folder), false);
      });
    }
    if (includes.length) this.renderList('album-includes', 'From elsewhere', includes, (list, f) => this.fileRow(list, f));
  }
}

/** An album, opened in the library's browse view. */
function openAlbum(plugin, folder) {
  const library = plugin.feature(Library);
  if (library) library.browseMode({ mode: 'folder', path: folder.path });
}

class InspectorView extends ItemView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
    this.plugin = feature.plugin;
    this.sections = [];
    this.shown = null;
    this.timer = 0;
    // The note panel's sections ask their host for these.
    this.folds = {};
    this.otherEdits = 0;
  }

  getViewType() {
    return INSPECTOR_VIEW;
  }

  getDisplayText() {
    return 'Inspector';
  }

  getIcon() {
    return 'info';
  }

  get popupEl() {
    return this.contentEl;
  }

  /** The sections close the note panel after opening a note; this stays. */
  close() {}

  async onOpen() {
    this.containerEl.addClass('dr-inspector');
    const selection = this.plugin.selection;
    this.unpick = selection.onChange(() => this.queue());
    this.unview = selection.addViewer(() => this.isShowing());
    this.registerEvent(this.app.metadataCache.on('changed', (file) => this.sections.forEach((s) => s.refresh(file))));
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.queue()));
    ['modify', 'create', 'delete', 'rename'].forEach((type) =>
      this.registerEvent(
        this.app.vault.on(type, () => {
          this.otherEdits++;
          if (type !== 'modify') this.queue();
        })
      )
    );
    this.render();
  }

  async onClose() {
    if (this.unpick) this.unpick();
    if (this.unview) this.unview();
    this.unpick = this.unview = null;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
    this.clear();
  }

  /** On screen now: not behind another tab, not in a closed sidebar. */
  isShowing() {
    const el = this.containerEl;
    if (!el || !el.isConnected) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  queue() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), 30);
  }

  clear() {
    this.sections.forEach((s) => s.destroy());
    this.sections = [];
    this.contentEl.empty();
  }

  render() {
    this.timer = 0;
    const item = this.feature.current();
    const same = !!item && !!this.shown && item.file === this.shown.file && item.folder === this.shown.folder && item.card === this.shown.card;
    // Mid-edit in a property, the same item isn't drawn again under the cursor.
    if (same && this.contentEl.contains(this.contentEl.ownerDocument.activeElement)) return;
    this.clear();
    this.shown = item;
    if (!item) {
      this.contentEl.createDiv({ cls: 'dr-empty', text: 'Pick a note, an album or a card to see it here.' });
      return;
    }
    if (item.file) this.renderNote(item.file);
    else if (item.folder) this.renderAlbum(item.folder);
    else if (item.card) this.renderCard(item.card);
    this.renderFoot();
  }

  /** Round buttons under the head: [icon, label, run]. */
  buttons(list) {
    const bar = this.contentEl.createDiv({ cls: 'dr-section-actions dr-inspector-actions' });
    list.forEach(([icon, label, run]) => {
      const button = bar.createDiv({ cls: 'dr-section-action' });
      asButton(button, label);
      setIcon(button.createSpan({ cls: 'dr-section-action-icon' }), icon);
      button.createSpan({ text: label });
      onActivate(button, run);
    });
  }

  mountSections(sections, file) {
    this.sections = sections;
    sections.forEach((s) => s.mount(this.contentEl, file));
  }

  renderNote(file) {
    drawNoteHead(this.plugin, this.contentEl, file);
    const open = pageFile(this.app) === file;
    this.buttons(
      [
        open ? null : ['book-open', 'Open', (evt) => this.app.workspace.getLeaf(!!(evt && (evt.ctrlKey || evt.metaKey))).openFile(file)],
        ['ellipsis', 'More', (evt) => showTargetMenu(this.plugin, evt, file, { source: INSPECTOR_VIEW })],
      ].filter(Boolean)
    );
    const sections = [];
    if (file.extension === 'md') {
      sections.push(new PropertiesSection(this));
      (this.plugin.features || []).forEach((f) => {
        if (f.enabled && typeof f.panelSections === 'function') sections.push(...f.panelSections(this));
      });
    }
    sections.push(new ReferencesSection(this));
    this.mountSections(sections, file);
  }

  renderAlbum(folder) {
    const root = !!(folder.isRoot && folder.isRoot());
    const head = this.contentEl.createDiv({ cls: 'dr-props-head' });
    drawFolderArt(this.plugin, head.createDiv({ cls: 'dr-props-art' }), folder);
    const info = head.createDiv({ cls: 'dr-props-info' });
    info.createDiv({ cls: 'dr-props-title', text: root ? this.app.vault.getName() : folder.name });
    const structure = this.plugin.feature(AlbumStructure);
    const about = structure && structure.enabled ? structure.info(folder) : null;
    info.createDiv({ cls: 'dr-props-lead', text: (about && about.label) || 'Album' });
    const items = countFilesIn(folder);
    const discs = (folder.children || []).filter((c) => c instanceof TFolder).length;
    const meta = [items === 1 ? '1 item' : `${items} items`];
    if (discs) meta.push(discs === 1 ? '1 disc' : `${discs} discs`);
    info.createDiv({ cls: 'dr-props-meta', text: meta.join('  ·  ') });
    if (about && about.description) this.contentEl.createDiv({ cls: 'dr-inspector-about', text: about.description });

    const upNext = this.plugin.feature(UpNext);
    this.buttons(
      [
        ['book-open', 'Open', () => openAlbum(this.plugin, folder)],
        upNext && upNext.enabled && items ? ['shuffle', 'Shuffle', () => upNext.shuffle(folder)] : null,
        ['ellipsis', 'More', (evt) => showTargetMenu(this.plugin, evt, folder, { source: INSPECTOR_VIEW, open: () => openAlbum(this.plugin, folder) })],
      ].filter(Boolean)
    );
    const note = typeof this.plugin.folderNote === 'function' ? this.plugin.folderNote(folder) : null;
    const sections = [];
    if (note) sections.push(new PropertiesSection(this));
    if (about) sections.push(new AlbumLinksSection(this, about));
    this.mountSections(sections, note);
  }

  /** A text card: its first line, its text, and how many arrows it has. */
  renderCard(node) {
    let data = {};
    try {
      data = node.getData() || {};
    } catch (err) {
      data = {};
    }
    const lines = String(data.text || '').split('\n').map((l) => plainMarkdownLine(l)).filter(Boolean);
    const head = this.contentEl.createDiv({ cls: 'dr-props-head' });
    // Cover-shaped, like a note's and an album's: a card has its own mark.
    fillArt(head.createDiv({ cls: 'dr-props-art' }), null, 'sticky-note', null, null);
    const info = head.createDiv({ cls: 'dr-props-info' });
    info.createDiv({ cls: 'dr-props-title', text: lines[0] || 'Card' });
    let arrows = 0;
    try {
      const canvas = node.canvas;
      if (canvas && typeof canvas.getEdgesForNode === 'function') arrows = canvas.getEdgesForNode(node).length;
    } catch (err) {
      arrows = 0;
    }
    info.createDiv({ cls: 'dr-props-meta', text: ['A card on this canvas', arrows === 1 ? '1 arrow' : arrows ? `${arrows} arrows` : ''].filter(Boolean).join('  ·  ') });
    // What can be done with it: the canvas's tools, as they fit what's selected.
    const tools = this.plugin.feature(CanvasTools);
    if (tools && tools.enabled) this.buttons([['wrench', 'Tools', (evt) => tools.showMenu(evt)]]);
    if (lines.length > 1) this.contentEl.createDiv({ cls: 'dr-inspector-about', text: lines.slice(1, 8).join('\n') });
  }

  /** At the foot, quietly: the inspector's own settings. */
  renderFoot() {
    if (typeof this.plugin.openSettingsAt !== 'function') return;
    const foot = this.contentEl.createDiv({ cls: 'dr-inspector-foot' });
    asButton(foot, 'Inspector settings');
    setIcon(foot.createSpan({ cls: 'dr-inspector-foot-icon' }), 'settings');
    foot.createSpan({ text: 'Inspector settings' });
    onActivate(foot, () => this.plugin.openSettingsAt('inspector'));
  }
}

class Inspector extends Feature {
  settingsSchema() {
    return [
      {
        key: 'inspector',
        name: 'Inspector',
        desc: 'What’s picked — the note opened last, a note or album picked in the library, a card on a canvas — described in the right sidebar without opening it: its properties, relationships, references and where it’s kept.',
      },
      {
        key: 'inspectorClick',
        type: 'dropdown',
        showIf: 'inspector',
        name: 'A single click in the library',
        desc: 'Picking shows a note or album in the inspector; a double click or Enter opens it.',
        options: { shown: 'Picks while the inspector shows, opens otherwise', always: 'Always picks', never: 'Always opens' },
      },
    ];
  }

  registerTypes() {
    this.plugin.registerView(INSPECTOR_VIEW, (leaf) => new InspectorView(leaf, this));
  }

  register() {
    // Opening a note picks it.
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (this.enabled && file) this.plugin.selection.set({ file });
      })
    );
    // A card picked on a canvas: the canvas says nothing, so look after a click or a key.
    const look = () => this.followCanvas();
    this.plugin.registerDomEvent(document, 'pointerup', look);
    this.plugin.registerDomEvent(document, 'keyup', look);
  }

  actions() {
    const pick = (item) => {
      this.plugin.selection.set(item);
      this.show();
    };
    return [
      { id: 'open-inspector', name: 'Open the inspector', icon: 'info', on: 'app', when: () => this.enabled, run: () => this.show() },
      { id: 'inspect-file', name: 'Show in the inspector', icon: 'info', on: 'file', palette: false, when: (ctx) => this.enabled && !!ctx.file, run: (ctx) => pick({ file: ctx.file }) },
      { id: 'inspect-album', name: 'Show in the inspector', icon: 'info', on: 'album', palette: false, when: (ctx) => this.enabled && !!ctx.folder, run: (ctx) => pick({ folder: ctx.folder }) },
    ];
  }

  disable() {
    // Closed when switched off — not when the plugin's only unloading, so it's back where it was after.
    if (!this.plugin.unloading) this.app.workspace.getLeavesOfType(INSPECTOR_VIEW).forEach((leaf) => leaf.detach());
  }

  /** What to show: what's picked, or else the note open in the page. */
  current() {
    const item = this.plugin.selection.get();
    if (item) return item;
    const file = pageFile(this.app);
    return file ? { file } : null;
  }

  /** The inspector in the right sidebar, opened if it isn't, and shown. */
  async show() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(INSPECTOR_VIEW)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: INSPECTOR_VIEW, active: false });
    }
    ws.revealLeaf(leaf);
    return leaf;
  }

  /** One card picked on the active canvas becomes what's picked: a note's card, the note. */
  followCanvas() {
    if (!this.enabled || !this.app.workspace.getLeavesOfType(INSPECTOR_VIEW).length) return;
    window.setTimeout(() => {
      const leaf = this.app.workspace.activeLeaf;
      const canvas = leaf && leaf.view && leaf.view.canvas;
      if (!canvas || !canvas.selection || typeof canvas.selection.forEach !== 'function') return;
      const picked = Array.from(canvas.selection).filter((n) => n && typeof n.getData === 'function');
      if (picked.length !== 1) return;
      let data = {};
      try {
        data = picked[0].getData() || {};
      } catch (err) {
        return;
      }
      if (data.type === 'file') {
        const file = typeof data.file === 'string' ? this.app.vault.getAbstractFileByPath(data.file) : null;
        if (file instanceof TFile) this.plugin.selection.set({ file });
      } else if ((data.type || 'text') === 'text') {
        this.plugin.selection.set({ card: picked[0] });
      }
    }, 0);
  }
}

Inspector.settingKey = 'inspector';
