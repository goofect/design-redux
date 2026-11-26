/* ------------------------------------------------------------------ */
/* Selection: where the person is                                      */
/*                                                                     */
/* One thing at a time is picked, a folder or a note, by path. The     */
/* library marks it and acts on it. Whoever cares listens for          */
/* 'design-redux:pick' on the workspace. Beside it, the folder open in */
/* the library's page.                                                 */
/* ------------------------------------------------------------------ */

export class Selection {
  constructor(plugin) {
    this.plugin = plugin;
    this.path = null;
    this.open = null;
  }

  /** The folder open in the library's page, or null (the vault, none, or one since deleted). A folder keeps its object through a rename. */
  get folder() {
    return this.open && this.plugin.app.vault.getAbstractFileByPath(this.open.path) ? this.open : null;
  }

  set folder(folder) {
    this.open = folder && folder.path !== '/' ? folder : null;
  }

  /** The file or folder picked, or null (also when it has since been deleted). */
  get item() {
    return this.path == null ? null : this.plugin.app.vault.getAbstractFileByPath(this.path);
  }

  is(entry) {
    return !!entry && entry.path === this.path;
  }

  pick(entry) {
    const path = entry ? entry.path : null;
    if (path === this.path) return;
    this.path = path;
    this.plugin.app.workspace.trigger('design-redux:pick', this.item);
  }

  clear() {
    this.pick(null);
  }

  /** The pick follows a rename and is dropped by a delete. */
  followRename(oldPath, newPath) {
    if (this.path === oldPath) this.path = newPath;
    else if (this.path && this.path.startsWith(`${oldPath}/`)) this.path = newPath + this.path.slice(oldPath.length);
  }

  followDelete(path) {
    if (this.path === path || (this.path && this.path.startsWith(`${path}/`))) this.clear();
  }
}
