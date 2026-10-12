/* ------------------------------------------------------------------ */
/* Bulk: types changed, missing values filled                         */
/*                                                                    */
/* A property's type across the vault; the notes lacking one.         */
/* ------------------------------------------------------------------ */

/**
 * Change what type a property is, and convert its values to match —
 * text to a list, a list to text, text to a number or a date — naming
 * any note whose value can't be converted, which is left as it is.
 */
class ChangeTypeModal extends BulkModal {
  constructor(plugin, key) {
    super(plugin);
    this.key = key || '';
    this.type = null;
    this.idleLabel = 'Change';
  }

  onOpen() {
    this.frame('Change a property’s type');
    const section = this.section();
    const key = this.field(section, 'Property', 'The property to change');
    this.keyInput = key.input;
    this.keyHint = key.hint;
    this.keyInput.value = this.key;
    this.suggest(key.box, key.input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app),
      onSelect: (v) => {
        this.keyInput.value = v;
        this.type = null;
        this.update();
      },
    });
    const typeRow = section.createDiv({ cls: 'dr-bulk-field' });
    typeRow.createEl('label', { cls: 'dr-bulk-label', text: 'New type' });
    this.typeSelect = typeRow.createEl('select', { cls: 'dropdown' });
    Object.keys(TYPE_LABELS).forEach((t) => {
      const option = this.typeSelect.createEl('option', { text: TYPE_LABELS[t] });
      option.value = t;
    });
    this.typeSelect.addEventListener('change', () => {
      this.type = this.typeSelect.value;
      this.update();
    });
    this.update();
    window.setTimeout(() => (this.key ? this.typeSelect.focus() : this.keyInput.focus()), 0);
  }

  update() {
    const typed = this.keyInput.value.trim();
    const key = typed ? knownPropertyNames(this.app).find((n) => n.toLowerCase() === typed.toLowerCase()) || typed : '';
    const current = key ? propertyType(this.app, key) : null;
    const holders = key ? this.bulk.notesWithProperty(key).length : 0;
    this.keyHint.setText(key ? `${TYPE_LABELS[current] || 'Text'} · in ${bulkCount(holders, 'note')}` : '');
    if (!this.type && current) {
      this.type = current;
      this.typeSelect.value = current;
    }
    const lines = [];
    if (!key) {
      lines.push({ icon: 'info', cls: 'is-muted', text: 'Choose the property.' });
      return this.showSummary(lines, null);
    }
    if (!holders) {
      lines.push({ icon: 'info', cls: 'is-muted', text: `No note has a property called “${key}”.` });
      return this.showSummary(lines, null);
    }
    const type = this.type || current;
    const plan = this.bulk.planTypeChange(key, type);
    if (type === current && !plan.convert.length) {
      lines.push({ icon: 'check', cls: 'is-muted', text: `It’s ${TYPE_LABELS[type].toLowerCase()} already, and every value fits.` });
      return this.showSummary(lines, null);
    }
    lines.push({ icon: TYPE_ICONS[type] || 'text', text: `Makes “${key}” ${TYPE_LABELS[type].toLowerCase()} everywhere.` });
    if (plan.convert.length) lines.push({ icon: 'pencil', text: `Converts the value in ${bulkCount(plan.convert.length, 'note')}.` });
    if (plan.stuck.length) {
      lines.push({
        icon: 'alert-triangle',
        cls: 'is-warning',
        text: `${bulkCount(plan.stuck.length, 'note')} ${plan.stuck.length === 1 ? 'has a value' : 'have values'} that can’t be ${TYPE_LABELS[type].toLowerCase()}, so ${plan.stuck.length === 1 ? 'it’s' : 'they’re'} left as ${plan.stuck.length === 1 ? 'it is' : 'they are'}:`,
        notes: plan.stuck,
      });
    }
    this.showSummary(lines, {
      label: plan.convert.length ? `Change and convert ${bulkCount(plan.convert.length, 'note')}` : 'Change type',
      run: async () => {
        const record = await this.bulk.changeType(key, type);
        if (!record) return;
        const stuck = record.stuck && record.stuck.length ? ` ${bulkCount(record.stuck.length, 'note')} left as ${record.stuck.length === 1 ? 'it was' : 'they were'}: ${nameList(record.stuck.map((f) => f.basename), false)}.` : '';
        bulkNotice(this.bulk, `“${key}” is ${TYPE_LABELS[type].toLowerCase()} now; converted ${bulkCount(notesChanged(record), 'note')}.` + stuck + bulkTail(record), record);
      },
    });
  }
}

/**
 * The notes in some folders that are missing a property, each with a
 * field to fill it in — or one value for all of them at once.
 */
