/* ------------------------------------------------------------------ */
/* Property filters in the graph                                       */
/*                                                                     */
/* The graph's own filter is a search, and Obsidian's search already   */
/* reads properties: [domain] for notes that have one, [domain:Law]    */
/* for a value. What's missing is a way to build that without knowing  */
/* the syntax, so this adds a Properties section to the graph's        */
/* settings panel whose choices are written into its search field.     */
/* The graph does the filtering; nothing here reimplements it, and the */
/* query stays in the field where it can be read and edited by hand.   */
/* ------------------------------------------------------------------ */

const GRAPH_OPS = {
  is: 'is',
  not: 'is not',
  has: 'has any value',
  lacks: 'is missing',
};

/** Quoted when a bare word wouldn't survive the search syntax. */
function searchWord(text) {
  const t = String(text).trim();
  if (!/[\s"()[\]:]/.test(t) && !/^(OR|AND)$/i.test(t)) return t;
  return `"${t.replace(/"/g, '')}"`;
}

/** One condition as a search term, or '' while it's incomplete. */
function graphTerm(rule) {
  if (!rule.key) return '';
  const key = searchWord(rule.key);
  const value = (rule.value || '').trim();
  if (rule.op === 'has') return `[${key}]`;
  if (rule.op === 'lacks') return `-[${key}]`;
  if (!value) return '';
  const term = `[${key}:${searchWord(value)}]`;
  return rule.op === 'not' ? `-${term}` : term;
}

/** The conditions together: all of them, or any one. */
function graphClause(state) {
  const terms = state.rules.map(graphTerm).filter(Boolean);
  if (!terms.length) return '';
  if (state.mode === 'any' && terms.length > 1) return `(${terms.join(' OR ')})`;
  return terms.join(' ');
}

/**
 * Whether a search has an OR outside any brackets or quotes. Obsidian
 * reads "a OR b [x]" as "a OR (b and [x])", so such a search needs
 * brackets of its own before conditions can follow it.
 */
function looseOr(text) {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch) && /^\s+OR\s+/.test(text.slice(i))) return true;
  }
  return false;
}

/**
 * The part of a search that's the user's own, with the clause this
 * wrote last taken off the end. If they've edited it by hand, it's
 * no longer recognisable, and it's left as their own.
 */
function searchWithout(current, clause) {
  const text = (current || '').trim();
  if (clause && text.endsWith(clause)) return text.slice(0, -clause.length).trim();
  return text;
}

class GraphPropertyFilter extends Feature {
  constructor(plugin) {
    super(plugin);
    this.states = new WeakMap();
    this.observers = new Map();
  }

  settingsSchema() {
    return [
      {
        key: 'graphProperties',
        name: 'Property filters',
        desc: 'Filter the graph by a property or its value.',
      },
    ];
  }

  register() {
    // A property renamed by the bulk tools: the graphs' rules follow.
    this.plugin.registerEvent(this.app.workspace.on('design-redux:property-renamed', (from, to) => this.renameProperty(from, to)));
  }

  enable() {
    this.sync();
  }

  /**
   * Called on layout changes, which is when a graph opens — and closes,
   * when its watcher and suggestion lists are let go.
   */
  sync() {
    this.observers.forEach((entry, controls) => {
      if (controls.isConnected) return;
      entry.mo.disconnect();
      const state = this.states.get(entry.leaf);
      if (state && state.suggests) state.suggests.forEach((el) => el.remove());
      this.observers.delete(controls);
    });
    this.app.workspace.iterateAllLeaves((leaf) => this.mount(leaf));
  }

  disable() {
    this.observers.forEach((entry) => entry.mo.disconnect());
    this.observers.clear();
    document.querySelectorAll('.dr-graph-props').forEach((el) => el.remove());
    document.querySelectorAll('.dr-graph-suggest').forEach((el) => el.remove());
  }

  controlsOf(leaf) {
    if (!leaf || leaf.isDeferred || !leaf.view) return null;
    const type = typeof leaf.view.getViewType === 'function' ? leaf.view.getViewType() : '';
    if (GRAPH_TYPES.indexOf(type) === -1) return null;
    return leaf.view.containerEl.querySelector('.graph-controls');
  }

  /**
   * The graph's search field. Obsidian's own markup, so looked for more
   * than one way: in the Filters section, then any search field. A folded
   * section's rows are taken out of the page, so while Filters is folded
   * the field is found through the section itself.
   */
  filterInput(controls, leaf) {
    const shown =
      controls.querySelector('.mod-filter input[type="search"]') ||
      controls.querySelector('.mod-filter input') ||
      controls.querySelector('input[type="search"]');
    if (shown) return shown;
    const view = leaf && leaf.view;
    const engine = view && (view.dataEngine || view.engine);
    const section = engine && engine.filterOptions;
    if (!section) return null;
    if (section.search && section.search.inputEl) return section.search.inputEl;
    const rows = section.childrenEl;
    if (!rows || typeof rows.querySelector !== 'function') return null;
    return rows.querySelector('input[type="search"]') || rows.querySelector('input');
  }

