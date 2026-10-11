/* ------------------------------------------------------------------ */
/* Actions, defined once                                               */
/*                                                                     */
/* Something you can do to a note — show what it relates to, give it   */
/* a child, open it in a canvas — written once and offered everywhere  */
/* it applies: the command palette (where it can have a hotkey), the   */
/* note's menu, its card's menu on a canvas, the context strip. A      */
/* feature lists them as actions(), each { id, name, menu, icon,       */
/* when(ctx), run(ctx) }, ctx being { file, node?, view?, from }.      */
/* ------------------------------------------------------------------ */

/** The note a command acts on: the one open. */
function activeNoteContext(app) {
  const file = app.workspace.getActiveFile();
  return file && file.extension === 'md' ? { file, from: 'palette' } : null;
}

/** Actions as commands: offered while there's a note they apply to; run on it. */
function actionCommands(actions, context) {
  return actions.map((a) => ({
    id: a.id,
    name: a.name,
    icon: a.icon,
    check: () => {
      const ctx = context();
      return !!ctx && a.when(ctx);
    },
    run: () => {
      const ctx = context();
      if (ctx && a.when(ctx)) a.run(ctx);
    },
  }));
}

/** The actions that apply, as one group on a menu, each by its short name. */
function addActionItems(menu, actions, ctx, title, icon, sectioned) {
  const apply = actions.filter((a) => a.when(ctx));
  if (!apply.length) return 0;
  const mark = sectioned || ((item) => (typeof item.setSection === 'function' ? item.setSection('action') : item));
  menuGroup(
    menu,
    title,
    icon,
    (m, nested) => {
      if (!nested) m = { addItem: (fn) => menu.addItem((item) => fn(mark(item, 'action'))) };
      apply.forEach((a) =>
        m.addItem((item) =>
          item
            .setTitle(nested ? a.menu || a.name : `${title}: ${a.menu || a.name}`)
            .setIcon(a.icon)
            .onClick(() => a.run(ctx))
        )
      );
    },
    'action'
  );
  return apply.length;
}

/** The same actions as a menu of their own, at a button. */
function showActionMenu(evt, actions, ctx) {
  const menu = new Menu();
  actions.filter((a) => a.when(ctx)).forEach((a) => menu.addItem((item) => item.setTitle(a.menu || a.name).setIcon(a.icon).onClick(() => a.run(ctx))));
  showMenuAt(menu, evt);
}
