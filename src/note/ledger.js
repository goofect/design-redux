/* ------------------------------------------------------------------ */
/* The ledger: a note's properties as rows                             */
/*                                                                     */
/* A spec sheet under the note's title: each property a row, its name  */
/* grey in a fixed column and its value in ink, parted by space, like  */
/* the folder page's list. A value is edited where it stands           */
/* (Enter writes it, with an Undo; Escape leaves it); a row's menu     */
/* renames or removes it; a value the folder's schema finds wrong is   */
/* red, the reason after it. No heading, no buttons, no icons: a       */
/* property is added where they stand, a row at the ledger's foot that */
/* its command or a row's menu opens, name and value typed in place.   */
/* Properties copy and paste as text does: rows selected, or one       */
/* focused, and ⌘C; ⌘V on a row, or several lines pasted into a field. */
/* They travel as "name: value" lines. While a value is typed, the     */
/* values it may take are offered: its folder's schema's, else those   */
/* used for it across the vault, most used first.                      */
/* ------------------------------------------------------------------ */

import { Keymap, Menu, parseYaml, stringifyYaml } from 'obsidian';
import { clear, clipboardText, copyText, el } from '../core/dom.js';
import { copyValue, keyOf, linkOf, namesIn, setInOrder, valueShown, valuesOf } from '../core/notes.js';
import { counted, listOf } from '../core/text.js';
import { link } from '../ui/button.js';
import { suggestInto } from '../ui/choose.js';
import { textInput } from '../ui/field.js';
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

/** The properties listed first: those set for the note's folder (or the nearest above it that has some), else everywhere's. */
export function primaryProps(settings, file) {
  const views = settings.panelFolderViews || {};
  for (let dir = file.parent; dir && dir.path !== '/'; dir = dir.parent) {
    const view = views[dir.path];
    if (view && typeof view.main === 'string') return view.main;
  }
  return settings.panelPrimaryProps;
}

/** Writes one property, with an Undo that says what was done to it. */
export const setValue = (plugin, file, key, value, done = 'changed') => plugin.notes.write(file, (fm) => (fm[key] = value), { undo: `${key} ${done}.` });

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

/** Takes several lines of properties pasted into an input, as `run(props)`; anything else pastes as text. */
function onPastedProps(input, run) {
  input.addEventListener('paste', (e) => {
    const props = e.clipboardData ? pastedProps(e.clipboardData.getData('text/plain')) : null;
    if (!props) return;
    e.preventDefault();
    run(props);
  });
}

/** Pastes properties onto a note, as text is pasted: one it has gives way to the pasted one. One Undo. */
export function pasteProps(plugin, file, props) {
  return plugin.notes.write(file, (fm) => Object.assign(fm, copyValue(props)), { undo: `${counted(Object.keys(props).length, 'property', 'properties')} pasted.` });
}

/** Asks for a property in a sheet, "name" or "name: value", and adds it: where the note shows no ledger to add it in. Properties pasted into its field, several lines of them, are added at once. */
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
  return setValue(plugin, file, key, value, 'added');
}

/**
 * Adds a property where the properties stand: a new row at the foot of the
 * ledger in `host` (made if the note has none), its name and value typed in
 * place. Names the vault uses are offered, then that property's values. Enter
 * in the name goes to the value, Enter there writes it (one Undo); "name:
 * value" in the name writes at once. Escape, or leaving it with no name, takes
 * it away. Several lines of properties pasted into it are added at once.
 */
export function addRow(plugin, host, file) {
  const open = host.querySelector('.dr-prop-new input');
  if (open) return void open.focus();
  let list = host.querySelector('.dr-ledger');
  if (!list) {
    list = rows(host);
    list.classList.add('dr-ledger');
  }
  const node = el(list, 'div', 'dr-prop dr-prop-new');
  // Each a field as the plugin draws one: a line under its text, the focus outline round it while typed in.
  const name = textInput(node, { cls: 'dr-prop-name dr-field-box', label: 'Property name', placeholder: 'name' });
  const value = textInput(node, { cls: 'dr-prop-value dr-field-box', label: 'Value', placeholder: 'value' });
  const why = el(node, 'span', 'dr-prop-why');
  const has = () => plugin.notes.props(file);
  const stops = [
    suggestInto(plugin.app, name, { words: () => namesIn(plugin.app, plugin.index.markdown()).filter(([k]) => !(k in has())).map(([k]) => ({ text: k, shown: k })), picked: () => value.focus() }),
    suggestInto(plugin.app, value, { words: () => valueWords(plugin, file, name.value.trim()) }),
  ];
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    stops.forEach((stop) => stop());
    node.remove();
    if (!list.querySelector('.dr-prop')) list.remove();
  };
  // `leaving`: focus went elsewhere, so a name the note has already is dropped rather than asked again.
  const commit = async (leaving) => {
    const typed = name.value.includes(':') && !value.value.trim() ? parseAdded(name.value) : { key: name.value.trim(), value: value.value.trim() };
    if (!typed.key) return close();
    if (typed.key in has()) {
      if (leaving) return close();
      node.setAttribute('aria-invalid', 'true');
      why.textContent = 'This note already has it.';
      return void name.focus();
    }
    close();
    await setValue(plugin, file, typed.key, typed.value, 'added');
  };
  [name, value].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (input === name && name.value.trim() && !name.value.includes(':')) value.focus();
        else commit(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      e.stopPropagation();
    });
    input.addEventListener('input', () => {
      node.removeAttribute('aria-invalid');
      why.textContent = '';
    });
    onPastedProps(input, (props) => {
      close();
      return pasteProps(plugin, file, props);
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });
  node.addEventListener('focusout', (e) => {
    if (!e.relatedTarget || !node.contains(e.relatedTarget)) setTimeout(() => !done && !node.contains(node.ownerDocument.activeElement) && commit(true), 0);
  });
  name.focus();
}

