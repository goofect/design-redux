/* ------------------------------------------------------------------ */
/* Browse screens: properties                                         */
/*                                                                    */
/* The properties as Artists: each property a page, each value a tile,*/
/* a value's notes an album of its own.                               */
/* ------------------------------------------------------------------ */

import { Menu, setIcon } from 'obsidian';
import { BROWSE_VIEW, TAG_KEYS, TYPE_ICONS, TYPE_LABELS } from '../core/020-constants.js';
import { onContextMenu, showMenuAt } from '../core/030-helpers-art.js';
import { asButton, onActivate, roveFocus } from '../core/040-helpers-sorting.js';
import { typeOfProperty } from '../core/045-helpers-properties.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { noteProps } from '../core/073-notes.js';
import { libraryIndex } from '../core/077-library-index.js';
import { BrowseScreen } from './108-browse-screen.js';
import { copyText, EMPTY_VALUE, VALUE_GRID_MOST, valueArt } from './110-browse-screens.js';
import { addPropertyEntries } from '../ui/247-property-menu.js';
import { paintValue, ValueOptionModal, valueOptionsOn } from '../ui/248-value-options.js';
import { renamePropertyInPlace } from '../tools/290-bulk-engine.js';
import { BulkEditing } from '../tools/310-bulk-feature.js';

export class PropertiesScreen extends BrowseScreen {
  title() {
    return 'Properties';
  }

  /**
   * As a music app's Artists: the properties listed on the left, and the
   * one chosen as a page of its own on the right — its values as covers,
   * each opening as an album of the notes that carry it.
   */
  render(root) {
    const view = this.view;
    const all = view.propertyList();
    const chosen = all.find((p) => p.key === view.property) || null;
    // A value is a page of its own, as an album is.
    if (chosen && view.value && !view.editing) return this.renderValuePage(root, chosen, view.value);

    view.renderTitleBar(root, this.title());
    const props = this.sortProps(all.filter((p) => view.matches(p.name)));
    this.editButton(root, props.length > 0, !!chosen);
    if (!view.editing) this.renderMatching(root);
    if (!props.length) {
      root.createDiv({ cls: 'dr-empty', text: 'No properties' });
      return;
    }
    if (view.editing && !chosen) {
      this.renderEditing(root, props);
      return;
    }

    const selected = props.find((p) => p.key === view.property) || null;

    const split = root.createDiv({ cls: 'dr-split' });
    const list = split.createDiv({ cls: 'dr-split-list' });
    roveFocus(list, '.dr-split-row');
    const detail = split.createDiv({ cls: 'dr-split-detail' });
    this.listHead(list);

    props.forEach((prop) => {
      const row = list.createDiv({ cls: 'dr-split-row' });
      if (selected && prop.key === selected.key) row.addClass('is-selected');
      asButton(row);

      const thumb = row.createDiv({ cls: 'dr-split-thumb is-blank' });
      setIcon(
        thumb.createSpan({ cls: 'dr-card-glyph' }),
        TYPE_ICONS[prop.type] || 'tag'
      );

      row.createDiv({ cls: 'dr-split-name', text: prop.name });
      row.createDiv({ cls: 'dr-split-count', text: String(prop.count) });

      onActivate(row, () => view.navigate({ property: prop.key, keepFilters: true }));
      onContextMenu(row, (evt) => this.propertyMenu(evt, prop));
    });

    if (!selected) {
      detail.createDiv({ cls: 'dr-split-empty', text: 'Select a property' });
      return;
    }

    // On a phone there's room for the list or the page, not both, so
    // choosing a property swaps one for the other — the way an artist
    // opens from the Artists list — and back returns to the list.
    split.addClass('has-selection');
    this.renderOverview(detail, selected);
  }

  /** The property list's order: by name, by how many notes use it, or by type. */
  sortProps(props) {
    const by = this.settings.propertiesSort || 'name';
    const name = (a, b) => a.name.localeCompare(b.name);
    if (by === 'count') return props.slice().sort((a, b) => b.count - a.count || name(a, b));
    if (by === 'type') return props.slice().sort((a, b) => String(a.type).localeCompare(String(b.type)) || name(a, b));
    return props;
  }

