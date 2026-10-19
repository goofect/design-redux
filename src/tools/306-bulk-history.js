/* ------------------------------------------------------------------ */
/* Property history: the feature                                       */
/*                                                                    */
/* Each change the plugin writes to a note's properties is kept — the */
/* key, what it was, what it became, when — the last so many a note,   */
/* in the plugin's data by the note's path, following it when it's     */
/* renamed. The note panel lists them, newest first, each with Put     */
/* back for that one value, the rest left as they are.                 */
/* ------------------------------------------------------------------ */

import { asButton, onActivate } from '../core/040-helpers-sorting.js';
import { Feature } from '../core/080-feature.js';
import { PanelSection } from '../core/082-panel-section.js';
import { diffProps, historyOf, withEntry } from '../core/089-property-history.js';
import { keyLike } from './288-bulk-values.js';

/* How long after a change its history is saved: changes in a burst saved once. */
const HISTORY_SAVE_DELAY = 1500;

/** A value as the history shows it. */
function shown(v) {
  if (v === null || v === undefined || v === '') return '—';
  return Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/** When, as a person says it: just now, 5 min ago, yesterday, or the date. */
export function whenSaid(at, now) {
  const s = Math.max(0, Math.round(((now || Date.now()) - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return new Date(at).toLocaleDateString();
}

export class HistorySection extends PanelSection {
  get cls() {
    return 'dr-history-section';
  }

  render() {
    const lines = this.file ? historyOf(this.settings.propertyHistory, this.file.path) : [];
    this.containerEl.toggleClass('is-empty', !lines.length);
    if (!lines.length) return;
    this.renderList('history', 'Property history', lines, (list, line) => {
      const row = list.createDiv({ cls: `dr-history-line is-${line.how}` });
      const what = row.createDiv({ cls: 'dr-history-what' });
      what.createSpan({ cls: 'dr-history-key', text: line.key });
      what.createSpan({ cls: 'dr-history-change', text: line.how === 'added' ? `added: ${shown(line.after)}` : line.how === 'removed' ? `removed: was ${shown(line.before)}` : `${shown(line.before)} → ${shown(line.after)}` });
      row.createSpan({ cls: 'dr-history-when', text: whenSaid(line.at) });
      const back = row.createSpan({ cls: 'dr-history-back', text: 'Put back' });
      asButton(back, `Put “${line.key}” back as it was`);
      onActivate(back, () => this.putBack(line));
    });
  }

  /** One value as it was before a change, the rest left as they are: one step of Undo. */
  putBack(line) {
    const file = this.file;
    if (!file) return null;
    const doc = this.containerEl.ownerDocument;
    if (doc.activeElement && this.containerEl.contains(doc.activeElement) && typeof doc.activeElement.blur === 'function') doc.activeElement.blur();
    return this.plugin.notes.write(
      file,
      (fm) => {
        const name = keyLike(fm, line.key);
        if (line.how === 'added') {
          if (name !== undefined) delete fm[name];
        } else fm[name === undefined ? line.key : name] = JSON.parse(JSON.stringify(line.before));
      },
      { undo: `Put “${line.key}” back.` }
    );
  }
}

export class PropertyHistory extends Feature {
  settingsSchema() {
    return [
      {
        key: 'propertyHistoryLimit',
        type: 'dropdown',
        name: 'Property history',
        desc: 'The last changes made here to each note’s properties — in the note panel, newest first, each with Put back. How many to keep for each note; kept with the plugin’s settings.',
        options: { 0: 'None', 10: 'The last 10', 20: 'The last 20', 50: 'The last 50' },
      },
    ];
  }

  register() {
    if (!this.plugin.notes || typeof this.plugin.notes.watch !== 'function') return;
    const stop = this.plugin.notes.watch((record) => this.keep(record));
    if (typeof this.plugin.register === 'function') this.plugin.register(stop);
  }

  /** A write's changes kept for its note, saved a moment later with any others. */
  keep(record, at) {
    const limit = Number(this.settings.propertyHistoryLimit) || 0;
    if (!this.enabled || !limit || !record || !record.file) return;
    const entry = { at: at || Date.now(), changes: diffProps(record.before, record.after) };
    this.settings.propertyHistory = withEntry(this.settings.propertyHistory, record.file.path, entry, limit);
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.plugin.saveData(this.settings), HISTORY_SAVE_DELAY);
  }

  panelSections(panel) {
    return [new HistorySection(panel)];
  }
}

PropertyHistory.settingKey = 'propertyHistoryLimit';
