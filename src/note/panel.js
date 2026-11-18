/* ------------------------------------------------------------------ */
/* The panel: what is picked, or the open note, in the right sidebar   */
/*                                                                     */
/* For a note: its properties as the ledger's rows (note/ledger.js);   */
/* where other notes name                                              */
/* it in a property, grouped by the property; where it is mentioned;   */
/* what it links to. For a folder picked in the library: the folder's  */
/* detail. The note keeps its own properties block; the panel only     */
/* reads and writes the same properties.                               */
/* ------------------------------------------------------------------ */

import { ItemView, Menu, TFile, TFolder } from 'obsidian';
import { addProperty, ledgerKeys, ledgerRow, valueText } from './ledger.js';
import { clear, el } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { foldersIfMixed, listOf } from '../core/text.js';
import { row, rows, sectionTitle } from '../ui/row.js';
import { ask } from '../ui/sheet.js';
import { sayso } from '../ui/state.js';

export const PANEL_VIEW = 'design-redux-properties';

export class PanelView extends ItemView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
  }

  getViewType() { return PANEL_VIEW; }
  getDisplayText() { return 'Properties'; }
  getIcon() { return 'list'; }
  async onOpen() {
    this.contentEl.classList.add('dr', 'dr-panel');
    // The note's actions, a right press away anywhere but on a property (which has its own menu).
    this.contentEl.addEventListener('contextmenu', (e) => {
      const subject = this.feature.subject();
      if (!(subject instanceof TFile) || (e.target.closest && e.target.closest('.dr-prop'))) return;
      e.preventDefault();
      this.feature.noteMenu(subject, e);
    });
    this.draw();
  }

  draw() {
    const host = clear(this.contentEl);
    const plugin = this.feature.plugin;
    const subject = this.feature.subject();
    if (subject instanceof TFolder && plugin.drawFolder) return void plugin.drawFolder(host, subject);
    if (!(subject instanceof TFile) || subject.extension !== 'md') return void sayso(host, { label: 'Nothing picked', text: 'A note’s properties show here, and a folder picked in the library.' });
    // A sheet: the note's name is on the page beside it, so the panel starts at its properties.
    this.properties(host, subject);
    this.feature.sections(subject).forEach((section) => {
      sectionTitle(host, { title: section.title });
      const list = rows(host);
      section.items.forEach((item) => row(list, { name: item.name, end: item.end, run: () => (item.run ? item.run() : this.app.workspace.getLeaf(false).openFile(item.file)) }));
    });
  }

  properties(host, file) {
    const plugin = this.feature.plugin;
    const settings = plugin.settings;
    const keys = ledgerKeys(plugin, file);
    const props = plugin.notes.props(file);
    const redraw = () => this.draw();
    if (!keys.length) {
      sectionTitle(host, { title: 'Properties' });
      return void sayso(host, { label: 'No properties', button: { text: 'Add a property', run: () => addProperty(plugin, file) } });
    }
    const grouped = settings.panelPropertyGroups && settings.panelPropertyGroups !== 'off' && Array.isArray(settings.panelGroupList);
    if (!grouped) {
      sectionTitle(host, { title: 'Properties' });
      return void keys.forEach((key) => ledgerRow(plugin, host, file, key, props[key], redraw));
    }
    // In the groups the person set: a press on a group's title folds it; what no group names, last, under Other.
    const find = (k) => keys.find((p) => p.toLowerCase() === k.toLowerCase());
    const used = new Set();
    const groups = settings.panelGroupList.map((g) => ({ title: String(g.title || ''), keys: listOf(g.keys).map(find).filter((k) => k && !used.has(k) && used.add(k)) }));
    groups.push({ title: 'Other', keys: keys.filter((k) => !used.has(k)) });
    const folded = Array.isArray(settings.panelFoldedGroups) ? settings.panelFoldedGroups : [];
    groups.filter((g) => g.keys.length).forEach((g) => {
      const shut = folded.includes(g.title);
      sectionTitle(host, { title: shut ? `${g.title} · ${g.keys.length}` : g.title, fold: { open: !shut, run: () => this.feature.foldGroup(g.title) } });
      if (!shut) g.keys.forEach((key) => ledgerRow(plugin, host, file, key, props[key], redraw));
    });
  }
}

export class Panel extends Feature {
  register() {
    this.plugin.registerView(PANEL_VIEW, (leaf) => new PanelView(leaf, this));
  }

  enable() {
    const ws = this.app.workspace;
    const draw = () => this.views().forEach((v) => v.draw());
    ['file-open', 'design-redux:pick', 'design-redux:props', 'design-redux:vault', 'design-redux:links', 'design-redux:settings', 'design-redux:reset-layout'].forEach((name) => this.listen(ws, name, name.endsWith('reset-layout') ? () => this.reveal() : draw));
    this.add(() => !this.plugin.unloading && ws.detachLeavesOfType(PANEL_VIEW));
  }

