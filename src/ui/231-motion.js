/* ------------------------------------------------------------------ */
/* Motion                                                              */
/*                                                                     */
/* How things move, decided in one place so every screen moves alike:  */
/* a screen changing, rows gliding to a new order, rows coming in one  */
/* after another. The times and curves are the stylesheet's tokens;    */
/* here is only when to use them. Nothing waits on an animation: the   */
/* page changes at once and the motion plays over it, and a new change */
/* cuts short whatever is still moving. With the Motion setting off,   */
/* or the system asking for less, every helper just makes the change.  */
/* ------------------------------------------------------------------ */

const running = new Set();
const transitions = new WeakMap();

/** 'full', 'subtle' (fades only, nothing travels) or 'off', for the document el is in. */
export function motionLevel(el) {
  const doc = (el && el.ownerDocument) || (typeof document !== 'undefined' ? document : null);
  const body = doc && doc.body;
  if (!body) return 'off';
  const win = doc.defaultView;
  if (win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'off';
  if (body.classList.contains('dr-motion-off')) return 'off';
  if (body.classList.contains('dr-motion-subtle')) return 'subtle';
  // The settings window and other windows carry no classes of ours: they move as the main one.
  if (doc !== document && typeof document !== 'undefined' && document.body) {
    if (document.body.classList.contains('dr-motion-off')) return 'off';
    if (document.body.classList.contains('dr-motion-subtle')) return 'subtle';
  }
  return 'full';
}

function token(el, name) {
  const win = el.ownerDocument.defaultView;
  return win ? win.getComputedStyle(el).getPropertyValue(name).trim() : '';
}

const ms = (el, name) => parseFloat(token(el, name)) || 0;

function track(anim) {
  if (!anim) return anim;
  running.add(anim);
  const done = () => running.delete(anim);
  anim.addEventListener('finish', done);
  anim.addEventListener('cancel', done);
  return anim;
}

function canAnimate(el) {
  return !!el && typeof el.animate === 'function';
}

/** Finishes whatever is still moving, so a new change starts from where things will be. */
export function cutShort() {
  Array.from(running).forEach((anim) => {
    try {
      anim.finish();
    } catch (e) {
      running.delete(anim);
    }
  });
}

/**
 * A screen changing in el: update() draws the new one. Where the platform has view
 * transitions, the old screen slides out and the new one in, back the other way; else the
 * new one fades and slides in over the old. Off, it's just drawn.
 */
export function transitionScreen(el, update, opts = {}) {
  const level = motionLevel(el);
  if (!el || level === 'off') return update();
  cutShort();
  const doc = el.ownerDocument;
  const root = doc.documentElement;
  const dir = opts.back ? -1 : 1;
  if (level === 'full' && typeof doc.startViewTransition === 'function') {
    const before = transitions.get(doc);
    if (before) {
      try {
        before.skipTransition();
      } catch (e) {
        /* already done */
      }
    }
    // The transition's pieces hang from the root, under the tokens set on the body: lent for the while.
    const lent = ['--dr-dur-page', '--dr-dur-leave', '--dr-ease-out', '--dr-ease-in', '--dr-slide'];
    lent.forEach((name) => root.style.setProperty(name, token(el, name)));
    root.style.setProperty('--dr-dir', String(dir));
    el.style.viewTransitionName = 'dr-screen';
    let vt;
    try {
      vt = doc.startViewTransition(() => update());
    } catch (e) {
      el.style.viewTransitionName = '';
      return update();
    }
    transitions.set(doc, vt);
    const settle = () => {
      if (transitions.get(doc) === vt) transitions.delete(doc);
      el.style.viewTransitionName = '';
      lent.concat('--dr-dir').forEach((name) => root.style.removeProperty(name));
    };
    if (vt && vt.finished && typeof vt.finished.then === 'function') vt.finished.then(settle, settle);
    else settle();
    return vt;
  }
  update();
  if (!canAnimate(el)) return null;
  const slide = level === 'full' ? dir * (parseFloat(token(el, '--dr-slide')) || 0) : 0;
  return track(
    el.animate([{ opacity: 0, transform: `translateX(${slide}px)` }, { opacity: 1, transform: 'none' }], {
      duration: ms(el, '--dr-dur-page'),
      easing: token(el, '--dr-ease-out') || 'ease-out',
    })
  );
}

/**
 * Rows that change place glide from where they were: notes where each element matching
 * selector in container is, makes the change, then moves each back and lets it go. Rows are
 * matched by their data-path where they have one, so a row drawn again in its new place still
 * glides from its old one. Only what's on screen moves; a long list's far rows just arrive.
 */
export function flip(container, selector, mutate) {
  if (!container || motionLevel(container) !== 'full') return mutate();
  const keyOf = (el) => (el.dataset && el.dataset.path) || el;
  const before = new Map(Array.from(container.querySelectorAll(selector)).map((el) => [keyOf(el), el.getBoundingClientRect().top]));
  const result = mutate();
  const duration = ms(container, '--dr-dur-move');
  const easing = token(container, '--dr-ease-out') || 'ease-out';
  if (!duration) return result;
  const view = container.getBoundingClientRect();
  const seen = (top) => top > view.top - view.height && top < view.bottom + view.height;
  Array.from(container.querySelectorAll(selector)).forEach((el) => {
    const was = before.get(keyOf(el));
    if (was === undefined || !canAnimate(el)) return;
    const now = el.getBoundingClientRect().top;
    const dy = was - now;
    if (Math.abs(dy) > 0.5 && (seen(was) || seen(now))) track(el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration, easing }));
  });
  return result;
}

/** Rows and tiles drawn for the first time come in one after another (styled by .dr-enter). */
export function enter(els) {
  const list = Array.from(els || []);
  if (!list.length || motionLevel(list[0]) === 'off') return;
  list.forEach((el, i) => {
    el.style.setProperty('--dr-i', String(i));
    el.classList.add('dr-enter');
    el.addEventListener('animationend', () => el.classList.remove('dr-enter'), { once: true });
  });
}
