/* ------------------------------------------------------------------ */
/* Covers by dropping                                                  */
/*                                                                     */
/* An image dragged onto a cover — an album's on its page, a note's in */
/* its properties or on the strip — becomes that cover, as artwork     */
/* dropped onto an album does. An image from the vault is linked where */
/* it is; one from outside is saved where Obsidian keeps attachments,  */
/* and the image router moves it on if it's on. With a cover in focus, */
/* pasting an image does the same.                                     */
/* ------------------------------------------------------------------ */

const COVER_TARGETS = '[data-cover-folder], [data-cover-note]';

class CoverDrop extends Feature {
  settingsSchema() {
    return [
      {
        key: 'coverDrop',
        name: 'Drop an image on a cover',
        desc: 'Drag an image onto an album\'s cover, or a note\'s in its properties or on the strip, to make it the cover. Images from outside the vault are saved as attachments first.',
      },
    ];
  }

  register() {
    const doc = document;
    this.plugin.registerDomEvent(doc, 'dragover', (evt) => this.onDragOver(evt));
    this.plugin.registerDomEvent(doc, 'dragleave', (evt) => this.mark(this.targetOf(evt), false));
    this.plugin.registerDomEvent(doc, 'drop', (evt) => this.onDrop(evt), true);
    this.plugin.registerDomEvent(doc, 'paste', (evt) => this.onPaste(evt), true);
  }

  disable() {
    document.querySelectorAll('.dr-cover-drop').forEach((el) => el.removeClass('dr-cover-drop'));
  }

  targetOf(evt) {
    const t = evt.target;
    return t && typeof t.closest === 'function' ? t.closest(COVER_TARGETS) : null;
  }

  mark(el, on) {
    if (el) el.toggleClass('dr-cover-drop', on);
  }

  /** An image from the vault being dragged — Obsidian's own drag of a file — or null. */
  draggedVaultImage() {
    const manager = this.app.dragManager;
    const dragged = manager && manager.draggable;
    const file = dragged && dragged.file;
    return file instanceof TFile && IMAGE_EXTENSIONS.indexOf(file.extension.toLowerCase()) !== -1 ? file : null;
  }

  /** Whether what's being dragged could be an image: one of the vault's, or a file from outside. */
  carriesImage(evt) {
    if (this.draggedVaultImage()) return true;
    const types = evt.dataTransfer ? Array.from(evt.dataTransfer.types || []) : [];
    return types.indexOf('Files') !== -1;
  }

  onDragOver(evt) {
    if (!this.enabled) return;
    const target = this.targetOf(evt);
    if (!target || !this.carriesImage(evt)) return;
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'copy';
    this.mark(target, true);
  }

  async onDrop(evt) {
    if (!this.enabled) return;
    const target = this.targetOf(evt);
    if (!target) return;
    this.mark(target, false);
    const vault = this.draggedVaultImage();
    const outside = !vault && evt.dataTransfer ? imageFiles(evt.dataTransfer.files)[0] : null;
    if (!vault && !outside) return;
    evt.preventDefault();
    evt.stopPropagation();
    const image = vault || (await this.saveImage(outside, target));
    if (image) await this.setCover(target, image);
  }

  async onPaste(evt) {
    if (!this.enabled) return;
    const doc = evt.target && evt.target.ownerDocument ? evt.target.ownerDocument : document;
    const active = doc.activeElement;
    const target = active && typeof active.closest === 'function' ? active.closest(COVER_TARGETS) : null;
    if (!target || !evt.clipboardData) return;
    const pasted = imageFiles(evt.clipboardData.files)[0];
    if (!pasted) return;
    evt.preventDefault();
    evt.stopPropagation();
    const image = await this.saveImage(pasted, target);
    if (image) await this.setCover(target, image);
  }

  /** The note or folder note a cover belongs to — made for a folder that has none. */
  async coverNote(target) {
    if (target.dataset.coverNote) {
      const file = this.app.vault.getFileByPath(target.dataset.coverNote);
      return file && file.extension === 'md' ? file : null;
    }
    const folder = this.app.vault.getFolderByPath(target.dataset.coverFolder || '');
    return folder ? this.plugin.ensureFolderNote(folder) : null;
  }

  /** An image from outside, saved where Obsidian puts attachments for the note. */
  async saveImage(blob, target) {
    try {
      const note = await this.coverNote(target);
      const name = blob.name && /\.[a-z0-9]+$/i.test(blob.name) ? blob.name : `Cover.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
      const fm = this.app.fileManager;
      const path =
        fm && typeof fm.getAvailablePathForAttachment === 'function'
          ? await fm.getAvailablePathForAttachment(name, note ? note.path : '')
          : name;
      return await this.app.vault.createBinary(path, await blob.arrayBuffer());
    } catch (err) {
      console.error('Design Redux: could not save the dropped image', err);
      new Notice('Could not save the image.');
      return null;
    }
  }

  async setCover(target, image) {
    try {
      const note = await this.coverNote(target);
      const covers = this.plugin.feature(CoverImages);
      if (!note || !covers) return;
      await covers.setCover(note, covers.linkTo(image, note));
    } catch (err) {
      console.error('Design Redux: could not set the cover', err);
      new Notice('Could not set the cover.');
    }
  }
}

/** The images among some dropped or pasted files. */
function imageFiles(list) {
  return Array.from(list || []).filter((f) => /^image\//.test(f.type || '') || IMAGE_EXTENSIONS.indexOf(String(f.name || '').split('.').pop().toLowerCase()) !== -1);
}

CoverDrop.settingKey = 'coverDrop';
