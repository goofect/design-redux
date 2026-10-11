/* ------------------------------------------------------------------ */
/* A property for the whole album                                      */
/*                                                                     */
/* From a property's menu: its value given to every other note in the */
/* note's folder, through the bulk engine, so it's one Undo. Notes     */
/* with a value of their own are asked about before it's replaced.     */
/* ------------------------------------------------------------------ */

class AlbumProperty extends Feature {
  settingsSchema() {
    return [
      {
        key: 'propertyForAlbum',
        name: 'Set for the whole album',
        desc: 'A property’s menu can give its value to every note in the album, with Undo.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'property-to-album',
        name: 'Give a property of this note to its whole album…',
        icon: 'layers',
        on: 'note',
        menu: false,
        when: (ctx) => this.enabled && !!ctx.file.parent && this.keysOf(ctx.file).length > 0,
        run: (ctx) => this.pick(ctx.file),
      },
    ];
  }

  pageNote() {
    const file = this.app.workspace.getActiveFile();
    return file && file.extension === 'md' && file.parent ? file : null;
  }

  frontmatter(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    return (cache && cache.frontmatter) || {};
  }

  keysOf(file) {
    return Object.keys(this.frontmatter(file)).filter((k) => k !== 'position');
  }

  /** The other notes in the note's folder; the folder note stands for it, so isn't one. */
  albumNotes(file) {
    const folder = file && file.parent;
    if (!folder) return [];
    return (folder.children || []).filter(
      (c) => c instanceof TFile && c.extension === 'md' && c !== file && !this.plugin.isFolderNote(c)
    );
  }

  albumName(file) {
    const folder = file.parent;
    return !folder || (folder.isRoot && folder.isRoot()) ? this.app.vault.getName() : folder.name;
  }

  /** Which of the note's properties, then that one. */
  pick(file) {
    const keys = this.keysOf(file);
    if (keys.length === 1) return this.apply(file, keys[0]);
    const feature = this;
    const modal = new (class extends FuzzySuggestModal {
      getItems() {
        return keys;
      }
      getItemText(key) {
        return key;
      }
      onChooseItem(key) {
        feature.apply(file, key);
      }
    })(this.app);
    modal.setPlaceholder(`A property to give all of ${this.albumName(file)}`);
    modal.open();
  }

  /** The note's value for a property, in every other note of its album. */
  async apply(file, key) {
    const bulk = this.plugin.bulk;
    const fm = this.frontmatter(file);
    if (!bulk || !Object.prototype.hasOwnProperty.call(fm, key)) return null;
    const value = fm[key];
    const notes = this.albumNotes(file);
    const name = this.albumName(file);
    if (!notes.length) {
      new Notice(`There are no other notes in ${name}.`);
      return null;
    }
    const props = [{ key, value }];
    const plan = bulk.planAdd(notes, props, true);
    if (!plan.changing.length) {
      new Notice(`Every note in ${name} already has this “${key}”.`);
      return null;
    }
    const own = plan.held[key] || 0;
    if (own) {
      const yes = await confirmAction(this.app, {
        title: `Set “${key}” for all of ${name}?`,
        text: `${bulkCount(own, 'note')} already ${own === 1 ? 'has a value' : 'have values'} of ${own === 1 ? 'its' : 'their'} own for “${key}”, which will be replaced. Undo puts them back.`,
        button: 'Replace',
      });
      if (!yes) return null;
    }
    const record = await bulk.addProperties(notes, props, true);
    if (!record) return null;
    bulkNotice(bulk, `Set “${key}” on ${bulkCount(record.files.length, 'note')} in ${name}.${bulkTail(record)}`, record);
    return record;
  }
}

AlbumProperty.settingKey = 'propertyForAlbum';
