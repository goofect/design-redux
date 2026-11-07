/* ------------------------------------------------------------------ */
/* Library layout editor                                               */
/*                                                                     */
/* The settings block that arranges the sidebar: sections, their       */
/* items, and the order of both. Kept apart from the feature so the    */
/* feature stays about behaviour.                                      */
/* ------------------------------------------------------------------ */

import { FuzzySuggestModal, setIcon, Setting, TFolder } from 'obsidian';
import { LIBRARY_BUILTINS } from '../core/020-constants.js';
import { knownPropertyNames } from '../core/045-helpers-properties.js';

/** Choosing what goes in the list: a destination, a folder, a base or a note. */
export class LibraryItemPicker extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChooseItem_ = onChoose;
    this.setPlaceholder('Add a destination, folder, base or note');
  }

  getItems() {
    const items = Object.keys(LIBRARY_BUILTINS).map((id) => ({
      kind: 'builtin',
      id: id,
      text: LIBRARY_BUILTINS[id].label,
    }));

    const walk = (folder) => {
      (folder.children || []).forEach((child) => {
        if (child instanceof TFolder) {
          items.push({ kind: 'folder', path: child.path, text: child.path + '/' });
          walk(child);
        }
      });
    };
    walk(this.app.vault.getRoot());

    this.app.vault.getFiles().forEach((f) => {
      if (f.extension !== 'base' && f.extension !== 'canvas' && f.extension !== 'md') return;
      items.push({ kind: 'file', path: f.path, text: f.path });
    });

    // A property, opening the Properties screen at its values.
    knownPropertyNames(this.app).forEach((name) =>
      items.push({ kind: 'property', key: name.toLowerCase(), text: `By ${name}` })
    );

    return items;
  }

  getItemText(item) {
    return item.text;
  }

  onChooseItem(item) {
    this.onChooseItem_(item);
  }
}

export class LibraryEditor {
  constructor(library) {
    this.library = library;
    this.plugin = library.plugin;
    this.app = library.app;
  }

  get sections() {
    return this.plugin.settings.librarySections;
  }

  label(item) {
    if (item.kind === 'property') {
      return `By ${this.plugin.propertyLabel(item.key)}`;
    }
    if (item.kind === 'builtin') {
      const spec = LIBRARY_BUILTINS[item.id];
      return spec ? spec.label : item.id;
    }
    const target = this.app.vault.getAbstractFileByPath(item.path);
    if (!target) return `${item.path} (missing)`;
    return target instanceof TFolder ? target.name + '/' : target.basename;
  }

  icon(item) {
    if (item.kind === 'property') return 'tag';
    if (item.kind === 'builtin') {
      const spec = LIBRARY_BUILTINS[item.id];
      return spec ? spec.icon : 'circle';
    }
    return item.kind === 'folder' ? 'folder' : 'file-text';
  }

  /** Save, redraw the open views, and rebuild the settings block. */
  async commit(tab) {
    await this.plugin.saveSettings();
    this.library.refreshViews();
    tab.display();
  }

  /** A move-up, move-down, remove trio, since every row wants them. */
  controls(setting, list, index, tab, removeIcon) {
    setting.addExtraButton((b) =>
      b
        .setIcon('chevron-up')
        .setTooltip('Move up')
        .setDisabled(index === 0)
        .onClick(async () => {
          list.splice(index - 1, 0, list.splice(index, 1)[0]);
          await this.commit(tab);
        })
    );
    setting.addExtraButton((b) =>
      b
        .setIcon('chevron-down')
        .setTooltip('Move down')
        .setDisabled(index === list.length - 1)
        .onClick(async () => {
          list.splice(index + 1, 0, list.splice(index, 1)[0]);
          await this.commit(tab);
        })
    );
    setting.addExtraButton((b) =>
      b
        .setIcon(removeIcon)
        .setTooltip('Remove')
        .onClick(async () => {
          list.splice(index, 1);
          await this.commit(tab);
        })
    );
  }

  render(containerEl, tab) {
    this.sections.forEach((section, si) => {
      const head = new Setting(containerEl)
        .setClass('dr-set-section')
        .addText((t) =>
          t
            .setPlaceholder('Section heading (optional)')
            .setValue(section.title)
            .onChange(async (v) => {
              section.title = v;
              await this.plugin.saveSettings();
              this.library.refreshViews();
            })
        );
      this.controls(head, this.sections, si, tab, 'trash-2');

      (section.items || []).forEach((item, ii) => {
        const row = new Setting(containerEl)
          .setClass('dr-set-item')
          .setName(this.label(item));

        const icon = createSpan({ cls: 'dr-set-icon' });
        setIcon(icon, this.icon(item));
        row.nameEl.prepend(icon);

        this.controls(row, section.items, ii, tab, 'x');
      });

      new Setting(containerEl).setClass('dr-set-add').addButton((b) =>
        b.setButtonText('Add to this section').onClick(() => {
          new LibraryItemPicker(this.app, async (chosen) => {
            section.items.push(
              chosen.kind === 'builtin'
                ? { kind: 'builtin', id: chosen.id }
                : chosen.kind === 'property'
                  ? { kind: 'property', key: chosen.key }
                  : { kind: chosen.kind, path: chosen.path }
            );
            await this.commit(tab);
          }).open();
        })
      );
    });

    new Setting(containerEl)
      .setClass('dr-set-add')
      .addButton((b) =>
        b.setButtonText('Add section').onClick(async () => {
          this.sections.push({ title: 'New section', items: [] });
          await this.commit(tab);
        })
      )
      .addButton((b) =>
        b.setButtonText('Reset to vault layout').onClick(async () => {
          this.plugin.settings.librarySections = this.library.defaultSections();
          await this.commit(tab);
        })
      );
  }
}

