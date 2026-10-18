/* ------------------------------------------------------------------ */
/* Canvas: the map toolbar                                             */
/*                                                                     */
/* One group of buttons in the bar above the selected cards, beside    */
/* Obsidian's own, for what you do to a map: add a card after or       */
/* beside, fold, lay out, make a master card, focus. Which buttons, in  */
/* what order, is a setting; each shows only when its action fits the  */
/* selection. The same actions are in the cards' menu, as before.      */
/* ------------------------------------------------------------------ */

import { setIcon, Setting } from 'obsidian';
import { canvasContext } from '../core/078-actions.js';
import { pickedOnCanvas } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';

/* The actions the toolbar can carry, and whether each is on to begin with, in their first order. */
export const MAP_TOOLS = [
  { id: 'canvas-add-child-card', on: true },
  { id: 'canvas-add-sibling-card', on: true },
  { id: 'fold-canvas-branch', on: true },
  { id: 'canvas-layout-choose', on: true },
  { id: 'toggle-canvas-master-card', on: true },
  { id: 'focus-canvas-branch', on: true },
  { id: 'canvas-add-parent-card', on: false },
  { id: 'select-canvas-branch', on: false },
  { id: 'tidy-canvas-branch', on: false },
  { id: 'duplicate-canvas-branch', on: false },
  { id: 'canvas-zoom-to-branch', on: false },
  { id: 'canvas-toggle-keep-in-place', on: false },
  { id: 'present-map', on: true },
];

/** The toolbar's buttons as set — in the order chosen, each on or off — with any the setting doesn't name yet after them. */
export function mapTools(settings) {
  const saved = Array.isArray(settings.canvasToolbarItems) ? settings.canvasToolbarItems : [];
  const known = new Set(MAP_TOOLS.map((t) => t.id));
  const out = saved.filter((t) => t && known.has(t.id)).map((t) => ({ id: t.id, on: !!t.on }));
  MAP_TOOLS.forEach((t) => {
    if (!out.some((o) => o.id === t.id)) out.push({ id: t.id, on: t.on });
  });
  return out;
}

export class CanvasMapToolbar extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasMapToolbar',
        name: 'Map toolbar',
        desc: 'Buttons for what you do to a map — add a card after or beside, fold, lay out, master card, focus — in the bar above the selected cards.',
      },
      {
        key: 'canvasToolbarItems',
        type: 'custom',
        name: 'Map toolbar buttons',
        showIf: 'canvasMapToolbar',
        render: (containerEl) => this.renderChoice(containerEl),
      },
    ];
  }

  /** Whether the toolbar is showing an action's button, so its own feature needn't. */
  static shows(plugin, id) {
    const bar = plugin && typeof plugin.feature === 'function' ? plugin.feature(CanvasMapToolbar) : null;
    return !!bar && bar.enabled && mapTools(bar.settings).some((t) => t.on && t.id === id);
  }

  /** Every action the features offer, by id. */
  actionsById() {
    const byId = new Map();
    (this.plugin.features || []).forEach((f) => {
      if (f === this || !f.enabled) return;
      let list = [];
      try {
        list = f.actions();
      } catch (err) {
        list = [];
      }
      list.forEach((a) => byId.set(a.id, a));
    });
    return byId;
  }

  /** The buttons that fit the selection now: [{ id, title, icon, run }]. */
  buttons(view) {
    const ctx = canvasContext(view, pickedOnCanvas(view.canvas), 'canvas');
    if (!ctx.nodes.length) return [];
    const byId = this.actionsById();
    const out = [];
    mapTools(this.settings).forEach((t) => {
      const action = t.on ? byId.get(t.id) : null;
      if (!action) return;
      let fits = false;
      try {
        fits = !action.when || !!action.when(ctx);
      } catch (err) {
        fits = false;
      }
      if (!fits) return;
      const label = typeof action.menu === 'function' ? action.menu(ctx) : typeof action.menu === 'string' ? action.menu : action.name;
      const icon = typeof action.menuIcon === 'function' ? action.menuIcon(ctx) : action.icon;
      out.push({ id: t.id, title: label || action.name, icon: icon || 'circle', run: () => action.run(ctx) });
    });
    return out;
  }

  /**
   * The group in the bar above the selection, drawn again only when what
   * it shows changes — drawing it is itself a change the watcher sees.
   */
  pass(view) {
    const bar = view.contentEl.querySelector('.canvas-menu');
    if (!bar) return;
    const buttons = this.buttons(view);
    let group = bar.querySelector(':scope > .dr-map-tools');
    const key = buttons.map((b) => `${b.id}:${b.title}:${b.icon}`).join('|');
    if (!buttons.length) {
      if (group) group.remove();
      return;
    }
    if (group && group.dataset.key === key) return;
    if (!group) group = bar.createDiv({ cls: 'dr-map-tools' });
    group.dataset.key = key;
    group.empty();
    buttons.forEach((b) => {
      const button = group.createEl('button', { cls: 'clickable-icon dr-map-tool' });
      button.dataset.tool = b.id;
      button.setAttribute('aria-label', b.title);
      button.setAttribute('data-tooltip-position', 'top');
      setIcon(button, b.icon);
      button.addEventListener('click', (evt) => {
        evt.stopPropagation();
        b.run();
        this.schedule(view);
      });
    });
  }

  cleanup(view) {
    if (view.contentEl) view.contentEl.querySelectorAll('.dr-map-tools').forEach((el) => el.remove());
  }

  /** Settings: each button on or off, moved up or down. */
  renderChoice(containerEl) {
    const doc = containerEl.ownerDocument;
    const block = containerEl.appendChild(doc.createElement('div'));
    block.className = 'dr-map-tools-choice';
    const names = new Map();
    this.actionsById().forEach((a, id) => names.set(id, { name: typeof a.menu === 'string' ? a.menu : a.name, icon: a.icon }));
    const draw = () => {
      block.empty();
      const list = mapTools(this.settings);
      const save = () => {
        this.settings.canvasToolbarItems = list.map((t) => ({ id: t.id, on: t.on }));
        this.plugin.saveSettings();
      };
      const move = (i, by) => {
        list.splice(i + by, 0, list.splice(i, 1)[0]);
        save();
        draw();
      };
      new Setting(block).setName('Map toolbar buttons').setDesc('Which buttons the map toolbar shows, left to right. Each shows only when it fits what’s selected.').setHeading();
      list.forEach((tool, i) => {
        const known = names.get(tool.id) || { name: tool.id };
        const row = new Setting(block).setName(known.name).setClass('dr-map-tool-row');
        row.addExtraButton((b) => b.setIcon('arrow-up').setTooltip('Move left').setDisabled(i === 0).onClick(() => i > 0 && move(i, -1)));
        row.addExtraButton((b) => b.setIcon('arrow-down').setTooltip('Move right').setDisabled(i === list.length - 1).onClick(() => i < list.length - 1 && move(i, 1)));
        row.addToggle((t) =>
          t.setValue(tool.on).onChange((v) => {
            tool.on = v;
            save();
          })
        );
      });
    };
    draw();
  }
}

CanvasMapToolbar.settingKey = 'canvasMapToolbar';
