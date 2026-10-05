/* ------------------------------------------------------------------ */
/* What a fold holds, at a glance                                      */
/*                                                                     */
/* Pointing at what a folded branch says it holds — its +3 — lists the */
/* cards tucked into it, and picking one opens the fold and goes to it. */
/* Only where there's a pointer to point with: a touch opens the fold   */
/* instead.                                                             */
/* ------------------------------------------------------------------ */

const PEEK_DELAY = 450;

class FoldPopover {
  constructor() {
    this.el = null;
    this.anchor = null;
    this.component = null;
    this.showTimer = 0;
    this.hideTimer = 0;
    this.off = null;
  }

  /** Whether this window has a pointer that hovers. */
  static hovers(el) {
    try {
      const win = el.ownerDocument.defaultView;
      return !!win && typeof win.matchMedia === 'function' && win.matchMedia('(any-hover: hover)').matches;
    } catch (err) {
      return false;
    }
  }

  /**
   * `el` shows `fill(popoverEl, component)` after a moment under the
   * pointer, while `when()` holds — beside it, or `below` it. Set again
   * to change what it shows.
   */
  attach(el, when, fill, place) {
    const had = !!el.drPopover;
    el.drPopover = { when, fill, place: place || 'beside' };
    if (had || !FoldPopover.hovers(el)) return;
    el.addEventListener('pointerenter', (evt) => {
      if ((evt.pointerType && evt.pointerType !== 'mouse') || evt.buttons) return;
      if (!el.drPopover || !el.drPopover.when()) return;
      this.schedule(el);
    });
    el.addEventListener('pointerleave', () => this.leave());
    el.addEventListener('pointerdown', () => this.hide());
  }

  schedule(el) {
    const win = el.ownerDocument.defaultView;
    win.clearTimeout(this.hideTimer);
    if (this.el && this.anchor === el) return;
    win.clearTimeout(this.showTimer);
    this.showTimer = win.setTimeout(() => {
      const spec = el.drPopover;
      if (spec && el.isConnected && spec.when()) this.show(el, spec.fill, spec.place);
    }, PEEK_DELAY);
  }

  leave() {
    window.clearTimeout(this.showTimer);
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.hide(), 200);
  }

  show(anchor, fill, place) {
    this.hide();
    const doc = anchor.ownerDocument;
    const win = doc.defaultView;
    const el = doc.body.createDiv({ cls: 'popover hover-popover dr-fold-pop' });
    this.el = el;
    this.anchor = anchor;
    this.component = typeof Component === 'function' ? new Component() : null;
    if (this.component && typeof this.component.load === 'function') this.component.load();
    fill(el, this.component);
    // Beside what it's about — to its right if there's room, else its
    // left — or just below it, centred, above it if there's no room.
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth || 360;
    const h = el.offsetHeight || 200;
    const gap = 8;
    let left;
    let top;
    if (place === 'below') {
      left = Math.max(8, Math.min(a.left + a.width / 2 - w / 2, win.innerWidth - w - 8));
      top = a.bottom + gap + h > win.innerHeight - 8 ? Math.max(8, a.top - gap - h) : a.bottom + gap;
    } else {
      left = a.right + gap;
      if (left + w > win.innerWidth - 8) left = Math.max(8, a.left - gap - w);
      top = Math.max(8, Math.min(a.top, win.innerHeight - h - 8));
    }
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.addEventListener('pointerenter', () => win.clearTimeout(this.hideTimer));
    el.addEventListener('pointerleave', () => this.leave());
    const key = (evt) => {
      if (evt.key === 'Escape') this.hide();
    };
    const away = (evt) => {
      if (!el.contains(evt.target)) this.hide();
    };
    const wheel = (evt) => {
      if (!el.contains(evt.target)) this.hide();
    };
    doc.addEventListener('keydown', key, true);
    doc.addEventListener('pointerdown', away, true);
    doc.addEventListener('wheel', wheel, true);
    this.off = () => {
      doc.removeEventListener('keydown', key, true);
      doc.removeEventListener('pointerdown', away, true);
      doc.removeEventListener('wheel', wheel, true);
    };
  }

  hide() {
    window.clearTimeout(this.showTimer);
    window.clearTimeout(this.hideTimer);
    if (this.off) this.off();
    this.off = null;
    if (this.el) this.el.remove();
    this.el = null;
    this.anchor = null;
    if (this.component && typeof this.component.unload === 'function') this.component.unload();
    this.component = null;
  }
}

/** A card's colour, as a small mark: its own colour, or none. */
function colourMark(parent, color) {
  const mark = parent.createSpan({ cls: 'dr-fold-pop-mark' });
  const key = canvasColorKey(color);
  if (key !== 'none') {
    mark.addClass('is-colour');
    mark.style.setProperty('--dr-mark-colour', CANVAS_COLOURS[key] ? canvasPresetColour(mark, key) : key);
  }
  return mark;
}
