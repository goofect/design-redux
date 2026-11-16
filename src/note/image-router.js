/* ------------------------------------------------------------------ */
/* The image router: pasted images go to one folder                    */
/*                                                                     */
/* An image pasted or dropped into a note is saved by Obsidian where   */
/* its own setting says. With the router on, an image that appears     */
/* while a note is being written is moved to the images folder; the    */
/* move is Obsidian's, so the link in the note follows.                */
/* ------------------------------------------------------------------ */

import { TFile, normalizePath } from 'obsidian';
import { Feature } from '../core/feature.js';

const IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

export class ImageRouter extends Feature {
  enable() {
    // Only an image that arrives just after a paste or a drop into the editor is one to move.
    const mark = () => { this.pastedAt = Date.now(); };
    this.listen(this.app.workspace, 'editor-paste', mark);
    this.listen(this.app.workspace, 'editor-drop', mark);
    this.listen(this.app.vault, 'create', (file) => this.route(file));
  }

  async route(file) {
    if (!(file instanceof TFile) || !IMAGES.includes(file.extension.toLowerCase())) return false;
    if (!this.pastedAt || Date.now() - this.pastedAt > 5000) return false;
    const dir = normalizePath(this.settings.imageFolder || 'attachments');
    if ((file.parent ? file.parent.path : '/') === dir) return false;
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
    const to = this.plugin.files.freePath(this.app.vault.getAbstractFileByPath(dir), file.basename, file.extension);
    try {
      await this.app.fileManager.renameFile(file, to);
      return true;
    } catch (err) {
      console.error('Design Redux: could not move the image', err);
      return false;
    }
  }

}
ImageRouter.key = 'routeImages';
ImageRouter.title = 'Image router';
ImageRouter.glyph = 'cover';
ImageRouter.section = 'Notes';
ImageRouter.about = 'Images pasted into a note are kept in the images folder (set under Covers).';
