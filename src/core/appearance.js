/* ------------------------------------------------------------------ */
/* Appearance: the look's switch, and where it reaches                 */
/*                                                                     */
/* The look is a handful of classes on a window's body: `dr-active`    */
/* (the master switch) and `dr-region-<name>` for each region it       */
/* covers. Every window gets them — the main one, a popout, the        */
/* settings window — and every one loses them when the plugin unloads. */
/* The plugin's own regions are always covered; Obsidian's only with   */
/* the look on the whole window. With look set to 'theme' the switch   */
/* itself is off and the window is the person's theme, untouched.      */
/* ------------------------------------------------------------------ */

import { Feature } from './feature.js';
import { OBSIDIAN_REGIONS, REGIONS } from './settings.js';

export const LOOK_CLASS = 'dr-active';
export const regionClass = (name) => `dr-region-${name}`;

/** The classes a body should carry for these settings. */
export function lookClasses(settings) {
  if (settings.look === 'theme') return [];
  const whole = settings.lookScope === 'window';
  return [LOOK_CLASS].concat(REGIONS.filter((r) => whole || !OBSIDIAN_REGIONS.includes(r)).map(regionClass));
}

export class Appearance extends Feature {
  constructor(plugin) {
    super(plugin);
    this.docs = new Set();
  }

  enable() {
    this.eachWindow((doc) => this.dress(doc));
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
    const all = [LOOK_CLASS].concat(REGIONS.map(regionClass));
    all.forEach((cls) => doc.body.classList.toggle(cls, want.includes(cls)));
  }

  undress(doc) {
    if (!doc || !doc.body) return;
    doc.body.classList.remove(LOOK_CLASS, ...REGIONS.map(regionClass));
    this.docs.delete(doc);
  }
}
Appearance.title = 'Look';
Appearance.section = 'Look';
