/* ------------------------------------------------------------------ */
/* Where you are in a note                                             */
/*                                                                     */
/* The line at the top of a note's view, and a view moved to a line,   */
/* in whichever mode it's in: what the reading outline follows.        */
/* ------------------------------------------------------------------ */

/** The line at the top of a note's view, or null. */
export function noteLine(view) {
  const mode = view && view.currentMode;
  if (!mode || typeof mode.getScroll !== 'function') return null;
  const line = mode.getScroll();
  return typeof line === 'number' && line >= 0 ? line : null;
}

/** A note's view scrolled to a line, in whichever mode it's in. */
export function scrollNoteTo(view, line) {
  if (!view || !(line >= 0)) return;
  const mode = view.currentMode;
  if (mode && typeof mode.applyScroll === 'function') mode.applyScroll(line);
  else if (typeof view.setEphemeralState === 'function') view.setEphemeralState({ line });
}
