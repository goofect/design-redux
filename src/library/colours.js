/* ------------------------------------------------------------------ */
/* Colours: one of Obsidian's named colours for a folder, on a map     */
/*                                                                     */
/* The person's own, shown as a small square before the folder's word  */
/* on a map and nowhere else. Covers are gone (no grid to show them);  */
/* their command ids stay, quiet, so a hotkey on one breaks nothing.   */
/* ------------------------------------------------------------------ */

import { retiredActions } from '../core/actions.js';
import { Feature } from '../core/feature.js';
import { choose } from '../ui/choose.js';

/** Obsidian's named colours, the ones a folder can be given: the plugin declares no colour of its own. */
export const COLOURS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];

/** The named colour nearest a colour kept from the old plugin (a hex), by its hue; a grey has none. */
export function colourOf(value) {
  if (COLOURS.includes(value)) return value;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value || ''));
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (max - min < 0.08) return null;
  const hue = (60 * (max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4) + 360) % 360;
  return hue < 15 || hue >= 330 ? 'red' : hue < 45 ? 'orange' : hue < 70 ? 'yellow' : hue < 160 ? 'green' : hue < 200 ? 'cyan' : hue < 260 ? 'blue' : hue < 300 ? 'purple' : 'pink';
}

/** The old cover commands: kept so a hotkey on one is quiet, not broken; never offered. */
const RETIRED_COVER_COMMANDS = ['set-cover-image', 'remove-cover-image', 'cover-from-first-image', 'set-folder-cover', 'remove-folder-cover', 'repair-cover-link'];

export class FolderColours extends Feature {
  enable() {
    this.plugin.colourOf = (entry) => colourOf((this.settings.coverColors || {})[entry.path]);
    this.add(() => delete this.plugin.colourOf);
  }

  async chooseColour(folder) {
    const colour = await choose(this.app, COLOURS.concat('none'), { placeholder: `A colour for ${folder.name}`, name: (c) => (c === 'none' ? 'No colour' : c[0].toUpperCase() + c.slice(1)) });
    if (!colour) return;
    const colors = this.settings.coverColors || (this.settings.coverColors = {});
    if (colour === 'none') delete colors[folder.path];
    else colors[folder.path] = colour;
    await this.plugin.saveSettings();
  }

  actions() {
    return [
      { id: 'set-cover-color', name: 'Set a folder’s colour', on: 'folder', menu: 'Colour…', run: (ctx) => this.chooseColour(ctx.folder) },
      ...retiredActions(RETIRED_COVER_COMMANDS, 'covers are gone'),
    ];
  }
}
FolderColours.title = 'Colours';
FolderColours.section = 'Library';
FolderColours.about = 'A colour for a folder, shown as a small square on a map.';
