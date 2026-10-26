#!/usr/bin/env node
/*
 * Where things are, worked out from src/ so it never goes stale.
 *
 *   node tests/map.js              a line per piece: heading, features (setting), suites that test it
 *   node tests/map.js mindmap fold only the pieces whose line has every word
 *   node tests/map.js --who NAME   where NAME is declared, and the lines in each piece that use it
 *   node tests/map.js --deps PIECE what a piece uses from others, and which use it (e.g. 420 or 420-mindmap-feature)
 *   node tests/map.js --areas      the areas (number ranges) and what each uses from the others, pieces
 *                                  that use each other, and uses that cross the layers
 *   node tests/map.js --verify     for the build: every use imported, nothing needed as a module loads run later,
 *                                  no new use across the layers
 *   node tests/map.js --fix-imports  each module's import lines rewritten to what it uses
 *   node tests/map.js --internals  fails on more lines reaching into Obsidian's canvas than
 *                                  tests/snapshots/canvas-internals.json allows a module (--update rewrites it);
 *                                  the canvas adapter (core/079) is where they belong
 *   node tests/map.js --check      fails on a use crossing the layers that isn't in tests/snapshots/layers.json,
 *                                  or one listed there that's gone (--update rewrites the list); see
 *                                  docs/architecture.md
 *
 * --who and --deps are how to find callers and callees across the modules.
 * Each module is parsed (acorn) and its top-level names, the names it uses
 * from outside itself — not its own locals of the same name — and which of
 * those it needs as it loads are kept in .claude-cache/index.json by the
 * module's content hash, so only modules that changed are parsed again.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const cacheFile = path.join(root, '.claude-cache', 'index.json');
const INDEX_VERSION = 3;
const read = (f) => fs.readFileSync(f, 'utf8');
const escape = (s) => s.replace(/[$]/g, '\\$');
const word = (name) => new RegExp(`(^|[^\\w$])${escape(name)}(?![\\w$])`, 'g');

/* -- what a piece declares and uses ----------------------------------- */

/** Names bound by a pattern: a, { a, b: c }, [a, ...b], a = 1. */
function bound(pattern, out) {
  if (!pattern) return out;
  if (pattern.type === 'Identifier') out.push(pattern.name);
  else if (pattern.type === 'ObjectPattern') pattern.properties.forEach((p) => bound(p.type === 'RestElement' ? p.argument : p.value, out));
  else if (pattern.type === 'ArrayPattern') pattern.elements.forEach((e) => bound(e, out));
  else if (pattern.type === 'RestElement') bound(pattern.argument, out);
  else if (pattern.type === 'AssignmentPattern') bound(pattern.left, out);
  return out;
}

/** Names a block of statements declares in its own scope (let, const, class, function), and var in a function's. */
function declaredIn(body, fnScope) {
  const block = [];
  const vars = [];
  body.forEach((s) => {
    if (!s) return;
    if (s.type === 'VariableDeclaration') s.declarations.forEach((d) => bound(d.id, s.kind === 'var' ? vars : block));
    else if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') block.push(s.id.name);
  });
  // var hoists to the function, through any blocks.
  if (fnScope) {
    const walk = (n) => {
      if (!n || typeof n.type !== 'string' || /Function/.test(n.type)) return;
      if (n.type === 'VariableDeclaration' && n.kind === 'var') n.declarations.forEach((d) => bound(d.id, vars));
      Object.keys(n).forEach((k) => {
        const v = n[k];
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v.type === 'string') walk(v);
      });
    };
    body.forEach(walk);
  }
  return block.concat(vars);
}

