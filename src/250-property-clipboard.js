/* ------------------------------------------------------------------ */
/* Property clipboard                                                  */
/*                                                                     */
/* A note's properties copied — all, or the ones chosen — and pasted   */
/* into another note after a look at what it would do: each property  */
/* added, left as it is, joined with what's there, or replacing it,    */
/* as the mode says, any of them unticked; one step of Undo. What's    */
/* copied can be kept as a named set, to apply to any note the same    */
/* way, as a template.                                                 */
/* ------------------------------------------------------------------ */

const PASTE_MODES = {
  add: 'Add the missing ones only',
  merge: 'Add the missing ones and join lists',
  replace: 'Replace what’s there',
};

const PASTE_STATUS = {
  add: 'Add',
  same: 'Unchanged',
  merge: 'Join with what’s there',
  replace: 'Replace',
  keep: 'Keep what’s there',
};

/** Two values as one list, each once: by what they name, ignoring case. */
function joinedValues(a, b) {
  const out = [];
  const seen = new Set();
  valueList(a)
    .concat(valueList(b))
    .forEach((v) => {
      const key = plainValue(v).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(v);
    });
  return out;
}

/**
 * What pasting properties into a note would do, key by key: { key, value,
 * now, status, apply }. Missing ones are added; equal ones left alone;
 * different ones kept (add), joined where either is a list (merge), or
 * replaced (replace).
 */
function propertyPastePlan(current, incoming, mode) {
  return Object.keys(incoming).map((key) => {
    const name = Object.keys(current || {}).find((k) => k.toLowerCase() === key.toLowerCase());
    const now = name === undefined ? undefined : current[name];
    const has = now !== undefined && now !== null && now !== '' && !(Array.isArray(now) && !now.length);
    const value = incoming[key];
    let status;
    if (!has) status = 'add';
    else if (JSON.stringify(now) === JSON.stringify(value)) status = 'same';
    else if (mode === 'replace') status = 'replace';
    else if (mode === 'merge' && (Array.isArray(now) || Array.isArray(value))) status = 'merge';
    else status = 'keep';
    return {
      key: name || key,
      value: status === 'merge' ? joinedValues(now, value) : value,
      now,
      status,
      apply: status === 'add' || status === 'merge' || status === 'replace',
    };
  });
}

