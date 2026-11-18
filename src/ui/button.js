/* ------------------------------------------------------------------ */
/* Buttons: the icon button and the text button                        */
/* ------------------------------------------------------------------ */

import { asButton, el, flag, glyph, onActivate } from '../core/dom.js';

/**
 * An icon button: the plugin's control. { glyph, label, run, pressed,
 * disabled, busy }. `pressed` given (true or false) makes it one that stays on.
 */
export function iconButton(parent, opts) {
  const button = el(parent, 'div', 'dr-icon-button');
  asButton(button, opts.label, opts.run);
  glyph(button, opts.glyph);
  if (opts.pressed !== undefined) button.setAttribute('aria-pressed', String(!!opts.pressed));
  flag(button, 'aria-disabled', opts.disabled);
  flag(button, 'aria-busy', opts.busy);
  return button;
}

/** A link: an underlined word that goes somewhere (a folder, a page, the next note). Content, not a control. No `run`: it goes nowhere, grey. */
export function link(parent, text, run) {
  const node = el(parent, 'span', 'dr-link', text);
  node.setAttribute('role', 'link');
  if (run) {
    node.setAttribute('tabindex', '0');
    onActivate(node, run);
  } else node.setAttribute('aria-disabled', 'true');
  return node;
}

/** A text button: only where a glyph would not say it. { text, run, kind: 'primary' | 'danger', disabled, busy (its text says what it is doing: "Moving…") }. */
export function textButton(parent, opts) {
  const button = el(parent, 'div', `dr-button${opts.kind ? ` is-${opts.kind}` : ''}`);
  asButton(button, null, opts.run);
  el(button, 'span', '', opts.text);
  flag(button, 'aria-disabled', opts.disabled);
  flag(button, 'aria-busy', opts.busy);
  return button;
}
