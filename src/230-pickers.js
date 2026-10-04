/* ------------------------------------------------------------------ */
/* Cover images for Bases cards                                        */
/*                                                                     */
/* A card reads its cover from a property holding a wikilink, an       */
/* external URL or a hex colour. A bare filename renders nothing,      */
/* which is the usual reason a card comes up blank — so the link is    */
/* built here rather than typed.                                       */
/* ------------------------------------------------------------------ */

class ImagePicker extends FuzzySuggestModal {
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
class NamePrompt extends Modal {
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

/**
 * A colour for a generated cover: a swatch, the theme's accent, one of
 * your own, or back to automatic. The preview is the cover as it will
 * look, so the choice is made by eye rather than by name.
 */
class CoverColorModal extends Modal {
  constructor(plugin, target, name) {
    super(plugin.app);
    this.plugin = plugin;
    this.target = target;
    this.name = name;
    // Null is automatic: whatever the settings would give it.
    this.value = plugin.orders.coverColor(target);
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
      tint === 'icon' ? blankLook(this.plugin.settings, this.name) : null
    );
  }

  onOpen() {
    this.modalEl.addClass('dr-color-modal');
    this.titleEl.setText('Cover colour');
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

    const grid = contentEl.createDiv({ cls: 'dr-color-swatches' });
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Cover colour');
    roveFocus(grid, '.dr-color-swatch');
    this.swatches = [];

    const auto = this.automatic();
    this.swatch(grid, null, 'Automatic', auto, auto === 'icon' ? this.glyph : 'sparkles');
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
    if (paint !== 'icon') paintTint(dot, paint, this.name);
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
    if (style === 'accent') return ' · the accent colour';
    if (style === 'custom') return ' · the colour in settings';
    if (style === 'name') return ' · picked from the name';
    if (style === 'soft') return ' · the icon on a soft colour';
    if (style === 'title') return ' · its name, set as a title';
    return ' · the icon';
  }

  async save() {
    const value = this.value;
    this.close();
    await this.plugin.orders.setCoverColor(this.target, value);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class FolderPicker extends FuzzySuggestModal {
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
class ChoicePicker extends FuzzySuggestModal {
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