/** One piece: its top-level declarations (name → line) and the outside names it uses (name → the lines). */
function analyse(text) {
  const acorn = require('acorn');
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  const declared = {};
  // Function declarations are hoisted through the whole bundle, so using one as it loads is safe.
  const functions = [];
  const imports = {};
  ast.body.forEach((st) => {
    if (st.type === 'ImportDeclaration') st.specifiers.forEach((sp) => (imports[sp.local.name] = st.source.value));
    const s = st.type === 'ExportNamedDeclaration' || st.type === 'ExportDefaultDeclaration' ? st.declaration : st;
    if (!s) return;
    if (s.type === 'VariableDeclaration') s.declarations.forEach((d) => bound(d.id, []).forEach((n) => (declared[n] = d.loc.start.line)));
    else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) {
      declared[s.id.name] = s.loc.start.line;
      if (s.type === 'FunctionDeclaration') functions.push(s.id.name);
    }
  });
  const uses = {};
  // Names used as the module loads — outside any function — not only when something runs.
  const load = new Set();
  const visit = (node, scope, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'Identifier': {
        // Not a property name, a key, or a label.
        if (parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) || ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) || /Label|Break|Continue/.test(parent.type))) return;
        let inFunction = false;
        for (let s = scope; s; s = s.up) {
          if (s.names.has(node.name)) return;
          if (s.fn) inFunction = true;
        }
        if (!Object.prototype.hasOwnProperty.call(uses, node.name)) uses[node.name] = [];
        uses[node.name].push(node.loc.start.line);
        if (!inFunction) load.add(node.name);
        return;
      }
      case 'ImportDeclaration':
        return;
      case 'ExportNamedDeclaration':
      case 'ExportDefaultDeclaration': {
        visit(node.declaration, scope, node, 'declaration');
        return;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const names = new Set(node.params.reduce((acc, p) => bound(p, acc), []));
        if (node.type === 'FunctionExpression' && node.id) names.add(node.id.name);
        names.add('arguments');
        const inner = { names, up: scope, fn: true };
        node.params.forEach((p) => visitPattern(p, inner));
        if (node.body.type === 'BlockStatement') {
          declaredIn(node.body.body, true).forEach((n) => names.add(n));
          node.body.body.forEach((s) => visit(s, inner, node.body, 'body'));
        } else visit(node.body, inner, node, 'body');
        return;
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        const inner = { names: new Set(node.id ? [node.id.name] : []), up: scope };
        if (node.superClass) visit(node.superClass, scope, node, 'superClass');
        // A field's value is worked out as each instance is made, not as the class is.
        node.body.body.forEach((m) => visit(m, m.type === 'PropertyDefinition' && !m.static ? { names: new Set(), up: inner, fn: true } : inner, node.body, 'body'));
        return;
      }
      case 'BlockStatement':
      case 'StaticBlock': {
        const inner = { names: new Set(declaredIn(node.body, false)), up: scope };
        node.body.forEach((s) => visit(s, inner, node, 'body'));
        return;
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const head = node.init || node.left;
        const names = head && head.type === 'VariableDeclaration' && head.kind !== 'var' ? head.declarations.reduce((acc, d) => bound(d.id, acc), []) : [];
        const inner = { names: new Set(names), up: scope };
        Object.keys(node).forEach((k) => k !== 'type' && visitAny(node[k], inner, node, k));
        return;
      }
      case 'CatchClause': {
        const inner = { names: new Set(bound(node.param, [])), up: scope };
        visit(node.body, inner, node, 'body');
        return;
      }
      case 'VariableDeclarator':
        visitPattern(node.id, scope);
        visit(node.init, scope, node, 'init');
        return;
      default:
        Object.keys(node).forEach((k) => k !== 'type' && k !== 'loc' && visitAny(node[k], scope, node, k));
    }
  };
  // In a pattern only defaults and computed keys are uses.
  const visitPattern = (p, scope) => {
    if (!p) return;
    if (p.type === 'AssignmentPattern') {
      visitPattern(p.left, scope);
      visit(p.right, scope, p, 'right');
    } else if (p.type === 'ObjectPattern') {
      p.properties.forEach((q) => {
        if (q.type === 'RestElement') return visitPattern(q.argument, scope);
        if (q.computed) visit(q.key, scope, q, 'key');
        visitPattern(q.value, scope);
      });
    } else if (p.type === 'ArrayPattern') p.elements.forEach((e) => visitPattern(e, scope));
    else if (p.type === 'RestElement') visitPattern(p.argument, scope);
    else if (p.type !== 'Identifier') visit(p, scope, null, null);
  };
  const visitAny = (v, scope, parent, key) => {
    if (Array.isArray(v)) v.forEach((x) => visit(x, scope, parent, key));
    else if (v && typeof v.type === 'string') visit(v, scope, parent, key);
  };
  // The piece's own top-level names are the shared scope's, so not its own locals: they count as uses where used.
  ast.body.forEach((s) => visit(s, null, ast, 'body'));
  Object.keys(declared).forEach((n) => delete uses[n]);
  return { declared, uses, load: [...load].filter((n) => !declared[n]), functions, imports };
}

