/* ------------------------------------------------------------------ */
/* Bulk: a property renamed, and properties merged                     */
/*                                                                    */
/* Everywhere they're used, or in folders or chosen notes; where two   */
/* names hold different values, kept both, joined or one kept.        */
/* ------------------------------------------------------------------ */

import { setIcon } from 'obsidian';
import { TYPE_ICONS } from '../core/020-constants.js';
import { asButton, composing, onActivate } from '../core/042-controls.js';
import { knownPropertyNames } from '../core/045-helpers-properties.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { assignedEntry, assignedEntryDiffers, propertyNameProblem, propertyType, renamedText } from './288-bulk-values.js';
import { bulkNotice, bulkTail, nameList, notesChanged } from './290-bulk-engine.js';
import { BulkModal } from './300-bulk-dialogs.js';

/**
 * Rename a property in every note that has it — and in bases and this
 * plugin's settings — with what will happen shown before it does.
 */
export class RenamePropertyModal extends BulkModal {
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
export class MergePropertiesModal extends BulkModal {
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
      asButton(remove, `Leave out ${name}`);
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