  views() {
    return this.app.workspace.getLeavesOfType(PANEL_VIEW).map((l) => l.view).filter((v) => v instanceof PanelView);
  }

  /** What the panel is about: the pick while it follows the library, else the open note. */
  subject() {
    const picked = this.settings.inspector !== false ? this.plugin.selection.item : null;
    return picked || this.app.workspace.getActiveFile();
  }

  async reveal() {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(PANEL_VIEW)[0];
    if (!leaf) {
      leaf = ws.getRightLeaf(false);
      if (!leaf) return null;
      await leaf.setViewState({ type: PANEL_VIEW, active: true });
    }
    ws.revealLeaf(leaf);
    return leaf;
  }

  /** Shows the panel, or closes it when it is showing. */
  async toggle() {
    const open = this.app.workspace.getLeavesOfType(PANEL_VIEW);
    if (open.length) return void open.forEach((l) => l.detach());
    await this.reveal();
  }


  /** Folds a group of the panel's properties, or opens it again. */
  async foldGroup(title) {
    const folded = (Array.isArray(this.settings.panelFoldedGroups) ? this.settings.panelFoldedGroups : []).slice();
    const at = folded.indexOf(title);
    if (at < 0) folded.push(title);
    else folded.splice(at, 1);
    this.settings.panelFoldedGroups = folded;
    await this.plugin.saveData(this.settings);
    this.views().forEach((v) => v.draw());
  }

  /** Sets the properties listed first for the notes of one folder; empty hands them back to the setting for everywhere. */
  async setFolderView(folder, main) {
    const views = Object.assign({}, this.settings.panelFolderViews);
    if (String(main || '').trim()) views[folder.path] = { main: String(main).trim() };
    else delete views[folder.path];
    this.settings.panelFolderViews = views;
    await this.plugin.saveSettings();
  }




  noteMenu(file, event) {
    const menu = new Menu();
    this.plugin.actions().filter((a) => a.on === 'note' && a.menu !== false && (!a.when || a.when({ file }))).forEach((a) => menu.addItem((i) => i.setTitle(typeof a.menu === 'string' ? a.menu : a.name).setSection('action').onClick(() => a.run({ file, from: 'panel' }))));
    return event && event.clientX ? menu.showAtMouseEvent(event) : menu.showAtPosition({ x: 0, y: 0 });
  }

  /** The panel's sections under a note's properties: [{ title, items: [{ name, end, file }] }]. */
  sections(file) {
    const { index } = this.plugin;
    const out = [];
    const incoming = index.incoming(file);
    if (this.settings.propertyLinks !== false) {
      const named = [];
      incoming.forEach((from) => {
        const cache = this.app.metadataCache.getFileCache(from) || {};
        (cache.frontmatterLinks || []).forEach((l) => {
          if (this.app.metadataCache.getFirstLinkpathDest(l.link, from.path) === file) named.push({ name: from.basename, end: String(l.key).split('.')[0], file: from });
        });
      });
      if (named.length) out.push({ title: 'Named in', items: named });
    }
    // A note's folder trails it only where the list mixes folders; where they share one it says nothing.
    const notes = (files) => {
      const ends = foldersIfMixed(files);
      return files.map((f, i) => ({ name: f.basename, end: ends[i], file: f }));
    };
    if (this.settings.showMentions !== false && incoming.length) out.push({ title: 'Mentioned in', items: notes(incoming) });
    const outgoing = index.outgoing(file).filter((f) => f.extension === 'md');
    if (outgoing.length) out.push({ title: 'Links to', items: notes(outgoing) });
    // Kept changes to its properties, newest first: a press puts that one value back.
    const history = this.plugin.historyOf ? this.plugin.historyOf(file) : [];
    if (history.length) out.push({ title: 'History', items: history.slice(0, 10).map((h) => ({ name: `${h.key}: ${valueText(h.was) || '—'} → ${valueText(h.now) || '—'}`, end: 'put back', file, run: () => this.plugin.putBackChange(file, h) })) });
    return out;
  }

  actions() {
    return [
      { id: 'open-properties', name: 'Open properties', run: () => this.reveal() },
      { id: 'open-inspector', name: 'Show or hide the panel', run: () => this.toggle() },
      { id: 'panel-folder-properties', name: 'Properties the panel lists first in this folder…', on: 'folder', menu: 'Panel’s first properties…', run: async (ctx) => {
        const now = (this.settings.panelFolderViews || {})[ctx.folder.path];
        const main = await ask(this.app, { title: `First in the panel, in ${ctx.folder.name}`, label: 'Properties, with commas between', value: now ? now.main : this.settings.panelPrimaryProps, action: 'Keep' });
        if (main !== null) await this.setFolderView(ctx.folder, main);
      } },
    ];
  }
}
Panel.key = 'propertiesDropdown';
Panel.title = 'Properties panel';
Panel.section = 'Panel';
Panel.about = 'The open note’s properties and connections, or the folder picked, in the right sidebar.';
