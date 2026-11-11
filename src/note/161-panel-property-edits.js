/* ------------------------------------------------------------------ */
/* Properties: what's changed in them                                  */
/*                                                                     */
/* PropertiesSection, in two parts: the rows drawn are PropertyRows    */
/* (160); this adds, removes, renames, reorders and writes them, and   */
/* redraws after a write.                                              */
/* ------------------------------------------------------------------ */

import { Menu, Notice, Platform, setIcon } from 'obsidian';
import { TYPE_ICONS, TYPE_LABELS } from '../core/020-constants.js';
import { menuGroup } from '../core/036-menus.js';
import { composing } from '../core/042-controls.js';
import { fmGet } from '../core/045-helpers-properties.js';
import { noteProps, orderKeys } from '../core/073-notes.js';
import { ask } from '../core/081-capabilities.js';
import { asType, schemaFor } from '../core/086-property-schema.js';
import { PropertyRows } from './160-panel-properties.js';

/** What a property the folder's schema names starts as: its default in the schema's type, or empty. */
function schemaDefault(entry) {
  if (entry.default === undefined) return '';
  const value = entry.type ? asType(entry.type, entry.default) : JSON.parse(JSON.stringify(entry.default));
  return value === undefined ? '' : value;
}

export class PropertiesSection extends PropertyRows {
  /**
   * Take a property off the note, saying so with an Undo that puts it
   * back — its value and its place — since the note has no undo of its
   * own for this.
   */
  async remove(key) {
    const file = this.file;
    const done = await this.plugin.notes.write(file, (fm) => delete fm[key], {
      undo: `Removed “${key}”.`,
      onUndo: () => this.file === file && this.afterWrite(file),
    });
    if (done) this.afterWrite(file);
  }

