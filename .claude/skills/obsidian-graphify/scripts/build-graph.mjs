#!/usr/bin/env node
// Builds Obsidian's component graph for graphify from three sources:
//   1. live.json: what the running app holds (ci/extract.e2e.mjs writes it);
//   2. the app's own code, read from its .asar: every event it triggers, every setting's
//      default, the command line, startup stages, URI actions, IPC, libraries, CSS variables;
//   3. the public typings (obsidian.d.ts), as graphify's own code graph, which marks each
//      live class and method as typed (public API) or not (internal).
//
//   node build-graph.mjs [--live obsidian-graph/live.json] [--asar <obsidian-x.y.z.asar>]
//                        [--dts <folder with obsidian.d.ts>] [--out obsidian-graph] [--no-cluster]
//
// Writes <out>/graph.json in graphify's node-link schema; with graphify installed it also
// runs `graphify cluster-only` (no model needed) for GRAPH_REPORT.md and graph.html.
// The .asar is found as the CI leaves it (.obsidian-cache/obsidian-app/), or in the app's
// own folder; the typings in node_modules/obsidian. Plain Node; graphify is optional.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i === -1 ? d : args[i + 1]; };
const has = (n) => args.includes(n);
const out = path.resolve(opt('--out', 'obsidian-graph'));
const livePath = path.resolve(opt('--live', path.join(out, 'live.json')));
fs.mkdirSync(out, { recursive: true });

const id = (...parts) => parts.join('_').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const nodes = new Map();
const links = [];
const seenLinks = new Set();
function node(nid, label, kind, source_file, metadata = {}) {
  if (!nodes.has(nid)) nodes.set(nid, { id: nid, label, file_type: 'code', source_file, source_location: kind, type: kind, metadata: { kind, ...metadata } });
  else Object.assign(nodes.get(nid).metadata, metadata);
  return nid;
}
function link(source, target, relation, source_file, confidence = 'EXTRACTED') {
  const key = `${source}|${relation}|${target}`;
  if (source === target || seenLinks.has(key)) return;
  seenLinks.add(key);
  links.push({ source, target, relation, confidence, source_file, weight: 1 });
}
const absorb = (g) => {
  for (const n of g.nodes) nodes.has(n.id) ? Object.assign(nodes.get(n.id).metadata ??= {}, n.metadata ?? {}) : nodes.set(n.id, { ...n });
  for (const e of g.links ?? g.edges ?? []) link(e.source, e.target, e.relation, e.source_file, e.confidence);
};

// ---- 1. The live app ----------------------------------------------------------------------
let live = null;
if (fs.existsSync(livePath)) {
  live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
  absorb(live);
  console.log(`live      ${live.nodes.length} nodes (Obsidian ${live.inventory?.version ?? '?'})`);
} else console.log(`live      none (${livePath}): run ci/extract.e2e.mjs first for the running app's components`);
node('obsidian', `Obsidian${live?.inventory?.version ? ` ${live.inventory.version}` : ''}`, 'app', 'obsidian');

// ---- 2. The app's own code ---------------------------------------------------------------
function walk(dir, hits = [], depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return hits;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, hits, depth + 1);
    else if (/^obsidian-[\d.]+\.asar$/.test(e.name)) hits.push(p);
  }
  return hits;
}
const ver = (p) => (path.basename(p).match(/[\d.]+(?=\.asar)/) || ['0'])[0].split('.').map(Number);
const newest = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); return 0; };
const asarPath = opt('--asar') || process.env.OBSIDIAN_ASAR || [
  ...walk(path.resolve(process.env.OBSIDIAN_CACHE || '.obsidian-cache')),
  ...walk(path.join(os.homedir(), 'Library/Application Support/obsidian')),
  ...walk(path.join(os.homedir(), '.config/obsidian')),
].sort(newest)[0];

