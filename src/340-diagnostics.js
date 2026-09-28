/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/*                                                                     */
/* What this Obsidian offers of the unofficial parts the plugin leans  */
/* on, shown in settings; and a report to paste into a bug report:     */
/* versions, what's switched on, and recent errors.                    */
/* ------------------------------------------------------------------ */

/**
 * Each unofficial part, whether this version has it, and what goes
 * without if it doesn't. `ok` is null where it can't be told yet.
 */
function compatibility(app) {
  const has = (fn) => {
    try {
      return !!fn();
    } catch (err) {
      return false;
    }
  };
  const open = app.workspace.getLeavesOfType('canvas').map((leaf) => leaf.view).find((v) => v && v.canvas);
  const graph = GRAPH_TYPES.reduce((all, t) => all.concat(app.workspace.getLeavesOfType(t)), [])
    .map((leaf) => leaf.view)
    .find((v) => v && v.renderer);
  return [
    {
      what: 'Grouped right-click entries (New ▸, Cover ▸)',
      ok: canNest(),
      without: 'the entries sit in the menu one per line',
    },
    {
      what: 'Taking unwanted entries out of menus',
      ok: has(() => Array.isArray(new Menu().items)),
      without: 'they are hidden from sight only',
    },
    {
      what: 'Suggestions in settings fields',
      ok: typeof AbstractInputSuggest === 'function',
      without: 'the fields are plain text',
    },
    {
      what: 'Property names and types in the property tools',
      ok: has(() => typeof app.metadataTypeManager.getAllProperties === 'function'),
      without: 'properties are read from the notes alone',
    },
    {
      what: 'Knowing whether Canvas is switched on',
      ok: has(() => typeof app.internalPlugins.getEnabledPluginById === 'function'),
      without: 'New canvas is always offered',
    },
    {
      what: 'Canvas legend counts, and centred text',
      ok: open ? has(() => open.canvas.nodes instanceof Map && typeof open.canvas.getData === 'function') : null,
      without: 'the legend reads the saved file, and text can’t be centred',
      pending: 'Checked while a canvas is open.',
    },
    {
      what: 'Leaving quiet links out of the graph',
      ok: graph ? has(() => typeof graph.renderer.setData === 'function') : null,
      without: 'quiet links are drawn in the graph like any other',
      pending: 'Checked while a graph is open.',
    },
  ];
}

class Diagnostics extends Feature {
  settingsSchema() {
    return [
      {
        key: 'compatibility',
        type: 'custom',
        name: 'Compatibility',
        render: (containerEl) => this.render(containerEl),
      },
    ];
  }

  commands() {
    return [
      {
        id: 'copy-diagnostics',
        name: 'Copy diagnostics for a bug report',
        icon: 'clipboard-copy',
        run: () => this.copy(),
      },
    ];
  }

  register() {
    // Errors from the plugin's own code, wherever they happen: Obsidian
    // runs it as "plugin:<id>", which is how its stack traces name it.
    const ours = (text) => /plugin:design-redux/.test(String(text));
    this.plugin.registerDomEvent(window, 'error', (evt) => {
      const text = (evt.error && evt.error.stack) || evt.message;
      if (ours(text)) this.plugin.noteError(String(text));
    });
    this.plugin.registerDomEvent(window, 'unhandledrejection', (evt) => {
      const text = (evt.reason && evt.reason.stack) || evt.reason;
      if (ours(text)) this.plugin.noteError(String(text));
    });
  }

  render(containerEl) {
    const list = containerEl.createDiv({ cls: 'dr-compat' });
    compatibility(this.app).forEach((part) => {
      const row = list.createDiv({ cls: 'dr-compat-row' });
      row.toggleClass('is-missing', part.ok === false);
      row.toggleClass('is-pending', part.ok === null);
      setIcon(row.createSpan({ cls: 'dr-compat-mark' }), part.ok === null ? 'circle-dashed' : part.ok ? 'check' : 'x');
      const text = row.createDiv({ cls: 'dr-compat-text' });
      text.createDiv({ cls: 'dr-compat-what', text: part.what });
      text.createDiv({
        cls: 'dr-compat-note',
        text: part.ok === null ? part.pending : part.ok ? 'Working.' : `Not on this version: ${part.without}.`,
      });
    });
    new Setting(containerEl)
      .setName('Diagnostics')
      .setDesc('Versions, what’s switched on, and any recent errors, to paste into a bug report.')
      .addButton((button) => button.setButtonText('Copy diagnostics').onClick(() => this.copy()));
  }

  report() {
    const plugin = this.plugin;
    const version = (plugin.manifest && plugin.manifest.version) || '?';
    const where = [
      Platform.isMobile ? (Platform.isPhone ? 'phone' : 'tablet') : 'desktop',
      Platform.isMacOS ? 'macOS' : Platform.isWin ? 'Windows' : Platform.isLinux ? 'Linux' : Platform.isIosApp ? 'iOS' : Platform.isAndroidApp ? 'Android' : '',
    ].filter(Boolean);
    const features = plugin.features || [];
    const lines = [
      `Design Redux ${version}`,
      `Obsidian ${apiVersion || '?'} on ${where.join(', ')}`,
      `On: ${features.filter((f) => f.enabled).map((f) => f.constructor.name).join(', ')}`,
      `Off: ${features.filter((f) => !f.enabled).map((f) => f.constructor.name).join(', ') || 'none'}`,
      '',
      'Compatibility:',
      ...compatibility(this.app).map((p) => `  ${p.ok === null ? '·' : p.ok ? '✓' : '✗'} ${p.what}`),
      '',
      `Recent errors: ${(plugin.errors || []).length ? '' : 'none'}`,
      ...(plugin.errors || []).map((e) => `  ${e}`),
    ];
    return lines.join('\n');
  }

  async copy() {
    const text = this.report();
    try {
      await navigator.clipboard.writeText(text);
      new Notice('Diagnostics copied. Paste them into your message.');
    } catch (err) {
      console.log(text);
      new Notice('Couldn’t copy; the diagnostics are in the developer console.');
    }
  }
}

