/* ------------------------------------------------------------------ */
/* Browse view: what it gives the inspector                           */
/*                                                                    */
/* The inspector — the note panel docked in the right sidebar — shows */
/* what's picked here. While it shows, a click picks and a double     */
/* click or Enter opens. What the library knows of a pick, it draws:  */
/* an album in brief (what it is, where it is) and, for a note, Open, */
/* Reveal in collection and More. Methods of BrowseView, put on by    */
/* mixInto.                                                           */
/* ------------------------------------------------------------------ */

import { Platform, setIcon } from 'obsidian';
import { albumKindOf, drawFolderArt } from '../core/030-helpers-art.js';
import { asButton, iconWord, onActivate } from '../core/040-helpers-sorting.js';
import { closeInspector, inspectorShowing, openInspector } from '../core/076-selection.js';
import { mixInto } from '../core/080-feature.js';
import { BrowseView } from './120-browse-view.js';
import { AlbumStructure } from './257-album-structure.js';

export class BrowsePreview {
  /** The inspector's offered and in sight, and there's room: not on a phone. */
  previewOn() {
    return this.plugin.settings.inspector !== false && !Platform.isPhone && inspectorShowing(this.app);
  }

  previewShowing() {
    return this.previewOn();
  }

  /** A click picks while the inspector shows — unless set always to open. */
  clickPicks() {
    return this.plugin.settings.inspectorClick !== 'never' && this.previewShowing();
  }

  /** The inspector shown or closed. Closed, nothing stays picked. */
  async togglePreview() {
    if (this.previewOn()) {
      closeInspector(this.app);
      if (this.plugin.selection) this.plugin.selection.clear();
    } else {
      await openInspector(this.app);
    }
    if (typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
    else this.render();
  }

  /** Beside Sort and filter, the button that shows or hides it. */
  renderPreviewToggle(bar) {
    if (Platform.isPhone || this.plugin.settings.inspector === false) return;
    const btn = bar.createDiv({ cls: 'clickable-icon dr-preview-btn' });
    asButton(btn, this.previewOn() ? 'Hide the inspector' : 'Show what’s picked in the inspector');
    setIcon(btn, 'panel-right');
    btn.toggleClass('is-active', this.previewOn());
    onActivate(btn, () => this.togglePreview());
  }

  /** The button kept in step when the inspector opens or closes from elsewhere. */
  markPreviewToggle() {
    const btn = this.containerEl.querySelector('.dr-preview-btn');
    if (!btn) return;
    const on = this.previewOn();
    btn.toggleClass('is-active', on);
    btn.setAttribute('aria-label', on ? 'Hide the inspector' : 'Show what’s picked in the inspector');
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
      iconWord(b, icon, label);
      onActivate(b, run);
    });
  }

  /** A note picked here, in the inspector: Open, Reveal in collection, More. */
  inspectNoteActions(el, file) {
    const album = file.parent && !(file.parent.isRoot && file.parent.isRoot()) ? file.parent : null;
    const here = !!album && this.mode === 'folder' && this.path === album.path;
    this.previewButtons(el, [
      ['book-open', 'Open', (evt) => this.openFile(file, evt)],
      album && !here ? ['folder-open', 'Reveal in collection', () => this.revealInAlbum(file)] : null,
      ['ellipsis', 'More', (evt) => this.fileMenu(evt, file)],
    ]);
  }

  previewAlbum(el, folder) {
    drawFolderArt(this.plugin, el.createDiv({ cls: 'dr-preview-art' }), folder);
    const root = !!(folder.isRoot && folder.isRoot());
    el.createDiv({ cls: 'dr-preview-title', text: root ? this.app.vault.getName() : folder.name });
    const kind = albumKindOf(this.plugin, folder);
    el.createDiv({ cls: 'dr-preview-lead', text: kind ? kind.label : 'Collection' });
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
