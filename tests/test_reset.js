/*
 * The look's checks, so the plugin stays reduced: each
 * screen's controls at rest within its budget; exactly six colours a scheme;
 * one size; a line only on the structural classes the tokens part lists; at
 * most twelve glyphs, and only the plugin's own on its controls; the
 * settings tab on one screen.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { load, world, suite, settle } = require('./harness.js');

const root = path.join(__dirname, '..');
const check = suite('reset');
const dr = load();
const part = (name) => fs.readFileSync(path.join(root, 'styles', name), 'utf8');
const parts = fs.readdirSync(path.join(root, 'styles')).filter((f) => f.endsWith('.css')).sort();
const bare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** A part's rules as [selector, body], with @media and the like opened up. */
function rules(css) {
  const out = [];
  let selector = '';
  let body = '';
  let depth = 0;
  const stack = [];
  for (const ch of bare(css)) {
    if (ch === '{') {
      stack.push(selector.trim());
      selector = '';
      depth++;
    } else if (ch === '}') {
      const sel = stack.pop();
      if (!sel.startsWith('@')) out.push([sel, body]);
      body = '';
      depth--;
    } else if (depth > 0 && stack.length === depth && !stack[depth - 1].startsWith('@') && ch !== '\n') body += ch;
    else if (ch !== '\n' || selector) selector += ch;
  }
  return out;
}

/** A control: what a person presses or types in that isn't the content itself (a row, a cell, a link, a page's word). */
const controls = (node) => Array.from(node.querySelectorAll('.dr-icon-button, .dr-button, input, select, textarea, .checkbox-container, .dr-chip[role]'));
const labels = (node) => controls(node).map((c) => c.getAttribute('aria-label') || c.placeholder || c.textContent || c.tagName);

const VAULT = {
  'Logic/Logic.md': 'About logic.',
  'Logic/Truth tables.md': '---\nstatus: draft\nweek: 3\n---\n# Tables\n\n## Building one\n\nwords',
  'Logic/Validity.md': '[[Truth tables]]',
  'Reading/Hume.md': '',
  'Loose.md': '',
};

