/* Classes stable enough to anchor a dropped icon to. */
const HEADER_ANCHORS = [
  'workspace-tab-header-container-inner',
  'workspace-tab-header-new-tab',
  'dr-trigger',
  'dr-settings-moved',
  'workspace-tab-header-spacer',
  'workspace-tab-header-tab-list',
  'sidebar-toggle-button',
];

function anchorClassOf(el) {
  if (!el) return null;
  for (const cls of HEADER_ANCHORS) {
    if (el.classList.contains(cls)) return cls;
  }
  return null;
}

/** Put an icon where it was last dropped, falling back to a default. */
function placeInHeader(header, el, anchor, fallback) {
  if (anchor === 'start') {
    header.prepend(el);
    return;
  }
  const target = anchor && header.querySelector(`.${anchor}`);
  if (target && target !== el && !target.contains(el)) {
    target.insertAdjacentElement('afterend', el);
    return;
  }
  fallback();
}

/**
 * The two icons, each after its saved neighbour. Whichever is placed
 * first can't follow the other, which isn't there yet; this runs after
 * each, so both end up where they were left.
 */
function settleHeader(header, order) {
  [
    ['.dr-trigger', order.actions],
    ['.dr-settings-moved', order.settings],
  ].forEach(([selector, anchor]) => {
    const el = header.querySelector(selector);
    if (!el || !anchor || anchor === 'start') return;
    placeInHeader(header, el, anchor, () => {});
  });
}

/**
 * Drag an icon along the header.
 *
 * The drop position is stored as the class of whatever it follows
 * rather than an index, so it survives Obsidian rebuilding the row and
 * doesn't shift when a tab is opened or closed.
 */
function makeHeaderDraggable(el, key, plugin) {
  // Obsidian's own gear can be made draggable more than once; its
  // earlier listeners go first, so they don't pile up.
  if (el.drDragOff) el.drDragOff();
  el.setAttribute('draggable', 'true');

  const start = (evt) => {
    evt.dataTransfer.setData('text/dr-header', key);
    evt.dataTransfer.effectAllowed = 'move';
    el.addClass('is-dragging');
    const header = el.parentElement;
    if (header) header.addClass('dr-header-dropping');
  };
  const end = () => {
    el.removeClass('is-dragging');
    document
      .querySelectorAll('.dr-header-dropping')
      .forEach((h) => h.removeClass('dr-header-dropping'));
    document
      .querySelectorAll('.dr-drop-before')
      .forEach((h) => h.removeClass('dr-drop-before'));
  };
  el.addEventListener('dragstart', start);
  el.addEventListener('dragend', end);
  el.drDragOff = () => {
    el.removeEventListener('dragstart', start);
    el.removeEventListener('dragend', end);
    el.removeAttribute('draggable');
    delete el.drDragOff;
  };

  // The header is Obsidian's, and outlives this plugin: its drop
  // handlers belong to one running copy, and go when that copy does —
  // so after an update or a reload, drops reach the copy now running.
  const header = el.parentElement;
  if (!header || header.drDropOwner === plugin) return;
  if (header.drDropOff) header.drDropOff();

  const nearest = (evt) => {
    const kids = Array.from(header.children).filter(
      (c) => !c.classList.contains('is-dragging')
    );
    for (const kid of kids) {
      const r = kid.getBoundingClientRect();
      if (evt.clientX < r.left + r.width / 2) return kid;
    }
    return null;
  };

  const over = (evt) => {
    if (!Array.from(evt.dataTransfer.types).includes('text/dr-header')) return;
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'move';

    const before = nearest(evt);
    header
      .querySelectorAll('.dr-drop-before')
      .forEach((h) => h.removeClass('dr-drop-before'));
    if (before) before.addClass('dr-drop-before');
  };

  const drop = async (evt) => {
    const dropped = evt.dataTransfer.getData('text/dr-header');
    if (!dropped) return;
    evt.preventDefault();

    const moving = header.querySelector(
      dropped === 'actions' ? '.dr-trigger' : '.dr-settings-moved'
    );
    if (!moving) return;

    const before = nearest(evt);
    if (before) header.insertBefore(moving, before);
    else header.appendChild(moving);

    // Stored by what it now follows, so the position survives a rebuild.
    const previous = moving.previousElementSibling;
    plugin.settings.headerOrder[dropped] = anchorClassOf(previous) || 'start';
    await plugin.saveData(plugin.settings);

    header
      .querySelectorAll('.dr-drop-before')
      .forEach((h) => h.removeClass('dr-drop-before'));
  };

  header.addEventListener('dragover', over);
  header.addEventListener('drop', drop);
  header.drDropOwner = plugin;
  header.drDropOff = () => {
    header.removeEventListener('dragover', over);
    header.removeEventListener('drop', drop);
    delete header.drDropOwner;
    delete header.drDropOff;
  };
  plugin.register(() => {
    if (header.drDropOwner === plugin && header.drDropOff) header.drDropOff();
  });
}

