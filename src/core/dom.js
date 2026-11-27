/* ------------------------------------------------------------------ */
/* DOM: the few moves every screen makes                               */
/*                                                                     */
/* Elements are made with createElement and filled with textContent,   */
/* never innerHTML. State goes on as an ARIA attribute (`flag`), which */
/* is what the styles read. A glyph is one of the plugin's own, drawn  */
/* through Obsidian's setIcon. Text goes to and from the clipboard     */
/* here, saying so when it can't be reached.                           */
/* ------------------------------------------------------------------ */

import { Notice, setIcon } from 'obsidian';

/** A new element, appended to `parent` (or made in a document, when one is given). */
export function el(parent, tag, cls, text) {
  const doc = parent.ownerDocument || parent;
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  if (parent.nodeType === 1) parent.appendChild(node);
  return node;
}

/** Empties an element. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Sets or takes away an attribute: `flag(row, 'aria-selected', picked)`. */
export function flag(node, name, on, value = 'true') {
  if (on) node.setAttribute(name, value === true ? 'true' : value);
  else node.removeAttribute(name);
  return node;
}

/** Runs `run` on a click, and on Enter or Space when the element has the keyboard. */
export function onActivate(node, run) {
  node.addEventListener('click', (e) => {
    if (node.getAttribute('aria-disabled') === 'true') return;
    run(e);
  });
  node.addEventListener('keydown', (e) => {
    if (e.target !== node || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    if (node.getAttribute('aria-disabled') !== 'true') run(e);
  });
  return node;
}

/** Makes an element a button to the keyboard and to a screen reader; its label is also its tooltip. */
export function asButton(node, label, run) {
  node.setAttribute('role', node.getAttribute('role') || 'button');
  node.setAttribute('tabindex', node.getAttribute('tabindex') || '0');
  if (label) node.setAttribute('aria-label', label);
  if (run) onActivate(node, run);
  return node;
}

/** One of the plugin's glyphs, appended to `parent`. */
export function glyph(parent, name) {
  const holder = parent.ownerDocument.createElement('span');
  setIcon(holder, `dr-${name}`);
  const svg = holder.firstElementChild;
  if (!svg) return null;
  svg.classList.add('dr-glyph');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-glyph', name);
  parent.appendChild(svg);
  return svg;
}

/** Puts text on the clipboard, and says `said` when given. Resolves whether it could. */
export async function copyText(text, said) {
  try {
    await navigator.clipboard.writeText(text);
    if (said) new Notice(said);
    return true;
  } catch (err) {
    new Notice('Could not reach the clipboard.');
    return false;
  }
}

/** The clipboard's text; '' when it can't be reached, which is said. */
export async function clipboardText() {
  try {
    return await navigator.clipboard.readText();
  } catch (err) {
    new Notice('Could not reach the clipboard.');
    return '';
  }
}

/**
 * Names a region for a screen reader without an aria-label: Obsidian draws a
 * tooltip for every aria-label under the pointer. The name is unseen text the
 * region points at instead, kept in `holder` (the region itself unless it is
 * emptied on each draw, or is a list, which holds only its items).
 */
let named = 0;
export function nameRegion(node, text, holder = node) {
  const label = el(holder, 'span', 'dr-unseen', text);
  label.id = `dr-region-name-${++named}`;
  node.setAttribute('aria-labelledby', label.id);
  return node;
}
