/* ------------------------------------------------------------------ */
/* Property rules                                                      */
/*                                                                     */
/* A rule: when a note comes into a folder, gets a tag or has a        */
/* property set, set others. Kept as the old plugin kept them:         */
/* { id, name, on, when: { kind, folder | tag | key, value }, set:     */
/* [{ key, value }], replace }. Off until switched on, and then a dry  */
/* run until that is switched off too: a rule that would fire says     */
/* what it would set, and sets nothing. A rule's own writes fire no    */
/* rule. A rule fires on a change — a note coming into the folder, a   */
/* tag newly added, a value newly set — so an Undo, which is none of   */
/* those, is not undone again.                                         */
/* ------------------------------------------------------------------ */

import { DropdownComponent, Notice, TFile, ToggleComponent } from 'obsidian';
import { el } from '../core/dom.js';
import { Feature } from '../core/feature.js';
import { noteProps, propOf, sameValue, tagsOf, valuesOf } from '../core/notes.js';
import { textButton } from '../ui/button.js';
import { textInput } from '../ui/field.js';
import { Sheet } from '../ui/sheet.js';
import { sayso } from '../ui/state.js';

/** A rule said plainly, as a sentence: "When a note comes into Logic, set status to draft". */
export function ruleName(rule) {
  const w = rule.when || {};
  const what = w.kind === 'folder' ? `comes into ${w.folder}` : w.kind === 'tag' ? `gets #${w.tag}` : w.value ? `has ${w.key} set to ${w.value}` : `gets ${w.key}`;
  return `When a note ${what}, set ${(rule.set || []).map((s) => (s.value !== '' && s.value != null ? `${s.key} to ${s.value}` : s.key)).join(' and ')}`;
}

/** A rule from the sentence's fields: { kind: folder | tag | property, what, key, value }, or null when a field it needs is empty. */
export function ruleOf(parts) {
  const what = String(parts.what || '').trim();
  const key = String(parts.key || '').trim();
  if (!what || !key || !['folder', 'tag', 'property'].includes(parts.kind)) return null;
  const when = { kind: parts.kind };
  if (parts.kind === 'folder') when.folder = what.replace(/^\/+|\/+$/g, '');
  else if (parts.kind === 'tag') when.tag = what.replace(/^#/, '').toLowerCase();
  else { const [k, ...v] = what.split('='); when.key = k.trim(); when.value = v.join('=').trim(); }
  const rule = { id: `rule-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, on: true, when, set: [{ key, value: String(parts.value || '').trim() }] };
  rule.name = ruleName(rule);
  return rule;
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
      new Notice(`Dry run: “${ruleName(due[0].rule)}” would set ${Object.keys(due[0].set).join(', ')} on ${file.basename}.`);
      return due;
    }
    this.quiet.add(file.path);
    const record = await this.plugin.notes.write(file, (fm) => due.forEach((d) => Object.assign(fm, d.set)), { undo: `A rule set ${due.flatMap((d) => Object.keys(d.set)).join(', ')} on ${file.basename}.` });
    if (!record) this.quiet.delete(file.path);
    return due;
  }

  /**
   * The rules, in a sheet: each said as a sentence, its toggle beside it, no
   * numbers; then a new one written the same way, a sentence with fields:
   * "When a note [comes into] [folder], set [property] to [value]".
   */
  edit() {
    const sheet = new Sheet(this.app, {
      title: 'Property rules',
      text: this.settings.propertyRulesDryRun !== false ? 'A dry run: a rule that would fire says what it would set, and sets nothing. The command “Let property rules write” makes them live.' : 'Live: a rule sets what it says, in one Undo.',
      build: (matter) => {
        const draw = () => {
          while (matter.childNodes.length > 1) matter.removeChild(matter.lastChild);
          const rules = Array.isArray(this.settings.propertyRules) ? this.settings.propertyRules : [];
          if (!rules.length) sayso(matter, { label: 'No rules yet' });
          else {
            const list = el(matter, 'div', 'dr-rules');
            list.setAttribute('role', 'list');
            rules.forEach((rule) => {
              const line = el(list, 'div', 'dr-rule');
              line.setAttribute('role', 'listitem');
              const said = el(line, 'span', 'dr-text dr-rule-name', ruleName(rule));
              const toggle = new ToggleComponent(line).setValue(rule.on !== false);
              toggle.toggleEl.setAttribute('aria-label', `${said.textContent}: on`);
              toggle.onChange(async (on) => { rule.on = on; await this.plugin.saveSettings(); });
            });
          }
          this.newRule(matter, draw);
        };
        draw();
      },
      actions: [{ text: 'Close' }],
    });
    sheet.open();
    return sheet;
  }

  /** The sentence a new rule is written in, its fields where its words go, and Add. */
  newRule(matter, done) {
    const form = el(matter, 'div', 'dr-rule-new');
    const line = el(form, 'div', 'dr-rule-sentence dr-text');
    const input = (placeholder) => textInput(line, { cls: 'dr-field-box dr-rule-field', label: placeholder, placeholder });
    el(line, 'span', '', 'When a note');
    const kind = new DropdownComponent(line).addOptions({ folder: 'comes into', tag: 'gets the tag', property: 'gets the property' }).setValue('folder');
    kind.selectEl.setAttribute('aria-label', 'When');
    const what = input('folder');
    kind.onChange((k) => { what.placeholder = k; what.setAttribute('aria-label', k); });
    el(line, 'span', 'dr-rule-tight', ', set');
    const key = input('property');
    el(line, 'span', '', 'to');
    const value = input('value');
    const say = el(form, 'span', 'dr-field-note dr-muted');
    textButton(form, { text: 'Add rule', run: async () => {
      const rule = ruleOf({ kind: kind.getValue(), what: what.value, key: key.value, value: value.value });
      if (!rule) return void (say.textContent = `Fill in the ${kind.getValue()} and the property.`);
      this.settings.propertyRules = (Array.isArray(this.settings.propertyRules) ? this.settings.propertyRules : []).concat(rule);
      await this.plugin.saveSettings();
      done();
    } });
    return form;
  }

  actions() {
    const dry = () => this.settings.propertyRulesDryRun !== false;
    const live = async (on) => {
      this.settings.propertyRulesDryRun = !on;
      await this.plugin.saveSettings();
      new Notice(on ? 'Property rules now set what they say, each with an Undo.' : 'Property rules are a dry run: they say what they would set, and set nothing.');
    };
    return [
      { id: 'property-rules', name: 'Property rules…', run: () => this.edit() },
      { id: 'property-rules-live', name: 'Let property rules write', when: dry, run: () => live(true) },
      { id: 'property-rules-dry-run', name: 'Make property rules a dry run', when: () => !dry(), run: () => live(false) },
    ];
  }
}
PropertyRules.key = 'propertyRulesOn';
PropertyRules.title = 'Property rules';
PropertyRules.section = 'Tools';
PropertyRules.about = 'When a note comes into a folder, gets a tag or a value, set other properties.';
