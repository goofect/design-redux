/* ------------------------------------------------------------------ */
/* Properties                                                          */
/*                                                                     */
/* Rows are this plugin's markup. Each value cell is rendered by       */
/* Obsidian's own widget for that property's type, so date pickers,    */
/* link autocomplete, pill rendering and validation are the real       */
/* ones. Writes go through processFrontMatter, which is atomic.        */
/* ------------------------------------------------------------------ */

import { Menu, Notice, setIcon } from 'obsidian';
import { TYPE_ICONS, TYPE_LABELS } from '../core/020-constants.js';
import { composing, menuGroup } from '../core/030-helpers-art.js';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { knownPropertyNames, propertyCounter } from '../core/045-helpers-properties.js';
import { attachSuggest } from '../core/050-helpers-dom.js';
import { noteProps, orderKeys } from '../core/073-notes.js';
import { PanelSection } from '../core/082-panel-section.js';
import { Library } from '../library/130-browse-filters.js';
import { AlbumProperty } from '../library/255-album-property.js';
import { QuietLinks } from '../links/265-quiet-links.js';
import { BulkEditing } from '../bulk/310-bulk-feature.js';

/* Names that say a property ties notes together, or tells when something happened. */
const RELATION_NAMES = ['parent', 'broader', 'narrower', 'related', 'up', 'down', 'children', 'child', 'part of', 'see also'];
const INFO_NAMES = ['created', 'modified', 'updated', 'date', 'created at', 'updated at'];

/** The names in a comma list, lower case. */
const nameSet = (text) =>
  String(text || '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);

/**
 * How a property shows in the panel, apart from how it's stored: its
 * group — general, relationships (it names notes) or information (when)
 * — whether it's one of the main ones, and what a press on its value
 * does: open the note it names, or edit it.
 */
export function propertyPresentation(key, value, type, settings) {
  const lower = String(key).toLowerCase();
  const values = (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== undefined && v !== '');
  const links = values.length > 0 && values.every((v) => typeof v === 'string' && /^\[\[[^\]]+\]\]$/.test(v.trim()));
  const relation = RELATION_NAMES.indexOf(lower) !== -1 || lower === String((settings && settings.knowledgeBroader) || '').toLowerCase() || links;
  const info = !relation && (type === 'date' || type === 'datetime' || INFO_NAMES.indexOf(lower) !== -1);
  return {
    key,
    group: relation ? 'relationships' : info ? 'information' : 'general',
    primary: nameSet(settings && settings.panelPrimaryProps).indexOf(lower) !== -1,
    interaction: links ? 'note-link' : 'edit',
  };
}

export const PROPERTY_GROUPS = [
  { id: 'general', title: 'General' },
  { id: 'relationships', title: 'Relationships' },
  { id: 'information', title: 'Information' },
];

/* From how many properties a note's are grouped, set to group "when a note has many". */
export const GROUP_FROM = 8;

export class PropertiesSection extends PanelSection {
  get cls() {
    return 'dr-properties';
  }

  get frontmatter() {
    return noteProps(this.app, this.file);
  }

