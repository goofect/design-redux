/* ------------------------------------------------------------------ */
/* The page and its history                                            */
/*                                                                     */
/* Which tab is the page, back and forward through it, and the views   */
/* the plugin has open.                                                */
/* ------------------------------------------------------------------ */

import { Platform, TFile } from 'obsidian';
import { BROWSE_VIEW } from './020-constants.js';

/**
 * The real views of a type, skipping deferred leaves.
 *
 * Since Obsidian 1.7.2 a leaf that hasn't been shown yet holds a
 * placeholder view, not the plugin's own — so anything reached through
 * getLeavesOfType has to be checked before its methods are used.
 */
export function liveViews(app, type, ctor) {
  // Without the class, by the view's type: so a view can be found by what imports neither.
  const live = (view) => (ctor ? view instanceof ctor : !!view && typeof view.getViewType === 'function' && view.getViewType() === type);
  return app.workspace
    .getLeavesOfType(type)
    .filter((leaf) => !leaf.isDeferred && live(leaf.view))
    .map((leaf) => leaf.view);
}

/** The view of the tab in use, if it's of this type: getActiveViewOfType, by type rather than class. */
export function activeViewOfType(app, type) {
  const leaf = app.workspace.activeLeaf;
  const view = leaf && leaf.view;
  return view && typeof view.getViewType === 'function' && view.getViewType() === type ? view : null;
}

/* -- the page and its history --------------------------------------- */

/**
 * The page: the main area's most recent leaf. Not the focused one, so
 * clicking into the sidebar doesn't change what "the page" means.
 */
export function pageLeaf(app) {
  const ws = app.workspace;
  // The leaf in use, when it's in the main area, is the most recent there.
  // Asked of Obsidian only otherwise: since 1.14 that question lays the
  // window out first, which right after a large redraw costs tens of ms.
  const active = ws.activeLeaf;
  if (active && typeof active.getRoot === 'function' && active.getRoot() === ws.rootSplit) return active;
  return ws.getMostRecentLeaf(ws.rootSplit) || null;
}

/**
 * A leaf's back and forward stacks.
 *
 * History belongs to the leaf, not to whichever view is in it. Asking a
 * view was the bug behind dead back buttons: opening a note replaces
 * the screen you came from in the same leaf, leaving nothing to ask.
 * Not public API, so every use is guarded.
 */
export function leafHistory(leaf) {
  const h = leaf && leaf.history;
  return h && typeof h.back === 'function' ? h : null;
}

export function canStep(leaf, dir) {
  const h = leafHistory(leaf);
  if (!h) return false;
  const stack = dir === 'back' ? h.backHistory : h.forwardHistory;
  return !!(stack && stack.length);
}

export function step(leaf, dir) {
  const h = leafHistory(leaf);
  if (!h) return;
  if (dir === 'back') h.back();
  else h.forward();
}

/**
 * Wrap an object's method, returning a function that undoes it.
 *
 * If something else has wrapped the method since, putting the original
 * back would throw that wrapper away too, so ours becomes a pass-through
 * instead. It's the approach monkey-around takes, and what lets plugins
 * that patch the same method coexist.
 */
export function around(obj, method, wrap) {
  const original = obj[method];
  const hadOwn = Object.prototype.hasOwnProperty.call(obj, method);
  let active = true;
  const wrapper = function (...args) {
    return active ? wrap(original, this, args) : original.apply(this, args);
  };
  obj[method] = wrapper;
  return () => {
    active = false;
    if (obj[method] !== wrapper) return;
    if (hadOwn) obj[method] = original;
    else delete obj[method];
  };
}

/** Undo the sidebar panel shape wherever it was applied. */
export function clearSidebarChrome() {
  document.body.removeClass('dr-left-collapsed');
  document
    .querySelectorAll('.dr-apple-sidebar')
    .forEach((el) => el.removeClass('dr-apple-sidebar'));
  document
    .querySelectorAll('[data-dr-initial]')
    .forEach((el) => el.removeAttribute('data-dr-initial'));
}

/**
 * Whether the single content area applies. It hides desktop chrome —
 * the tab bar, the view header, the status bar — and on a phone or
 * tablet that chrome is how Obsidian itself is driven.
 */
export function singleAreaOn(settings) {
  return !!settings.singleArea && !Platform.isMobile;
}

/** The note on the page, if the page is a note (not a screen of the browse view). */
export function pageFile(app) {
  const leaf = pageLeaf(app);
  const view = leaf && !leaf.isDeferred ? leaf.view : null;
  return view && !isBrowseView(view) && view.file instanceof TFile ? view.file : null;
}

/** Whether a view is the browse view: known by its type, so a helper needn't know the class. */
export function isBrowseView(view) {
  return !!view && typeof view.getViewType === 'function' && view.getViewType() === BROWSE_VIEW;
}

/**
 * The folder the page is in: the one a folder screen shows, or the one
 * holding the note that's open.
 */
export function pageFolder(app) {
  const leaf = pageLeaf(app);
  const view = leaf && !leaf.isDeferred ? leaf.view : null;
  if (isBrowseView(view)) return view.mode === 'folder' ? view.folder() : null;
  return view && view.file instanceof TFile ? view.file.parent : null;
}
