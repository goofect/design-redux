/* ------------------------------------------------------------------ */
/* The ledger: a note's properties as ruled rows                       */
/*                                                                     */
/* A spec sheet under the note's title: each property a row, its name  */
/* grey in a fixed column and its value in ink, a light rule under it, */
/* like the folder page's list. A value is edited where it stands      */
/* (Enter writes it, with an Undo; Escape leaves it); a row's menu     */
/* renames or removes it; a value the folder's schema finds wrong is   */
/* red, the reason after it. No heading, no buttons, no icons: a       */
/* property is added by its command, as "name" or "name: value".      */
/* Properties copy and paste as text does: rows selected, or one       */
/* focused, and ⌘C; ⌘V on a row, or several lines pasted into a field. */
/* They travel as "name: value" lines. While a value is typed, the     */
/* values it may take are offered: its folder's schema's, else those   */
/* used for it across the vault, most used first.                      */
/* ------------------------------------------------------------------ */

import { Menu, Notice, parseYaml, stringifyYaml } from 'obsidian';
import { clear } from '../core/dom.js';
import { valuesOf } from '../core/notes.js';
import { counted, listOf } from '../core/text.js';
import { suggestInto } from '../ui/choose.js';
import { propRow, rows } from '../ui/row.js';
import { ask } from '../ui/sheet.js';

/** What was typed, as a value of the kind the property had: a list stays a list, a number a number. */
export function parseValue(text, was) {
  const t = String(text).trim();
  if (Array.isArray(was)) return t ? t.split(',').map((s) => s.trim()).filter(Boolean) : [];
  if (typeof was === 'number' && t !== '' && Number.isFinite(Number(t))) return Number(t);
  if (typeof was === 'boolean' && /^(true|false|yes|no)$/i.test(t)) return /^(true|yes)$/i.test(t);
  return t;
}

/** A value as the text it is edited as. */
export const valueText = (value) => valuesOf(value).join(', ');

/** A value as it is shown: a link as the name of what it links to. */
export const valueShown = (value) => valuesOf(value).map((v) => {
  const m = /^\s*\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]\s*$/.exec(v);
  return m ? (m[2] || m[1].split('/').pop()) : v;
}).join(', ');

/** The properties listed first: those set for the note's folder (or the nearest above it that has some), else everywhere's. */
export function primaryProps(settings, file) {
  const views = settings.panelFolderViews || {};
  for (let dir = file.parent; dir && dir.path !== '/'; dir = dir.parent) {
    const view = views[dir.path];
    if (view && typeof view.main === 'string') return view.main;
  }
  return settings.panelPrimaryProps;
}

export const setValue = (plugin, file, key, value) => plugin.notes.write(file, (fm) => (fm[key] = value), { undo: `${key} changed.` });

/** What was typed to add a property: "name", or "name: value". */
export function parseAdded(text) {
  const t = String(text).trim();
  const at = t.indexOf(':');
  return at < 0 ? { key: t, value: '' } : { key: t.slice(0, at).trim(), value: t.slice(at + 1).trim() };
}

/** Properties as the text they are copied as: "name: value" lines, as a note's own head has them. */
export const propsText = (props) => stringifyYaml(props);

/** Text read back as properties, { name: value }, or null when it is not any. */
export function readProps(text) {
  let props = null;
  try {
    props = parseYaml(String(text || ''));
  } catch (err) {
    props = null;
  }
  return props && typeof props === 'object' && !Array.isArray(props) && Object.keys(props).length ? props : null;
}

/** Several lines of properties, as pasted: what a paste into a field gives way to. One line stays text. */
const pastedProps = (text) => (/\n\s*\S/.test(String(text).trim()) ? readProps(text) : null);

/** Pastes properties onto a note, as text is pasted: one it has gives way to the pasted one. One Undo. */
export function pasteProps(plugin, file, props) {
  return plugin.notes.write(file, (fm) => Object.assign(fm, JSON.parse(JSON.stringify(props))), { undo: `${counted(Object.keys(props).length, 'property', 'properties')} pasted.` });
}

/** Asks for a property, "name" or "name: value", and adds it; properties pasted into its field, several lines of them, are added at once. */
export async function addProperty(plugin, file) {
  let pasted = null;
  const text = await ask(plugin.app, {
    title: 'Add a property',
    label: 'Its name, or name: value',
    placeholder: 'status: draft',
    action: 'Add',
    check: (v) => (!parseAdded(v).key ? 'It needs a name.' : parseAdded(v).key in plugin.notes.props(file) ? 'This note already has it.' : null),
    onPaste: (t) => !!(pasted = pastedProps(t)),
  });
  if (pasted) return pasteProps(plugin, file, pasted);
  if (!text) return null;
  const { key, value } = parseAdded(text);
  return plugin.notes.write(file, (fm) => (fm[key] = value), { undo: `${key} added.` });
}

