/* ------------------------------------------------------------------ */
/* The panel                                                           */
/*                                                                     */
/* Stacks sections and keeps them pointed at the active note. Nothing  */
/* is taken from the view, so the note keeps its own property block    */
/* and the panel can hold as many sections as it likes.                */
/* ------------------------------------------------------------------ */

class PropertiesPanel extends Feature {
  constructor(plugin) {
    super(plugin);
    this.popupEl = null;
    this.file = null;
    this.leaf = null;
    this.trigger = null;
    this.sections = [];
    // leaf -> its trigger element, so a fitted leaf costs a lookup
    // rather than a querySelector. Weak, so closing a tab drops it.
    this.fitted = new WeakMap();
  }

  settingsSchema() {
    return [
      {
        key: 'propertiesDropdown',
        name: 'Properties panel',
        desc: 'Hide properties in the note and open them from a button in its header instead.',
      },
      {
        key: 'showMentions',
        name: 'Mentions',
        desc: 'Below the properties, list the notes that link here or name it without linking.',
        showIf: 'propertiesDropdown',
      },
    ];
  }

  commands() {
    return [
      {
        id: 'open-properties',
        name: 'Open properties',
        check: () => {
          const leaf = this.app.workspace.activeLeaf;
          return this.enabled && !!leaf && leaf.view instanceof MarkdownView;
        },
        run: () => {
          const leaf = this.app.workspace.activeLeaf;
          if (!leaf) return;
          const trigger = this.fitted.get(leaf);
          const box = trigger && trigger.isConnected ? trigger.getBoundingClientRect() : null;
          if (box && (box.width || box.height)) {
            trigger.click();
            return;
          }
          // Hidden while the strip is up: opened against the strip's button.
          const strip = document.querySelector('.dr-strip .dr-strip-btn[data-action="properties"]');
          this.toggleFrom(leaf, strip || trigger);
        },
      },
    ];
  }

