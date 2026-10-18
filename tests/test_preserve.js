// What the plugin writes into notes' text, byte for byte: renaming quiet
// links, making them shareable and quiet again, renaming tags — against a
// note made to be awkward (Unicode, CRLF, code, maths, comments, footnotes,
// links in properties). Only what's meant changes; the rest is the same.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');

const obsidian = new Proxy({ Platform: { isMobile: false }, setIcon: () => {} }, { get: (t, k) => (k in t ? t[k] : (t[k] = class {})) });
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  return req === 'obsidian' ? obsidian : origLoad.call(this, req, ...rest);
};
const tmp = path.join(__dirname, '_preserve_under_test.js');
fs.writeFileSync(tmp, fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8') +
  '\nmodule.exports.__test = { renameQuietLinksIn, renameSpans, quietSpans, tagSpots, renameTagsAt };\n');
const R = require(tmp).__test;
fs.unlinkSync(tmp);

/**
 * The note, as pieces: plain text, a quiet link Obsidian found ({ link,
 * to }), one in the properties ({ prop, to }), a tag Obsidian found
 * ({ tag, to }). What a rename should make of each is in `to`.
 */
const PIECES = [
  '---\n',
  'title: "Café — “quoted” 東京"\n',
  'aliases:\n  - Ünïcödé\n',
  'related: "', { prop: '[[[Anarchy]]]', to: '[[[Anarchism]]]' }, '"\n',
  'tags: [law, court/appeal]\n',
  '---\n',
  '# Heading ', { tag: '#law', to: '#jurisprudence' }, ' ', { link: '[[[Anarchy]]]', to: '[[[Anarchism]]]' }, '\r\n',
  'Emoji 👩‍👩‍👧, zero​width, NBSP here.\r\n',
  'A ', { link: '[[[Anarchy|the anarchy]]]', to: '[[[Anarchism|the anarchy]]]' },
  ', ', { link: '[[[Anarchy#Roots]]]', to: '[[[Anarchism#Roots]]]' },
  ', ', { link: '[[[Anarchy Two]]]' },
  ' and ', { link: '[[[Politics/Anarchy]]]', to: '[[[Anarchism]]]' }, '.\r\n',
  '`inline [[[Anarchy]]] #law` and ', { tag: '#law', to: '#jurisprudence' }, ', ', { tag: '#lawyer' }, ', ', { tag: '#law/court', to: '#jurisprudence/court' }, '.\n',
  '```\n[[[Anarchy]]] #law\n```\n',
  '%% [[[Anarchy]]] %%\n',
  '$$ [[[Anarchy]]] $$\n',
  'Ref[^1].\n\n[^1]: With ', { link: '[[[Anarchy]]]', to: '[[[Anarchism]]]' }, '.\n',
];

/** The note's text, what Obsidian made of it, and the text as a rename should leave it. */
function build() {
  let text = '';
  const cache = { drQuietLinks: [], tags: [] };
  PIECES.forEach((p) => {
    if (typeof p === 'string') return (text += p);
    const s = p.link || p.prop || p.tag;
    if (p.link) cache.drQuietLinks.push({ link: `[${s.slice(3, -3)}`, original: s.slice(0, -1), position: { start: { offset: text.length }, end: { offset: text.length + s.length - 1 } } });
    if (p.tag) cache.tags.push({ tag: s, position: { start: { offset: text.length }, end: { offset: text.length + s.length } } });
    text += s;
  });
  // The text with the pieces of these kinds as a rename should leave them.
  const after = (...kinds) => PIECES.map((p) => (typeof p === 'string' ? p : kinds.some((k) => p[k]) && p.to ? p.to : p.link || p.prop || p.tag)).join('');
  return { text, cache, after };
}

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok  ' + name); };
const { text, cache, after } = build();
const renamed = after('link', 'prop');

t('renaming a note renames its quiet links where they are links — properties, text, footnotes — and nothing else', () => {
  const out = R.renameQuietLinksIn(text, [{ oldPath: 'Politics/Anarchy.md', linktext: 'Anarchism' }], null, R.renameSpans(text, cache));
  assert.strictEqual(out.text, renamed);
  assert.strictEqual(out.count, 6);
  assert.ok(out.text.includes('```\n[[[Anarchy]]] #law\n```') && out.text.includes('%% [[[Anarchy]]] %%') && out.text.includes('`inline [[[Anarchy]]] #law`'), 'code, maths and comments keep what’s written');
});

t('a rename that touches none of them leaves every byte as it was', () => {
  const out = R.renameQuietLinksIn(text, [{ oldPath: 'Elsewhere/Gone.md', linktext: 'Other' }], null, R.renameSpans(text, cache));
  assert.strictEqual(out.text, text);
  assert.strictEqual(out.count, 0);
});

t('text edited since Obsidian read it: the links it no longer finds are left alone, nothing else is touched', () => {
  const edited = text.replace('# Heading', '# A heading');
  const out = R.renameQuietLinksIn(edited, [{ oldPath: 'Anarchy.md', linktext: 'Anarchism' }], null, R.renameSpans(edited, cache));
  // Only the property's link, found in the text itself, is renamed.
  assert.strictEqual(out.text, edited.replace('related: "[[[Anarchy]]]"', 'related: "[[[Anarchism]]]"'));
});

t('renaming a tag renames it and the tags under it where Obsidian found them; not #lawyer, not in code', () => {
  const out = R.renameTagsAt(text, R.tagSpots(cache, 'law'), 'law', 'jurisprudence');
  assert.strictEqual(out, after('tag'));
  assert.strictEqual(R.renameTagsAt(text, [], 'law', 'jurisprudence'), text);
});

t('a tag that moved since Obsidian read it stops the rename rather than writing over something else', () => {
  const edited = `X${text}`;
  assert.strictEqual(R.renameTagsAt(edited, R.tagSpots(cache, 'law'), 'law', 'jurisprudence'), null);
});

console.log(`\n${passed} passed`);
