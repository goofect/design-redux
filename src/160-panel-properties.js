/* ------------------------------------------------------------------ */
/* Properties                                                          */
/*                                                                     */
/* Rows are this plugin's markup. Each value cell is rendered by       */
/* Obsidian's own widget for that property's type, so date pickers,    */
/* link autocomplete, pill rendering and validation are the real       */
/* ones. Writes go through processFrontMatter, which is atomic.        */
/* ------------------------------------------------------------------ */

class PropertiesSection extends PanelSection {
  get cls() {
    return 'dr-properties';
  }

  get frontmatter() {
    const cache = this.app.metadataCache.getFileCache(this.file);
    return (cache && cache.frontmatter) || {};
  }

  render() {
    this.dropSuggests();
    const fm = this.frontmatter;
    const keys = Object.keys(fm).filter((k) => k !== 'position');

    const list = this.containerEl.createDiv({ cls: 'dr-rows' });
    if (!keys.length) {
      list.createDiv({ cls: 'dr-empty', text: 'No properties' });
    }
    keys.forEach((key) => this.renderRow(list, key, fm[key]));

    this.renderAdd(this.containerEl, keys);
  }

  renderRow(parentEl, key, value) {
    const type = this.typeOf(key);
    const row = parentEl.createDiv({ cls: 'dr-row' });
    row.setAttribute('data-property-type', type);
    row.dataset.key = key;

    // A grip at the row's edge, shown when pointed at: the plain way to
    // move it. The type icon still drags too, as in Obsidian's own block.
    const grip = row.createDiv({ cls: 'dr-row-grip' });
    grip.setAttribute('aria-hidden', 'true');
    setIcon(grip, 'grip-vertical');
    this.makeDraggable(parentEl, row, grip);

    const keyEl = row.createDiv({ cls: 'dr-key' });
    // The type icon is the row's handle, as in Obsidian's own block:
    // press and drag to move the property, click for its menu.
    const icon = keyEl.createSpan({ cls: 'dr-key-icon' });
    icon.setAttribute('aria-label', `${TYPE_LABELS[type] || type} — drag to move`);
    icon.setAttribute('role', 'button');
    icon.setAttribute('tabindex', '0');
    setIcon(icon, TYPE_ICONS[type] || 'text');
    icon.addEventListener('click', (evt) => {
      evt.stopPropagation();
      if (this.justMoved) return;
      this.showMenu(key, icon);
    });
    icon.addEventListener('keydown', (evt) => {
      if (evt.altKey && (evt.key === 'ArrowUp' || evt.key === 'ArrowDown')) {
        evt.preventDefault();
        if (this.moveRow(row, evt.key === 'ArrowUp' ? -1 : 1)) icon.focus();
      } else if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        this.showMenu(key, icon);
      }
    });
    this.makeDraggable(parentEl, row, icon);

    const name = keyEl.createEl('input', { cls: 'dr-key-name', type: 'text' });
    name.value = key;
    name.setAttribute('aria-label', key);
    name.addEventListener('change', () => {
      const next = name.value.trim();
      if (!next || next === key) {
        name.value = key;
        return;
      }
      this.rename(key, next);
    });

    const valueEl = row.createDiv({ cls: 'dr-value' });
    if (!this.renderWidget(valueEl, key, value, type)) {
      this.renderFallback(valueEl, key, value);
    }

