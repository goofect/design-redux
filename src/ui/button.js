/* ------------------------------------------------------------------ */
/* Buttons: the icon button and the text button                        */
/* (docs/design-language.md, "Icon button", "Text button")             */
/* ------------------------------------------------------------------ */

import { asButton, el, flag, glyph } from '../core/dom.js';

/**
 * An icon button: the plugin's control. { glyph, label, run, pressed,
 * disabled, busy }. `pressed` given (true or false) makes it one that stays on.
 */
export function iconButton(parent, opts) {
  const button = el(parent, 'div', 'dr-icon-button');
  asButton(button, opts.label, opts.run);
  glyph(button, opts.busy ? 'wait' : opts.glyph);
  if (opts.pressed !== undefined) button.setAttribute('aria-pressed', String(!!opts.pressed));
  flag(button, 'aria-disabled', opts.disabled);
  flag(button, 'aria-busy', opts.busy);
  return button;
}

/** Turns an icon button that stays on, on or off. */
export function setPressed(button, on) {
  button.setAttribute('aria-pressed', String(!!on));
}

/** A text button: only where a glyph would not say it. { text, run, kind: 'primary' | 'danger', disabled, busy }. */
export function textButton(parent, opts) {
  const button = el(parent, 'div', `dr-button${opts.kind ? ` is-${opts.kind}` : ''}`);
  asButton(button, null, opts.run);
  if (opts.busy) glyph(button, 'wait');
  el(button, 'span', '', opts.text);
  flag(button, 'aria-disabled', opts.disabled);
  flag(button, 'aria-busy', opts.busy);
  return button;
}
