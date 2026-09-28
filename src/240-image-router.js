/* ------------------------------------------------------------------ */
/* Image routing                                                       */
/* ------------------------------------------------------------------ */

class ImageRouter extends Feature {
  settingsSchema() {
    return [
      {
        key: 'routeImages',
        name: 'Move new images to a folder',
        desc: 'Move images added to the vault into one folder, updating the links to them. Other attachments follow Obsidian\'s own setting.',
      },
      {
        key: 'imageFolder',
        type: 'text',
        name: 'Image folder',
        desc: 'Relative to the vault root. Created if missing; images already in it stay put.',
        placeholder: 'attachments',
        showIf: 'routeImages',
        suggest: 'folder',
      },
    ];
  }

  register() {
    // Registered after layout is ready: every file in the vault fires a
    // create event during startup, and those must not be touched.
    this.plugin.registerEvent(
      this.app.vault.on('create', (file) => {
        if (this.enabled) this.route(file);
      })
    );
  }

  /**
   * Only files created while the app is running: Obsidian fires create
   * for every file in the vault during startup, and moving those would
   * reorganise the whole vault.
   *
   * The move waits for the note the image was pasted into to link it —
   * or a few seconds, whichever is first — so the link is updated with
   * the move, not left pointing at where the image first landed.
   */
  async route(file) {
    if (!(file instanceof TFile)) return;
    if (IMAGE_EXTENSIONS.indexOf(file.extension.toLowerCase()) === -1) return;

    const folder = normalizePath(
      (this.settings.imageFolder || '').replace(/^\/+|\/+$/g, '')
    );
    if (!folder || folder === '/') return;

    // Already there, or somewhere beneath it.
    if (file.path === `${folder}/${file.name}`) return;
    if (file.path.startsWith(`${folder}/`)) return;

    const cache = this.app.metadataCache;
    const path = file.path;
    let done = false;
    let timer = 0;
    const ref = cache.on('resolve', (source) => {
      const links = (cache.resolvedLinks && cache.resolvedLinks[source.path]) || {};
      if (links[path]) finish();
    });
    const finish = async () => {
      if (done) return;
      done = true;
      cache.offref(ref);
      window.clearTimeout(timer);
      if (this.app.vault.getAbstractFileByPath(path) !== file) return;
      try {
        if (!this.app.vault.getFolderByPath(folder)) {
          await this.app.vault.createFolder(folder);
        }
      } catch (err) {
        console.error('Design Redux: could not create the image folder', err);
        return;
      }
      this.plugin.moveFile(file, folder);
    };
    timer = window.setTimeout(finish, 4000);
  }

}

ImageRouter.settingKey = 'routeImages';

