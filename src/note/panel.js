/* ------------------------------------------------------------------ */
/* The panel: what is picked, or the open note, in the right sidebar   */
/*                                                                     */
/* For a note: its properties as plain rows, edited in place and       */
/* written through plugin.notes with an Undo; where other notes name   */
/* it in a property, grouped by the property; where it is mentioned;   */
/* what it links to. For a folder picked in the library: the folder's  */
/* detail. The note keeps its own properties block; the panel only     */
/* reads and writes the same properties.                               */
/* ------------------------------------------------------------------ */

import { ItemView, Menu, TFile, TFolder } from 'obsidian';
import { clear, el } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { valuesOf } from '../core/notes.js';
import { foldersIfMixed, listOf } from '../core/text.js';
import { propRow, row, rows, sectionTitle } from '../ui/row.js';
import { ask } from '../ui/sheet.js';
import { sayso } from '../ui/state.js';

export const PANEL_VIEW = 'design-redux-properties';

/** What was typed, as a value of the kind the property had: a list stays a list, a number a number. */
export function parseValue(text, was) {
  const t = String(text).trim();
  if (Array.isArray(was)) return t ? t.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (typeof was === 'number' && t !== '' && Number.isFinite(Number(t))) return Number(t);
  if (typeof was === 'boolean' && /^(true|false|yes|no)$/i.test(t)) return /^(true|yes)$/i.test(t);
  return t;
}

/** A value as the text it is edited as. */
export const valueText = (value) => valuesOf(value).join(', ');

/** A value as it is shown: a link as the name of what it links to. */
export const valueShown = (value) => valuesOf(value).map((v) => {
  const m = /^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]\s*$/.exec(v);
  return m ? (m[2] || m[1].split('/').pop()) : v;
}).join(', ');

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
    const props = plugin.notes.props(file);
    const all = Object.keys(props);
    const find = (k) => all.find((p) => p.toLowerCase() === k.toLowerCase());
    const first = listOf(this.feature.primaryProps(file)).map(find).filter(Boolean);
    const keys = first.concat(all.filter((k) => !first.includes(k)));
    // No buttons: a property is added by its command or a row's menu, and the note's actions are a right press away.
    const buttons = [];
    if (!keys.length) {
      sectionTitle(host, { title: 'Properties', buttons });
      return void sayso(host, { label: 'No properties', button: { text: 'Add a property', run: () => this.feature.addProperty(file) } });
    }
    const grouped = settings.panelPropertyGroups && settings.panelPropertyGroups !== 'off' && Array.isArray(settings.panelGroupList);
    if (!grouped) {
      sectionTitle(host, { title: 'Properties', buttons });
      return void keys.forEach((key) => this.propertyRow(host, file, key, props[key]));
    }
    // In the groups the person set: a press on a group's title folds it; what no group names, last, under Other.
    const used = new Set();
    const groups = settings.panelGroupList.map((g) => ({ title: String(g.title || ''), keys: listOf(g.keys).map(find).filter((k) => k && !used.has(k) && used.add(k)) }));
    groups.push({ title: 'Other', keys: keys.filter((k) => !used.has(k)) });
    const folded = Array.isArray(settings.panelFoldedGroups) ? settings.panelFoldedGroups : [];
    groups.filter((g) => g.keys.length).forEach((g, i) => {
      const shut = folded.includes(g.title);
      sectionTitle(host, { title: shut ? `${g.title} · ${g.keys.length}` : g.title, fold: { open: !shut, run: () => this.feature.foldGroup(g.title) }, buttons: i === 0 ? buttons : [] });
      if (!shut) g.keys.forEach((key) => this.propertyRow(host, file, key, props[key]));
    });
  }

  /** One property's row: edited where it stands, a menu of its own, a mark where its folder's schema says it is wrong. */
  propertyRow(host, file, key, value) {
    const plugin = this.feature.plugin;
    const wrong = plugin.checkValue ? plugin.checkValue(file, key, value) : null;
    const node = propRow(host, { name: key, value: valueShown(value), invalid: wrong, run: () => this.edit(node, file, key, value) });
    node.dataset.key = key;
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.feature.propertyMenu(file, key).showAtMouseEvent(e);
    });
    return node;
  }

  /** Edits a value where it stands: Enter writes it, Escape leaves it. */
  edit(node, file, key, was) {
    const cell = node.querySelector('.dr-prop-value');
    if (!cell || cell.querySelector('input')) return;
    const input = this.contentEl.ownerDocument.createElement('input');
    input.className = 'dr-input';
    input.type = 'text';
    input.value = valueText(was);
    input.setAttribute('aria-label', key);
    clear(cell).appendChild(input);
    let done = false;
    const finish = async (write) => {
      if (done) return;
      done = true;
      if (write && input.value !== valueText(was)) await this.feature.setValue(file, key, parseValue(input.value, was));
      this.draw();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.focus();
    input.select();
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

  /** The properties the panel lists first: those set for the note's folder (or the nearest above it that has some), else everywhere's. */
  primaryProps(file) {
    const views = this.settings.panelFolderViews || {};
    for (let dir = file.parent; dir && dir.path !== '/'; dir = dir.parent) {
      const view = views[dir.path];
      if (view && typeof view.main === 'string') return view.main;
    }
    return this.settings.panelPrimaryProps;
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

  setValue(file, key, value) {
    return this.plugin.notes.write(file, (fm) => (fm[key] = value), { undo: `${key} changed.` });
  }

  async addProperty(file) {
    const key = await ask(this.app, { title: 'Add a property', label: 'Its name', placeholder: 'status', action: 'Add', check: (v) => (v in this.plugin.notes.props(file) ? 'This note already has it.' : null) });
    if (!key) return;
    await this.plugin.notes.write(file, (fm) => (fm[key] = ''), { undo: `${key} added.` });
  }

  propertyMenu(file, key) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Rename property…').setSection('action').onClick(async () => {
      const to = await ask(this.app, { title: `Rename ${key}`, value: key, action: 'Rename', check: (v) => (v !== key && v in this.plugin.notes.props(file) ? 'This note already has it.' : null) });
      if (!to || to === key) return;
      await this.plugin.notes.write(file, (fm) => {
        const entries = Object.keys(fm).map((k) => [k === key ? to : k, fm[k]]);
        Object.keys(fm).forEach((k) => delete fm[k]);
        entries.forEach(([k, v]) => (fm[k] = v));
      }, { undo: `${key} renamed to ${to}.` });
    }));
    menu.addItem((i) => i.setTitle('Remove property').setSection('danger').onClick(() => this.plugin.notes.write(file, (fm) => delete fm[key], { undo: `${key} removed.` })));
    return menu;
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
      { id: 'add-property', name: 'Add a property to this note', on: 'note', menu: 'Add a property…', run: (ctx) => this.addProperty(ctx.file) },
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
