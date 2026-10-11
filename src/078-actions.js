/* ------------------------------------------------------------------ */
/* Actions, defined once                                               */
/*                                                                     */
/* Something you can do — show what a note relates to, fold a card's   */
/* branch, shuffle an album — written once and offered everywhere it   */
/* applies: the command palette (where it can have a hotkey), the      */
/* menu of what it acts on, the context strip. A feature lists them as */
/* actions(), each { id, name, menu, icon, on, when(ctx), run(ctx) }:  */
/* `on` says what it acts on, and so where the palette finds it —      */
/*   app     nothing in particular (the default): ctx { from }         */
/*   note    the note open: { file }                                   */
/*   file    the file open in the page, of any kind: { file }          */
/*   editor  the note being written in: { file, editor, cm, view }     */
/*   canvas  the canvas open and its selection: { view, file, nodes,   */
/*           node — the one card selected, or null }                   */
/*   album   the album open, or the open note's: { folder }            */
/*   browse  the album open in the browse view, only: { folder, view } */
/* — and ctx.from says where it was asked: palette, menu, canvas,      */
/* strip. `menu` is its short name on a menu (a function of ctx when   */
/* it changes, false to keep it off menus), `menuIcon(ctx)` its icon   */
/* there when that changes, `checked(ctx)` a tick beside it; `hotkeys` */
/* and `palette: false` (menus only) as needed.                        */
/* ------------------------------------------------------------------ */

/** The note a command acts on: the one open. */
function activeNoteContext(app) {
  const file = app.workspace.getActiveFile();
  return file && file.extension === 'md' ? { file, from: 'palette' } : null;
}

/** The view in the page, unless it's still to load. */
function pageView(app) {
  const leaf = pageLeaf(app);
  return leaf && !leaf.isDeferred ? leaf.view : null;
}

/** A canvas and some of its cards, as an action sees them. */
function canvasContext(view, nodes, from) {
  return { view, file: view.file, nodes, node: nodes.length === 1 ? nodes[0] : null, from };
}

/** A note being written in, as an action sees it: cm is its CodeMirror view, where it can be reached. */
function editorContext(editor, view, from) {
  if (!editor) return null;
  const cm = editor.cm && editor.cm.state && typeof editor.cm.dispatch === 'function' ? editor.cm : null;
  return { file: view && view.file, editor, cm, view, from };
}

/** For a canvas's own menu: the canvas these cards are on. */
function canvasMenuContext(nodes) {
  const first = nodes && nodes[0];
  const view = first && first.canvas && first.canvas.view;
  return view && view.canvas && view.file ? canvasContext(view, nodes, 'canvas') : null;
}

const ACTION_CONTEXTS = {
  app: () => ({ from: 'palette' }),
  note: (app) => activeNoteContext(app),
  file: (app) => {
    const view = pageView(app);
    const file = view && !isBrowseView(view) && view.file instanceof TFile ? view.file : null;
    return file ? { file, from: 'palette' } : null;
  },
  editor: (app) => {
    // The editor in use — a note's, or a canvas card's being typed in — unless it's only being read.
    const ws = app.workspace;
    const view = ws.activeEditor || (typeof ws.getActiveViewOfType === 'function' ? ws.getActiveViewOfType(MarkdownView) : null);
    if (!view || (typeof view.getMode === 'function' && view.getMode() !== 'source')) return null;
    return editorContext(view.editor, view, 'palette');
  },
  canvas: (app) => {
    const view = pageView(app);
    if (!view || !view.canvas || !view.file || view.file.extension !== 'canvas') return null;
    let nodes = [];
    try {
      nodes = Array.from(view.canvas.selection || []);
    } catch (err) {
      nodes = [];
    }
    return canvasContext(view, nodes, 'palette');
  },
  album: (app) => {
    const folder = pageFolder(app);
    return folder ? { folder, from: 'palette' } : null;
  },
  // browse: the browse view adds its own (120-browse-view).
};

/** What an action acts on, found for the palette. */
function actionContext(app, action) {
  const find = ACTION_CONTEXTS[action.on || 'app'];
  return find ? find(app) : null;
}

/** Those of a list that act on one kind of thing. */
function actionsOn(actions, on) {
  return actions.filter((a) => (a.on || 'app') === on);
}

/** Whether an action can be done to this; with no when(), always. */
function applies(action, ctx) {
  return !action.when || !!action.when(ctx);
}

/** An action's name or icon on a menu: fixed, or worked out for what it's on. */
function actionLabel(action, ctx) {
  const menu = typeof action.menu === 'function' ? action.menu(ctx) : action.menu;
  return menu || action.name;
}

function actionIcon(action, ctx) {
  return (action.menuIcon && action.menuIcon(ctx)) || action.icon;
}

/** A menu entry for an action: named, with its icon and tick, run on click. */
function actionItem(item, action, ctx, title) {
  const icon = actionIcon(action, ctx);
  item.setTitle(title);
  if (icon) item.setIcon(icon);
  if (action.checked && typeof item.setChecked === 'function') item.setChecked(!!action.checked(ctx));
  return item.onClick(() => action.run(ctx));
}

/** Actions as commands: offered while there's something they apply to; run on it. */
function actionCommands(actions, context) {
  return actions
    .filter((a) => a.palette !== false)
    .map((a) => ({
      id: a.id,
      name: a.name,
      icon: a.icon,
      ...(a.hotkeys ? { hotkeys: a.hotkeys } : {}),
      check: () => {
        const ctx = context(a);
        return !!ctx && applies(a, ctx);
      },
      run: () => {
        const ctx = context(a);
        if (ctx && applies(a, ctx)) a.run(ctx);
      },
    }));
}

/** The actions that apply here, for a menu. */
function menuActions(actions, ctx) {
  return actions.filter((a) => a.menu !== false && applies(a, ctx));
}

/** The actions that apply, as one group on a menu, each by its short name. */
function addActionItems(menu, actions, ctx, title, icon, sectioned) {
  const apply = menuActions(actions, ctx);
  if (!apply.length) return 0;
  const mark = sectioned || ((item) => (typeof item.setSection === 'function' ? item.setSection('action') : item));
  menuGroup(
    menu,
    title,
    icon,
    (m, nested) => {
      if (!nested) m = { addItem: (fn) => menu.addItem((item) => fn(mark(item, 'action'))) };
      apply.forEach((a) =>
        m.addItem((item) => actionItem(item, a, ctx, nested ? actionLabel(a, ctx) : `${title}: ${actionLabel(a, ctx)}`))
      );
    },
    'action'
  );
  return apply.length;
}

/** The actions that apply, each an entry of the menu itself — the entries given back; mark sets each one's section, or names it. */
function addActionEntries(menu, actions, ctx, mark) {
  const apply = menuActions(actions, ctx);
  if (typeof mark === 'string') {
    const section = mark;
    mark = (item) => (typeof item.setSection === 'function' ? item.setSection(section) : item);
  }
  const items = [];
  apply.forEach((a) =>
    menu.addItem((item) => {
      actionItem(mark ? mark(item, 'action') : item, a, ctx, actionLabel(a, ctx));
      items.push(item);
    })
  );
  return items;
}

/** The same actions as a menu of their own, at a button. */
function showActionMenu(evt, actions, ctx) {
  const menu = new Menu();
  addActionEntries(menu, actions, ctx);
  showMenuAt(menu, evt);
}