  /**
   * Adding a property: a small searchable list under the heading, the
   * names most used first and those the note has left out, Create for a
   * new one; chosen, the property is added and its value is next.
   */
  openAddPicker() {
    if (!this.containerEl) return;
    const old = this.containerEl.querySelector('.dr-add');
    if (old) {
      const field = old.querySelector('input');
      if (field) field.focus();
      return;
    }
    const head = this.containerEl.querySelector('.dr-props-head');
    const picker = head ? head.ownerDocument.createElement('div') : this.containerEl.createDiv();
    picker.className = 'dr-add';
    if (head) head.after(picker);
    const input = picker.createEl('input', { type: 'text', cls: 'dr-add-search' });
    input.placeholder = 'Search properties…';
    input.setAttribute('aria-label', 'Add property');
    const list = picker.createDiv({ cls: 'dr-add-list' });
    list.setAttribute('role', 'listbox');

    const have = Object.keys(this.frontmatter).map((k) => k.toLowerCase());
    // The folder's schema first: what it names that the note hasn't yet, each with its default.
    const asked = schemaFor(this.settings.propertySchemas, this.file).filter((e) => have.indexOf(e.key.toLowerCase()) === -1);
    const askedNames = asked.map((e) => e.key.toLowerCase());
    const known = this.knownProperties().filter((n) => have.indexOf(n.toLowerCase()) === -1 && askedNames.indexOf(n.toLowerCase()) === -1);
    let items = [];
    let active = 0;
    const close = () => picker.remove();
    const choose = (name, value) => {
      close();
      this.commitAdd(name, value);
    };
    const paint = () =>
      Array.from(list.querySelectorAll('.dr-add-item')).forEach((el, i) => {
        el.toggleClass('is-selected', i === active);
        el.setAttribute('aria-selected', String(i === active));
      });
    let drawnFor = null;
    const draw = () => {
      const q = input.value.trim();
      drawnFor = q;
      const low = q.toLowerCase();
      const own = asked.filter((e) => !low || e.key.toLowerCase().includes(low));
      const names = known.filter((n) => !low || n.toLowerCase().includes(low)).slice(0, 8);
      const exact = known.concat(Object.keys(this.frontmatter), asked.map((e) => e.key)).some((n) => n.toLowerCase() === low);
      items = own
        .map((e) => ({ name: e.key, label: e.key, value: schemaDefault(e) }))
        .concat(names.map((n) => ({ name: n, label: n })))
        .concat(q && !exact ? [{ name: q, label: `Create “${q}”`, create: true }] : !q ? [{ name: '', label: 'Create new property', create: true }] : []);
      active = Math.min(active, Math.max(0, items.length - 1));
      list.empty();
      items.forEach((item, i) => {
        if (i === 0 && own.length) list.createDiv({ cls: 'dr-add-heading', text: 'This folder' });
        if (i === own.length && names.length) list.createDiv({ cls: 'dr-add-heading', text: low ? 'Properties' : 'Suggested' });
        const el = list.createDiv({ cls: `dr-add-item${item.create ? ' is-create' : ''}` });
        el.setAttribute('role', 'option');
        if (item.create) setIcon(el.createSpan({ cls: 'dr-add-item-icon' }), 'plus');
        el.createSpan({ text: item.label });
        // mousedown, not click: the field's blur would close the list first.
        el.addEventListener('mousedown', (evt) => {
          evt.preventDefault();
          active = i;
          pick();
        });
      });
      paint();
    };
    const pick = () => {
      // What's typed is what's chosen from, even before the list caught up.
      if (input.value.trim() !== drawnFor) draw();
      const item = items[active];
      // Nothing listed — a name the note has already, say: as typed.
      if (!item) {
        if (input.value.trim()) choose(input.value);
        return;
      }
      // Create with nothing typed: the field is where its name goes.
      if (item.create && !item.name) {
        input.focus();
        return;
      }
      choose(item.name, item.value);
    };
    input.addEventListener('input', () => {
      active = 0;
      draw();
    });
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
        evt.preventDefault();
        active = Math.max(0, Math.min(items.length - 1, active + (evt.key === 'ArrowDown' ? 1 : -1)));
        paint();
      } else if (evt.key === 'Enter' && !composing(evt)) {
        evt.preventDefault();
        pick();
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        close();
      }
    });
    input.addEventListener('blur', () => window.setTimeout(() => picker.isConnected && !picker.contains(picker.ownerDocument.activeElement) && close(), 150));
    draw();
    input.focus();
  }

  /** A property added by name, with `value` or empty: one the note already has is gone to instead of written over. */
  commitAdd(name, value = '') {
    const key = String(name || '').trim();
    if (!key) return;
    const have = Object.keys(this.frontmatter).find((k) => k !== 'position' && k.toLowerCase() === key.toLowerCase());
    if (have) {
      const row = this.containerEl.querySelector(`.dr-row[data-key="${CSS.escape(have)}"]`);
      const target = row && row.querySelector('.dr-value input, .dr-value [contenteditable], .dr-value textarea');
      if (target) target.focus();
      new Notice(`This note already has "${have}".`);
      return;
    }
    // Shown, whatever the view, and its value is what's typed next.
    this.focusKey = key;
    if ((this.settings.panelPropertiesView || 'compact') === 'compact') this.settings.panelPropertiesView = 'all';
    this.write(key, value, { onlyNew: true });
  }

  /**
   * A property's menu, kept to five: its type, its name, the notes that
   * share it, what reaches other notes — all a press further — and taking
   * it off this note. Moving is the grip's (and Alt+arrows'); on touch,
   * where dragging is harder to aim, it's here too. A note a value names
   * opens as its link does.
   */
  showMenu(key, anchorEl) {
    const menu = new Menu();
    const current = this.typeOf(key);
    const sectioned = (item, section) => (typeof item.setSection === 'function' ? item.setSection(section) : item);
    const group = (title, icon, section, entries) =>
      menuGroup(
        menu,
        title,
        icon,
        (m, nested) =>
          entries.forEach(([short, long, run, checked]) =>
            m.addItem((item) => {
              item.setTitle(nested ? short : long).onClick(run);
              if (checked !== undefined) item.setChecked(checked);
              if (!nested) sectioned(item, section);
            })
          ),
        section
      );

    // Type, kept by Obsidian for every note.
    const setType = (type) => () => {
      try {
        this.app.metadataTypeManager.setType(key, type);
        this.forceRefresh();
      } catch (err) {
        console.error('Design Redux: could not set the type', err);
      }
    };
    group('Type', TYPE_ICONS[current] || 'shapes', 'edit', Object.keys(TYPE_ICONS).map((type) => [TYPE_LABELS[type], `Type: ${TYPE_LABELS[type]}`, setType(type), type === current]));
    // Renamed here: its name, ready to type over. Across the vault is a press further.
    menu.addItem((item) =>
      sectioned(item, 'edit')
        .setTitle('Rename')
        .setIcon('pencil')
        .onClick(() => {
          const name = this.containerEl && this.containerEl.querySelector(`.dr-row[data-key="${CSS.escape(key)}"] .dr-key-name`);
          if (!name) return;
          name.focus();
          name.select();
        })
    );
    // A note linked from it: picked, or made.
    const held = this.file ? fmGet(noteProps(this.app, this.file), key) : undefined;
    const links = (Array.isArray(held) ? held : [held]).some((v) => /\[\[/.test(String(v === null || v === undefined ? '' : v)));
    if (this.settings.propertyLinks !== false && links && ['text', 'multitext'].indexOf(current) !== -1) {
      menu.addItem((item) =>
        sectioned(item, 'edit')
          .setTitle('Link a note…')
          .setIcon('link')
          .onClick(() => this.linkNote(key, current))
      );
    }
    if (Platform.isMobile) {
      const row = anchorEl.closest('.dr-row');
      const rows = row && row.parentElement ? Array.from(row.parentElement.querySelectorAll(':scope > .dr-row')) : [];
      const at = rows.indexOf(row);
      [['Move up', 'arrow-up', -1, at > 0], ['Move down', 'arrow-down', 1, at !== -1 && at < rows.length - 1]].forEach(([title, icon, delta, possible]) => {
        if (possible) menu.addItem((item) => sectioned(item, 'edit').setTitle(title).setIcon(icon).onClick(() => this.moveRow(row, delta)));
      });
    }

    // The notes that share it.
    const find = this.findEntries(key);
    const finds = find.values.map(([value, run]) => [find.values.length === 1 ? 'With this value' : `With “${value}”`, find.values.length === 1 ? 'Notes with this value' : `Notes with “${value}”`, run]);
    if (find.all) finds.push(['With this property', 'Notes with this property', find.all]);
    if (finds.length) group('Find notes', 'search', 'find', finds);

    // What changes other notes: each shown before it's done.
    const manage = this.manageEntries(key).map(([short, long, , run]) => [short, long, run]);
    if (manage.length) group('Across the vault', 'globe', 'vault', manage);

    menu.addItem((item) => sectioned(item, 'remove').setTitle('Remove').setIcon('trash-2').onClick(() => this.remove(key)));

    const r = anchorEl.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  /**
   * The notes that share it, in the Properties screen: `values`, each of
   * this note's values — a list's first three — as [value, run]; and
   * `all`, every note with the property. None without the library.
   */
  findEntries(key) {
    const out = { values: [], all: null };
    const library = ask(this.plugin, 'library');
    if (!library || !library.enabled) return out;
    // The Properties screen knows a property by Obsidian's key for it, in lower case.
    const open = (value) => library.browseMode({ mode: 'properties', property: String(key).toLowerCase(), value: value || null });
    const raw = noteProps(this.app, this.file)[key];
    (Array.isArray(raw) ? raw : [raw])
      .map((v) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v)))
      .map((v) => v.replace(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/, '$1').trim())
      .filter((v) => v && v.length <= 60)
      .slice(0, 3)
      .forEach((v) => out.values.push([v, () => open(v)]));
    out.all = () => open(null);
    return out;
  }

  /**
   * What changes other notes, each [short title, title when not nested,
   * icon, run] — each shown first, with Undo: renaming it everywhere,
   * applying it to the collection, merging it with another property,
   * taking it out of every note.
   */
  manageEntries(key) {
    const out = [];
    const bulk = ask(this.plugin, 'propertyTools');
    if (bulk) out.push(['Rename everywhere…', `Rename ${key} everywhere…`, 'pencil', () => bulk.openRenameProperty(key)]);
    const album = ask(this.plugin, 'albumProperty');
    const file = this.file;
    if (album && album.enabled && file && album.albumNotes(file).length) {
      out.push([`Apply to ${album.albumName(file)}…`, `Apply ${key} to all of ${album.albumName(file)}…`, 'layers', () => album.apply(file, key)]);
    }
    if (bulk) {
      out.push(['Merge with…', `Merge ${key} with…`, 'git-merge', () => bulk.openMerge([key])]);
      out.push(['Remove everywhere…', `Remove ${key} everywhere…`, 'list-minus', () => bulk.openRemove([this.app.vault.getRoot()], [key])]);
    }
    return out;
  }

  /**
   * Single write path. undefined removes the key. `onlyNew` adds a
   * property only if the file doesn't have it — checked in the file
   * itself, since the cache can be a moment behind. A value edited in
   * its own field isn't redrawn: the field already shows it, and a
   * redraw would take the one being moved into.
   */
  async write(key, value, opts = {}) {
    const file = this.file;
    const done = await this.plugin.notes.write(file, (fm) => {
      if (opts.onlyNew && Object.keys(fm).some((k) => k.toLowerCase() === key.toLowerCase())) return;
      if (value === undefined) delete fm[key];
      else fm[key] = value;
    });
    if (done && opts.redraw !== false) this.afterWrite(file);
  }

  /**
   * Redraw once Obsidian has read the file back. processFrontMatter
   * resolves before the metadata cache catches up, so redrawing at
   * once showed the old values. Focus goes back where it was.
   */
  afterWrite(file) {
    if (this.file !== file) return;
    const cache = this.app.metadataCache;
    if (!cache || typeof cache.on !== 'function') return this.redraw();
    let done = false;
    let timer = 0;
    const ref = cache.on('changed', (changed) => {
      if (changed === file) finish();
    });
    const finish = () => {
      if (done) return;
      done = true;
      cache.offref(ref);
      window.clearTimeout(timer);
      if (this.file === file) this.redraw();
    };
    timer = window.setTimeout(finish, 1500);
  }

  /** forceRefresh, putting focus back on the same row's same field. */
  redraw() {
    if (!this.containerEl) return;
    const active = document.activeElement;
    const inside = active && this.containerEl.contains(active);
    const row = inside ? active.closest('.dr-row') : null;
    const key = row ? row.dataset.key : null;
    const part = !inside
      ? null
      : active.classList.contains('dr-key-name')
      ? '.dr-key-name'
      : active.classList.contains('dr-key-icon')
      ? '.dr-key-icon'
      : active.closest('.dr-add')
      ? '.dr-add input'
      : null;
    this.forceRefresh();
    if (!part) return;
    const again = key && part !== '.dr-add input'
      ? this.containerEl.querySelector(`.dr-row[data-key="${CSS.escape(key)}"] ${part}`)
      : this.containerEl.querySelector(part);
    if (again) again.focus();
  }

  /**
   * Rebuilt in place so ordering survives: re-adding a renamed key
   * would otherwise move it to the end of the block. A name another
   * property already has is refused — writing it would overwrite that
   * property's value — and checked again against the file itself, in
   * case the cache is behind.
   */
  async rename(oldKey, newKey) {
    const file = this.file;
    const clashWith = (keys) =>
      keys.find(
        (k) => k !== oldKey && k !== 'position' && k.toLowerCase() === newKey.toLowerCase()
      );
    const refuse = (clash) => {
      new Notice(`There's already a property called "${clash}".`);
      if (this.file === file) this.forceRefresh();
    };

    const cached = clashWith(Object.keys(this.frontmatter));
    if (cached) return refuse(cached);

    let clash = null;
    const done = await this.plugin.notes.write(
      file,
      (fm) => {
        clash = clashWith(Object.keys(fm));
        if (clash) return;
        const entries = Object.keys(fm)
          .filter((k) => k !== 'position')
          .map((k) => [k, fm[k]]);
        entries.forEach(([k]) => delete fm[k]);
        entries.forEach(([k, v]) => {
          fm[k === oldKey ? newKey : k] = v;
        });
      },
      { failure: 'Could not rename the property.' }
    );
    if (clash) return refuse(clash);
    if (done) this.afterWrite(file);
  }

  /**
   * Write the properties in a new order. Rebuilt in place, as rename
   * is; any key the rows didn't know about — added elsewhere meanwhile —
   * keeps its place at the end. Not redrawn after, since the rows are
   * already where they belong, and redrawing before Obsidian has read
   * the file back would briefly show the old order.
   */
  async reorder(order) {
    const file = this.file;
    const done = await this.plugin.notes.write(file, (fm) => orderKeys(fm, order), { failure: 'Could not reorder the properties.' });
    if (!done && this.file === file) this.forceRefresh();
  }

  /** After our own write, redraw even though focus is still inside. */
  forceRefresh() {
    if (!this.containerEl || !this.containerEl.isConnected) return;
    this.containerEl.empty();
    this.render();
  }
}
