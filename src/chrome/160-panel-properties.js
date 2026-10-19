/* ------------------------------------------------------------------ */
/* Properties                                                          */
/*                                                                     */
/* Rows are this plugin's markup. Each value cell is rendered by       */
/* Obsidian's own widget for that property's type, so date pickers,    */
/* link autocomplete, pill rendering and validation are the real       */
/* ones. Writes go through processFrontMatter, which is atomic.        */
/* ------------------------------------------------------------------ */

import { Menu, Notice, Platform, setIcon } from 'obsidian';
import { TYPE_ICONS, TYPE_LABELS } from '../core/020-constants.js';
import { composing, menuGroup } from '../core/030-helpers-art.js';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { knownPropertyNames } from '../core/045-helpers-properties.js';
import { noteProps, orderKeys } from '../core/073-notes.js';
import { PanelSection } from '../core/082-panel-section.js';
import { optionFor } from '../core/088-property-options.js';
import { Library } from '../library/130-browse-filters.js';
import { paintValue, valueOptionsOn } from '../ui/248-value-options.js';
import { AlbumProperty } from '../library/255-album-property.js';
import { QuietLinks } from '../links/265-quiet-links.js';
import { BulkEditing } from '../bulk/310-bulk-feature.js';

/** The names in a comma list, lower case. */
export const propNames = (text) =>
  String(text || '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);

/** The groups set in settings, each { title, keys: [lower-case names] }. */
export function propertyGroups(settings) {
  const list = Array.isArray(settings && settings.panelGroupList) ? settings.panelGroupList : [];
  return list
    .filter((g) => g && String(g.title || '').trim())
    .map((g) => ({ title: String(g.title).trim(), keys: propNames(Array.isArray(g.keys) ? g.keys.join(',') : g.keys) }));
}

/* Where a property no group names goes, while there are groups. */
export const OTHER_GROUP = 'Other';

/**
 * How a property shows in the panel, apart from how it's stored: the
 * group it's set under — only as set, nothing guessed from its name —
 * whether it's one of the main ones, and whether its value names notes.
 */
export function propertyPresentation(key, value, type, settings) {
  const lower = String(key).toLowerCase();
  const values = (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== undefined && v !== '');
  const links = values.length > 0 && values.every((v) => typeof v === 'string' && /^\[\[[^\]]+\]\]$/.test(v.trim()));
  const group = propertyGroups(settings).find((g) => g.keys.indexOf(lower) !== -1);
  return {
    key,
    group: group ? group.title : OTHER_GROUP,
    primary: propNames(settings && settings.panelPrimaryProps).indexOf(lower) !== -1,
    interaction: links ? 'note-link' : 'edit',
  };
}

export class PropertiesSection extends PanelSection {
  get cls() {
    return 'dr-properties';
  }

  get frontmatter() {
    return noteProps(this.app, this.file);
  }

