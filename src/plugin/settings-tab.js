/* ------------------------------------------------------------------ */
/* The settings page: the features' switches                           */
/*                                                                     */
/* Two columns of Obsidian's own toggles, each with the feature's name */
/* beside it, and nothing else, so the page fits one screen. The look  */
/* comes first: on or off, and whether it reaches Obsidian's own       */
/* interface too. Everything that isn't a switch has a fixed value (or */
/* the one a vault had set). Built with Obsidian's own Setting rows,   */
/* in whatever window the page is opened in.                           */
/* ------------------------------------------------------------------ */

import { PluginSettingTab, Setting } from 'obsidian';

export class SettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** The switches, in the order they are shown: [{ name, on, set(on) }]. */
  switches() {
    const s = this.plugin.settings;
    const save = async (change) => {
      change();
      await this.plugin.saveSettings();
    };
    return [
      { name: 'The look', on: s.look !== 'theme', set: (on) => save(() => (s.look = on ? 'redux' : 'theme')) },
      { name: 'On Obsidian’s own interface too', on: s.lookScope === 'window', set: (on) => save(() => (s.lookScope = on ? 'window' : 'plugin')) },
    ].concat(this.plugin.features.filter((f) => f.constructor.key && f.constructor.title)
      .map((f) => ({ name: f.constructor.title, on: !!s[f.constructor.key], set: (on) => save(() => (s[f.constructor.key] = on)) })));
  }

  display() {
    const root = this.containerEl;
    while (root.firstChild) root.removeChild(root.firstChild);
    root.classList.add('dr-settings');
    const look = this.plugin.features.find((f) => typeof f.dress === 'function');
    if (look) look.dress(root.ownerDocument);
    const grid = root.appendChild(root.ownerDocument.createElement('div'));
    grid.className = 'dr dr-switches';
    this.switches().forEach((sw) => new Setting(grid).setName(sw.name).addToggle((t) => t.setValue(sw.on).onChange((v) => sw.set(v))));
  }
}
