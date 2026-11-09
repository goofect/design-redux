/* ------------------------------------------------------------------ */
/* Browse view: filters and Find                                      */
/*                                                                    */
/* Filters on folders, properties, tags and dates, their menu and     */
/* chips, saved views offered there, and the Find field. A part of    */
/* BrowseView (see 120).                                              */
/* ------------------------------------------------------------------ */

import { Menu, setIcon } from 'obsidian';
import { TILE_GROUPS } from '../core/020-constants.js';
import { showMenuAt } from '../core/036-menus.js';
import { collapseSearches, DATE_RANGES, dateFilterLabel, dateFloor, propertyFilterLabel, SORTS } from '../core/040-sorting.js';
import { asButton, composing, onActivate } from '../core/042-controls.js';
import { knownPropertyNames, noteTags, plainValue, propertyValues, vaultTags } from '../core/045-helpers-properties.js';
import { libraryIndex } from '../core/077-library-index.js';
import { ask } from '../core/081-capabilities.js';
import { BrowseTable } from './127-browse-table.js';
import { ChoicePicker, FolderPicker } from '../ui/230-pickers.js';
import { paintValue } from '../ui/248-value-options.js';
import { ALBUM_LAYOUTS } from './257-album-structure.js';

export class BrowseFilters extends BrowseTable {
  /** Clear filters, where Find or a filter is why nothing shows; otherwise none. */
  clearAction() {
    if (!this.query.trim() && !this.hasFilters()) return null;
    return [
      'Clear filters',
      () => {
        this.clearFilters();
        this.query = '';
        this.render();
      },
    ];
  }

  /** The smart album on screen, if it's one. */
  smartAlbum() {
    const smart = ask(this.plugin, 'savedViews');
    return smart && smart.enabled ? smart.byId(this.property) : null;
  }

  /** The property filters on: the first, and any more narrowing it — a note passes all of them. */
  propFilters() {
    return [this.filterProp].concat(this.filterMore || []).filter(Boolean);
  }

  /**
   * One more property filter: in place of one on the same property, or
   * beside those on others.
   */
  addPropFilter(f) {
    const same = (g) => g && String(g.key).toLowerCase() === String(f.key).toLowerCase();
    if (!this.filterProp || same(this.filterProp)) {
      this.filterProp = f;
      return;
    }
    const more = (this.filterMore || []).filter((g) => !same(g));
    more.push(f);
    this.filterMore = more;
  }