  /**
   * A light inspector while reading, a full editor once touched: a
   * heading that folds the panel; the main properties, or all of them —
   * remembered from note to note; groups only where set; each row its
   * value to edit and, when pointed at or focused, its menu.
   */
  render() {
    this.dropSuggests();
    const fm = this.frontmatter;
    const keys = Object.keys(fm).filter((k) => k !== 'position');
    const settings = this.settings;
    const shown = keys.map((k) => propertyPresentation(k, fm[k], this.typeOf(k), settings));
    const collapsed = !!settings.panelPropsCollapsed;

    this.renderHead(keys.length, collapsed);
    this.containerEl.toggleClass('is-collapsed', collapsed);
    if (collapsed) return;

    // The main ones: as set, in that order; where a note has none, its first three.
    const mainNames = propNames(settings.panelPrimaryProps);
    const anyMain = shown.some((p) => p.primary);
    const main = anyMain
      ? shown.filter((p) => p.primary).sort((a, b) => mainNames.indexOf(a.key.toLowerCase()) - mainNames.indexOf(b.key.toLowerCase()))
      : shown.slice(0, 3);
    const compact = (settings.panelPropertiesView || 'compact') === 'compact';
    const rest = keys.length - main.length;
    // Every row is drawn, so moving one keeps the rest in their places; in compact, the main ones lead and the rest wait folded.
    const mainKeys = new Set(main.map((p) => p.key));
    const visible = compact ? main.concat(shown.filter((p) => !mainKeys.has(p.key))) : shown;

    const grouped = settings.panelPropertyGroups === 'on' && propertyGroups(settings).length > 0;
    const order = grouped ? propertyGroups(settings).map((g) => g.title).concat([OTHER_GROUP]) : [null];
    const folded = new Set(Array.isArray(settings.panelFoldedGroups) ? settings.panelFoldedGroups : []);

    const list = this.containerEl.createDiv({ cls: 'dr-rows' });
    if (!keys.length) {
      const empty = list.createDiv({ cls: 'dr-empty' });
      empty.createSpan({ text: 'No properties. ' });
      const add = empty.createSpan({ cls: 'dr-empty-add', text: 'Add one' });
      asButton(add);
      onActivate(add, () => this.openAddPicker());
    }
    order.forEach((title) => {
      const rows = grouped ? visible.filter((p) => p.group === title) : visible;
      if (!rows.length) return;
      const isFolded = grouped && folded.has(title);
      const waiting = (p) => compact && !mainKeys.has(p.key);
      if (grouped && rows.every(waiting)) {
        rows.forEach((p) => this.renderRow(list, p.key, fm[p.key], p).addClass('is-secondary'));
        return;
      }
      if (grouped) {
        const head = list.createDiv({ cls: `dr-row-group${isFolded ? ' is-folded' : ''}` });
        head.dataset.group = title;
        asButton(head, isFolded ? `Show ${title}` : `Fold ${title}`);
        head.setAttribute('aria-expanded', String(!isFolded));
        setIcon(head.createSpan({ cls: 'dr-row-group-chevron' }), isFolded ? 'chevron-right' : 'chevron-down');
        head.createSpan({ text: title });
        onActivate(head, () => {
          if (folded.has(title)) folded.delete(title);
          else folded.add(title);
          settings.panelFoldedGroups = Array.from(folded);
          this.plugin.saveData(settings);
          this.redraw();
        });
      }
      rows.forEach((p) => {
        const row = this.renderRow(list, p.key, fm[p.key], p);
        if (isFolded || waiting(p)) row.addClass('is-secondary');
      });
    });

    if (rest > 0) {
      const more = this.containerEl.createDiv({ cls: 'dr-props-more' });
      asButton(more);
      more.createSpan({ text: compact ? `Show ${rest} more` : 'Show fewer' });
      setIcon(more.createSpan({ cls: 'dr-props-more-icon' }), compact ? 'chevron-down' : 'chevron-up');
      onActivate(more, async () => {
        settings.panelPropertiesView = compact ? 'all' : 'compact';
        await this.plugin.saveData(settings);
        this.redraw();
      });
    }
    if (this.focusKey) {
      const key = this.focusKey;
      this.focusKey = null;
      const row = list.querySelector(`.dr-row[data-key="${CSS.escape(key)}"]`);
      const target = row && row.querySelector('.dr-value input, .dr-value [contenteditable], .dr-value textarea');
      if (target) target.focus();
    }
    if (this.pickerOpen) {
      this.pickerOpen = false;
      this.openAddPicker();
    }
  }

  /** The heading: a press folds or opens the panel; + adds a property; ··· for how they show. */
  renderHead(count, collapsed) {
    const head = this.containerEl.createDiv({ cls: 'dr-props-head' });
    const toggle = head.createDiv({ cls: 'dr-props-toggle' });
    asButton(toggle, collapsed ? 'Show the properties' : 'Fold the properties');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.createSpan({ cls: 'dr-props-title', text: 'Properties' });
    if (collapsed && count) toggle.createSpan({ cls: 'dr-props-count', text: String(count) });
    setIcon(toggle.createSpan({ cls: 'dr-props-chevron' }), collapsed ? 'chevron-right' : 'chevron-down');
    onActivate(toggle, async () => {
      this.settings.panelPropsCollapsed = !collapsed;
      await this.plugin.saveData(this.settings);
      this.redraw();
    });
    const add = head.createDiv({ cls: 'clickable-icon dr-props-add' });
    asButton(add, 'Add property');
    setIcon(add, 'plus');
    onActivate(add, (evt) => {
      if (evt && evt.stopPropagation) evt.stopPropagation();
      if (!this.settings.panelPropsCollapsed) return this.openAddPicker();
      // Adding needs the panel open.
      this.settings.panelPropsCollapsed = false;
      this.pickerOpen = true;
      this.plugin.saveData(this.settings);
      this.redraw();
    });
    const more = head.createDiv({ cls: 'clickable-icon dr-props-menu' });
    asButton(more, 'How properties show');
    setIcon(more, 'ellipsis');
    onActivate(more, (evt) => {
      if (evt && evt.stopPropagation) evt.stopPropagation();
      this.showViewMenu(evt);
    });
  }