/** A property's own menu: rename it, remove it. */
export function propertyMenu(plugin, file, key) {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle('Rename property…').setSection('action').onClick(async () => {
    const to = await ask(plugin.app, { title: `Rename ${key}`, value: key, action: 'Rename', check: (v) => (v !== key && v in plugin.notes.props(file) ? 'This note already has it.' : null) });
    if (!to || to === key) return;
    await plugin.notes.write(file, (fm) => {
      const entries = Object.keys(fm).map((k) => [k === key ? to : k, fm[k]]);
      Object.keys(fm).forEach((k) => delete fm[k]);
      entries.forEach(([k, v]) => (fm[k] = v));
    }, { undo: `${key} renamed to ${to}.` });
  }));
  menu.addItem((i) => i.setTitle('Add a property…').setSection('action').onClick(() => addProperty(plugin, file)));
  menu.addItem((i) => i.setTitle('Remove property').setSection('danger').onClick(() => plugin.notes.write(file, (fm) => delete fm[key], { undo: `${key} removed.` })));
  return menu;
}

/** A note's property keys, those listed first at the top. */
export function ledgerKeys(plugin, file) {
  const all = Object.keys(plugin.notes.props(file));
  const find = (k) => all.find((p) => p.toLowerCase() === k.toLowerCase());
  const first = listOf(primaryProps(plugin.settings, file)).map(find).filter(Boolean);
  return first.concat(all.filter((k) => !first.includes(k)));
}

/** One property's row: edited where it stands, a menu of its own, red where its folder's schema says it is wrong. */
export function ledgerRow(plugin, host, file, key, value, redraw) {
  const wrong = plugin.checkValue ? plugin.checkValue(file, key, value) : null;
  const node = propRow(host, { name: key, value: valueShown(value), invalid: wrong, run: () => selecting(node) || editValue(plugin, node, file, key, value, redraw) });
  node.dataset.key = key;
  // As text is copied and pasted: on a row, ⌘C copies it, ⌘V pastes properties onto the note.
  node.addEventListener('keydown', async (e) => {
    if (e.target !== node || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'c' && k !== 'v') return;
    e.preventDefault();
    e.stopPropagation();
    try {
      if (k === 'c') await navigator.clipboard.writeText(propsText({ [key]: value }));
      else {
        const props = readProps(await navigator.clipboard.readText());
        if (props) await pasteProps(plugin, file, props);
      }
    } catch (err) {
      new Notice('Could not reach the clipboard.');
    }
  });
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    propertyMenu(plugin, file, key).showAtMouseEvent(e);
  });
  return node;
}

/** The ledger: every property of the note as a ruled row, or nothing at all when it has none. */
export function drawLedger(plugin, host, file, redraw) {
  const keys = ledgerKeys(plugin, file);
  if (!keys.length) return null;
  const props = plugin.notes.props(file);
  const list = rows(host);
  list.classList.add('dr-ledger');
  keys.forEach((key) => ledgerRow(plugin, list, file, key, props[key], redraw));
  // Rows selected as text are copied as properties: "name: value", a line each.
  list.addEventListener('copy', (e) => {
    const sel = list.ownerDocument.getSelection();
    if (!sel || sel.isCollapsed || !e.clipboardData || (e.target.closest && e.target.closest('input'))) return;
    const picked = Array.from(list.querySelectorAll('.dr-prop')).filter((r) => Array.from({ length: sel.rangeCount }, (_, i) => sel.getRangeAt(i)).some((range) => range.intersectsNode(r))).map((r) => r.dataset.key);
    if (!picked.length) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', propsText(Object.fromEntries(picked.map((k) => [k, props[k]]))));
  });
  return list;
}

/** Whether text is being selected in a row, so a press there is not taken for an edit. */
function selecting(node) {
  const sel = node.ownerDocument.getSelection();
  return !!sel && !sel.isCollapsed && node.contains(sel.anchorNode);
}

/** The values offered while a property is typed: those its folder's schema allows, else those used across the vault. */
export function valueWords(plugin, file, key) {
  const allowed = plugin.allowedValues ? plugin.allowedValues(file, key) : null;
  return (allowed || plugin.index.values(key).map(([v]) => v)).map((text) => ({ text, shown: valueShown(text) }));
}

/** Edits a value where it stands: Enter (or leaving the field) writes it, Escape leaves it as it was; a value offered and taken is written at once, or, in a list, added to it. */
function editValue(plugin, node, file, key, was, redraw) {
  const cell = node.querySelector('.dr-prop-value');
  if (!cell || cell.querySelector('input')) return;
  const input = node.ownerDocument.createElement('input');
  input.className = 'dr-input';
  input.type = 'text';
  input.value = valueText(was);
  input.setAttribute('aria-label', key);
  clear(cell).appendChild(input);
  let done = false;
  const list = Array.isArray(was);
  const stop = suggestInto(plugin.app, input, { list, words: () => valueWords(plugin, file, key), picked: () => !list && finish(true) });
  const finish = async (write) => {
    if (done) return;
    done = true;
    stop();
    if (write && input.value !== valueText(was)) await setValue(plugin, file, key, parseValue(input.value, was));
    redraw();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  // Several lines of properties pasted here are pasted onto the note; anything else is the value's text.
  input.addEventListener('paste', async (e) => {
    const props = e.clipboardData ? pastedProps(e.clipboardData.getData('text/plain')) : null;
    if (!props) return;
    e.preventDefault();
    done = true;
    await pasteProps(plugin, file, props);
    redraw();
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.focus();
  input.select();
}
