/* ------------------------------------------------------------------ */
/* Actions: what can be done, written once                             */
/*                                                                     */
/* A feature lists what it can do as { id, name, on, when(ctx),        */
/* run(ctx), menu, section }. `on` says what it acts on, and so where  */
/* it is offered:                                                      */
/*   app     nothing in particular: ctx {}                             */
/*   note    the note open: { file }                                   */
/*   file    the file open, of any kind: { file }                      */
/*   editor  the note being written in: { file, editor, view }         */
/*   folder  the folder open or picked, or the open note's: { folder } */
/* Commands are made from the list (the id is the old plugin's: a      */
/* hotkey hangs on it), and so are the entries of a menu of that       */
/* thing. `menu: false` keeps one off menus; `palette: false` off the  */
/* command palette.                                                    */
/* ------------------------------------------------------------------ */

import { MarkdownView, TFile, TFolder } from 'obsidian';

/** What an action of each kind acts on right now, or null when there is nothing of that kind. */
export const ACTION_CONTEXTS = {
  app: () => ({}),
  note: (plugin) => {
    const file = plugin.app.workspace.getActiveFile();
    return file instanceof TFile && file.extension === 'md' ? { file } : null;
  },
  file: (plugin) => {
    const file = plugin.app.workspace.getActiveFile();
    return file instanceof TFile ? { file } : null;
  },
  editor: (plugin) => {
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor || (typeof view.getMode === 'function' && view.getMode() !== 'source')) return null;
    return { file: view.file, editor: view.editor, view };
  },
  folder: (plugin) => {
    const folder = plugin.currentFolder ? plugin.currentFolder() : null;
    return folder instanceof TFolder ? { folder } : null;
  },
};

/** The context an action would run in from the palette, or null. */
export function actionContext(plugin, action) {
  const find = ACTION_CONTEXTS[action.on || 'app'];
  const ctx = find ? find(plugin) : null;
  return ctx ? Object.assign(ctx, { from: 'palette' }) : null;
}

/** Whether an action applies to a context. */
export function applies(action, ctx) {
  return !!ctx && (!action.when || !!action.when(ctx));
}

/** An action as one of Obsidian's commands. */
export function actionCommand(plugin, action) {
  return {
    id: action.id,
    name: action.name,
    ...(action.hotkeys ? { hotkeys: action.hotkeys } : {}),
    checkCallback: (checking) => {
      const ctx = actionContext(plugin, action);
      if (!applies(action, ctx)) return false;
      if (!checking) action.run(ctx);
      return true;
    },
  };
}

/** A menu entry's own menu, where Obsidian gives one (not public, so behind a check); null where it doesn't. */
export function submenu(item) {
  return typeof item.setSubmenu === 'function' ? item.setSubmenu() : null;
}

/**
 * Adds to a menu the actions that act on `on` and apply to `ctx`. Actions of
 * one `group` ("Properties") are fused into one entry that opens them; where
 * there is no such entry, they stand in the menu, the group's name before
 * each. Returns how many actions.
 */
export function addActionItems(menu, actions, on, ctx, section = 'action') {
  const apply = actions.filter((a) => (a.on || 'app') === on && a.menu !== false && applies(a, ctx));
  const dress = (item, action, before = '') => {
    item.setTitle(before + (typeof action.menu === 'string' ? action.menu : action.name)).setSection(action.section || section);
    if (action.danger && typeof item.setWarning === 'function') item.setWarning(true);
    if (action.checked && typeof item.setChecked === 'function') item.setChecked(!!action.checked(ctx));
    item.onClick(() => action.run(Object.assign({ from: 'menu' }, ctx)));
  };
  const fused = new Set();
  apply.forEach((action) => {
    const kin = action.group ? apply.filter((a) => a.group === action.group) : [];
    if (kin.length < 2) return void menu.addItem((item) => dress(item, action));
    if (fused.has(action.group)) return;
    fused.add(action.group);
    let sub = null;
    menu.addItem((item) => {
      item.setTitle(action.group).setSection(action.section || section);
      sub = submenu(item);
      if (!sub) dress(item, kin[0], `${action.group}: `);
    });
    (sub ? kin : kin.slice(1)).forEach((a) => (sub || menu).addItem((item) => dress(item, a, sub ? '' : `${action.group}: `)));
  });
  return apply.length;
}
