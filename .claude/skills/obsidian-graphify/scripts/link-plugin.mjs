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
for (const n of [...og.nodes, ...pg.nodes]) if (!nodes.has(n.id)) nodes.set(n.id, n);
const links = [...og.links, ...(pg.links ?? pg.edges ?? [])];
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
for (const n of pg.nodes) if (n.source_file && n.label === path.basename(n.source_file)) fileNode.set(n.source_file.replace(/\\/g, '/'), n.id);
const fileId = (rel) => {
  if (!fileNode.has(rel)) {
    const nid = id('plugin_file', rel);
    nodes.set(nid, { id: nid, label: path.basename(rel), file_type: 'code', source_file: rel, source_location: 'L1', type: 'plugin-file' });
    fileNode.set(rel, nid);
  }
  return fileNode.get(rel);
};
if (nodes.has('ref_obsidian')) link('ref_obsidian', 'obsidian_module', 'same_as', 'obsidian');

const skip = /(^|\/)(node_modules|graphify-out|obsidian-graph|\.git|\.obsidian-cache|dist|build)(\/|$)/;
const files = [];
(function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(plugin, p).replace(/\\/g, '/');
    if (skip.test(rel)) continue;
    if (e.isDirectory()) scan(p);
    else if (/\.(m?js|ts|css)$/.test(e.name) && !/^(main\.js|styles\.css)$/.test(rel)) files.push(rel); // not the built bundles
  }
})(plugin);

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
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]obsidian['"]/g))
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) count(rel, link(me(), id('obsidian_d', name), 'uses_api', rel));
  for (const m of src.matchAll(/\bapp\.(\w+)(?:\.(\w+))?/g)) {
    const deep = m[2] && link(me(), id('obsidian_rt', `app.${m[1]}.${m[2]}`), 'uses', rel);
    count(rel, deep || link(me(), id('obsidian_rt', `app.${m[1]}`), 'uses', rel));
  }
  for (const m of src.matchAll(/\.(?:on|trigger)\(\s*['"]([\w:-]+)['"]/g)) count(rel, link(me(), id('obsidian_event_name', m[1]), 'listens_to', rel));
  for (const m of src.matchAll(/executeCommandById\(\s*['"]([\w:-]+)['"]/g)) count(rel, link(me(), id('obsidian_command', m[1]), 'runs_command', rel));
  for (const m of src.matchAll(/(?:getLeavesOfType|detachLeavesOfType)\(\s*['"]([\w-]+)['"]|type:\s*['"]([\w-]+)['"]/g)) count(rel, link(me(), id('obsidian_view', m[1] ?? m[2]), 'uses_view', rel));
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
  const r = spawnSync('graphify', ['cluster-only', out, '--graph', path.join(out, 'graph.json')], { encoding: 'utf8', env: { ...process.env, GRAPHIFY_BACKEND: 'none' } });
  console.log(r.status === 0 ? 'clustered GRAPH_REPORT.md and graph.html' : `cluster-only failed: ${r.stderr.trim().split('\n').slice(-2).join(' ')}`);
}
