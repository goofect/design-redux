/* ------------------------------------------------------------------ */
/* The head row: a label and the few icon buttons a surface needs      */
/* ------------------------------------------------------------------ */

import { el } from '../core/dom.js';
import { iconButton } from './button.js';

/**
 * { label, text (the label is a name the person wrote, a note's: set in
 * the reading voice, not capitals), muted (quieter words after the label),
 * buttons: [what iconButton takes] }. Returns the row; what is
 * appended after (the zoom control) follows the buttons.
 */
export function headRow(parent, opts) {
  const node = el(parent, 'div', 'dr-head');
  const label = el(node, 'span', 'dr-head-name dr-clip', opts.label);
  if (opts.muted) {
    label.appendChild(node.ownerDocument.createTextNode(' '));
    el(label, 'span', 'dr-muted', opts.muted);
  }
  (opts.buttons || []).forEach((b) => iconButton(node, b));
  return node;
}
