/* ------------------------------------------------------------------ */
/* Property tools: a change made everywhere a property is used         */
/*                                                                     */
/* Rename a property, merge two, rename a tag or a value, clean up a   */
/* property's values, change its type, find the notes that lack it,    */
/* add or remove properties in a folder, and a folder's defaults for   */
/* the notes made in it. Each says what would change, asks, and is one */
/* Undo (tools/bulk.js).                                               */
/* ------------------------------------------------------------------ */

import { Notice, TFile } from 'obsidian';
import { Feature } from '../core/feature.js';
import { keyOf, namesIn, noteProps, propOf, valuesOf } from '../core/notes.js';
import { choose, chooseFolder } from '../ui/choose.js';
import { field } from '../ui/field.js';
import { Sheet, ask } from '../ui/sheet.js';
import { Bulk, FRONTMATTER, VALUE_TYPES, joinValues, renameKey, renameTagInText, replaceValue, retype } from './bulk.js';

/** Every property name in use, most used first: [[name, count]]. */
export const propertyNames = (plugin, files) => namesIn(plugin.app, files || plugin.index.markdown());

/** The values a property takes, most used first: [[value, count]]. */
export const propertyValues = (plugin, key) => plugin.index.values(key);

/** Values that are one value written several ways (capitals, spaces round it): Map(the way most used → the other ways). */
export function valueVariants(values) {
  const groups = new Map();
  values.forEach(([value, n]) => {
    const key = value.trim().toLowerCase();
    groups.set(key, (groups.get(key) || []).concat([[value, n]]));
  });
  const out = new Map();
  groups.forEach((ways) => {
    if (ways.length < 2 && ways[0][0] === ways[0][0].trim()) return;
    const best = ways.slice().sort((a, b) => b[1] - a[1])[0][0].trim();
    const others = ways.map((w) => w[0]).filter((w) => w !== best);
    if (others.length) out.set(best, others);
  });
  return out;
}

/** A folder's defaults as { key: value }, whichever way they were kept ([{ key, value }] or an object). */
export function defaultsOf(settings, folderPath) {
  const kept = (settings.folderDefaults || {})[folderPath];
  if (Array.isArray(kept)) return Object.fromEntries(kept.filter((p) => p && p.key).map((p) => [p.key, p.value === undefined ? '' : p.value]));
  return kept && typeof kept === 'object' ? Object.assign({}, kept) : {};
}

export class PropertyTools extends Feature {
  constructor(plugin) {
    super(plugin);
    this.bulk = new Bulk(plugin);
  }

  enable() {
    // A note made in a folder with defaults is given them, once it exists and is still empty of properties.
    this.listen(this.app.vault, 'create', (file) => {
      if (!(file instanceof TFile) || file.extension !== 'md' || !file.parent) return;
      const defaults = defaultsOf(this.settings, file.parent.path);
      if (!Object.keys(defaults).length) return;
      setTimeout(() => {
        if (this.on && !Object.keys(this.plugin.notes.props(file)).length) this.plugin.notes.write(file, (fm) => Object.assign(fm, defaults), { failure: false });
      }, 0);
    });
  }

  notes(folder) {
    return folder ? this.plugin.index.markdown().filter((f) => f.path.startsWith(`${folder.path}/`)) : this.plugin.index.markdown();
  }

  having(key, files) {
    return (files || this.notes()).filter((f) => propOf(noteProps(this.app, f), key) !== undefined);
  }

  chooseKey(placeholder, files) {
    return choose(this.app, propertyNames(this.plugin, files), { placeholder, name: ([k, n]) => `${k}  (${n})` }).then((picked) => (picked ? picked[0] : null));
  }

  async renameProperty(from, to) {
    const key = from || (await this.chooseKey('Rename which property?'));
    if (!key) return 0;
    const name = to || (await ask(this.app, { title: `Rename ${key} everywhere`, value: key, action: 'Rename' }));
    if (!name || name === key) return 0;
    const files = this.having(key);
    if (!to && !(await this.bulk.ask(`Rename ${key} to ${name}`, files, `${key} becomes ${name}`))) return 0;
    const n = await this.bulk.run(files, `${key} renamed to ${name}`, (fm) => void renameKey(fm, key, name));
    this.app.workspace.trigger('design-redux:property-renamed', key, name);
    return n;
  }

  async mergeProperties(from, into) {
    const a = from || (await this.chooseKey('Merge which property…'));
    const b = a ? into || (await this.chooseKey(`…into which? ${a} goes.`)) : null;
    if (!a || !b || a === b) return 0;
    const files = this.having(a);
    if (!into && !(await this.bulk.ask(`Merge ${a} into ${b}`, files, `${a}’s values join ${b}’s and ${a} goes`))) return 0;
    return this.bulk.run(files, `${a} merged into ${b}`, (fm) => {
      const ka = keyOf(fm, a);
      const kb = keyOf(fm, b) || b;
      if (!ka) return;
      fm[kb] = joinValues(fm[kb], fm[ka]);
      delete fm[ka];
    });
  }

