/* ------------------------------------------------------------------ */
/* Bulk: properties added, removed, renamed, merged                   */
/*                                                                    */
/* In folders or chosen notes; a folder's defaults for new notes.     */
/* ------------------------------------------------------------------ */

/**
 * Add properties to every note in some folders — or to the notes
 * chosen — at once. Each property takes its type from the vault if
 * the vault has it already, or one chosen here if it's new.
 */
class AddPropertiesModal extends BulkModal {
  constructor(plugin, targets) {
    super(plugin);
    this.targets = [];
    (targets || []).forEach((t) => this.addTarget(t));
    this.reach = 'deep';
    this.replace = false;
    this.rows = [];
    this.idleLabel = 'Add';
  }

  onOpen() {
    this.frame('Add properties');
    this.targetsSection('Add to');

    const what = this.section('Properties');
    this.rowsEl = what.createDiv({ cls: 'dr-bulk-rows' });
    const add = what.createDiv({ cls: 'dr-bulk-add' });
    add.setAttribute('role', 'button');
    add.setAttribute('tabindex', '0');
    setIcon(add.createSpan({ cls: 'dr-bulk-add-icon' }), 'plus');
    add.createSpan({ text: 'Add another property' });
    onActivate(add, () => {
      this.rows.push(this.newRow());
      this.renderRows();
      const last = this.rowsEl.querySelector('.dr-bulk-row:last-child .dr-bulk-name input');
      if (last) last.focus();
    });
    this.existingEl = what.createDiv({ cls: 'dr-bulk-option' });

    this.rows.push(this.newRow());
    this.renderTargets();
    this.renderRows();
    this.renderExisting();
    this.update();
    window.setTimeout(() => {
      const first = this.rowsEl.querySelector('.dr-bulk-name input');
      if (first) first.focus();
    }, 0);
  }

  newRow() {
    return { key: '', type: 'text', raw: '', locked: false };
  }

  renderExisting() {
    const el = this.existingEl;
    el.empty();
    el.createSpan({ cls: 'dr-bulk-option-label', text: 'Where a note already has one' });
    const select = el.createEl('select', { cls: 'dropdown' });
    [
      ['keep', 'Keep its value — lists get the new items'],
      ['replace', 'Replace its value'],
    ].forEach(([value, label]) => {
      const option = select.createEl('option', { text: label });
      option.value = value;
    });
    select.value = this.replace ? 'replace' : 'keep';
    select.addEventListener('change', () => {
      this.replace = select.value === 'replace';
      this.update();
    });
  }

  renderRows() {
    this.suggests.forEach((el) => el.remove());
    this.suggests = [];
    this.rowsEl.empty();
    this.rows.forEach((row) => this.renderRow(row));
  }

