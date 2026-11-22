/* ------------------------------------------------------------------ */
/* The settings page: the features' switches                           */
/*                                                                     */
/* Six of Obsidian's own toggles and nothing else: the look, whether */
/* it reaches Obsidian's interface, and the few features that change   */
/* what you see or write to your notes. A feature that only adds       */
/* commands has no switch: it is in the command palette, always.       */
/* Built with Obsidian's own Setting rows, in whatever window the page */
/* is opened in.                                                       */
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
    // The look, then only what changes what you see or writes to your notes. Everything else is a command, always there.
    const key = (name, k) => ({ name, on: !!s[k], set: (on) => save(() => (s[k] = on)) });
    return [
      { name: 'The look', on: s.look !== 'theme', set: (on) => save(() => (s.look = on ? 'redux' : 'theme')) },
      { name: 'On Obsidian’s own interface too', on: s.lookScope === 'window', set: (on) => save(() => (s.lookScope = on ? 'window' : 'plugin')) },
      key('Library', 'library'),
      key('Note head and pages', 'notePage'),
      key('Property rules', 'propertyRulesOn'),
    ].map((sw) => (sw.name === 'Note head and pages' ? Object.assign(sw, { set: (on) => save(() => { s.notePage = on; s.notePages = on; }) }) : sw));
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