  /** Above the list: what it's ordered by, and a menu to change it. */
  listHead(list) {
    const sorts = [
      ['name', 'Name'],
      ['count', 'Notes'],
      ['type', 'Type'],
    ];
    const by = this.settings.propertiesSort || 'name';
    const head = list.createDiv({ cls: 'dr-split-list-head' });
    const button = head.createDiv({ cls: 'dr-search-sort dr-prop-sort' });
    asButton(button);
    button.createSpan({ text: `Sort: ${(sorts.find((s) => s[0] === by) || sorts[0])[1]}` });
    setIcon(button.createSpan({ cls: 'dr-search-sort-icon' }), 'chevron-down');
    onActivate(button, (evt) => {
      const menu = new Menu();
      sorts.forEach(([id, label]) =>
        menu.addItem((item) =>
          item
            .setTitle(label)
            .setChecked(id === by)
            .setSection('action')
            .onClick(async () => {
              this.settings.propertiesSort = id;
              await this.plugin.saveData(this.settings);
              this.view.render();
            })
        )
      );
      showMenuAt(menu, evt);
    });
  }

  /** Notes that carry the property with nothing in it. */
  emptyNotes(key) {
    const view = this.view;
    const want = String(key).toLowerCase();
    const blank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.some((x) => x !== null && x !== ''));
    return libraryIndex(this.plugin)
      .markdown()
      .filter((file) => {
        if (this.plugin.isFolderNote(file) || !view.inFilter(file)) return false;
        const fm = noteProps(this.app, file);
        const have = Object.keys(fm).find((k) => k.toLowerCase() === want);
        return have !== undefined && blank(fm[have]);
      });
  }

  /** A property's facts, as Obsidian counts them: its type, how many notes have it and don't, its top values, when last changed — each with its fix a click away. */
  inspect(key) {
    const want = String(key).toLowerCase();
    const all = libraryIndex(this.plugin).markdown();
    let last = 0;
    const using = all.filter((file) => {
      const fm = noteProps(this.app, file);
      const has = Object.keys(fm).some((k) => k !== 'position' && k.toLowerCase() === want);
      if (has) last = Math.max(last, file.stat ? file.stat.mtime : 0);
      return has;
    });
    return { type: typeOfProperty(this.app, want), uses: using.length, without: all.length - using.length, last };
  }

  renderInspector(detail, prop, groups) {
    const facts = this.inspect(prop.key);
    const bulk = this.plugin.feature(BulkEditing);
    const root = this.app.vault.getRoot();
    const box = detail.createDiv({ cls: 'dr-prop-facts' });
    const fact = (label, text, fix) => {
      const el = box.createDiv({ cls: 'dr-prop-fact' });
      el.createDiv({ cls: 'dr-prop-fact-label', text: label });
      const value = el.createDiv({ cls: 'dr-prop-fact-value', text });
      if (fix && bulk) {
        const go = value.createSpan({ cls: 'dr-prop-fact-fix', text: fix[0] });
        asButton(go, fix[0]);
        onActivate(go, fix[1]);
      }
      return el;
    };
    fact('Type', TYPE_LABELS[facts.type] || facts.type, ['Change…', () => bulk.openChangeType(prop.name)]);
    fact('In', bulkCount(facts.uses, 'note'));
    fact('Without it', bulkCount(facts.without, 'note'), facts.without ? ['Fill in…', () => bulk.openMissing([root], prop.name)] : null);
    const top = groups.slice().sort((a, b) => b.files.length - a.files.length).slice(0, 3).map((g) => `${g.value} (${g.files.length})`);
    fact('Values', top.length ? `${groups.length}: ${top.join(', ')}${groups.length > 3 ? '…' : ''}` : 'None', groups.length > 1 ? ['Clean up…', () => bulk.openTools([root], 'cleanup', { key: prop.name })] : null);
    if (facts.last) fact('Last changed', this.view.relative(facts.last));
  }

  /** Values as covers or as a list: as chosen, or covers while there are few enough to take in. */
  showsGrid(n) {
    const as = this.settings.propertyValueView || 'auto';
    if (as !== 'auto') return as === 'grid';
    const layout = this.settings.libraryLayout || 'auto';
    return layout === 'covers' || (layout === 'auto' && n <= VALUE_GRID_MOST);
  }

  /**
   * A property's page, as an artist's: its name, how many notes and
   * values, then the values — as covers, or a list when there are many —
   * each opening its own page. Picking values to merge is Edit's.
   */
  renderOverview(detail, prop) {
    const view = this.view;
    const groups = view.groupsByProperty(prop.key);
    const empty = this.emptyNotes(prop.key);
    const using = new Set(empty.map((f) => f.path));
    groups.forEach((g) => g.files.forEach((f) => using.add(f.path)));

    const title = detail.createDiv({ cls: 'dr-split-heading dr-prop-page-title', text: prop.name });
    onContextMenu(title, (evt) => this.propertyMenu(evt, prop));
    const meta = [bulkCount(using.size, 'note'), bulkCount(groups.length, 'value')];
    if (empty.length) meta.push(`${empty.length} empty`);
    detail.createDiv({ cls: 'dr-prop-page-meta', text: meta.join('  ·  ') });
    if (!groups.length && !empty.length) {
      detail.createDiv({ cls: 'dr-split-empty', text: 'No notes carry this property' });
      return;
    }
    if (this.settings.propertyInspector !== false && !view.editing) this.renderInspector(detail, prop, groups);

    const head = detail.createDiv({ cls: 'dr-search-section' });
    head.createSpan({ cls: 'dr-search-section-title', text: 'Values' });
    head.createSpan({ cls: 'dr-search-section-count', text: String(groups.length) });
    if (view.editing) return this.renderValuePicks(detail, prop, groups);

    const grid = this.showsGrid(groups.length);
    const toggle = head.createDiv({ cls: 'dr-prop-view-toggle' });
    [
      ['grid', 'layout-grid', 'Covers'],
      ['list', 'list', 'List'],
    ].forEach(([id, icon, label]) => {
      const b = toggle.createDiv({ cls: 'clickable-icon dr-prop-view' });
      asButton(b, `Show values as ${label.toLowerCase()}`);
      b.dataset.view = id;
      b.toggleClass('is-active', (id === 'grid') === grid);
      setIcon(b, icon);
      onActivate(b, () => {
        this.settings.propertyValueView = id;
        view.render();
        this.plugin.saveData(this.settings);
      });
    });

    const open = (value) => view.navigate({ mode: 'properties', property: prop.key, value, keepFilters: true });
    const limit = view.expanded.has(`values:${prop.key}`) ? groups.length : 200;
    const shown = groups.slice(0, limit);
    if (grid) {
      const tiles = detail.createDiv({ cls: 'dr-grid dr-prop-values-grid' });
      roveFocus(tiles, '.dr-card');
      shown.forEach((group) => {
        const value = String(group.value);
        const card = view.card(tiles, value, bulkCount(group.files.length, 'note'));
        card.dataset.value = value;
        valueArt(view, card.querySelector('.dr-card-art'), prop.key, value, group.files);
        onActivate(card, () => open(value));
        onContextMenu(card, (evt) => this.valueMenu(evt, prop, value));
      });
      if (empty.length) {
        const card = view.card(tiles, 'No value', bulkCount(empty.length, 'note'));
        card.addClass('is-empty-value');
        card.dataset.value = EMPTY_VALUE;
        view.fillArt(card.querySelector('.dr-card-art'), null, 'circle-dashed', null, null);
        onActivate(card, () => open(EMPTY_VALUE));
      }
    } else {
      const list = detail.createDiv({ cls: 'dr-prop-values' });
      roveFocus(list, '.dr-prop-value');
      shown.forEach((group) => {
        const value = String(group.value);
        const row = list.createDiv({ cls: 'dr-prop-value' });
        asButton(row);
        row.dataset.value = value;
        valueArt(view, row.createDiv({ cls: 'dr-prop-value-art' }), prop.key, value, group.files);
        paintValue(row.createDiv({ cls: 'dr-prop-value-name', text: value }), this.plugin, prop.key, value);
        row.createDiv({ cls: 'dr-prop-value-count', text: String(group.files.length) });
        onActivate(row, () => open(value));
        onContextMenu(row, (evt) => this.valueMenu(evt, prop, value));
      });
      if (empty.length) {
        const row = list.createDiv({ cls: 'dr-prop-value is-empty-value' });
        asButton(row);
        row.dataset.value = EMPTY_VALUE;
        row.createDiv({ cls: 'dr-prop-value-art is-blank' });
        row.createDiv({ cls: 'dr-prop-value-name', text: 'No value' });
        row.createDiv({ cls: 'dr-prop-value-count', text: String(empty.length) });
        onActivate(row, () => open(EMPTY_VALUE));
      }
    }
    if (groups.length > limit) {
      const more = detail.createDiv({ cls: 'dr-prop-value-more', text: `Show all ${groups.length}` });
      asButton(more);
      onActivate(more, () => {
        view.expanded.add(`values:${prop.key}`);
        view.render();
      });
    }
  }

  /** In Edit: the values as a list to pick from, and Merge for two or more. */
  renderValuePicks(detail, prop, groups) {
    const view = this.view;
    const bulk = this.plugin.feature(BulkEditing);
    const isTags = TAG_KEYS.indexOf(String(prop.key).toLowerCase()) !== -1;
    if (!view.valuePicks || view.valuePicks.key !== prop.key) view.valuePicks = { key: prop.key, set: new Set() };
    const picks = view.valuePicks.set;
    Array.from(picks).forEach((v) => {
      if (!groups.some((g) => String(g.value) === v)) picks.delete(v);
    });
    const bar = detail.createDiv({ cls: 'dr-prop-merge-bar' });
    const list = detail.createDiv({ cls: 'dr-prop-values is-picking' });
    const refresh = () => {
      bar.empty();
      bar.createSpan({
        cls: 'dr-prop-merge-said',
        text: isTags
          ? 'Tags are renamed from their menu.'
          : picks.size === 0
          ? 'Pick two or more values to merge them into one.'
          : picks.size === 1
          ? '1 value picked. Pick another to merge them.'
          : `${picks.size} values picked.`,
      });
      if (isTags || !bulk) return;
      const merge = bar.createEl('button', { cls: 'mod-cta dr-prop-merge-values', text: picks.size > 1 ? `Merge ${picks.size}…` : 'Merge…' });
      merge.disabled = picks.size < 2;
      merge.addEventListener('click', () => {
        if (picks.size < 2) return;
        bulk.openMergeValues(this.plugin.propertyLabel(prop.key), Array.from(picks));
      });
    };
    groups.forEach((group) => {
      const value = String(group.value);
      const row = list.createDiv({ cls: 'dr-prop-value' });
      row.dataset.value = value;
      if (!isTags && bulk) {
        const tick = row.createEl('input', { cls: 'dr-prop-value-tick', type: 'checkbox' });
        tick.checked = picks.has(value);
        tick.setAttribute('aria-label', `Pick “${value}” to merge`);
        row.toggleClass('is-picked', tick.checked);
        tick.addEventListener('change', () => {
          if (tick.checked) picks.add(value);
          else picks.delete(value);
          row.toggleClass('is-picked', tick.checked);
          refresh();
        });
        row.addEventListener('click', (evt) => {
          if (evt.target === tick) return;
          tick.checked = !tick.checked;
          tick.dispatchEvent(new Event('change'));
        });
      }
      paintValue(row.createDiv({ cls: 'dr-prop-value-name', text: value }), this.plugin, prop.key, value);
      row.createDiv({ cls: 'dr-prop-value-count', text: String(group.files.length) });
      onContextMenu(row, (evt) => this.valueMenu(evt, prop, value));
    });
    refresh();
  }

  /**
   * One value, as an album: its cover, its name, the property it's a
   * value of — the way back — and its notes, in the album's own list.
   * "No value" gathers the notes that leave the property empty.
   */
  renderValuePage(root, prop, value) {
    const view = this.view;
    const bar = root.createDiv({ cls: 'dr-detail-bar' });
    view.renderSidebarToggle(bar);
    view.renderNav(bar);
    view.renderSearchField(bar);
    view.renderFilterChips(root);

    const isEmpty = value === EMPTY_VALUE;
    const group = isEmpty
      ? { value: 'No value', files: this.emptyNotes(prop.key) }
      : view.groupsByProperty(prop.key).find((g) => String(g.value) === String(value));
    if (!group) {
      root.createDiv({ cls: 'dr-split-empty', text: `No notes have “${value}” as their ${prop.name}` });
      return;
    }
    const files = view.sortFiles(group.files.filter((f) => view.matches(f.basename)));
    const title = String(group.value);
    const id = `value:${prop.key}:${title}`;
    view.renderAlbumHead(root, {
      title,
      sub: prop.name,
      cover: isEmpty ? null : view.groupCover(group),
      glyph: isEmpty ? 'circle-dashed' : 'tag',
      genName: view.genName(title, id),
      files,
      onArtMenu: isEmpty ? null : (evt) => this.valueMenu(evt, prop, title),
    });
    // The property it belongs to, under the name, is the way back to it — as an album's artist is.
    const sub = root.querySelector('.dr-detail-sub');
    if (sub) {
      sub.addClass('is-link');
      asButton(sub, `Back to ${prop.name}`);
      onActivate(sub, () => view.navigate({ mode: 'properties', property: prop.key, value: null, keepFilters: true }));
    }
    const actions = root.querySelector('.dr-detail-actions');
    if (actions && !isEmpty) {
      const more = view.action(actions, 'ellipsis', 'More', (evt) => this.valueMenu(evt, prop, title));
      more.addClass('dr-value-more');
    }

    const list = root.createDiv({ cls: 'dr-tracks dr-value-tracks' });
    roveFocus(list, '.dr-track');
    view.renderLimited(list, files, `value:${prop.key}:${title}`, 1000);
  }

  /**
   * While property filters narrow the library: how many notes pass all of
   * them, and the way to see them — as a list, or to search among them.
   */
  renderMatching(root) {
    const view = this.view;
    if (!view.propFilters().length) return;
    const files = libraryIndex(this.plugin)
      .markdown()
      .filter((f) => !this.plugin.isFolderNote(f) && view.inFilter(f));
    const line = root.createDiv({ cls: 'dr-prop-matching' });
    line.createSpan({ cls: 'dr-prop-matching-count', text: `${bulkCount(files.length, 'matching note')}` });
    [
      ['Show them', 'notes'],
      ['Search among them', 'search'],
    ].forEach(([label, mode]) => {
      const go = line.createEl('button', { cls: 'dr-prop-matching-go', text: label });
      go.dataset.mode = mode;
      go.addEventListener('click', () => view.navigate({ mode, property: null, value: null, path: '/', keepFilters: true }));
    });
  }

  /**
   * A value's menu, as an album's: opening it first, then what changes
   * it — renamed or merged everywhere — and copying it; last, narrowing
   * the library to its notes.
   */
  valueMenu(evt, prop, value) {
    const view = this.view;
    evt.preventDefault();
    const menu = new Menu();
    const bulk = this.plugin.feature(BulkEditing);
    const state = { mode: 'properties', property: prop.key, value };
    const add = (title, icon, section, run) => menu.addItem((item) => item.setTitle(title).setIcon(icon).setSection(section).onClick(run));
    add('Open', 'book-open', 'open', () => view.navigate(Object.assign({ keepFilters: true }, state)));
    add('Open in new tab', 'file-plus', 'open', () =>
      this.app.workspace.getLeaf('tab').setViewState({ type: BROWSE_VIEW, active: true, state: Object.assign({ path: '/' }, state) })
    );
    if (bulk && TAG_KEYS.indexOf(String(prop.key).toLowerCase()) !== -1) {
      const tag = value.replace(/^#/, '');
      add(`Rename #${tag}…`, 'hash', 'action', () => bulk.openRenameTag(tag));
    } else if (bulk) {
      add('Rename value…', 'pencil', 'action', () => bulk.openRenameValue(this.plugin.propertyLabel(prop.key), value));
      // Merging is picking: Edit on the property's page, this value picked.
      add('Merge with…', 'git-merge', 'action', () => {
        view.valuePicks = { key: prop.key, set: new Set([value]) };
        Promise.resolve(view.navigate({ mode: 'properties', property: prop.key, value: null, keepFilters: true })).then(() => view.setEditing(true));
      });
    }
    if (valueOptionsOn(this.plugin) && TAG_KEYS.indexOf(String(prop.key).toLowerCase()) === -1) {
      add('Colour and icon…', 'palette', 'action', () => new ValueOptionModal(this.plugin, prop.key, value, () => view.render()).open());
    }
    add('Copy value', 'copy', 'action', () => copyText(value));
    add('Narrow the library to these', 'filter', 'view', () => {
      view.addPropFilter({ key: prop.name, value, negate: false });
      view.navigate({ mode: 'properties', property: null, value: null, keepFilters: true });
    });
    showMenuAt(menu, evt);
  }

  /** Edit, beside Find, as an album has it: on a property's page, to pick values to merge; else to rename and merge properties. */
  editButton(root, any, onProperty) {
    const view = this.view;
    const bar = root.querySelector('.dr-detail-bar');
    if (!bar || (!any && !view.editing) || !this.plugin.feature(BulkEditing)) return;
    const button = bar.createEl('button', {
      cls: `dr-bar-edit${view.editing ? ' is-done' : ''}`,
      text: view.editing ? 'Done' : 'Edit',
    });
    button.setAttribute(
      'aria-label',
      view.editing ? 'Stop editing' : onProperty ? 'Pick values to merge' : 'Rename and merge properties'
    );
    button.addEventListener('click', () => {
      view.propPicks = new Set();
      if (view.editing && view.valuePicks) view.valuePicks.set.clear();
      view.setEditing(!view.editing);
    });
    const next = bar.querySelector('.dr-filter-btn') || bar.querySelector('.dr-browse-search');
    if (next) next.before(button);
  }

  /**
   * Every property as a name to change, and a circle to pick it by:
   * changing a name renames it everywhere, and two or more picked can
   * be merged into one.
   */
  renderEditing(root, props) {
    const view = this.view;
    const picks = view.propPicks instanceof Set ? view.propPicks : (view.propPicks = new Set());
    // Picks renamed or gone since are let go.
    Array.from(picks).forEach((name) => {
      if (!props.some((p) => p.name === name)) picks.delete(name);
    });

    const wrap = root.createDiv({ cls: 'dr-prop-edit' });
    const bar = wrap.createDiv({ cls: 'dr-prop-edit-bar' });
    const said = bar.createDiv({ cls: 'dr-prop-edit-said' });
    const merge = bar.createEl('button', { cls: 'mod-cta dr-prop-merge' });
    const refresh = () => {
      const n = picks.size;
      said.setText(
        n === 0
          ? 'Change a name to rename it everywhere. Pick two or more to merge them.'
          : n === 1
          ? '1 picked. Pick another to merge them.'
          : `${n} picked.`
      );
      merge.setText(n > 1 ? `Merge ${n}…` : 'Merge…');
      merge.disabled = n < 2;
      merge.toggleClass('is-disabled', n < 2);
    };
    merge.addEventListener('click', () => {
      if (picks.size < 2) return;
      const tools = this.plugin.feature(BulkEditing);
      if (tools) tools.openMerge(props.filter((p) => picks.has(p.name)).map((p) => p.name));
    });

    const spellings =
      this.plugin.bulk && typeof this.plugin.bulk.propertySpellings === 'function'
        ? this.plugin.bulk.propertySpellings()
        : new Map();
    const list = wrap.createDiv({ cls: 'dr-split-list dr-prop-edit-list' });
    props.forEach((prop) => {
      const row = list.createDiv({ cls: 'dr-split-row is-editing' });
      const pick = row.createDiv({ cls: 'dr-prop-pick' });
      pick.setAttribute('role', 'checkbox');
      pick.setAttribute('tabindex', '0');
      const paint = () => {
        const on = picks.has(prop.name);
        row.toggleClass('is-picked', on);
        pick.setAttribute('aria-checked', String(on));
        pick.empty();
        if (on) setIcon(pick, 'check');
      };
      const flip = () => {
        if (picks.has(prop.name)) picks.delete(prop.name);
        else picks.add(prop.name);
        paint();
        refresh();
      };
      onActivate(pick, flip);
      paint();

      const thumb = row.createDiv({ cls: 'dr-split-thumb is-blank' });
      setIcon(thumb.createSpan({ cls: 'dr-card-glyph' }), TYPE_ICONS[prop.type] || 'tag');

      const name = row.createEl('input', { cls: 'dr-edit-name dr-split-name', type: 'text' });
      name.value = prop.name;
      name.setAttribute('spellcheck', 'false');
      // Notes can write a property's name differently — Parent and
      // parent are one property to Obsidian, which lists it one way.
      // Enter on the name as shown writes it that way in all of them.
      const others = Array.from((spellings.get(prop.name.toLowerCase()) || new Map()).entries()).filter(
        ([spelling]) => spelling !== prop.name
      );
      view.editField(name, prop.name, (value) => this.renameProperty(prop.name, value), {
        enterSame: others.length ? (value) => this.renameProperty(prop.name, value) : null,
      });

      if (others.length) {
        const count = others.reduce((n, [, c]) => n + c, 0);
        const fix = row.createEl('button', {
          cls: 'dr-prop-spelling',
          text: `${others.map(([spelling]) => `“${spelling}”`).join(', ')} in ${count}`,
        });
        fix.setAttribute(
          'aria-label',
          `${bulkCount(count, 'note')} ${count === 1 ? 'writes' : 'write'} it ${others.map(([spelling]) => `“${spelling}”`).join(' or ')}. Change ${count === 1 ? 'it' : 'them'} to “${prop.name}”`
        );
        const icon = fix.createSpan({ cls: 'dr-prop-spelling-icon' });
        setIcon(icon, 'wand-2');
        fix.prepend(icon);
        fix.addEventListener('click', (evt) => {
          evt.stopPropagation();
          this.renameProperty(prop.name, name.value.trim() || prop.name);
        });
      }

      row.createDiv({ cls: 'dr-split-count', text: String(prop.count) });
      // The row itself picks too, except where the name is typed.
      row.addEventListener('click', (evt) => {
        if (evt.target === name || pick.contains(evt.target)) return;
        flip();
      });
      onContextMenu(row, (evt) => this.propertyMenu(evt, prop));
    });
    refresh();
  }

  /**
   * A name changed in the list: renamed everywhere, with Undo. One that
   * needs a look first — notes where both names hold different values,
   * or tags, aliases or CSS classes — opens the rename, filled in.
   */
  async renameProperty(from, to) {
    const view = this.view;
    const tools = this.plugin.feature(BulkEditing);
    if (!tools || !this.plugin.bulk) return;
    await renamePropertyInPlace(this.plugin.bulk, from, to, {
      redraw: () => view.render(),
      review: () => {
        view.render();
        tools.openRenameProperty(from, to);
      },
      picks: view.propPicks,
    });
  }

  /** A property's menu: the same as in the Properties window, each tool across the vault. Its values are a click away. */
  propertyMenu(evt, prop) {
    evt.preventDefault();
    const bulk = this.plugin.feature(BulkEditing);
    if (!bulk) return;
    const menu = new Menu();
    const name = prop.name;
    const root = this.app.vault.getRoot();
    const open = {
      rename: () => bulk.openRenameProperty(name),
      type: () => bulk.openChangeType(name),
      merge: () => bulk.openMerge([name]),
      cleanup: () => bulk.openTools([root], 'cleanup', { key: name }),
      missing: () => bulk.openMissing([root], name),
      remove: () => bulk.openRemove([root], [name]),
    };
    addPropertyEntries(menu, { name, missing: this.inspect(prop.key).without }, (tool) => open[tool]());
    showMenuAt(menu, evt);
  }
}