  renderRow(row) {
    const el = this.rowsEl.createDiv({ cls: 'dr-bulk-row' });
    const typeBtn = el.createDiv({ cls: 'dr-bulk-type' });
    const nameBox = el.createDiv({ cls: 'dr-bulk-name' });
    const name = nameBox.createEl('input', { type: 'text' });
    name.placeholder = 'Property';
    name.value = row.key;
    name.setAttribute('aria-label', 'Property name');
    name.setAttribute('autocomplete', 'off');
    const valueBox = el.createDiv({ cls: 'dr-bulk-value' });
    const remove = el.createDiv({ cls: 'dr-bulk-remove clickable-icon' });
    setIcon(remove, 'x');
    remove.setAttribute('aria-label', 'Remove this property');
    remove.setAttribute('role', 'button');
    remove.setAttribute('tabindex', '0');
    onActivate(remove, () => {
      this.rows.splice(this.rows.indexOf(row), 1);
      if (!this.rows.length) this.rows.push(this.newRow());
      this.renderRows();
      this.update();
    });

    const paintType = () => {
      typeBtn.empty();
      setIcon(typeBtn, TYPE_ICONS[row.type] || 'text');
      typeBtn.toggleClass('is-locked', row.locked);
      typeBtn.setAttribute(
        'aria-label',
        row.locked
          ? `${TYPE_LABELS[row.type] || 'Text'}, as it is in the rest of the vault`
          : `${TYPE_LABELS[row.type] || 'Text'} — choose the type`
      );
      typeBtn.setAttribute('role', 'button');
      typeBtn.setAttribute('tabindex', row.locked ? '-1' : '0');
    };
    const setType = (type, locked) => {
      const was = row.type;
      row.type = type;
      row.locked = locked;
      paintType();
      if (was !== type) {
        const focused = valueBox.contains(document.activeElement);
        this.renderValue(row, valueBox);
        if (focused) {
          const field = valueBox.querySelector('input');
          if (field) field.focus();
        }
      }
    };
    // A name the vault already uses brings its type along.
    const settleName = () => {
      row.key = name.value.trim();
      const known = knownPropertyNames(this.app).find(
        (n) => n.toLowerCase() === row.key.toLowerCase()
      );
      if (known) setType(propertyType(this.app, known), true);
      else if (row.locked) setType('text', false);
      this.update();
    };
    onActivate(typeBtn, (evt) => {
      if (row.locked) return;
      const menu = new Menu();
      Object.keys(TYPE_ICONS).forEach((type) =>
        menu.addItem((item) =>
          item
            .setTitle(TYPE_LABELS[type])
            .setIcon(TYPE_ICONS[type])
            .setChecked(type === row.type)
            .onClick(() => {
              setType(type, false);
              this.update();
            })
        )
      );
      showMenuAt(menu, evt);
    });

    name.addEventListener('input', () => {
      row.key = name.value.trim();
      this.queueUpdate();
    });
    name.addEventListener('change', settleName);
    name.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      settleName();
      const field = valueBox.querySelector('input');
      if (field) field.focus();
    });
    this.suggest(nameBox, name, {
      icon: 'tag',
      source: () => {
        const taken = this.rows.filter((r) => r !== row).map((r) => r.key.toLowerCase());
        return knownPropertyNames(this.app).filter((n) => taken.indexOf(n.toLowerCase()) === -1);
      },
      onSelect: (v) => {
        name.value = v;
        settleName();
        const field = valueBox.querySelector('input');
        if (field) field.focus();
      },
    });

    if (row.key) {
      const known = knownPropertyNames(this.app).find((n) => n.toLowerCase() === row.key.toLowerCase());
      if (known) {
        row.type = propertyType(this.app, known);
        row.locked = true;
      }
    }
    paintType();
    this.renderValue(row, valueBox);
  }

  /** The value's field, shaped by the type: a checkbox, a date, a list, a number or text. */
  renderValue(row, box) {
    box.empty();
    const type = row.type;
    if (type === 'checkbox') {
      const label = box.createEl('label', { cls: 'dr-bulk-check' });
      const input = label.createEl('input', { type: 'checkbox' });
      input.checked = row.raw === true;
      row.raw = input.checked;
      label.createSpan({ text: 'Ticked' });
      input.addEventListener('change', () => {
        row.raw = input.checked;
        this.update();
      });
      return;
    }
    const input = box.createEl('input', {
      type: type === 'date' ? 'date' : type === 'datetime' ? 'datetime-local' : 'text',
    });
    input.setAttribute('aria-label', 'Value');
    input.setAttribute('autocomplete', 'off');
    if (typeof row.raw === 'string') input.value = row.raw;
    else row.raw = '';
    input.placeholder =
      LIST_TYPES.indexOf(type) !== -1
        ? 'Items, separated by commas'
        : type === 'number'
          ? 'Number, or leave empty'
          : 'Value, or leave empty';
    if (type === 'number') input.setAttribute('inputmode', 'decimal');
    input.addEventListener('input', () => {
      row.raw = input.value;
      this.queueUpdate();
    });
    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      window.clearTimeout(this.updateTimer);
      this.update();
      if (this.action) this.go();
    });
    if (type === 'date' || type === 'datetime' || type === 'number' || type === 'checkbox') return;

    // The values the property already takes, to pick from; in a list,
    // for the item being typed.
    const isList = LIST_TYPES.indexOf(type) !== -1;
    const last = () => (isList ? input.value.split(',').pop() : input.value);
    this.suggest(box, input, {
      icon: type === 'tags' ? 'hash' : 'text',
      query: last,
      source: () => {
        if (!row.key) return [];
        const typed = isList
          ? input.value.split(',').slice(0, -1).map((s) => s.trim().toLowerCase())
          : [];
        return propertyValues(this.app, row.key).filter((v) => typed.indexOf(v.toLowerCase()) === -1);
      },
      onSelect: (v) => {
        if (isList) {
          const done = input.value.split(',').slice(0, -1).map((s) => s.trim()).filter(Boolean);
          input.value = done.concat(v).join(', ') + ', ';
        } else input.value = v;
        row.raw = input.value;
        input.focus();
        this.update();
      },
    });
  }

  /** What would be added, where, and what's stopping it if anything is. */
  update() {
    const lines = [];
    const named = this.rows.filter((r) => r.key);
    const files = this.notes();
    const seen = new Set();
    let problem = '';
    named.forEach((r) => {
      const k = r.key.toLowerCase();
      if (!problem && seen.has(k)) problem = `“${r.key}” is listed twice.`;
      seen.add(k);
      const why = propertyNameProblem(r.key);
      if (!problem && why) problem = why;
    });

    if (!this.targets.length) problem = problem || 'Choose the folders to add them to.';
    else if (!files.length) {
      problem =
        this.reach === 'folder-notes'
          ? 'None of these folders has a folder note.'
          : this.reach === 'direct'
            ? 'There are no notes directly in these folders.'
            : 'There are no notes in these folders.';
    }
    if (!named.length) problem = problem || 'Name a property to add.';

    if (problem) {
      lines.push({ text: problem, icon: 'info', cls: 'is-muted' });
      this.current = null;
      return this.showSummary(lines, null);
    }

    const props = named.map((r) => ({ key: r.key, value: parseTypedValue(r.type, r.raw), type: r.locked ? null : r.type }));
    const plan = this.bulk.planAdd(files, props, this.replace);
    const n = plan.changing.length;
    const names = nameList(props.map((p) => p.key));
    if (n) {
      lines.push({
        icon: 'plus',
        text: `Adds ${names} to ${n === files.length ? (n === 1 ? 'the note' : `all ${n} notes`) : `${n} of the ${files.length} notes`}.`,
        notes: plan.changing,
      });
    }
    Object.keys(plan.held).forEach((key) => {
      const k = plan.held[key];
      lines.push(
        this.replace
          ? {
              icon: 'alert-triangle',
              cls: 'is-warning',
              text: `Replaces the “${key}” ${k === 1 ? 'value' : 'values'} ${bulkCount(k, 'note')} already ${k === 1 ? 'has' : 'have'}.`,
            }
          : {
              icon: 'info',
              cls: 'is-muted',
              text: `${bulkCount(k, 'note')} already ${k === 1 ? 'has' : 'have'} a “${key}” of ${k === 1 ? 'its' : 'their'} own, and ${k === 1 ? 'keeps' : 'keep'} it.`,
            }
      );
    });
    const unchanged = files.length - n;
    if (unchanged) {
      lines.push({
        icon: 'check',
        cls: 'is-muted',
        text: n
          ? `${bulkCount(unchanged, 'note')} already ${unchanged === 1 ? 'has' : 'have'} ${props.length === 1 ? 'it' : 'them'} as given.`
          : `Every note already has ${props.length === 1 ? 'it' : 'them'} as given.`,
      });
    }
    const folderless =
      this.reach === 'folder-notes'
        ? this.targets.filter((t) => t instanceof TFolder && !this.plugin.folderNote(t))
        : [];
    if (folderless.length) {
      lines.push({
        icon: 'info',
        cls: 'is-muted',
        text: `${nameList(folderless.map((f) => f.name))} ${folderless.length === 1 ? 'has' : 'have'} no folder note, so ${folderless.length === 1 ? "it's" : "they're"} skipped.`,
      });
    }
    this.current = { files, props };
    this.showSummary(
      lines,
      n
        ? {
            label: `Add to ${bulkCount(n, 'note')}`,
            run: async () => {
              const record = await this.bulk.addProperties(files, props, this.replace);
              if (!record) return;
              const done = notesChanged(record);
              bulkNotice(
                this.bulk,
                (done ? `Added ${names} to ${bulkCount(done, 'note')}.` : 'Nothing needed changing.') +
                  bulkTail(record),
                record
              );
            },
          }
        : null
    );
  }
}