  async renameTag(from, to) {
    const old = (from || (await ask(this.app, { title: 'Rename a tag everywhere', label: 'The tag', placeholder: 'draft', action: 'Next' })) || '').replace(/^#/, '');
    const name = old ? (to || (await ask(this.app, { title: `Rename #${old}`, value: old, action: 'Rename' })) || '').replace(/^#/, '') : '';
    if (!old || !name || old === name) return 0;
    const files = this.notes();
    const inProps = (fm) => ['tags', 'tag'].forEach((key) => {
      const k = keyOf(fm, key);
      if (!k) return;
      const list = valuesOf(fm[k]).map((t) => { const bare = t.replace(/^#/, ''); return bare.toLowerCase() === old.toLowerCase() ? name : bare.toLowerCase().startsWith(`${old.toLowerCase()}/`) ? name + bare.slice(old.length) : t; });
      if (list.join('\n') !== valuesOf(fm[k]).join('\n')) fm[k] = Array.isArray(fm[k]) ? list : list[0];
    });
    return this.bulk.run(files, `#${old} renamed to #${name}`, inProps, (text) => {
      const fm = FRONTMATTER.exec(text);
      const head = fm ? fm[0] : '';
      return head + renameTagInText(text.slice(head.length), old, name);
    });
  }

  async renameValue(key, from, to) {
    const k = key || (await this.chooseKey('A value of which property?'));
    if (!k) return 0;
    const picked = from !== undefined ? from : await choose(this.app, propertyValues(this.plugin, k), { placeholder: `Which value of ${k}?`, name: ([v, n]) => `${v}  (${n})` }).then((p) => (p ? p[0] : null));
    if (picked == null) return 0;
    const next = to !== undefined ? to : await ask(this.app, { title: `Rename “${picked}”`, value: picked, action: 'Rename' });
    if (next == null || next === picked) return 0;
    return this.bulk.run(this.having(k), `${k}: “${picked}” renamed to “${next}”`, (fm) => void replaceValue(fm, k, picked, next));
  }

  async cleanValues(key) {
    const k = key || (await this.chooseKey('Clean up which property’s values?'));
    if (!k) return 0;
    const variants = valueVariants(propertyValues(this.plugin, k));
    if (!variants.size) return void new Notice(`${k}’s values are already written one way each.`), 0;
    const said = Array.from(variants.entries()).map(([best, others]) => `${others.join(', ')} → ${best}`).join('; ');
    if (!key && !(await this.bulk.ask(`Clean up ${k}`, this.having(k), said))) return 0;
    return this.bulk.run(this.having(k), `${k} cleaned up`, (fm) => variants.forEach((others, best) => others.forEach((o) => {
      const kk = keyOf(fm, k);
      const exact = (v) => String(v) === o;
      if (!kk) return;
      if (Array.isArray(fm[kk])) { if (fm[kk].some(exact)) fm[kk] = fm[kk].map((v) => (exact(v) ? best : v)).filter((v, i, all) => all.indexOf(v) === i); }
      else if (exact(fm[kk])) fm[kk] = best;
    })));
  }

  async changeType(key, type) {
    const k = key || (await this.chooseKey('Change which property’s type?'));
    const t = k ? type || (await choose(this.app, Object.keys(VALUE_TYPES), { placeholder: `${k} becomes…`, name: (id) => VALUE_TYPES[id] })) : null;
    if (!k || !t) return 0;
    const files = this.having(k);
    const unreadable = files.filter((f) => retype(propOf(noteProps(this.app, f), k), t) === undefined);
    const n = await this.bulk.run(files, `${k} made ${VALUE_TYPES[t].toLowerCase()}`, (fm) => {
      const kk = keyOf(fm, k);
      const next = kk ? retype(fm[kk], t) : undefined;
      if (next !== undefined) fm[kk] = next;
    });
    // Obsidian keeps a property's type of its own; told too, where it lets us.
    const types = this.app.metadataTypeManager;
    if (types && typeof types.setType === 'function') types.setType(k, t);
    if (unreadable.length) new Notice(`${unreadable.length} could not be read as ${VALUE_TYPES[t].toLowerCase()} and were left as they are.`);
    return n;
  }

  async findMissing(key) {
    const k = key || (await this.chooseKey('Notes missing which property?'));
    if (!k) return null;
    await this.plugin.showFiltered({ prop: `!${k}` }, `Missing ${k}`);
    return this.notes().filter((f) => propOf(noteProps(this.app, f), k) === undefined);
  }

  /** Asks for "key: value" lines. Resolves { key: value }, or null. */
  askProps(title, text, start) {
    return new Promise((resolve) => {
      let out = null;
      let box = null;
      const sheet = new Sheet(this.app, {
        title,
        text,
        build: (matter) => { box = field(matter, { label: 'Properties', value: start || '', placeholder: 'status: draft, course: Logic' }); },
        actions: [{ text: 'Cancel' }, { text: 'OK', run: () => {
          out = {};
          box.drInput.value.split(',').map((s) => s.trim()).filter(Boolean).forEach((part) => { const at = part.indexOf(':'); out[(at < 0 ? part : part.slice(0, at)).trim()] = at < 0 ? '' : part.slice(at + 1).trim(); });
          if (!Object.keys(out).length) return void box.drSay('Name at least one property.', true), false;
          return true;
        } }],
      });
      sheet.closed = () => resolve(out);
      sheet.open();
    });
  }

  async addToFolder(folder, props) {
    const dir = folder || (await chooseFolder(this.plugin, { placeholder: 'Add properties to the notes in…' }));
    const add = dir ? props || (await this.askProps(`Add properties in ${dir.path === '/' ? 'the vault' : dir.name}`, 'A note that already has one keeps its own value.')) : null;
    if (!dir || !add) return 0;
    return this.bulk.run(this.notes(dir.path === '/' ? null : dir), `Properties added in ${dir.name || 'the vault'}`, (fm) => Object.keys(add).forEach((k) => { if (keyOf(fm, k) === undefined) fm[k] = add[k]; }));
  }

  async removeFromFolder(folder, keys) {
    const dir = folder || (await chooseFolder(this.plugin, { placeholder: 'Remove properties from the notes in…' }));
    const files = dir ? this.notes(dir.path === '/' ? null : dir) : [];
    const gone = dir ? keys || [await this.chooseKey('Remove which property?', files)].filter(Boolean) : [];
    if (!dir || !gone.length) return 0;
    const touched = files.filter((f) => gone.some((k) => propOf(noteProps(this.app, f), k) !== undefined));
    if (!keys && !(await this.bulk.ask(`Remove ${gone.join(', ')}`, touched, `${gone.join(', ')} is removed`))) return 0;
    return this.bulk.run(touched, `${gone.join(', ')} removed in ${dir.name || 'the vault'}`, (fm) => gone.forEach((g) => Object.keys(fm).filter((k) => k.toLowerCase() === g.toLowerCase()).forEach((k) => delete fm[k])));
  }

  async folderDefaults(folder, props) {
    const now = defaultsOf(this.settings, folder.path);
    const next = props || (await this.askProps(`Defaults for ${folder.name}`, 'A note made in this folder starts with these.', Object.keys(now).map((k) => `${k}: ${now[k]}`).join(', ')));
    if (!next) return false;
    (this.settings.folderDefaults || (this.settings.folderDefaults = {}))[folder.path] = Object.keys(next).map((key) => ({ key, value: next[key] }));
    await this.plugin.saveSettings();
    return true;
  }

  actions() {
    return [
      { id: 'rename-property-everywhere', name: 'Rename a property everywhere…', run: () => this.renameProperty() },
      { id: 'merge-properties', name: 'Merge properties…', run: () => this.mergeProperties() },
      { id: 'rename-tag-everywhere', name: 'Rename a tag everywhere…', run: () => this.renameTag() },
      { id: 'rename-value-everywhere', name: 'Rename a property value everywhere…', run: () => this.renameValue() },
      { id: 'clean-up-property-values', name: 'Clean up a property’s values…', run: () => this.cleanValues() },
      { id: 'change-property-type', name: 'Change a property’s type…', run: () => this.changeType() },
      { id: 'find-missing-properties', name: 'Find notes missing a property…', run: () => this.findMissing() },
      { id: 'add-properties-to-folders', name: 'Add properties to folders…', run: () => this.addToFolder() },
      { id: 'remove-properties-from-folders', name: 'Remove properties from folders…', run: () => this.removeFromFolder() },
      { id: 'folder-default-properties', name: 'Default properties for this folder…', on: 'folder', menu: 'Default properties…', run: (ctx) => this.folderDefaults(ctx.folder) },
      { id: 'undo-bulk-change', name: 'Undo the last bulk change', when: () => !!this.bulk.last, run: () => this.bulk.undo() },
    ];
  }
}
PropertyTools.title = 'Property tools';
PropertyTools.section = 'Tools';
PropertyTools.about = 'Rename, merge, clean up and retype properties everywhere, each in one Undo.';
