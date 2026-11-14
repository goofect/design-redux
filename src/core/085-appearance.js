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

export const LOOK_SCOPES = { window: 'The whole window', plugin: 'Design Redux only' };
export const ARTWORK_SIZES = { '': 'As the density', small: 'Small', medium: 'Medium', large: 'Large' };

export const ICON_MODES = { auto: 'Icons and words', icons: 'Icons only', words: 'Words only' };

export class Appearance extends Feature {
  settingsSchema() {
    return [
      {
        key: 'lookScope',
        type: 'dropdown',
        name: 'Look on',
        desc: 'The whole window, notes included, or only what Design Redux draws.',
        options: LOOK_SCOPES,
      },
      {
        key: 'showArt',
        name: 'Covers and icons',
        desc: 'A small cover or icon beside each name, in lists, the sidebar, the strip and the panel. Off, they are words alone; a grid of covers keeps its covers.',
      },
      {
        key: 'glassPanels',
        name: 'Glass',
        desc: 'Menus and suggestions as frosted glass.',
      },
      {
        key: 'artworkSize',
        type: 'dropdown',
        name: 'Cover size',
        desc: 'Cover size on collection and note screens.',
        options: ARTWORK_SIZES,
      },
      {
        key: 'iconMode',
        type: 'dropdown',
        name: 'Icons',
        desc: 'Icons for common actions, with the word in a tooltip.',
        options: ICON_MODES,
      },
    ];
  }

  actions() {
    return [];
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
    body.classList.toggle('dr-glass', !off && this.settings.glassPanels !== false);
    // Lists, not covers: Home's shelves, its large cards and an album's head draw as compact lists too.
    body.classList.toggle('dr-layout-lists', !off && this.settings.libraryLayout === 'lists');
    // Words alone, unless covers and icons are asked for.
    body.classList.toggle('dr-no-art', !off && this.settings.showArt !== true);
    // One look, the plugin's own (the class keeps the name it had while there were three).
    body.classList.toggle('dr-look-apple', !off);
    // Inside notes only where the look covers the whole window.
    body.classList.toggle('dr-note-apple', !off && this.settings.lookScope !== 'plugin');
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

Appearance.offers = ['look'];