/**
 * Park a hidden button row beneath a trigger.
 *
 * Buttons that open their own submenu anchor to their bounding box, so
 * hiding the row outright sends those submenus to the screen corner.
 * The CSS positions the row from these variables; it stays invisible
 * and inert but keeps a real, measurable position.
 */
function parkAt(rect) {
  document.body.style.setProperty('--dr-park-x', `${rect.left}px`);
  document.body.style.setProperty('--dr-park-y', `${rect.bottom + 4}px`);
}

function unpark() {
  document.body.style.removeProperty('--dr-park-x');
  document.body.style.removeProperty('--dr-park-y');
}

/**
 * A suggestion list matching the panel rather than the OS.
 *
 * A native datalist can't be styled — Electron draws it as a system
 * widget — so the list is built here. It lives on body and is fixed,
 * because the panel scrolls and an absolutely positioned child would
 * be clipped by its overflow box.
 */
function attachSuggest(field, input, opts) {
  const list = document.body.createDiv({ cls: 'dr-suggest' });
  let items = [];
  let active = -1;

  const hide = () => {
    list.removeClass('is-open');
    list.empty();
    items = [];
    active = -1;
  };

  const place = () => {
    const r = input.getBoundingClientRect();
    const width = Math.max(r.width, 180);
    const below = window.innerHeight - r.bottom;
    list.style.left = `${Math.min(r.left, window.innerWidth - width - 8)}px`;
    list.style.width = `${width}px`;
    if (below < 190 && r.top > below) {
      list.style.top = '';
      list.style.bottom = `${window.innerHeight - r.top + 4}px`;
    } else {
      list.style.bottom = '';
      list.style.top = `${r.bottom + 4}px`;
    }
  };

  const paint = () => {
    Array.from(list.children).forEach((c, i) => {
      if (i === active) c.addClass('is-selected');
      else c.removeClass('is-selected');
    });
  };

  const show = () => {
    // A list field suggests for the item being typed, not the whole line.
    const q = (opts.query ? opts.query() : input.value).trim().toLowerCase();
    items = opts
      .source()
      .filter((t) => t.toLowerCase().includes(q) && t.toLowerCase() !== q)
      .slice(0, 8);

    list.empty();
    if (!items.length) return hide();

    items.forEach((t) => {
      const el = list.createDiv({ cls: 'dr-suggest-item' });
      if (opts.icon) setIcon(el.createSpan({ cls: 'dr-suggest-icon' }), opts.icon);
      el.createSpan({ text: t });
      // mousedown, not click: blur would tear the list down first.
      el.addEventListener('mousedown', (evt) => {
        evt.preventDefault();
        opts.onSelect(t);
        hide();
      });
    });
    active = -1;
    place();
    list.addClass('is-open');
  };

  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => window.setTimeout(hide, 120));

  input.addEventListener('keydown', (evt) => {
    if (!list.hasClass('is-open')) return;
    if (evt.key === 'ArrowDown') {
      evt.preventDefault();
      active = Math.min(active + 1, items.length - 1);
      paint();
    } else if (evt.key === 'ArrowUp') {
      evt.preventDefault();
      active = Math.max(active - 1, 0);
      paint();
    } else if (evt.key === 'Enter' && active >= 0 && !composing(evt)) {
      evt.preventDefault();
      evt.stopImmediatePropagation();
      opts.onSelect(items[active]);
      hide();
    } else if (evt.key === 'Escape') {
      evt.stopImmediatePropagation();
      hide();
    }
  });

  return list;
}

