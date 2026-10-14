/* ------------------------------------------------------------------ */
/* Appearance                                                          */
/*                                                                     */
/* How everything the plugin draws is set out, decided in one place:   */
/* the density — the unit every space is a multiple of, from compact   */
/* to spacious; the same setting sizes the covers — the look, the      */
/* theme's own or the editorial one (monochrome, flat, fine lines),   */
/* and how far apart canvas layouts, tidies and new cards put cards.   */
/* Density and look are classes on the page; styles.css does the rest. */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { CANVAS_SPACE } from './020-constants.js';
import { Feature } from './080-feature.js';

export const LOOKS = { theme: 'The theme’s', editorial: 'Editorial: monochrome, flat, fine lines', classic: 'Classic: as before 2.0' };
export const LOOK_SCOPES = { window: 'The whole window', plugin: 'Design Redux only' };
export const ARTWORK_SIZES = { '': 'As the density', small: 'Small', medium: 'Medium', large: 'Large' };

export const CANVAS_SPACINGS = { compact: 'Compact', standard: 'Standard', spacious: 'Spacious' };
export const CANVAS_SPACING_SCALE = { compact: 0.75, standard: 1, spacious: 1.4 };

export class Appearance extends Feature {
  settingsSchema() {
    return [
      {
        key: 'look',
        type: 'dropdown',
        name: 'Look',
        desc: 'The theme’s own colours and depth, or an editorial look: monochrome surfaces a step apart, fine lines instead of shadows, small corners, and covers without colour unless they have art. Classic keeps the look from before 2.0 — no note header or shelves, no lines under notes, no glass — for one release.',
        options: LOOKS,
      },
      {
        key: 'lookScope',
        type: 'dropdown',
        name: 'Editorial look on',
        desc: 'The whole window — its notes, sidebars and menus too — or only what Design Redux draws: the library, collection pages, the inspector, the strip and the note panel.',
        options: LOOK_SCOPES,
        showIf: (s) => s.look === 'editorial',
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
        key: 'canvasSpacing',
        type: 'dropdown',
        name: 'Canvas spacing',
        desc: 'How far apart layouts, tidying and new cards put cards on a canvas — apart from the density of everything else.',
        options: CANVAS_SPACINGS,
      },
    ];
  }

  actions() {
    return [
      {
        id: 'switch-look',
        name: 'Switch look: the theme’s or editorial',
        icon: 'contrast',
        run: () => this.change('look', this.settings.look === 'editorial' ? 'theme' : 'editorial', `Look: ${this.settings.look === 'editorial' ? 'the theme’s' : 'editorial'}`),
      },
      {
        id: 'next-canvas-spacing',
        name: 'Next canvas spacing: compact, standard, spacious',
        icon: 'move-horizontal',
        run: () => {
          const keys = Object.keys(CANVAS_SPACINGS);
          const next = keys[(keys.indexOf(this.settings.canvasSpacing) + 1) % keys.length];
          this.change('canvasSpacing', next, `Canvas spacing: ${CANVAS_SPACINGS[next].toLowerCase()}`);
        },
      },
    ];
  }

  /** Every settings save: the page's classes, and the canvas's spacing, as set. Safe to run again. */
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
    body.classList.toggle('dr-glass', !off && this.settings.glassPanels !== false && this.settings.look !== 'classic');
    // 1.x's styling, for those not ready for 2.0's: kept for one release.
    body.classList.toggle('dr-look-classic', !off && this.settings.look === 'classic');
    body.classList.toggle('dr-look-scoped', !off && this.settings.look === 'editorial' && this.settings.lookScope === 'plugin');
    CANVAS_SPACE.scale = (!off && CANVAS_SPACING_SCALE[this.settings.canvasSpacing]) || 1;
  }

  async change(key, value, message) {
    this.settings[key] = value;
    await this.plugin.saveData(this.settings);
    this.apply();
    this.plugin.refreshBrowse();
    new Notice(message);
  }
}