/* -- the index, kept by content hash --------------------------------- */

function loadIndex() {
  let cache = {};
  try {
    const saved = JSON.parse(read(cacheFile));
    if (saved.version === INDEX_VERSION) cache = saved.pieces || {};
  } catch (err) {
    cache = {};
  }
  let changed = false;
  // Modules are src/<area>/NNN-name.js; src/main.js imports the plugin, which reaches them.
  const files = [];
  fs.readdirSync(src).forEach((d) => {
    if (fs.statSync(path.join(src, d)).isDirectory()) fs.readdirSync(path.join(src, d)).filter((f) => f.endsWith('.js')).forEach((f) => files.push([d, f]));
  });
  const pieces = files
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([area, f]) => {
      const name = f.replace(/\.js$/, '');
      const text = read(path.join(src, area, f));
      const hash = crypto.createHash('sha1').update(text).digest('hex');
      let entry = cache[name];
      if (!entry || entry.hash !== hash) {
        entry = Object.assign({ hash }, analyse(text));
        changed = true;
      }
      cache[name] = entry;
      return Object.assign({ name, area, file: `${area}/${f}`, text }, entry);
    });
  const names = new Set(pieces.map((p) => p.name));
  Object.keys(cache).forEach((k) => names.has(k) || ((changed = true), delete cache[k]));
  if (changed) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const keep = {};
    pieces.forEach((p) => (keep[p.name] = { hash: p.hash, declared: p.declared, uses: p.uses, load: p.load, functions: p.functions, imports: p.imports }));
    fs.writeFileSync(cacheFile, JSON.stringify({ version: INDEX_VERSION, pieces: keep }));
  }
  return pieces;
}

const pieces = loadIndex();
const homeOf = new Map();
pieces.forEach((p) => Object.keys(p.declared).forEach((n) => homeOf.set(n, p)));
const tests = fs.readdirSync(__dirname).filter((f) => /^test_.*\.js$/.test(f)).map((f) => ({ name: f.replace(/^test_|\.js$/g, ''), text: read(path.join(__dirname, f)) }));
const e2eDir = path.join(__dirname, 'obsidian');
const e2e = fs.existsSync(e2eDir) ? fs.readdirSync(e2eDir).filter((f) => f.endsWith('.mjs')).map((f) => read(path.join(e2eDir, f))).join('\n') : '';
const testsNaming = (name) => {
  const count = (text) => (text.match(word(name)) || []).length;
  const out = tests.map((t) => [t.name, count(t.text)]).filter(([, n]) => n);
  if (count(e2e)) out.push(['obsidian', count(e2e)]);
  return out;
};

const args = process.argv.slice(2);

if (args[0] === '--who') {
  const name = args[1];
  if (!name) {
    console.log('usage: node tests/map.js --who NAME');
    process.exit(1);
  }
  const home = homeOf.get(name);
  console.log(home ? `${name}: declared in ${home.name}:${home.declared[name]}` : `${name}: not declared at the top of any piece`);
  // Each piece that uses it, and where: the lines to read, not the file.
  const users = pieces.filter((p) => p !== home && Object.prototype.hasOwnProperty.call(p.uses, name));
  if (!users.length) console.log('used nowhere else');
  users.forEach((p) => {
    const lines = p.uses[name];
    console.log(`  ${p.name}: ${lines.slice(0, 10).join(', ')}${lines.length > 10 ? ` and ${lines.length - 10} more` : ''}`);
  });
  const inTests = testsNaming(name);
  if (inTests.length) console.log(`tests: ${inTests.map(([t, n]) => `${t} (${n})`).join(', ')}`);
  process.exit(0);
}