(async () => {
  await check('the budget of controls at rest: none on the sidebar, a folder, the vault\'s grid, a note', async () => {
    const w = await world(VAULT, { settingsVersion: 102, notePages: true, notePage: true });
    const sidebar = w.app.workspace.getLeavesOfType('design-redux-library')[0].view.screen;
    assert.deepStrictEqual(labels(sidebar.host), [], 'the sidebar');
    const library = w.plugin.features.find((f) => f.constructor.name === 'Library');
    const browse = (await library.browse(null)).view.screen;
    assert.deepStrictEqual(labels(browse.host), [], 'the vault\'s grid');
    browse.go(w.file('Logic'));
    assert.deepStrictEqual(labels(browse.host), [], 'a folder');
    const leaf = w.app.workspace.getLeaf();
    await leaf.openFile(w.file('Logic/Truth tables.md'));
    await settle();
    const note = leaf.view.contentEl;
    assert.ok(note.querySelector('.dr-note-head'), 'the note\'s head is not drawn');
    assert.deepStrictEqual(labels(note), [], 'a note');
  });

  await check('a sheet: its fields, then underlined words, Cancel and the one that commits last; no fill', async () => {
    const w = await world(VAULT);
    const sheet = new dr.Sheet(w.app, {
      title: 'New folder',
      build: (matter) => { dr.field(matter, { placeholder: 'Name' }); dr.field(matter, { label: 'Inside', placeholder: 'Logic' }); },
      actions: [{ text: 'Cancel' }, { text: 'Make it' }],
    });
    sheet.open();
    const node = sheet.contentEl.querySelector('.dr-sheet');
    assert.strictEqual(node.querySelectorAll('input').length, 2);
    assert.deepStrictEqual(Array.from(node.querySelectorAll('.dr-sheet-actions > .dr-button')).map((b) => [b.className, b.textContent]), [['dr-button', 'Cancel'], ['dr-button', 'Make it']]);
    sheet.close();
  });

  check('each scheme declares exactly four colours: the ground, the ink, the grey, the error\'s red', () => {
    const tokens = bare(part('00-tokens.css'));
    const schemes = ['light', 'dark'].map((mode) => {
      const m = new RegExp(`body\\.dr-active\\.theme-${mode}\\s*\\{([^}]*)\\}`).exec(tokens);
      assert.ok(m, `no ${mode} scheme`);
      return Object.fromEntries(Array.from(m[1].matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)).map((x) => [x[1], x[2].toUpperCase()]));
    });
    assert.deepStrictEqual(schemes.map((s) => Object.keys(s)), [['dr-bg', 'dr-ink', 'dr-muted', 'dr-error'], ['dr-bg', 'dr-ink', 'dr-muted', 'dr-error']]);
    assert.deepStrictEqual([schemes[0]['dr-bg'], schemes[0]['dr-ink'], schemes[1]['dr-bg'], schemes[1]['dr-ink']], ['#FFFFFF', '#000000', '#000000', '#FFFFFF']);
    const values = (tokens.match(/#[0-9A-Fa-f]{3,8}\b/g) || []).length;
    assert.strictEqual(values, 8, `${values} colour values in the tokens part, not the schemes' eight`);
    parts.filter((p) => p !== '00-tokens.css').forEach((p) => assert.ok(!/#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(/.test(bare(part(p))), `a colour value in ${p}`));
  });

  check('one font size: never bigger', () => {
    const sizes = (bare(part('00-tokens.css')).match(/--dr-size[a-z-]*:\s*[^;]+/g) || []);
    assert.deepStrictEqual(sizes, ['--dr-size: 13px']);
    parts.forEach((p) => {
      (bare(part(p)).match(/(?:^|[^-a-z])font(?:-size)?\s*:[^;]+/gm) || []).forEach((decl) => {
        const d = decl.trim().replace(/^[^a-z]+/, '');
        assert.ok(/^font-size\s*:\s*var\(--dr-size\)$|^font: inherit$/.test(d), `${p}: ${d}`);
      });
    });
  });

  check('a line only where the structure divides: borders on the classes the tokens part lists, nowhere else', () => {
    const listed = /lines:((?:\s+[.a-z][\w.[=-]*)+)/.exec(part('00-tokens.css'));
    assert.ok(listed, 'the tokens part lists no structural classes');
    const structural = listed[1].trim().split(/\s+/);
    const wrong = [];
    parts.filter((p) => !p.startsWith('01-')).forEach((p) => {
      rules(part(p)).forEach(([selector, body]) => {
        const borders = body.split(';').map((d) => d.trim()).filter((d) => /^border(?:-(?:top|bottom|left|right))?(?:-color|-width|-style)?\s*:/.test(d) && !/:\s*(?:0|none)\s*$/.test(d));
        if (borders.length && !structural.some((cls) => selector.includes(cls))) wrong.push(`${p}: ${selector} { ${borders.join('; ')} }`);
      });
    });
    assert.deepStrictEqual(wrong, []);
  });

  check('no fill: what is open, picked or under the pointer is ink or underlined, never a block of ink or grey', () => {
    const wrong = [];
    // Allowed: selected text, and Obsidian's toggle, whose knob's place says on or off.
    const allowed = (selector) => /::selection|\.checkbox-container/.test(selector);
    parts.forEach((p) => rules(part(p)).forEach(([selector, body]) => {
      if (/(?:^|;)\s*background(?:-color)?\s*:\s*var\(--dr-(?:ink|muted)\)/.test(body) && !allowed(selector)) wrong.push(`${p}: ${selector}`);
      (body.match(/--(?:tab-background-active|nav-item-background-[a-z]+|background-modifier-(?:hover|active-hover))\s*:\s*var\(--dr-(?:ink|muted)\)/g) || []).forEach((d) => wrong.push(`${p}: ${d}`));
    }));
    assert.deepStrictEqual(wrong, []);
  });

  check('one weight: never bold', () => {
    const weights = parts.flatMap((p) => (bare(part(p)).match(/font-weight\s*:\s*[^;}]+/g) || []).map((d) => `${p}: ${d}`));
    assert.deepStrictEqual(weights.filter((d) => !/:\s*(?:400|normal|inherit)$/.test(d)), []);
  });

  check('state is an ARIA attribute: the plugin\'s own rules read no is- class', () => {
    // Allowed: where a scrolling row of tabs is cut, which is geometry the script measures, not a state.
    const wrong = [];
    parts.forEach((p) => rules(part(p)).forEach(([selector]) => selector.split(',').map((s) => s.trim()).forEach((s) => {
      if (!s.includes('dr-active') && /\.is-(?!cut\b|more-)[a-z]/.test(s)) wrong.push(`${p}: ${s}`);
    })));
    assert.deepStrictEqual(wrong, []);
  });

  await check('at most twelve glyphs, and a control of the plugin\'s shows none of Obsidian\'s', async () => {
    assert.ok(dr.GLYPH_NAMES.length <= 12, `${dr.GLYPH_NAMES.length} glyphs`);
    const w = await world(VAULT);
    const icons = w.plugin.ribbon.map((r) => r.icon);
    assert.deepStrictEqual(icons.filter((i) => !dr.GLYPH_NAMES.some((n) => dr.iconId(n) === i)), [], 'a ribbon icon that is not the plugin\'s');
    const src = [];
    (function walk(dir) { fs.readdirSync(dir).forEach((f) => { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) src.push(p); }); })(path.join(root, 'src'));
    const named = new Set();
    src.forEach((p) => (fs.readFileSync(p, 'utf8').match(/glyph: '([a-z-]+)'/g) || []).forEach((m) => named.add(m.slice(8, -1))));
    assert.deepStrictEqual(Array.from(named).filter((n) => !dr.GLYPH_NAMES.includes(n)), [], 'a control names a glyph the plugin does not have');
  });

  await check('the settings tab fits a 900px window without scrolling', async () => {
    const w = await world(VAULT);
    const tab = new dr.SettingsTab(w.app, w.plugin);
    tab.display();
    const rows = tab.containerEl.querySelectorAll('.setting-item').length;
    assert.ok(tab.containerEl.querySelector('.dr-switches'), 'the switches are not in the two-column grid');
    // Two columns of Obsidian's own rows, each at most 48px high, under 160px of the window's and the tab's own chrome.
    const height = Math.ceil(rows / 2) * 48 + 160;
    assert.ok(height <= 900, `${rows} switches: about ${height}px, past a 900px window`);
    assert.deepStrictEqual(Array.from(tab.containerEl.querySelectorAll('input, select, textarea, .dr-icon-button, .dr-button')).filter((c) => !c.closest('.checkbox-container')), [], 'a control on the settings tab that is not a switch');
  });

  check.done();
})();
