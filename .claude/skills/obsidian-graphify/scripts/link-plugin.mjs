#!/usr/bin/env node
// Joins a plugin's own graphify graph to Obsidian's component graph: each source file is
// linked to the Obsidian components it uses, so `graphify path` and `explain` can answer
// "what in Obsidian does this file touch" and "which of my files depend on X".
//
//   node link-plugin.mjs --plugin <plugin folder> [--plugin-graph <its graph.json>]
//                        [--obsidian obsidian-graph/graph.json] [--out obsidian-graph/with-plugin]
//
// The plugin's graph is graphify's code graph of its folder (`graphify update <folder>
// --no-cluster` makes one with no model; default <folder>/graphify-out/graph.json).
// Writes <out>/graph.json and, with graphify installed, clusters it (no model).
// What it finds, by reading each .js/.ts/.mjs/.css file:
//   imports from 'obsidian'             → uses_api     → the public class or function
//   app.<x>[.<y>]                       → uses         → the live object
//   .on('<event>') / trigger('<event>') → listens_to   → the event
//   executeCommandById('<id>')          → runs_command → the command
//   getLeavesOfType / setViewState type → uses_view    → the view type
//   getConfig('<key>')                  → reads_setting
//   internalPlugins.getPluginById('<id>') → uses_core_plugin
//   CSS: var(--x) of Obsidian's         → uses_css_var;  .class of Obsidian's DOM → styles_region

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const plugin = path.resolve(opt('--plugin', '.'));
const pluginGraphPath = path.resolve(opt('--plugin-graph', path.join(plugin, 'graphify-out', 'graph.json')));
const obsidianPath = path.resolve(opt('--obsidian', 'obsidian-graph/graph.json'));
const out = path.resolve(opt('--out', path.join(path.dirname(obsidianPath), 'with-plugin')));
for (const [what, p] of [['plugin graph', pluginGraphPath], ['Obsidian graph', obsidianPath]])
  if (!fs.existsSync(p)) { console.error(`No ${what} at ${p}.`); process.exit(1); }

const id = (...parts) => parts.join('_').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const og = JSON.parse(fs.readFileSync(obsidianPath, 'utf8'));
const pg = JSON.parse(fs.readFileSync(pluginGraphPath, 'utf8'));
const nodes = new Map();
// The plugin graph's nodes from copies (a worktree, a test vault: any folder starting with a dot) are left out.
const copy = (f) => /(^|\/)\.[^/]+\//.test(String(f ?? '').replace(/\\/g, '/'));
const pgNodes = pg.nodes.filter((n) => !copy(n.source_file));
const kept = new Set(pgNodes.map((n) => n.id));
for (const n of [...og.nodes, ...pgNodes]) if (!nodes.has(n.id)) nodes.set(n.id, n);
const links = [...og.links, ...(pg.links ?? pg.edges ?? []).filter((e) => kept.has(e.source) && kept.has(e.target))];
const seen = new Set(links.map((e) => `${e.source}|${e.relation}|${e.target}`));
const link = (s, t, relation, file) => {
  const key = `${s}|${relation}|${t}`;
  if (s === t || seen.has(key) || !nodes.has(t)) return false;
  seen.add(key);
  links.push({ source: s, target: t, relation, confidence: 'EXTRACTED', source_file: file, weight: 1 });
  return true;
};

// The plugin's file nodes, by path; a file graphify didn't index (CSS) gets one.
const fileNode = new Map();
for (const n of pgNodes) if (n.source_file && n.label === path.basename(n.source_file)) fileNode.set(n.source_file.replace(/\\/g, '/'), n.id);
const fileId = (rel) => {
  if (!fileNode.has(rel)) {
    const nid = id('plugin_file', rel);
    nodes.set(nid, { id: nid, label: path.basename(rel), file_type: 'code', source_file: rel, source_location: 'L1', type: 'plugin-file' });
    fileNode.set(rel, nid);
  }
  return fileNode.get(rel);
};
if (nodes.has('ref_obsidian')) link('ref_obsidian', 'obsidian_module', 'same_as', 'obsidian');

