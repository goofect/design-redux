/* ------------------------------------------------------------------ */
/* Property rules, and a note's history                                */
/*                                                                     */
/* A rule: when a note comes into a folder, gets a tag or has a        */
/* property set, set others. Kept as the old plugin kept them:         */
/* { id, name, on, when: { kind, folder | tag | key, value }, set:     */
/* [{ key, value }], replace }. Off until switched on, and then a dry  */
/* run until that is switched off too: a rule that would fire says     */
/* what it would set, and sets nothing. A rule's own writes fire no    */
/* rule. A rule fires on a change — a note coming into the folder, a   */
/* tag newly added, a value newly set — so an Undo, which is none of   */
/* those, is not undone again. History: each change to a note's        */
/* properties kept by the note's path, the last so many, to be put     */
/* back one value at a time.                                           */
/* ------------------------------------------------------------------ */

import { Notice, TFile } from 'obsidian';
import { Feature } from '../core/feature.js';
import { noteProps, propOf, sameValue, tagsOf, valuesOf } from '../core/notes.js';
import { field } from '../ui/field.js';
import { row, rows } from '../ui/row.js';
import { Sheet } from '../ui/sheet.js';
import { sayso } from '../ui/state.js';

/** A rule said plainly. */
export function ruleName(rule) {
  const w = rule.when || {};
  const what = w.kind === 'folder' ? `comes into ${w.folder}` : w.kind === 'tag' ? `gets #${w.tag}` : w.value ? `has ${w.key} set to ${w.value}` : `gets ${w.key}`;
  return `When a note ${what}, set ${(rule.set || []).map((s) => s.key).join(', ')}`;
}

/** What a rule's condition is read from: a note's tags and properties, as they stand. */
export function noteState(app, file) {
  return { tags: tagsOf(app, file), props: noteProps(app, file) };
}

/** Whether a tag or property rule's condition holds for a note's state. A folder rule is a matter of where a note is, not what it holds. */
export function ruleHolds(rule, state) {
  const w = rule.when || {};
  if (w.kind === 'tag') return state.tags.some((t) => t === w.tag || t.startsWith(`${w.tag}/`));
  if (w.kind === 'property') {
    const values = valuesOf(propOf(state.props, w.key));
    return w.value ? values.some((v) => v.toLowerCase() === String(w.value).toLowerCase()) : values.length > 0;
  }
  return false;
}

/** What a rule would set on a note: { key: value } for the properties it would change. */
export function ruleWould(app, rule, file) {
  const props = noteProps(app, file);
  const out = {};
  (rule.set || []).forEach((s) => {
    const have = propOf(props, s.key);
    const empty = have === undefined || have === null || have === '';
    if ((empty || rule.replace) && !sameValue(have, s.value)) out[s.key] = s.value;
  });
  return out;
}