/** A property's own menu: rename it, remove it, add another in the ledger at `host` (or in a sheet). */
export function propertyMenu(plugin, file, key, host) {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle('Rename property…').setSection('action').onClick(async () => {
    const to = await ask(plugin.app, { title: `Rename ${key}`, value: key, action: 'Rename', check: (v) => (v !== key && v in plugin.notes.props(file) ? 'This note already has it.' : null) });
    if (!to || to === key) return;
    await plugin.notes.write(file, (fm) => setInOrder(fm, Object.keys(fm).map((k) => [k === key ? to : k, fm[k]])), { undo: `${key} renamed to ${to}.` });
  }));
  menu.addItem((i) => i.setTitle('Add a property').setSection('action').onClick(() => (host ? addRow(plugin, host, file) : addProperty(plugin, file))));
  menu.addItem((i) => i.setTitle('Remove property').setSection('danger').onClick(() => plugin.notes.write(file, (fm) => delete fm[key], { undo: `${key} removed.` })));
  return menu;
}

/** A note's property keys, those listed first at the top. */
export function ledgerKeys(plugin, file) {
  const props = plugin.notes.props(file);
  const all = Object.keys(props);
  const first = listOf(primaryProps(plugin.settings, file)).map((k) => keyOf(props, k)).filter(Boolean);
  return first.concat(all.filter((k) => !first.includes(k)));
}

/** One property's row: edited where it stands, a menu of its own, red where its folder's schema says it is wrong. */
export function ledgerRow(plugin, host, file, key, value, redraw) {
  const wrong = plugin.notes.check(file, key, value);
  const node = propRow(host, { name: key, value: valueShown(value), invalid: wrong, run: () => selecting(node) || editValue(plugin, node, file, key, value, redraw) });
  node.dataset.key = key;
  // A link in the value is a link: pressed, or Enter on it, it opens what it links to (with Cmd, in a new tab); the
  // rest of the row still edits the value.
  const parts = valuesOf(value);
  if (parts.some(linkOf)) {
    const cell = clear(node.querySelector('.dr-prop-value'));
    parts.forEach((v, i) => {
      if (i) cell.appendChild(cell.ownerDocument.createTextNode(', '));
      const to = linkOf(v);
      if (!to) return void cell.appendChild(cell.ownerDocument.createTextNode(v));
      link(cell, to.shown, (e) => {
        e.stopPropagation();
        plugin.app.workspace.openLinkText(to.to, file.path, Keymap.isModEvent(e));
      });
    });
  }
  // As text is copied and pasted: on a row, ⌘C copies it, ⌘V pastes properties onto the note.
  node.addEventListener('keydown', async (e) => {
    if (e.target !== node || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'c' && k !== 'v') return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'c') return void (await copyText(propsText({ [key]: value })));
    const props = readProps(await clipboardText());
    if (props) await pasteProps(plugin, file, props);
  });
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    propertyMenu(plugin, file, key, host.parentElement).showAtMouseEvent(e);
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
  const allowed = plugin.notes.allowed(file, key);
  return (allowed || plugin.index.values(key).map(([v]) => v)).map((text) => ({ text, shown: valueShown(text) }));
}

/** Edits a value where it stands: Enter (or leaving the field) writes it, Escape leaves it as it was; a value offered and taken is written at once, or, in a list, added to it. */
function editValue(plugin, node, file, key, was, redraw) {
  const cell = node.querySelector('.dr-prop-value');
  if (!cell || cell.querySelector('input')) return;
  const input = textInput(clear(cell), { label: key, value: valueText(was) });
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
  onPastedProps(input, async (props) => {
    done = true;
    stop();
    await pasteProps(plugin, file, props);
    redraw();
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.focus();
  input.select();
}
