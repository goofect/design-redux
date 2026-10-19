/* ------------------------------------------------------------------ */
/* A value's colour and icon, where it shows                           */
/*                                                                    */
/* A property's value painted as its options say — a tint of its      */
/* colour, its icon before it — in the panel, on the note page, in     */
/* album rows, filters and the property's page; and the dialog that    */
/* sets them, from a value's menu.                                     */
/* ------------------------------------------------------------------ */

import { Modal, setIcon } from 'obsidian';
import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { dateDueState, dueKeys } from '../core/045-helpers-properties.js';
import { OPTION_COLOURS, optionFor, withOption } from '../core/088-property-options.js';

/* A Lucide icon's name, as opposed to an emoji. */
const ICON_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function valueOptionsOn(plugin) {
  return !!plugin && plugin.settings.propertyValueChips !== false;
}

/** An icon into an element: Lucide's by name, else the text itself (an emoji). */
export function putIcon(el, icon) {
  const name = String(icon || '').trim();
  if (ICON_NAME.test(name) && typeof setIcon === 'function') setIcon(el, name);
  else el.setText(name);
}

/** An element showing a value painted as its options say; the option, or null. Painting again first takes off what was there. */
export function paintValue(el, plugin, key, value) {
  if (!el) return null;
  el.removeClass('dr-value-painted');
  delete el.dataset.drColor;
  el.querySelectorAll(':scope > .dr-value-icon').forEach((i) => i.remove());
  if (!valueOptionsOn(plugin) || Array.isArray(value)) return null;
  const option = optionFor(plugin.settings.propertyOptions, key, value);
  if (!option) return null;
  el.addClass('dr-value-painted');
  if (option.color) el.dataset.drColor = option.color;
  if (option.icon) {
    const icon = el.ownerDocument.createElement('span');
    icon.className = 'dr-value-icon';
    icon.setAttribute('aria-hidden', 'true');
    el.prepend(icon);
    putIcon(icon, option.icon);
  }
  return option;
}

const DUE_SAID = { overdue: 'Overdue', today: 'Due today', soon: 'Due soon', later: 'Due later' };

/** A due date marked where it shows: overdue, today or soon, for the properties named as due dates. Its state, or null. */
export function markDue(el, plugin, key, value) {
  if (!el) return null;
  el.removeClass('dr-due', 'is-overdue', 'is-today', 'is-soon', 'is-later');
  if (!plugin || plugin.settings.propertyDueChips === false || !dueKeys(plugin.settings).some((k) => k.toLowerCase() === String(key).toLowerCase())) return null;
  const state = dateDueState(Array.isArray(value) ? value[0] : value);
  if (!state) return null;
  el.addClass('dr-due', `is-${state}`);
  el.setAttribute('title', DUE_SAID[state]);
  return state;
}

const COLOUR_NAMES = { red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', cyan: 'Cyan', blue: 'Blue', purple: 'Purple', pink: 'Pink' };

/** A value's colour and icon, set: a swatch for each colour, an icon by name or emoji, and Clear. */
export class ValueOptionModal extends Modal {
  constructor(plugin, key, value, then) {
    super(plugin.app);
    this.plugin = plugin;
    this.key = key;
    this.value = String(value);
    this.then = then;
    const now = optionFor(plugin.settings.propertyOptions, key, value) || {};
    this.color = now.color || '';
    this.icon = now.icon || '';
  }

  onOpen() {
    this.modalEl.addClass('dr-value-option-modal');
    this.titleEl.setText(`How “${this.value}” shows`);
    const sample = this.contentEl.createDiv({ cls: 'dr-value-option-sample' });
    const swatches = this.contentEl.createDiv({ cls: 'dr-value-swatches' });
    const draw = () => {
      sample.empty();
      const chip = sample.createSpan({ cls: 'dr-value-painted', text: this.value });
      if (this.color) chip.dataset.drColor = this.color;
      if (this.icon) putIcon(chip.createSpan({ cls: 'dr-value-icon' }), this.icon);
      const icon = chip.querySelector('.dr-value-icon');
      if (icon) chip.prepend(icon);
      swatches.querySelectorAll('.dr-value-swatch').forEach((s) => s.toggleClass('is-active', s.dataset.drColor === this.color || (!this.color && s.dataset.drColor === undefined)));
    };
    const none = swatches.createSpan({ cls: 'dr-value-swatch is-none' });
    asButton(none, 'No colour');
    onActivate(none, () => {
      this.color = '';
      draw();
    });
    OPTION_COLOURS.forEach((c) => {
      const s = swatches.createSpan({ cls: 'dr-value-swatch' });
      s.dataset.drColor = c;
      asButton(s, COLOUR_NAMES[c]);
      onActivate(s, () => {
        this.color = c;
        draw();
      });
    });
    const input = this.contentEl.createEl('input', { type: 'text', cls: 'dr-value-option-icon', attr: { placeholder: 'An icon: an emoji, or a name as Lucide has it — check, flag, star' } });
    input.value = this.icon;
    input.addEventListener('input', () => {
      this.icon = input.value.trim();
      draw();
    });
    draw();
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { cls: 'mod-cta', text: 'Save' }).addEventListener('click', () => this.save({ color: this.color, icon: this.icon }));
    buttons.createEl('button', { text: 'Clear' }).addEventListener('click', () => this.save(null));
  }

  async save(option) {
    const settings = this.plugin.settings;
    settings.propertyOptions = withOption(settings.propertyOptions, this.key, this.value, option);
    await this.plugin.saveData(settings);
    this.close();
    if (typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
    if (this.then) this.then();
  }

  onClose() {
    this.contentEl.empty();
  }
}
