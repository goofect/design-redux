/* ------------------------------------------------------------------ */
/* Browse view: an album as a table                                   */
/*                                                                    */
/* Its rows and header, the columns and their labels, the notes in    */
/* order, and groups by a property. A part of BrowseView (see 120).   */
/* ------------------------------------------------------------------ */

import { Menu, setIcon } from 'obsidian';
import { TAG_KEYS } from '../core/020-constants.js';
import { blankLook } from '../core/030-art.js';
import { onContextMenu, showMenuAt } from '../core/036-menus.js';
import { byName, TABLE_SORTS } from '../core/040-sorting.js';
import { asButton, iconWord, onActivate, roveFocus } from '../core/042-controls.js';
import { fmGet, plainValue, propertyCounter } from '../core/045-helpers-properties.js';
import { libraryIndex } from '../core/077-library-index.js';
import { ask } from '../core/081-capabilities.js';
import { BrowseArranging } from './126-browse-arranging.js';

export class BrowseTable extends BrowseArranging {
  /* -- every folder, as tiles ------------------------------------- */

  /* -- every note, as a table ------------------------------------- */

  tableRow(table, file, columns) {
    const row = table.createDiv({ cls: 'dr-tr' });
    asButton(row);

    const title = row.createDiv({ cls: 'dr-td dr-td-title' });
    title.createSpan({ cls: 'dr-td-text', text: file.basename });

    const more = title.createDiv({ cls: 'clickable-icon dr-td-more' });
    more.setAttribute('aria-label', 'More');
    setIcon(more, 'ellipsis');
    more.addEventListener('click', (evt) => this.fileMenu(evt, file));

    columns.forEach((key) =>
      row.createDiv({ cls: 'dr-td', text: this.valueOf(file, key) })
    );
    if (this.lengthStyle()) row.createDiv({ cls: 'dr-td dr-td-length', text: this.lengthLabel(file) });
    row.createDiv({
      cls: 'dr-td dr-td-time',
      text: this.relative(file.stat.mtime),
    });

    row.dataset.path = file.path;
    this.pickOrOpen(row, { file }, (evt) => this.openFile(file, evt), false);
    onContextMenu(row, (evt) => this.fileMenu(evt, file));
  }

  /**
   * A column heading that sorts by its own column, the way a song list
   * does — clicking again reverses it, and the active column carries
   * the arrow. Title either way, and Modified newest first, are orders
   * every screen shares, so choosing them here chooses them everywhere;
   * a property column, or oldest first, is this table's alone.
   */
  headerCell(head, key, label, extra) {
    const cell = head.createDiv({ cls: `dr-td ${extra || ''}`.trim() });
    const current = this.tableSort;
    const active = current.key === key;
    if (active) cell.addClass('is-sorted');

    // Modified is a calendar, to be read at a glance; its word is the tooltip.
    if (key === 'modified') iconWord(cell.createSpan({ cls: 'dr-td-text' }), 'calendar', label);
    else cell.createSpan({ cls: 'dr-td-text', text: label });
    if (active) {
      const arrow = cell.createSpan({ cls: 'dr-th-arrow' });
      setIcon(arrow, current.dir === 'asc' ? 'chevron-up' : 'chevron-down');
    }

    asButton(cell);
    onActivate(cell, () => {
      // Text reads best ascending, time newest first.
      const next = active
        ? { key: key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key: key, dir: key === 'modified' || key === 'created' ? 'desc' : 'asc' };
      const shared = Object.keys(TABLE_SORTS).find(
        (k) => TABLE_SORTS[k].key === next.key && TABLE_SORTS[k].dir === next.dir
      );
      if (shared) this.setSort(shared);
      else this.columnSort = next;
      this.render();
    });
  }

  sortNotes(files) {
    const { key, dir } = this.tableSort;
    const mul = dir === 'asc' ? 1 : -1;
    const value = (f) => {
      if (key === 'title') return f.basename.toLowerCase();
      if (key === 'modified') return f.stat.mtime;
      if (key === 'created') return f.stat.ctime;
      return (this.valueOf(f, key) || '').toLowerCase();
    };

    return files.slice().sort((a, b) => {
      if (key === 'title') return byName(a.basename, b.basename) * mul;
      const x = value(a);
      const y = value(b);
      // Blanks last whichever way the column is pointing.
      if (x === '' && y !== '') return 1;
      if (y === '' && x !== '') return -1;
      if (x === y) return byName(a.basename, b.basename);
      // Text in the order a person would put it — 2 before 10.
      if (typeof x === 'string' && typeof y === 'string') return byName(x, y) * mul;
      return (x > y ? 1 : -1) * mul;
    });
  }

