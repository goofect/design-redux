class CoverImages extends Feature {
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
        desc: 'A note without a cover uses its folder’s, as a song uses its album’s.',
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
    ];
  }

  commands() {
    const withFile = (fn) => ({
      check: () => !!this.app.workspace.getActiveFile(),
      run: () => fn(this.app.workspace.getActiveFile()),
    });

    return [
      Object.assign(
        { id: 'set-cover-image', name: 'Set cover image for Bases card' },
        withFile((file) =>
          new ImagePicker(this.app, (image) =>
            this.setCover(file, this.linkTo(image, file))
          ).open()
        )
      ),
      Object.assign(
        { id: 'cover-from-first-image', name: 'Use first image in note as card cover' },
        withFile((file) => {
          const image = this.firstImageIn(file);
          if (!image) new Notice('No images embedded in this note.');
          else this.setCover(file, this.linkTo(image, file));
        })
      ),
      Object.assign(
        { id: 'repair-cover-link', name: 'Repair cover image link' },
        withFile((file) => this.repairCover(file))
      ),
      Object.assign(
        { id: 'remove-cover-image', name: 'Remove cover image' },
        withFile((file) => this.plugin.clearNoteCover(file))
      ),
      {
        id: 'set-cover-color',
        name: 'Set cover colour',
        icon: 'palette',
        // The page's own: the folder on screen, or the note that's open.
        check: () => !!this.coverColorTarget(),
        run: () => this.plugin.chooseCoverColor(this.coverColorTarget()),
      },
      {
        id: 'set-folder-cover',
        name: 'Set cover image for a folder',
        run: () =>
          new FolderPicker(this.app, (folder) =>
            this.plugin.setFolderCover(folder)
          ).open(),
      },
      {
        id: 'remove-folder-cover',
        name: 'Remove cover image from a folder',
        run: () =>
          new FolderPicker(this.app, (folder) =>
            this.plugin.clearFolderCover(folder)
          ).open(),
      },
    ];
  }

  get property() {
    return this.settings.coverProperty || 'cover';
  }

  coverColorTarget() {
    const leaf = pageLeaf(this.app);
    const view = leaf && !leaf.isDeferred ? leaf.view : null;
    if (view instanceof BrowseView) {
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
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        fm[key] = value;
      });
      new Notice(`Cover set on "${key}".`);
    } catch (err) {
      console.error('Design Redux: could not set the cover', err);
      new Notice('Could not update the properties.');
    }
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
}

