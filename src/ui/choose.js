/* ------------------------------------------------------------------ */
/* Choosing one of many: Obsidian's own suggester, as a promise        */
/* ------------------------------------------------------------------ */

import { FuzzySuggestModal } from 'obsidian';

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