/** A rule read from one line: "folder Logic -> status=draft, course=Logic". */
export function parseRule(text) {
  const [left, right] = String(text).split('->').map((s) => (s || '').trim());
  const m = /^(folder|tag|property)\s+(.+)$/i.exec(left || '');
  if (!m || !right) return null;
  const kind = m[1].toLowerCase();
  const when = { kind };
  if (kind === 'folder') when.folder = m[2].replace(/^\/+|\/+$/g, '');
  else if (kind === 'tag') when.tag = m[2].replace(/^#/, '').toLowerCase();
  else { const [key, value] = m[2].split('=').map((s) => s.trim()); when.key = key; when.value = value || ''; }
  const set = right.split(',').map((part) => { const [key, ...rest] = part.split('='); return { key: key.trim(), value: rest.join('=').trim() }; }).filter((s) => s.key);
  if (!set.length) return null;
  const rule = { id: `rule-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, on: true, when, set };
  rule.name = ruleName(rule);
  return rule;
}

export class PropertyRules extends Feature {
  enable() {
    this.seen = new Map(); // by path: the tags and properties last known, to tell what is new
    this.quiet = new Set(); // paths whose next change is a rule's own write
    this.plugin.index.markdown().forEach((f) => this.seen.set(f.path, noteState(this.app, f)));
    const md = (file) => file instanceof TFile && file.extension === 'md';
    this.listen(this.app.workspace, 'design-redux:props', (file) => md(file) && this.changed(file));
    this.listen(this.app.workspace, 'design-redux:renamed', (file, oldPath) => md(file) && this.arrived(file, oldPath));
    this.listen(this.app.vault, 'create', (file) => md(file) && setTimeout(() => this.on && this.arrived(file, null), 0));
  }

  list() {
    return (Array.isArray(this.settings.propertyRules) ? this.settings.propertyRules : []).filter((r) => r && r.when && Array.isArray(r.set) && r.on !== false);
  }

  /** A note's tags or properties changed: the tag and property rules whose condition has just come to hold. */
  changed(file) {
    const before = this.seen.get(file.path) || null;
    const now = noteState(this.app, file);
    this.seen.set(file.path, now);
    if (this.quiet.delete(file.path)) return Promise.resolve([]);
    return this.apply(file, this.list().filter((r) => r.when.kind !== 'folder' && ruleHolds(r, now) && !(before && ruleHolds(r, before))));
  }

  /** A note was made, or moved: the folder rules of a folder it has just come into, and for a new note the rest that hold. */
  arrived(file, oldPath) {
    const into = (path, r) => path.startsWith(`${r.when.folder}/`);
    const due = this.list().filter((r) => r.when.kind === 'folder' && into(file.path, r) && !(oldPath && into(oldPath, r)));
    if (oldPath) {
      this.seen.set(file.path, this.seen.get(oldPath) || noteState(this.app, file));
      this.seen.delete(oldPath);
    } else {
      const now = noteState(this.app, file);
      this.seen.set(file.path, now);
      due.push(...this.list().filter((r) => r.when.kind !== 'folder' && ruleHolds(r, now)));
    }
    return this.apply(file, due);
  }

  /** Sets what the due rules say, in one write and one Undo; in a dry run, says so and sets nothing. */
  async apply(file, rules) {
    const due = rules.map((rule) => ({ rule, set: ruleWould(this.app, rule, file) })).filter((d) => Object.keys(d.set).length);
    if (!due.length) return [];
    if (this.settings.propertyRulesDryRun !== false) {
      new Notice(`Dry run: ${due[0].rule.name || ruleName(due[0].rule)} would set ${Object.keys(due[0].set).join(', ')} on ${file.basename}.`);
      return due;
    }
    this.quiet.add(file.path);
    const record = await this.plugin.notes.write(file, (fm) => due.forEach((d) => Object.assign(fm, d.set)), { undo: `A rule set ${due.flatMap((d) => Object.keys(d.set)).join(', ')} on ${file.basename}.` });
    if (!record) this.quiet.delete(file.path);
    return due;
  }

  /** The rules, in a sheet: each on a row (a press turns it off or on), and a line to add one. */
  edit() {
    const sheet = new Sheet(this.app, {
      title: 'Property rules',
      text: this.settings.propertyRulesDryRun !== false ? 'A dry run: a rule that would fire says what it would set, and sets nothing.' : 'Live: a rule sets what it says, in one Undo.',
      build: (matter) => {
        const draw = () => {
          while (matter.childNodes.length > 1) matter.removeChild(matter.lastChild);
          const rules = Array.isArray(this.settings.propertyRules) ? this.settings.propertyRules : [];
          if (!rules.length) sayso(matter, { glyph: 'rules', label: 'No rules yet' });
          else {
            const list = rows(matter);
            rules.forEach((rule, i) => row(list, { number: i + 1, name: rule.name || ruleName(rule), end: rule.on === false ? 'off' : 'on', run: async () => { rule.on = rule.on === false; await this.plugin.saveSettings(); draw(); } }));
          }
          const add = field(matter, { label: 'A new rule', placeholder: 'folder Logic -> status=draft', note: 'folder, tag or property; then ->; then what to set.', onEnter: async (v) => {
            const rule = parseRule(v);
            if (!rule) return void add.drSay('Write it as: folder Logic -> status=draft', true);
            this.settings.propertyRules = (Array.isArray(this.settings.propertyRules) ? this.settings.propertyRules : []).concat(rule);
            await this.plugin.saveSettings();
            draw();
          } });
        };
        draw();
      },
      actions: [{ text: 'Close' }],
    });
    sheet.open();
    return sheet;
  }

  actions() {
    return [{ id: 'property-rules', name: 'Property rules…', glyph: 'rules', run: () => this.edit() }];
  }

  settingsRows() {
    return [{ key: 'propertyRulesDryRun', name: 'Dry run', desc: 'Rules say what they would set, and set nothing.', type: 'toggle' }];
  }
}
PropertyRules.key = 'propertyRulesOn';
PropertyRules.title = 'Property rules';
PropertyRules.glyph = 'rules';
PropertyRules.section = 'Tools';
PropertyRules.about = 'When a note comes into a folder, gets a tag or a value, set other properties.';

export class PropertyHistory extends Feature {
  get wanted() {
    return Number(this.settings.propertyHistoryLimit) > 0;
  }

  enable() {
    this.add(this.plugin.notes.watch((record) => this.keep(record)));
    this.plugin.historyOf = (file) => ((this.settings.propertyHistory || {})[file.path] || []).slice().reverse();
    this.plugin.putBackChange = (file, change) => this.putBack(file, change);
    this.add(() => { delete this.plugin.historyOf; delete this.plugin.putBackChange; });
  }

  keep(record) {
    const all = this.settings.propertyHistory || (this.settings.propertyHistory = {});
    const list = all[record.file.path] || (all[record.file.path] = []);
    Object.keys(record.before).forEach((key) => list.push({ key, was: record.before[key], now: record.after[key], at: Date.now() }));
    list.splice(0, Math.max(0, list.length - Number(this.settings.propertyHistoryLimit)));
    this.plugin.saveData(this.settings);
  }

  /** Puts one value back as a kept change had it, the rest left as they are. */
  putBack(file, change) {
    return this.plugin.notes.write(file, (fm) => { if (change.was === undefined) delete fm[change.key]; else fm[change.key] = change.was; }, { undo: `${change.key} put back.` });
  }

  settingsRows() {
    return [{ key: 'propertyHistoryLimit', name: 'Changes kept a note', desc: '0 keeps none.', type: 'number' }];
  }
}
PropertyHistory.title = 'Property history';
PropertyHistory.glyph = 'undo';
PropertyHistory.section = 'Tools';
PropertyHistory.about = 'The last changes to a note’s properties, to put back one value at a time.';
