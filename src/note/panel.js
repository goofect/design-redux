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
import { iconId } from '../core/icons.js';
import { valuesOf } from '../core/notes.js';
import { listOf } from '../core/text.js';
import { headRow } from '../ui/head.js';
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

export class PanelView extends ItemView {
  constructor(leaf, feature) {
    super(leaf);
    this.feature = feature;
  }

  getViewType() { return PANEL_VIEW; }
  getDisplayText() { return 'Properties'; }
  getIcon() { return iconId('properties'); }
  async onOpen() { this.contentEl.classList.add('dr', 'dr-panel'); this.draw(); }

  draw() {
    const host = clear(this.contentEl);
    const plugin = this.feature.plugin;
    const subject = this.feature.subject();
    if (subject instanceof TFolder && plugin.drawFolder) return void plugin.drawFolder(host, subject);
    if (!(subject instanceof TFile) || subject.extension !== 'md') return void sayso(host, { glyph: 'properties', label: 'Nothing picked', text: 'A note’s properties show here, and a folder picked in the library.' });
    headRow(host, { label: subject.basename, buttons: [{ glyph: 'more', label: 'More', run: (e) => this.feature.noteMenu(subject, e) }] });
    this.properties(host, subject);
    this.feature.sections(subject).forEach((section) => {
      sectionTitle(host, { title: `${section.title} · ${section.items.length}` });
      const list = rows(host);
      section.items.forEach((item, i) => row(list, { number: i + 1, name: item.name, end: item.end, run: () => this.app.workspace.getLeaf(false).openFile(item.file) }));
    });
  }

  properties(host, file) {
    const plugin = this.feature.plugin;
    const props = plugin.notes.props(file);
    const first = listOf(plugin.settings.panelPrimaryProps).map((k) => Object.keys(props).find((p) => p.toLowerCase() === k.toLowerCase())).filter(Boolean);
    const keys = first.concat(Object.keys(props).filter((k) => !first.includes(k)));
    sectionTitle(host, { title: 'Properties', buttons: [{ glyph: 'plus', label: 'Add a property', run: () => this.feature.addProperty(file) }] });
    if (!keys.length) return void sayso(host, { glyph: 'properties', label: 'No properties', button: { text: 'Add a property', run: () => this.feature.addProperty(file) } }).classList.add('is-small');
    keys.forEach((key) => {
      const wrong = plugin.checkValue ? plugin.checkValue(file, key, props[key]) : null;
      const node = propRow(host, { name: key, value: valueText(props[key]), invalid: wrong, run: () => this.edit(node, file, key, props[key]) });
      node.dataset.key = key;
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.feature.propertyMenu(file, key).showAtMouseEvent(e);
      });
    });
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
    menu.addItem((i) => i.setTitle('Rename property…').setIcon(iconId('pencil')).setSection('action').onClick(async () => {
      const to = await ask(this.app, { title: `Rename ${key}`, value: key, action: 'Rename', check: (v) => (v !== key && v in this.plugin.notes.props(file) ? 'This note already has it.' : null) });
      if (!to || to === key) return;
      await this.plugin.notes.write(file, (fm) => {
        const entries = Object.keys(fm).map((k) => [k === key ? to : k, fm[k]]);
        Object.keys(fm).forEach((k) => delete fm[k]);
        entries.forEach(([k, v]) => (fm[k] = v));
      }, { undo: `${key} renamed to ${to}.` });
    }));
    menu.addItem((i) => i.setTitle('Remove property').setIcon(iconId('trash')).setSection('danger').onClick(() => this.plugin.notes.write(file, (fm) => delete fm[key], { undo: `${key} removed.` })));
    return menu;
  }

  noteMenu(file, event) {
    const menu = new Menu();
    this.plugin.actions().filter((a) => a.on === 'note' && a.menu !== false && (!a.when || a.when({ file }))).forEach((a) => menu.addItem((i) => i.setTitle(typeof a.menu === 'string' ? a.menu : a.name).setIcon(iconId(a.glyph)).setSection('action').onClick(() => a.run({ file, from: 'panel' }))));
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
    if (this.settings.showMentions !== false && incoming.length) out.push({ title: 'Mentioned in', items: incoming.map((f) => ({ name: f.basename, end: f.parent && f.parent.path !== '/' ? f.parent.name : '', file: f })) });
    const outgoing = index.outgoing(file).filter((f) => f.extension === 'md');
    if (outgoing.length) out.push({ title: 'Links to', items: outgoing.map((f) => ({ name: f.basename, end: f.parent && f.parent.path !== '/' ? f.parent.name : '', file: f })) });
    return out;
  }

  actions() {
    return [
      { id: 'open-properties', name: 'Open properties', glyph: 'properties', run: () => this.reveal() },
      { id: 'open-inspector', name: 'Show or hide the panel', glyph: 'inspector', run: () => this.toggle() },
    ];
  }

  settingsRows() {
    return [
      { key: 'inspector', name: 'Follow the library’s pick', desc: 'Off, the panel is always about the open note.', type: 'toggle' },
      { key: 'propertyLinks', name: 'Named in', desc: 'Where other notes name this one in a property.', type: 'toggle' },
      { key: 'showMentions', name: 'Mentioned in', type: 'toggle' },
    ];
  }
}
Panel.key = 'propertiesDropdown';
Panel.title = 'Properties panel';
Panel.glyph = 'properties';
Panel.section = 'Panel';
Panel.about = 'The open note’s properties and connections, or the folder picked, in the right sidebar.';
