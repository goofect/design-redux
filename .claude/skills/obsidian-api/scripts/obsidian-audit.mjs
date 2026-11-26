#!/usr/bin/env node
// Checks a plugin's source against Obsidian's API, for correctness and speed.
// Run from the plugin's folder:  node obsidian-audit.mjs [src] [--stand-in <file>]
//
// Reports, with file:line:
//   deprecated   anything the installed obsidian.d.ts marks @deprecated
//   too new      public APIs added after manifest.json's minAppVersion
//   risk         patterns that lose data or break in some windows or versions
//   performance  patterns that are slow on a large vault or a long note
//   internal     app / vault / workspace members that aren't public API, and
//                whether a typeof check guards them
//   stand-in     (with --stand-in) public methods the source calls that a test
//                stand-in of Obsidian doesn't define
// A finding is a lead, not a verdict: read the line. Plain Node, no packages.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const srcDir = path.resolve(args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--stand-in') || 'src');
const dts = path.resolve(opt('--dts', 'node_modules/obsidian/obsidian.d.ts'));
const standIn = opt('--stand-in', null) && path.resolve(opt('--stand-in'));
if (!fs.existsSync(dts)) { console.error(`No ${dts}: run npm install.`); process.exit(1); }

// The API: members per class with @since and @deprecated.
const api = new Map(); // class -> Map(name -> { since, deprecated, method })
let owner = '', doc = '';
for (const raw of fs.readFileSync(dts, 'utf8').split('\n')) {
  const t = raw.trim();
  if (t.startsWith('/**') || t.startsWith('*')) { doc += t + '\n'; continue; }
  const top = raw.match(/^export (?:declare )?(?:abstract )?(class|interface) (\w+)/);
  if (top) { owner = top[2]; if (!api.has(owner)) api.set(owner, new Map()); doc = ''; continue; }
  if (raw === '}') { owner = ''; doc = ''; continue; }
  const m = owner && raw.match(/^ {4}(?:static |readonly |protected |abstract |get |set )*([\w$]+)[?]?\s*([(:<])/);
  if (m) api.get(owner).set(m[1], {
    since: (doc.match(/@since ([\d.]+)/) || [])[1] || '',
    deprecated: /@deprecated/.test(doc),
    method: m[2] !== ':',
  });
  doc = '';
}
const members = (cls) => api.get(cls) || new Map();
const isPublic = (cls, name) => {
  // A member is public if the class or anything it extends declares it.
  const seen = new Set();
  const chain = [cls];
  while (chain.length) {
    const c = chain.pop();
    if (seen.has(c)) continue;
    seen.add(c);
    if (members(c).has(name)) return true;
    const decl = fs.readFileSync(dts, 'utf8').match(new RegExp(`(?:class|interface) ${c}\\b[^{]*\\b(?:extends|implements) ([\\w, <>]+)\\{`));
    if (decl) decl[1].split(/[,\s<>]+/).filter(Boolean).forEach((p) => chain.push(p));
  }
  return false;
};

const min = (() => {
  try { return JSON.parse(fs.readFileSync('manifest.json', 'utf8')).minAppVersion || '0.0.0'; } catch { return '0.0.0'; }
})();
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// Distinctive names only: a short or common name would match everything.
const COMMON = new Set(['name', 'type', 'items', 'key', 'value', 'title', 'path', 'file', 'icon', 'render', 'display', 'update', 'hide', 'show', 'open', 'close', 'get', 'set', 'min', 'max', 'step', 'heading', 'filter', 'options', 'placeholder', 'default', 'visible', 'status', 'page', 'rows', 'search', 'match', 'control', 'action', 'settings', 'data', 'config', 'length', 'equals', 'toString', 'concat', 'includes']);
// Names JavaScript itself has (Object.entries, array.filter) are not Obsidian's.
const BUILTIN = (name) => [Object, Object.prototype, Array.prototype, Map.prototype, Set.prototype, String.prototype, Promise.prototype, Math, JSON, Number, Date.prototype].some((o) => name in o);
const deprecated = new Map(), recent = new Map();
for (const [cls, m] of api) for (const [name, info] of m) {
  if (name.length < 6 || COMMON.has(name)) continue;
  if (BUILTIN(name)) continue;
  // Deprecated only where no other class keeps the same name current
  // (ButtonComponent.setWarning is deprecated, MenuItem.setWarning is not).
  const current = [...api.values()].some((mm) => mm.has(name) && !mm.get(name).deprecated);
  if (info.deprecated && !current) deprecated.set(name, cls);
  if (info.since && newer(info.since, min)) {
    const older = [...api.values()].some((mm) => mm.has(name) && !(mm.get(name).since && newer(mm.get(name).since, min)));
    if (!older) recent.set(name, `${cls} ${info.since}`);
  }
}

const RISKS = [
  [/workspace\.activeLeaf\b/, 'workspace.activeLeaf can be a sidebar or null: getActiveViewOfType() or getMostRecentLeaf()'],
  [/\bvault\.modify\(/, 'vault.modify writes what was read earlier, losing edits made meanwhile: vault.process()'],
  [/\bvault\.rename\(/, 'vault.rename leaves links to the file broken: fileManager.renameFile()'],
  [/\bvault\.delete\(/, 'vault.delete skips the trash: fileManager.trashFile()'],
  [/\b(window\.app|globalThis\.app)\b/, 'the global app can be another vault\'s in some setups: this.app'],
  [/\(\?<[=!]/, 'regex lookbehind throws on iOS before 16.4'],
  [/\bdocument\.(body|createElement|querySelector|addEventListener)/, 'the main document: in a popout window use el.doc or activeDocument'],
  [/(?:^|[^.\w])instanceof\s+(HTMLElement|Element|Node|MouseEvent|KeyboardEvent)\b/, 'instanceof fails across windows: x.instanceOf(HTMLElement)'],
  [/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(/, 'HTML from a string can run a note\'s content as markup: createEl'],
  [/\bsetInterval\(/, 'an interval outlives the plugin unless wrapped in registerInterval()'],
  // 1.15 runtime changes, not yet in the typings
  [/^(?!.*classList\.contains\().*\.contains\(\s*['"`\d[]/, 'Array#contains / String#contains are deprecated (1.15.1): includes()'],
  [/\bactiveWindow\.(setTimeout|setInterval)\(/, 'a timer on a popout window never fires once it closes (1.15.1): window.setTimeout / setInterval'],
  [/\bPIXI\b/, 'PIXI loads with the first graph since 1.15.0: await loadPixi() before using it, guarded'],
  [/^\s*(await\s+)?[\w.]*\.trashFile\(/, 'trashFile resolves false when it could not trash (1.15.1): check the result'],
  [/\.name\s*===?\s*['"`][^'"`]*formatting/, 'syntax-tree names gained formatting-*-end (1.15.0): match a segment of name.split("_"), not the whole name'],
  [/\bmermaid\b/i, 'Mermaid is drawn by Pele since 1.15.0: its class names are gone, only initialize/render/parse/mermaidAPI remain'],
];
const SLOW = [
  [/\.(getMarkdownFiles|getFiles|getAllLoadedFiles|getAllFolders)\(\)/, 'walks the whole vault: fine once, slow in an event handler or a render'],
  [/\bvault\.(read|cachedRead)\(/, 'reads file text: in a loop over many files prefer metadataCache, or read once and keep'],
  [/\bdocument\.querySelectorAll\(|\bactiveDocument\.querySelectorAll\(/, 'scans the whole window\'s DOM'],
  [/JSON\.parse\(JSON\.stringify\(/, 'deep copy by JSON: slow on big objects, structuredClone() or a targeted copy'],
  [/\bsyntaxTree\(/, 'syntaxTree gives only what is parsed so far; for decorations use the visible ranges, not the whole document'],
  [/\.getValue\(\)/, 'editor.getValue() copies the whole note: on every keystroke it is slow, read the changed range instead'],
  [/\bresolvedLinks\b/, 'resolvedLinks holds every link in the vault: build backlinks once and keep them current, never per render'],
  [/new\s+MutationObserver\(/, 'a MutationObserver: observe the smallest element, without subtree where possible, and debounce'],
  [/\.on\(\s*['"]modify['"]/, 'vault modify fires on every autosave while typing: keep the handler cheap or debounced'],
];

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(js|mjs|ts)$/.test(e.name)) files.push(p);
  }
})(srcDir);

const standInText = standIn && fs.existsSync(standIn) ? fs.readFileSync(standIn, 'utf8') : '';
const out = { deprecated: [], 'too new': [], risk: [], performance: [], internal: [], 'stand-in': [] };
const OWNERS = { app: 'App', vault: 'Vault', workspace: 'Workspace', metadataCache: 'MetadataCache', fileManager: 'FileManager' };
const usedApi = new Map();

for (const f of files) {
  const rel = path.relative(process.cwd(), f);
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    const at = `${rel}:${i + 1}`;
    for (const m of line.matchAll(/\.([\w$]{6,})\s*\(/g)) {
      if (deprecated.has(m[1])) out.deprecated.push(`${at}  ${m[1]} (${deprecated.get(m[1])})`);
      if (recent.has(m[1])) out['too new'].push(`${at}  ${m[1]} (${recent.get(m[1])}, minAppVersion ${min})`);
    }
    for (const [re, why] of RISKS) if (re.test(line)) out.risk.push(`${at}  ${why}`);
    for (const [re, why] of SLOW) if (re.test(line)) out.performance.push(`${at}  ${why}`);
    // Each owner word on its own, so app.workspace.x checks both app.workspace and workspace.x.
    for (const w of line.matchAll(/\b(app|vault|workspace|metadataCache|fileManager)\b/g)) {
      const after = line.slice(w.index + w[0].length);
      const mm = after.match(/^\.([\w$]+)/);
      if (!mm) continue;
      const m = [w[0] + mm[0], w[1], mm[1]];
      const cls = OWNERS[m[1]];
      const name = m[2];
      if (isPublic(cls, name)) {
        if (/^\s*\(/.test(after.slice(mm[0].length))) usedApi.set(name, at);
        continue;
      }
      if (cls === 'App' && OWNERS[name]) continue;
      const near = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
      const guarded = /typeof|\?\./.test(near) || new RegExp(`\\b${name}\\b\\s*&&|&&[^\\n]*\\b${name}\\b`).test(near);
      out.internal.push(`${at}  ${m[1]}.${name}${guarded ? '' : '   NOT GUARDED'}`);
    }
  });
}
if (standInText) for (const [name, at] of usedApi) {
  if (!new RegExp(`\\b${name}\\s*\\(`).test(standInText)) out['stand-in'].push(`${at}  ${name}() is not in ${path.relative(process.cwd(), standIn)}`);
}

let total = 0;
for (const [kind, list] of Object.entries(out)) {
  if (kind === 'stand-in' && !standInText) continue;
  const uniq = [...new Set(list)];
  total += uniq.length;
  console.log(`\n${kind} (${uniq.length})`);
  uniq.forEach((l) => console.log(`  ${l}`));
}
console.log(`\n${files.length} files, ${total} findings, against obsidian.d.ts at ${path.relative(process.cwd(), dts)}, minAppVersion ${min}`);
