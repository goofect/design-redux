/* ------------------------------------------------------------------ */
/* Browse view: the preview                                           */
/*                                                                    */
/* Beside a list or a shelf of albums, when asked for: what's picked, */
/* in brief — what it is, where it is, what can be done with it —     */
/* without opening it. Editing stays the note panel's; this is for    */
/* knowing a note or an album before going in. While it shows, a      */
/* click picks and a double click or Enter opens. Methods of          */
/* BrowseView, put on by mixInto.                                     */
/* ------------------------------------------------------------------ */

class BrowsePreview {
  /** The preview's offered and shown — one choice for every page of the library — and there's room: not on a phone. */
  previewOn() {
    const settings = this.plugin.settings;
    return settings.inspector !== false && !!settings.libraryPreview && !Platform.isPhone;
  }

  previewShowing() {
    return this.previewOn() && !!this.previewEl && this.previewEl.isConnected;
  }

  /** A click picks while the preview shows — unless set always to open. */
  clickPicks() {
    return this.plugin.settings.inspectorClick !== 'never' && this.previewShowing();
  }

  /** The preview on or off, for every page of the library. Off, nothing stays picked. */
  togglePreview() {
    const settings = this.plugin.settings;
    settings.libraryPreview = !settings.libraryPreview;
    this.plugin.saveData(settings);
    if (!settings.libraryPreview && this.plugin.selection) this.plugin.selection.clear();
    if (typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
    else this.render();
  }

  /** Beside Sort and filter, the button that shows or hides it. */
  renderPreviewToggle(bar) {
    if (Platform.isPhone || this.plugin.settings.inspector === false) return;
    const btn = bar.createDiv({ cls: 'clickable-icon dr-preview-btn' });
    asButton(btn, this.previewOn() ? 'Hide the preview' : 'Preview what’s picked');
    setIcon(btn, 'panel-right');
    btn.toggleClass('is-active', this.previewOn());
    onActivate(btn, () => this.togglePreview());
  }

  /** The pane: drawn after each redraw of the page, and each change in what's picked. */
  renderPreview() {
    const on = this.previewOn();
    this.containerEl.toggleClass('has-preview', on);
    if (!on) {
      if (this.previewEl) this.previewEl.remove();
      this.previewEl = null;
      return;
    }
    if (!this.previewEl || !this.previewEl.isConnected) this.previewEl = this.containerEl.createDiv({ cls: 'dr-preview' });
    const el = this.previewEl;
    el.empty();
    // Level with the page, below the tab's own header where there is one.
    el.style.top = `${this.contentEl.offsetTop || 0}px`;
    const item = this.plugin.selection ? this.plugin.selection.get() : null;
    if (item && item.file) this.previewNote(el, item.file);
    else if (item && item.folder) this.previewAlbum(el, item.folder);
    else el.createDiv({ cls: 'dr-preview-empty', text: 'Click a note or an album to see what it is here.' });
  }

  /** Name, kind, then a few facts, each label beside its value; one can lead somewhere. */
  previewFacts(el, facts) {
    const list = el.createDiv({ cls: 'dr-preview-facts' });
    facts.filter((f) => f && f[1]).forEach(([label, value, go]) => {
      const row = list.createDiv({ cls: 'dr-preview-fact' });
      row.createDiv({ cls: 'dr-preview-label', text: label });
      const v = row.createDiv({ cls: 'dr-preview-value', text: value });
      if (go) {
        asButton(v, `${label}: ${value}`);
        v.addClass('is-link');
        onActivate(v, go);
      }
    });
  }

  previewButtons(el, buttons) {
    const bar = el.createDiv({ cls: 'dr-preview-actions' });
    buttons.filter(Boolean).forEach(([icon, label, run]) => {
      const b = bar.createDiv({ cls: 'dr-detail-action' });
      asButton(b);
      setIcon(b.createSpan({ cls: 'dr-detail-action-icon' }), icon);
      b.createSpan({ text: label });
      onActivate(b, run);
    });
  }

  previewNote(el, file) {
    drawNoteArt(this.plugin, el.createDiv({ cls: 'dr-preview-art' }), file);
    el.createDiv({ cls: 'dr-preview-title', text: file.basename });
    const lead = file.extension === 'md' ? leadProperty(this.app, file, false) : file.extension.toUpperCase();
    if (lead) el.createDiv({ cls: 'dr-preview-lead', text: lead });
    const album = file.parent && !(file.parent.isRoot && file.parent.isRoot()) ? file.parent : null;
    const here = !!album && this.mode === 'folder' && this.path === album.path;
    const style = this.lengthStyle();
    const lengths = this.plugin.lengths;
    const length = style && lengths && lengths.words(file) !== null ? lengths.label(file, style === 'words' ? 'words' : 'time') : '';
    this.previewFacts(el, [
      ['In', album ? album.name : 'The vault', album && !here ? () => this.revealInAlbum(file) : null],
      ['Created', this.relative(file.stat.ctime)],
      ['Modified', this.relative(file.stat.mtime)],
      ['Length', length],
    ]);
    this.previewButtons(el, [
      ['book-open', 'Open', (evt) => this.openFile(file, evt)],
      album && !here ? ['folder-open', 'Reveal in album', () => this.revealInAlbum(file)] : null,
      ['ellipsis', 'More', (evt) => this.fileMenu(evt, file)],
    ]);
  }

  previewAlbum(el, folder) {
    drawFolderArt(this.plugin, el.createDiv({ cls: 'dr-preview-art' }), folder);
    const root = !!(folder.isRoot && folder.isRoot());
    el.createDiv({ cls: 'dr-preview-title', text: root ? this.app.vault.getName() : folder.name });
    const kind = albumKindOf(this.plugin, folder);
    el.createDiv({ cls: 'dr-preview-lead', text: kind ? kind.label : 'Album' });
    const structure = typeof AlbumStructure === 'function' ? this.plugin.feature(AlbumStructure) : null;
    const about = structure && structure.enabled ? structure.info(folder).description : '';
    if (about) el.createDiv({ cls: 'dr-preview-about', text: about });
    const parent = folder.parent && !(folder.parent.isRoot && folder.parent.isRoot()) ? folder.parent : null;
    this.previewFacts(el, [
      ['Holds', this.countLabel(folder)],
      ['In', parent ? parent.name : 'The vault', parent ? () => this.openFolder(parent) : null],
    ]);
    this.previewButtons(el, [
      ['book-open', 'Open', () => this.openFolder(folder)],
      ['ellipsis', 'More', (evt) => this.folderMenu(evt, folder, this.folderCover(folder))],
    ]);
  }

  /** The note's own album, opened, with the note still picked in it. */
  revealInAlbum(file) {
    if (this.plugin.selection) this.plugin.selection.set({ file });
    if (!file.parent) return;
    this.navigate({ mode: 'folder', path: file.parent.path, property: null });
  }
}

mixInto(BrowseView, BrowsePreview);