/**
 * Properties a folder gives every note made in it — and in its
 * subfolders — from then on. Uses the same rows as Add properties.
 */
class FolderDefaultsModal extends AddPropertiesModal {
  constructor(plugin, folder) {
    super(plugin, [folder]);
    this.folder = folder;
    this.alsoExisting = false;
    this.idleLabel = 'Save';
  }

  onOpen() {
    this.frame('Default properties');
    const intro = this.section();
    intro.createDiv({
      cls: 'dr-bulk-hint dr-bulk-intro',
      text: `New notes in “${this.folder.name || this.app.vault.getName()}” and its subfolders get these, where they don’t have them already.`,
    });
    const what = this.section('Properties');
    this.rowsEl = what.createDiv({ cls: 'dr-bulk-rows' });
    const add = what.createDiv({ cls: 'dr-bulk-add' });
    add.setAttribute('role', 'button');
    add.setAttribute('tabindex', '0');
    setIcon(add.createSpan({ cls: 'dr-bulk-add-icon' }), 'plus');
    add.createSpan({ text: 'Add another property' });
    onActivate(add, () => {
      this.rows.push(this.newRow());
      this.renderRows();
      const last = this.rowsEl.querySelector('.dr-bulk-row:last-child .dr-bulk-name input');
      if (last) last.focus();
    });
    const existing = this.section();
    const label = existing.createEl('label', { cls: 'dr-bulk-check' });
    const box = label.createEl('input', { type: 'checkbox' });
    this.existingCount = label.createSpan({ text: 'Also add them to the notes already here' });
    box.addEventListener('change', () => {
      this.alsoExisting = box.checked;
      this.update();
    });

    const saved = (this.plugin.settings.folderDefaults || {})[this.folder.path] || [];
    saved.forEach((p) => {
      const row = this.newRow();
      row.key = p.key;
      row.type = p.type || propertyType(this.app, p.key);
      row.raw = p.type === 'checkbox' ? p.value === true : Array.isArray(p.value) ? p.value.join(', ') : p.value === null || p.value === undefined ? '' : String(p.value);
      this.rows.push(row);
    });
    if (!this.rows.length) this.rows.push(this.newRow());
    this.renderRows();
    this.update();
  }

