/* ------------------------------------------------------------------ */
/* Panel: where a note is named in other notes' properties              */
/*                                                                    */
/* The notes that link to this one from a property — parent, related, */
/* author — grouped by the property, so "these name it as their       */
/* parent" reads apart from a passing link in a paragraph. Read from    */
/* the library's index and Obsidian's cache of frontmatter links.       */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { libraryIndex } from '../core/077-library-index.js';
import { Feature } from '../core/080-feature.js';
import { PanelSection } from '../core/082-panel-section.js';

/** The notes naming `file` in a property, by the property: Map key -> [files], keys as first written. */
export function namedBy(app, index, file) {
  const out = new Map();
  const names = new Map();
  Object.keys(index.incoming(file) || {}).forEach((from) => {
    const source = app.vault.getAbstractFileByPath(from);
    if (!(source instanceof TFile) || source === file) return;
    const cache = app.metadataCache.getFileCache(source);
    (cache && Array.isArray(cache.frontmatterLinks) ? cache.frontmatterLinks : []).forEach((l) => {
      const path = String(l.link || '').split('#')[0].split('|')[0];
      if (app.metadataCache.getFirstLinkpathDest(path, source.path) !== file) return;
      // A list's items come as key.0, key.1: the property is the key.
      const key = String(l.key || '').replace(/\.\d+$/, '');
      const low = key.toLowerCase();
      if (!names.has(low)) names.set(low, key);
      const list = out.get(names.get(low)) || [];
      if (!list.includes(source)) list.push(source);
      out.set(names.get(low), list);
    });
  });
  return out;
}

export class ReferencesSection extends PanelSection {
  get cls() {
    return 'dr-references-section';
  }

  render() {
    const groups = this.file ? namedBy(this.app, libraryIndex(this.plugin), this.file) : new Map();
    this.containerEl.toggleClass('is-empty', !groups.size);
    Array.from(groups.keys())
      .sort((a, b) => a.localeCompare(b))
      .forEach((key) =>
        this.renderList(`named-${key.toLowerCase()}`, `Named as ${key} by`, groups.get(key).slice().sort((a, b) => a.basename.localeCompare(b.basename)), (list, f) => this.fileRow(list, f))
      );
  }
}

export class PropertyLinks extends Feature {
  settingsSchema() {
    return [
      {
        key: 'propertyLinks',
        name: 'Notes linked from properties',
        desc: 'In the note panel, the notes that name this one in a property, by the property — named as parent by, as related by. And on a property’s menu there, Link a note…, to pick a note or make one.',
      },
    ];
  }

  panelSections(panel) {
    return [new ReferencesSection(panel)];
  }
}

PropertyLinks.settingKey = 'propertyLinks';
