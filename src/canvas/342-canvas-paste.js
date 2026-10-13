/* ------------------------------------------------------------------ */
/* Canvas: pasting lines as cards                                      */
/*                                                                     */
/* With one card selected, pasting several lines makes a card of each, */
/* below it: indented lines, list items and headings nest as they do   */
/* in the text. One line is left to the canvas, which makes a card of  */
/* it as it always has.                                                */
/* ------------------------------------------------------------------ */

import { Notice } from 'obsidian';
import { canvasReadonly, cardEditing } from '../core/079-canvas-adapter.js';
import { CanvasFeature } from './315-canvas-feature.js';
import { growCards, OUTLINE_CARD_LIMIT, outlineFromMarkdown, outlineItems, outlineSize } from './324-canvas-outlines.js';
import { isCanvasEdge } from './332-canvas-arrows.js';
import { typingInto } from './334-canvas-mindmap.js';
import { isGroupNode } from './335-canvas-fold.js';

export class CanvasPasteLines extends CanvasFeature {
  settingsSchema() {
    return [
      {
        key: 'canvasPasteLines',
        name: 'Paste lines as cards',
        desc: 'With a card selected, pasting several lines makes a card of each below it, nested as the lines are indented.',
      },
    ];
  }

  // Nothing drawn on the canvas.
  pass() {}

  mount(view, state) {
    // Pasting goes to whatever has focus, which on a canvas may be outside
    // it: listened for on the window, for this canvas while it's the page.
    state.win = view.containerEl.ownerDocument.defaultView || window;
    state.paste = (evt) => this.onPaste(view, evt);
    state.win.addEventListener('paste', state.paste, true);
  }

  cleanup(view, state) {
    if (state && state.win && state.paste) state.win.removeEventListener('paste', state.paste, true);
  }

  onPaste(view, evt) {
    if (!this.enabled || evt.defaultPrevented || typingInto(evt.target)) return;
    if (this.pageCanvas() !== view || !view.canvas || canvasReadonly(view.canvas)) return;
    const cards = this.selectedNodes(view).filter((n) => !isCanvasEdge(n));
    if (cards.length !== 1 || isGroupNode(cards[0]) || cardEditing(cards[0])) return;
    const text = evt.clipboardData ? evt.clipboardData.getData('text/plain') : '';
    const items = this.itemsOf(text);
    if (outlineSize(items) < 2) return;
    evt.preventDefault();
    evt.stopPropagation();
    this.addLines(view, cards[0], items);
  }

  /** What's pasted as an outline: headings, list items and plain lines, by how far in they are. */
  itemsOf(text) {
    return outlineFromMarkdown(String(text || ''), { lists: 'always', lines: true });
  }

  addLines(view, node, items) {
    const count = outlineSize(items);
    if (count > OUTLINE_CARD_LIMIT) {
      new Notice(`That would make ${count} cards; ${OUTLINE_CARD_LIMIT} is the most at once.`);
      return null;
    }
    const base = (view.canvas.config && view.canvas.config.defaultTextNodeDimensions) || { width: 250, height: 60 };
    return growCards(this.plugin, view, node, outlineItems(items, base), { select: true });
  }
}

CanvasPasteLines.settingKey = 'canvasPasteLines';
