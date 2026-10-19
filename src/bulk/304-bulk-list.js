/* ------------------------------------------------------------------ */
/* Bulk: the property list, and the tools menu                        */
/*                                                                    */
/* Every property in some notes, and the menu of the bulk tools.      */
/* ------------------------------------------------------------------ */

import { Menu, Modal, setIcon, TFolder } from 'obsidian';
import { TYPE_ICONS } from '../core/020-constants.js';
import { byName, composing, onContextMenu, showMenuAt } from '../core/030-helpers-art.js';
import { asButton, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { plainValue } from '../core/045-helpers-properties.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { noteProps } from '../core/073-notes.js';
import { propertyType, renamePropertyInPlace } from './290-bulk-engine.js';
import { BulkModal, whereHolds, whereReady } from './300-bulk-dialogs.js';
import { AddPropertiesModal, FolderDefaultsModal, MergePropertiesModal, RemovePropertiesModal, RenamePropertyModal } from './301-bulk-properties.js';
import { ChangeTypeModal, MissingPropertyModal } from './303-bulk-types.js';
import { CleanUpValuesModal, SchemaCheckModal } from './305-bulk-schema.js';

/**
 * Each property in some notes, as a note's properties would be listed:
 * the values it holds, how many of the notes have it, and a way to fill
 * it in for the rest. A name is renamed where it's shown; its menu has
 * the rest; several picked can be merged or removed together.
 */
export function propertyOverview(app, files) {
  const all = new Map();
  files.forEach((file) => {
    const fm = noteProps(app, file);
    Object.keys(fm).forEach((key) => {
      if (key === 'position') return;
      const low = key.toLowerCase();
      if (!all.has(low)) all.set(low, { name: key, count: 0, values: [], seen: new Set(), more: false });
      const entry = all.get(low);
      entry.count++;
      const raw = fm[key];
      (Array.isArray(raw) ? raw : [raw]).forEach((v) => {
        if (v === null || v === undefined || v === '' || typeof v === 'object') return;
        const text = plainValue(v);
        const k = String(text).toLowerCase();
        if (!text || entry.seen.has(k)) return;
        entry.seen.add(k);
        if (entry.values.length < 4) entry.values.push(text);
        else entry.more = true;
      });
    });
  });
  return Array.from(all.values())
    .map((e) => ({ name: e.name, count: e.count, values: e.values, more: e.more }))
    .sort((a, b) => b.count - a.count || byName(a.name, b.name));
}

export class PropertyListTool extends BulkModal {
  constructor(plugin, targets, host) {
    super(plugin);
    (targets || []).forEach((t) => this.addTarget(t));
    this.host = host;
    this.picks = new Set();
  }

  /** The notes listed: those chosen, or every note while none are — meeting the conditions. */
  files() {
    if (this.targets.length) return this.notes();
    const rows = this.where.filter(whereReady);
    return this.app.vault.getMarkdownFiles().filter((file) => {
      const fm = rows.length ? noteProps(this.app, file) : {};
      return rows.every((row) => whereHolds(fm, row));
    });
  }

  onOpen() {
    this.modalEl.addClass('dr-bulk-modal');
    this.contentEl.empty();
    this.body = this.contentEl.createDiv({ cls: 'dr-bulk-body dr-plist' });
    const where = this.targetsSection('');
    where.addClass('dr-plist-where');
    this.countEl = where.createSpan({ cls: 'dr-plist-count' });
    this.listEl = this.body.createDiv({ cls: 'dr-plist-list' });
    this.footEl = this.contentEl.createDiv({ cls: 'dr-plist-foot' });
    this.update();
  }

  /** With none chosen, every note: said so, with the + beside it to narrow it. */
  renderTargets() {
    super.renderTargets();
    if (this.targets.length || !this.targetsEl) return;
    const all = this.targetsEl.createDiv({ cls: 'dr-bulk-chip is-all' });
    setIcon(all.createSpan({ cls: 'dr-bulk-chip-icon' }), 'library');
    all.createSpan({ cls: 'dr-bulk-chip-name', text: 'All notes' });
    this.targetsEl.prepend(all);
    const pick = this.targetsEl.querySelector('.dr-bulk-chip.is-add');
    if (pick) {
      pick.addClass('is-icon');
      pick.empty();
      setIcon(pick.createSpan({ cls: 'dr-bulk-chip-icon' }), 'plus');
      pick.setAttribute('aria-label', 'Choose a folder');
    }
  }

  update() {
    if (!this.listEl) return;
    const files = this.files();
    const total = files.length;
    const props = propertyOverview(this.app, files);
    this.countEl.setText(bulkCount(total, 'note'));
    Array.from(this.picks).forEach((name) => {
      if (!props.some((p) => p.name === name)) this.picks.delete(name);
    });

    const list = this.listEl;
    list.empty();
    if (!props.length) {
      list.addClass('is-empty');
      list.createDiv({ cls: 'dr-plist-empty', text: total ? 'These notes have no properties yet.' : 'There are no notes here.' });
    } else list.removeClass('is-empty');
    roveFocus(list, '.dr-plist-row');

    props.forEach((prop) => {
      const row = list.createDiv({ cls: 'dr-plist-row' });
      row.setAttribute('tabindex', '-1');
      row.toggleClass('is-picked', this.picks.has(prop.name));

      const pick = row.createDiv({ cls: 'dr-plist-pick' });
      pick.setAttribute('role', 'checkbox');
      pick.setAttribute('tabindex', '0');
      pick.setAttribute('aria-checked', String(this.picks.has(prop.name)));
      if (this.picks.has(prop.name)) setIcon(pick, 'check');
      onActivate(pick, () => {
        if (this.picks.has(prop.name)) this.picks.delete(prop.name);
        else this.picks.add(prop.name);
        this.update();
      });

      const icon = row.createDiv({ cls: 'dr-plist-icon' });
      setIcon(icon, TYPE_ICONS[propertyType(this.app, prop.name)] || 'text');

      // The name, and under it the values it holds — as a track's
      // artist sits under its title.
      const text = row.createDiv({ cls: 'dr-plist-text' });
      const name = text.createDiv({ cls: 'dr-plist-name', text: prop.name });
      asButton(name);
      onActivate(name, () => this.startRename(row, name, prop));
      const values = text.createDiv({
        cls: 'dr-plist-values',
        text: prop.values.length ? prop.values.join(', ') + (prop.more ? ', …' : '') : 'No values yet',
      });
      if (!prop.values.length) values.addClass('is-none');

      const missing = total - prop.count;
      if (missing > 0) {
        const fill = row.createEl('button', { cls: 'dr-plist-fill', text: `Fill in ${missing}` });
        fill.addEventListener('click', () => this.host.openSheet('missing', { key: prop.name }));
      }
      row.createDiv({ cls: 'dr-plist-cover', text: `${prop.count} of ${total}` });

      const more = row.createDiv({ cls: 'clickable-icon dr-plist-more' });
      asButton(more, `More for ${prop.name}`);
      setIcon(more, 'more-horizontal');
      const menu = (evt) => this.propertyMenu(evt, row, name, prop, missing);
      more.addEventListener('click', menu);
      onContextMenu(row, menu);
    });

    this.renderFoot();
  }

  renderFoot() {
    const foot = this.footEl;
    foot.empty();
    const n = this.picks.size;
    if (n) {
      foot.createSpan({ cls: 'dr-plist-picked', text: `${n} picked` });
      const clear = foot.createEl('button', { cls: 'dr-plist-clear', text: 'Clear' });
      clear.addEventListener('click', () => {
        this.picks.clear();
        this.update();
      });
      const names = Array.from(this.picks);
      const remove = foot.createEl('button', { cls: 'mod-warning dr-plist-remove', text: 'Remove' });
      remove.addEventListener('click', () => this.host.openSheet('remove', { keys: names }));
      const merge = foot.createEl('button', { cls: 'mod-cta dr-plist-merge' });
      setIcon(merge.createSpan({ cls: 'dr-plist-btn-icon' }), 'git-merge');
      merge.createSpan({ text: 'Merge…' });
      merge.disabled = n < 2;
      merge.toggleClass('is-disabled', n < 2);
      if (n < 2) merge.setAttribute('aria-label', 'Pick another to merge them');
      merge.addEventListener('click', () => {
        if (this.picks.size > 1) this.host.openSheet('merge', { keys: names });
      });
      return;
    }
    const add = foot.createEl('button', { cls: 'dr-plist-add' });
    setIcon(add.createSpan({ cls: 'dr-plist-btn-icon' }), 'plus');
    add.createSpan({ text: 'Add property' });
    add.addEventListener('click', () => this.host.openSheet('add'));
    const folder = this.host.folderOf(this.targets);
    if (folder) {
      const defaults = foot.createEl('button', { cls: 'dr-plist-defaults' });
      setIcon(defaults.createSpan({ cls: 'dr-plist-btn-icon' }), 'file-cog');
      defaults.createSpan({ text: 'Defaults for new notes' });
      defaults.addEventListener('click', () => this.host.openSheet('defaults'));
    }
    if (Object.keys(this.plugin.settings.propertySchemas || {}).length) {
      const check = foot.createEl('button', { cls: 'dr-plist-schema' });
      setIcon(check.createSpan({ cls: 'dr-plist-btn-icon' }), 'list-checks');
      check.createSpan({ text: 'Check against schemas' });
      check.addEventListener('click', () => this.host.openSheet('schema'));
    }
  }

  propertyMenu(evt, row, name, prop, missing) {
    evt.preventDefault();
    evt.stopPropagation();
    const menu = new Menu();
    const item = (title, icon, run, warn) =>
      menu.addItem((i) => {
        i.setTitle(title).setIcon(icon).onClick(run);
        if (warn && typeof i.setWarning === 'function') i.setWarning(true);
      });
    item('Rename', 'pencil', () => this.startRename(row, name, prop));
    item('Merge with…', 'git-merge', () => this.host.openSheet('merge', { keys: [prop.name] }));
    if (missing > 0) {
      item(`Fill in the ${missing} without it…`, 'list-checks', () => this.host.openSheet('missing', { key: prop.name }));
    }
    item('Change type…', 'shapes', () => this.host.openSheet('type', { key: prop.name }));
    item('Clean up values…', 'sparkles', () => this.host.openSheet('cleanup', { key: prop.name }));
    menu.addSeparator();
    item('Remove from these notes…', 'trash-2', () => this.host.openSheet('remove', { keys: [prop.name] }), true);
    showMenuAt(menu, evt);
  }

  /**
   * The name as a field, where it's shown. Enter renames it in every
   * note — or, left as it is, writes it that way in notes that spell it
   * otherwise; Escape puts it back.
   */
  startRename(row, nameEl, prop) {
    if (row.querySelector('input.dr-plist-name-edit')) return;
    const input = nameEl.parentElement.createEl('input', { cls: 'dr-plist-name-edit', type: 'text' });
    input.value = prop.name;
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('aria-label', `Rename ${prop.name}`);
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (!keep || !value) {
        input.replaceWith(nameEl);
        return;
      }
      this.rename(prop.name, value);
    };
    input.addEventListener('keydown', (evt) => {
      if (composing(evt)) return;
      if (evt.key === 'Enter') {
        evt.preventDefault();
        finish(true);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(input.value.trim() !== prop.name));
  }

  /** Renamed everywhere, with Undo; one that needs a look first opens the rename. */
  async rename(from, to) {
    const record = await renamePropertyInPlace(this.bulk, from, to, {
      redraw: () => this.update(),
      review: () => this.host.openSheet('rename', { key: from, to }),
      picks: this.picks,
    });
    if (record) this.update();
  }
}

/**
 * The Properties window: the list of properties in some notes, and
 * each tool — adding, removing, filling in, defaults, renaming, merging,
 * changing a type — opening over it as a sheet, with a way back.
 */
export class PropertyToolsModal extends Modal {
  constructor(plugin, targets, tab, args) {
    super(plugin.app);
    this.plugin = plugin;
    this.targets = (targets || []).slice();
    this.reach = 'deep';
    this.tab = tab || null;
    this.args = args || {};
    this.tool = null;
    this.sheet = null;
  }

  /** The one folder the notes are, for its defaults. */
  folderOf(targets) {
    const only = targets.length === 1 ? targets[0] : null;
    return only instanceof TFolder && !only.isRoot() ? only : null;
  }

  make(id, args) {
    const targets = this.targets;
    args = args || {};
    if (id === 'add') return new AddPropertiesModal(this.plugin, targets);
    if (id === 'remove') return new RemovePropertiesModal(this.plugin, targets, args.keys);
    if (id === 'missing') return new MissingPropertyModal(this.plugin, targets, args.key);
    if (id === 'defaults') {
      const folder = this.folderOf(targets);
      return folder ? new FolderDefaultsModal(this.plugin, folder) : null;
    }
    if (id === 'rename') return new RenamePropertyModal(this.plugin, args.key, args.to);
    if (id === 'merge') return new MergePropertiesModal(this.plugin, args.keys || (args.key ? [args.key] : []));
    if (id === 'type') return new ChangeTypeModal(this.plugin, args.key);
    if (id === 'schema') return new SchemaCheckModal(this.plugin, targets);
    if (id === 'cleanup') return new CleanUpValuesModal(this.plugin, args.key);
    return null;
  }

  onOpen() {
    this.modalEl.addClass('dr-bulk-modal', 'dr-props-modal');
    this.titleEl.setText('Properties');
    this.panel = this.contentEl.createDiv({ cls: 'dr-props-panel' });
    // The list keeps up with the notes as changes land in them.
    this.watch = this.app.metadataCache.on('changed', () => {
      window.clearTimeout(this.watchTimer);
      this.watchTimer = window.setTimeout(() => {
        if (!this.sheet && this.tool && typeof this.tool.update === 'function') this.tool.update();
      }, 250);
    });
    if (this.tab && this.make(this.tab, this.args)) this.openSheet(this.tab, this.args);
    else this.showList();
  }

  /** The folders and notes, and which of their notes, from whatever showed them last. */
  keepChoice() {
    const tool = this.tool;
    if (!tool || !Array.isArray(tool.targets) || !tool.targetsEl) return;
    this.targets = tool.targets.slice();
    if (tool.reach) this.reach = tool.reach;
  }

  closeTool() {
    if (!this.tool) return;
    this.keepChoice();
    try {
      this.tool.onClose();
    } catch (err) {
      /* it was only drawing */
    }
    this.tool = null;
  }

  mount(tool, container, asSheet) {
    tool.reach = this.reach;
    tool.modalEl = this.modalEl;
    tool.titleEl = document.createElement('div');
    tool.contentEl = container;
    // A sheet's Cancel, or its change once made, goes back to the list.
    tool.close = asSheet ? () => this.showList() : () => this.close();
    this.tool = tool;
    tool.onOpen();
  }

  showList() {
    this.closeTool();
    this.sheet = null;
    this.modalEl.removeClass('is-sheet');
    this.titleEl.empty();
    this.titleEl.setText('Properties');
    this.panel.empty();
    this.mount(new PropertyListTool(this.plugin, this.targets, this), this.panel, false);
    // Opened, nothing in particular is focused — not the first chip's ×,
    // which Obsidian would pick once the window is up.
    window.setTimeout(() => {
      const active = this.contentEl.ownerDocument.activeElement;
      if (active && active.matches && active.matches('.dr-bulk-chip-remove') && typeof active.blur === 'function') active.blur();
    }, 0);
  }

  /** A tool over the list: its name for the title, with the way back before it. */
  openSheet(id, args) {
    const tool = this.make(id, args);
    if (!tool) return;
    this.closeTool();
    this.sheet = id;
    this.modalEl.addClass('is-sheet');
    this.panel.empty();
    this.mount(tool, this.panel, true);
    const name = tool.titleEl.textContent || 'Properties';
    this.titleEl.empty();
    const back = this.titleEl.createEl('button', { cls: 'dr-sheet-back' });
    setIcon(back, 'chevron-left');
    back.setAttribute('aria-label', 'Back to the properties');
    back.addEventListener('click', () => this.showList());
    this.titleEl.createSpan({ cls: 'dr-sheet-title', text: name });
  }

  onClose() {
    window.clearTimeout(this.watchTimer);
    if (this.watch) this.app.metadataCache.offref(this.watch);
    this.closeTool();
    this.contentEl.empty();
  }
}
