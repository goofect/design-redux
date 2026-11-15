/* ------------------------------------------------------------------ */
/* Appearance: the look's switch and its regions                       */
/*                                                                     */
/* The look is a handful of classes on a window's body: `dr-active`    */
/* (the master switch) and `dr-region-<name>` for each region that is  */
/* on. Every window gets them — the main one, a popout, the settings   */
/* window — and every one loses them when the plugin unloads. With the */
/* look kept to what the plugin draws, Obsidian's own regions stay     */
/* off; with look set to 'theme' the switch itself is off and the      */
/* window is the person's theme, untouched.                            */
/* ------------------------------------------------------------------ */

import { Feature } from './feature.js';
import { OBSIDIAN_REGIONS, REGIONS, regionKey } from './settings.js';

export const LOOK_CLASS = 'dr-active';
export const regionClass = (name) => `dr-region-${name}`;

/** The classes a body should carry for these settings. */
export function lookClasses(settings) {
  if (settings.look === 'theme') return [];
  const whole = settings.lookScope === 'window';
  const regions = REGIONS.filter((r) => settings[regionKey(r)] !== false && (whole || !OBSIDIAN_REGIONS.includes(r)));
  return [LOOK_CLASS].concat(regions.map(regionClass), settings.alwaysShowLabels ? ['dr-labels'] : []);
}

export class Appearance extends Feature {
  constructor(plugin) {
    super(plugin);
    this.docs = new Set();
  }

  enable() {
    this.dress(activeDocument);
    if (typeof document !== 'undefined') this.dress(document);
    this.listen(this.app.workspace, 'window-open', (win) => this.dress(win && (win.doc || (win.win && win.win.document))));
    this.listen(this.app.workspace, 'window-close', (win) => this.undress(win && (win.doc || (win.win && win.win.document))));
  }

  disable() {
    Array.from(this.docs).forEach((doc) => this.undress(doc));
  }

  sync() {
    Array.from(this.docs).forEach((doc) => this.dress(doc));
  }

  /** Puts the look's classes on a window's body (and takes off any that no longer apply). */
  dress(doc) {
    if (!doc || !doc.body) return;
    this.docs.add(doc);
    const want = lookClasses(this.settings);
    const all = [LOOK_CLASS, 'dr-labels'].concat(REGIONS.map(regionClass));
    all.forEach((cls) => doc.body.classList.toggle(cls, want.includes(cls)));
  }

  undress(doc) {
    if (!doc || !doc.body) return;
    doc.body.classList.remove(LOOK_CLASS, 'dr-labels', ...REGIONS.map(regionClass));
    this.docs.delete(doc);
  }

  settingsRows() {
    return [
      { key: 'look', name: 'Look', desc: 'Redux is the plugin’s look. Theme leaves the window to your theme; the plugin’s own surfaces then take its colours.', type: 'choice', options: { redux: 'Redux', theme: 'Theme' } },
      { key: 'lookScope', name: 'Where it applies', desc: 'The whole window, Obsidian’s own interface included, or only what the plugin draws.', type: 'choice', options: { window: 'The whole window', plugin: 'Only what the plugin draws' } },
      { key: 'alwaysShowLabels', name: 'Always show labels', desc: 'Names under the objects of a grid at rest, not only under the pointer.', type: 'toggle' },
    ].concat(REGIONS.map((r) => ({ key: regionKey(r), name: `Region: ${r}`, desc: OBSIDIAN_REGIONS.includes(r) ? 'Obsidian’s own. Off, it keeps your theme.' : 'The plugin’s own.', type: 'toggle', behind: true })));
  }
}
Appearance.title = 'Look';
Appearance.glyph = 'color';
Appearance.section = 'Look';
