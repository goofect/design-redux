/*
 * The palette, measured (docs/DESIGN.md, "Palette tokens" and the guardrails).
 *
 * Reads the colour tokens of each scheme from the tokens part of the
 * stylesheet, computes the contrast of every pair the design uses, and fails
 * when one is under its floor: 4.5 for text, 3 for lines (hairlines, glyphs,
 * marks, the ring), and for the semantic tones 4.5 on the ground and on the
 * hover fill, 3 for their soft forms. Fills (clay, ash) have no floor: a fill
 * is never the only sign of a state, and what is drawn on it is measured.
 *
 *   node tests/contrast.js           measure, and check the block of ratios in the tokens part is current
 *   node tests/contrast.js --write   measure, and write that block
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tokensFile = path.join(root, 'styles', '00-tokens.css');
const TONES = ['rust', 'ochre', 'moss', 'slate', 'plum'];

/** The --dr- tokens one scheme's block declares, by name. */
function schemeTokens(css, scheme) {
  const block = new RegExp(`body\\.dr-active\\.theme-${scheme}\\s*\\{([^}]*)\\}`).exec(css);
  if (!block) throw new Error(`no body.dr-active.theme-${scheme} block in ${tokensFile}`);
  const out = {};
  block[1].replace(/--dr-([a-z-]+)\s*:\s*([^;]+);/g, (all, name, value) => (out[name] = value.trim()));
  return out;
}

const channel = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(channel); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** The WCAG contrast of two colours. */
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** One scheme's lines of the block, and what fails in it. */
function measureScheme(scheme, t) {
  const failures = [];
  const says = (what, on, floor) => {
    const r = ratio(t[what], t[on]);
    if (floor && r < floor) failures.push(`${scheme}: ${what} on ${on} is ${r.toFixed(2)}, under ${floor}`);
    return `${what} on ${on} ${r.toFixed(2)}`;
  };
  const text = [says('ink', 'bg', 4.5), says('ink', 'surface', 4.5), says('muted', 'bg', 4.5)];
  const never = [];
  // Muted on the hover fill is text only in the scheme where it measures as text.
  (ratio(t.muted, t.surface) >= 4.5 ? text : never).push(says('muted', 'surface'));
  text.push(says('on-clay', 'clay', 4.5));
  // What marks a fill: the ink where it can be read on clay, the on-clay colour where it can't.
  const line = [says('ink', 'bg', 3), says('ink', 'surface', 3)];
  if (ratio(t.ink, t.clay) >= 3) line.push(says('ink', 'clay', 3));
  else { line.push(says('on-clay', 'clay', 3)); never.push(says('ink', 'clay')); }
  never.push(says('muted', 'clay'), `clay as text on bg ${ratio(t.clay, t.bg).toFixed(2)}`);
  const fill = [says('clay', 'bg'), says('surface', 'bg'), says('clay', 'surface')];
  const tones = TONES.map((tone) => {
    const [onBg, onSurface] = [ratio(t[tone], t.bg), ratio(t[tone], t.surface)];
    if (onBg < 4.5) failures.push(`${scheme}: ${tone} on bg is ${onBg.toFixed(2)}, under 4.5`);
    if (onSurface < 4.5) failures.push(`${scheme}: ${tone} on surface is ${onSurface.toFixed(2)}, under 4.5`);
    return `${tone} ${onBg.toFixed(2)}/${onSurface.toFixed(2)}`;
  });
  const soft = TONES.map((tone) => {
    const r = ratio(t[`${tone}-soft`], t.bg);
    if (r < 3) failures.push(`${scheme}: ${tone}-soft on bg is ${r.toFixed(2)}, under 3`);
    return `${tone} ${r.toFixed(2)}`;
  });
  // The same colour written a second way must be the same colour.
  Object.keys(t).filter((name) => name.endsWith('-rgb')).forEach((name) => {
    const hex = t[name.slice(0, -4)];
    if (!hex || rgb(hex).join(', ') !== t[name]) failures.push(`${scheme}: --dr-${name} (${t[name]}) is not --dr-${name.slice(0, -4)} (${hex})`);
  });
  const [r, g, b] = rgb(t.clay).map((c) => c / 255);
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  const h = max === min ? 0 : 60 * (max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4);
  const hsl = `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  if (`${t['clay-h']} ${t['clay-s']} ${t['clay-l']}` !== hsl) failures.push(`${scheme}: clay's hue, saturation and lightness should read ${hsl}`);
  const pad = scheme.padEnd(5);
  const lines = [
    `${pad}  text   ${text.join(' · ')}`,
    `${pad}  line   ${line.join(' · ')}`,
    `${pad}  fill   ${fill.join(' · ')} (never the only sign: see "Selected and open")`,
    `${pad}  never  ${never.join(' · ')}`,
    `${pad}  tones  ${tones.join(' · ')} (on bg / on surface)`,
    `${pad}  soft   ${soft.join(' · ')} (on bg: fills and lines only)`,
  ];
  return { lines, failures, pairs: text.length + line.length + fill.length + never.length + tones.length * 2 + soft.length };
}

/** Both schemes measured: { block (the comment's text), failures, pairs, stale }. */
function measure({ write = false } = {}) {
  let css = fs.readFileSync(tokensFile, 'utf8');
  const results = ['light', 'dark'].map((scheme) => measureScheme(scheme, schemeTokens(css, scheme)));
  const block = `/* contrast:begin\n${results.flatMap((r) => r.lines).map((l) => ` * ${l}`).join('\n')}\n * contrast:end */`;
  const was = /\/\* contrast:begin[\s\S]*?contrast:end \*\//.exec(css);
  const failures = results.flatMap((r) => r.failures);
  if (!was) failures.push(`${path.relative(root, tokensFile)} has no contrast block`);
  else if (write && was[0] !== block) {
    css = css.replace(was[0], block);
    fs.writeFileSync(tokensFile, css);
  } else if (was[0] !== block) failures.push(`the ratios written in ${path.relative(root, tokensFile)} are not the measured ones: node tests/contrast.js --write`);
  return { block, failures, pairs: results.reduce((n, r) => n + r.pairs, 0) };
}

module.exports = { measure, ratio, schemeTokens, tokensFile };

if (require.main === module) {
  const { block, failures, pairs } = measure({ write: process.argv.includes('--write') });
  console.log(block.split('\n').slice(1, -1).map((l) => l.slice(3)).join('\n'));
  if (failures.length) {
    console.log(failures.map((f) => `not ok  ${f}`).join('\n'));
    process.exit(1);
  }
  console.log(`contrast: ${pairs} pairs measured in light and dark, none under its floor`);
}
