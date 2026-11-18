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
const tokensFile = ['styles', 'next/styles'].map((d) => path.join(root, d, '00-tokens.css')).find((f) => fs.existsSync(f));

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

/** One scheme's lines of the block, and what fails in it: every pair the reset uses is words, so every one is held to 4.5. */
function measureScheme(scheme, t) {
  const failures = [];
  const says = (what, on) => {
    const r = ratio(t[what], t[on]);
    if (r < 4.5) failures.push(`${scheme}: ${what} on ${on} is ${r.toFixed(2)}, under 4.5`);
    return `${what} on ${on} ${r.toFixed(2)}`;
  };
  // The ink on the ground and on the fill (what is open or picked), the grey on both, the red on the ground. The rule is a line, not words: no floor.
  const text = [says('ink', 'bg'), says('ink', 'fill'), says('muted', 'bg'), says('muted', 'fill'), says('error', 'bg')];
  const names = Object.keys(t).sort();
  if (names.join(' ') !== 'bg error fill ink muted rule') failures.push(`${scheme}: the palette is ${names.join(', ')}, not the six (bg, ink, muted, rule, fill, error)`);
  const pad = scheme.padEnd(5);
  return { lines: [`${pad}  ${text.join(' · ')}`], failures, pairs: text.length };
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