  mount(leaf) {
    const controls = this.controlsOf(leaf);
    if (!controls) return;
    if (!controls.querySelector(':scope > .dr-graph-props')) this.render(leaf, controls);

    // The panel is rebuilt by "Restore default settings"; put it back.
    if (!this.observers.has(controls)) {
      const mo = new MutationObserver(() => {
        if (!controls.isConnected) return;
        if (this.enabled && !controls.querySelector(':scope > .dr-graph-props')) {
          this.render(leaf, controls);
        }
      });
      mo.observe(controls, { childList: true });
      this.observers.set(controls, { mo, leaf });
    }
  }

  /**
   * The conditions for a graph: the saved ones, if the search still
   * ends with the clause they made — otherwise the field was cleared or
   * reset, and there are none.
   */
  stateFor(leaf, controls) {
    const type = leaf.view.getViewType();
    const input = this.filterInput(controls, leaf);
    const saved = (this.settings.graphFilters || {})[type];
    const live = this.states.get(leaf);
    const current = input ? input.value.trim() : '';
    const holds = (s) => !!s && !!s.clause && current.endsWith(s.clause);

    if (live && (holds(live) || !live.clause)) return live;
    const state =
      holds(saved)
        ? { mode: saved.mode || 'all', rules: saved.rules.map((r) => Object.assign({}, r)), clause: saved.clause }
        : { mode: (saved && saved.mode) || 'all', rules: [], clause: '' };
    state.open = saved ? saved.open !== false : true;
    this.states.set(leaf, state);
    return state;
  }

  render(leaf, controls) {
    const state = this.stateFor(leaf, controls);
    controls.querySelectorAll(':scope > .dr-graph-props').forEach((el) => el.remove());

    // Obsidian's own section markup, so it looks and folds like the rest.
    const section = document.createElement('div');
    section.className = 'tree-item graph-control-section dr-graph-props';
    const head = section.createDiv({ cls: 'tree-item-self mod-collapsible dr-graph-props-head' });
    const icon = head.createDiv({ cls: 'tree-item-icon collapse-icon' });
    setIcon(icon, 'right-triangle');
    const inner = head.createDiv({ cls: 'tree-item-inner' });
    inner.createEl('header', { cls: 'graph-control-section-header', text: 'Properties' });
    const count = head.createDiv({ cls: 'dr-gp-count' });
    const body = section.createDiv({ cls: 'tree-item-children' });

    const fold = () => {
      section.toggleClass('is-collapsed', !state.open);
      icon.toggleClass('is-collapsed', !state.open);
    };
    asButton(head);
    onActivate(head, () => {
      state.open = !state.open;
      fold();
      this.save(leaf, state);
    });
    fold();

    const filter = controls.querySelector(':scope > .mod-filter');
    if (filter) filter.after(section);
    else controls.prepend(section);

    const redraw = () => this.renderRules(leaf, controls, state, body, count);
    state.redraw = redraw;
    redraw();

    // Conditions renamed while this graph was closed still have the old
    // name in its search, which the clause they'd make now shows.
    if (state.clause && graphClause(state) !== state.clause) this.apply(leaf, controls, state);
  }

