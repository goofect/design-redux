/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/*                                                                     */
/* How everything the plugin draws is set out, decided in one place:   */
/* the density — the unit every space is a multiple of, from compact   */
/* to spacious; the same setting sizes the covers — and how much it    */
/* moves. One look, Clear: the theme's colours, type and space doing   */
/* the work. Density, look and motion are classes on the page;         */
/* styles.css does the rest.                                           */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { Feature } from './080-feature.js';

export const MOTION_LEVELS = { full: 'Full', subtle: 'Subtle: fades only', off: 'Off' };
export const ARTWORK_SIZES = { '': 'As the density', small: 'Small', medium: 'Medium', large: 'Large' };

export const ICON_MODES = { auto: 'Icons with words, the words dropping where it’s narrow', icons: 'Icons only', words: 'Words only' };

export class Appearance extends Feature {
  settingsSchema() {
    return [
      {
        key: 'motion',
        type: 'dropdown',
        name: 'Motion',
        desc: 'How much moves: screens slide in, rows glide to a new order, panes and menus come from where they belong. Subtle keeps the fades and nothing travels. Off whenever the system asks for reduced motion.',
        options: MOTION_LEVELS,
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
        // The id from when this switched looks: hotkeys hang on it.
        id: 'switch-look',
        name: 'Turn animations on or off',
        icon: 'sparkles',
        run: () => {
          const off = this.settings.motion !== 'off';
          this.change('motion', off ? 'off' : 'full', off ? 'Animations off' : 'Animations on');
        },
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
    body.classList.toggle('dr-look-clear', !off);
    body.classList.toggle('dr-motion-subtle', !off && this.settings.motion === 'subtle');
    body.classList.toggle('dr-motion-off', !off && this.settings.motion === 'off');
    body.classList.toggle('dr-glass', !off && this.settings.glassPanels !== false);
    body.classList.toggle('dr-icons-only', !off && this.settings.iconMode === 'icons');
    body.classList.toggle('dr-icons-words', !off && this.settings.iconMode === 'words');
  }

  async change(key, value, message) {
    this.settings[key] = value;
    await this.plugin.saveData(this.settings);
    this.apply();
    this.plugin.refreshBrowse();
    new Notice(message);
  }
}
