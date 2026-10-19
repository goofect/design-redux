/* ------------------------------------------------------------------ */
/* Property rules: the feature                                         */
/*                                                                    */
/* Off until switched on, and then in a dry run until that's switched */
/* off too: a rule that would fire says what it would set, and sets    */
/* nothing. Live, a rule fires on the one note that changed — made,    */
/* moved, its tags or properties changed — and its writes are one step */
/* of Undo, firing no rule of their own. A rule can also be run over   */
/* the notes it holds for now: shown first, asked about past 200       */
/* notes, one step of Undo for them all.                               */
/* ------------------------------------------------------------------ */

import { Modal, Notice, setIcon, TFile } from 'obsidian';
import { asButton, noteTags, onActivate } from '../core/040-helpers-sorting.js';
import { parseDateInput } from '../core/045-helpers-properties.js';
import { bulkCount } from '../core/047-helpers-text.js';
import { noteProps } from '../core/073-notes.js';
import { Feature } from '../core/080-feature.js';
import { applyPlan, planRules, ruleChanges, ruleHolds, ruleKeys, ruleName, ruleState, tidyRule } from '../core/087-property-rules.js';
import { confirmAction } from '../ui/230-pickers.js';
import { bulkNotice, bulkTail, notesChanged } from './290-bulk-engine.js';

/* A run over more notes than this asks first. */
export const RULE_ASK_OVER = 200;
/* How long after a note is made its rules run: a template filling it in goes first. */
const RULE_CREATE_DELAY = 400;

