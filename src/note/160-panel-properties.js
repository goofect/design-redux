/* ------------------------------------------------------------------ */
/* Properties                                                          */
/*                                                                     */
/* Rows are this plugin's markup. Each value cell is rendered by       */
/* Obsidian's own widget for that property's type, so date pickers,    */
/* link autocomplete, pill rendering and validation are the real       */
/* ones. Writes go through plugin.notes, with Undo (161).             */
/* ------------------------------------------------------------------ */

import { Menu, normalizePath, setIcon } from 'obsidian';
import { TYPE_ICONS, TYPE_LABELS } from '../core/020-constants.js';
import { asButton, onActivate } from '../core/042-controls.js';
import { knownPropertyNames, typeInfoOf } from '../core/045-helpers-properties.js';
import { noteProps } from '../core/073-notes.js';
import { PanelSection } from '../core/082-panel-section.js';
import { optionFor } from '../core/088-property-options.js';
import { LinkNotePicker, NamePrompt } from '../ui/230-pickers.js';
import { paintValue, valueOptionsOn } from '../ui/248-value-options.js';

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

/** The folder whose own main properties a note takes: the nearest up from it that has some, or null. */
export function panelViewFolder(settings, file) {
  const views = (settings && settings.panelFolderViews) || {};
  for (let f = file && file.parent; f; f = f.parent) {
    const v = views[f.path || '/'];
    if (v && typeof v.main === 'string' && v.main.trim()) return f.path || '/';
    if (!f.path || f.path === '/') break;
  }
  return null;
}

/**
 * Whether this Obsidian's value widgets take an entry rather than the value:
 * found by asking the text widget to show one, off the page, and seeing what
 * it shows. Asked once for each set of widgets. Unknown counts as no: the newer way.
 */
const ENTRY_WIDGETS = new WeakMap();

export function widgetsTakeEntry(widgets, context) {
  if (!widgets || typeof widgets !== 'object') return false;
  if (ENTRY_WIDGETS.has(widgets)) return ENTRY_WIDGETS.get(widgets);
  let entry = false;
  try {
    const text = widgets.text;
    if (text && typeof text.render === 'function') {
      const el = document.createElement('div');
      const noop = () => {};
      text.render(el, { key: 'dr', type: 'text', value: 'dr-probe' }, Object.assign({}, context, { key: 'dr', blur: noop, onChange: noop }));
      const field = el.querySelector('input, textarea, [contenteditable]');
      const shown = field ? ('value' in field ? field.value : field.textContent) : el.textContent;
      entry = String(shown).trim() === 'dr-probe';
    }
  } catch (err) {
    entry = false;
  }
  ENTRY_WIDGETS.set(widgets, entry);
  return entry;
}

export class PropertyRows extends PanelSection {
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
  /** Settings as this note's panel reads them: its folder's own main properties, where it has some, in place of the vault's. */
  viewSettings() {
    const at = this.file ? panelViewFolder(this.settings, this.file) : null;
    return at ? Object.assign({}, this.settings, { panelPrimaryProps: this.settings.panelFolderViews[at].main }) : this.settings;
  }

  render() {
    this.dropSuggests();
    const fm = this.frontmatter;
    const keys = Object.keys(fm).filter((k) => k !== 'position');
    const settings = this.viewSettings();
    const shown = keys.map((k) => propertyPresentation(k, fm[k], this.typeOf(k, fm[k]), settings));
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
    // The main properties kept for the folder the note is in, the folders below taking them too.
    const folder = this.file && this.file.parent;
    if (folder) {
      const path = folder.path || '/';
      const views = this.settings.panelFolderViews || {};
      const own = views[path] && views[path].main;
      const keep = async (main) => {
        const next = Object.assign({}, views);
        if (main && main.trim()) next[path] = { main: propNames(main).join(', ') };
        else delete next[path];
        this.settings.panelFolderViews = next;
        await this.plugin.saveData(this.settings);
        this.redraw();
      };
      menu.addItem((item) =>
        item
          .setTitle('Main properties for this folder…')
          .setSection('settings')
          .onClick(() => new NamePrompt(this.app, `Main properties in ${folder.name || this.app.vault.getName()}`, 'Their names, by commas, in order', keep, { value: this.viewSettings().panelPrimaryProps || '', button: 'Keep', allowEmpty: true }).open())
      );
      if (own) menu.addItem((item) => item.setTitle('Main properties as the vault’s').setSection('settings').onClick(() => keep('')));
    }
    if (typeof this.plugin.openSettingsAt === 'function') {
      menu.addItem((item) => item.setTitle('Property settings…').setSection('settings').onClick(() => this.plugin.openSettingsAt('panelPrimaryProps')));
    }
    const el = evt && evt.currentTarget && evt.currentTarget.getBoundingClientRect ? evt.currentTarget : null;
    const r = el ? el.getBoundingClientRect() : { left: 0, bottom: 0 };
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  renderRow(parentEl, key, value, shown) {
    const type = this.typeOf(key, value);
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

      const context = {
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
      };
      // Older Obsidian's widgets take { key, type, value }, newer ones the value alone.
      widget.render(parentEl, widgetsTakeEntry(widgets, context) ? { key, type, value } : value, context);
      return parentEl.childElementCount > 0;
    } catch (err) {
      console.error('Design Redux: value widget failed', err);
      parentEl.empty();
      return false;
    }
  }

  /** Plain text, for when a widget isn't available. */
  /** A note linked from a property: added to a list, or made the value — one step of Undo. A new note is made beside this one. */
  linkNote(key, type) {
    const file = this.file;
    if (!file) return;
    const link = (target) => {
      const text = this.app.metadataCache.fileToLinktext(target, file.path, true);
      return this.plugin.notes.write(
        file,
        (fm) => {
          const name = Object.keys(fm).find((k) => k.toLowerCase() === key.toLowerCase()) || key;
          const now = fm[name];
          const value = `[[${text}]]`;
          if (Array.isArray(now)) {
            if (!now.includes(value)) now.push(value);
          } else if (type === 'multitext') fm[name] = now === null || now === undefined || now === '' ? [value] : [now, value];
          else fm[name] = value;
        },
        { undo: `Linked “${target.basename}” in ${key}.` }
      );
    };
    new LinkNotePicker(this.app, link, async (name) => {
      const parent = this.app.fileManager.getNewFileParent(file.path);
      const where = parent && parent.path && parent.path !== '/' ? `${parent.path}/` : '';
      const made = await this.app.vault.create(normalizePath(`${where}${name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').trim()}.md`), '');
      return link(made);
    }).open();
  }

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

  /** Property names already used in the vault, most common first. */
  knownProperties() {
    return knownPropertyNames(this.app);
  }

  typeOf(key, value) {
    try {
      const info = typeInfoOf(this.app, key, value);
      const t =
        (info && info.expected && info.expected.type) ||
        (info && info.inferred && info.inferred.type);
      if (t && TYPE_ICONS[t]) return t;
    } catch (err) {
      /* fall through */
    }
    return 'text';
  }
}