if (args[0] === '--deps') {
  const want = args[1] || '';
  const piece = pieces.find((p) => p.name === want || p.name.startsWith(`${want}-`));
  if (!piece) {
    console.log('usage: node tests/map.js --deps PIECE   (e.g. 420 or 420-mindmap-feature)');
    process.exit(1);
  }
  const from = new Map();
  Object.keys(piece.uses).forEach((n) => {
    const home = homeOf.get(n);
    if (home && home !== piece) from.set(home.name, (from.get(home.name) || []).concat(n));
  });
  console.log(`${piece.name} uses:`);
  Array.from(from.keys()).sort().forEach((p) => console.log(`  ${p}: ${from.get(p).sort().join(', ')}`));
  const own = Object.keys(piece.declared);
  const has = (p, n) => Object.prototype.hasOwnProperty.call(p.uses, n);
  const by = pieces.filter((p) => p !== piece && own.some((n) => has(p, n))).map((p) => `${p.name} (${own.filter((n) => has(p, n)).join(', ')})`);
  console.log(by.length ? `used by:\n  ${by.join('\n  ')}` : 'used by no other piece');
  process.exit(0);
}

pieces.forEach((p) => {
  const heading = p.text.split('\n').slice(0, 4).map((l) => l.match(/^\/\* (\w.*?)\s*\*\/$/)).find((m) => m);
  p.heading = heading ? heading[1] : '';
  const classes = Object.keys(p.declared).filter((n) => new RegExp(`^(?:export )?class ${escape(n)}\\b`, 'm').test(p.text));
  p.features = classes.map((n) => {
    const key = p.text.match(new RegExp(`^${escape(n)}\\.settingKey = '([\\w]+)'`, 'm'));
    return key ? `${n} (${key[1]})` : n;
  });
  // Suites that name one of its classes or longer-named functions.
  const telling = Object.keys(p.declared).filter((n) => classes.includes(n) || n.length >= 6);
  p.suites = tests.filter((t) => telling.some((n) => word(n).test(t.text))).map((t) => t.name);
  if (classes.some((n) => word(n).test(e2e))) p.suites.push('obsidian');
});

/* -- areas and layers ---------------------------------------------------- */

// The areas, each a folder of src/, and their layer: a module may import
// from its own area and lower layers (shared UI is below every feature);
// the plugin, from anywhere. The library and its albums are one subsystem
// (see .claude/rules/albums.md): album features draw inside the browse view
// and add its screens.
const AREAS = [
  { name: 'core', level: 0 },
  { name: 'ui', level: 1 },
  // A map's tree, pure: below every feature, above only core.
  { name: 'tree', level: 1 },
  { name: 'library', level: 2 },
  { name: 'note', level: 2 },
  { name: 'maps', level: 2 },
  { name: 'tools', level: 2 },
  { name: 'plugin', level: 3 },
];
const areaOf = (p) => AREAS.find((a) => a.name === p.area) || { name: p.area, level: 2 };
const crossing = (a, b) => a.name !== b.name && a.level !== 3 && b.level >= a.level;
const crosses = (user, home) => crossing(areaOf(user), areaOf(home));
/** Every use from another piece: [user, name, home]. */
const uses = () => pieces.flatMap((p) => Object.keys(p.uses).map((n) => [p, n, homeOf.get(n)]).filter(([, , h]) => h && h !== p && h.name !== '010-imports'));
const layersFile = path.join(__dirname, 'snapshots', 'layers.json');

