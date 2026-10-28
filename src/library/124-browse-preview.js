/* ------------------------------------------------------------------ */
/* Browse view: its pane, the inspector                               */
/*                                                                    */
/* A pane along the page's right edge where the note panel — the      */
/* inspector — shows what's picked here. While it shows, a click      */
/* picks and a double click or Enter opens. What the library knows of */
/* a pick, it draws: an album in brief (what it is, where it is) and, */
/* for a note, Open, Reveal in collection and More. A part of         */
/* BrowseView, which extends it through 125.                          */
/* ------------------------------------------------------------------ */

import { Platform, setIcon } from 'obsidian';
import { albumKindOf, drawFolderArt } from '../core/030-helpers-art.js';
import { asButton, iconWord, onActivate } from '../core/040-helpers-sorting.js';
import { BrowseRows } from './123-browse-rows.js';
import { AlbumStructure } from './257-album-structure.js';

/**
 * Where the panel docks: the pane's element, the page's leaf, and what
 * shows while there's nothing to (with, given `action` ({ label, run }),
 * a button to start).
 */
class InspectorPane {
  constructor(el, leaf) {
    this.contentEl = el;
    this.leaf = leaf;
  }

  showEmpty(text, action = null) {
    let el = this.contentEl.querySelector('.dr-panel-dock-empty');
    if (!el) {
      el = this.contentEl.createDiv({ cls: 'dr-panel-dock-empty' });
      setIcon(el.createDiv({ cls: 'dr-panel-dock-empty-icon', attr: { 'aria-hidden': 'true' } }), 'info');
      el.createDiv({ cls: 'dr-panel-dock-empty-text' });
    }
    el.querySelector('.dr-panel-dock-empty-text').setText(text || '');
    const old = el.querySelector('.dr-panel-dock-empty-action');
    if (old) old.remove();
    if (text && action) {
      const button = el.createEl('button', { cls: 'dr-panel-dock-empty-action', text: action.label });
      button.addEventListener('click', () => action.run());
    }
    el.toggleClass('is-hidden', !text);
  }
}

export class BrowsePreview extends BrowseRows {
  /** The pane's offered and open, and there's room: not on a phone. */
  previewOn() {
    return this.plugin.settings.inspector !== false && this.plugin.settings.libraryPreview !== false && !Platform.isPhone;
  }

  previewShowing() {
    return this.previewOn() && !!this.inspectorPane;
  }

  /** A click picks while the pane shows — unless set always to open. */
  clickPicks() {
    return this.plugin.settings.inspectorClick !== 'never' && this.previewShowing();
  }

  /** The pane shown or closed, on every page. Closed, what's picked stays picked. */
  async togglePreview() {
    this.plugin.settings.libraryPreview = !this.previewOn();
    await this.plugin.saveSettings();
    if (typeof this.plugin.refreshBrowse === 'function') this.plugin.refreshBrowse();
    else this.render();
  }

  /** The pane made or taken away, as the settings say; drawn with the page. */
  syncPane() {
    if (this.previewOn() && !this.inspectorPane) {
      const el = this.containerEl.createDiv({ cls: 'dr-browse-pane dr-panel-dock' });
      this.containerEl.addClass('dr-has-pane');
      this.inspectorPane = new InspectorPane(el, this.leaf);
      this.app.workspace.trigger('design-redux:pane-open', this.inspectorPane);
    } else if (!this.previewOn() && this.inspectorPane) {
      this.removePane();
    }
  }

  removePane() {
    const pane = this.inspectorPane;
    if (!pane) return;
    this.inspectorPane = null;
    this.app.workspace.trigger('design-redux:pane-close', pane);
    pane.contentEl.remove();
    this.containerEl.removeClass('dr-has-pane');
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

  /** The button kept in step when the pane opens or closes from elsewhere. */
  markPreviewToggle() {
    const btn = this.containerEl.querySelector('.dr-preview-btn');
    if (!btn) return;
    const on = this.previewOn();
    btn.toggleClass('is-active', on);
    btn.setAttribute('aria-label', on ? 'Hide the inspector' : 'Show what’s picked in the inspector');
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

  /** A note picked here, in the pane: Open, Reveal in collection, More. */
  inspectNoteActions(el, file) {
    const album = file.parent && !(file.parent.isRoot && file.parent.isRoot()) ? file.parent : null;
    const here = !!album && this.mode === 'folder' && this.path === album.path;
    this.previewButtons(el, [
      ['book-open', 'Open', (evt) => this.openFile(file, evt)],
      album && !here ? ['folder-open', 'Reveal in collection', () => this.revealInAlbum(file)] : null,
      ['ellipsis', 'More', (evt) => this.fileMenu(evt, file)],
    ]);
  }

  /**
   * An album as the pane opens on it, the way a note does: its cover
   * beside its name, what kind of album in the accent, and a line on how
   * much it holds and where it is — that last a way there. Then what it's
   * about, and Open and More.
   */
  previewAlbum(el, folder) {
    const head = el.createDiv({ cls: 'dr-props-head dr-props-identity' });
    drawFolderArt(this.plugin, head.createDiv({ cls: 'dr-props-art' }), folder);
    const info = head.createDiv({ cls: 'dr-props-info' });
    const root = !!(folder.isRoot && folder.isRoot());
    info.createDiv({ cls: 'dr-props-title', text: root ? this.app.vault.getName() : folder.name });
    const kind = albumKindOf(this.plugin, folder);
    info.createDiv({ cls: 'dr-props-lead', text: kind ? kind.label : 'Collection' });
    const meta = info.createDiv({ cls: 'dr-props-meta' });
    meta.createSpan({ text: this.countLabel(folder) });
    const parent = folder.parent && !(folder.parent.isRoot && folder.parent.isRoot()) ? folder.parent : null;
    if (parent) {
      meta.createSpan({ text: '  ·  ' });
      const up = meta.createSpan({ cls: 'dr-props-meta-link', text: parent.name });
      asButton(up, `In ${parent.name}: open it`);
      onActivate(up, () => this.openFolder(parent));
    }
    const structure = typeof AlbumStructure === 'function' ? this.plugin.feature(AlbumStructure) : null;
    if (structure && structure.enabled && !root) this.previewAbout(el, folder, structure);
    this.previewButtons(el, [
      ['book-open', 'Open', () => this.openFolder(folder)],
      ['ellipsis', 'More', (evt) => this.folderMenu(evt, folder, this.folderCover(folder))],
    ]);
  }

  /** What the album's for, beneath its head: clicked, it's changed; with none yet, a quiet way to write one. */
  previewAbout(el, folder, structure) {
    const about = el.createDiv({ cls: 'dr-preview-about' });
    const draw = (text) => {
      about.setText(text || 'Add a description');
      about.toggleClass('is-empty', !text);
      asButton(about, text ? `Edit the description: ${text}` : `Describe ${folder.name}`);
    };
    draw(structure.info(folder).description);
    onActivate(about, () => structure.chooseDescription(folder, draw));
  }

  /** The note's own album, opened, with the note still picked in it. */
  revealInAlbum(file) {
    if (this.plugin.selection) this.plugin.selection.set({ file });
    if (!file.parent) return;
    this.navigate({ mode: 'folder', path: file.parent.path, property: null });
  }
}