  update() {
    const named = this.rows.filter((r) => r.key);
    const lines = [];
    const seen = new Set();
    let problem = '';
    named.forEach((r) => {
      const k = r.key.toLowerCase();
      if (!problem && seen.has(k)) problem = `“${r.key}” is listed twice.`;
      seen.add(k);
      if (!problem) problem = propertyNameProblem(r.key);
    });
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }
    const props = named.map((r) => ({ key: r.key, value: parseTypedValue(r.type, r.raw), type: r.type }));
    const saved = (this.plugin.settings.folderDefaults || {})[this.folder.path] || [];
    const files = this.bulk.notesFor([this.folder], 'deep');
    const changing = this.alsoExisting && props.length ? this.bulk.planAdd(files, props, false).changing : [];
    if (this.existingCount) {
      this.existingCount.setText(`Also add them to the ${bulkCount(files.length, 'note')} already here`);
    }
    if (props.length) {
      lines.push({ icon: 'file-plus', text: `New notes here get ${nameList(props.map((p) => p.key))}.` });
    } else if (saved.length) {
      lines.push({ icon: 'x', cls: 'is-muted', text: 'Saving with none takes this folder’s defaults away.' });
    } else {
      lines.push({ icon: 'info', cls: 'is-muted', text: 'Name a property new notes here should have.' });
      return this.showSummary(lines, null);
    }
    if (changing.length) lines.push({ icon: 'plus', text: `And adds them now to ${bulkCount(changing.length, 'note')} already here.` });
    this.showSummary(lines, {
      label: changing.length ? `Save and add to ${bulkCount(changing.length, 'note')}` : 'Save',
      run: async () => {
        const all = Object.assign({}, this.plugin.settings.folderDefaults);
        if (props.length) all[this.folder.path] = props.map((p) => ({ key: p.key, value: p.value, type: p.type }));
        else delete all[this.folder.path];
        this.plugin.settings.folderDefaults = all;
        await this.plugin.saveData(this.plugin.settings);
        if (changing.length) {
          const record = await this.bulk.addProperties(files, props, false);
          if (record) bulkNotice(this.bulk, `Saved, and added them to ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
        } else {
          new Notice(props.length ? 'Default properties saved.' : 'Default properties removed.');
        }
      },
    });
  }
}

/* How long a new note is left for a template to fill before defaults go in. */
const DEFAULTS_DELAY = 800;

/** Take properties out of every note in some folders. */
class RemovePropertiesModal extends BulkModal {
  constructor(plugin, targets, keys) {
    super(plugin);
    (targets || []).forEach((t) => this.addTarget(t));
    this.chosen = new Set((keys || []).map((k) => k.toLowerCase()));
    this.idleLabel = 'Remove';
  }

  onOpen() {
    this.frame('Remove properties');
    this.targetsSection('Remove from');
    const what = this.section('Properties');
    this.listEl = what.createDiv({ cls: 'dr-bulk-checks' });
    this.update();
  }

  /** Redraw the choices when the notes they come from change. */
  renderTargets() {
    super.renderTargets();
    this.checksFor = null;
  }

  renderChecks(present) {
    const sig = present.map((p) => `${p.name}:${p.count}`).join('|');
    if (this.checksFor === sig) return;
    this.checksFor = sig;
    this.listEl.empty();
    if (!present.length) {
      this.listEl.createDiv({ cls: 'dr-bulk-hint', text: 'These notes have no properties.' });
      return;
    }
    present.forEach((p) => {
      const label = this.listEl.createEl('label', { cls: 'dr-bulk-check-row' });
      const box = label.createEl('input', { type: 'checkbox' });
      box.checked = this.chosen.has(p.name.toLowerCase());
      setIcon(label.createSpan({ cls: 'dr-bulk-check-icon' }), TYPE_ICONS[propertyType(this.app, p.name)] || 'text');
      label.createSpan({ cls: 'dr-bulk-check-name', text: p.name });
      label.createSpan({ cls: 'dr-bulk-check-count', text: String(p.count) });
      box.addEventListener('change', () => {
        if (box.checked) this.chosen.add(p.name.toLowerCase());
        else this.chosen.delete(p.name.toLowerCase());
        this.update();
      });
    });
  }

  update() {
    const files = this.notes();
    const present = propertiesIn(this.app, files);
    if (this.listEl) this.renderChecks(present);
    const keys = present.filter((p) => this.chosen.has(p.name.toLowerCase())).map((p) => p.name);
    const lines = [];
    if (!this.targets.length) lines.push({ icon: 'info', cls: 'is-muted', text: 'Choose the folders to remove them from.' });
    else if (!keys.length) lines.push({ icon: 'info', cls: 'is-muted', text: 'Tick the properties to remove.' });
    if (lines.length) return this.showSummary(lines, null);
    const changing = this.bulk.planRemove(files, keys);
    lines.push({
      icon: 'trash-2',
      cls: 'is-warning',
      text: `Removes ${nameList(keys)} from ${bulkCount(changing.length, 'note')}, values and all.`,
      notes: changing,
    });
    this.showSummary(lines, changing.length
      ? {
          label: `Remove from ${bulkCount(changing.length, 'note')}`,
          run: async () => {
            const record = await this.bulk.removeProperties(files, keys);
            if (!record) return;
            bulkNotice(this.bulk, `Removed ${nameList(keys)} from ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
          },
        }
      : null);
  }
}

/**
 * Rename a property in every note that has it — and in bases and this
 * plugin's settings — with what will happen shown before it does.
 */
class RenamePropertyModal extends BulkModal {
  constructor(plugin, from, to) {
    super(plugin);
    this.from = from || '';
    this.to = to || '';
    this.bases = null;
    this.basesKey = '';
    this.idleLabel = 'Rename';
  }

