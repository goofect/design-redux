import { Notice, TFile, TFolder } from 'obsidian';
import { IMAGE_EXTENSIONS } from '../core/020-constants.js';
import { firstImageFile, noteCoverSrc } from '../core/030-art.js';
import { isBrowseView, pageLeaf } from '../core/034-tabs.js';
import { fmGet } from '../core/045-helpers-properties.js';
import { Feature } from '../core/080-feature.js';
import { CoverColorModal, FolderPicker, ImagePicker } from './230-pickers.js';

export class CoverImages extends Feature {
  settingsSchema() {
    return [
      {
        key: 'folderNoteName',
        type: 'text',
        name: 'Folder note name',
        desc: 'The note that stands for a folder. {{folder}} is the folder’s name.',
        placeholder: '{{folder}}',
        fallback: '{{folder}}',
      },
      {
        key: 'hideFolderNotes',
        name: 'Hide folder notes',
        desc: 'Leave a folder’s own note out of its list.',
      },
      {
        key: 'coverProperty',
        type: 'text',
        name: 'Cover property',
        desc: 'The property holding a note’s cover image.',
        placeholder: 'cover',
        fallback: 'cover',
        suggest: 'property',
      },
      {
        key: 'coverFromFolder',
        name: 'Folder cover for notes',
        desc: 'A note without a cover uses its folder’s.',
      },
      {
        key: 'coverFromFirstImage',
        name: 'First image as cover',
        desc: 'A note without a cover uses its first image.',
      },
      {
        key: 'coverFallback',
        type: 'dropdown',
        name: 'When there’s no cover',
        desc: 'What shows instead. Right-click an item and choose Cover to set one.',
        options: {
          art: 'A drawn cover',
          title: 'Its name as a title',
          icon: 'Its icon',
          soft: 'Its icon on a soft colour',
          name: 'A colour from its name',
          accent: 'The accent colour',
          custom: 'One colour for all',
          kind: 'A symbol and colour for its kind of collection',
        },
      },
      {
        key: 'generatedCoverColor',
        type: 'color',
        showIf: (settings) => settings.coverFallback === 'custom',
        name: 'Cover colour',
        desc: 'For made covers without a colour of their own.',
        parent: 'coverFallback',
      },
      {
        key: 'coverPrint',
        name: 'Print collections’ names on their covers',
        desc: 'Print a collection’s kind and name on covers without a picture.',
      },
    ];
  }

  actions() {
    const note = (id, name, run) => ({ id, name, on: 'note', menu: false, run: (ctx) => run(ctx.file) });
    return [
      note('set-cover-image', 'Set cover image for Bases card', (file) => new ImagePicker(this.app, (image) => this.setCover(file, this.linkTo(image, file))).open()),
      note('cover-from-first-image', 'Use first image in note as card cover', (file) => {
        const image = this.firstImageIn(file);
        if (!image) new Notice('No images embedded in this note.');
        else this.setCover(file, this.linkTo(image, file));
      }),
      note('repair-cover-link', 'Repair cover image link', (file) => this.repairCover(file)),
      note('remove-cover-image', 'Remove cover image', (file) => this.plugin.clearNoteCover(file)),
      {
        id: 'set-cover-color',
        name: 'Set cover colour',
        icon: 'palette',
        // The page's own: the folder on screen, or the note that's open.
        when: () => !!this.coverColorTarget(),
        run: () => this.plugin.chooseCoverColor(this.coverColorTarget()),
      },
      { id: 'set-folder-cover', name: 'Set cover image for a folder', icon: 'image-plus', run: () => new FolderPicker(this.app, (folder) => this.plugin.setFolderCover(folder)).open() },
      { id: 'remove-folder-cover', name: 'Remove cover image from a folder', icon: 'image-minus', run: () => new FolderPicker(this.app, (folder) => this.plugin.clearFolderCover(folder)).open() },
    ];
  }

  get property() {
    return this.settings.coverProperty || 'cover';
  }

