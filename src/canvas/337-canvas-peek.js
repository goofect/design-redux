/* ------------------------------------------------------------------ */
/* What a fold holds, at a glance                                      */
/*                                                                     */
/* Pointing at what a folded branch says it holds — its +3 — lists the */
/* cards tucked into it (the popover is ui/245), each with its colour.  */
/* Only where there's a pointer to point with: a touch opens the fold   */
/* instead.                                                             */
/* ------------------------------------------------------------------ */

import { CANVAS_COLOURS, canvasColorKey, canvasPresetColour } from './320-canvas-legend.js';

/** A card's colour, as a small mark: its own colour, or none. */
export function colourMark(parent, color) {
  const mark = parent.createSpan({ cls: 'dr-fold-pop-mark' });
  const key = canvasColorKey(color);
  if (key !== 'none') {
    mark.addClass('is-colour');
    mark.style.setProperty('--dr-mark-colour', CANVAS_COLOURS[key] ? canvasPresetColour(mark, key) : key);
  }
  return mark;
}