  onOpen() {
    this.frame('Rename property');
    const section = this.section();
    const from = this.field(section, 'Property', 'The property to rename');
    const to = this.field(section, 'New name', 'What to call it');
    this.fromInput = from.input;
    this.fromHint = from.hint;
    this.toInput = to.input;
    this.toHint = to.hint;
    this.fromInput.value = this.from;
    this.suggest(from.box, from.input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app),
      onSelect: (v) => {
        this.fromInput.value = v;
        this.update();
        this.toInput.focus();
      },
    });
    this.update();
    window.setTimeout(() => {
      if (this.from) {
        this.toInput.value = this.to || this.from;
        this.toInput.focus();
        if (!this.to) this.toInput.select();
        this.update();
      } else this.fromInput.focus();
    }, 0);
  }

  /** The property as the vault spells it, for what's been typed. */
  resolve(typed) {
    const t = typed.trim();
    if (!t) return '';
    return knownPropertyNames(this.app).find((n) => n.toLowerCase() === t.toLowerCase()) || t;
  }

  update() {
    const from = this.resolve(this.fromInput.value);
    const to = this.toInput.value.trim();
    const lines = [];
    const holders = from ? this.bulk.notesWithProperty(from).length : 0;
    this.fromHint.setText(from ? (holders ? `In ${bulkCount(holders, 'note')}` : 'Not in any note') : '');

    let problem = '';
    if (!from) problem = 'Choose the property to rename.';
    else if (!to) problem = 'Type the new name.';
    else problem = propertyNameProblem(to);
    // The name as it is: something to do only where notes spell it otherwise.
    const plan = problem ? null : this.bulk.planPropertyRename(from, to);
    if (!problem && to === from && !plan.total && !assignedEntryDiffers(this.app, to)) problem = 'Type the new name.';
    this.toHint.setText('');
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }

    const key = `${from}\u0000${to}`;
    if (this.basesKey !== key) {
      this.basesKey = key;
      this.bases = null;
      this.bulk.basesFor({ property: [from, to] }).then((files) => {
        if (this.basesKey !== key) return;
        this.bases = files;
        this.update();
      }, () => {
        if (this.basesKey === key) this.bases = [];
      });
    }

    const caseOnly = from.toLowerCase() === to.toLowerCase();
    const respell = caseOnly && assignedEntryDiffers(this.app, to);
    if (plan.total) {
      lines.push({
        icon: 'pencil',
        text: caseOnly
          ? `Changes its capitals in ${bulkCount(plan.total, 'note')}${respell ? ', and in the name Obsidian lists it by' : ''}.`
          : `Renames it in ${bulkCount(plan.total, 'note')}.`,
      });
    } else if (respell) {
      lines.push({ icon: 'pencil', text: `Every note writes it “${to}” already; Obsidian still lists it as “${assignedEntry(this.app, to).name}”, and that changes too.` });
    } else if (!holders) {
      lines.push({ icon: 'info', cls: 'is-muted', text: `No note has a property called “${from}”.` });
    }
    if (plan.merged.length) {
      lines.push({
        icon: 'git-merge',
        text: `${bulkCount(plan.merged.length, 'note')} already ${plan.merged.length === 1 ? 'has' : 'have'} “${to}” too; the two become one, since the values agree or are lists.`,
      });
    }
    if (plan.conflicts.length) {
      lines.push({
        icon: 'alert-triangle',
        cls: 'is-warning',
        text: `${bulkCount(plan.conflicts.length, 'note')} ${plan.conflicts.length === 1 ? 'has' : 'have'} both, with different values, so ${plan.conflicts.length === 1 ? "it's" : "they're"} left as ${plan.conflicts.length === 1 ? 'it is' : 'they are'}:`,
        notes: plan.conflicts,
      });
    }
    if (this.bases === null) {
      lines.push({ icon: 'loader', cls: 'is-muted', text: 'Looking through bases…' });
    } else if (this.bases.length) {
      lines.push({
        icon: 'table',
        text: `Also changes ${bulkCount(this.bases.length, 'base')} that ${this.bases.length === 1 ? 'uses' : 'use'} it: ${nameList(this.bases.map((f) => f.basename), false)}.`,
      });
    }
    if (plan.settings.length) {
      lines.push({ icon: 'settings', text: `And in Design Redux: ${nameList(plan.settings, false, 4)}.` });
    }
    const special = { tags: 'tags', aliases: 'aliases', cssclasses: 'CSS classes' };
    if (special[from.toLowerCase()] && !caseOnly) {
      lines.push({
        icon: 'alert-triangle',
        cls: 'is-warning',
        text: `Obsidian reads ${special[from.toLowerCase()]} from “${from.toLowerCase()}”; renamed, these stop being ${special[from.toLowerCase()]}.`,
      });
    }
    if (special[to.toLowerCase()] && !caseOnly) {
      lines.push({
        icon: 'info',
        text: `Obsidian reads ${special[to.toLowerCase()]} from “${to.toLowerCase()}”, so these values will be ${special[to.toLowerCase()]}.`,
      });
    }

    const reach = plan.total + (this.bases ? this.bases.length : 0) + plan.settings.length + (respell ? 1 : 0);
    this.showSummary(
      lines,
      reach
        ? {
            label: plan.total ? `Rename in ${bulkCount(plan.total, 'note')}` : 'Rename',
            run: async () => {
              const record = await this.bulk.renameProperty(from, to);
              if (!record) return;
              const done = notesChanged(record);
              const bases = (record.bases || []).length;
              bulkNotice(
                this.bulk,
                renamedText(from, to, done, record) +
                  (bases ? ` and ${bulkCount(bases, 'base')}` : '') +
                  '.' +
                  bulkTail(record),
                record
              );
            },
          }
        : null
    );
  }
}

