/* ------------------------------------------------------------------ */
/* A property for the whole folder                                     */
/*                                                                     */
/* One note's value for a property, given to every other note in its   */
/* folder. Notes with a value of their own are asked about before it   */
/* is replaced; the whole of it is one Undo.                           */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { Feature } from '../core/feature.js';
import { copyValue, offerUndo, sameValue } from '../core/notes.js';
import { counted } from '../core/text.js';
import { choose } from '../ui/choose.js';
import { Sheet } from '../ui/sheet.js';

export class AlbumProperty extends Feature {
  /** Gives `key`'s value on `file` to the other notes of its folder. `replace`: also where a note has its own. */
  async give(file, key, replace) {
    const value = this.plugin.notes.get(file, key);
    const others = this.plugin.index.notes(file.parent).filter((f) => f !== file);
    const records = [];
    for (const note of others) {
      const own = this.plugin.notes.get(note, key);
      if (sameValue(own, value) || (own !== undefined && own !== null && own !== '' && !replace)) continue;
      const record = await this.plugin.notes.write(note, (fm) => (fm[key] = copyValue(value)), { failure: false });
      if (record && Object.keys(record.before).length) records.push(record);
    }
    if (records.length) offerUndo(this.plugin, `${key} given to ${counted(records.length, 'note')}.`, () => this.plugin.notes.undo(records));
    else new Notice('Every note in the folder already has that value.');
    return records.length;
  }

  async ask(file) {
    const props = this.plugin.notes.props(file);
    const keys = Object.keys(props);
    if (!keys.length) return void new Notice('This note has no properties to give.');
    const key = await choose(this.app, keys, { placeholder: 'Which property goes to the whole folder?' });
    if (!key) return;
    const own = this.plugin.index.notes(file.parent).filter((f) => f !== file && ![undefined, null, ''].includes(this.plugin.notes.get(f, key)) && !sameValue(this.plugin.notes.get(f, key), props[key]));
    if (!own.length) return this.give(file, key, false);
    new Sheet(this.app, {
      title: `${key} for the whole folder`,
      text: `${counted(own.length, 'note has', 'notes have')} a value of ${own.length === 1 ? 'its' : 'their'} own.`,
      actions: [{ text: 'Cancel' }, { text: 'Keep theirs', run: () => void this.give(file, key, false) }, { text: 'Replace theirs', kind: 'primary', run: () => void this.give(file, key, true) }],
    }).open();
  }

  actions() {
    return [{ id: 'property-to-album', name: 'Give a property of this note to its whole folder…', glyph: 'layers', on: 'note', menu: 'Give a property to the folder…', when: (ctx) => !!ctx.file.parent, run: (ctx) => this.ask(ctx.file) }];
  }
}
AlbumProperty.key = 'propertyForAlbum';
AlbumProperty.title = 'A property for the whole folder';
AlbumProperty.glyph = 'layers';
AlbumProperty.section = 'Library';
AlbumProperty.about = 'Give one note’s value to every note beside it.';
