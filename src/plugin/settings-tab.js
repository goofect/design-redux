/* ------------------------------------------------------------------ */
/* The settings page: a row a feature                                  */
/*                                                                     */
/* Each feature is one row: its glyph, its name, its switch, and a     */
/* gear that opens the few settings it has. Sections are labels.       */
/* Built with Obsidian's own Setting rows, in whatever window the      */
/* page is opened in.                                                  */
/* ------------------------------------------------------------------ */

import { PluginSettingTab, Setting } from 'obsidian';
import { iconId } from '../core/icons.js';
import { glyph } from '../core/dom.js';

export const SETTINGS_SECTIONS = ['Look', 'Library', 'Notes', 'Panel', 'Tools'];

export class SettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.opened = new Set();
  }

  display() {
    const root = this.containerEl;
    while (root.firstChild) root.removeChild(root.firstChild);
    root.classList.add('dr-settings');
    const look = this.plugin.features.find((f) => typeof f.dress === 'function');
    if (look) look.dress(root.ownerDocument);
    SETTINGS_SECTIONS.forEach((section) => {
      const features = this.plugin.features.filter((f) => f.constructor.section === section && f.constructor.title);
      if (!features.length) return;
      new Setting(root).setName(section).setHeading();
      features.forEach((feature) => this.featureRow(root, feature));
    });
  }

  featureRow(root, feature) {
    const F = feature.constructor;
    const rows = feature.settingsRows();
    const row = new Setting(root).setName(F.title).setDesc(F.about || '');
    row.settingEl.classList.add('dr-setting-feature');
    if (F.glyph && row.nameEl) row.nameEl.insertBefore(glyph(row.nameEl, F.glyph), row.nameEl.firstChild);
    const more = root.ownerDocument.createElement('div');
    more.className = 'dr-setting-more';
    more.hidden = !this.opened.has(F.name);
    if (rows.length) {
      row.addExtraButton((b) => b.setIcon(iconId('gear')).setTooltip(`${F.title}: settings`).onClick(() => {
        more.hidden = !more.hidden;
        if (more.hidden) this.opened.delete(F.name);
        else this.opened.add(F.name);
      }));
    }
    if (F.key) row.addToggle((t) => t.setValue(!!this.plugin.settings[F.key]).onChange((v) => this.set(F.key, v)));
    root.appendChild(more);
    // Rows of a group sit under one row of their own, behind a second gear.
    const groups = new Map();
    rows.forEach((r) => {
      if (!r.group) return void this.settingRow(more, r);
      if (!groups.has(r.group)) groups.set(r.group, []);
      groups.get(r.group).push(r);
    });
    groups.forEach((list, name) => {
      const id = `${F.name}:${name}`;
      const inner = root.ownerDocument.createElement('div');
      inner.className = 'dr-setting-more';
      inner.hidden = !this.opened.has(id);
      new Setting(more).setName(name).setDesc(`${list.length} settings.`).addExtraButton((b) => b.setIcon(iconId('gear')).setTooltip(`${F.title}: ${name.toLowerCase()}`).onClick(() => {
        inner.hidden = !inner.hidden;
        if (inner.hidden) this.opened.delete(id);
        else this.opened.add(id);
      }));
      more.appendChild(inner);
      list.forEach((r) => this.settingRow(inner, r));
    });
  }

  settingRow(parent, r) {
    const settings = this.plugin.settings;
    const row = new Setting(parent).setName(r.name).setDesc(r.desc || '');
    if (r.type === 'toggle') row.addToggle((t) => t.setValue(!!settings[r.key]).onChange((v) => this.set(r.key, v)));
    else if (r.type === 'choice') row.addDropdown((d) => d.addOptions(r.options).setValue(String(settings[r.key])).onChange((v) => this.set(r.key, v)));
    else if (r.type === 'number') row.addText((t) => t.setValue(String(settings[r.key])).onChange((v) => { const n = Number(v); if (Number.isFinite(n)) this.set(r.key, n); }));
    else if (r.type === 'custom') row.addText((t) => t.setPlaceholder(r.placeholder || '').setValue(String(r.get())).onChange(async (v) => { r.set(v); await this.plugin.saveSettings(); }));
    else if (r.type === 'action') row.addButton((b) => b.setButtonText(r.button || r.name).onClick(() => r.run()));
    else row.addText((t) => t.setPlaceholder(r.placeholder || '').setValue(String(settings[r.key] == null ? '' : settings[r.key])).onChange((v) => this.set(r.key, v)));
    return row;
  }

  async set(key, value) {
    this.plugin.settings[key] = value;
    await this.plugin.saveSettings();
  }
}
