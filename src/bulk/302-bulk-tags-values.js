/* ------------------------------------------------------------------ */
/* Bulk: tags and values renamed                                      */
/*                                                                    */
/* Everywhere they appear, in properties and in text.                 */
/* ------------------------------------------------------------------ */

import { vaultTags } from '../core/040-helpers-sorting.js';
import { knownPropertyNames, propertyValues } from '../core/045-helpers-properties.js';
import { bulkCount, renameTagText } from '../core/047-helpers-text.js';
import { bulkNotice, bulkTail, nameList, notesChanged, tagNameProblem } from './290-bulk-engine.js';
import { BulkModal } from './300-bulk-dialogs.js';

/**
 * Rename a tag — and the tags nested beneath it — in every note's
 * properties and text, and in bases. Renaming to a tag that already
 * exists merges the two.
 */
export class RenameTagModal extends BulkModal {
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
export class RenameValueModal extends BulkModal {
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
