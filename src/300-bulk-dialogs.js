/**
 * The parts every bulk dialog shares: labelled fields, a summary of
 * what will happen that updates as you type, and the button that does
 * it, which says how many notes it will change.
 */
class BulkModal extends Modal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.bulk = plugin.bulk;
    // Bases are read afresh for each dialog, in case one was edited.
    this.bulk.baseCache = null;
    this.suggests = [];
    this.updateTimer = 0;
    this.action = null;
    this.targets = [];
    this.reach = 'deep';
  }

  frame(title) {
    this.modalEl.addClass('dr-bulk-modal');
    this.titleEl.setText(title);
    this.contentEl.empty();
    this.body = this.contentEl.createDiv({ cls: 'dr-bulk-body' });
    this.summaryEl = this.contentEl.createDiv({ cls: 'dr-bulk-summary' });
    this.summaryEl.setAttribute('aria-live', 'polite');
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    this.goButton = buttons.createEl('button', { cls: 'mod-cta' });
    this.goButton.addEventListener('click', () => this.go());
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  section(label) {
    const el = this.body.createDiv({ cls: 'dr-bulk-section' });
    if (label) el.createDiv({ cls: 'dr-bulk-label', text: label });
    return el;
  }

  /* -- folders and notes, as chips ---------------------------------- */

  addTarget(target) {
    if (!target || this.targets.indexOf(target) !== -1) return;
    if (target instanceof TFolder || (target instanceof TFile && target.extension === 'md')) {
      this.targets.push(target);
    }
  }

  /** A section of chips for the folders and notes, and which of their notes. */
  targetsSection(label) {
    const where = this.section(label);
    where.addClass('is-where');
    this.targetsEl = where.createDiv({ cls: 'dr-bulk-chips' });
    this.scopeEl = where.createDiv({ cls: 'dr-bulk-option' });
    this.renderTargets();
    return where;
  }

  renderTargets() {
    const el = this.targetsEl;
    el.empty();
    this.targets.forEach((target) => {
      const chip = el.createDiv({ cls: 'dr-bulk-chip' });
      const isFolder = target instanceof TFolder;
      setIcon(chip.createSpan({ cls: 'dr-bulk-chip-icon' }), isFolder ? 'folder' : 'file-text');
      const name = isFolder ? target.name || this.app.vault.getName() : target.basename;
      chip.createSpan({ cls: 'dr-bulk-chip-name', text: name });
      chip.setAttribute('aria-label', target.path);
      const remove = chip.createSpan({ cls: 'dr-bulk-chip-remove' });
      setIcon(remove, 'x');
      remove.setAttribute('role', 'button');
      remove.setAttribute('tabindex', '0');
      remove.setAttribute('aria-label', `Remove ${name}`);
      onActivate(remove, () => {
        this.targets.splice(this.targets.indexOf(target), 1);
        this.renderTargets();
        this.update();
      });
    });
    const pick = el.createDiv({ cls: 'dr-bulk-chip is-add' });
    pick.setAttribute('role', 'button');
    pick.setAttribute('tabindex', '0');
    // With folders chosen, just a round + beside them; with none, it says what it's for.
    pick.toggleClass('is-icon', this.targets.length > 0);
    setIcon(pick.createSpan({ cls: 'dr-bulk-chip-icon' }), this.targets.length ? 'plus' : 'folder-plus');
    if (this.targets.length) pick.setAttribute('aria-label', 'Add a folder');
    else pick.createSpan({ text: 'Choose a folder' });
    onActivate(pick, () =>
      new FolderPicker(this.app, (folder) => {
        this.addTarget(folder);
        this.renderTargets();
        this.update();
      }).open()
    );
    this.renderScope();
  }

  renderScope() {
    const el = this.scopeEl;
    el.empty();
    const folders = this.targets.some((t) => t instanceof TFolder);
    el.toggleClass('is-hidden', !folders);
    if (!folders) return;
    const select = el.createEl('select', { cls: 'dropdown' });
    [
      ['deep', 'Including subfolders'],
      ['direct', 'Not their subfolders'],
      ['folder-notes', 'Folder notes only'],
    ].forEach(([value, label]) => {
      const option = select.createEl('option', { text: label });
      option.value = value;
    });
    select.value = this.reach;
    select.setAttribute('aria-label', 'Which notes');
    select.addEventListener('change', () => {
      this.reach = select.value;
      this.update();
    });
  }


  /** A text field with a label, and a line beneath it for a hint. */
  field(parent, label, placeholder) {
    const wrap = parent.createDiv({ cls: 'dr-bulk-field' });
    const id = `dr-bulk-${Math.random().toString(36).slice(2)}`;
    const labelEl = wrap.createEl('label', { cls: 'dr-bulk-label', text: label });
    labelEl.setAttribute('for', id);
    const box = wrap.createDiv({ cls: 'dr-bulk-input' });
    const input = box.createEl('input', { type: 'text' });
    input.id = id;
    input.placeholder = placeholder;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
    const hint = wrap.createDiv({ cls: 'dr-bulk-hint' });
    input.addEventListener('input', () => this.queueUpdate());
    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt) || this.suggesting()) return;
      evt.preventDefault();
      // The latest typing counts, not the summary from a moment ago.
      window.clearTimeout(this.updateTimer);
      this.update();
      if (this.action) this.go();
    });
    return { input, hint, box };
  }

  suggest(box, input, opts) {
    const list = attachSuggest(box, input, opts);
    list.addClass('dr-bulk-suggest');
    this.suggests.push(list);
    return list;
  }

  /** Whether a suggestion is highlighted, so Enter picks it rather than applying. */
  suggesting() {
    return this.suggests.some((l) => l.hasClass('is-open') && !!l.querySelector('.is-selected'));
  }

  queueUpdate() {
    window.clearTimeout(this.updateTimer);
    this.updateTimer = window.setTimeout(() => this.update(), 60);
  }

  update() {}

  /**
   * Lines of the summary: { text, cls?, icon?, notes? }. `action` is
   * { label, run } or null while there's nothing to do.
   */
  showSummary(lines, action) {
    this.summaryEl.empty();
    lines.forEach((line) => {
      const el = this.summaryEl.createDiv({ cls: `dr-bulk-line ${line.cls || ''}`.trim() });
      setIcon(el.createSpan({ cls: 'dr-bulk-line-icon' }), line.icon || 'dot');
      const text = el.createDiv({ cls: 'dr-bulk-line-text' });
      text.createSpan({ text: line.text });
      if (line.notes && line.notes.length) {
        const list = text.createDiv({ cls: 'dr-bulk-notes' });
        line.notes.slice(0, 6).forEach((file) => {
          const link = list.createSpan({ cls: 'dr-bulk-note', text: file.basename });
          link.setAttribute('role', 'link');
          link.setAttribute('tabindex', '0');
          link.setAttribute('aria-label', `Open ${file.path}`);
          onActivate(link, () => {
            this.close();
            this.app.workspace.getLeaf(false).openFile(file);
          });
        });
        if (line.notes.length > 6) list.createSpan({ cls: 'dr-bulk-more', text: `and ${line.notes.length - 6} more` });
      }
    });
    this.summaryEl.toggleClass('is-empty', !lines.length);
    this.action = action;
    this.goButton.setText(action ? action.label : this.idleLabel || 'Apply');
    this.goButton.disabled = !action;
    this.goButton.toggleClass('is-disabled', !action);
  }

  async go() {
    const action = this.action;
    if (!action || this.bulk.busy) return;
    this.action = null;
    this.close();
    await action.run();
  }

  onClose() {
    window.clearTimeout(this.updateTimer);
    this.suggests.forEach((el) => el.remove());
    this.suggests = [];
    this.contentEl.empty();
  }
}

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
    const files = this.bulk.notesFor(this.targets, this.reach);
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
    if (!problem && to === from && !plan.total) problem = 'Type the new name.';
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
    if (plan.total) {
      lines.push({
        icon: 'pencil',
        text: caseOnly
          ? `Changes its capitals in ${bulkCount(plan.total, 'note')}.`
          : `Renames it in ${bulkCount(plan.total, 'note')}.`,
      });
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

    const reach = plan.total + (this.bases ? this.bases.length : 0) + plan.settings.length;
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
                (from === to ? `Wrote “${to}” the same way in ${bulkCount(done, 'note')}` : `Renamed “${from}” to “${to}” in ${bulkCount(done, 'note')}`) +
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

/**
 * Rename a tag — and the tags nested beneath it — in every note's
 * properties and text, and in bases. Renaming to a tag that already
 * exists merges the two.
 */
class RenameTagModal extends BulkModal {
  constructor(plugin, from) {
    super(plugin);
    this.from = String(from || '').replace(/^#/, '');
    this.bases = null;
    this.basesKey = '';
    this.idleLabel = 'Rename';
  }

  onOpen() {
    this.frame('Rename tag');
    const section = this.section();
    const from = this.field(section, 'Tag', 'The tag to rename');
    const to = this.field(section, 'New name', 'What to call it');
    from.box.addClass('has-hash');
    to.box.addClass('has-hash');
    this.fromInput = from.input;
    this.fromHint = from.hint;
    this.toInput = to.input;
    this.toHint = to.hint;
    this.fromInput.value = this.from;
    this.suggest(from.box, from.input, {
      icon: 'hash',
      query: () => this.fromInput.value.replace(/^#/, ''),
      source: () => vaultTags(this.app).map((t) => t.tag),
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

  update() {
    const from = this.fromInput.value.trim().replace(/^#/, '');
    const to = this.toInput.value.trim().replace(/^#/, '');
    const lines = [];
    const plan = from ? this.bulk.planTagRename(from, to) : null;
    this.fromHint.setText(
      plan
        ? plan.files.length
          ? `On ${bulkCount(plan.files.length, 'note')}` +
            (plan.nested.length ? `, with ${bulkCount(plan.nested.length, 'tag')} beneath it` : '')
          : 'Not on any note'
        : ''
    );

    let problem = '';
    if (!from) problem = 'Choose the tag to rename.';
    else if (!to || to === from) problem = 'Type the new name.';
    else problem = tagNameProblem(to);
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }

    const key = `${from.toLowerCase()}\u0000${to}`;
    if (this.basesKey !== key) {
      this.basesKey = key;
      this.bases = null;
      this.bulk.basesFor({ tag: [from, to] }).then((files) => {
        if (this.basesKey !== key) return;
        this.bases = files;
        this.update();
      }, () => {
        if (this.basesKey === key) this.bases = [];
      });
    }

    const n = plan.files.length;
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (n) {
      const where = [];
      if (plan.inProps) where.push(`the properties of ${plan.inProps}`);
      if (plan.inText) where.push(`the text of ${plan.inText}`);
      lines.push({
        icon: 'pencil',
        text: `${caseOnly ? 'Changes its capitals on' : 'Renames it on'} ${bulkCount(n, 'note')}: in ${where.join(', and ')}.`,
      });
    } else {
      lines.push({ icon: 'info', cls: 'is-muted', text: `No note is tagged #${from}.` });
    }
    if (plan.nested.length && !caseOnly) {
      const first = plan.nested[0];
      lines.push({
        icon: 'corner-down-right',
        text:
          `Tags beneath it follow: #${first} becomes #${renameTagText(first, from, to)}` +
          (plan.nested.length > 1 ? `, and ${bulkCount(plan.nested.length - 1, 'other')} the same way.` : '.'),
      });
    }
    if (plan.already) {
      lines.push({
        icon: 'git-merge',
        text: `#${to} is already on ${bulkCount(plan.already, 'note')}; the two become one.`,
      });
    }
    if (this.bases === null) {
      lines.push({ icon: 'loader', cls: 'is-muted', text: 'Looking through bases…' });
    } else if (this.bases.length) {
      lines.push({
        icon: 'table',
        text: `Also changes ${bulkCount(this.bases.length, 'base')} that ${this.bases.length === 1 ? 'tests' : 'test'} for it: ${nameList(this.bases.map((f) => f.basename), false)}.`,
      });
    }

    const reach = n + (this.bases ? this.bases.length : 0);
    this.showSummary(
      lines,
      reach
        ? {
            label: n ? `Rename on ${bulkCount(n, 'note')}` : 'Rename',
            run: async () => {
              const record = await this.bulk.renameTag(from, to);
              if (!record) return;
              const done = notesChanged(record);
              const bases = (record.bases || []).length;
              bulkNotice(
                this.bulk,
                `Renamed #${from} to #${to} on ${bulkCount(done, 'note')}` +
                  (bases ? ` and in ${bulkCount(bases, 'base')}` : '') +
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
 * Rename one value of a property everywhere it's used — "IR" to
 * "International Relations" — in notes, lists included, and in bases
 * that compare the property with it.
 */
class RenameValueModal extends BulkModal {
  constructor(plugin, key, value) {
    super(plugin);
    this.key = key || '';
    this.value = value === undefined || value === null ? '' : String(value);
    this.bases = null;
    this.basesKey = '';
    this.idleLabel = 'Rename';
  }

  onOpen() {
    this.frame('Rename a value');
    const section = this.section();
    const key = this.field(section, 'Property', 'Whose value to rename');
    const from = this.field(section, 'Value', 'The value as it is now');
    const to = this.field(section, 'New value', 'What it becomes');
    this.keyInput = key.input;
    this.fromInput = from.input;
    this.toInput = to.input;
    this.fromHint = from.hint;
    this.keyInput.value = this.key;
    this.fromInput.value = this.value;
    this.suggest(key.box, key.input, {
      icon: 'tag',
      source: () => knownPropertyNames(this.app),
      onSelect: (v) => {
        this.keyInput.value = v;
        this.update();
        this.fromInput.focus();
      },
    });
    this.suggest(from.box, from.input, {
      icon: 'text',
      source: () => (this.keyInput.value.trim() ? propertyValues(this.app, this.keyInput.value.trim()) : []),
      onSelect: (v) => {
        this.fromInput.value = v;
        this.update();
        this.toInput.focus();
      },
    });
    this.update();
    window.setTimeout(() => {
      if (this.key && this.value) {
        this.toInput.value = this.value;
        this.toInput.focus();
        this.toInput.select();
        this.update();
      } else if (this.key) this.fromInput.focus();
      else this.keyInput.focus();
    }, 0);
  }

  update() {
    const key = this.keyInput.value.trim();
    const from = this.fromInput.value;
    const to = this.toInput.value.trim();
    const lines = [];
    const plan = key && from ? this.bulk.planValueRename(key, from, from) : null;
    this.fromHint.setText(plan ? (plan.files.length ? `In ${bulkCount(plan.files.length, 'note')}` : 'Not in any note') : '');
    let problem = '';
    if (!key) problem = 'Choose the property.';
    else if (!from) problem = 'Choose the value to rename.';
    else if (!to || to === from) problem = 'Type the new value.';
    if (problem) {
      lines.push({ icon: 'info', cls: 'is-muted', text: problem });
      return this.showSummary(lines, null);
    }

    const real = this.bulk.planValueRename(key, from, to);
    const basesKey = `${key}\u0000${from}\u0000${to}`;
    if (this.basesKey !== basesKey) {
      this.basesKey = basesKey;
      this.bases = null;
      this.bulk.basesFor({ value: [key, from, to] }).then(
        (files) => {
          if (this.basesKey !== basesKey) return;
          this.bases = files;
          this.update();
        },
        () => {
          if (this.basesKey === basesKey) this.bases = [];
        }
      );
    }
    const n = real.files.length;
    if (n) lines.push({ icon: 'pencil', text: `Changes “${from}” to “${to}” in ${bulkCount(n, 'note')}.` });
    else lines.push({ icon: 'info', cls: 'is-muted', text: `No note has “${from}” as its ${key}.` });
    if (real.merged) {
      lines.push({
        icon: 'git-merge',
        text: `${bulkCount(real.merged, 'note')} already ${real.merged === 1 ? 'lists' : 'list'} “${to}” as well; the two become one there.`,
      });
    }
    if (this.bases === null) lines.push({ icon: 'loader', cls: 'is-muted', text: 'Looking through bases…' });
    else if (this.bases.length) {
      lines.push({
        icon: 'table',
        text: `Also changes ${bulkCount(this.bases.length, 'base')} that ${this.bases.length === 1 ? 'filters' : 'filter'} on it: ${nameList(this.bases.map((f) => f.basename), false)}.`,
      });
    }
    const reach = n + (this.bases ? this.bases.length : 0);
    this.showSummary(
      lines,
      reach
        ? {
            label: n ? `Rename in ${bulkCount(n, 'note')}` : 'Rename',
            run: async () => {
              const record = await this.bulk.renameValue(key, from, to);
              if (!record) return;
              const bases = (record.bases || []).length;
              bulkNotice(
                this.bulk,
                `Renamed “${from}” to “${to}” in ${bulkCount(notesChanged(record), 'note')}` +
                  (bases ? ` and ${bulkCount(bases, 'base')}` : '') + '.' + bulkTail(record),
                record
              );
            },
          }
        : null
    );
  }
}

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
    const files = this.bulk.notesFor(this.targets, this.reach);
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
    const files = this.bulk.notesFor(this.targets, this.reach);
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

/* -- where they're reached from ---------------------------------------- */

/**
 * Commands for the three, and menu entries where they belong: a
 * folder's menu (Obsidian's file explorer, and every folder here), a
 * selection of several in the explorer, and a tag under the cursor.
 */
/* How long a new note is left for a template to fill before defaults go in. */
const DEFAULTS_DELAY = 800;

/**
 * The property tools as one window: Add, Remove, Find missing and — for
 * a single folder — the defaults its new notes get, as tabs across the
 * top. Each tab is one of the dialogs above, drawn into this window
 * rather than opening its own, so switching is instant and the folders
 * chosen carry across.
 */
/**
 * Each property in some notes, as a note's properties would be listed:
 * the values it holds, how many of the notes have it, and a way to fill
 * it in for the rest. A name is renamed where it's shown; its menu has
 * the rest; several picked can be merged or removed together.
 */
function propertyOverview(app, files) {
  const all = new Map();
  files.forEach((file) => {
    const cache = app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    Object.keys(fm).forEach((key) => {
      if (key === 'position') return;
      const low = key.toLowerCase();
      if (!all.has(low)) all.set(low, { name: key, count: 0, values: [], seen: new Set(), more: false });
      const entry = all.get(low);
      entry.count++;
      const raw = fm[key];
      (Array.isArray(raw) ? raw : [raw]).forEach((v) => {
        if (v === null || v === undefined || v === '' || typeof v === 'object') return;
        const text = plainValue(v);
        const k = String(text).toLowerCase();
        if (!text || entry.seen.has(k)) return;
        entry.seen.add(k);
        if (entry.values.length < 4) entry.values.push(text);
        else entry.more = true;
      });
    });
  });
  return Array.from(all.values())
    .map((e) => ({ name: e.name, count: e.count, values: e.values, more: e.more }))
    .sort((a, b) => b.count - a.count || byName(a.name, b.name));
}

class PropertyListTool extends BulkModal {
  constructor(plugin, targets, host) {
    super(plugin);
    (targets || []).forEach((t) => this.addTarget(t));
    this.host = host;
    this.picks = new Set();
  }

  /** The notes listed: those chosen, or every note while none are. */
  files() {
    return this.targets.length ? this.bulk.notesFor(this.targets, this.reach) : this.app.vault.getMarkdownFiles();
  }

  onOpen() {
    this.modalEl.addClass('dr-bulk-modal');
    this.contentEl.empty();
    this.body = this.contentEl.createDiv({ cls: 'dr-bulk-body dr-plist' });
    const where = this.targetsSection('');
    where.addClass('dr-plist-where');
    this.countEl = where.createSpan({ cls: 'dr-plist-count' });
    this.listEl = this.body.createDiv({ cls: 'dr-plist-list' });
    this.footEl = this.contentEl.createDiv({ cls: 'dr-plist-foot' });
    this.update();
  }

  /** With none chosen, every note: said so, with the + beside it to narrow it. */
  renderTargets() {
    super.renderTargets();
    if (this.targets.length || !this.targetsEl) return;
    const all = this.targetsEl.createDiv({ cls: 'dr-bulk-chip is-all' });
    setIcon(all.createSpan({ cls: 'dr-bulk-chip-icon' }), 'library');
    all.createSpan({ cls: 'dr-bulk-chip-name', text: 'All notes' });
    this.targetsEl.prepend(all);
    const pick = this.targetsEl.querySelector('.dr-bulk-chip.is-add');
    if (pick) {
      pick.addClass('is-icon');
      pick.empty();
      setIcon(pick.createSpan({ cls: 'dr-bulk-chip-icon' }), 'plus');
      pick.setAttribute('aria-label', 'Choose a folder');
    }
  }

  update() {
    if (!this.listEl) return;
    const files = this.files();
    const total = files.length;
    const props = propertyOverview(this.app, files);
    this.countEl.setText(bulkCount(total, 'note'));
    Array.from(this.picks).forEach((name) => {
      if (!props.some((p) => p.name === name)) this.picks.delete(name);
    });

    const list = this.listEl;
    list.empty();
    if (!props.length) {
      list.addClass('is-empty');
      list.createDiv({ cls: 'dr-plist-empty', text: total ? 'These notes have no properties yet.' : 'There are no notes here.' });
    } else list.removeClass('is-empty');
    roveFocus(list, '.dr-plist-row');

    props.forEach((prop) => {
      const row = list.createDiv({ cls: 'dr-plist-row' });
      row.setAttribute('tabindex', '-1');
      row.toggleClass('is-picked', this.picks.has(prop.name));

      const pick = row.createDiv({ cls: 'dr-plist-pick' });
      pick.setAttribute('role', 'checkbox');
      pick.setAttribute('tabindex', '0');
      pick.setAttribute('aria-checked', String(this.picks.has(prop.name)));
      if (this.picks.has(prop.name)) setIcon(pick, 'check');
      onActivate(pick, () => {
        if (this.picks.has(prop.name)) this.picks.delete(prop.name);
        else this.picks.add(prop.name);
        this.update();
      });

      const icon = row.createDiv({ cls: 'dr-plist-icon' });
      setIcon(icon, TYPE_ICONS[propertyType(this.app, prop.name)] || 'text');

      // The name, and under it the values it holds — as a track's
      // artist sits under its title.
      const text = row.createDiv({ cls: 'dr-plist-text' });
      const name = text.createDiv({ cls: 'dr-plist-name', text: prop.name });
      name.setAttribute('role', 'button');
      name.setAttribute('tabindex', '0');
      onActivate(name, () => this.startRename(row, name, prop));
      const values = text.createDiv({
        cls: 'dr-plist-values',
        text: prop.values.length ? prop.values.join(', ') + (prop.more ? ', …' : '') : 'No values yet',
      });
      if (!prop.values.length) values.addClass('is-none');

      const missing = total - prop.count;
      if (missing > 0) {
        const fill = row.createEl('button', { cls: 'dr-plist-fill', text: `Fill in ${missing}` });
        fill.addEventListener('click', () => this.host.openSheet('missing', { key: prop.name }));
      }
      row.createDiv({ cls: 'dr-plist-cover', text: `${prop.count} of ${total}` });

      const more = row.createDiv({ cls: 'clickable-icon dr-plist-more' });
      more.setAttribute('role', 'button');
      more.setAttribute('tabindex', '0');
      more.setAttribute('aria-label', `More for ${prop.name}`);
      setIcon(more, 'more-horizontal');
      const menu = (evt) => this.propertyMenu(evt, row, name, prop, missing);
      more.addEventListener('click', menu);
      onContextMenu(row, menu);
    });

    this.renderFoot();
  }

  renderFoot() {
    const foot = this.footEl;
    foot.empty();
    const n = this.picks.size;
    if (n) {
      foot.createSpan({ cls: 'dr-plist-picked', text: `${n} picked` });
      const clear = foot.createEl('button', { cls: 'dr-plist-clear', text: 'Clear' });
      clear.addEventListener('click', () => {
        this.picks.clear();
        this.update();
      });
      const names = Array.from(this.picks);
      const remove = foot.createEl('button', { cls: 'mod-warning dr-plist-remove', text: 'Remove' });
      remove.addEventListener('click', () => this.host.openSheet('remove', { keys: names }));
      const merge = foot.createEl('button', { cls: 'mod-cta dr-plist-merge' });
      setIcon(merge.createSpan({ cls: 'dr-plist-btn-icon' }), 'git-merge');
      merge.createSpan({ text: 'Merge…' });
      merge.disabled = n < 2;
      merge.toggleClass('is-disabled', n < 2);
      if (n < 2) merge.setAttribute('aria-label', 'Pick another to merge them');
      merge.addEventListener('click', () => {
        if (this.picks.size > 1) this.host.openSheet('merge', { keys: names });
      });
      return;
    }
    const add = foot.createEl('button', { cls: 'dr-plist-add' });
    setIcon(add.createSpan({ cls: 'dr-plist-btn-icon' }), 'plus');
    add.createSpan({ text: 'Add property' });
    add.addEventListener('click', () => this.host.openSheet('add'));
    const folder = this.host.folderOf(this.targets);
    if (folder) {
      const defaults = foot.createEl('button', { cls: 'dr-plist-defaults' });
      setIcon(defaults.createSpan({ cls: 'dr-plist-btn-icon' }), 'file-cog');
      defaults.createSpan({ text: 'Defaults for new notes' });
      defaults.addEventListener('click', () => this.host.openSheet('defaults'));
    }
  }

  propertyMenu(evt, row, name, prop, missing) {
    evt.preventDefault();
    evt.stopPropagation();
    const menu = new Menu();
    const item = (title, icon, run, warn) =>
      menu.addItem((i) => {
        i.setTitle(title).setIcon(icon).onClick(run);
        if (warn && typeof i.setWarning === 'function') i.setWarning(true);
      });
    item('Rename', 'pencil', () => this.startRename(row, name, prop));
    item('Merge with…', 'git-merge', () => this.host.openSheet('merge', { keys: [prop.name] }));
    if (missing > 0) {
      item(`Fill in the ${missing} without it…`, 'list-checks', () => this.host.openSheet('missing', { key: prop.name }));
    }
    item('Change type…', 'shapes', () => this.host.openSheet('type', { key: prop.name }));
    menu.addSeparator();
    item('Remove from these notes…', 'trash-2', () => this.host.openSheet('remove', { keys: [prop.name] }), true);
    showMenuAt(menu, evt);
  }

  /**
   * The name as a field, where it's shown. Enter renames it in every
   * note — or, left as it is, writes it that way in notes that spell it
   * otherwise; Escape puts it back.
   */
  startRename(row, nameEl, prop) {
    if (row.querySelector('input.dr-plist-name-edit')) return;
    const input = nameEl.parentElement.createEl('input', { cls: 'dr-plist-name-edit', type: 'text' });
    input.value = prop.name;
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('aria-label', `Rename ${prop.name}`);
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (!keep || !value) {
        input.replaceWith(nameEl);
        return;
      }
      this.rename(prop.name, value);
    };
    input.addEventListener('keydown', (evt) => {
      if (composing(evt)) return;
      if (evt.key === 'Enter') {
        evt.preventDefault();
        finish(true);
      } else if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(input.value.trim() !== prop.name));
  }

  /** Renamed everywhere, with Undo; one that needs a look first opens the rename. */
  async rename(from, to) {
    const problem = propertyNameProblem(to);
    if (problem) {
      new Notice(problem);
      this.update();
      return;
    }
    const plan = this.bulk.planPropertyRename(from, to);
    if (from === to && !plan.total && !plan.conflicts.length) {
      this.update();
      return;
    }
    const special = ['tags', 'aliases', 'cssclasses'];
    const changing = from.toLowerCase() !== to.toLowerCase();
    if (plan.conflicts.length || (changing && (special.indexOf(from.toLowerCase()) !== -1 || special.indexOf(to.toLowerCase()) !== -1))) {
      this.host.openSheet('rename', { key: from, to });
      return;
    }
    if (this.picks.has(from)) {
      this.picks.delete(from);
      this.picks.add(to);
    }
    const record = await this.bulk.renameProperty(from, to);
    this.update();
    if (!record) return;
    const done = notesChanged(record);
    const bases = (record.bases || []).length;
    bulkNotice(
      this.bulk,
      (from === to ? `Wrote “${to}” the same way in ${bulkCount(done, 'note')}` : `Renamed “${from}” to “${to}” in ${bulkCount(done, 'note')}`) +
        (bases ? ` and ${bulkCount(bases, 'base')}` : '') +
        '.' +
        (plan.merged.length ? ` ${bulkCount(plan.merged.length, 'note')} already had “${to}”; the two are one now.` : '') +
        bulkTail(record),
      record
    );
  }
}

/**
 * The Properties window: the list of properties in some notes, and
 * each tool — adding, removing, filling in, defaults, renaming, merging,
 * changing a type — opening over it as a sheet, with a way back.
 */
class PropertyToolsModal extends Modal {
  constructor(plugin, targets, tab, args) {
    super(plugin.app);
    this.plugin = plugin;
    this.targets = (targets || []).slice();
    this.reach = 'deep';
    this.tab = tab || null;
    this.args = args || {};
    this.tool = null;
    this.sheet = null;
  }

  /** The one folder the notes are, for its defaults. */
  folderOf(targets) {
    const only = targets.length === 1 ? targets[0] : null;
    return only instanceof TFolder && !only.isRoot() ? only : null;
  }

  make(id, args) {
    const targets = this.targets;
    args = args || {};
    if (id === 'add') return new AddPropertiesModal(this.plugin, targets);
    if (id === 'remove') return new RemovePropertiesModal(this.plugin, targets, args.keys);
    if (id === 'missing') return new MissingPropertyModal(this.plugin, targets, args.key);
    if (id === 'defaults') {
      const folder = this.folderOf(targets);
      return folder ? new FolderDefaultsModal(this.plugin, folder) : null;
    }
    if (id === 'rename') return new RenamePropertyModal(this.plugin, args.key, args.to);
    if (id === 'merge') return new MergePropertiesModal(this.plugin, args.keys || (args.key ? [args.key] : []));
    if (id === 'type') return new ChangeTypeModal(this.plugin, args.key);
    return null;
  }

  onOpen() {
    this.modalEl.addClass('dr-bulk-modal', 'dr-props-modal');
    this.titleEl.setText('Properties');
    this.panel = this.contentEl.createDiv({ cls: 'dr-props-panel' });
    // The list keeps up with the notes as changes land in them.
    this.watch = this.app.metadataCache.on('changed', () => {
      window.clearTimeout(this.watchTimer);
      this.watchTimer = window.setTimeout(() => {
        if (!this.sheet && this.tool && typeof this.tool.update === 'function') this.tool.update();
      }, 250);
    });
    if (this.tab && this.make(this.tab, this.args)) this.openSheet(this.tab, this.args);
    else this.showList();
  }

  /** The folders and notes, and which of their notes, from whatever showed them last. */
  keepChoice() {
    const tool = this.tool;
    if (!tool || !Array.isArray(tool.targets) || !tool.targetsEl) return;
    this.targets = tool.targets.slice();
    if (tool.reach) this.reach = tool.reach;
  }

  closeTool() {
    if (!this.tool) return;
    this.keepChoice();
    try {
      this.tool.onClose();
    } catch (err) {
      /* it was only drawing */
    }
    this.tool = null;
  }

  mount(tool, container, asSheet) {
    tool.reach = this.reach;
    tool.modalEl = this.modalEl;
    tool.titleEl = document.createElement('div');
    tool.contentEl = container;
    // A sheet's Cancel, or its change once made, goes back to the list.
    tool.close = asSheet ? () => this.showList() : () => this.close();
    this.tool = tool;
    tool.onOpen();
  }

  showList() {
    this.closeTool();
    this.sheet = null;
    this.modalEl.removeClass('is-sheet');
    this.titleEl.empty();
    this.titleEl.setText('Properties');
    this.panel.empty();
    this.mount(new PropertyListTool(this.plugin, this.targets, this), this.panel, false);
    // Opened, nothing in particular is focused — not the first chip's ×,
    // which Obsidian would pick once the window is up.
    window.setTimeout(() => {
      const active = this.contentEl.ownerDocument.activeElement;
      if (active && active.matches && active.matches('.dr-bulk-chip-remove') && typeof active.blur === 'function') active.blur();
    }, 0);
  }

  /** A tool over the list: its name for the title, with the way back before it. */
  openSheet(id, args) {
    const tool = this.make(id, args);
    if (!tool) return;
    this.closeTool();
    this.sheet = id;
    this.modalEl.addClass('is-sheet');
    this.panel.empty();
    this.mount(tool, this.panel, true);
    const name = tool.titleEl.textContent || 'Properties';
    this.titleEl.empty();
    const back = this.titleEl.createEl('button', { cls: 'dr-sheet-back' });
    setIcon(back, 'chevron-left');
    back.setAttribute('aria-label', 'Back to the properties');
    back.addEventListener('click', () => this.showList());
    this.titleEl.createSpan({ cls: 'dr-sheet-title', text: name });
  }

  onClose() {
    window.clearTimeout(this.watchTimer);
    if (this.watch) this.app.metadataCache.offref(this.watch);
    this.closeTool();
    this.contentEl.empty();
  }
}

