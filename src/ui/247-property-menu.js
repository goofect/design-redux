/* ------------------------------------------------------------------ */
/* A property's menu, across notes                                     */
/*                                                                     */
/* One menu for a property wherever it's listed for many notes — its   */
/* page in the library, the Properties window — in the same order:     */
/* what changes it, then taking it out, set apart and marked. Each     */
/* place says only how a tool opens there: `run(tool, args)`, tool one */
/* of rename, type, merge, cleanup, missing, remove.                   */
/* ------------------------------------------------------------------ */

/**
 * `name`: the property as written; `missing`: how many notes there lack
 * it (0 or unknown: no Fill in); `where`: the notes it reaches, for
 * Remove — 'every note' or 'these notes'.
 */
export function addPropertyEntries(menu, { name, missing = 0, where = 'every note' }, run) {
  const add = (title, icon, section, tool, args, warn) =>
    menu.addItem((item) => {
      item.setTitle(title).setIcon(icon).onClick(() => run(tool, args));
      if (typeof item.setSection === 'function') item.setSection(section);
      if (warn && typeof item.setWarning === 'function') item.setWarning(true);
    });
  add('Rename', 'pencil', 'action', 'rename', { key: name });
  add('Change type…', 'shapes', 'action', 'type', { key: name });
  add('Merge with…', 'git-merge', 'action', 'merge', { keys: [name] });
  add('Clean up values…', 'sparkles', 'action', 'cleanup', { key: name });
  if (missing > 0) add(`Fill in the ${missing} without it…`, 'list-checks', 'action', 'missing', { key: name });
  add(`Remove from ${where}…`, 'trash-2', 'danger', 'remove', { keys: [name] }, true);
}