/** A value as a short line of text. */
function shortValue(value) {
  if (value === undefined || value === null || value === '') return '—';
  const text = Array.isArray(value) ? value.map((v) => plainValue(v)).join(', ') : typeof value === 'object' ? JSON.stringify(value) : plainValue(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/** A list of things, each ticked or not, and a button that takes the ticked ones. */
class ChecklistModal extends Modal {
  constructor(app, title, items, button, onDone) {
    super(app);
    this.titleText = title;
    this.items = items.map((item) => Object.assign({ checked: true }, item));
    this.button = button;
    this.onDone = onDone;
  }

  onOpen() {
    this.titleEl.setText(this.titleText);
    this.modalEl.addClass('dr-checklist-modal');
    const list = this.contentEl.createDiv({ cls: 'dr-checklist' });
    this.items.forEach((item) => {
      const row = list.createEl('label', { cls: 'dr-checklist-row' });
      const box = row.createEl('input', { type: 'checkbox' });
      box.checked = item.checked;
      box.addEventListener('change', () => (item.checked = box.checked));
      row.createSpan({ cls: 'dr-checklist-name', text: item.label });
      if (item.note) row.createSpan({ cls: 'dr-checklist-note', text: item.note });
    });
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { cls: 'mod-cta', text: this.button }).addEventListener('click', () => {
      const chosen = this.items.filter((item) => item.checked);
      if (!chosen.length) return;
      this.close();
      this.onDone(chosen);
    });
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** What pasting would do, property by property, in the mode chosen — then done, or kept as a set. */
class PropertyPasteModal extends Modal {
  constructor(feature, file, incoming, opts) {
    super(feature.app);
    this.feature = feature;
    this.file = file;
    this.incoming = incoming;
    this.opts = opts;
    this.mode = opts.mode || 'merge';
  }

  onOpen() {
    this.titleEl.setText(this.opts.title || `Paste into ${this.file.basename}`);
    this.modalEl.addClass('dr-paste-modal');
    this.draw();
  }

  draw() {
    const { contentEl } = this;
    contentEl.empty();
    this.plan = propertyPastePlan(this.feature.plugin.notes.props(this.file), this.incoming, this.mode);
    const select = contentEl.createEl('select', { cls: 'dropdown dr-paste-mode' });
    Object.entries(PASTE_MODES).forEach(([value, label]) => {
      const option = select.createEl('option', { text: label });
      option.value = value;
    });
    select.value = this.mode;
    select.setAttribute('aria-label', 'How');
    select.addEventListener('change', () => {
      this.mode = select.value;
      this.draw();
    });
    const list = contentEl.createDiv({ cls: 'dr-paste-list' });
    this.plan.forEach((row) => {
      const line = list.createEl('label', { cls: 'dr-paste-row' });
      line.dataset.status = row.status;
      const box = line.createEl('input', { type: 'checkbox' });
      box.checked = row.apply;
      box.disabled = row.status === 'same';
      box.addEventListener('change', () => {
        // Ticking one that would be kept replaces it; unticking leaves it out.
        if (row.status === 'keep' && box.checked) row.status = 'replace';
        else if (row.status === 'replace' && !box.checked && this.mode !== 'replace') row.status = 'keep';
        row.apply = box.checked;
        line.dataset.status = row.status;
        status.setText(PASTE_STATUS[row.status]);
        this.count();
      });
      const text = line.createDiv({ cls: 'dr-paste-text' });
      text.createDiv({ cls: 'dr-paste-key', text: row.key });
      const change = row.status === 'add' || row.status === 'same' ? shortValue(row.value) : `${shortValue(row.now)} → ${shortValue(row.value)}`;
      text.createDiv({ cls: 'dr-paste-value', text: change });
      const status = line.createSpan({ cls: 'dr-paste-status', text: PASTE_STATUS[row.status] });
    });
    const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
    this.goButton = buttons.createEl('button', { cls: 'mod-cta' });
    this.goButton.addEventListener('click', () => this.apply());
    if (this.opts.keepable !== false) {
      buttons.createEl('button', { text: 'Keep as a set…' }).addEventListener('click', () => this.feature.askSetName(this.chosenValues(true)));
    }
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    this.count();
  }

  count() {
    const n = this.plan.filter((row) => row.apply).length;
    this.goButton.setText(n ? `Paste ${n} ${n === 1 ? 'property' : 'properties'}` : 'Nothing to paste');
    this.goButton.disabled = !n;
  }

  /** The ticked properties as copied — or, for a set, every one not unticked. */
  chosenValues(asCopied) {
    const out = {};
    this.plan.forEach((row) => {
      if (row.apply || (asCopied && row.status !== 'keep')) out[row.key] = asCopied ? this.incoming[Object.keys(this.incoming).find((k) => k.toLowerCase() === row.key.toLowerCase())] : row.value;
    });
    return out;
  }

  async apply() {
    const rows = this.plan.filter((row) => row.apply);
    if (!rows.length) return;
    this.close();
    await this.feature.write(this.file, rows);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class PropertyClipboard extends Feature {
  actions() {
    const sets = () => Object.keys(this.settings.propertySets || {});
    return [
      {
        id: 'sort-properties',
        name: 'Sort properties alphabetically',
        when: () => {
          const editor = this.activeEditor();
          return !!(editor && typeof editor.sortProperties === 'function');
        },
        run: () => this.activeEditor().sortProperties(),
      },
      { id: 'copy-properties', name: 'Copy properties', on: 'note', menu: false, run: (ctx) => this.copy(ctx.file) },
      { id: 'copy-some-properties', name: 'Copy some of this note’s properties…', icon: 'copy-check', on: 'note', menu: false, when: (ctx) => this.keysOf(ctx.file).length > 0, run: (ctx) => this.copy(ctx.file, true) },
      { id: 'paste-properties', name: 'Paste properties', on: 'note', menu: false, run: (ctx) => this.paste(ctx.file) },
      { id: 'property-set-save', name: 'Keep this note’s properties as a set…', icon: 'bookmark-plus', on: 'note', menu: false, when: (ctx) => this.keysOf(ctx.file).length > 0, run: (ctx) => this.saveSet(ctx.file) },
      { id: 'property-set-apply', name: 'Apply a property set…', icon: 'stamp', on: 'note', menu: false, when: () => sets().length > 0, run: (ctx) => this.chooseSet(ctx.file) },
      { id: 'property-set-remove', name: 'Remove a property set…', icon: 'bookmark-minus', menu: false, when: () => sets().length > 0, run: () => this.removeSet() },
    ];
  }

  activeEditor() {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf || leaf.isDeferred || !(leaf.view instanceof MarkdownView)) return null;
    return leaf.view.metadataEditor || null;
  }

  keysOf(file) {
    return file ? Object.keys(this.plugin.notes.props(file)) : [];
  }

  /**
   * Copied as JSON rather than YAML: it round-trips exactly, and the
   * paste side can parse it without a YAML parser. With `choose`, only
   * the properties ticked.
   */
  async copy(file, choose) {
    const all = this.plugin.notes.props(file);
    const count = Object.keys(all).length;
    if (!count) {
      new Notice('This note has no properties.');
      return;
    }
    const write = async (props) => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(props, null, 2));
        const n = Object.keys(props).length;
        new Notice(`Copied ${n} ${n === 1 ? 'property' : 'properties'}.`);
      } catch (err) {
        console.error('Design Redux: clipboard write failed', err);
        new Notice('Could not write to the clipboard.');
      }
    };
    if (!choose) return write(all);
    const items = Object.keys(all).map((key) => ({ label: key, note: shortValue(all[key]), key }));
    new ChecklistModal(this.app, `Copy from ${file.basename}`, items, 'Copy', (chosen) => {
      const out = {};
      chosen.forEach((item) => (out[item.key] = all[item.key]));
      write(out);
    }).open();
  }

  /** What's on the clipboard, shown property by property before it goes in. */
  async paste(file) {
    let parsed;
    try {
      parsed = JSON.parse(await navigator.clipboard.readText());
    } catch (err) {
      new Notice('The clipboard does not contain copied properties.');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length) {
      new Notice('The clipboard does not contain copied properties.');
      return;
    }
    new PropertyPasteModal(this, file, parsed, { mode: 'merge' }).open();
  }

  /** The rows chosen, written into the note — one step of Undo, which keeps what's edited since. */
  async write(file, rows) {
    const n = rows.length;
    const record = await this.plugin.notes.write(
      file,
      (fm) =>
        rows.forEach((row) => {
          const name = Object.keys(fm).find((k) => k.toLowerCase() === row.key.toLowerCase()) || row.key;
          fm[name] = row.value;
        }),
      { undo: `Pasted ${n} ${n === 1 ? 'property' : 'properties'} into ${file.basename}.` }
    );
    return !!record;
  }

  /* -- sets: properties kept by name, to apply as a template ---------- */

  saveSet(file) {
    const all = this.plugin.notes.props(file);
    const items = Object.keys(all).map((key) => ({ label: key, note: shortValue(all[key]), key }));
    new ChecklistModal(this.app, `A set from ${file.basename}`, items, 'Next', (chosen) => {
      const props = {};
      chosen.forEach((item) => (props[item.key] = all[item.key]));
      this.askSetName(props);
    }).open();
  }

  askSetName(props) {
    if (!Object.keys(props).length) return;
    new NamePrompt(this.app, 'Name the set', 'Concept', (name) => this.keepSet(name, props), { button: 'Keep' }).open();
  }

  async keepSet(name, props) {
    name = String(name || '').trim();
    if (!name) return false;
    this.settings.propertySets = Object.assign({}, this.settings.propertySets || {}, { [name]: props });
    await this.plugin.saveData(this.settings);
    new Notice(`Kept the set “${name}”: ${Object.keys(props).length} ${Object.keys(props).length === 1 ? 'property' : 'properties'}.`);
    return true;
  }

  chooseSet(file) {
    const sets = this.settings.propertySets || {};
    const items = Object.keys(sets).map((name) => ({ label: name, note: Object.keys(sets[name]).join(', '), name }));
    new ComparePicker(this.app, items, `Apply a set to ${file.basename}`, (item) =>
      new PropertyPasteModal(this, file, sets[item.name], { mode: 'add', keepable: false, title: `“${item.name}” on ${file.basename}` }).open()
    ).open();
  }

  removeSet() {
    const sets = this.settings.propertySets || {};
    const items = Object.keys(sets).map((name) => ({ label: name, note: Object.keys(sets[name]).join(', '), name }));
    new ComparePicker(this.app, items, 'Remove which set?', async (item) => {
      const next = Object.assign({}, sets);
      delete next[item.name];
      this.settings.propertySets = next;
      await this.plugin.saveData(this.settings);
      this.plugin.offerUndo(`Removed the set “${item.name}”.`, async () => {
        this.settings.propertySets = Object.assign({}, this.settings.propertySets, { [item.name]: sets[item.name] });
        await this.plugin.saveData(this.settings);
      });
    }).open();
  }
}