    // Taken off in one press, with an Undo, rather than from a menu.
    const remove = row.createDiv({ cls: 'clickable-icon dr-row-remove' });
    remove.setAttribute('role', 'button');
    remove.setAttribute('tabindex', '0');
    remove.setAttribute('aria-label', `Remove ${key}`);
    setIcon(remove, 'x');
    onActivate(remove, () => this.remove(key));
  }

  /**
   * Take a property off the note, saying so with an Undo that puts it
   * back — its value and its place — since the note has no undo of its
   * own for this.
   */
  async remove(key) {
    const file = this.file;
    const fm = this.frontmatter;
    const order = Object.keys(fm).filter((k) => k !== 'position');
    const value = fm[key] === undefined ? null : JSON.parse(JSON.stringify(fm[key]));
    await this.write(key, undefined);
    if (typeof this.plugin.offerUndo !== 'function') return;
    this.plugin.offerUndo(`Removed “${key}”.`, () => this.putBack(file, key, value, order));
  }

  /** A removed property back, where it was — unless one of that name has been added since. */
  async putBack(file, key, value, order) {
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (Object.keys(fm).some((k) => k.toLowerCase() === key.toLowerCase())) return;
        fm[key] = value;
        const keys = Object.keys(fm).filter((k) => k !== 'position');
        const sorted = order
          .filter((k) => keys.indexOf(k) !== -1)
          .concat(keys.filter((k) => order.indexOf(k) === -1));
        const entries = sorted.map((k) => [k, fm[k]]);
        keys.forEach((k) => delete fm[k]);
        entries.forEach(([k, v]) => {
          fm[k] = v;
        });
      });
      if (this.file === file) this.afterWrite(file);
    } catch (err) {
      console.error('Design Redux: could not put the property back', err);
      new Notice('Could not put the property back.');
    }
  }

  /** The properties in the order the rows now show them. */
  orderIn(list) {
    return Array.from(list.querySelectorAll(':scope > .dr-row')).map((r) => r.dataset.key);
  }

  /**
   * Drag a row by its handle. Nothing happens until the pointer has
   * moved a few pixels, so a press that doesn't move is still a click.
   * The row moves among the others as it's dragged, and the new order
   * is written when it's let go; Escape puts everything back. Pointer
   * events, not the browser's drag and drop, so it works the same with
   * a finger on a phone.
   */
  makeDraggable(list, row, handle) {
    handle.addEventListener('pointerdown', (down) => {
      if (down.button !== undefined && down.button !== 0) return;
      const startY = down.clientY;
      const before = this.orderIn(list);
      const scroller = this.panel && this.panel.popupEl;
      let dragging = false;

      const place = (y) => {
        const others = Array.from(list.querySelectorAll(':scope > .dr-row')).filter(
          (r) => r !== row
        );
        const next = others.find((r) => {
          const box = r.getBoundingClientRect();
          return y < box.top + box.height / 2;
        });
        if (next) {
          if (row.nextElementSibling !== next) list.insertBefore(row, next);
        } else if (list.lastElementChild !== row) {
          list.appendChild(row);
        }
      };

      // Near the top or bottom of a long panel, it scrolls to follow.
      const follow = (y) => {
        if (!scroller || typeof scroller.getBoundingClientRect !== 'function') return;
        const box = scroller.getBoundingClientRect();
        if (y < box.top + 28) scroller.scrollTop -= 10;
        else if (y > box.bottom - 28) scroller.scrollTop += 10;
      };

      const move = (evt) => {
        if (!dragging) {
          if (Math.abs(evt.clientY - startY) < 4) return;
          dragging = true;
          row.addClass('is-dragging');
          list.addClass('is-sorting');
        }
        if (evt.cancelable) evt.preventDefault();
        follow(evt.clientY);
        place(evt.clientY);
      };

      const finish = (keep) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('keydown', escape, true);
        if (!dragging) return;
        row.removeClass('is-dragging');
        list.removeClass('is-sorting');
        // The click that ends a drag isn't a request for the menu.
        this.justMoved = true;
        window.setTimeout(() => (this.justMoved = false), 0);

        const after = this.orderIn(list);
        if (!keep) {
          before.forEach((k) => {
            const r = list.querySelector(`:scope > .dr-row[data-key="${CSS.escape(k)}"]`);
            if (r) list.appendChild(r);
          });
          return;
        }
        if (after.join('\n') !== before.join('\n')) this.reorder(after);
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const escape = (evt) => {
        if (evt.key !== 'Escape' || !dragging) return;
        evt.preventDefault();
        evt.stopPropagation();
        finish(false);
      };

      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', escape, true);
    });
  }

  /** One place up or down, from the keyboard or the menu. */
  moveRow(row, delta) {
    const list = row.parentElement;
    if (!list) return false;
    const rows = Array.from(list.querySelectorAll(':scope > .dr-row'));
    const at = rows.indexOf(row);
    const to = at + delta;
    if (at === -1 || to < 0 || to >= rows.length) return false;
    list.insertBefore(row, delta < 0 ? rows[to] : rows[to].nextElementSibling);
    this.reorder(this.orderIn(list));
    return true;
  }

  /**
   * Obsidian's own editor for this type.
   *
   * registeredTypeWidgets holds the factories behind the native
   * property block; each exposes render(containerEl, value, ctx). The
   * context shape isn't documented, so every plausible field is passed
   * and the call is guarded.
   */
  renderWidget(parentEl, key, value, type) {
    try {
      const widgets = this.app.metadataTypeManager.registeredTypeWidgets;
      const widget = widgets && widgets[type];
      if (!widget || typeof widget.render !== 'function') return false;

      widget.render(parentEl, value, {
        app: this.app,
        key: key,
        sourcePath: this.file.path,
        blur: () => {},
        onChange: (v) => this.write(key, v, { redraw: false }),
        rendered: true,
        metadataEditor: {
          app: this.app,
          register: () => {},
          sourcePath: this.file.path,
        },
      });
      return parentEl.childElementCount > 0;
    } catch (err) {
      console.error('Design Redux: value widget failed', err);
      parentEl.empty();
      return false;
    }
  }

  /** Plain text, for when a widget isn't available. */
  renderFallback(parentEl, key, value) {
    const input = parentEl.createEl('input', { cls: 'dr-input', type: 'text' });
    input.value = value == null ? '' : String(value);
    input.addEventListener('change', () => this.write(key, input.value, { redraw: false }));
  }

  renderAdd(parentEl, existing) {
    const add = parentEl.createDiv({ cls: 'dr-add' });
    const icon = add.createSpan({ cls: 'dr-add-icon' });
    setIcon(icon, 'plus');

    const field = add.createDiv({ cls: 'dr-field' });
    const input = field.createEl('input', { type: 'text' });
    input.placeholder = 'Add property';

    // A name the note already has goes to that property instead of
    // writing over it with an empty value.
    const commit = (name) => {
      const key = (name === undefined ? input.value : name).trim();
      if (!key) return;
      input.value = '';
      const have = Object.keys(this.frontmatter).find(
        (k) => k !== 'position' && k.toLowerCase() === key.toLowerCase()
      );
      if (have) {
        const row = this.containerEl.querySelector(`.dr-row[data-key="${CSS.escape(have)}"]`);
        const target = row && row.querySelector('.dr-value input, .dr-value [contenteditable], .dr-value textarea');
        if (target) target.focus();
        new Notice(`This note already has "${have}".`);
        return;
      }
      this.write(key, '', { onlyNew: true });
    };

    const have = existing.map((k) => k.toLowerCase());
    this.suggests.push(attachSuggest(field, input, {
      icon: 'tag',
      source: () =>
        this.knownProperties().filter(
          (n) => have.indexOf(n.toLowerCase()) === -1
        ),
      onSelect: (v) => commit(v),
    }));

    input.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' || composing(evt)) return;
      evt.preventDefault();
      commit();
    });
  }

  /** Property names already used in the vault, most common first. */
  knownProperties() {
    return knownPropertyNames(this.app);
  }

  typeOf(key) {
    try {
      const info = this.app.metadataTypeManager.getTypeInfo(key);
      const t =
        (info && info.expected && info.expected.type) ||
        (info && info.inferred && info.inferred.type);
      if (t && TYPE_ICONS[t]) return t;
    } catch (err) {
      /* fall through */
    }
    return 'text';
  }

  showMenu(key, anchorEl) {
    const menu = new Menu();
    const current = this.typeOf(key);

    Object.keys(TYPE_ICONS).forEach((type) => {
      menu.addItem((item) => {
        item.setTitle(TYPE_LABELS[type]);
        item.setIcon(TYPE_ICONS[type]);
        item.setChecked(type === current);
        item.onClick(() => {
          try {
            this.app.metadataTypeManager.setType(key, type);
            this.forceRefresh();
          } catch (err) {
            console.error('Design Redux: could not set the type', err);
          }
        });
      });
    });

    // For touch, where a drag is harder to aim, and for anyone who'd
    // rather not drag.
    const row = anchorEl.closest('.dr-row');
    const rows = row && row.parentElement
      ? Array.from(row.parentElement.querySelectorAll(':scope > .dr-row'))
      : [];
    const at = rows.indexOf(row);
    menu.addSeparator();
    [
      ['Move up', 'arrow-up', -1, at > 0],
      ['Move down', 'arrow-down', 1, at !== -1 && at < rows.length - 1],
    ].forEach(([title, icon, delta, possible]) => {
      menu.addItem((item) => {
        item.setTitle(title).setIcon(icon);
        if (typeof item.setDisabled === 'function') item.setDisabled(!possible);
        item.onClick(() => {
          if (possible) this.moveRow(row, delta);
        });
      });
    });

    menu.addSeparator();
    const bulk = this.plugin.feature ? this.plugin.feature(BulkEditing) : null;
    if (bulk) {
      menu.addItem((item) =>
        item
          .setTitle('Rename in every note…')
          .setIcon('pencil')
          .onClick(() => bulk.openRenameProperty(key))
      );
    }
    menu.addItem((item) =>
      item
        .setTitle('Remove property')
        .setIcon('trash-2')
        .onClick(() => this.remove(key))
    );

    const r = anchorEl.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom + 4 });
  }

  /**
   * Single write path. undefined removes the key. `onlyNew` adds a
   * property only if the file doesn't have it — checked in the file
   * itself, since the cache can be a moment behind. A value edited in
   * its own field isn't redrawn: the field already shows it, and a
   * redraw would take the one being moved into.
   */
  async write(key, value, opts = {}) {
    const file = this.file;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (opts.onlyNew && Object.keys(fm).some((k) => k.toLowerCase() === key.toLowerCase())) return;
        if (value === undefined) delete fm[key];
        else fm[key] = value;
      });
      if (opts.redraw !== false) this.afterWrite(file);
    } catch (err) {
      console.error('Design Redux: frontmatter write failed', err);
      new Notice('Could not update the properties.');
    }
  }

  /**
   * Redraw once Obsidian has read the file back. processFrontMatter
   * resolves before the metadata cache catches up, so redrawing at
   * once showed the old values. Focus goes back where it was.
   */
  afterWrite(file) {
    if (this.file !== file) return;
    const cache = this.app.metadataCache;
    if (!cache || typeof cache.on !== 'function') return this.redraw();
    let done = false;
    let timer = 0;
    const ref = cache.on('changed', (changed) => {
      if (changed === file) finish();
    });
    const finish = () => {
      if (done) return;
      done = true;
      cache.offref(ref);
      window.clearTimeout(timer);
      if (this.file === file) this.redraw();
    };
    timer = window.setTimeout(finish, 1500);
  }

  /** forceRefresh, putting focus back on the same row's same field. */
  redraw() {
    if (!this.containerEl) return;
    const active = document.activeElement;
    const inside = active && this.containerEl.contains(active);
    const row = inside ? active.closest('.dr-row') : null;
    const key = row ? row.dataset.key : null;
    const part = !inside
      ? null
      : active.classList.contains('dr-key-name')
      ? '.dr-key-name'
      : active.classList.contains('dr-key-icon')
      ? '.dr-key-icon'
      : active.closest('.dr-add')
      ? '.dr-add input'
      : null;
    this.forceRefresh();
    if (!part) return;
    const again = key && part !== '.dr-add input'
      ? this.containerEl.querySelector(`.dr-row[data-key="${CSS.escape(key)}"] ${part}`)
      : this.containerEl.querySelector(part);
    if (again) again.focus();
  }

  /**
   * Rebuilt in place so ordering survives: re-adding a renamed key
   * would otherwise move it to the end of the block. A name another
   * property already has is refused — writing it would overwrite that
   * property's value — and checked again against the file itself, in
   * case the cache is behind.
   */
  async rename(oldKey, newKey) {
    const file = this.file;
    const clashWith = (keys) =>
      keys.find(
        (k) => k !== oldKey && k !== 'position' && k.toLowerCase() === newKey.toLowerCase()
      );
    const refuse = (clash) => {
      new Notice(`There's already a property called "${clash}".`);
      if (this.file === file) this.forceRefresh();
    };

    const cached = clashWith(Object.keys(this.frontmatter));
    if (cached) return refuse(cached);

    let clash = null;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        clash = clashWith(Object.keys(fm));
        if (clash) return;
        const entries = Object.keys(fm)
          .filter((k) => k !== 'position')
          .map((k) => [k, fm[k]]);
        entries.forEach(([k]) => delete fm[k]);
        entries.forEach(([k, v]) => {
          fm[k === oldKey ? newKey : k] = v;
        });
      });
      if (clash) return refuse(clash);
      this.afterWrite(file);
    } catch (err) {
      console.error('Design Redux: rename failed', err);
      new Notice('Could not rename the property.');
    }
  }

  /**
   * Write the properties in a new order. Rebuilt in place, as rename
   * is; any key the rows didn't know about — added elsewhere meanwhile —
   * keeps its place at the end. Not redrawn after, since the rows are
   * already where they belong, and redrawing before Obsidian has read
   * the file back would briefly show the old order.
   */
  async reorder(order) {
    const file = this.file;
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        const keys = Object.keys(fm).filter((k) => k !== 'position');
        const sorted = order
          .filter((k) => keys.indexOf(k) !== -1)
          .concat(keys.filter((k) => order.indexOf(k) === -1));
        const entries = sorted.map((k) => [k, fm[k]]);
        keys.forEach((k) => delete fm[k]);
        entries.forEach(([k, v]) => {
          fm[k] = v;
        });
      });
    } catch (err) {
      console.error('Design Redux: reorder failed', err);
      new Notice('Could not reorder the properties.');
      if (this.file === file) this.forceRefresh();
    }
  }

  /** After our own write, redraw even though focus is still inside. */
  forceRefresh() {
    if (!this.containerEl || !this.containerEl.isConnected) return;
    this.containerEl.empty();
    this.render();
  }
}

