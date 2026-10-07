/* ------------------------------------------------------------------ */
/* One page                                                            */
/*                                                                     */
/* The last of the shell: one place content goes, moved through with   */
/* back and forward. Everything that would open a new tab, split or    */
/* window is routed through workspace.getLeaf, so wrapping that one    */
/* method covers links, menus, modifier-clicks and most plugins alike. */
/*                                                                     */
/* It overrides behaviour other plugins may count on — one that opens  */
/* a fresh tab to compare two notes will replace what you're reading   */
/* instead — so it's opt-in, and undone completely when switched off.  */
/* ------------------------------------------------------------------ */

class OnePage extends Feature {
  constructor(plugin) {
    super(plugin);
    this.unpatch = null;
    this.filling = false;
    this.warned = false;
  }

  settingsSchema() {
    return [
      {
        key: 'onePage',
        name: 'Keep to one page',
        desc: 'Open new tabs, splits and windows in the current page instead.',
      },
    ];
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('layout-change', () => {
        if (this.enabled) this.fillEmpty();
      })
    );
  }

  enable() {
    document.body.addClass('dr-one-page');

    if (!this.unpatch) {
      // A request for a new leaf of any kind becomes a request for the
      // current one. getLeaf(false) still makes a new tab when the page
      // is pinned, which is the one case where replacing it would be
      // wrong.
      this.unpatch = around(this.app.workspace, 'getLeaf', (original, ws, args) =>
        args[0] ? original.call(ws, false) : original.apply(ws, args)
      );
    }

    this.fillEmpty();
    this.warnHidden();
  }

  disable() {
    document.body.removeClass('dr-one-page');
    if (this.unpatch) this.unpatch();
    this.unpatch = null;
  }

  /**
   * An empty page shows Home, the way the app this borrows from never
   * shows a blank window. That covers the new-tab command, closing the
   * last note, and starting with nothing open.
   */
  fillEmpty() {
    if (this.filling) return;
    const library = this.plugin.feature(Library);
    if (!library || !library.enabled) return;

    const leaf = pageLeaf(this.app);
    if (!leaf || leaf.getViewState().type !== 'empty') return;

    this.filling = true;
    leaf
      .setViewState({
        type: BROWSE_VIEW,
        active: true,
        state: { mode: 'home', path: '/', property: null, value: null },
      })
      .catch((err) => console.error('Design Redux: could not show Home', err))
      .finally(() => {
        this.filling = false;
      });
  }

  /**
   * Tabs opened before this was switched on are still there. With the
   * tab bar hidden they'd be unreachable and easy to forget, so say so
   * once rather than closing anything on the user's behalf.
   */
  warnHidden() {
    if (this.warned || !singleAreaOn(this.settings)) return;
    let pages = 0;
    this.app.workspace.iterateRootLeaves(() => pages++);
    if (pages <= 1) return;

    this.warned = true;
    const others = pages - 1;
    new Notice(
      `${others} other ${others === 1 ? 'page is' : 'pages are'} still open behind this one. ` +
        'Run "Close all other tabs" to fold them away.'
    );
  }
}

OnePage.settingKey = 'onePage';