  /** How the panel shows properties: all or the main ones, grouped or not, and the settings for both. */
  showViewMenu(evt) {
    const menu = new Menu();
    const view = this.settings.panelPropertiesView || 'compact';
    const set = async (key, value) => {
      this.settings[key] = value;
      await this.plugin.saveData(this.settings);
      this.redraw();
    };
    menu.addItem((item) => item.setTitle('Show all properties').setChecked(view === 'all').setSection('view').onClick(() => set('panelPropertiesView', view === 'all' ? 'compact' : 'all')));
    if (propertyGroups(this.settings).length) {
      const on = this.settings.panelPropertyGroups === 'on';
      menu.addItem((item) => item.setTitle('Group properties').setChecked(on).setSection('view').onClick(() => set('panelPropertyGroups', on ? 'off' : 'on')));
    }
    if (typeof this.plugin.openSettingsAt === 'function') {
      menu.addItem((item) => item.setTitle('Property settings…').setSection('settings').onClick(() => this.plugin.openSettingsAt('panelPrimaryProps')));
    }
    const el = evt && evt.currentTarget && evt.currentTarget.getBoundingClientRect ? evt.currentTarget : null;
    const r = el ? el.getBoundingClientRect() : { left: 0, bottom: 0 };
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
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
    this.paintValues(valueEl, key, value);
    // A quiet link in a property shows as the note it names.
    const quiet = typeof this.plugin.feature === 'function' ? this.plugin.feature(QuietLinks) : null;
    if (quiet && quiet.enabled) quiet.quietenProperties(valueEl, this.file.path);

    // A value naming notes opens them as links do; its menu offers them too.
    if (shown && shown.interaction === 'note-link') row.addClass('is-link');

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
  /** Values with a colour or an icon of their own show them: each item of a list as a pill does, one value by a mark at its side. */
  paintValues(valueEl, key, value) {
    if (!valueOptionsOn(this.plugin)) return;
    const pills = valueEl.querySelectorAll('.multi-select-pill');
    if (pills.length) {
      pills.forEach((pill) => paintValue(pill, this.plugin, key, (pill.querySelector('.multi-select-pill-content') || pill).textContent.trim()));
      return;
    }
    const option = value !== null && value !== undefined && typeof value !== 'object' ? optionFor(this.settings.propertyOptions, key, String(value)) : null;
    if (option && option.color) valueEl.dataset.drColor = option.color;
  }

  renderFallback(parentEl, key, value) {
    const input = parentEl.createEl('input', { cls: 'dr-input', type: 'text' });
    input.value = value == null ? '' : String(value);
    input.addEventListener('change', () => this.write(key, input.value, { redraw: false }));
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
    const known = this.knownProperties().filter((n) => have.indexOf(n.toLowerCase()) === -1);
    let items = [];
    let active = 0;
    const close = () => picker.remove();
    const choose = (name) => {
      close();
      this.commitAdd(name);
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
      const names = known.filter((n) => !low || n.toLowerCase().includes(low)).slice(0, 8);
      const exact = known.concat(Object.keys(this.frontmatter)).some((n) => n.toLowerCase() === low);
      items = names.map((n) => ({ name: n, label: n })).concat(q && !exact ? [{ name: q, label: `Create “${q}”`, create: true }] : !q ? [{ name: '', label: 'Create new property', create: true }] : []);
      active = Math.min(active, Math.max(0, items.length - 1));
      list.empty();
      if (names.length) list.createDiv({ cls: 'dr-add-heading', text: low ? 'Properties' : 'Suggested' });
      items.forEach((item, i) => {
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
      choose(item.name);
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

  /** A property added by name: one the note already has is gone to instead of written over. */
  commitAdd(name) {
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
    this.write(key, '', { onlyNew: true });
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
    const bulk = this.plugin.feature ? this.plugin.feature(BulkEditing) : null;
    if (bulk) out.push(['Rename everywhere…', `Rename ${key} everywhere…`, 'pencil', () => bulk.openRenameProperty(key)]);
    const album = this.plugin.feature ? this.plugin.feature(AlbumProperty) : null;
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

