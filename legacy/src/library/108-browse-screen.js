/* ------------------------------------------------------------------ */
/* A browse screen                                                     */
/*                                                                     */
/* What every screen is: the view it draws in, and a title. Alone in   */
/* its module, which imports nothing, so a screen anywhere can extend  */
/* it as it loads, whatever loaded first.                              */
/* ------------------------------------------------------------------ */

export class BrowseScreen {
  constructor(view) {
    this.view = view;
    this.plugin = view.plugin;
  }

  get app() {
    return this.plugin.app;
  }

  get settings() {
    return this.plugin.settings;
  }

  /** What the tab and the search field call this screen. */
  title() {
    return '';
  }

  render() {}
}