/**
 * Several properties made one: chosen as chips, kept under one name —
 * one of theirs, or a new one. Where a note has more than one of them
 * with different values, they're put together in a list, or the note
 * is left as it is.
 */
class MergePropertiesModal extends BulkModal {
  constructor(plugin, names) {
    super(plugin);
    this.names = [];
    (names || []).forEach((n) => this.addName(n));
    this.mode = 'list';
    this.typedInto = false;
    this.idleLabel = 'Merge';
    this.bases = null;
    this.basesKey = '';
  }

  /** The property as the vault spells it, for what's been typed. */
  resolve(typed) {
    const t = String(typed || '').trim();
    if (!t) return '';
    return knownPropertyNames(this.app).find((n) => n.toLowerCase() === t.toLowerCase()) || t;
  }

  addName(name) {
    const n = this.resolve(name);
    if (n && !this.names.some((x) => x.toLowerCase() === n.toLowerCase() && x === n)) this.names.push(n);
  }

  /** The chosen name used by the most notes: what's kept, unless another is typed. */
  likelyName() {
    let best = '';
    let most = -1;
    this.names.forEach((n) => {
      const count = this.bulk.notesWithProperty(n).length;
      if (count > most) {
        best = n;
        most = count;
      }
    });
    return best;
  }

  onOpen() {
    this.frame('Merge properties');
    const which = this.section('Properties');
    this.chipsEl = which.createDiv({ cls: 'dr-bulk-chips dr-merge-chips' });
    const into = this.field(this.section(), 'Keep as', 'The name to keep');
    this.intoInput = into.input;
    this.intoHint = into.hint;
    this.intoInput.addEventListener('input', () => {
      this.typedInto = !!this.intoInput.value.trim();
    });
    this.suggest(into.box, into.input, {
      icon: 'tag',
      source: () => this.names.concat(knownPropertyNames(this.app).filter((n) => this.names.indexOf(n) === -1)),
      onSelect: (v) => {
        this.intoInput.value = v;
        this.typedInto = true;
        this.update();
      },
    });

    this.modeEl = this.section('Where a note’s values differ');
    this.modeEl.addClass('dr-merge-mode');
    const select = this.modeEl.createEl('select', { cls: 'dropdown' });
    [
      ['list', 'Put them together in a list'],
      ['skip', 'Leave those notes as they are'],
    ].forEach(([value, label]) => {
      const option = select.createEl('option', { text: label });
      option.value = value;
    });
    select.value = this.mode;
    select.setAttribute('aria-label', 'Where a note’s values differ');
    select.addEventListener('change', () => {
      this.mode = select.value;
      this.update();
    });

    this.renderChips();
    this.update();
    window.setTimeout(() => {
      const add = this.chipsEl.querySelector('input');
      if (this.names.length < 2 && add) add.focus();
      else this.intoInput.focus();
    }, 0);
  }

