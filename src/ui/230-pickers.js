/* ------------------------------------------------------------------ */
/* Cover images for Bases cards                                        */
/*                                                                     */
/* A card reads its cover from a property holding a wikilink, an       */
/* external URL or a hex colour. A bare filename renders nothing,      */
/* which is the usual reason a card comes up blank — so the link is    */
/* built here rather than typed.                                       */
/* ------------------------------------------------------------------ */

import { FuzzySuggestModal, Modal, setIcon, Setting, TFolder } from 'obsidian';
import { IMAGE_EXTENSIONS } from '../core/020-constants.js';
import { blankLook, composing, COVER_SWATCHES, fallbackTint, fillArt, paintTint } from '../core/030-helpers-art.js';
import { normalHex } from '../core/031-colours.js';
import { COVER_DESIGNS, coverDesignById, drawnArt, namedCoverDesign } from '../core/032-drawn-covers.js';
import { iconForFile, roveFocus } from '../core/040-helpers-sorting.js';

export class ImagePicker extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChooseFile = onChoose;
    this.setPlaceholder('Select an image for the card cover');
  }

  getItems() {
    return this.app.vault
      .getFiles()
      .filter((f) => IMAGE_EXTENSIONS.indexOf(f.extension.toLowerCase()) !== -1);
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file) {
    this.onChooseFile(file);
  }
}

/**
 * Asks for a name. Obsidian has no public prompt, so this is a small
 * modal of its own: Enter creates, Escape cancels.
 */
export class NamePrompt extends Modal {
  constructor(app, title, placeholder, onSubmit, opts = {}) {
    super(app);
    this.titleText = title;
    this.placeholder = placeholder;
    this.onSubmit = onSubmit;
    this.opts = opts;
  }