  /** The properties used as columns, from settings. */
  tableColumns() {
    return (this.plugin.settings.tableColumns || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }

  columnLabel(key) {
    try {
      const info = this.app.metadataTypeManager.getAllProperties()[key.toLowerCase()];
      if (info && info.name) return info.name;
    } catch (err) {
      /* fall through */
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  /** The property tools over some notes — those picked, found or in a saved view — rather than folders. */
  propertyToolsFor(files) {
    const bulk = ask(this.plugin, 'propertyTools');
    if (bulk && files.length) bulk.openTools(files.slice(), null);
  }

  valueOf(file, key) {
    const cache = this.app.metadataCache.getFileCache(file);
    const v = cache && fmGet(cache.frontmatter, key);
    if (v === undefined || v === null || v === '') return '';
    return Array.isArray(v) ? v.map((x) => this.plain(x)).join(', ') : this.plain(v);
  }

  plain(value) {
    return plainValue(value);
  }

  /* -- a property, two panes -------------------------------------- */

  /* -- properties -------------------------------------------------- */

  /** Every property in use, with how many notes carry it. */
  propertyList() {
    try {
      const all = this.app.metadataTypeManager.getAllProperties();
      const count = propertyCounter(this.app);
      return Object.keys(all)
        .map((key) => ({
          key: key,
          name: (all[key] && all[key].name) || key,
          count: count(key, all[key]),
          type: (all[key] && (all[key].type || all[key].widget)) || 'text',
        }))
        .filter((p) => p.count > 0)
        .sort((a, b) =>
          this.sort === 'name-desc' ? byName(b.name, a.name) : byName(a.name, b.name)
        );
    } catch (err) {
      return [];
    }
  }

  /** Every distinct value of a property, with the notes carrying it. */
  groupsByProperty(key) {
    const map = new Map();

    libraryIndex(this.plugin).markdown().forEach((file) => {
      if (this.plugin.isFolderNote(file)) return;
      if (!this.inFilter(file)) return;
      const cache = this.app.metadataCache.getFileCache(file);
      const raw = cache && fmGet(cache.frontmatter, key);
      if (raw === undefined || raw === null || raw === '') return;

      const values = Array.isArray(raw) ? raw : [raw];
      values.forEach((v) => {
        const value = this.plain(v);
        if (!value) return;
        if (!map.has(value)) map.set(value, []);
        map.get(value).push(file);
      });
    });

    return this.sortGroups(
      Array.from(map.entries()).map(([value, files]) => ({
        value: value,
        files: this.sortFiles(files),
      }))
    );
  }

  /** A group borrows the first cover any of its notes carries. */
  groupCover(group) {
    for (const file of group.files) {
      const src = this.coverFor(file);
      if (src) return src;
    }
    return null;
  }

  renderGroup(detail, group, isPrimary) {
    const block = detail.createDiv({ cls: 'dr-album' });

    const head = block.createDiv({ cls: 'dr-album-head' });
    const titles = head.createDiv({ cls: 'dr-album-titles' });
    titles.createDiv({
      cls: isPrimary ? 'dr-album-name is-primary' : 'dr-album-name',
      text: group.value,
    });
    // A value can be renamed everywhere it's used; under tags, each
    // value is a tag, renamed in notes' text as well.
    const bulk = ask(this.plugin, 'propertyTools');
    if (bulk && this.property) {
      onContextMenu(head, (evt) => {
        evt.preventDefault();
        const menu = new Menu();
        if (TAG_KEYS.indexOf(String(this.property).toLowerCase()) !== -1) {
          const tag = String(group.value).replace(/^#/, '');
          menu.addItem((item) =>
            item
              .setTitle(`Rename #${tag} everywhere…`)
              .setIcon('hash')
              .onClick(() => bulk.openRenameTag(tag))
          );
        } else {
          menu.addItem((item) =>
            item
              .setTitle('Rename this value everywhere…')
              .setIcon('pencil')
              .onClick(() => bulk.openRenameValue(this.plugin.propertyLabel(this.property), String(group.value)))
          );
        }
        showMenuAt(menu, evt);
      });
    }
    titles.createDiv({
      cls: 'dr-album-meta',
      text:
        `${this.propertyLabel()}  ·  ` +
        (group.files.length === 1 ? '1 note' : `${group.files.length} notes`),
    });

    const body = block.createDiv({ cls: 'dr-album-body' });
    const art = body.createDiv({ cls: 'dr-album-art' });
    this.fillArt(art, this.groupCover(group), 'file-text', this.genName(String(group.value)), blankLook(this.plugin.settings, String(group.value)));

    const list = body.createDiv({ cls: 'dr-tracks' });
    roveFocus(list, '.dr-track');
    // Keyed by property too: the same value can occur under two.
    this.renderLimited(
      list,
      group.files,
      `value:${this.property}:${group.value}`,
      this.limitFrom('albumNoteLimit', 8)
    );
  }
}
