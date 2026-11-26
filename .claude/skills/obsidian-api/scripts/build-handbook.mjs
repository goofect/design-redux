#!/usr/bin/env node
// Builds the handbook: everything in this skill as one file any AI can be
// given, and a complete listing of Obsidian's public API made from the
// installed obsidian.d.ts.
//
//   node build-handbook.mjs [--dts node_modules/obsidian/obsidian.d.ts] [--out handbook]
//
// Writes <out>/HANDBOOK.md (this skill: SKILL.md and every reference, in
// reading order) and <out>/API.md (every public declaration: its
// signature, version and first sentence). API.md needs the `typescript`
// package, from the current folder or this script's; HANDBOOK.md needs
// nothing. Run it again after changing the skill or updating `obsidian`.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const here = path.dirname(fileURLToPath(import.meta.url));
const skill = path.resolve(here, '..');
const out = path.resolve(opt('--out', 'handbook'));
const dts = path.resolve(opt('--dts', 'node_modules/obsidian/obsidian.d.ts'));
fs.mkdirSync(out, { recursive: true });

// ---- HANDBOOK.md ----------------------------------------------------------

const ORDER = [
  ['javascript.md', 'JavaScript in Obsidian'],
  ['markdown.md', 'How Obsidian reads Markdown'],
  ['areas.md', 'More of the API'],
  ['performance.md', 'Performance'],
  ['architecture.md', 'Architecture and file layout'],
  ['recipes.md', 'Recipes'],
  ['community.md', 'What the community says'],
];

const slug = (t) => t.toLowerCase().replace(/[`*_]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

// Headings one level deeper, outside code fences, so each part nests under its own.
function demote(md, by) {
  let fence = false;
  return md.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    return !fence && /^#{1,5} /.test(line) ? '#'.repeat(by) + line : line;
  }).join('\n');
}
const body = (file) => fs.readFileSync(file, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const version = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(dts), 'package.json'), 'utf8')).version; } catch { return null; }
})();

const parts = [['SKILL.md', 'Overview']].concat(ORDER).filter(([f]) => fs.existsSync(f === 'SKILL.md' ? path.join(skill, f) : path.join(skill, 'references', f)));
const sections = parts.map(([file, title], i) => {
  const text = body(file === 'SKILL.md' ? path.join(skill, file) : path.join(skill, 'references', file))
    .replace(/^# .*\n/, '')                                                  // the part's own title is replaced
    .replace(/`references\/([\w-]+)\.md`/g, (m, f) => {                    // cross-references become links
      const hit = ORDER.find(([name]) => name === `${f}.md`);
      return hit ? `[${hit[1]}](#${slug(`${parts.findIndex(([n]) => n === hit[0]) + 1}. ${hit[1]}`)})` : m;
    });
  return `## ${i + 1}. ${title}\n\n${demote(text, 1)}`;
});

const handbook = `# Obsidian plugin handbook

Everything needed to build, change, debug and speed up Obsidian plugins: the
API and what changed through 1.15, how Obsidian works inside (its Markdown
parsers, editor, metadata cache, styles), the JavaScript its runtime allows,
architecture, performance and working recipes. Built ${new Date().toISOString().slice(0, 10)} from the
\`obsidian-api\` skill${version ? `, against the \`obsidian\` package ${version}` : ''}.

## How to use this handbook (for an AI)

- **Check an API before using it.** API.md, which comes with this file, lists
  every public declaration with its signature, the version it arrived in, and
  whether it is deprecated. A name that isn't there is not public: treat it
  as an internal (guard it with \`typeof\` and keep a way through).
- **Versions.** An API newer than the plugin's \`minAppVersion\` needs
  \`requireApiVersion()\` or a \`typeof\` check. 1.15's changes are not in the
  typings yet; section 1 lists them.
- **Runtime.** The JavaScript a plugin can use depends on the installer's
  Chromium, not the app version (section 2). Build for \`chrome138\`.
- **Markdown.** Obsidian has three separate readers and none can be extended
  (section 3); change their output with decorations, keys, post-processors and
  your own index.
- **Code.** Prefer the recipes (section 7): they were written against this API
  and most were run. Register everything through the plugin or a
  \`Component\`; write notes with \`vault.process\` / \`processFrontMatter\`;
  read from the metadata cache, not the files; start work at layout-ready.
- **Scripts** named here (\`scripts/obsidian-api.mjs\` and the others) are in
  the skill's folder; when you can't run them, use API.md.

## Contents

${sections.map((s) => s.split('\n')[0].replace(/^## /, '')).map((t) => `- [${t}](#${slug(t)})`).join('\n')}

${sections.join('\n\n')}
`;
fs.writeFileSync(path.join(out, 'HANDBOOK.md'), handbook);
console.log(`HANDBOOK.md  ${Math.round(handbook.length / 1024)} KB, ${parts.length} parts`);

// ---- API.md ---------------------------------------------------------------

let ts;
for (const from of [process.cwd() + '/', here + '/']) {
  try { ts = createRequire(from)('typescript'); break; } catch { /* next */ }
}
if (!ts) { console.log('API.md skipped: install typescript (npm i -D typescript) to build it.'); process.exit(0); }
if (!fs.existsSync(dts)) { console.log(`API.md skipped: no ${dts} (pass --dts).`); process.exit(0); }

const tag = (node, name) => {
  const t = ts.getJSDocTags(node).find((x) => x.tagName.text === name);
  if (!t) return null;
  const c = t.comment;
  return (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text).join('') : '').trim() || 'yes';
};
const summary = (node, max) => {
  const doc = (node.jsDoc || [])[0];
  if (!doc || !doc.comment) return '';
  const c = typeof doc.comment === 'string' ? doc.comment : doc.comment.map((p) => p.text || '').join('');
  const first = c.replace(/\s+/g, ' ').trim().split(/(?<=\.)\s/)[0];
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};
const flat = (s) => s.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
const notes = (node) => {
  const n = [];
  const since = tag(node, 'since');
  const dep = tag(node, 'deprecated');
  if (since && since !== 'yes') n.push(`since ${since}`);
  if (dep) n.push(`DEPRECATED${dep === 'yes' ? '' : `: ${dep.replace(/\s+/g, ' ').slice(0, 90)}`}`);
  return n;
};

function listMembers(sf, members) {
  const lines = [];
  for (const m of members) {
    if (ts.isConstructorDeclaration(m) || ts.isMethodDeclaration(m) || ts.isMethodSignature(m) || ts.isPropertyDeclaration(m) || ts.isPropertySignature(m) || ts.isGetAccessor(m) || ts.isSetAccessor(m) || ts.isIndexSignatureDeclaration(m) || ts.isCallSignatureDeclaration(m)) {
      let text = flat(m.getText(sf));
      const s = summary(m, 100);
      const n = notes(m);
      const tail = [s, ...n].filter(Boolean).join(' · ');
      lines.push(tail ? `${text}  // ${tail}` : text);
    }
  }
  return lines;
}