  coverColorTarget() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    if (isBrowseView(view)) {
      const folder = view.mode === 'folder' ? view.folder() : null;
      return folder && !folder.isRoot() ? folder : null;
    }
    const file = view && view.file instanceof TFile ? view.file : null;
    return file && file.extension === 'md' ? file : null;
  }

  /**
   * A wikilink, the form properties and Bases read, whatever the vault's
   * own link format: a Markdown link in a property isn't a link to
   * Obsidian, and nothing here could find the image from it.
   */
  linkTo(image, from) {
    const text = this.app.metadataCache.fileToLinktext(image, from ? from.path : '', true);
    return `[[${text}]]`;
  }

  /** The first embedded image in a note, resolved to a real file. */
  firstImageIn(file) {
    return firstImageFile(this.app, file);
  }

  async setCover(file, value) {
    const key = this.property;
    if (await this.plugin.notes.write(file, (fm) => (fm[key] = value))) new Notice(`Cover set on "${key}".`);
  }

  /**
   * Turn a bare filename into a link. Typing "photo.png" is the natural
   * thing to do and the commonest reason a card shows no image.
   */
  repairCover(file) {
    const key = this.property;
    const cache = this.app.metadataCache.getFileCache(file);
    const raw = cache && fmGet(cache.frontmatter, key);

    if (typeof raw !== 'string' || !raw.trim()) {
      new Notice(`No "${key}" property to repair.`);
      return;
    }

    const value = raw.trim();
    if (value.startsWith('[[') || value.startsWith('#') || /^https?:\/\//i.test(value)) {
      new Notice('That cover is already in a form Bases can read.');
      return;
    }

    const target = this.app.metadataCache.getFirstLinkpathDest(
      value.replace(/^!?\[\[|\]\]$/g, '').split('#')[0],
      file.path
    );
    if (!target) {
      new Notice(`No file in the vault matches "${value}".`);
      return;
    }

    this.setCover(file, this.linkTo(target, file));
  }

  /* -- a folder's artwork; covers set and cleared (the plugin asks these for its callers) -- */

  /**
   * Artwork for a folder: the image set for it (kept by the folder's path,
   * no note needed); else its folder note's cover, where it has one; else
   * an image called "cover" or "folder" inside it; else, where the setting
   * has it, the first image inside it. Shared by the browse view and the
   * sidebar, so a folder looks the same in both.
   */
  folderCoverSrc(folder) {
    const image = this.folderImage(folder);
    if (image) return this.app.vault.getResourcePath(image);
    const note = this.plugin.folderNote(folder);
    if (note) {
      const src = noteCoverSrc(this.plugin, note);
      if (src) return src;
    }
    const images = (folder.children || []).filter((c) => c instanceof TFile && IMAGE_EXTENSIONS.indexOf(c.extension.toLowerCase()) !== -1);
    const named = images.find((c) => ['cover', '_cover', 'folder'].indexOf(c.basename.toLowerCase()) !== -1);
    if (named) return this.app.vault.getResourcePath(named);
    if (!this.settings.coverFromFirstImage || !images.length) return null;
    const first = images.slice().sort((x, y) => x.name.localeCompare(y.name))[0];
    return this.app.vault.getResourcePath(first);
  }

  /** The image set as a folder's cover, where it's still there. */
  folderImage(folder) {
    const path = (this.settings.folderCovers || {})[folder.path];
    const file = path ? this.app.vault.getFileByPath(path) : null;
    return file && IMAGE_EXTENSIONS.indexOf(file.extension.toLowerCase()) !== -1 ? file : null;
  }

  /** A folder's cover, set to an image in the vault: kept by the folder's path, no note made. */
  async setFolderImage(folder, image) {
    if (!this.settings.folderCovers) this.settings.folderCovers = {};
    this.settings.folderCovers[folder.path] = image.path;
    await this.plugin.saveData(this.settings);
    this.plugin.refreshBrowse();
    new Notice(`Cover set for ${folder.name}.`);
  }

  /** Ask for an image and record it on the note itself. */
  setNoteCover(file) {
    const covers = this;
    new ImagePicker(this.app, (image) =>
      covers.setCover(file, covers.linkTo(image, file))
    ).open();
  }

  async clearNoteCover(file) {
    const key = this.settings.coverProperty || 'cover';
    await this.plugin.notes.write(file, (fm) => delete fm[key]);
  }

  /** Pick the colour a folder or note's generated cover takes. */
  chooseCoverColor(target) {
    const name = target instanceof TFolder ? target.name : target.basename;
    new CoverColorModal(this.plugin, target, name).open();
  }

  /**
   * Ask for an image and record it on the folder note, creating that
   * note if it doesn't exist. Stored in the vault rather than in plugin
   * settings, so the pairing survives being moved or rebuilt elsewhere.
   */
  setFolderCover(folder, after) {
    new ImagePicker(this.app, async (image) => {
      try {
        await this.setFolderImage(folder, image);
        if (after) after();
      } catch (err) {
        console.error('Design Redux: could not set the folder cover', err);
        new Notice('Could not set the cover.');
      }
    }).open();
  }

  /** A folder's cover taken off: the image set for it, and a cover on its folder note from before. */
  async clearFolderCover(folder, after) {
    const covers = this.settings.folderCovers || {};
    if (covers[folder.path]) {
      delete covers[folder.path];
      await this.plugin.saveData(this.settings);
    }
    const note = this.plugin.folderNote(folder);
    const key = this.settings.coverProperty || 'cover';
    const cache = note && this.app.metadataCache.getFileCache(note);
    if (cache && fmGet(cache.frontmatter, key) !== undefined) await this.plugin.notes.write(note, (fm) => delete fm[key], { failure: false });
    this.plugin.refreshBrowse();
    if (after) after();
  }
}

CoverImages.offers = ['covers'];
