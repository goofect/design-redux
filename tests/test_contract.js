/*
 * What must not change without being meant: the commands (hotkeys hang on
 * their ids), the view types (a saved layout names them) and the settings
 * (data.json holds them). Every one of the old plugin's is kept
 * (tests/snapshots/lifecycle.json, the old plugin's own record). The new
 * plugin's are recorded in tests/snapshots/contract.json: one dropped fails,
 * one added must be recorded on purpose (node tests/test_contract.js --update).
 * And the budgets: a feature has at most ten settings of its own, every
 * setting is somebody's, and every one is read.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { load, world, suite } = require('./harness.js');

const dr = load();
const check = suite('contract');
const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshots', 'lifecycle.json'), 'utf8'));
const recordFile = path.join(__dirname, 'snapshots', 'contract.json');

(async () => {
  const w = await world({});
  const commands = Object.keys(w.app.commands.commands).map((c) => c.split(':')[1]).sort();
  const views = Object.keys(w.app.viewRegistry).filter((v) => v.startsWith('design-redux')).sort();
  const settings = Object.keys(dr.DEFAULTS).sort();
  const now = { commands, views, settings };

  if (process.argv.includes('--update')) {
    fs.writeFileSync(recordFile, `${JSON.stringify(now, null, 2)}\n`);
    console.log(`contract: ${commands.length} commands, ${views.length} views, ${settings.length} settings recorded`);
    return;
  }

  await check('every command id of the old plugin is still a command', () => assert.deepStrictEqual(legacy.commands.filter((id) => !commands.includes(id)), []));
  await check('every view type of the old plugin is still registered', () => assert.deepStrictEqual(legacy.views.filter((v) => !views.includes(v)), []));
  await check('every setting of the old plugin is kept, or retired with a reason', () => assert.deepStrictEqual(legacy.settings.filter((k) => !(k in dr.DEFAULTS) && !(k in dr.RETIRED)), []));

  await check('the commands, views and settings are the ones recorded', () => {
    const recorded = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    Object.keys(now).forEach((kind) => {
      assert.deepStrictEqual(recorded[kind].filter((x) => !now[kind].includes(x)), [], `${kind} dropped: keep them, or migrate and record the change`);
      assert.deepStrictEqual(now[kind].filter((x) => !recorded[kind].includes(x)), [], `${kind} added: node tests/test_contract.js --update`);
    });
  });

  await check('every command has a name, and none a glyph: menus and commands are words', () => {
    const wrong = w.plugin.actions().filter((a) => a.palette !== false).filter((a) => !a.name || a.glyph).map((a) => a.id);
    assert.deepStrictEqual(wrong, []);
  });

  await check('the settings page is six switches and nothing else; every feature with a key has one, the rest are always on', () => {
    const tab = new dr.SettingsTab(w.app, w.plugin);
    tab.display();
    const names = Array.from(tab.containerEl.querySelectorAll('.setting-item')).map((r) => r.querySelector('.setting-item-name').textContent);
    assert.deepStrictEqual(names, ['The look', 'On Obsidian’s own interface too', 'Library', 'Note head and pages', 'Strip', 'Property rules']);
    const keys = ['library', 'notePage', 'notePages', 'contextStrip', 'propertyRulesOn'];
    assert.deepStrictEqual(w.plugin.features.filter((f) => f.constructor.key && !keys.includes(f.constructor.key)).map((f) => f.constructor.name), [], 'a feature with a key the page has no switch for');
  });

  await check('every setting is read by some module (a setting nothing reads silently does nothing)', () => {
    const src = [];
    (function walk(dir) {
      fs.readdirSync(dir).forEach((f) => {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.js') && !p.endsWith(path.join('core', 'settings.js'))) src.push(fs.readFileSync(p, 'utf8'));
      });
    })(path.join(__dirname, '..', 'src'));
    const all = src.join('\n');
    assert.deepStrictEqual(settings.filter((k) => !k.startsWith('lookRegion') && !new RegExp(`\\b${k}\\b`).test(all)), []);
  });

  await check('unloading leaves no command, view, glyph or class behind', () => {
    w.plugin.unload();
    assert.deepStrictEqual(Object.keys(w.app.commands.commands), []);
    assert.deepStrictEqual(Object.keys(w.app.viewRegistry).filter((v) => v.startsWith('design-redux')), []);
    assert.deepStrictEqual(Object.keys(dr.GLYPH_NAMES.length ? require('./obsidian.js').icons : {}).filter((id) => id.startsWith('dr-')), []);
    assert.strictEqual(w.doc.body.className, 'theme-light');
  });

  if (!process.exitCode) {
    const features = w.plugin.features.length;
    console.log(`contract: ${commands.length} commands (${legacy.commands.length} of the old plugin's), ${views.length} views, ${settings.length} settings, ${features} features; budgets kept`);
  }
})();
