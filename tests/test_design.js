/*
 * The design's self-audit, where a machine can run it (docs/DESIGN.md,
 * "Self-audit"): on the stylesheet's parts — a rule on Obsidian's own DOM is
 * gated by the master switch and a region, and listed in a selector map —
 * and on the source — no innerHTML, no inline style but a geometry property,
 * no regex lookbehind, no `scope` on a Modal, nothing of Obsidian's DOM
 * moved or removed.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { suite } = require('./harness.js');

const root = path.join(__dirname, '..');
const check = suite('design');
const bare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const styles = fs.readdirSync(path.join(root, 'styles')).filter((f) => f.endsWith('.css')).sort();
const sources = [];
(function walk(dir) {
  fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) sources.push(p);
  });
})(path.join(root, 'src'));

/** A part's rules as [selector, body], media and container blocks opened up. */
function rules(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (!depth) open = i; depth++; }
    else if (css[i] === '}' && !--depth) {
      const head = css.slice(start, open).trim();
      const body = css.slice(open + 1, i);
      if (head.startsWith('@')) out.push(...rules(body));
      else out.push([head, body]);
      start = i + 1;
    }
  }
  return out;
}

(async () => {
  await check('a rule that reaches Obsidian\'s own DOM is gated by the switch and a region; the plugin\'s own match only dr- classes', () => {
    const wrong = [];
    styles.forEach((f) => {
      rules(bare(fs.readFileSync(path.join(root, 'styles', f), 'utf8'))).forEach(([head]) => {
        head.split(',').map((s) => s.trim()).forEach((sel) => {
          if (/^body\.dr-active(\.theme-(light|dark))?$/.test(sel) || sel === 'body') return; // tokens and the map
          const gated = /^body\.dr-active\.dr-region-[a-z]+(\s|::|$)/.test(sel);
          const browserChrome = /^body\.dr-browser-open \.workspace-(ribbon\.mod-left|split\.mod-left-split)$/.test(sel);
          // Plugin-owned: its first compound is a dr- class (an element the plugin made or marked).
          const own = /^(?:[a-z]+)?\.dr[-\w]*/.test(sel) || /^\.dr(?![\w-])/.test(sel);
          if (!gated && !own && !browserChrome) wrong.push(`${f}: ${sel}`);
        });
      });
    });
    assert.deepStrictEqual(wrong, []);
  });

  await check('a part with rules on Obsidian\'s DOM opens with its selector map', () => {
    const wrong = styles.filter((f) => {
      const css = fs.readFileSync(path.join(root, 'styles', f), 'utf8');
      const reaches = rules(bare(css)).some(([head]) => /^body\.dr-active\.dr-region-[a-z]+\s+\S/.test(head.trim()) || /::(selection|before|after)/.test(head) && /^body\.dr-active\.dr-region/.test(head.trim()));
      return reaches && !/Selector map/.test(css.slice(0, css.indexOf('*/', css.indexOf('Selector map') < 0 ? 0 : css.indexOf('Selector map')) + 2));
    });
    assert.deepStrictEqual(wrong, []);
  });

  await check('the source sets no HTML, no style but a geometry property, and uses nothing that has bitten before', () => {
    const wrong = [];
    sources.forEach((file) => {
      const name = path.relative(root, file);
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        const say = (what) => wrong.push(`${name}:${i + 1} ${what}`);
        if (/\.(innerHTML|outerHTML)\b|insertAdjacentHTML/.test(line)) say('sets HTML');
        if (/\.style\.(?!setProperty\(\s*['"`]--dr-|getPropertyValue|removeProperty\(\s*['"`]--dr-)/.test(line)) say('sets an inline style that is not a --dr- geometry property');
        if (/\.cssText|setAttribute\(\s*['"]style['"]/.test(line)) say('sets an inline style');
        if (/\(\?<[=!]/.test(line)) say('regex lookbehind');
        if (/createElement\(\s*['"](style|link)['"]\)/.test(line)) say('adds a stylesheet');
        if (/this\.scope\s*=/.test(line)) say('a scope field');
        if (/processFrontMatter/.test(line) && !/core\/notes\.js$/.test(name)) say('processFrontMatter outside core/notes.js');
        if (/new MutationObserver/.test(line) && !/\/\/ scoped/.test(line)) say('a MutationObserver (scope it to one container, debounce it, and mark the line // scoped)');
      });
    });
    assert.deepStrictEqual(wrong, []);
  });

  await check('no module is over 400 lines, and each says what it is for', () => {
    const wrong = [];
    sources.forEach((file) => {
      const text = fs.readFileSync(file, 'utf8');
      const name = path.relative(root, file);
      if (text.split('\n').length - 1 > 400) wrong.push(`${name}: ${text.split('\n').length - 1} lines`);
      if (!/^\s*(\/\*|\/\/)/.test(text)) wrong.push(`${name}: opens with no comment saying what it is for`);
    });
    assert.deepStrictEqual(wrong, []);
  });

  check.done();
})();
