/* ------------------------------------------------------------------ */
/* The say-so block: what a surface shows in place of its contents     */
/* (docs/design-language.md, "Say-so")                                 */
/* ------------------------------------------------------------------ */

import { el, glyph } from '../core/dom.js';
import { textButton } from './button.js';

/** { glyph, label, text, button: { text, run }, error }. Nothing here, working, or something wrong. */
export function sayso(parent, opts) {
  const node = el(parent, 'div', `dr-state${opts.error ? ' is-error' : ''}`);
  node.setAttribute('role', opts.error ? 'alert' : 'status');
  glyph(node, opts.glyph || (opts.error ? 'alert' : 'empty'));
  el(node, 'span', 'dr-state-label dr-text', opts.label);
  if (opts.text) el(node, 'span', 'dr-text is-running', opts.text);
  if (opts.button) textButton(node, opts.button);
  return node;
}