  /** Through every filter that's set. */
  inFilter(file) {
    if (this.filterFolder && !file.path.startsWith(this.filterFolder + '/')) return false;
    const props = this.propFilters();
    if (!this.filterTag && !props.length && !this.filterDate) return true;

    if (this.filterDate) {
      const stat = file.stat || {};
      const time = this.filterDate.field === 'created' ? stat.ctime : stat.mtime;
      if (!time || time < dateFloor(this.filterDate.range)) return false;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    if (this.filterTag) {
      const want = this.filterTag;
      // A parent tag takes in the ones nested under it, as in Obsidian.
      if (!noteTags(cache).some((t) => t === want || t.startsWith(want + '/'))) return false;
    }

    for (const f of props) {
      const fm = (cache && cache.frontmatter) || {};
      const name = Object.keys(fm).find((k) => k.toLowerCase() === f.key.toLowerCase());
      const raw = name === undefined ? undefined : fm[name];
      const values = (Array.isArray(raw) ? raw : [raw])
        .filter((v) => v !== null && v !== undefined && v !== '')
        .map((v) => plainValue(v).toLowerCase());
      const has = f.value === null || f.value === undefined
        ? values.length > 0
          : values.indexOf(String(f.value).toLowerCase()) !== -1;
      if (has === !!f.negate) return false;
    }
    return true;
  }

  hasFilters() {
    return !!(this.filterFolder || this.filterTag || this.propFilters().length || this.filterDate);
  }

  clearFilters() {
    this.filterFolder = null;
    this.filterTag = null;
    this.filterProp = null;
    this.filterMore = [];
    this.filterDate = null;
  }

  /**
   * A folder shown as a tile: under the folder filter, and — while a
   * tag, property or date filter is on — holding at least one note that
   * passes, anywhere inside it. Worked out once per drawing.
   */
  folderInFilter(folder) {
    if (this.filterFolder && !folder.path.startsWith(this.filterFolder + '/')) return false;
    if (!this.filterTag && !this.propFilters().length && !this.filterDate) return true;
    if (!this.filterMemo) {
      const paths = new Set();
      libraryIndex(this.plugin).markdown().forEach((file) => {
        if (!this.inFilter(file)) return;
        for (let p = file.parent; p && !(p.isRoot && p.isRoot()); p = p.parent) paths.add(p.path);
      });
      this.filterMemo = paths;
      window.setTimeout(() => (this.filterMemo = null), 0);
    }
    return this.filterMemo.has(folder.path);
  }

  renderFilterButton(bar) {
    const btn = bar.createDiv({ cls: 'clickable-icon dr-filter-btn' });
    btn.setAttribute('aria-label', 'Sort, filter and view');
    setIcon(btn, 'list-filter');
    const usual = this.ownOrderLabel() ? 'own' : 'name';
    if (this.hasFilters() || this.currentSort() !== usual) btn.addClass('is-active');

    asButton(btn);
    onActivate(btn, (evt) => showMenuAt(this.filterMenu(), evt));
  }

  /**
   * Sort, then the filters. A filter that's on shows what it's set to,
   * ticked; choosing it again turns it off, and the chips under the bar
   * change or remove one without the menu.
   */
  filterMenu() {
    const menu = new Menu();
    const redraw = () => this.render();

    const current = this.currentSort();
    const own = this.ownOrderLabel();
    const orders = own ? [['own', own]].concat(SORTS) : SORTS;
    orders.forEach(([key, label]) =>
      menu.addItem((item) =>
        item
          .setTitle(label)
          .setChecked(current === key)
          .onClick(() => {
            this.setSort(key);
            redraw();
          })
      )
    );

    // Covers on a screen of albums, grouped.
    if (this.mode === 'folders' || (this.mode === 'folder' && this.isShelf(this.folder()))) {
      menu.addSeparator();
      const structure = ask(this.plugin, 'albums');
      const by = this.plugin.settings.tileGroups || '';
      Object.keys(TILE_GROUPS)
        .filter((key) => (key !== 'kind' || (structure && structure.enabled)) && (key !== 'collection' || this.mode === 'folders'))
        .forEach((key) =>
          menu.addItem((item) =>
            item
              .setTitle(key ? `Grouped by ${TILE_GROUPS[key].toLowerCase()}` : 'Not grouped')
              .setChecked(by === key)
              .onClick(() => {
                this.plugin.settings.tileGroups = key;
                this.plugin.saveData(this.plugin.settings);
                redraw();
              })
          )
        );
    }

    this.addViewItems(menu, redraw);

    menu.addSeparator();
    const filter = (title, icon, on, pick, clear) =>
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(icon)
          .setChecked(on)
          .onClick(() => {
            if (!on) return pick();
            clear();
            redraw();
          })
      );

    filter(
      this.filterFolder ? `In ${this.filterFolder.split('/').pop()}` : 'Folder…',
      'folder', !!this.filterFolder,
      () => this.pickFolder(), () => (this.filterFolder = null)
    );
    filter(
      this.filterTag ? `Tagged #${this.filterTag}` : 'Tag…',
      'tag', !!this.filterTag,
      () => this.pickTag(), () => (this.filterTag = null)
    );
    filter(
      this.filterProp ? propertyFilterLabel(this.filterProp) : 'Property…',
      'list', !!this.filterProp,
      () => this.pickProperty(), () => (this.filterProp = null)
    );
    (this.filterMore || []).forEach((f, i) =>
      filter(propertyFilterLabel(f), 'list', true, () => {}, () => this.filterMore.splice(i, 1))
    );
    if (this.filterProp) {
      menu.addItem((item) =>
        item
          .setTitle('Another property…')
          .setIcon('list-plus')
          .onClick(() => this.pickProperty('new'))
      );
      menu.addItem((item) =>
        item
          .setTitle('Exclude these instead')
          .setIcon('minus-circle')
          .setChecked(!!this.filterProp.negate)
          .onClick(() => {
            this.filterProp.negate = !this.filterProp.negate;
            redraw();
          })
      );
    }
    filter(
      this.filterDate ? dateFilterLabel(this.filterDate) : 'Date…',
      'calendar', !!this.filterDate,
      () => this.pickDate(), () => (this.filterDate = null)
    );

    const smart = ask(this.plugin, 'savedViews');
    if (smart) smart.addFilterItems(menu, this);

    if (this.hasFilters()) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle('Clear filters')
          .setIcon('x')
          .onClick(() => {
            this.clearFilters();
            redraw();
          })
      );
    }

    // What this screen shows, and how, in settings.
    if (typeof this.plugin.openSettingsAt === 'function') {
      menu.addSeparator();
      const key = { home: 'homeShelves', folder: 'albumColumns', notes: 'tableColumns' }[this.mode] || 'gridDensity';
      menu.addItem((item) => item.setTitle('Display settings…').setIcon('settings').onClick(() => this.plugin.openSettingsAt(key)));
    }
    return menu;
  }

  /** An album shown as a list or a table — as its folder note says, set from here. Covers are the folder's own menu's to set. */
  addViewItems(menu, redraw) {
    const structure = ask(this.plugin, 'albums');
    const folder = this.mode === 'folder' ? this.folder() : null;
    if (!structure || !structure.enabled || !folder || this.isShelf(folder)) return;
    const now = structure.info(folder).layout;
    menu.addSeparator();
    ALBUM_LAYOUTS.filter((l) => l.id !== 'covers').forEach((l) =>
      menu.addItem((item) =>
        item
          .setTitle(`View as ${l.label.toLowerCase()}`)
          .setIcon(l.icon)
          .setChecked(now === l.id)
          .onClick(async () => {
            if (await structure.setLayout(folder, l.id)) redraw();
          })
      )
    );
  }

  pickFolder() {
    new FolderPicker(this.app, (folder) => {
      this.filterFolder = folder.path;
      this.render();
    }).open();
  }

  pickTag() {
    const items = vaultTags(this.app).map(({ tag, count }) => ({
      label: `#${tag}`,
      value: tag,
      note: String(count),
    }));
    new ChoicePicker(this.app, 'Which tag?', items, (item) => {
      this.filterTag = item.value;
      this.render();
    }).open();
  }

  /**
   * The property, then its value — or any value at all. In place of the
   * first property filter; with 'new', one more beside it; with a number,
   * in place of that one of the others.
   */
  pickProperty(slot) {
    const items = knownPropertyNames(this.app).map((name) => ({ label: name, value: name }));
    new ChoicePicker(this.app, 'Which property?', items, (item) => {
      const key = item.value;
      const values = [{ label: `Has any ${key}`, value: null }].concat(
        propertyValues(this.app, key).map((v) => ({ label: v, value: v }))
      );
      new ChoicePicker(this.app, `${key} is…`, values, (choice) => {
        const f = { key: key, value: choice.value, negate: false };
        if (slot === 'new') this.addPropFilter(f);
        else if (typeof slot === 'number' && this.filterMore && this.filterMore[slot]) this.filterMore[slot] = f;
        else this.filterProp = f;
        this.render();
      }).open();
    }).open();
  }

  pickDate() {
    const items = [];
    ['modified', 'created'].forEach((field) =>
      Object.keys(DATE_RANGES).forEach((range) =>
        items.push({ label: dateFilterLabel({ field, range }), value: { field, range } })
      )
    );
    new ChoicePicker(this.app, 'When?', items, (item) => {
      this.filterDate = item.value;
      this.render();
    }).open();
  }

  /**
   * The filters in effect, as chips under the bar — so a narrowed screen
   * never passes for the whole of something. A chip's name changes it;
   * its cross takes it off.
   */
  renderFilterChips(root) {
    const chips = [];
    if (this.filterFolder) {
      chips.push([`In ${this.filterFolder.split('/').pop()}`, () => this.pickFolder(), () => (this.filterFolder = null)]);
    }
    if (this.filterTag) {
      chips.push([`#${this.filterTag}`, () => this.pickTag(), () => (this.filterTag = null)]);
    }
    if (this.filterProp) {
      // The next one along takes the first's place.
      chips.push([propertyFilterLabel(this.filterProp), () => this.pickProperty(), () => (this.filterProp = (this.filterMore || []).shift() || null), this.filterProp]);
    }
    (this.filterMore || []).forEach((f, i) =>
      chips.push([propertyFilterLabel(f), () => this.pickProperty(i), () => this.filterMore.splice(i, 1), f])
    );
    if (this.filterDate) {
      chips.push([dateFilterLabel(this.filterDate), () => this.pickDate(), () => (this.filterDate = null)]);
    }
    // Find looks in this screen; a press takes what's typed to the whole library.
    const find = this.query.trim();
    if (!chips.length && !(find && this.mode !== 'search')) return;

    const row = root.createDiv({ cls: 'dr-filter-chips' });
    if (find && this.mode !== 'search') {
      const wide = row.createDiv({ cls: 'dr-chip dr-chip-wide' });
      setIcon(wide.createSpan({ cls: 'dr-chip-icon' }), 'search');
      const label = wide.createSpan({ cls: 'dr-chip-label', text: `Search everywhere for “${find}”` });
      asButton(label);
      onActivate(label, () => this.navigate({ mode: 'search', property: null, path: '/', query: find }));
    }
    chips.forEach(([label, change, clear, prop]) => {
      const chip = row.createDiv({ cls: 'dr-chip' });
      const name = chip.createSpan({ cls: 'dr-chip-label', text: label });
      // A property's value with a colour or an icon of its own: the chip shows them.
      if (prop && !prop.negate && typeof prop.value === 'string') paintValue(chip, this.plugin, prop.key, prop.value);
      asButton(name, `Change: ${label}`);
      onActivate(name, change);
      const x = chip.createSpan({ cls: 'dr-chip-clear' });
      asButton(x, `Remove: ${label}`);
      setIcon(x, 'x');
      onActivate(x, () => {
        clear();
        this.render();
      });
    });
  }

  /**
   * Keep a finished search — Enter, opening a result, or leaving the
   * screen with something typed. Saved with saveData rather than
   * saveSettings: a list of searches is not a setting, and a full
   * settings save re-runs every feature in the plugin.
   */
  async rememberSearch() {
    const term = this.query.trim();
    if (this.mode !== 'search' || term.length < 2) return;
    const settings = this.plugin.settings;
    const list = (settings.recentSearches || []).filter(
      (t) => t.toLowerCase() !== term.toLowerCase()
    );
    list.unshift(term);
    settings.recentSearches = collapseSearches(list).slice(0, 8);
    await this.plugin.saveData(settings);
  }

  /**
   * Redraw everything except the bar, for changes that don't alter it —
   * a query being typed, or data arriving while someone types. The
   * screen is drawn off to one side and everything after its bar is
   * moved in, so the bar on screen, and the field in it, stay put.
   */
  renderBelowBar() {
    const root = this.contentEl;
    const bar = root.firstElementChild;
    if (!bar || !bar.classList.contains('dr-detail-bar')) {
      this.render();
      return;
    }

    const scratch = root.ownerDocument.createElement('div');
    this.beginDrawing();
    try {
      this.screen().render(scratch);
    } catch (err) {
      this.render();
      return;
    }

    const fresh = Array.from(scratch.children);
    if (fresh[0] && fresh[0].classList.contains('dr-detail-bar')) fresh.shift();
    while (bar.nextSibling) bar.nextSibling.remove();
    fresh.forEach((el) => root.appendChild(el));
  }

  renderSearchField(bar) {
    this.renderFilterButton(bar);
    this.renderPreviewToggle(bar);

    const search = bar.createDiv({ cls: 'dr-browse-search' });
    setIcon(search.createSpan({ cls: 'dr-browse-search-icon' }), 'search');

    const input = search.createEl('input', { type: 'text' });
    input.placeholder =
      this.mode === 'search' ? 'Search' : `Find in ${this.getDisplayText()}`;
    input.value = this.query;

    // Enter finishes a search. Leaving the field doesn't: it used to,
    // and every redraw counted as leaving it.
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !composing(evt)) this.rememberSearch();
      // Escape clears what's typed; with nothing typed, it leaves the field.
      if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        if (input.value) {
          input.value = '';
          this.query = '';
          window.clearTimeout(this.findTimer);
          this.renderBelowBar();
        } else {
          input.blur();
        }
      }
    });

    // Only what's below the bar is redrawn, so the field being typed in
    // is never replaced — which kept the caret and focus without having
    // to put them back, and stopped each keystroke looking like a blur.
    // A short pause first, so a long list isn't rebuilt per letter.
    input.addEventListener('input', () => {
      this.query = input.value;
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.renderBelowBar(), 90);
    });
  }
}
