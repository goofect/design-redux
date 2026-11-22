/* ------------------------------------------------------------------ */
/* Choosing one of many: Obsidian's own suggester, as a promise        */
/* ------------------------------------------------------------------ */

import { AbstractInputSuggest, FuzzySuggestModal } from 'obsidian';

/**
 * Offers `items` in Obsidian's suggester. { placeholder, name(item) }.
 * Resolves the item chosen, or null when it is closed without one.
 */
export function choose(app, items, opts = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    const modal = new (class extends FuzzySuggestModal {
      getItems() { return items; }
      getItemText(item) { return opts.name ? opts.name(item) : String(item); }
      onChooseItem(item) { chosen = item; resolve(item); }
      onClose() { setTimeout(() => { if (chosen === null) resolve(null); }, 0); }
    })(app);
    if (opts.placeholder && typeof modal.setPlaceholder === 'function') modal.setPlaceholder(opts.placeholder);
    modal.open();
  });
}

/** Offers the vault's folders (the vault itself first). Resolves a folder, or null. */
export function chooseFolder(plugin, opts = {}) {
  const root = plugin.app.vault.getRoot();
  const folders = [root].concat(plugin.index.folders()).filter((f) => !opts.except || !opts.except(f));
  return choose(plugin.app, folders, { placeholder: opts.placeholder || 'Move to…', name: (f) => (f.path === '/' ? 'The vault' : f.path) });
}

/**
 * Offers words for a text field while it is typed in, in Obsidian's own
 * suggester under it; nothing shows until a key is pressed. { words() →
 * [{ text, shown }] (asked once, when first wanted), list (the part after
 * the last comma is what is matched and replaced), picked(word) }. Enter
 * and Escape are the suggester's while it is open. Returns how to stop.
 */
export function suggestInto(app, input, opts) {
  let typed = false;
  let words = null;
  // Listened to before the suggester's own, so the first key typed already counts.
  input.addEventListener('input', () => (typed = true));
  const split = () => {
    const at = opts.list ? input.value.lastIndexOf(',') : -1;
    return { before: at < 0 ? '' : `${input.value.slice(0, at + 1)} `, query: input.value.slice(at + 1).trim().toLowerCase() };
  };
  const suggest = new (class extends AbstractInputSuggest {
    getSuggestions() {
      if (!typed) return [];
      words = words || opts.words();
      const { before, query } = split();
      const taken = new Set(before.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
      const open = words.filter((w) => !taken.has(w.text.toLowerCase()) && w.text.toLowerCase() !== query);
      if (!query) return open;
      const starts = (w) => w.text.toLowerCase().startsWith(query) || w.shown.toLowerCase().startsWith(query);
      const holds = (w) => w.text.toLowerCase().includes(query) || w.shown.toLowerCase().includes(query);
      return open.filter(starts).concat(open.filter((w) => !starts(w) && holds(w)));
    }
    renderSuggestion(w, el) { el.textContent = w.shown; }
    selectSuggestion(w) {
      input.value = split().before + w.text + (opts.list ? ', ' : '');
      this.close();
      if (opts.picked) opts.picked(w);
    }
  })(app, input);
  suggest.limit = 10;
  return () => suggest.close();
}
