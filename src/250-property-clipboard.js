/* ------------------------------------------------------------------ */
/* Property clipboard                                                  */
/* ------------------------------------------------------------------ */

class PropertyClipboard extends Feature {
  actions() {
    return [
      {
        id: 'sort-properties',
        name: 'Sort properties alphabetically',
        when: () => {
          const editor = this.activeEditor();
          return !!(editor && typeof editor.sortProperties === 'function');
        },
        run: () => this.activeEditor().sortProperties(),
      },
      { id: 'copy-properties', name: 'Copy properties', on: 'note', menu: false, run: (ctx) => this.copy(ctx.file) },
      { id: 'paste-properties', name: 'Paste properties', on: 'note', menu: false, run: (ctx) => this.paste(ctx.file) },
    ];
  }

  activeEditor() {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf || leaf.isDeferred || !(leaf.view instanceof MarkdownView)) return null;
    return leaf.view.metadataEditor || null;
  }

  /**
   * Copied as JSON rather than YAML: it round-trips exactly, and the
   * paste side can parse it without a YAML parser.
   */
  async copy(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = (cache && cache.frontmatter) || {};
    const out = {};
    Object.keys(fm).forEach((k) => {
      if (k !== 'position') out[k] = fm[k];
    });

    const count = Object.keys(out).length;
    if (!count) {
      new Notice('This note has no properties.');
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(out, null, 2));
      new Notice(`Copied ${count} ${count === 1 ? 'property' : 'properties'}.`);
    } catch (err) {
      console.error('Design Redux: clipboard write failed', err);
      new Notice('Could not write to the clipboard.');
    }
  }

  /** Merges into whatever is already there; it never clears a note. */
  async paste(file) {
    let parsed;
    try {
      parsed = JSON.parse(await navigator.clipboard.readText());
    } catch (err) {
      new Notice('The clipboard does not contain copied properties.');
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      new Notice('The clipboard does not contain copied properties.');
      return;
    }

    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        Object.keys(parsed).forEach((k) => {
          fm[k] = parsed[k];
        });
      });
      const n = Object.keys(parsed).length;
      new Notice(`Pasted ${n} ${n === 1 ? 'property' : 'properties'}.`);
    } catch (err) {
      console.error('Design Redux: frontmatter write failed', err);
      new Notice('Could not update the properties.');
    }
  }
}

