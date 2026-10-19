/* ------------------------------------------------------------------ */
/* Due dates                                                           */
/*                                                                    */
/* The date properties named as due dates — due, deadline — marked     */
/* where they show: overdue, today, soon. The library's filters take   */
/* what's due soon or overdue, and a saved view keeps it. A date can   */
/* be typed as tomorrow, +2w or friday in the property tools.          */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { dueKeys } from '../core/045-helpers-properties.js';
import { Feature } from '../core/080-feature.js';
import { BrowseView } from './120-browse-view.js';
import { SmartAlbums } from './258-smart-albums.js';

export class PropertyDates extends Feature {
  settingsSchema() {
    return [
      {
        key: 'propertyDueChips',
        name: 'Due dates',
        desc: 'Dates in the properties named below marked where they show — overdue, due today, due in the next few days — and a filter for what’s due. In the property tools a date can be typed as tomorrow, +2w or friday.',
      },
      {
        key: 'propertyDueKeys',
        type: 'text',
        showIf: 'propertyDueChips',
        name: 'Due-date properties',
        desc: 'Their names, by commas.',
      },
    ];
  }

  actions() {
    return [
      {
        id: 'saved-view-due',
        name: 'Keep a saved view of what’s due',
        icon: 'alarm-clock',
        when: () => dueKeys(this.settings).length > 0 && !!this.plugin.feature(SmartAlbums) && this.plugin.feature(SmartAlbums).enabled,
        run: () => this.keepDueView(),
      },
    ];
  }

  /** A saved view of the notes due soon or overdue, by the first due-date property; opened. */
  keepDueView() {
    const smart = this.plugin.feature(SmartAlbums);
    const key = dueKeys(this.settings)[0];
    if (!smart || !key) return null;
    const name = 'Due';
    const have = smart.list().find((a) => a.prop && a.prop.due && String(a.prop.key).toLowerCase() === key.toLowerCase());
    if (have) {
      new Notice(`There’s a saved view of what’s due already: “${have.name}”.`);
      return have;
    }
    const album = { id: `due${Date.now().toString(36)}`, name, folder: null, tag: null, prop: { key, value: null, negate: false, due: true }, date: null };
    this.settings.smartAlbumList = smart.list().concat(album);
    smart.listInLibrary();
    smart.persist();
    const ws = this.app.workspace;
    const view = typeof ws.getActiveViewOfType === 'function' ? ws.getActiveViewOfType(BrowseView) : null;
    if (view) view.navigate({ mode: 'smart', property: album.id, path: '/' });
    return album;
  }
}

PropertyDates.settingKey = 'propertyDueChips';