  onOpen() {
    this.titleEl.setText(this.titleText);
    const input = this.contentEl.createEl('input', { type: 'text' });
    input.addClass('dr-name-input');
    input.placeholder = this.placeholder;
    if (this.opts.value !== undefined) input.value = String(this.opts.value);
    if (this.opts.numeric) input.setAttribute('inputmode', 'numeric');

    const submit = () => {
      const value = input.value.trim();
      this.close();
      if (value || this.opts.allowEmpty) this.onSubmit(value);
    };
    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt)) return;
      evt.preventDefault();
      submit();
    });

    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons
      .createEl('button', { cls: 'mod-cta', text: this.opts.button || 'Create' })
      .addEventListener('click', submit);
    buttons
      .createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.close());

    window.setTimeout(() => input.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** A question to say yes to: a title, a line saying what will happen, and a button for it — a warning one if `warning`. */
export class ConfirmModal extends Modal {
  constructor(app, title, text, button, onYes, opts = {}) {
    super(app);
    this.titleText = title;
    this.text = text;
    this.button = button;
    this.onYes = onYes;
    this.opts = opts;
  }

  onOpen() {
    this.titleEl.setText(this.titleText);
    if (this.text) this.contentEl.createEl('p', { text: this.text });
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const yes = buttons.createEl('button', { cls: this.opts.warning ? 'mod-warning' : 'mod-cta', text: this.button });
    yes.addEventListener('click', () => {
      this.close();
      this.onYes();
    });
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    window.setTimeout(() => yes.focus(), 0);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/**
 * A colour for a generated cover: a swatch, the theme's accent, one of
 * your own, or back to automatic — and, where covers are drawn, which
 * design is drawn. The preview is the cover as it will look, so the
 * choice is made by eye rather than by name.
 */
export class CoverColorModal extends Modal {
  constructor(plugin, target, name) {
    super(plugin.app);
    this.plugin = plugin;
    this.target = target;
    this.name = name;
    // Null is automatic: whatever the settings would give it.
    this.value = plugin.orders.coverColor(target);
    // Null, too: the design its name gives it.
    this.design = plugin.orders.coverDesign(target);
  }

  get drawn() {
    return this.plugin.settings.coverFallback === 'art';
  }

  /** How it's drawn without an image: a cover drawn in the design picked, or as the settings say. */
  look() {
    if (this.drawn) return this.design ? { art: this.name, design: this.design } : { art: this.name };
    return blankLook(this.plugin.settings, this.name);
  }

  /** What it has without a colour of its own: 'icon', or a tint. */
  automatic() {
    return fallbackTint(this.plugin.settings);
  }

  get glyph() {
    return this.target instanceof TFolder ? 'folder' : iconForFile(this.target);
  }

  /** The cover as it'll look: a colour, or the plain icon. */
  paintPreview(tint) {
    this.preview.empty();
    this.preview.className = 'dr-color-preview';
    this.preview.removeAttribute('style');
    fillArt(
      this.preview,
      null,
      this.glyph,
      tint === 'icon' ? null : { name: this.name, tint: tint },
      tint === 'icon' || this.drawn ? this.look() : null
    );
    if (this.designs) this.paintDesigns(tint);
  }

  /** Every design, drawn small in the colour chosen, to pick from. */
  designGrid(contentEl) {
    contentEl.createDiv({ cls: 'dr-color-section', text: 'Design' });
    const grid = contentEl.createDiv({ cls: 'dr-design-grid' });
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Cover design');
    roveFocus(grid, '.dr-design-swatch');
    this.designs = [null].concat(COVER_DESIGNS.map((d) => d.id)).map((id) => {
      const design = id ? coverDesignById(id) : namedCoverDesign(this.name);
      const label = id ? design.name : `Automatic · ${design.name}`;
      const el = grid.createEl('button', { cls: 'dr-design-swatch' });
      el.setAttribute('role', 'radio');
      el.setAttribute('aria-label', label);
      el.setAttribute('title', label);
      el.addEventListener('click', () => this.pickDesign(id));
      el.addEventListener('dblclick', () => {
        this.pickDesign(id);
        this.save();
      });
      return { id, el };
    });
  }

  paintDesigns(tint) {
    this.designs.forEach(({ id, el }) => {
      el.empty();
      el.removeAttribute('style');
      el.className = 'dr-design-swatch';
      const art = el.createSpan({ cls: 'dr-design-art' });
      drawnArt(art, id ? { art: this.name, design: id } : { art: this.name }, tint);
      if (!id) setIcon(el.createSpan({ cls: 'dr-color-mark' }), 'sparkles');
      const on = id === this.design;
      el.setAttribute('aria-checked', String(on));
      el.toggleClass('is-selected', on);
    });
  }

  pickDesign(id) {
    this.design = id || null;
    this.paintPreview(this.value || this.automatic());
  }

  onOpen() {
    this.modalEl.addClass('dr-color-modal');
    this.titleEl.setText(this.drawn ? 'Cover' : 'Cover colour');
    const { contentEl } = this;

    const head = contentEl.createDiv({ cls: 'dr-color-head' });
    this.preview = head.createDiv({ cls: 'dr-color-preview' });
    const text = head.createDiv({ cls: 'dr-color-text' });
    text.createDiv({ cls: 'dr-color-name', text: this.name });
    this.label = text.createDiv({ cls: 'dr-color-label' });
    text.createDiv({
      cls: 'dr-color-hint',
      text: 'Shown while there is no cover image.',
    });

    if (this.drawn) {
      this.designGrid(contentEl);
      contentEl.createDiv({ cls: 'dr-color-section', text: 'Colour' });
    }
    const grid = contentEl.createDiv({ cls: 'dr-color-swatches' });
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Cover colour');
    roveFocus(grid, '.dr-color-swatch');
    this.swatches = [];

    const auto = this.automatic();
    this.swatch(grid, null, this.drawn ? 'Its own colours' : 'Automatic', auto, auto === 'icon' && !this.drawn ? this.glyph : 'sparkles');
    this.swatch(grid, 'accent', 'Accent colour', 'accent');
    COVER_SWATCHES.forEach(([label, hex]) => this.swatch(grid, hex, label, hex));
    this.customSwatch(grid);

    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    const save = buttons.createEl('button', { cls: 'mod-cta', text: 'Save' });
    save.addEventListener('click', () => this.save());
    buttons
      .createEl('button', { text: 'Cancel' })
      .addEventListener('click', () => this.close());

    this.select(this.value);
    window.setTimeout(() => {
      const on = this.swatches.find((s) => s.el.getAttribute('aria-checked') === 'true');
      (on ? on.el : save).focus();
    }, 0);
  }

  swatch(grid, value, label, paint, icon) {
    const el = grid.createEl('button', { cls: 'dr-color-swatch' });
    el.setAttribute('role', 'radio');
    el.setAttribute('aria-label', label);
    el.setAttribute('title', label);
    // The plain icon, where that's what automatic means.
    const dot = el.createSpan({ cls: paint === 'icon' ? 'dr-color-dot is-icon' : 'dr-color-dot is-generated' });
    if (paint === 'icon' && value === null && this.drawn) {
      // Its own colours: the cover as its name draws it.
      dot.className = 'dr-color-dot';
      drawnArt(dot, { art: this.name });
    } else if (paint !== 'icon') paintTint(dot, paint, this.name);
    if (icon) setIcon(dot.createSpan({ cls: 'dr-color-mark' }), icon);
    // Read when clicked: the custom swatch's colour changes as it's picked.
    const entry = { el, value, label, onPick: null };
    el.addEventListener('click', () => (entry.onPick ? entry.onPick() : this.select(entry.value)));
    // Two clicks on the same colour is the choice made.
    el.addEventListener('dblclick', () => {
      if (entry.onPick) return;
      this.select(entry.value);
      this.save();
    });
    this.swatches.push(entry);
    return el;
  }

  /**
   * Any colour at all, through the system's own picker. The input is
   * hidden at the swatches' corner, so the picker opens near them.
   */
  customSwatch(grid) {
    const own = this.value && this.value !== 'accent' && !COVER_SWATCHES.some(([, hex]) => hex === this.value)
      ? this.value
      : null;
    const el = this.swatch(grid, own, 'Custom colour', own, own ? null : 'plus');
    el.addClass('is-custom');
    const entry = this.swatches[this.swatches.length - 1];
    // Beside the swatch rather than in it: a field can't sit in a button.
    const input = grid.createEl('input', { cls: 'dr-color-input', type: 'color' });
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.value = own || normalHex(this.value) || '#fa2d48';

    const take = () => {
      const hex = normalHex(input.value);
      if (!hex) return;
      entry.value = hex;
      const dot = el.querySelector('.dr-color-dot');
      paintTint(dot, hex, this.name);
      const mark = dot.querySelector('.dr-color-mark');
      if (mark) mark.remove();
      this.select(hex);
    };
    input.addEventListener('input', take);
    input.addEventListener('change', take);

    // Holding a colour that isn't the one chosen, a press chooses it;
    // otherwise — nothing picked yet, or pressed again — the picker opens.
    entry.onPick = () => {
      if (entry.value && this.value !== entry.value) {
        this.select(entry.value);
        return;
      }
      try {
        if (typeof input.showPicker === 'function') input.showPicker();
        else input.click();
      } catch (err) {
        input.click();
      }
    };
    this.custom = { el, input, entry };
  }

  select(value) {
    this.value = value || null;
    const on = this.swatches.find((s) => s.value === this.value) || this.swatches[0];
    this.swatches.forEach((s) => {
      s.el.setAttribute('aria-checked', String(s === on));
      s.el.toggleClass('is-selected', s === on);
    });
    this.paintPreview(this.value || this.automatic());
    this.label.setText(on.value === null ? `Automatic${this.automaticNote()}` : on.label === 'Custom colour' ? this.value : on.label);
  }

  automaticNote() {
    const style = this.plugin.settings.coverFallback || 'icon';
    if (style === 'art') return ' · its own colours';
    if (style === 'accent') return ' · the accent colour';
    if (style === 'custom') return ' · the colour in settings';
    if (style === 'name') return ' · picked from the name';
    if (style === 'soft') return ' · the icon on a soft colour';
    if (style === 'title') return ' · its name, set as a title';
    return ' · the icon';
  }

  async save() {
    const value = this.value;
    const design = this.design;
    this.close();
    if (this.drawn) await this.plugin.orders.setCover(this.target, design, value);
    else await this.plugin.orders.setCoverColor(this.target, value);
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class FolderPicker extends FuzzySuggestModal {
  constructor(app, onChoose, opts = {}) {
    super(app);
    this.onChooseFolder = onChoose;
    this.opts = opts;
    this.setPlaceholder(opts.placeholder || 'Which folder?');
  }

  getItems() {
    const out = [];
    // The vault itself, where a folder is being moved: the top level is somewhere to go.
    if (this.opts.withRoot) out.push(this.app.vault.getRoot());
    const walk = (folder) =>
      (folder.children || []).forEach((child) => {
        if (!(child instanceof TFolder)) return;
        if (this.opts.skip && this.opts.skip(child)) return;
        out.push(child);
        walk(child);
      });
    walk(this.app.vault.getRoot());
    return out;
  }

  getItemText(folder) {
    return folder.isRoot && folder.isRoot() ? `${this.app.vault.getName()} (top level)` : folder.path;
  }

  onChooseItem(folder) {
    this.onChooseFolder(folder);
  }
}

/**
 * A choice from a list, with a count or note beside each: the tag, the
 * property, its value, the date range.
 */
export class ChoicePicker extends FuzzySuggestModal {
  constructor(app, placeholder, items, onChoose) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.setPlaceholder(placeholder);
  }

  getItems() {
    return this.items;
  }

  getItemText(item) {
    return item.label;
  }

  renderSuggestion(match, el) {
    super.renderSuggestion(match, el);
    if (match && match.item && match.item.note) {
      el.createSpan({ cls: 'dr-choice-note', text: match.item.note });
    }
  }

  onChooseItem(item) {
    this.onChoose(item);
  }
}

/** One of a list, picked by typing: items are { label, note? }; the note is shown under each. */
export class ComparePicker extends FuzzySuggestModal {
  constructor(app, items, placeholder, onChoose) {
    super(app);
    this.items = items;
    this.onChoose = onChoose;
    this.setPlaceholder(placeholder);
  }

  getItems() {
    return this.items;
  }

  getItemText(item) {
    return `${item.label} ${item.note || ''}`;
  }

  renderSuggestion(match, el) {
    el.createDiv({ text: match.item.label });
    if (match.item.note) el.createDiv({ cls: 'dr-find-where', text: match.item.note });
  }

  onChooseItem(item) {
    this.onChoose(item);
  }
}

/** Ask before a change to many notes: resolves true to go ahead. */
export function confirmAction(app, opts) {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    let answered = false;
    const answer = (yes) => {
      if (answered) return;
      answered = true;
      resolve(yes);
      modal.close();
    };
    modal.onOpen = () => {
      modal.titleEl.setText(opts.title);
      modal.contentEl.createEl('p', { text: opts.text });
      const buttons = modal.contentEl.createDiv({ cls: 'modal-button-container' });
      buttons.createEl('button', { cls: 'mod-cta', text: opts.button || 'Go ahead' }).addEventListener('click', () => answer(true));
      buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => answer(false));
    };
    modal.onClose = () => {
      modal.contentEl.empty();
      if (!answered) {
        answered = true;
        resolve(false);
      }
    };
    modal.open();
  });
}

/** Asked when a note's card or node is re-linked on a collection's map: set its note's parent? */
export class SetParentPrompt extends Modal {
  constructor(app, child, parent, choose) {
    super(app);
    this.child = child;
    this.parent = parent;
    this.choose = choose;
    this.chosen = false;
  }

  onOpen() {
    const { contentEl } = this;
    if (this.titleEl) this.titleEl.setText('Set the note’s parent?');
    contentEl.createEl('p', { text: this.parent ? `Set the parent of “${this.child.basename}” to “${this.parent.basename}”?` : `Take the parent off “${this.child.basename}”, so it hangs from the collection?` });
    const pick = (choice) => {
      this.chosen = true;
      this.close();
      this.choose(choice);
    };
    new Setting(contentEl)
      .addButton((b) => b.setButtonText('Set').setCta().onClick(() => pick('set')))
      .addButton((b) => b.setButtonText('Just on the map').onClick(() => pick('map')))
      .addButton((b) => b.setButtonText('Always set').onClick(() => pick('always')));
  }

  onClose() {
    this.contentEl.empty();
    if (!this.chosen) this.choose('map');
  }
}