  renderRules(leaf, controls, state, body, count) {
    body.empty();
    if (state.suggests) state.suggests.forEach((el) => el.remove());
    state.suggests = [];

    const active = state.rules.map(graphTerm).filter(Boolean).length;
    count.setText(active ? String(active) : '');
    count.toggleClass('is-shown', active > 0);

    const names = knownPropertyNames(this.app);
    const apply = () => this.apply(leaf, controls, state);

    state.rules.forEach((rule, index) => {
      const row = body.createDiv({ cls: 'dr-gp-rule' });
      row.toggleClass('is-valueless', rule.op === 'has' || rule.op === 'lacks');

      const key = row.createEl('select', { cls: 'dropdown dr-gp-key' });
      key.setAttribute('aria-label', 'Property');
      const placeholder = key.createEl('option', { text: 'Property…' });
      placeholder.value = '';
      const listed = rule.key && names.indexOf(rule.key) === -1 ? [rule.key].concat(names) : names;
      listed.forEach((name) => {
        const opt = key.createEl('option', { text: name });
        opt.value = name;
      });
      key.value = rule.key || '';
      key.addEventListener('change', () => {
        rule.key = key.value;
        rule.value = '';
        apply();
        state.redraw();
      });

      const remove = row.createDiv({ cls: 'clickable-icon dr-gp-remove' });
      remove.setAttribute('aria-label', 'Remove');
      asButton(remove);
      setIcon(remove, 'x');
      onActivate(remove, () => {
        state.rules.splice(index, 1);
        apply();
        state.redraw();
      });

      const op = row.createEl('select', { cls: 'dropdown dr-gp-op' });
      op.setAttribute('aria-label', 'Condition');
      Object.keys(GRAPH_OPS).forEach((k) => {
        const opt = op.createEl('option', { text: GRAPH_OPS[k] });
        opt.value = k;
      });
      op.value = rule.op || 'is';
      op.addEventListener('change', () => {
        rule.op = op.value;
        row.toggleClass('is-valueless', rule.op === 'has' || rule.op === 'lacks');
        apply();
        this.showCount(state, count);
      });

      const value = row.createEl('input', { cls: 'dr-gp-value', type: 'text' });
      value.placeholder = 'Value';
      value.setAttribute('aria-label', 'Value');
      value.value = rule.value || '';
      let timer = 0;
      const typed = () => {
        rule.value = value.value;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          apply();
          this.showCount(state, count);
        }, 300);
      };
      value.addEventListener('input', typed);
      value.addEventListener('keydown', (evt) => {
        if (evt.key !== 'Enter' || composing(evt)) return;
        window.clearTimeout(timer);
        rule.value = value.value;
        apply();
        this.showCount(state, count);
      });
      const list = attachSuggest(row, value, {
        icon: 'list',
        source: () => (rule.key ? propertyValues(this.app, rule.key) : []),
        onSelect: (v) => {
          value.value = v;
          window.clearTimeout(timer);
          rule.value = v;
          apply();
          this.showCount(state, count);
        },
      });
      list.addClass('dr-graph-suggest');
      state.suggests.push(list);
    });

    const foot = body.createDiv({ cls: 'dr-gp-foot' });
    const add = foot.createDiv({ cls: 'dr-gp-add' });
    asButton(add);
    setIcon(add.createSpan({ cls: 'dr-gp-add-icon' }), 'plus');
    add.createSpan({ text: state.rules.length ? 'Add another' : 'Add property filter' });
    onActivate(add, () => {
      state.rules.push({ key: '', op: 'is', value: '' });
      state.redraw();
      const keys = body.querySelectorAll('.dr-gp-key');
      if (keys.length) keys[keys.length - 1].focus();
    });

    if (state.rules.length > 1) {
      const mode = foot.createEl('select', { cls: 'dropdown dr-gp-mode' });
      mode.setAttribute('aria-label', 'Match');
      [['all', 'Match all'], ['any', 'Match any']].forEach(([v, label]) => {
        const opt = mode.createEl('option', { text: label });
        opt.value = v;
      });
      mode.value = state.mode;
      mode.addEventListener('change', () => {
        state.mode = mode.value;
        apply();
      });
    }

    if (!this.filterInput(controls, leaf)) {
      body.createDiv({
        cls: 'dr-gp-note',
        text: 'The graph\'s search field wasn\'t found, so these can\'t be applied.',
      });
    }
  }

  /**
   * A property renamed across the vault. Open graphs rename it in their
   * conditions and rewrite their search; one opened later finds its
   * saved conditions renamed, and rewrites its search then (render).
   */
  renameProperty(from, to) {
    const low = String(from).toLowerCase();
    this.observers.forEach((entry, controls) => {
      const state = this.states.get(entry.leaf);
      if (!state || !controls.isConnected) return;
      let hit = false;
      state.rules.forEach((rule) => {
        if (String(rule.key || '').toLowerCase() !== low) return;
        rule.key = to;
        hit = true;
      });
      if (!hit) return;
      this.apply(entry.leaf, controls, state);
      if (state.redraw) state.redraw();
    });
  }

  showCount(state, count) {
    const active = state.rules.map(graphTerm).filter(Boolean).length;
    count.setText(active ? String(active) : '');
    count.toggleClass('is-shown', active > 0);
  }

  /**
   * Write the conditions into the graph's search field, after whatever
   * was typed there, and let the graph know it changed. Typed text with
   * an OR of its own is bracketed first, so the conditions apply to all
   * of it rather than to its last alternative.
   */
  apply(leaf, controls, state) {
    const input = this.filterInput(controls, leaf);
    if (!input) return;
    let own = searchWithout(input.value, state.clause);
    const clause = graphClause(state);
    if (clause && looseOr(own)) own = `(${own})`;
    const next = [own, clause].filter(Boolean).join(' ');
    state.clause = clause;
    if (next !== input.value) {
      input.value = next;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.save(leaf, state);
  }

  save(leaf, state) {
    const type = leaf.view.getViewType();
    if (!this.settings.graphFilters) this.settings.graphFilters = {};
    this.settings.graphFilters[type] = {
      mode: state.mode,
      rules: state.rules.map((r) => ({ key: r.key, op: r.op, value: r.value })),
      clause: state.clause,
      open: state.open,
    };
    this.plugin.saveData(this.settings);
  }
}

GraphPropertyFilter.settingKey = 'graphProperties';

