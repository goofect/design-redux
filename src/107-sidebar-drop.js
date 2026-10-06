/* ------------------------------------------------------------------ */
/* Drop a note on an album in the library                              */
/*                                                                     */
/* A track dragged from a list onto a folder in the library — or in    */
/* Obsidian's own file list — moves it there, as a song is dragged     */
/* onto a playlist, and says so with an Undo. A note dragged from the  */
/* file list onto the library's folders does the same; the file list  */
/* already takes its own drags.                                        */
/* ------------------------------------------------------------------ */

class SidebarDrop extends Feature {
  settingsSchema() {
    return [
      {
        key: 'sidebarDrop',
        name: 'Drag notes onto albums',
        desc: 'Drag a note from a list onto a folder in the library or in Obsidian\'s file list to move it there, or a note from the file list onto the library\'s folders. An Undo follows.',
      },
    ];
  }

  register() {
    const doc = document;
    this.plugin.registerDomEvent(doc, 'dragover', (evt) => this.onDragOver(evt));
    this.plugin.registerDomEvent(doc, 'dragleave', (evt) => this.mark(this.rowOf(evt), false));
    this.plugin.registerDomEvent(doc, 'drop', (evt) => this.onDrop(evt), true);
    this.plugin.registerDomEvent(doc, 'dragend', () => this.clear());
  }

  disable() {
    this.clear();
  }

  clear() {
    document.querySelectorAll('.dr-drop-target').forEach((el) => el.removeClass('dr-drop-target'));
  }

  /** The row for a folder under the pointer — the library's, or the file list's — or null. */
  rowOf(evt) {
    const t = evt.target;
    const row = t && typeof t.closest === 'function' ? t.closest('.dr-lib-row[data-path], .nav-folder-title[data-path]') : null;
    if (!row) return null;
    return this.app.vault.getFolderByPath(row.dataset.path) ? row : null;
  }

  mark(row, on) {
    if (row) row.toggleClass('dr-drop-target', on);
  }

  /** A note being dragged: one of the lists' rows, or — onto the library — Obsidian's own drag of a file. */
  carriesNote(evt, row) {
    const types = evt.dataTransfer ? Array.from(evt.dataTransfer.types || []) : [];
    if (types.indexOf('text/dr-file') !== -1) return true;
    if (row && !row.hasClass('dr-lib-row')) return false;
    const manager = this.app.dragManager;
    const dragged = manager && manager.draggable;
    return !!dragged && dragged.file instanceof TFile;
  }

  draggedFile(evt) {
    const path = evt.dataTransfer ? evt.dataTransfer.getData('text/dr-file') : '';
    if (path) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) return file;
    }
    const manager = this.app.dragManager;
    const dragged = manager && manager.draggable;
    return dragged && dragged.file instanceof TFile ? dragged.file : null;
  }

  onDragOver(evt) {
    if (!this.enabled) return;
    const row = this.rowOf(evt);
    if (!row || !this.carriesNote(evt, row)) return;
    evt.preventDefault();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
    if (!row.hasClass('dr-drop-target')) {
      this.clear();
      this.mark(row, true);
    }
  }

  async onDrop(evt) {
    if (!this.enabled) return;
    const row = this.rowOf(evt);
    if (!row || !this.carriesNote(evt, row)) return;
    this.clear();
    const file = this.draggedFile(evt);
    if (!file) return;
    evt.preventDefault();
    evt.stopPropagation();
    await this.plugin.moveFile(file, row.dataset.path, { announce: true });
  }
}

SidebarDrop.settingKey = 'sidebarDrop';
