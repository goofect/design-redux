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

  await check('every command id of the old plugin is still a command', () => assert.deepStrictEqual(legacy.commands.filter((id) => !commands.includes(id) && !dr.RETIRED_COMMANDS.includes(id)), []));
  await check('every view type of the old plugin is still registered', () => assert.deepStrictEqual(legacy.views.filter((v) => !views.includes(v)), []));
  await check('every setting of the old plugin is kept, or retired with a reason', () => assert.deepStrictEqual(legacy.settings.filter((k) => !(k in dr.DEFAULTS) && !(k in dr.RETIRED)), []));

  await check('the commands, views and settings are the ones recorded', () => {
    const recorded = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
    Object.keys(now).forEach((kind) => {
      assert.deepStrictEqual(recorded[kind].filter((x) => !now[kind].includes(x)), [], `${kind} dropped: keep them, or migrate and record the change`);
      assert.deepStrictEqual(now[kind].filter((x) => !recorded[kind].includes(x)), [], `${kind} added: node tests/test_contract.js --update`);
    });
  });

  await check('every command has a name, a glyph of the plugin\'s set, and it in assets/icons/actions.json', () => {
    const named = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'icons', 'actions.json'), 'utf8'));
    const wrong = w.plugin.actions().filter((a) => a.palette !== false).filter((a) => !a.name || !dr.GLYPH_NAMES.includes(a.glyph) || named[a.id] !== a.glyph).map((a) => `${a.id} (${a.glyph}, listed ${named[a.id]})`);
    assert.deepStrictEqual(wrong, []);
  });

  await check('a feature has at most ten settings of its own, each a real setting; a row belongs to one feature only', () => {
    const owner = new Map();
    const wrong = [];
    w.plugin.features.forEach((f) => {
      const rows = f.settingsRows();
      const own = rows.filter((r) => !r.group);
      const name = f.constructor.name;
      if (own.length > 10) wrong.push(`${name}: ${own.length} settings`);
      if (rows.length && !f.constructor.title) wrong.push(`${name}: settings, but no title to list them under`);
      rows.filter((r) => r.key).forEach((r) => {
        if (!(r.key in dr.DEFAULTS)) wrong.push(`${name}: ${r.key} is no setting`);
        if (owner.has(r.key)) wrong.push(`${r.key}: in ${owner.get(r.key)} and ${name}`);
        owner.set(r.key, name);
      });
      const key = f.constructor.key;
      if (key && !(key in dr.DEFAULTS)) wrong.push(`${name}: its switch ${key} is no setting`);
    });
    assert.deepStrictEqual(wrong, []);
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
    const kept = legacy.commands.filter((id) => commands.includes(id)).length;
    console.log(`contract: ${commands.length} commands (${kept} of ${legacy.commands.length} old ids kept), ${views.length} views, ${settings.length} settings, ${features} features; budgets kept`);
  }
})();