/** A value as a rule sets it: today, tomorrow or +3d as the date they mean; true and false as a checkbox; a number as one. */
export function ruleValue(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (/^(today|tomorrow|yesterday|[+-]\d+[dwmy]?)$/i.test(s)) return parseDateInput(s) || s;
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

/** "status: Done" lines as what a rule sets, and back. */
export function parseSetLines(text) {
  return String(text || '')
    .split(/\n|;/)
    .map((line) => {
      const at = line.indexOf(':');
      if (at < 1) return null;
      return { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
    })
    .filter((s) => s && s.key);
}

function setLines(set) {
  return (set || []).map((s) => `${s.key}: ${s.value === null || s.value === undefined ? '' : s.value}`).join('\n');
}

export class PropertyRules extends Feature {
  settingsSchema() {
    return [
      {
        key: 'propertyRulesOn',
        name: 'Property rules',
        desc: 'When a note comes into a folder, gets a tag or has a property set to a value, set other properties — only where they’re empty, unless a rule says to replace them. Set them up with Property rules….',
      },
      {
        key: 'propertyRulesDryRun',
        showIf: 'propertyRulesOn',
        name: 'Dry run',
        desc: 'A rule that would fire says what it would set, and sets nothing. Switch it off to let the rules write.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'property-rules',
        name: 'Property rules…',
        icon: 'wand',
        run: () => new RulesModal(this.plugin, this).open(),
      },
    ];
  }

  /** The rules switched on, as kept. */
  rules() {
    return (Array.isArray(this.settings.propertyRules) ? this.settings.propertyRules : []).map(tidyRule).filter((r) => r && r.on);
  }

  register() {
    this.states = null;
    // Notes the rules have just written to: their next change fires nothing.
    this.writing = new Set();
    const vault = this.app.vault;
    const cache = this.app.metadataCache;
    this.plugin.registerEvent(vault.on('create', (file) => this.made(file)));
    this.plugin.registerEvent(vault.on('rename', (file, oldPath) => this.moved(file, oldPath)));
    this.plugin.registerEvent(vault.on('delete', (file) => this.states && this.states.delete(file.path)));
    this.plugin.registerEvent(cache.on('changed', (file, data, fileCache) => this.changed(file, fileCache)));
  }

  enable() {
    // What each note's tags and properties were, so a change can be told from a state: taken afresh when rules change.
    this.states = null;
    const ws = this.app.workspace;
    if (this.rules().length && typeof ws.onLayoutReady === 'function') ws.onLayoutReady(() => this.enabled && this.known());
  }

  disable() {
    this.states = null;
  }

  stateOf(file, fileCache) {
    const cache = fileCache || this.app.metadataCache.getFileCache(file);
    return ruleState(noteTags(cache), cache && cache.frontmatter, ruleKeys(this.rules()));
  }

  /** Every note's state, taken once the rules are first needed. */
  known() {
    if (!this.states) {
      this.states = new Map();
      this.app.vault.getMarkdownFiles().forEach((f) => this.states.set(f.path, this.stateOf(f)));
    }
    return this.states;
  }

  made(file) {
    if (!this.enabled || !(file instanceof TFile) || file.extension !== 'md' || !this.rules().length) return;
    window.setTimeout(() => {
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) return;
      const after = this.stateOf(file);
      this.known().set(file.path, after);
      this.fire(file, { path: file.path, before: null, after });
    }, RULE_CREATE_DELAY);
  }

  moved(file, oldPath) {
    if (!this.enabled || !(file instanceof TFile) || file.extension !== 'md' || !this.rules().length) return;
    const states = this.known();
    const state = states.get(oldPath) || this.stateOf(file);
    states.delete(oldPath);
    states.set(file.path, state);
    return this.fire(file, { path: file.path, from: oldPath, before: state, after: state });
  }

  changed(file, fileCache) {
    if (!this.enabled || !(file instanceof TFile) || file.extension !== 'md' || !this.rules().length) return;
    const states = this.known();
    const after = this.stateOf(file, fileCache);
    const before = states.get(file.path);
    states.set(file.path, after);
    // A rule's own write, or a note just made (its rules run from its making): nothing fires.
    if (this.writing.delete(file.path) || before === undefined) return null;
    return this.fire(file, { path: file.path, before, after });
  }

  /** What a change sets by the rules it fires: said in a dry run, else written — one step of Undo. */
  async fire(file, change) {
    const plan = planRules(this.rules(), change, noteProps(this.app, file)).map((p) => Object.assign({}, p, { value: ruleValue(p.value) }));
    if (!plan.length) return null;
    const said = plan.map((p) => `${p.key}: ${Array.isArray(p.value) ? p.value.join(', ') : p.value}`).join(', ');
    if (this.settings.propertyRulesDryRun !== false) {
      new Notice(`Dry run — “${plan[0].rule.name}” would set ${said} on “${file.basename}”.`);
      return { dry: true, plan };
    }
    this.writing.add(file.path);
    const record = await this.plugin.notes.write(file, (fm) => applyPlan(fm, plan), { undo: `Rules set ${said} on “${file.basename}”.` });
    if (!record || !Object.keys(record.before).length) this.writing.delete(file.path);
    return record;
  }

  /** The notes a rule holds for now, and what it would set in each: [{ file, plan }]. */
  planNow(rule) {
    const keys = ruleKeys([rule]);
    return this.app.vault
      .getMarkdownFiles()
      .map((file) => {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!ruleHolds(rule, file.path, ruleState(noteTags(cache), cache && cache.frontmatter, keys))) return null;
        const plan = ruleChanges(rule, noteProps(this.app, file)).map((s) => ({ rule, key: s.key, value: ruleValue(s.value) }));
        return plan.length ? { file, plan } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.file.path.localeCompare(b.file.path));
  }

  /** A rule run over the notes it holds for now: asked about past RULE_ASK_OVER notes; one step of Undo for them all. */
  async runNow(rule, found) {
    const list = found || this.planNow(rule);
    if (!list.length) return null;
    if (list.length > RULE_ASK_OVER) {
      const yes = await confirmAction(this.app, { title: 'Run the rule over all of them?', text: `“${rule.name}” would change ${bulkCount(list.length, 'note')}.`, button: `Change ${bulkCount(list.length, 'note')}` });
      if (!yes) return null;
    }
    list.forEach(({ file }) => this.writing.add(file.path));
    const fm = this.app.fileManager;
    const record = await this.plugin.bulk.run(`Running “${rule.name}”`, async (touch, step) => {
      let done = 0;
      for (const { file, plan } of list) {
        await touch(file, () => fm.processFrontMatter(file, (data) => applyPlan(data, plan)));
        step(++done, list.length);
      }
    });
    if (record) bulkNotice(this.plugin.bulk, `“${rule.name}” set in ${bulkCount(notesChanged(record), 'note')}.` + bulkTail(record), record);
    return record;
  }
}

PropertyRules.settingKey = 'propertyRulesOn';

const KIND_LABELS = { folder: 'comes into the folder', tag: 'gets the tag', property: 'has the property' };

/** The rules, each a row to change: when, what it sets, whether it replaces; Try now shows what it would do to the notes there already. */
export class RulesModal extends Modal {
  constructor(plugin, feature) {
    super(plugin.app);
    this.plugin = plugin;
    this.feature = feature;
    this.rules = (Array.isArray(plugin.settings.propertyRules) ? plugin.settings.propertyRules : []).map((r) => JSON.parse(JSON.stringify(r)));
  }

  onOpen() {
    this.modalEl.addClass('dr-rules-modal');
    this.titleEl.setText('Property rules');
    const s = this.plugin.settings;
    this.contentEl.createDiv({
      cls: 'dr-rules-state',
      text: !s.propertyRulesOn ? 'Rules are switched off in settings: they’re kept, and nothing fires.' : s.propertyRulesDryRun !== false ? 'Dry run: a rule that would fire says what it would set, and sets nothing.' : 'Rules are live: they set properties as notes change.',
    });
    this.listEl = this.contentEl.createDiv({ cls: 'dr-rules-list' });
    this.renderRules();
    const add = this.contentEl.createDiv({ cls: 'dr-schema-add' });
    setIcon(add.createSpan(), 'plus');
    add.createSpan({ text: 'Add a rule' });
    asButton(add, 'Add a rule');
    onActivate(add, () => {
      this.rules.push({ id: `r${Date.now().toString(36)}${this.rules.length}`, on: true, when: { kind: 'folder', folder: '' }, set: [] });
      this.renderRules();
    });
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { cls: 'mod-cta', text: 'Save' }).addEventListener('click', () => this.save());
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  renderRules() {
    this.listEl.empty();
    if (!this.rules.length) this.listEl.createDiv({ cls: 'dr-empty', text: 'No rules yet.' });
    this.rules.forEach((rule, i) => {
      const el = this.listEl.createDiv({ cls: 'dr-rule' });
      const head = el.createDiv({ cls: 'dr-rule-when' });
      const on = head.createEl('input', { type: 'checkbox', attr: { 'aria-label': 'On' } });
      on.checked = rule.on !== false;
      on.addEventListener('change', () => (rule.on = on.checked));
      head.createSpan({ text: 'When a note' });
      const kind = head.createEl('select', { cls: 'dropdown dr-rule-kind' });
      Object.keys(KIND_LABELS).forEach((k) => (kind.createEl('option', { text: KIND_LABELS[k] }).value = k));
      kind.value = rule.when.kind;
      kind.addEventListener('change', () => {
        rule.when = { kind: kind.value };
        this.renderRules();
      });
      const w = rule.when;
      const input = (field, placeholder) => {
        const box = head.createEl('input', { type: 'text', cls: `dr-rule-${field}`, attr: { placeholder, 'aria-label': placeholder } });
        box.value = w[field] || '';
        box.addEventListener('input', () => (w[field] = box.value));
      };
      if (w.kind === 'folder') input('folder', 'Folder');
      else if (w.kind === 'tag') input('tag', 'Tag');
      else {
        input('key', 'Property');
        head.createSpan({ text: 'set to' });
        input('value', 'Any value');
      }
      const sets = el.createEl('textarea', { cls: 'dr-rule-set', attr: { placeholder: 'What it sets, a line each — status: Done, reviewed: today', 'aria-label': 'What it sets', rows: '2' } });
      sets.value = setLines(rule.set);
      sets.addEventListener('input', () => (rule.set = parseSetLines(sets.value)));
      const foot = el.createDiv({ cls: 'dr-rule-foot' });
      const rep = foot.createEl('label', { cls: 'dr-schema-row-required' });
      const box = rep.createEl('input', { type: 'checkbox' });
      box.checked = !!rule.replace;
      box.addEventListener('change', () => (rule.replace = box.checked));
      rep.createSpan({ text: 'Replace what’s there' });
      const tryIt = foot.createSpan({ cls: 'dr-rule-try', text: 'Try on the notes there now…' });
      asButton(tryIt);
      onActivate(tryIt, () => {
        const tidy = tidyRule(rule);
        if (!tidy) new Notice('Say when the rule fires, and what it sets.');
        else new RunRuleModal(this.plugin, this.feature, tidy).open();
      });
      const remove = foot.createSpan({ cls: 'clickable-icon dr-rule-remove' });
      setIcon(remove, 'trash-2');
      asButton(remove, 'Delete this rule');
      onActivate(remove, () => {
        this.rules.splice(i, 1);
        this.renderRules();
      });
    });
  }

  async save() {
    this.plugin.settings.propertyRules = this.rules.map(tidyRule).filter(Boolean);
    await this.plugin.saveData(this.plugin.settings);
    if (this.feature) this.feature.states = null;
    this.close();
    new Notice(`${bulkCount(this.plugin.settings.propertyRules.length, 'rule')} saved.`);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** What a rule would do to the notes it holds for now, shown before it's run. */
export class RunRuleModal extends Modal {
  constructor(plugin, feature, rule) {
    super(plugin.app);
    this.plugin = plugin;
    this.feature = feature;
    this.rule = rule;
  }

  onOpen() {
    this.titleEl.setText(this.rule.name || ruleName(this.rule));
    const found = this.feature.planNow(this.rule);
    if (!found.length) {
      this.contentEl.createDiv({ cls: 'dr-empty', text: 'No note it holds for now would change.' });
      return;
    }
    this.contentEl.createDiv({ cls: 'dr-rules-state', text: `It would change ${bulkCount(found.length, 'note')}:` });
    const list = this.contentEl.createDiv({ cls: 'dr-rule-preview' });
    found.slice(0, 50).forEach(({ file, plan }) => {
      const row = list.createDiv({ cls: 'dr-rule-preview-row' });
      row.createSpan({ cls: 'dr-rule-preview-name', text: file.basename });
      row.createSpan({ cls: 'dr-rule-preview-set', text: plan.map((p) => `${p.key}: ${Array.isArray(p.value) ? p.value.join(', ') : p.value}`).join(', ') });
    });
    if (found.length > 50) list.createDiv({ cls: 'dr-bulk-more', text: `and ${found.length - 50} more` });
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { cls: 'mod-cta', text: `Set in ${bulkCount(found.length, 'note')}` }).addEventListener('click', async () => {
      this.close();
      await this.feature.runNow(this.rule, found);
    });
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}
