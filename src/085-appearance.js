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

const LOOKS = { theme: 'The theme’s', editorial: 'Editorial: monochrome, flat, fine lines' };

const CANVAS_SPACINGS = { compact: 'Compact', standard: 'Standard', spacious: 'Spacious' };
const CANVAS_SPACING_SCALE = { compact: 0.75, standard: 1, spacious: 1.4 };

class Appearance extends Feature {
  settingsSchema() {
    return [
      {
        key: 'look',
        type: 'dropdown',
        name: 'Look',
        desc: 'The theme’s own colours and depth, or an editorial look: monochrome surfaces a step apart, fine lines instead of shadows, small corners, and covers without colour unless they have art.',
        options: LOOKS,
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
