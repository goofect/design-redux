/* ------------------------------------------------------------------ */
/* The say-so block: what a surface shows in place of its contents     */
/* ------------------------------------------------------------------ */

import { el } from '../core/dom.js';
import { textButton } from './button.js';

/** { label, text, button: { text, run }, error, busy }. A sentence in place of a screen's contents: nothing here, working (its words, grey), or something wrong (red, its words saying what). No glyph. */
export function sayso(parent, opts) {
  const node = el(parent, 'div', 'dr-state');
  node.setAttribute('role', opts.error ? 'alert' : 'status');
  if (opts.busy) node.setAttribute('aria-busy', 'true');
  el(node, 'span', 'dr-state-label dr-text', opts.label);
  if (opts.text) el(node, 'span', 'dr-text dr-running', opts.text);
  if (opts.button) textButton(node, opts.button);
  return node;
}
