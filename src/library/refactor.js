/* ------------------------------------------------------------------ */
/* Reorganising folders: rename, move, delete                          */
/*                                                                     */
/* Commands only; the folder's menu has Obsidian's own.                */
/* ------------------------------------------------------------------ */

import { Feature } from '../core/feature.js';
import { deleteEntry, moveEntry, renameEntry } from './menus.js';

export class AlbumRefactor extends Feature {
  actions() {
    const on = 'folder';
    return [
      { id: 'album-rename', name: 'Rename this folder…', on, menu: false, run: (ctx) => renameEntry(this.plugin, ctx.folder) },
      { id: 'album-move', name: 'Move this folder…', on, menu: false, run: (ctx) => moveEntry(this.plugin, ctx.folder) },
      { id: 'album-delete', name: 'Delete this folder…', on, menu: false, run: (ctx) => deleteEntry(this.plugin, ctx.folder) },
    ];
  }
}
AlbumRefactor.title = 'Reorganising folders';
AlbumRefactor.section = 'Library';
AlbumRefactor.about = 'Rename, move or delete a folder from the command palette.';