function openAsar(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const json = Buffer.alloc(head.readUInt32LE(12));
  fs.readSync(fd, json, 0, json.length, 16);
  const root = JSON.parse(json.toString('utf8'));
  const list = (n = root, at = '') => Object.entries(n.files || {}).flatMap(([k, v]) => v.files ? list(v, `${at}${k}/`) : [`${at}${k}`]);
  const read = (want) => {
    let n = root;
    for (const part of want.split('/')) if (!(n = n.files?.[part])) return null;
    const buf = Buffer.alloc(n.size);
    fs.readSync(fd, buf, 0, n.size, 8 + head.readUInt32LE(4) + Number(n.offset));
    return buf.toString('utf8');
  };
  return { list, read };
}
const uniq = (src, re) => [...new Set([...src.matchAll(re)].map((m) => m[1]))].sort();
const braceAt = (src, at) => {
  const a = src.lastIndexOf('{', at);
  for (let depth = 0, j = a; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}' && --depth === 0) return src.slice(a, j + 1);
  }
  return null;
};

if (asarPath && fs.existsSync(asarPath)) {
  const pack = openAsar(asarPath);
  const app = pack.read('app.js');
  const main = pack.read('main.js') ?? '';
  const css = pack.read('app.css') ?? '';
  const version = JSON.parse(pack.read('package.json') ?? '{}').version;
  const before = nodes.size;
  const APP = node('obsidian_file_app_js', 'app.js', 'source-file', 'app.js');
  const MAIN = node('obsidian_file_main_js', 'main.js (Electron main process)', 'source-file', 'main.js');
  const CSS = node('obsidian_file_app_css', 'app.css', 'source-file', 'app.css');
  for (const f of [APP, MAIN, CSS]) link('obsidian', f, 'built_from', 'obsidian');
  if (version) node('obsidian', `Obsidian ${version}`, 'app', 'obsidian', { version });

  // Events: every name the app triggers; live listeners point at their name.
  for (const ev of uniq(app, /\.trigger\("([\w:-]+)"/g)) link(APP, node(id('obsidian_event_name', ev), `'${ev}' (event)`, 'event-name', 'app.js'), 'triggers', 'app.js');
  for (const n of [...nodes.values()].filter((x) => x.type === 'event')) {
    const ev = n.label.match(/on\('(.+)'\)/)?.[1];
    if (ev) link(n.id, node(id('obsidian_event_name', ev), `'${ev}' (event)`, 'event-name', 'app.js'), 'is_event', 'app.js');
  }

  // Settings: every key of vault.getConfig, with its default.
  const at = app.indexOf('alwaysUpdateLinks:');
  let defaults = {};
  try { defaults = new Function(`return ${braceAt(app, at)}`)(); } catch { /* the literal changed shape */ }
  const VAULT = nodes.has('obsidian_rt_app_vault') ? 'obsidian_rt_app_vault' : APP;
  for (const [key, value] of Object.entries(defaults))
    link(VAULT, node(id('obsidian_setting', key), key, 'setting', 'app.js', { default: JSON.stringify(value)?.slice(0, 120) }), 'has_setting', 'app.js');

  // The command line, with each command's description.
  const CLI = nodes.has('obsidian_rt_app_cli') ? 'obsidian_rt_app_cli' : APP;
  for (const m of app.matchAll(/register(?:Cli)?Handler\("([\w:-]+)","((?:[^"\\]|\\.)*)"/g))
    if (!m[1].startsWith('__')) link(CLI, node(id('obsidian_cli', m[1]), `obsidian ${m[1]}`, 'cli-command', 'app.js', { description: m[2] }), 'provides_cli', 'app.js');

  // Startup stages, nested by their dotted names (the marks dev:startup reports).
  const mark = /function (\w+)\(\w\)\{\w+\.push\(\{key:\w,ts:performance\.now\(\)\}\)\}/.exec(app);
  if (mark) {
    const START = node('obsidian_startup', 'Startup', 'startup', 'app.js');
    link('obsidian', START, 'starts_with', 'app.js');
    const marks = [...app.matchAll(new RegExp(`\\b${mark[1]}\\("([\\w.:-]+)"\\)`, 'g'))].map((m) => m[1]);
    marks.forEach((name, order) => {
      const parts = name.split('.');
      parts.forEach((_, i) => {
        const full = parts.slice(0, i + 1).join('.');
        node(id('obsidian_startup', full), `startup: ${full}`, 'startup-stage', 'app.js', i === parts.length - 1 ? { order } : {});
        link(i ? id('obsidian_startup', parts.slice(0, i).join('.')) : START, id('obsidian_startup', full), 'contains', 'app.js');
      });
    });
  }

  // URI actions, modules a plugin can require(), IPC channels, config files, databases.
  const hook = app.indexOf('"hook-get-address"');
  if (hook !== -1) for (const a of uniq(app.slice(Math.max(0, hook - 12000), hook + 6000), /this\.register\("([\w-]+)"/g))
    link(APP, node(id('obsidian_uri', a), `obsidian://${a}`, 'uri-action', 'app.js'), 'handles_uri', 'app.js');
  const req = app.indexOf('"@codemirror/collab":');
  if (req !== -1) for (const name of uniq(braceAt(app, req) ?? '', /"?([@\w/-]+)"?:/g))
    link('obsidian_module', node(id('obsidian_requirable', name), `require('${name}')`, 'requirable-module', 'app.js'), 'provides_to_plugins', 'app.js');
  for (const ch of uniq(main, /ipcMain\.(?:on|handle)\("([\w:-]+)"/g))
    link(MAIN, node(id('obsidian_ipc', ch), `ipc: ${ch}`, 'ipc-channel', 'main.js'), 'handles_ipc', 'main.js');
  for (const f of uniq(app, /"\/?([\w-]+\.json)"/g))
    link(APP, node(id('obsidian_config_file', f), f, 'config-file', 'app.js'), 'uses_file', 'app.js');
  for (const db of uniq(app, /appId\+"(-[\w-]+)"/g))
    link(APP, node(id('obsidian_storage', db), `<appId>${db}`, 'storage', 'app.js'), 'stores_in', 'app.js');

  // Libraries shipped in lib/, and the scripts beside app.js.
  for (const lib of [...new Set(pack.list().filter((f) => f.startsWith('lib/')).map((f) => f.split('/')[1].replace(/\.(min\.)?m?js$/, '')))])
    link('obsidian', node(id('obsidian_lib', lib), `lib: ${lib}`, 'library', 'lib'), 'bundles', 'lib');
  for (const f of pack.list().filter((f) => /^[\w-]+\.js$/.test(f) && !['app.js', 'main.js'].includes(f)))
    link('obsidian', node(id('obsidian_file', f), f, 'source-file', f), 'built_from', f);

  // CSS variables, grouped by family (--background-*, --text-*, …).
  const values = new Map();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) if (!values.has(m[1])) values.set(m[1], m[2].trim().slice(0, 80));
  for (const [name, value] of values) {
    const family = name.slice(2).split('-')[0];
    const fam = node(id('obsidian_css_family', family), `--${family}-*`, 'css-family', 'app.css');
    link(CSS, fam, 'defines', 'app.css');
    link(fam, node(id('obsidian_css', name), name, 'css-variable', 'app.css', { value }), 'contains', 'app.css');
  }

  // Every class app.css styles (the live DOM's regions are among them), and the variables
  // each one uses and sets: so "where is --tab-* used" reaches the elements.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const before2 = nodes.size;
  for (const m of bare.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const classes = [...new Set([...m[1].matchAll(/\.([a-zA-Z][\w-]*)/g)].map((c) => c[1]))];
    if (!classes.length) continue;
    const uses = [...new Set([...m[2].matchAll(/var\(\s*(--[\w-]+)/g)].map((v) => v[1]))];
    const sets = [...new Set([...m[2].matchAll(/(?:^|;)\s*(--[\w-]+)\s*:/g)].map((v) => v[1]))];
    for (const cls of classes) {
      const cid = node(id('obsidian_dom', cls), `.${cls}`, 'css-class', 'app.css');
      link(CSS, cid, 'styles', 'app.css');
      for (const v of uses) if (nodes.has(id('obsidian_css', v))) link(cid, id('obsidian_css', v), 'uses_css_var', 'app.css');
      for (const v of sets) if (nodes.has(id('obsidian_css', v))) link(cid, id('obsidian_css', v), 'sets_css_var', 'app.css');
    }
  }
  console.log(`app.css   ${nodes.size - before2} classes beyond the live DOM's`);
  console.log(`app code  ${nodes.size - before} nodes from ${path.basename(asarPath)}`);
} else console.log('app code  no .asar found (pass --asar, or set OBSIDIAN_CACHE): skipped');

// ---- 3. The public typings, as graphify's code graph -------------------------------------
const dtsDir = path.resolve(opt('--dts', 'node_modules/obsidian'));
const graphify = spawnSync('graphify', ['--version'], { encoding: 'utf8' }).status === 0;
if (fs.existsSync(path.join(dtsDir, 'obsidian.d.ts')) && graphify) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-typings-'));
  for (const f of ['obsidian.d.ts', 'canvas.d.ts', 'publish.d.ts']) if (fs.existsSync(path.join(dtsDir, f))) fs.copyFileSync(path.join(dtsDir, f), path.join(tmp, f));
  execFileSync('graphify', ['update', tmp, '--no-cluster'], { stdio: 'ignore', env: { ...process.env, GRAPHIFY_BACKEND: 'none' } });
  const typed = JSON.parse(fs.readFileSync(path.join(tmp, 'graphify-out', 'graph.json'), 'utf8'));
  const typedIds = new Set(typed.nodes.map((n) => n.id));
  // A property is typed when its class declares the field.
  const fieldsOf = new Map(typed.nodes.filter((n) => n._ts_fields).map((n) => [n.id, new Set(Object.keys(n._ts_fields))]));
  const owner = new Map(live ? live.links.filter((e) => e.relation === 'property').map((e) => [e.target, e.source]) : []);
  for (const n of nodes.values()) {
    if (/^(public-class|method|static-method|public-function|public-object)$/.test(n.type)) n.metadata.typed = typedIds.has(n.id);
    else if (n.type === 'property') n.metadata.typed = typedIds.has(n.id) || !!fieldsOf.get(owner.get(n.id))?.has(n.label.slice(1));
    else if (/^internal-(class|method)$/.test(n.type)) n.metadata.typed = false;
  }
  absorb(typed);
  link('obsidian_module', 'obsidian_d', 'declared_in', 'obsidian.d.ts');
  const untyped = [...nodes.values()].filter((n) => n.metadata?.typed === false && !/^internal-/.test(n.type)).length;
  console.log(`typings   ${typed.nodes.length} nodes from ${dtsDir}; ${untyped} live members of the public API are not in them (internal)`);
} else console.log(`typings   skipped (${graphify ? `no obsidian.d.ts in ${dtsDir}` : 'graphify is not installed'})`);

// ---- write, check, cluster ---------------------------------------------------------------
for (const e of links) for (const end of [e.source, e.target]) if (!nodes.has(end)) node(end, end, 'unresolved', 'obsidian');
const graph = { directed: true, multigraph: false, graph: { source: 'obsidian-graphify', built: new Date().toISOString() }, nodes: [...nodes.values()], links, hyperedges: [] };
fs.writeFileSync(path.join(out, 'graph.json'), JSON.stringify(graph));
const kinds = graph.nodes.reduce((m, n) => ((m[n.type ?? n.file_type] = (m[n.type ?? n.file_type] || 0) + 1), m), {});
console.log(`graph     ${graph.nodes.length} nodes, ${links.length} links → ${path.join(out, 'graph.json')}`);
console.log(`          ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
if (graphify && !has('--no-cluster')) {
  // With no model, a first pass can leave "Community N" placeholders; the second names each after its hub.
  const flags = ['cluster-only', out, '--graph', path.join(out, 'graph.json'), ...(graph.nodes.length > 5000 ? ['--no-viz'] : [])];
  // The build is from scratch: the last clustering goes, or graphify refuses a graph that lost nodes.
  fs.rmSync(path.join(out, 'graphify-out'), { recursive: true, force: true });
  let r;
  for (let pass = 0; pass < 2; pass++) r = spawnSync('graphify', flags, { encoding: 'utf8', env: { ...process.env, GRAPHIFY_BACKEND: 'none' } });
  console.log(r.status === 0 ? `clustered ${r.stdout.trim().split('\n').slice(-2).join(' ')}` : `cluster-only failed: ${r.stderr.trim().split('\n').slice(-3).join(' ')}`);
}
