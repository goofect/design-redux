/* ------------------------------------------------------------------ */
/* The settings page: the features' switches                           */
/*                                                                     */
/* Five of Obsidian's own toggles, drawn as Obsidian draws its own     */
/* settings: a row each, its name and what it does, the toggle at the  */
/* end. First the look and whether it reaches Obsidian's interface,    */
/* then, under a heading, the few features that change what you see   */
/* or write to your notes. A feature that only adds commands has no    */
/* switch: it is in the command palette, always. Last, the backup: a   */
/* row a service, signed in or out, where signing in is the switch.    */
/* Built in whatever window the page is opened in.                     */
/* ------------------------------------------------------------------ */

import { PluginSettingTab, Setting } from 'obsidian';
import { Backup } from '../backup/backup.js';

export class SettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    // A sign-in ends in the browser: the page, if it is open, shows it.
    plugin.registerEvent(app.workspace.on('design-redux:backup', () => this.containerEl.isConnected && this.display()));
  }

  /** The switches, in the order they are shown: [{ name, desc, on, set(on), heading (a heading over it) }]. */
  switches() {
    const s = this.plugin.settings;
    const save = async (change) => {
      change();
      await this.plugin.saveSettings();
    };
    // One switch may turn several features: the note's head and its pages are one.
    const keys = (name, desc, ...ks) => ({ name, desc, on: !!s[ks[0]], set: (on) => save(() => ks.forEach((k) => (s[k] = on))) });
    return [
      { name: 'The look', desc: 'The plugin’s panes in black, white and one grey, and Obsidian’s ribbons, right sidebar, status bar and view headers hidden.', on: s.look !== 'theme', set: (on) => save(() => (s.look = on ? 'redux' : 'theme')) },
      { name: 'On Obsidian’s own interface too', desc: 'Obsidian’s menus, sidebars, editor, canvas and graph take the look as well.', on: s.lookScope === 'window', set: (on) => save(() => (s.lookScope = on ? 'window' : 'plugin')) },
      { heading: 'Features', ...keys('Library', 'The folders as a tree in the left sidebar, and a folder’s notes as a list in the page.', 'library') },
      keys('Note head and pages', 'A note’s folder over its title and its properties under it, edited where they stand; and a note in several pages.', 'notePage', 'notePages'),
      keys('Property rules', 'When a note comes into a folder, gets a tag or a value, set other properties. A dry run until you let them write.', 'propertyRulesOn'),
    ];
  }

  display() {
    const root = this.containerEl;
    while (root.firstChild) root.removeChild(root.firstChild);
    // The settings window has a body of its own: it is given the look's classes, as every window is.
    this.plugin.look.dress(root.ownerDocument);
    this.switches().forEach((sw) => {
      if (sw.heading) new Setting(root).setName(sw.heading).setHeading();
      new Setting(root).setName(sw.name).setDesc(sw.desc).addToggle((t) => t.setValue(sw.on).onChange((v) => sw.set(v)));
    });
    // The backup: a row a service the build can sign in to, its state in words, a failure in red, and one button.
    const backup = this.plugin.feature(Backup);
    const rows = backup ? backup.rows() : [];
    if (rows.length) new Setting(root).setName('Backup').setHeading();
    rows.forEach((row) => {
      const setting = new Setting(root).setName(row.name).setDesc(row.desc);
      if (row.error) {
        const said = setting.descEl.appendChild(root.ownerDocument.createElement('div'));
        said.className = 'dr-backup-error';
        said.setAttribute('role', 'alert');
        said.textContent = `The last backup failed: ${row.error}.`;
      }
      setting.addButton((b) => b.setButtonText(row.button).onClick(async () => {
        await row.run();
        this.display();
      }));
    });
  }
}
