/* ------------------------------------------------------------------ */
/* List keys                                                           */
/*                                                                     */
/* In the library and on every screen of notes, as in a song list:     */
/* the arrow keys move and Enter opens, as they always have; typing    */
/* the start of a name jumps to it; and Space shows the note in focus  */
/* in a preview, without leaving the list.                             */
/* ------------------------------------------------------------------ */

/* Previews from the lists, which need no key held to show. */
const LIST_HOVER_SOURCE = 'design-redux-lists';

class ListKeys extends Feature {
  constructor(plugin) {
    super(plugin);
    // What the preview hangs from, as a page's own links have their view.
    this.hoverParent = { hoverPopover: null };
  }

  settingsSchema() {
    return [
      {
        key: 'typeToJump',
        name: 'Type to jump',
        desc: 'In lists, type a name to jump to it. Space previews the note; Enter opens it.',
      },
    ];
  }

  registerTypes() {
    if (typeof this.plugin.registerHoverLinkSource === 'function') {
      this.plugin.registerHoverLinkSource(LIST_HOVER_SOURCE, { display: 'Design Redux lists', defaultMod: false });
    }
  }

  enable() {
    listKeys.on = true;
    listKeys.preview = (row, path, evt) => this.preview(row, path, evt);
  }

  disable() {
    listKeys.on = false;
    listKeys.preview = null;
  }

  /** The note a row stands for, in a page preview beside it. */
  preview(row, path, evt) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    // A key has no place on the page: the preview is placed by the row, as by a pointer resting on it.
    const box = row.getBoundingClientRect();
    const win = row.ownerDocument.defaultView || window;
    const at = new win.MouseEvent('mouseover', { clientX: box.left + Math.min(40, box.width / 2), clientY: box.top + box.height / 2 });
    this.app.workspace.trigger('hover-link', {
      event: at,
      source: LIST_HOVER_SOURCE,
      hoverParent: this.hoverParent,
      targetEl: row,
      linktext: file.path,
      sourcePath: '',
    });
    return true;
  }
}

ListKeys.settingKey = 'typeToJump';
