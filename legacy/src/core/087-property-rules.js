/* ------------------------------------------------------------------ */
/* Property rules                                                      */
/*                                                                    */
/* "When a note comes into a folder, gets a tag, or a property becomes */
/* a value, set these properties." A rule fires on the change, not on  */
/* the state — a note already in the folder isn't set again when it's */
/* edited — and sets a property only where it's empty, unless it's     */
/* told to replace it. What a run would do is planned first, so it can */
/* be shown before anything's written. Pure.                           */
/* ------------------------------------------------------------------ */

import { fmGet } from './045-helpers-properties.js';
import { emptyValue, plainOf } from './086-property-schema.js';

export const RULE_KINDS = ['folder', 'tag', 'property'];

/** A rule as kept, or null for one that can't fire or sets nothing. */
export function tidyRule(r) {
  if (!r || !RULE_KINDS.includes(r.when && r.when.kind)) return null;
  const w = r.when;
  const when = { kind: w.kind };
  if (w.kind === 'folder') when.folder = String(w.folder || '').replace(/^\/+|\/+$/g, '');
  if (w.kind === 'tag') when.tag = String(w.tag || '').replace(/^#/, '').trim().toLowerCase();
  if (w.kind === 'property') {
    when.key = String(w.key || '').trim();
    when.value = w.value === undefined || w.value === null ? '' : String(w.value).trim();
  }
  if ((w.kind === 'folder' && !when.folder) || (w.kind === 'tag' && !when.tag) || (w.kind === 'property' && !when.key)) return null;
  const set = (Array.isArray(r.set) ? r.set : []).filter((s) => s && typeof s.key === 'string' && s.key.trim()).map((s) => ({ key: s.key.trim(), value: s.value === undefined ? null : s.value }));
  if (!set.length) return null;
  const out = { id: String(r.id || ''), name: String(r.name || '').trim() || ruleName({ when, set }), on: r.on !== false, when, set };
  if (r.replace) out.replace = true;
  return out;
}

/** A rule said plainly: When a note comes into Law, set status. */
export function ruleName(r) {
  const w = r.when || {};
  const what = w.kind === 'folder' ? `comes into ${w.folder}` : w.kind === 'tag' ? `gets #${w.tag}` : w.value ? `has ${w.key} set to ${w.value}` : `gets a ${w.key}`;
  return `When a note ${what}, set ${(r.set || []).map((s) => s.key).join(', ')}`;
}

/** Whether a path is in a folder, at any depth. */
function inFolder(path, folder) {
  return typeof path === 'string' && (folder === '' || path.startsWith(folder + '/'));
}

/** What a rule looks at in a note: its tags, lower-cased and without #, and the properties rules name. */
export function ruleState(tags, fm, keys) {
  const props = {};
  (keys || []).forEach((k) => {
    const v = fmGet(fm || {}, k);
    if (v !== undefined) props[k.toLowerCase()] = v;
  });
  return { tags: (tags || []).map((t) => String(t).replace(/^#/, '').toLowerCase()), props };
}

/** The properties a set of rules looks at. */
export function ruleKeys(rules) {
  return Array.from(new Set((rules || []).filter((r) => r && r.when && r.when.kind === 'property').map((r) => r.when.key)));
}

/** Whether what a rule looks for is true of a note now: for running it over the notes already there. */
export function ruleHolds(rule, path, state) {
  return holds(rule, path, state);
}

function holds(rule, path, state) {
  const w = rule.when;
  if (w.kind === 'folder') return inFolder(path, w.folder);
  if (!state) return false;
  if (w.kind === 'tag') return state.tags.some((t) => t === w.tag || t.startsWith(w.tag + '/'));
  const v = state.props[w.key.toLowerCase()];
  if (!w.value) return !emptyValue(v);
  return (Array.isArray(v) ? v : [v]).some((x) => x !== null && x !== undefined && plainOf(x) === plainOf(w.value));
}

/**
 * Whether a change fires a rule: what it looks for true after the change
 * and not before. `change` is { path, from, before, after }: the note's
 * path now and before (a move), its rule state before (null for a note
 * just made) and after.
 */
export function ruleFires(rule, change) {
  if (!rule || rule.on === false) return false;
  const was = change.before === null && change.from === undefined ? false : holds(rule, change.from || change.path, change.before);
  return !was && holds(rule, change.path, change.after);
}

/** What one rule would set in a note: [{ key, value }], each only where it's empty — or, told to replace, where it's otherwise. */
export function ruleChanges(rule, fm) {
  return rule.set.filter((s) => {
    const have = fmGet(fm || {}, s.key);
    if (rule.replace) return JSON.stringify(have === undefined ? null : have) !== JSON.stringify(s.value);
    return emptyValue(have) && !emptyValue(s.value);
  });
}

/**
 * What a change to a note sets, by every rule it fires: [{ rule, key,
 * value }], the first rule to name a property deciding it. Planned on
 * the note as it is, once: what the run then writes fires no rule of
 * its own.
 */
export function planRules(rules, change, fm) {
  const out = [];
  const taken = new Set();
  (rules || []).forEach((rule) => {
    if (!ruleFires(rule, change)) return;
    ruleChanges(rule, fm).forEach((s) => {
      const k = s.key.toLowerCase();
      if (taken.has(k)) return;
      taken.add(k);
      out.push({ rule, key: s.key, value: s.value });
    });
  });
  return out;
}

/** A plan written into a note's frontmatter, under the name the note has each by. */
export function applyPlan(fm, plan) {
  plan.forEach(({ key, value }) => {
    const want = key.toLowerCase();
    const name = Object.keys(fm).find((k) => k.toLowerCase() === want) || key;
    fm[name] = JSON.parse(JSON.stringify(value));
  });
}
