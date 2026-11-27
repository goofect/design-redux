// Notes for the guide audit, which is the plugin's own (src/tools/guide-check.js, the command "Check the indent guides of
// this note"): run in the real app on each, so what the person runs and what the tests check are one.

/** Runs inside Obsidian: the plugin's audit of the note in front, its lines' tabs shown. */
export function auditGuides({ plugins }) {
  const check = plugins.designRedux.features.find((f) => f.constructor.name === 'GuideCheck');
  const got = check.audit();
  return { offset: got.offset, violations: got.violations.map((v) => ({ ...v, text: v.text.replace(/\t/g, '→') })) };
}

// Notes shaped like the author's: lettered sections over Obsidian's own numbers, items written as text (2.1., i.)
// under them, words under items, blank lines empty and of only the indent, a rule and a heading among them.
const OUTLINE = [
  '### 3. Taxonomy',
  'A. regime',
  '1. [[Federalism]]',
  '\ti. **Summary**',
  '\t*Federalism* is a',
  '',
  '2. [[Division of powers]]',
  '\ti. **Summary**',
  '\tThe *division of powers* is how the power of the state is divided.',
  '',
  '\t2.1. [[Enumerated powers]]',
  '\t\ti. **Summary**',
  '\t\t*Enumerated powers* are named in the constitution.',
  '',
  '\t2.2. [[Concurrent powers]]',
  '\t\ti. **Summary**',
  '\t\t*Concurrent powers* are shared.',
  '\t\t',
  '\t\tii. **Internal function**',
  '\t\t',
  '\t\t',
  '\t\tiii. **Upstream dependency**',
  '',
  '',
  '\t\tiv. **Downstream target**',
  '\t\te',
  '',
  '\t2.3. [[Residual powers]]',
  '\t\ti. **Summary**',
  '\t\t*Residual powers* are outside the enumerated powers.',
  '',
  '3. [[Constitutional supremacy]]',
  '\ti. **Summary**',
  '\t*Constitutional supremacy* is the principle of the highest legal authority.',
  '',
  '---',
  '',
  'B. government',
  '1. [[Federal government]]',
  '\ti. **Summary**',
  '',
].join('\n');

// Deeper, with Obsidian's own bullets among the items written as text, and a line long enough to wrap.
const DEEP = [
  '1. [[Responsible government]]',
  '\t1.1. [[Parliamentary accountability]]',
  '\t\ti. **Summary**',
  '\t\tParliamentary accountability is the principle that the executive answers to the legislature for its decisions, its spending and its conduct, and keeps office only while it holds the confidence of the house.',
  '\t\t- a bullet of Obsidian\'s own',
  '\t\t- another',
  '',
  '\t\t1.1.1. [[Question period]]',
  '\t\t\ti. **Summary**',
  '\t\t\t',
  '\t\t\tii. **Function**',
  '\t\t\tWords under it.',
  '',
  '\t1.2. [[Confidence]]',
  '\t\ti. **Summary**',
  '',
].join('\n');

// Older notes, as they come: indented by two spaces, or three, tabs and spaces mixed, Windows line endings, and a
// non-breaking space pasted in an indent.
const TWO = OUTLINE.replace(/^\t+/gm, (t) => '  '.repeat(t.length));
const THREE = OUTLINE.replace(/^\t+/gm, (t) => '   '.repeat(t.length));
const MIXED = OUTLINE.split('\n').map((l, i) => (i % 2 ? l.replace(/^\t/, '    ') : l)).join('\n');

export const OLD_NOTES = {
  'two spaces': TWO,
  'three spaces': THREE,
  'tabs and spaces mixed': MIXED,
  'windows line endings': OUTLINE.replace(/\n/g, '\r\n'),
  'a non-breaking space': OUTLINE.replace('\t\t*Concurrent powers*', '\t\u00a0\t*Concurrent powers*'),
};

export const GUIDE_NOTES = {
  'deep': DEEP,
  'tabs': OUTLINE,
  'spaces': OUTLINE.replace(/^\t+/gm, (t) => '    '.repeat(t.length)),
};