  /**
   * An information panel more than a form: the main properties, with
   * the rest a press away; grouped when there are many; editing as
   * immediate as ever, and managing in each row's menu.
   */
  render() {
    this.dropSuggests();
    const fm = this.frontmatter;
    const keys = Object.keys(fm).filter((k) => k !== 'position');
    const shown = keys.map((k) => propertyPresentation(k, fm[k], this.typeOf(k), this.settings));
    const grouping = this.settings.panelPropertyGroups || 'auto';
    const grouped = grouping === 'on' || (grouping === 'auto' && keys.length >= GROUP_FROM);
    // Grouped, each group keeps the note's order within it.
    const ordered = grouped ? PROPERTY_GROUPS.reduce((out, g) => out.concat(shown.filter((p) => p.group === g.id)), []) : shown;
    // Compact: the main ones, or the first three where none are; the rest folded under Show more.
    const compact = (this.settings.panelPropertiesView || 'compact') === 'compact' && !this.panel.showAllProps;
    const anyMain = shown.some((p) => p.primary);
    const isMain = (p, i) => (anyMain ? p.primary : i < 3);
    const main = new Set(shown.filter(isMain).map((p) => p.key));

    this.renderHead(keys.length);
    const list = this.containerEl.createDiv({ cls: 'dr-rows' });
    if (!keys.length) {
      list.createDiv({ cls: 'dr-empty', text: 'No properties' });
    }
    let group = null;
    ordered.forEach((p) => {
      const hidden = compact && !main.has(p.key);
      if (grouped && p.group !== group) {
        group = p.group;
        const head = list.createDiv({ cls: 'dr-row-group', text: PROPERTY_GROUPS.find((g) => g.id === group).title });
        head.dataset.group = group;
      }
      const row = this.renderRow(list, p.key, fm[p.key], p);
      if (hidden) row.addClass('is-secondary');
    });
    // A group whose rows are all folded away goes with them.
    list.querySelectorAll('.dr-row-group').forEach((head) => {
      let any = false;
      for (let el = head.nextElementSibling; el && !el.hasClass('dr-row-group'); el = el.nextElementSibling) {
        if (!el.hasClass('is-secondary')) any = true;
      }
      head.toggleClass('is-secondary', !any);
    });
    this.containerEl.toggleClass('is-compact', compact);

    const rest = compact ? keys.length - main.size : 0;
    if (rest > 0 || (this.panel.showAllProps && (this.settings.panelPropertiesView || 'compact') === 'compact')) {
      const more = this.containerEl.createDiv({ cls: 'dr-props-more' });
      asButton(more);
      more.createSpan({ text: rest > 0 ? `Show ${rest} more ${rest === 1 ? 'property' : 'properties'}` : 'Show fewer' });
      setIcon(more.createSpan({ cls: 'dr-props-more-icon' }), rest > 0 ? 'chevron-down' : 'chevron-up');
      onActivate(more, () => {
        this.panel.showAllProps = rest > 0;
        this.redraw();
      });
    }
    // With everything showing, the field to add another is there too.
    if (!compact || rest === 0) this.renderAdd(this.containerEl, keys);
    if (this.focusKey) {
      const key = this.focusKey;
      this.focusKey = null;
      const row = list.querySelector(`.dr-row[data-key="${CSS.escape(key)}"]`);
      const target = row && row.querySelector('.dr-value input, .dr-value [contenteditable], .dr-value textarea');
      if (target) target.focus();
    }
  }

  /** Over the rows: the heading, + to add one, and ··· for how they show. */
  renderHead(count) {
    const head = this.containerEl.createDiv({ cls: 'dr-props-head' });
    head.createSpan({ cls: 'dr-props-title', text: 'Properties' });
    const add = head.createDiv({ cls: 'clickable-icon dr-props-add' });
    asButton(add, 'Add property');
    setIcon(add, 'plus');
    onActivate(add, () => {
      // Adding wants the whole list, with its field.
      this.panel.showAllProps = true;
      this.redraw();
      const input = this.containerEl && this.containerEl.querySelector('.dr-add input');
      if (input) input.focus();
    });
    const more = head.createDiv({ cls: 'clickable-icon dr-props-menu' });
    asButton(more, 'How properties show');
    setIcon(more, 'ellipsis');
    onActivate(more, (evt) => this.showViewMenu(evt));
    head.dataset.count = String(count);
  }

  /** How the panel shows properties: the main ones or all, grouped or not, and which are main. */
  showViewMenu(evt) {
    const menu = new Menu();
    const view = this.settings.panelPropertiesView || 'compact';
    const set = async (key, value) => {
      this.settings[key] = value;
      this.panel.showAllProps = false;
      await this.plugin.saveData(this.settings);
      this.redraw();
    };
    menu.addItem((item) => item.setTitle('The main ones').setChecked(view === 'compact').setSection('view').onClick(() => set('panelPropertiesView', 'compact')));
    menu.addItem((item) => item.setTitle('All properties').setChecked(view === 'all').setSection('view').onClick(() => set('panelPropertiesView', 'all')));
    const grouping = this.settings.panelPropertyGroups || 'auto';
    menu.addItem((item) =>
      item
        .setTitle('Grouped')
        .setChecked(grouping === 'on')
        .setSection('group')
        .onClick(() => set('panelPropertyGroups', grouping === 'on' ? 'off' : 'on'))
    );
    if (typeof this.plugin.openSettingsAt === 'function') {
      menu.addItem((item) => item.setTitle('Choose the main properties…').setIcon('settings').setSection('settings').onClick(() => this.plugin.openSettingsAt('panelPrimaryProps')));
    }
    const r = (evt && evt.currentTarget && evt.currentTarget.getBoundingClientRect) ? evt.currentTarget.getBoundingClientRect() : null;
    if (r) menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
    else menu.showAtPosition({ x: 0, y: 0 });
  }