class MissingPropertyModal extends BulkModal {
  constructor(plugin, targets, key) {
    super(plugin);
    (targets || []).forEach((t) => this.addTarget(t));
    this.key = key || '';
    this.idleLabel = 'Fill';
    this.drawnFor = null;
  }

  onOpen() {
    this.frame('Find missing properties');
    this.targetsSection('Look in');
    const section = this.section();
    const key = this.field(section, 'Property', 'The property they should have');
    this.keyInput = key.input;
    this.keyInput.value = this.key;
    this.suggest(key.box, key.input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app),
      onSelect: (v) => {
        this.keyInput.value = v;
        this.update();
      },
    });
    this.listSection = this.section('Missing it');
    this.listEl = this.listSection.createDiv({ cls: 'dr-bulk-missing' });
    const all = this.section('Fill every one with');
    this.allInput = all.createDiv({ cls: 'dr-bulk-input' }).createEl('input', { type: 'text' });
    this.allInput.placeholder = 'A value for all of them';
    this.allInput.addEventListener('input', () => this.queueUpdate());
    this.allInput.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt)) return;
      evt.preventDefault();
      window.clearTimeout(this.updateTimer);
      this.update();
      if (this.action) this.go();
    });
    this.update();
    window.setTimeout(() => (this.key ? this.allInput.focus() : this.keyInput.focus()), 0);
  }

  resolvedKey() {
    const typed = this.keyInput.value.trim();
    if (!typed) return '';
    return knownPropertyNames(this.app).find((n) => n.toLowerCase() === typed.toLowerCase()) || typed;
  }

  /** One row per note: its name, and a field that fills it in on Enter. */
  renderMissing(key, missing, type) {
    const sig = key + '\u0000' + missing.map((f) => f.path).join('|');
    if (this.drawnFor === sig) return;
    this.drawnFor = sig;
    this.listEl.empty();
    this.listSection.toggleClass('is-hidden', !key || !missing.length);
    const shown = missing.slice(0, 60);
    shown.forEach((file) => {
      const row = this.listEl.createDiv({ cls: 'dr-bulk-missing-row' });
      const name = row.createSpan({ cls: 'dr-bulk-note', text: file.basename });
      name.setAttribute('role', 'link');
      name.setAttribute('tabindex', '0');
      onActivate(name, () => {
        this.close();
        this.app.workspace.getLeaf(false).openFile(file);
      });
      const input = row.createEl('input', { type: type === 'date' ? 'date' : 'text' });
      input.placeholder = LIST_TYPES.indexOf(type) !== -1 ? 'Items, separated by commas' : 'Value';
      input.setAttribute('aria-label', `${key} for ${file.basename}`);
      input.addEventListener('keydown', async (evt) => {
        if (evt.key !== 'Enter' || composing(evt)) return;
        evt.preventDefault();
        evt.stopPropagation();
        const value = parseTypedValue(type, input.value);
        if (isBlank(value)) return;
        input.disabled = true;
        const record = await this.bulk.fill([file], key, value, type);
        row.addClass('is-done');
        if (record) row.setAttribute('aria-label', `${file.basename}: filled`);
        const next = row.nextElementSibling && row.nextElementSibling.querySelector('input');
        if (next) next.focus();
      });
    });
    if (missing.length > shown.length) {
      this.listEl.createDiv({ cls: 'dr-bulk-hint', text: `and ${missing.length - shown.length} more` });
    }
  }

  update() {
    const key = this.resolvedKey();
    const files = this.notes();
    const missing = key ? this.bulk.missing(files, key) : [];
    const type = key ? propertyType(this.app, key) : 'text';
    if (this.listEl) this.renderMissing(key, missing, type);
    const lines = [];
    if (!this.targets.length) lines.push({ icon: 'info', cls: 'is-muted', text: 'Choose the folders to look in.' });
    else if (!key) lines.push({ icon: 'info', cls: 'is-muted', text: 'Choose the property to look for.' });
    else if (!missing.length) lines.push({ icon: 'check', text: `Every one of the ${bulkCount(files.length, 'note')} has “${key}”.` });
    if (lines.length) return this.showSummary(lines, null);
    lines.push({
      icon: 'search',
      text: `${bulkCount(missing.length, 'note')} of ${files.length} ${missing.length === 1 ? 'is' : 'are'} missing “${key}”. Fill one in and press Enter, or give them all one value below.`,
    });
    const value = parseTypedValue(type, this.allInput ? this.allInput.value : '');
    this.showSummary(lines, isBlank(value)
      ? null
      : {
          label: `Fill ${bulkCount(missing.length, 'note')}`,
          run: async () => {
            const record = await this.bulk.fill(missing, key, value, type);
            if (!record) return;
            bulkNotice(this.bulk, `Filled “${key}” in ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
          },
        });
  }
}
