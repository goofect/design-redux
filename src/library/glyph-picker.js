/* ------------------------------------------------------------------ */
/* The glyph picker: a folder's face, chosen from the set              */
/* ------------------------------------------------------------------ */

import { GLYPHS } from '../core/glyphs.js';
import { cell, grid } from '../ui/cell.js';
import { rove } from '../ui/keys.js';
import { Sheet } from '../ui/sheet.js';
import { folderGlyph, pickGlyph } from './faces.js';

/** Opens the picker for a folder: every object glyph in a grid, the folder's own marked. */
export function pickGlyphSheet(plugin, folder) {
  const now = folderGlyph(plugin, folder);
  const sheet = new Sheet(plugin.app, {
    title: `A glyph for ${folder.name}`,
    build: (matter, s) => {
      const g = grid(matter, { label: 'Glyphs' });
      g.classList.add('dr-picker');
      GLYPHS.forEach((name) => cell(g, { glyph: name, name, selected: name === now, pick: () => { pickGlyph(plugin, folder, name); s.close(); }, open: () => { pickGlyph(plugin, folder, name); s.close(); } }));
      rove(g, '.dr-cell', { columns: () => 6, jump: true });
    },
    actions: [{ text: 'Let the plugin choose', run: () => void pickGlyph(plugin, folder, null) }, { text: 'Cancel' }],
  });
  sheet.open();
  return sheet;
}