if (args[0] === '--areas') {
  const size = new Map();
  pieces.forEach((p) => {
    const a = areaOf(p).name;
    const s = size.get(a) || { pieces: 0, lines: 0 };
    s.pieces++;
    s.lines += p.text.split('\n').length;
    size.set(a, s);
  });
  console.log('areas, lowest layer first:');
  const names = [...new Set(AREAS.slice().sort((x, y) => x.level - y.level).map((a) => a.name))];
  names.forEach((name) => {
    const parts = AREAS.filter((a) => a.name === name);
    const s = size.get(name) || { pieces: 0, lines: 0 };
    console.log(`  ${name} (src/${name}/, layer ${parts[0].level}): ${s.pieces} modules, ${s.lines} lines`);
  });
  const edges = new Map();
  uses().forEach(([u, n, h]) => {
    const [a, b] = [areaOf(u), areaOf(h)];
    if (a.name === b.name) return;
    const k = `${a.name} → ${b.name}`;
    const e = edges.get(k) || { names: new Set(), crosses: crossing(a, b) };
    e.names.add(n);
    edges.set(k, e);
  });
  console.log('what each area uses from another (names):');
  [...edges.entries()].sort((x, y) => y[1].names.size - x[1].names.size).forEach(([k, e]) => {
    const n = e.names.size;
    console.log(`  ${k}: ${n}${n <= 5 ? ` (${[...e.names].join(', ')})` : ''}${e.crosses ? '  ← crosses' : ''}`);
  });
  const deps = new Map(pieces.map((p) => [p, new Set()]));
  uses().forEach(([u, , h]) => deps.get(u).add(h));
  const pairs = [];
  pieces.forEach((a) => deps.get(a).forEach((b) => a.name < b.name && deps.get(b).has(a) && pairs.push(`${a.name} ↔ ${b.name}`)));
  console.log(`pieces that use each other: ${pairs.length}`);
  pairs.forEach((x) => console.log(`  ${x}`));
  process.exit(0);
}

/*
 * For the build: each name used from another module is imported from that
 * module, and each import names something there; nothing a module needs as
 * it loads comes from one that runs after it (in the order ES modules run:
 * src/main.js's imports, each module's own imports first); and no use
 * crosses the layers that isn't on the known list.
 */
// What's taken from outside the plugin — Obsidian, CodeMirror — by name, and from where.
const externals = new Map();
pieces.forEach((p) => Object.keys(p.imports).forEach((n) => p.imports[n].startsWith('.') || externals.set(n, p.imports[n])));
const resolve = (p, spec) => (spec.startsWith('.') ? path.posix.normalize(path.posix.join(p.area, spec)) : null);

/** The import lines a module needs: what it uses from Obsidian and CodeMirror, then from other modules, in order. */
function importLines(p) {
  const from = new Map();
  Object.keys(p.uses).forEach((n) => {
    const home = homeOf.get(n);
    let spec = null;
    if (home && home !== p) spec = home.area === p.area ? `./${home.name}.js` : `../${home.area}/${home.name}.js`;
    else if (!home && externals.has(n)) spec = externals.get(n);
    if (spec) from.set(spec, (from.get(spec) || []).concat(n));
  });
  const order = (spec) => (spec.startsWith('.') ? `1${spec.replace(/^.*\//, '')}` : `0${spec}`);
  return [...from.keys()].sort((a, b) => order(a).localeCompare(order(b))).map((spec) => `import { ${from.get(spec).sort((a, b) => a.localeCompare(b)).join(', ')} } from '${spec}';`);
}