  register() {
    this.plugin.registerEvent(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (this.enabled) this.follow(leaf);
      })
    );
    this.plugin.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        // Fires when a leaf loads a different file, which
        // active-leaf-change does not cover.
        if (!this.isOpen() || !file || file === this.file) return;
        const leaf = this.app.workspace.activeLeaf;
        if (leaf && leaf.view instanceof MarkdownView) this.follow(leaf, true);
        else this.close();
      })
    );
    this.plugin.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        if (this.isOpen()) this.sections.forEach((sec) => sec.refresh(file));
      })
    );
    // A change to any note but the open one may add or remove a mention
    // of it, so the unlinked search is only repeated after one of those.
    this.otherEdits = 0;
    const edited = (file) => {
      if (!this.file || !file || file.path !== this.file.path) this.otherEdits++;
    };
    ['modify', 'create', 'delete', 'rename'].forEach((type) =>
      this.plugin.registerEvent(this.app.vault.on(type, edited))
    );
    this.plugin.registerDomEvent(document, 'keydown', (evt) => {
      if (evt.key === 'Escape' && this.isOpen()) this.close();
    });

    /*
     * Close on a click outside.
     *
     * pointerdown rather than click, so the panel goes before whatever
     * was clicked reacts. The exceptions all live on <body> rather than
     * inside the panel — the type menu, the property suggestions, and
     * the trigger itself, which does its own toggling — so a click on
     * any of them looks outside without being outside.
     */
    this.plugin.registerDomEvent(document, 'pointerdown', (evt) => {
      if (!this.isOpen()) return;
      // Any element — an icon is SVG, not HTML — and from any window.
      const el = evt.target;
      if (!el || el.nodeType !== 1 || typeof el.closest !== 'function') return;
      if (this.popupEl.contains(el)) return;
      if (
        el.closest(
          '.menu, .suggestion-container, .dr-suggest, .dr-props-trigger, .dr-strip-btn[data-action="properties"]'
        )
      ) {
        return;
      }
      this.close();
    });
    this.plugin.registerDomEvent(window, 'resize', () => this.reposition());
  }

  enable() {
    document.body.addClass('dr-props-active');
    // Only while the panel is actually listing them.
    document.body.toggleClass('dr-mentions-active', !!this.settings.showMentions);
    if (!this.popupEl || !this.popupEl.isConnected) {
      this.popupEl = document.body.createDiv({ cls: 'dr-props-popup' });
    }
    this.sync();
  }

  disable() {
    document.body.removeClass('dr-props-active');
    document.body.removeClass('dr-mentions-active');
    this.close();
    if (this.popupEl) {
      this.popupEl.remove();
      this.popupEl = null;
    }
    document.querySelectorAll('.dr-props-trigger').forEach((el) => el.remove());
    this.fitted = new WeakMap();
  }

  /**
   * Give every rendered markdown leaf a trigger. Deferred leaves
   * (Obsidian 1.7.2+) have no header yet, so they are skipped here and
   * picked up when they become active.
   */
  sync() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.isDeferred) return;
      if (!(leaf.view instanceof MarkdownView)) return;

      const known = this.fitted.get(leaf);
      if (known && known.isConnected) return;

      // The mobile header may have no left group; the actions take it.
      const header = leaf.containerEl.querySelector('.view-header');
      const left = header && header.querySelector('.view-header-left');
      const actions = header && header.querySelector('.view-actions');
      if (!left && !actions) return;

      const trigger = makeTrigger('dr-props-trigger', 'Properties', 'info', (el) => {
        this.anchor = null;
        this.toggle(leaf, el);
      });
      if (left) left.appendChild(trigger);
      else actions.prepend(trigger);
      this.fitted.set(leaf, trigger);
    });
  }

  /**
   * Opened from somewhere other than the header — the strip. The header's
   * trigger is hidden while the strip is up, and a hidden element has no
   * position, so the panel is placed against the button that asked.
   */
  toggleFrom(leaf, anchor) {
    const trigger = this.fitted.get(leaf);
    this.anchor = anchor;
    this.toggle(leaf, trigger && trigger.isConnected ? trigger : anchor);
  }

  toggle(leaf, trigger) {
    const file = leaf.view instanceof MarkdownView ? leaf.view.file : null;
    if (this.isOpen() && this.file === file) {
      this.close();
      return;
    }
    this.close();
    this.open(leaf, trigger);
  }

  /** Sections in the order they appear, subject to settings. */
  build() {
    const sections = [new PropertiesSection(this)];
    if (this.settings.showMentions) sections.push(new MentionsSection(this));
    return sections;
  }

  open(leaf, trigger) {
    if (!this.popupEl) return;
    const file = leaf.view instanceof MarkdownView ? leaf.view.file : null;
    if (!file) return;

    this.file = file;
    this.leaf = leaf;
    this.mount();

    // Shown first: the panel is display:none until then, and an
    // unrendered element measures zero, defeating the edge clamp.
    this.popupEl.addClass('is-open');
    this.place(trigger);
    this.setTrigger(trigger);
  }

  mount() {
    this.popupEl.empty();
    this.renderHead();
    this.sections = this.build();
    this.sections.forEach((sec) => sec.mount(this.popupEl, this.file));
  }

  /**
   * The note as an info sheet opens: its cover beside its name, one
   * property raised beneath in the accent — the title-and-artist shape
   * an album page opens with — and a line on where it lives, how long it
   * is and when it last changed. It says what you're looking at before
   * the details, which a bare list of fields never does.
   */
  renderHead() {
    const file = this.file;
    const head = this.popupEl.createDiv({ cls: 'dr-props-head' });
    const art = head.createDiv({ cls: 'dr-props-art' });
    fillArt(
      art,
      resolveCover(this.app, file, this.settings.coverProperty),
      iconForFile(file),
      coverGen(this.settings, file.basename, file.path)
    );

    const info = head.createDiv({ cls: 'dr-props-info' });
    info.createDiv({ cls: 'dr-props-title', text: file.basename });
    const lead = leadProperty(this.app, file, false);
    if (lead) info.createDiv({ cls: 'dr-props-lead', text: lead });
    this.fillMeta(info.createDiv({ cls: 'dr-props-meta' }), file);
  }

  /** "Folder · 4 min read · Edited Yesterday". The length arrives once it's counted. */
  fillMeta(meta, file) {
    const parts = [];
    const folder = file.parent;
    if (folder && !(folder.isRoot && folder.isRoot())) parts.push(folder.name);
    const style = this.settings.trackLength;
    const lengths = this.plugin.lengths;
    const counts = !!lengths && style !== 'none';
    const length = counts ? lengths.label(file, style === 'words' ? 'words' : 'time') : '';
    if (length) parts.push(style === 'words' ? length : `${length} read`);
    if (file.stat) parts.push(`Edited ${relativeDay(file.stat.mtime)}`);
    meta.setText(parts.join('  ·  '));
    if (!counts || lengths.words(file) !== null) return;
    lengths.measure([file]).then(
      (changed) => {
        if (changed && meta.isConnected && this.file === file) this.fillMeta(meta, file);
      },
      () => {}
    );
  }

  /** Switching notes moves the panel rather than closing it. */
  follow(leaf, force) {
    if (!this.isOpen()) return;
    if (!force && this.leaf === leaf) return;

    if (!leaf || !(leaf.view instanceof MarkdownView) || !leaf.view.file) {
      this.close();
      return;
    }

    this.file = leaf.view.file;
    this.leaf = leaf;
    this.mount();

    const trigger = this.fitted.get(leaf);
    if (trigger && trigger.isConnected) {
      this.setTrigger(trigger);
      this.place(trigger);
    }
  }

  /** Move the active marker and aria state onto a different trigger. */
  setTrigger(trigger) {
    document.querySelectorAll('.dr-props-trigger').forEach((el) => {
      el.removeClass('is-active');
      el.setAttribute('aria-expanded', 'false');
    });
    this.trigger = trigger;
    trigger.addClass('is-active');
    trigger.setAttribute('aria-expanded', 'true');
  }

  /**
   * Anchor under the trigger, flipping up when there's no room below.
   * On a phone it spans the screen, as a sheet would; the width comes
   * from the stylesheet.
   */
  place(trigger) {
    let r = trigger.getBoundingClientRect();
    if (!r.width && !r.height && this.anchor && this.anchor.isConnected) {
      r = this.anchor.getBoundingClientRect();
    }
    const el = this.popupEl;
    el.style.left = Platform.isPhone
      ? '8px'
      : `${Math.max(8, Math.min(r.left, window.innerWidth - 8 - el.offsetWidth))}px`;

    const below = window.innerHeight - r.bottom;
    if (below < 220 && r.top > below) {
      el.style.top = '';
      el.style.bottom = `${window.innerHeight - r.top + 6}px`;
    } else {
      el.style.bottom = '';
      el.style.top = `${r.bottom + 6}px`;
    }
  }

  reposition() {
    if (this.isOpen() && this.trigger && this.trigger.isConnected) {
      this.place(this.trigger);
    }
  }

  close() {
    const wasInside =
      this.popupEl && this.popupEl.contains(document.activeElement);

    this.sections.forEach((sec) => sec.destroy());
    this.sections = [];
    this.file = null;
    this.leaf = null;

    // Each section takes its own suggestion lists with it; other
    // features' lists, such as the graph's, are theirs to keep.

    if (this.popupEl) {
      this.popupEl.removeClass('is-open');
      this.popupEl.empty();
    }

    document.querySelectorAll('.dr-props-trigger').forEach((el) => {
      el.removeClass('is-active');
      el.setAttribute('aria-expanded', 'false');
    });

    // Only reclaim focus if the panel held it; otherwise closing on a
    // click elsewhere would yank the caret out of whatever was clicked.
    if (wasInside && this.trigger && this.trigger.isConnected) {
      this.trigger.focus();
    }
    this.trigger = null;
  }

  isOpen() {
    return !!this.popupEl && this.popupEl.hasClass('is-open');
  }
}

PropertiesPanel.settingKey = 'propertiesDropdown';

