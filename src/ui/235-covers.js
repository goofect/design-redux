import { Notice, TFile, TFolder } from 'obsidian';
import { IMAGE_EXTENSIONS } from '../core/020-constants.js';
import { firstImageFile, isBrowseView, noteCoverSrc, pageLeaf } from '../core/030-helpers-art.js';
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
        desc: 'The note that stands for a folder and gives it a cover. {{folder}} is the folder’s name.',
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
        desc: 'The property that holds a note’s cover image. Match it to your bases’ card image.',
        placeholder: 'cover',
        fallback: 'cover',
        suggest: 'property',
      },
      {
        key: 'coverFromFolder',
        name: 'Folder cover for notes',
        desc: 'A note without a cover uses its folder’s, as a song uses its collection’s.',
      },
      {
        key: 'coverFromFirstImage',
        name: 'First image as cover',
        desc: 'A note without a cover uses its first image; a folder, its folder note’s.',
      },
      {
        key: 'coverFallback',
        type: 'dropdown',
        name: 'When there’s no cover',
        desc: 'What shows instead. To give one item its own, right-click it and choose Cover.',
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
        desc: 'For generated covers without a colour of their own.',
        parent: 'coverFallback',
      },
      {
        key: 'coverPrint',
        name: 'Print collections’ names on their covers',
        desc: 'A collection without a picture has its kind, its name and the shelf it’s in printed along the foot of its cover, in the same places on every collection.',
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
      { id: 'set-folder-cover', name: 'Set cover image for a folder', run: () => new FolderPicker(this.app, (folder) => this.plugin.setFolderCover(folder)).open() },
      { id: 'remove-folder-cover', name: 'Remove cover image from a folder', run: () => new FolderPicker(this.app, (folder) => this.plugin.clearFolderCover(folder)).open() },
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
   * Artwork for a folder, which has no properties of its own: its
   * folder note's cover (or first image, where the setting has it), then
   * an image called "cover" inside it. Shared
   * by the browse view and the sidebar, so a folder looks the same in
   * both.
   */
  folderCoverSrc(folder) {
    const note = this.plugin.folderNote(folder);
    if (note) {
      const src = noteCoverSrc(this.plugin, note);
      if (src) return src;
    }
    const named = (folder.children || []).find(
      (c) =>
        c instanceof TFile &&
        ['cover', '_cover', 'folder'].indexOf(c.basename.toLowerCase()) !== -1 &&
        IMAGE_EXTENSIONS.indexOf(c.extension.toLowerCase()) !== -1
    );
    return named ? this.app.vault.getResourcePath(named) : null;
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
        const note = await this.plugin.ensureFolderNote(folder);
        const covers = this;
        await covers.setCover(note, covers.linkTo(image, note));
        // The view redraws itself once the cache catches up.
        if (after) after();
      } catch (err) {
        console.error('Design Redux: could not set the folder cover', err);
        new Notice('Could not set the cover.');
      }
    }).open();
  }

  async clearFolderCover(folder, after) {
    const note = this.plugin.folderNote(folder);
    if (!note) return;
    const key = this.settings.coverProperty || 'cover';
    if (!(await this.plugin.notes.write(note, (fm) => delete fm[key], { failure: false }))) return;
    this.plugin.refreshBrowse();
    if (after) after();
  }
}