if (args[0] === '--fix-imports') {
  let changed = 0;
  pieces.forEach((p) => {
    const lines = p.text.split('\n');
    const at = lines.findIndex((l) => /^import \{[^}]*\} from '[^']+';$/.test(l));
    const kept = lines.filter((l) => !/^import \{[^}]*\} from '[^']+';$/.test(l));
    const wanted = importLines(p);
    let out;
    if (at !== -1) out = [...kept.slice(0, at), ...wanted, ...kept.slice(at)];
    else {
      // After the header comment, with a blank line either side.
      let i = 0;
      while (i < kept.length && /^\/\*.*\*\/$/.test(kept[i])) i++;
      out = wanted.length ? [...kept.slice(0, i), ...(i ? [''] : []), ...wanted, ...(kept[i] === '' ? [] : ['']), ...kept.slice(i)] : kept;
    }
    // A block left empty takes its blank line with it.
    let text = out.join('\n');
    if (at !== -1 && !wanted.length) text = text.replace(/\n\n\n/, '\n\n');
    if (text !== p.text) {
      fs.writeFileSync(path.join(src, p.file), text);
      changed++;
      console.log(`imports: ${p.file}`);
    }
  });
  console.log(`${changed} modules' imports rewritten`);
  process.exit(0);
}

if (args[0] === '--verify') {
  const problems = [];
  const byFile = new Map(pieces.map((p) => [p.file, p]));
  pieces.forEach((p) => {
    Object.keys(p.uses).forEach((n) => {
      const home = homeOf.get(n);
      if (!home || home === p) return;
      const from = p.imports[n];
      if (!from) problems.push(`${p.file} uses ${n} from ${home.file} without importing it`);
      else if (resolve(p, from) !== home.file) problems.push(`${p.file} imports ${n} from ${from}, but it's in ${home.file}`);
    });
    // Obsidian's and CodeMirror's names are imported too, or the bundle would look for them on the window.
    Object.keys(p.uses).forEach((n) => {
      if (!homeOf.get(n) && externals.has(n) && !p.imports[n]) problems.push(`${p.file} uses ${n} from ${externals.get(n)} without importing it`);
    });
    Object.keys(p.imports).forEach((n) => {
      const target = resolve(p, p.imports[n]);
      if (target && !(byFile.has(target) && byFile.get(target).declared[n])) problems.push(`${p.file} imports ${n} from ${p.imports[n]}, which doesn't declare it`);
    });
  });
  // The order they run in, as ES modules do.
  const entry = read(path.join(src, 'main.js'));
  const order = [];
  const seen = new Set();
  const visitModule = (file) => {
    if (seen.has(file) || !byFile.has(file)) return;
    seen.add(file);
    const p = byFile.get(file);
    const specs = [...new Set(Object.values(p.imports))].filter((x) => x.startsWith('.'));
    // In the order its import lines are written.
    specs.sort((a, b) => p.text.indexOf(`'${a}'`) - p.text.indexOf(`'${b}'`)).forEach((x) => visitModule(resolve(p, x)));
    order.push(file);
  };
  [...entry.matchAll(/^import (?:[^'\n]* from )?'\.\/([^']+)';$/gm)].forEach((m) => visitModule(m[1]));
  pieces.filter((p) => !seen.has(p.file)).forEach((p) => problems.push(`${p.file} isn't reached from src/main.js: nothing imports it`));
  const at = new Map(order.map((f, i) => [f, i]));
  pieces.forEach((p) => p.load.forEach((n) => {
    const home = homeOf.get(n);
    if (home && home !== p && !home.functions.includes(n) && at.get(home.file) > at.get(p.file)) problems.push(`${p.file} needs ${n} as it loads, but ${home.file} runs after it`);
  }));
  // Layers.
  let known = {};
  try {
    known = JSON.parse(read(layersFile));
  } catch (err) {
    known = {};
  }
  uses().filter(([u, , h]) => crosses(u, h)).forEach(([u, n, h]) => (known[u.name] || []).includes(n) || problems.push(`${u.file} uses ${n} from ${h.file}, across the layers`));
  problems.forEach((x) => console.log(x));
  process.exit(problems.length ? 1 : 0);
}

/*
 * Obsidian's canvas, reached into directly rather than through the adapter
 * (core/079): the lines in each module that do. The list only shrinks.
 */
const CANVAS_INTERNALS = /\b(?:canvas\.(?:nodes|edges|selection|readonly|getData|wrapperEl)|selectOnly|deselectAll|requestSave|importData|zoomToBbox|getViewportBBox|getIntersectingNodes|hitTestNode|posFromEvt|markMoved|createTextNode|createFileNode|createGroupNode|setViewport|panIntoView|unknownData|nodeEl|lineGroupEl|lineEndGroupEl|moveAndResize|getBBox|startEditing|setIsEditing|isEditing|setColor|removeEdge|removeNode)\b/;
if (args[0] === '--internals') {
  const file = path.join(__dirname, 'snapshots', 'canvas-internals.json');
  const found = {};
  pieces.filter((p) => p.file !== 'core/079-canvas-adapter.js').forEach((p) => {
    const n = p.text.split('\n').filter((l) => CANVAS_INTERNALS.test(l.replace(/[dD]ocument\.createTextNode/g, '')) && !/^\s*(\*|\/\/|\/\*)/.test(l)).length;
    if (n) found[p.name] = n;
  });
  const total = Object.values(found).reduce((a, b) => a + b, 0);
  if (args.includes('--update')) {
    const sorted = {};
    Object.keys(found).sort().forEach((k) => (sorted[k] = found[k]));
    fs.writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n');
    console.log(`canvas internals: ${total} lines in ${Object.keys(found).length} modules recorded`);
    process.exit(0);
  }
  let known = {};
  try {
    known = JSON.parse(read(file));
  } catch (err) {
    known = {};
  }
  const more = Object.keys(found).filter((k) => found[k] > (known[k] || 0)).map((k) => `${k}: ${found[k]} lines reach into the canvas, ${known[k] || 0} allowed — go through the adapter (core/079)`);
  const fewer = Object.keys(known).filter((k) => (found[k] || 0) < known[k]).map((k) => `${k}: down to ${found[k] || 0} from ${known[k]} — record it with --internals --update`);
  more.concat(fewer).forEach((x) => console.log(x));
  if (!more.length && !fewer.length) console.log(`canvas internals: ${total} lines outside the adapter, in ${Object.keys(found).length} modules; none new`);
  process.exit(more.length || fewer.length ? 1 : 0);
}

if (args[0] === '--check') {
  const found = {};
  uses().filter(([u, , h]) => crosses(u, h)).forEach(([u, n]) => (found[u.name] = (found[u.name] || []).concat(n).sort()));
  if (args.includes('--update')) {
    fs.mkdirSync(path.dirname(layersFile), { recursive: true });
    const sorted = {};
    Object.keys(found).sort().forEach((k) => (sorted[k] = found[k]));
    fs.writeFileSync(layersFile, JSON.stringify(sorted, null, 1) + '\n');
    console.log(`${Object.values(found).flat().length} uses crossing the layers recorded`);
    process.exit(0);
  }
  let known = {};
  try {
    known = JSON.parse(read(layersFile));
  } catch (err) {
    known = {};
  }
  const fresh = [];
  const gone = [];
  Object.keys(found).forEach((p) => found[p].forEach((n) => (known[p] || []).includes(n) || fresh.push(`${p} uses ${n} (${homeOf.get(n).name})`)));
  Object.keys(known).forEach((p) => known[p].forEach((n) => (found[p] || []).includes(n) || gone.push(`${p}: ${n}`)));
  fresh.forEach((x) => console.log(`crosses the layers: ${x}`));
  gone.forEach((x) => console.log(`no longer crosses, take it off the list (--check --update): ${x}`));
  if (!fresh.length && !gone.length) console.log(`layers: ${Object.values(known).flat().length} known crossings, none new`);
  process.exit(fresh.length || gone.length ? 1 : 0);
}

const words = args.map((a) => a.toLowerCase());
pieces.forEach((p) => {
  const line = [p.name, p.heading, p.features.join(', '), p.suites.length ? `tests: ${p.suites.join(' ')}` : ''].filter(Boolean).join(' — ');
  if (words.every((w) => line.toLowerCase().includes(w))) console.log(line);
});
