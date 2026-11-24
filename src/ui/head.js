/* ------------------------------------------------------------------ */
/* The head row: a label and the few icon buttons a surface needs      */
/* ------------------------------------------------------------------ */

import { asButton, el } from '../core/dom.js';
import { iconButton } from './button.js';

/**
 * { label, run (the label pressed: it goes where it names), link: { text,
 * run } (an underlined word at the end, where a word says it better than a
 * glyph), buttons: [what iconButton takes] }. Returns the row; what is
 * appended after (the zoom control) follows the buttons.
 */
export function headRow(parent, opts) {
  const node = el(parent, 'div', 'dr-head');
  const label = el(node, 'span', 'dr-head-name dr-clip', opts.label);
  if (opts.run) asButton(label, null, opts.run);
  if (opts.link) asButton(el(node, 'span', 'dr-link dr-head-link', opts.link.text), null, opts.link.run);
  (opts.buttons || []).forEach((b) => iconButton(node, b));
  return node;
}
