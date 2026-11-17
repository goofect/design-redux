/* Basic folder actions use Obsidian's file manager. */
import { Feature } from '../core/feature.js';
import { deleteEntry, moveEntry, renameEntry } from './menus.js';

export class AlbumRefactor extends Feature {
  actions() {
    const on = 'folder';
    return [
      { id: 'album-rename', name: 'Rename this folder…', glyph: 'pencil', on, menu: false, run: (ctx) => renameEntry(this.plugin, ctx.folder) },
      { id: 'album-move', name: 'Move this folder…', glyph: 'move', on, menu: false, run: (ctx) => moveEntry(this.plugin, ctx.folder) },
      { id: 'album-delete', name: 'Delete this folder…', glyph: 'trash', on, menu: false, run: (ctx) => deleteEntry(this.plugin, ctx.folder) },
    ];
  }
}
AlbumRefactor.key = 'albumRefactor';
AlbumRefactor.title = 'Folder actions';
AlbumRefactor.glyph = 'folder';
AlbumRefactor.section = 'Library';
AlbumRefactor.about = 'Rename, move or delete a folder.';
