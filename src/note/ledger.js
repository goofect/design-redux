/* ------------------------------------------------------------------ */
/* The ledger: a note's properties as ruled rows                       */
/*                                                                     */
/* A spec sheet under the note's title: each property a row, its name  */
/* grey in a fixed column and its value in ink, a light rule under it, */
/* like the folder page's list. A value is edited where it stands      */
/* (Enter writes it, with an Undo; Escape leaves it); a row's menu     */
/* renames or removes it; a value the folder's schema finds wrong is   */
/* red, the reason after it. No heading, no buttons, no icons: a       */
/* property is added by its command. The panel draws the same rows.    */
/* ------------------------------------------------------------------ */

import { Menu } from 'obsidian';
import { clear } from '../core/dom.js';
import { valuesOf } from '../core/notes.js';
import { listOf } from '../core/text.js';
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

/** Asks for a new property's name and adds it, empty, to the note. */
export async function addProperty(plugin, file) {
  const key = await ask(plugin.app, { title: 'Add a property', label: 'Its name', placeholder: 'status', action: 'Add', check: (v) => (v in plugin.notes.props(file) ? 'This note already has it.' : null) });
  if (!key) return;
  await plugin.notes.write(file, (fm) => (fm[key] = ''), { undo: `${key} added.` });
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
  const node = propRow(host, { name: key, value: valueShown(value), invalid: wrong, run: () => editValue(plugin, node, file, key, value, redraw) });
  node.dataset.key = key;
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
  return list;
}

/** Edits a value where it stands: Enter (or leaving the field) writes it, Escape leaves it as it was. */
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
  const finish = async (write) => {
    if (done) return;
    done = true;
    if (write && input.value !== valueText(was)) await setValue(plugin, file, key, parseValue(input.value, was));
    redraw();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.focus();
  input.select();
}
