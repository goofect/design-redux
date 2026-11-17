/*
 * The new stylesheet's parts (styles/, staged in next/styles until the old
 * tree moves to legacy/), held to docs/DESIGN.md where a machine can check:
 * the palette's pairs measure up (tests/contrast.js), the variable map sets
 * only names Obsidian declares, colour values live in the tokens part alone,
 * every token used is one declared, and no part rounds a corner, casts a
 * shadow, blurs, moves, shouts (!important) or hovers outside a hover query.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { measure } = require('./contrast.js');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'styles');
const parts = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const bare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

let checks = 0;
const check = (name, fn) => {
  try {
    fn();
    checks++;
  } catch (err) {
    console.log(`not ok  ${name}\n${String(err.message).split('\n').slice(0, 14).join('\n')}`);
    process.exitCode = 1;
  }
};

check('parts are named NN-name.css', () => assert.deepStrictEqual(parts.filter((f) => !/^\d{2}-[a-z0-9-]+\.css$/.test(f)), []));

check('every pair of the palette is at or over its floor, and the ratios written down are the measured ones', () => {
  assert.deepStrictEqual(measure().failures, []);
});

check('the variable map sets only names Obsidian declares', () => {
  const known = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'snapshots', 'obsidian-vars.json'), 'utf8')).vars);
  const set = Array.from(bare(read('01-obsidian-map.css')).matchAll(/(?:^|[{;\s])(--[a-zA-Z0-9-]+)\s*:/g)).map((m) => m[1]);
  assert.ok(set.length > 150, `only ${set.length} variables mapped`);
  assert.deepStrictEqual(set.filter((name) => !known.has(name)), [], 'names not in the installed app.css');
  assert.deepStrictEqual(set.filter((name) => name.startsWith('--dr-')), [], 'tokens belong in the tokens part');
});

check('every rule of the map is gated by the master switch', () => {
  const selectors = Array.from(bare(read('01-obsidian-map.css')).matchAll(/(?:^|\})\s*([^{}]+)\{/g)).map((m) => m[1].trim());
  assert.deepStrictEqual(selectors.filter((s) => !/^body\.dr-active(\.dr-region-[a-z]+)?$/.test(s)), []);
});

check('colour values live in the tokens part, inside the scheme blocks', () => {
  const colour = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\(/g;
  const wrong = [];
  parts.forEach((f) => {
    let css = bare(read(f));
    if (f === '00-tokens.css') css = css.replace(/body\.dr-active\.theme-(light|dark)\s*\{[^}]*\}/g, '');
    (css.match(colour) || []).forEach((c) => wrong.push(`${f}: ${c}`));
  });
  assert.deepStrictEqual(wrong, []);
});

check('every token used is declared, and the tokens part declares nothing of Obsidian\'s', () => {
  const tokens = bare(read('00-tokens.css'));
  const declared = new Set(Array.from(tokens.matchAll(/(--dr-[a-z0-9-]+)\s*:/g)).map((m) => m[1]));
  assert.deepStrictEqual(Array.from(tokens.matchAll(/(?:^|[{;\s])(--(?!dr-)[a-zA-Z0-9-]+)\s*:/g)).map((m) => m[1]), []);
  const missing = new Set();
  // A property a component sets for what is inside it (a glyph's size, a bar's height, a grid's cell) is declared by the part that owns it.
  const local = new Set(parts.filter((f) => f !== '00-tokens.css').flatMap((f) => Array.from(bare(read(f)).matchAll(/(--dr-[a-z0-9-]+)\s*:/g)).map((m) => m[1])));
  assert.deepStrictEqual(Array.from(local).filter((name) => declared.has(name)), [], 'a part redefines a token');
  parts.forEach((f) => Array.from(bare(read(f)).matchAll(/var\((--dr-[a-z0-9-]+)/g)).forEach((m) => {
    if (!declared.has(m[1]) && !local.has(m[1])) missing.add(`${f}: ${m[1]}`);
  }));
  assert.deepStrictEqual(Array.from(missing), []);
  ['light', 'dark'].forEach((scheme) => {
    const block = new RegExp(`body\\.dr-active\\.theme-${scheme}\\s*\\{([^}]*)\\}`).exec(tokens)[1];
    const names = Array.from(block.matchAll(/(--dr-[a-z0-9-]+)\s*:/g)).map((m) => m[1]);
    assert.deepStrictEqual(names.filter((n, i) => names.indexOf(n) !== i), [], `${scheme}: a token declared twice`);
  });
  const sets = ['light', 'dark'].map((scheme) => Array.from(new RegExp(`body\\.dr-active\\.theme-${scheme}\\s*\\{([^}]*)\\}`).exec(tokens)[1].matchAll(/(--dr-[a-z0-9-]+)\s*:/g)).map((m) => m[1]).sort());
  assert.deepStrictEqual(sets[0], sets[1], 'light and dark declare different tokens');
});

check('no rounded corner, shadow, gradient, blur, motion or !important; hover only where there is a pointer that hovers', () => {
  const wrong = [];
  parts.forEach((f) => {
    const css = bare(read(f));
    const say = (what) => wrong.push(`${f}: ${what}`);
    if (/!important/.test(css)) say('!important');
    (css.match(/border(?:-[a-z]+)*-radius\s*:\s*[^;]+/g) || []).filter((d) => !/:\s*(0|var\(--dr-radius\))$/.test(d)).forEach(say);
    (css.match(/(?:^|[;{\s])(?:box-shadow|text-shadow)\s*:\s*[^;]+/g) || []).filter((d) => !/:\s*none$/.test(d)).forEach((d) => say(d.trim()));
    (css.match(/(?:^|[;{\s])(?:transition|animation)(?:-[a-z]+)?\s*:\s*[^;]+/g) || []).filter((d) => !/:\s*none$/.test(d)).forEach((d) => say(d.trim()));
    if (/gradient\(/.test(css)) say('a gradient');
    if (/blur\(/.test(css)) say('a blur');
    if (/@keyframes/.test(css)) say('@keyframes');
    // Outside every hover query, no selector may say :hover.
    let depth = 0;
    let inHover = 0;
    css.split(/(?=[{}])/).forEach((piece) => {
      const brace = piece[0];
      const text = piece.slice(1);
      if (brace === '}') { depth--; if (inHover > depth) inHover = 0; }
      if (brace === '{') depth++;
      const next = brace === '{' || brace === '}' ? text : piece;
      if (/@media[^{]*\(any-hover:\s*hover\)/.test(next)) inHover = depth + 1;
      else if (/:hover/.test(next) && !inHover) say(`:hover outside @media (any-hover: hover): ${next.trim().slice(0, 60)}`);
    });
  });
  assert.deepStrictEqual(wrong, []);
});

check('docs/specimen.html is what the sources build', () => {
  const tool = path.join(root, 'tools', 'specimen.mjs');
  let out = '';
  try {
    out = require('child_process').execFileSync(process.execPath, [tool, '--check'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`;
  }
  assert.ok(/is current/.test(out), 'the specimen is out of date: node tools/specimen.mjs');
});

if (!process.exitCode) console.log(`tokens: ${parts.length} parts keep the design's rules; the palette measures up (${checks} checks)`);
