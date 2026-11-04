/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/*                                                                     */
/* How everything the plugin draws is set out, decided in one place:   */
/* the density — the unit every space is a multiple of, from compact   */
/* to spacious; the same setting sizes the covers — the look, the      */
/* theme's own or the editorial one (monochrome, flat, fine lines).   */
/* Density and look are classes on the page; styles.css does the rest. */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { Feature } from './080-feature.js';

export const LOOKS = { apple: 'Apple: the system font, grouped lists, quiet controls', theme: 'The theme’s', editorial: 'Editorial: monochrome, flat, fine lines' };
export const LOOK_SCOPES = { window: 'The whole window', plugin: 'Design Redux only' };
export const ARTWORK_SIZES = { '': 'As the density', small: 'Small', medium: 'Medium', large: 'Large' };

export const ICON_MODES = { auto: 'Icons with words, the words dropping where it’s narrow', icons: 'Icons only', words: 'Words only' };

export class Appearance extends Feature {
  settingsSchema() {
    return [
      {
        key: 'look',
        type: 'dropdown',
        name: 'Look',
        desc: 'Apple: the system font and Apple’s type scale, grouped lists, segmented controls, quiet icon buttons and soft materials, with the theme’s colours. The theme’s own look as it draws it; or an editorial look — monochrome surfaces, fine lines, small corners.',
        options: LOOKS,
      },
      {
        key: 'lookScope',
        type: 'dropdown',
        name: 'Look on',
        desc: 'The whole window — notes too — or only what Design Redux draws: the library, collection pages, the strip, the panel and settings.',
        options: LOOK_SCOPES,
        showIf: (s) => s.look === 'editorial' || s.look === 'apple',
      },
      {
        key: 'glassPanels',
        name: 'Glass',
        desc: 'Menus, suggestions and the canvas’s bar and controls turn to frosted glass, so the note stays the brightest thing on screen. Off where the system asks for less transparency.',
      },
      {
        key: 'artworkSize',
        type: 'dropdown',
        name: 'Cover size',
        desc: 'How large covers are on screens of collections and notes, apart from the density of everything else.',
        options: ARTWORK_SIZES,
      },
      {
        key: 'iconMode',
        type: 'dropdown',
        name: 'Icons',
        desc: 'Buttons and tabs for common actions — Open, Add, Search, Sort, Filter — show an icon with the word in a tooltip. Anything ambiguous or destructive keeps its words.',
        options: ICON_MODES,
      },
    ];
  }

  actions() {
    return [
      {
        id: 'switch-look',
        name: 'Switch look: Apple or the theme’s',
        icon: 'contrast',
        run: () => this.change('look', this.settings.look === 'apple' ? 'theme' : 'apple', `Look: ${this.settings.look === 'apple' ? 'the theme’s' : 'Apple'}`),
      },
    ];
  }

  /** Every settings save: the page's classes, as set. Safe to run again. */
  enable() {
    this.apply();
  }

  disable() {
    this.apply(true);
  }

  apply(off) {
    const body = document.body;
    const density = this.settings.gridDensity;
    body.classList.toggle('dr-density-compact', !off && density === 'compact');
    body.classList.toggle('dr-density-spacious', !off && density === 'large');
    body.classList.toggle('dr-look-editorial', !off && this.settings.look === 'editorial');
    body.classList.toggle('dr-glass', !off && this.settings.glassPanels !== false);
    const apple = !off && this.settings.look === 'apple';
    body.classList.toggle('dr-look-apple', apple);
    // Inside notes only where the look covers the whole window.
    body.classList.toggle('dr-note-apple', apple && this.settings.lookScope !== 'plugin');
    body.classList.toggle('dr-icons-only', !off && this.settings.iconMode === 'icons');
    body.classList.toggle('dr-icons-words', !off && this.settings.iconMode === 'words');
    body.classList.toggle('dr-look-scoped', !off && this.settings.look === 'editorial' && this.settings.lookScope === 'plugin');
  }

  async change(key, value, message) {
    this.settings[key] = value;
    await this.plugin.saveData(this.settings);
    this.apply();
    this.plugin.refreshBrowse();
    new Notice(message);
  }
}