function headOf(sf, node) {
  const text = node.getText(sf);
  const brace = text.indexOf('{');
  return flat(brace === -1 ? text : text.slice(0, brace));
}

function render(sf, statements) {
  const blocks = [];
  for (const node of statements) {
    if (ts.isModuleDeclaration(node) && node.body && ts.isModuleBlock(node.body)) { blocks.push(...render(sf, node.body.statements)); continue; }
    if (ts.isImportDeclaration(node)) continue;
    const name = node.name ? node.name.getText(sf) : ts.isVariableStatement(node) ? node.declarationList.declarations.map((d) => d.name.getText(sf)).join(', ') : '';
    if (!name) continue;
    const meta = [summary(node, 200), ...notes(node.jsDoc ? node : (node.declarationList?.declarations[0] ?? node))].filter(Boolean).join(' · ');
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      const members = listMembers(sf, node.members);
      blocks.push({ name, text: `### ${name}\n\n${meta ? `${meta}\n\n` : ''}\`\`\`ts\n${headOf(sf, node)} {\n${members.map((l) => `  ${l}`).join('\n')}\n}\n\`\`\`` });
    } else {
      blocks.push({ name, text: `### ${name}\n\n${meta ? `${meta}\n\n` : ''}\`\`\`ts\n${flat(node.getText(sf))}\n\`\`\`` });
    }
  }
  return blocks;
}

function file(p) {
  const sf = ts.createSourceFile(p, fs.readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true);
  const global = [];
  const local = [];
  for (const node of sf.statements) {
    if (ts.isModuleDeclaration(node) && node.name.getText(sf) === 'global') global.push(...render(sf, node.body.statements));
    else local.push(...render(sf, [node]));
  }
  return { global, local };
}

const main = file(dts);
const canvasPath = path.join(path.dirname(dts), 'canvas.d.ts');
const canvas = fs.existsSync(canvasPath) ? file(canvasPath).local : [];
main.local.sort((a, b) => a.name.localeCompare(b.name));
const api = `# Obsidian API listing

Every public declaration in \`obsidian.d.ts\`${version ? ` ${version}` : ''}, made by
\`scripts/build-handbook.mjs\` on ${new Date().toISOString().slice(0, 10)}. Each member shows its signature, then
its first sentence, the version it arrived in, and whether it is deprecated.
A name that isn't here is not public API. Changes in 1.15 that the typings
don't have yet are in the handbook's section 1.

## Contents

- [What Obsidian adds to the DOM and built-ins](#what-obsidian-adds-to-the-dom-and-built-ins) (createEl, createDiv, el.doc, instanceOf, …)
- [The obsidian module](#the-obsidian-module), ${main.local.length} declarations A–Z
${canvas.length ? '- [JSON Canvas types (canvas.d.ts)](#json-canvas-types-canvasdts)\n' : ''}
## What Obsidian adds to the DOM and built-ins

${main.global.map((b) => b.text).join('\n\n')}

## The obsidian module

${main.local.map((b) => b.text).join('\n\n')}
${canvas.length ? `\n## JSON Canvas types (canvas.d.ts)\n\n${canvas.map((b) => b.text).join('\n\n')}\n` : ''}`;
fs.writeFileSync(path.join(out, 'API.md'), api);
console.log(`API.md       ${Math.round(api.length / 1024)} KB, ${main.local.length} declarations, ${main.global.length} global, ${canvas.length} canvas`);