  renderRow(parentEl, key, value, shown) {
    const type = this.typeOf(key);
    const row = parentEl.createDiv({ cls: 'dr-row' });
    row.setAttribute('data-property-type', type);
    row.dataset.key = key;
    if (shown) {
      row.dataset.group = shown.group;
      if (shown.primary) row.addClass('is-main');
    }

    // A grip at the row's edge, shown when pointed at: the plain way to
    // move it. The type icon still drags too, as in Obsidian's own block.
    const grip = row.createDiv({ cls: 'dr-row-grip' });
    grip.setAttribute('aria-hidden', 'true');
    setIcon(grip, 'grip-vertical');
    this.makeDraggable(parentEl, row, grip);

    const keyEl = row.createDiv({ cls: 'dr-key' });
    // The type icon is the row's handle, as in Obsidian's own block:
    // press and drag to move the property, click for its menu.
    const icon = keyEl.createSpan({ cls: 'dr-key-icon' });
    icon.setAttribute('aria-label', `${TYPE_LABELS[type] || type} — drag to move`);
    asButton(icon);
    setIcon(icon, TYPE_ICONS[type] || 'text');
    icon.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (this.justMoved) return;
      this.showMenu(key, icon);
    });
    icon.addEventListener('keydown', (evt) => {
      if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
        evt.preventDefault();
        if (this.moveRow(row, evt.key === 'ArrowUp' ? -1 : 1)) icon.focus();
      } else if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        this.showMenu(key, icon);
      }
    });
    this.makeDraggable(parentEl, row, icon);

    const name = keyEl.createEl('input', { cls: 'dr-key-name', type: 'text' });
    name.value = key;
    name.setAttribute('aria-label', key);
    name.addEventListener('change', () => {
      const next = name.value.trim();
      if (!next || next === key) {
        name.value = key;
        return;
      }
      this.rename(key, next);
    });

    const valueEl = row.createDiv({ cls: 'dr-value' });
    if (!this.renderWidget(valueEl, key, value, type)) {
      this.renderFallback(valueEl, key, value);
    }
    // A quiet link in a property shows as the note it names.
    const quiet = typeof this.plugin.feature === 'function' ? this.plugin.feature(QuietLinks) : null;
    if (quiet && quiet.enabled) quiet.quietenProperties(valueEl, this.file.path);

    // A note a value names: a press offers to open it, see what's related, or its graph.
    if (shown && shown.interaction === 'note-link') {
      row.addClass('is-link');
      valueEl.addEventListener('contextmenu', (evt) => this.linkMenu(evt, value));
    }

    // One menu for everything else, from ··· when the row is pointed at, or a right-click.
    const more = row.createDiv({ cls: 'clickable-icon dr-row-more' });
    asButton(more, `${key}: more`);
    setIcon(more, 'ellipsis');
    onActivate(more, (evt) => {
      if (evt && evt.stopPropagation) evt.stopPropagation();
      this.showMenu(key, more);
    });
    row.addEventListener('contextmenu', (evt) => {
      if (evt.defaultPrevented) return;
      evt.preventDefault();
      this.showMenu(key, more);
    });
    return row;
  }

  /** A note named in a property: open it, here or in a new tab, its related notes, or its graph. */
  linkMenu(evt, value) {
    const names = (Array.isArray(value) ? value : [value])
      .map((v) => String(v || '').replace(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/, '$1').trim())
      .filter(Boolean);
    const cache = this.app.metadataCache;
    if (!cache || typeof cache.getFirstLinkpathDest !== 'function') return;
    const targets = names.map((n) => cache.getFirstLinkpathDest(n, this.file.path)).filter(Boolean);
    // Over one pill, that note; anywhere else in the value, the first.
    const pill = evt.target && evt.target.closest ? evt.target.closest('.multi-select-pill, .internal-link') : null;
    const text = pill ? pill.textContent.trim() : '';
    const file = targets.find((f) => f.basename === text) || targets[0];
    if (!file) return;
    evt.preventDefault();
    const menu = new Menu();
    const ws = this.app.workspace;
    const close = () => typeof this.panel.close === 'function' && this.panel.close();
    menu.addItem((item) => {
      item.setTitle(file.basename).setIcon('file-text').setSection('title');
      if (typeof item.setDisabled === 'function') item.setDisabled(true);
    });
    menu.addItem((item) => item.setTitle('Open note').setIcon('file-text').setSection('open').onClick(() => { ws.getLeaf(false).openFile(file); close(); }));
    menu.addItem((item) => item.setTitle('Open in new tab').setIcon('file-plus').setSection('open').onClick(() => { ws.getLeaf('tab').openFile(file); close(); }));
    const library = this.plugin.feature ? this.plugin.feature(Library) : null;
    if (library && library.enabled) {
      menu.addItem((item) =>
        item.setTitle('Show related notes').setIcon('waypoints').setSection('related').onClick(() => { library.browseMode({ mode: 'concept', path: '/', property: file.path }); close(); })
      );
    }
    // Its own graph: Obsidian's local graph, beside the note opened.
    menu.addItem((item) =>
      item
        .setTitle('Show in its graph')
        .setIcon('git-fork')
        .setSection('related')
        .onClick(async () => {
          await ws.getLeaf(false).openFile(file);
          close();
          if (this.app.commands && typeof this.app.commands.executeCommandById === 'function') this.app.commands.executeCommandById('graph:open-local');
        })
    );
    menu.showAtMouseEvent(evt);
  }

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

  /** The properties in the order the rows now show them. */
  orderIn(list) {
    return Array.from(list.querySelectorAll(':scope > .dr-row')).map((r) => r.dataset.key);
  }

  /**
   * Drag a row by its handle. Nothing happens until the pointer has
   * moved a few pixels, so a press that doesn't move is still a click.
   * The row moves among the others as it's dragged, and the new order
   * is written when it's let go; Escape puts everything back. Pointer
   * events, not the browser's drag and drop, so it works the same with
   * a finger on a phone.
   */
  makeDraggable(list, row, handle) {
    handle.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      const startY = down.clientY;
      const before = this.orderIn(list);
      const scroller = this.panel && this.panel.popupEl;
      let dragging = false;

      const place = (y) => {
        const others = Array.from(list.querySelectorAll(':scope > .dr-row')).filter(
          (r) => r !== row
        );
        const next = others.find((r) => {
          const box = r.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        if (next) {
          if (row.nextElementSibling !== next) list.insertBefore(row, next);
        } else if (list.lastElementChild !== row) {
          list.appendChild(row);
        }
      };

      // Near the top or bottom of a long panel, it scrolls to follow.
      const follow = (y) => {
        if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return;
        const box = scroller.getBoundingClientRect();
        if (y < box.top + 28) scroller.scrollTop -= 10;
        else if (y > box.bottom - 28) scroller.scrollTop += 10;
      };

      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4) return;
          dragging = true;
          row.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        follow(evt.clientY);
        place(evt.clientY);
      };

      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        if (!dragging) return;
        row.removeClass('is-dragging');
        list.removeClass('is-sorting');
        // The click that ends a drag isn't a request for the menu.
        this.justMoved = true;
        window.setTimeout(() => (this.justMoved = false), 0);

        const after = this.orderIn(list);
        if (!keep) {
          before.forEach((k) => {
            const r = list.querySelector(`:scope > .dr-row[data-key="${CSS.escape(k)}"]`);
            if (r) list.appendChild(r);
          });
          return;
        }
        if (after.join('\n') !== before.join('\n')) this.reorder(after);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }

  /** One place up or down, from the keyboard or the menu. */
  moveRow(row, delta) {
    const list = row.parentElement;
    if (!list) return false;
    const rows = Array.from(list.querySelectorAll(':scope > .dr-row'));
    const at = rows.indexOf(row);
    const to = at + delta;
    if (at === -1 || to < 0 || to >= rows.length) return false;
    list.insertBefore(row, delta < 0 ? rows[to] : rows[to].nextElementSibling);
    this.reorder(this.orderIn(list));
    return true;
  }

  /**
   * Obsidian's own editor for this type.
   *
   * registeredTypeWidgets holds the factories behind the native
   * property block; each exposes render(containerEl, value, ctx). The
   * context shape isn't documented, so every plausible field is passed
   * and the call is guarded.
   */
  renderWidget(parentEl, key, value, type) {
    try {
      const widgets = this.app.metadataTypeManager.registeredTypeWidgets;
      const widget = widgets && widgets[type];
      if (!widget || typeof widget.render !== 'function') return false;

      widget.render(parentEl, value, {
        app: this.app,
        key: key,
        sourcePath: this.file.path,
        blur: () => {},
        onChange: (v) => this.write(key, v, { redraw: false }),
        rendered: true,
        metadataEditor: {
          app: this.app,
          register: () => {},
          sourcePath: this.file.path,
        },
      });
      return parentEl.childElementCount > 0;
    } catch (err) {
      console.error('Design Redux: value widget failed', err);
      parentEl.empty();
      return false;
    }
  }

  /** Plain text, for when a widget isn't available. */
  renderFallback(parentEl, key, value) {
    const input = parentEl.createEl('input', { cls: 'dr-input', type: 'text' });
    input.value = value == null ? '' : String(value);
    input.addEventListener('change', () => this.write(key, input.value, { redraw: false }));
  }

  renderAdd(parentEl, existing) {
    const add = parentEl.createDiv({ cls: 'dr-add' });
    const icon = add.createSpan({ cls: 'dr-add-icon' });
    setIcon(icon, 'plus');

    const field = add.createDiv({ cls: 'dr-field' });
    const input = field.createEl('input', { type: 'text' });
    input.placeholder = 'Add property';

    // A name the note already has goes to that property instead of
    // writing over it with an empty value.
    const commit = (name) => {
      const key = (name === undefined ? input.value : name).trim();
      if (!key) return;
      input.value = '';
      const have = Object.keys(this.frontmatter).find(
        (k) => k !== 'position' && k.toLowerCase() === key.toLowerCase()
      );
      if (have) {
        const row = this.containerEl.querySelector(`.dr-row[data-key="${CSS.escape(have)}"]`);
        const target = row && row.querySelector('.dr-value input, .dr-value [contenteditable], .dr-value textarea');
        if (target) target.focus();
        new Notice(`This note already has "${have}".`);
        return;
      }
      // Its value is what's typed next.
      this.focusKey = key;
      this.write(key, '', { onlyNew: true });
    };

    const have = existing.map((k) => k.toLowerCase());
    // How many notes use each, so the one already in use is the one chosen.
    const counts = new Map();
    try {
      const all = this.app.metadataTypeManager.getAllProperties() || {};
      const count = propertyCounter(this.app);
      Object.keys(all).forEach((k) => counts.set(((all[k] && all[k].name) || k).toLowerCase(), count(k, all[k])));
    } catch (err) {
      counts.clear();
    }
    this.suggests.push(attachSuggest(field, input, {
      icon: 'tag',
      source: () =>
        this.knownProperties().filter(
          (n) => have.indexOf(n.toLowerCase()) === -1
        ),
      note: (name) => {
        const n = counts.get(name.toLowerCase());
        return n ? `${n} ${n === 1 ? 'note' : 'notes'}` : '';
      },
      create: (name) => `Create “${name}”`,
      onSelect: (v) => commit(v),
    }));

    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt)) return;
      evt.preventDefault();
      commit();
    });
  }

  /** Property names already used in the vault, most common first. */
  knownProperties() {
    return knownPropertyNames(this.app);
  }

  typeOf(key) {
    try {
      const info = this.app.metadataTypeManager.getTypeInfo(key);
      const t =
        (info && info.expected && info.expected.type) ||
        (info && info.inferred && info.inferred.type);
      if (t && TYPE_ICONS[t]) return t;
    } catch (err) {
      /* fall through */
    }
    return 'text';
  }

  /**
   * A property's menu, by how far a choice reaches: the property itself —
   * its type, which Obsidian keeps for every note, renaming it across the
   * vault, its place here; then finding the notes that share it; then what
   * changes other notes, under Manage across vault; last, taking it out
   * of this note.
   */
  showMenu(key, anchorEl) {
    const menu = new Menu();
    const current = this.typeOf(key);
    const sectioned = (item, section) => (typeof item.setSection === 'function' ? item.setSection(section) : item);

    menuGroup(
      menu,
      'Change type',
      TYPE_ICONS[current] || 'shapes',
      (m, nested) =>
        Object.keys(TYPE_ICONS).forEach((type) =>
          m.addItem((item) => {
            item.setTitle(nested ? TYPE_LABELS[type] : `Type: ${TYPE_LABELS[type]}`);
            item.setIcon(TYPE_ICONS[type]);
            item.setChecked(type === current);
            if (!nested) sectioned(item, 'property');
            item.onClick(() => {
              try {
                this.app.metadataTypeManager.setType(key, type);
                this.forceRefresh();
              } catch (err) {
                console.error('Design Redux: could not set the type', err);
              }
            });
          })
        ),
      'property'
    );
    const bulk = this.plugin.feature ? this.plugin.feature(BulkEditing) : null;
    if (bulk) menu.addItem((item) => sectioned(item, 'property').setTitle('Rename across vault…').setIcon('pencil').onClick(() => bulk.openRenameProperty(key)));

    // For touch, where a drag is harder to aim, and for anyone who'd rather not drag.
    const row = anchorEl.closest('.dr-row');
    const rows = row && row.parentElement ? Array.from(row.parentElement.querySelectorAll(':scope > .dr-row')) : [];
    const at = rows.indexOf(row);
    menuGroup(
      menu,
      'Move',
      'arrow-up-down',
      (m, nested) =>
        [
          ['Up', 'Move up', 'arrow-up', -1, at > 0],
          ['Down', 'Move down', 'arrow-down', 1, at !== -1 && at < rows.length - 1],
        ].forEach(([short, long, icon, delta, possible]) =>
          m.addItem((item) => {
            item.setTitle(nested ? short : long).setIcon(icon);
            if (!nested) sectioned(item, 'property');
            if (typeof item.setDisabled === 'function') item.setDisabled(!possible);
            item.onClick(() => {
              if (possible) this.moveRow(row, delta);
            });
          })
        ),
      'property'
    );

    this.findEntries(key).forEach(([title, icon, run]) => menu.addItem((item) => sectioned(item, 'find').setTitle(title).setIcon(icon).onClick(run)));

    const manage = this.manageEntries(key);
    if (manage.length) {
      menuGroup(
        menu,
        'Manage across vault',
        'globe',
        (sub, nested) =>
          manage.forEach(([title, long, icon, run]) =>
            sub.addItem((item) => {
              item.setTitle(nested ? title : long).setIcon(icon).onClick(run);
              if (!nested) sectioned(item, 'manage');
            })
          ),
        'manage'
      );
    }
    menu.addItem((item) => sectioned(item, 'remove').setTitle('Remove from note').setIcon('trash-2').onClick(() => this.remove(key)));

    const r = anchorEl.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  /**
   * The notes that share it, in the Properties screen, each [title, icon,
   * run]: those with this note's value — each of a list's first three —
   * and every note with the property.
   */
  findEntries(key) {
    const out = [];
    const library = this.plugin.feature ? this.plugin.feature(Library) : null;
    if (!library || !library.enabled) return out;
    // The Properties screen knows a property by Obsidian's key for it, in lower case.
    const open = (value) => library.browseMode({ mode: 'properties', property: String(key).toLowerCase(), value: value || null });
    const raw = noteProps(this.app, this.file)[key];
    (Array.isArray(raw) ? raw : [raw])
      .map((v) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v)))
      .map((v) => v.replace(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/, '$1').trim())
      .filter((v) => v && v.length <= 60)
      .slice(0, 3)
      .forEach((v) => out.push([`Find notes with “${v}”`, 'filter', () => open(v)]));
    out.push([`Find all notes with ${key}`, 'list', () => open(null)]);
    return out;
  }

  /**
   * What changes other notes, each [short title, title when not nested,
   * icon, run]: setting it for the whole collection, merging it with
   * another property, taking it out of every note.
   */
  manageEntries(key) {
    const out = [];
    const album = this.plugin.feature ? this.plugin.feature(AlbumProperty) : null;
    const file = this.file;
    if (album && album.enabled && file && album.albumNotes(file).length) {
      const name = `Set for all of ${album.albumName(file)}`;
      out.push([name, name, 'layers', () => album.apply(file, key)]);
    }
    const bulk = this.plugin.feature ? this.plugin.feature(BulkEditing) : null;
    if (bulk) {
      out.push(['Merge with another property…', `Merge ${key} with another property…`, 'git-merge', () => bulk.openMerge([key])]);
      out.push(['Remove from every note…', `Remove ${key} from every note…`, 'list-minus', () => bulk.openRemove([this.app.vault.getRoot()], [key])]);
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

