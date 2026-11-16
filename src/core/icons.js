/* ------------------------------------------------------------------ */
/* Icons: the plugin's glyph set, given to Obsidian                    */
/*                                                                     */
/* Each glyph under assets/icons is registered once as `dr-<name>`     */
/* with addIcon, so setIcon, menus and commands can all show it, and   */
/* taken away again when the plugin unloads.                           */
/* ------------------------------------------------------------------ */

import { addIcon, removeIcon } from 'obsidian';
import { ICONS } from 'dr:icons';

/** The names of every glyph the plugin has. */
export const GLYPH_NAMES = Object.keys(ICONS);

/** The id Obsidian knows a glyph by. */
export const iconId = (name) => `dr-${name}`;

export function registerGlyphs() {
  GLYPH_NAMES.forEach((name) => addIcon(iconId(name), ICONS[name]));
}

export function unregisterGlyphs() {
  if (typeof removeIcon !== 'function') return;
  GLYPH_NAMES.forEach((name) => removeIcon(iconId(name)));
}