  renderChips() {
    const el = this.chipsEl;
    el.empty();
    this.names.forEach((name) => {
      const chip = el.createDiv({ cls: 'dr-bulk-chip' });
      setIcon(chip.createSpan({ cls: 'dr-bulk-chip-icon' }), TYPE_ICONS[propertyType(this.app, name)] || 'tag');
      chip.createSpan({ cls: 'dr-bulk-chip-name', text: name });
      const count = this.bulk.notesWithProperty(name).length;
      chip.setAttribute('aria-label', `${name}: in ${bulkCount(count, 'note')}`);
      const remove = chip.createSpan({ cls: 'dr-bulk-chip-remove' });
      setIcon(remove, 'x');
      remove.setAttribute('role', 'button');
      remove.setAttribute('tabindex', '0');
      remove.setAttribute('aria-label', `Leave out ${name}`);
      onActivate(remove, () => {
        this.names.splice(this.names.indexOf(name), 1);
        this.renderChips();
        this.update();
      });
    });
    const box = el.createDiv({ cls: 'dr-bulk-input dr-merge-add' });
    const input = box.createEl('input', { type: 'text' });
    input.placeholder = this.names.length ? 'Add another…' : 'Add a property…';
    input.setAttribute('aria-label', 'Add a property to merge');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    const take = (value) => {
      const name = this.resolve(value);
      if (!name || knownPropertyNames(this.app).indexOf(name) === -1) return false;
      this.addName(name);
      this.renderChips();
      this.update();
      const next = this.chipsEl.querySelector('input');
      if (next) next.focus();
      return true;
    };
    if (this.addList) this.addList.remove();
    this.suggests = this.suggests.filter((l) => l !== this.addList);
    this.addList = this.suggest(box, input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app).filter((n) => this.names.indexOf(n) === -1),
      onSelect: (v) => take(v),
    });
    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      evt.stopPropagation();
      take(input.value);
    });
  }

  update() {
    if (!this.intoInput) return;
    if (!this.typedInto) this.intoInput.value = this.likelyName();
    const names = this.names;
    const to = this.intoInput.value.trim();
    const lines = [];
    const kept = this.resolve(to);
    const holders = kept ? this.bulk.notesWithProperty(kept).length : 0;
    this.intoHint.setText(
      !kept ? '' : names.some((n) => n.toLowerCase() === kept.toLowerCase()) ? '' : holders ? `Already in ${bulkCount(holders, 'note')}` : 'A new name'
    );
    this.modeEl.addClass('is-hidden');

    let problem = '';
    if (names.length < 2 && !(names.length === 1 && to && to !== names[0])) {
      problem = names.length ? 'Add another property to merge it with.' : 'Choose the properties to merge.';
    } else if (!to) problem = 'Type the name to keep.';
    else problem = propertyNameProblem(to);
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }
    const into = kept || to;
    const plan = this.bulk.planPropertyMerge(names, into, this.mode);
    const probe = this.mode === 'list' ? plan : this.bulk.planPropertyMerge(names, into, 'list');
    const differ = this.mode === 'list' ? plan.combined : plan.conflicts;
    if (probe.combined.length) this.modeEl.removeClass('is-hidden');

    const others = names.filter((n) => n.toLowerCase() !== into.toLowerCase());
    const key = `${names.join('\u0000')}\u0001${into}`;
    if (this.basesKey !== key) {
      this.basesKey = key;
      this.bases = null;
      Promise.all(others.map((n) => this.bulk.basesFor({ property: [n, into] }))).then(
        (lists) => {
          if (this.basesKey !== key) return;
          this.bases = Array.from(new Set([].concat(...lists)));
          this.update();
        },
        () => {
          if (this.basesKey === key) this.bases = [];
        }
      );
    }

    if (plan.total) {
      lines.push({
        icon: 'git-merge',
        text: `Brings ${nameList(names)} together as “${into}” in ${bulkCount(plan.total, 'note')}.`,
      });
    } else if (!differ.length) {
      lines.push({ icon: 'info', cls: 'is-muted', text: 'No note has any of these.' });
    }
    if (differ.length) {
      lines.push(
        this.mode === 'list'
          ? {
              icon: 'list',
              text: `${bulkCount(differ.length, 'note')} ${differ.length === 1 ? 'has' : 'have'} different values in more than one; they’re put together in a list:`,
              notes: differ,
            }
          : {
              icon: 'alert-triangle',
              cls: 'is-warning',
              text: `${bulkCount(differ.length, 'note')} ${differ.length === 1 ? 'has' : 'have'} different values in more than one, so ${differ.length === 1 ? "it's" : "they're"} left as ${differ.length === 1 ? 'it is' : 'they are'}:`,
              notes: differ,
            }
      );
    }
    if (this.bases === null) {
      if (others.length) lines.push({ icon: 'loader', cls: 'is-muted', text: 'Looking through bases…' });
    } else if (this.bases.length) {
      lines.push({
        icon: 'table',
        text: `Also changes ${bulkCount(this.bases.length, 'base')} that ${this.bases.length === 1 ? 'uses' : 'use'} them: ${nameList(this.bases.map((f) => f.basename), false)}.`,
      });
    }
    if (plan.settings.length) {
      lines.push({ icon: 'settings', text: `And in Design Redux: ${nameList(plan.settings, false, 4)}.` });
    }
    const special = { tags: 'tags', aliases: 'aliases', cssclasses: 'CSS classes' };
    others.forEach((n) => {
      if (special[n.toLowerCase()] && n.toLowerCase() !== into.toLowerCase()) {
        lines.push({
          icon: 'alert-triangle',
          cls: 'is-warning',
          text: `Obsidian reads ${special[n.toLowerCase()]} from “${n.toLowerCase()}”; merged into “${into}”, these stop being ${special[n.toLowerCase()]}.`,
        });
      }
    });

    const reach = plan.total + (this.bases ? this.bases.length : 0) + plan.settings.length;
    this.showSummary(
      lines,
      reach
        ? {
            label: `Merge into “${into}”`,
            run: async () => {
              const record = await this.bulk.mergeProperties(names.slice(), into, this.mode);
              if (!record) return;
              const done = notesChanged(record);
              const bases = (record.bases || []).length;
              const lists = (record.combined || []).length;
              bulkNotice(
                this.bulk,
                `Merged ${nameList(names)} into “${into}” in ${bulkCount(done, 'note')}` +
                  (bases ? ` and ${bulkCount(bases, 'base')}` : '') +
                  '.' +
                  (lists ? ` ${bulkCount(lists, 'note')} now ${lists === 1 ? 'has' : 'have'} a list of the different values.` : '') +
                  bulkTail(record),
                record
              );
            },
          }
        : null
    );
  }
}