// The plugin's own source: git's files when it is a repository (so no copies in worktrees, test
// vaults or build output), every folder whose name starts with a dot left out either way, and its
// tests and tools only with --all (a test's stand-in for Obsidian is not a use of Obsidian).
const skip = /(^|\/)(node_modules|graphify-out|obsidian-graph|dist|build|\.[^/]+)(\/|$)/;
const notRuntime = /(^|\/)(tests?|__tests__|spec|tools|scripts)\/|\.(test|spec|e2e)\.[mc]?[jt]s$/;
const source = /\.([mc]?js|tsx?|jsx|css)$/;
let listed = null;
const git = spawnSync('git', ['-C', plugin, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
if (git.status === 0) listed = git.stdout.split('\n').filter(Boolean);
else {
  listed = [];
  (function scan(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.relative(plugin, path.join(dir, e.name)).replace(/\\/g, '/');
      if (skip.test(rel)) continue;
      if (e.isDirectory()) scan(path.join(dir, e.name));
      else if (!/^(main\.js|styles\.css)$/.test(rel)) listed.push(rel); // not the built bundles
    }
  })(plugin);
}
const files = listed.filter((rel) => source.test(rel) && !skip.test(rel) && (args.includes('--all') || !notRuntime.test(rel)) && fs.existsSync(path.join(plugin, rel))).sort();
const liveEvents = new Map();                            // event name → the live listeners' nodes
for (const n of og.nodes) if (n.type === 'event') {
  const ev = n.label.match(/on\('(.+)'\)/)?.[1];
  if (ev) liveEvents.set(ev, [...(liveEvents.get(ev) ?? []), n.id]);
}

const counts = {};
const count = (rel, ok) => { if (ok) counts[rel] = (counts[rel] || 0) + 1; };
for (const rel of files) {
  const src = fs.readFileSync(path.join(plugin, rel), 'utf8');
  const me = () => fileId(rel);
  if (rel.endsWith('.css')) {
    for (const m of src.matchAll(/var\((--[\w-]+)/g)) count(rel, link(me(), id('obsidian_css', m[1]), 'uses_css_var', rel));
    for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-z][\w-]+)/g)) count(rel, link(me(), id('obsidian_dom', m[1]), 'styles_region', rel));
    for (const m of src.matchAll(/body\.([\w-]+)/g)) count(rel, link(me(), id('obsidian_body_class', m[1]), 'styles_region', rel));
    continue;
  }
  // import { A, B as C } from 'obsidian', const { A } = require('obsidian'), obsidian.A / import * as obsidian
  for (const m of src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]obsidian['"]|(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"]obsidian['"]\s*\)/g))
    for (const name of (m[1] ?? m[2]).split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+|\s*:\s*/)[0]).filter(Boolean)) count(rel, link(me(), id('obsidian_d', name), 'uses_api', rel));
  const ns = src.match(/import\s*\*\s*as\s*(\w+)\s*from\s*['"]obsidian['"]|(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]obsidian['"]\s*\)/);
  if (ns) for (const m of src.matchAll(new RegExp(`\\b${ns[1] ?? ns[2]}\\.(\\w+)`, 'g'))) count(rel, link(me(), id('obsidian_d', m[1]), 'uses_api', rel));
  // app.x, app.x.y, app.x.y.z: the deepest live object it names.
  for (const m of src.matchAll(/\bapp\.(\w+)(?:\.(\w+))?(?:\.(\w+))?/g)) {
    const parts = [m[1], m[2], m[3]].filter(Boolean);
    while (parts.length && !nodes.has(id('obsidian_rt', `app.${parts.join('.')}`))) parts.pop();
    if (parts.length) count(rel, link(me(), id('obsidian_rt', `app.${parts.join('.')}`), 'uses', rel));
  }
  for (const m of src.matchAll(/\.(?:on|off|trigger|tryTrigger)\(\s*['"]([\w:-]+)['"]/g)) {
    count(rel, link(me(), id('obsidian_event_name', m[1]), 'listens_to', rel));
    for (const ev of liveEvents.get(m[1]) ?? []) link(me(), ev, 'listens_to', rel);
  }
  for (const m of src.matchAll(/executeCommandById\(\s*['"]([\w:-]+)['"]/g)) count(rel, link(me(), id('obsidian_command', m[1]), 'runs_command', rel));
  for (const m of src.matchAll(/(?:getLeavesOfType|detachLeavesOfType)\(\s*['"]([\w-]+)['"]|(?:getViewType\(\)|viewType)\s*[!=]==?\s*['"]([\w-]+)['"]|type:\s*['"]([\w-]+)['"]/g)) count(rel, link(me(), id('obsidian_view', m[1] ?? m[2] ?? m[3]), 'uses_view', rel));
  for (const m of src.matchAll(/(?:setIcon\([^,()]*,\s*|addRibbonIcon\(\s*|setIcon\(\s*|icon:\s*)['"]([\w-]+)['"]/g)) count(rel, link(me(), id('obsidian_icon', m[1]), 'uses_icon', rel));
  for (const m of src.matchAll(/registerMarkdownCodeBlockProcessor\(\s*['"]([\w-]+)['"]/g)) count(rel, link(me(), id('obsidian_code_block', m[1]), 'renders_code_block', rel));
  for (const m of src.matchAll(/getConfig\(\s*['"](\w+)['"]/g)) count(rel, link(me(), id('obsidian_setting', m[1]), 'reads_setting', rel));
  for (const m of src.matchAll(/getPluginById\(\s*['"]([\w-]+)['"]/g)) count(rel, link(me(), id('obsidian_core_plugin', m[1]), 'uses_core_plugin', rel));
}

const graph = { directed: true, multigraph: false, graph: { source: 'obsidian-graphify link-plugin' }, nodes: [...nodes.values()], links, hyperedges: [] };
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(graph));
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f, n]) => `${f} ${n}`).join(', ');
console.log(`linked    ${total} uses of Obsidian from ${Object.keys(counts).length} of ${files.length} files → ${path.join(out, 'graph.json')}`);
console.log(`          most: ${top}`);
if (spawnSync('graphify', ['--version']).status === 0 && !args.includes('--no-cluster')) {
  const flags = ['cluster-only', out, '--graph', path.join(out, 'graph.json'), ...(graph.nodes.length > 5000 ? ['--no-viz'] : [])];
  // The build is from scratch: the last clustering goes, or graphify refuses a graph that lost nodes.
  fs.rmSync(path.join(out, 'graphify-out'), { recursive: true, force: true });
  let r;
  for (let pass = 0; pass < 2; pass++) r = spawnSync('graphify', flags, { encoding: 'utf8', env: { ...process.env, GRAPHIFY_BACKEND: 'none' } });
  console.log(r.status === 0 ? 'clustered GRAPH_REPORT.md and graph.html' : `cluster-only failed: ${r.stderr.trim().split('\n').slice(-2).join(' ')}`);
}
