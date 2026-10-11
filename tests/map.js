#!/usr/bin/env node
/*
 * Where things are, worked out from src/ so it never goes stale.
 *
 *   node tests/map.js              a line per piece: heading, features (setting), suites that test it
 *   node tests/map.js canvas fold  only the pieces whose line has every word
 *   node tests/map.js --who NAME   where NAME is declared, and the lines in each piece that use it
 *   node tests/map.js --deps PIECE what a piece uses from others, and which use it (e.g. 335 or 335-canvas-fold)
 *
 * The pieces share one scope, so --who and --deps are how to find callers
 * and callees. Each piece is parsed (acorn) and its top-level names and the
 * names it uses from outside itself — not its own locals of the same name —
 * are kept in .claude-cache/index.json by the piece's content hash, so only
 * pieces that changed are parsed again.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const cacheFile = path.join(root, '.claude-cache', 'index.json');
const INDEX_VERSION = 2;
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
  const ast = acorn.parse(text, { ecmaVersion: 'latest', locations: true, allowReturnOutsideFunction: true, allowHashBang: true });
  const declared = {};
  ast.body.forEach((s) => {
    if (s.type === 'VariableDeclaration') s.declarations.forEach((d) => bound(d.id, []).forEach((n) => (declared[n] = d.loc.start.line)));
    else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) declared[s.id.name] = s.loc.start.line;
  });
  const uses = {};
  const visit = (node, scope, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'Identifier': {
        // Not a property name, a key, or a label.
        if (parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) || ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed) || /Label|Break|Continue/.test(parent.type))) return;
        for (let s = scope; s; s = s.up) if (s.names.has(node.name)) return;
        if (!Object.prototype.hasOwnProperty.call(uses, node.name)) uses[node.name] = [];
        uses[node.name].push(node.loc.start.line);
        return;
      }
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        const names = new Set(node.params.reduce((acc, p) => bound(p, acc), []));
        if (node.type === 'FunctionExpression' && node.id) names.add(node.id.name);
        names.add('arguments');
        const inner = { names, up: scope };
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
        node.body.body.forEach((m) => visit(m, inner, node.body, 'body'));
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
  return { declared, uses };
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
  const pieces = fs
    .readdirSync(src)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => {
      const name = f.replace(/\.js$/, '');
      const text = read(path.join(src, f));
      const hash = crypto.createHash('sha1').update(text).digest('hex');
      let entry = cache[name];
      if (!entry || entry.hash !== hash) {
        entry = Object.assign({ hash }, analyse(text));
        changed = true;
      }
      cache[name] = entry;
      return Object.assign({ name, text }, entry);
    });
  const names = new Set(pieces.map((p) => p.name));
  Object.keys(cache).forEach((k) => names.has(k) || ((changed = true), delete cache[k]));
  if (changed) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const keep = {};
    pieces.forEach((p) => (keep[p.name] = { hash: p.hash, declared: p.declared, uses: p.uses }));
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
    console.log('usage: node tests/map.js --deps PIECE   (e.g. 335 or 335-canvas-fold)');
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
  const classes = Object.keys(p.declared).filter((n) => new RegExp(`^class ${escape(n)}\\b`, 'm').test(p.text));
  p.features = classes.map((n) => {
    const key = p.text.match(new RegExp(`^${escape(n)}\\.settingKey = '([\\w]+)'`, 'm'));
    return key ? `${n} (${key[1]})` : n;
  });
  // Suites that name one of its classes or longer-named functions.
  const telling = Object.keys(p.declared).filter((n) => classes.includes(n) || n.length >= 6);
  p.suites = tests.filter((t) => telling.some((n) => word(n).test(t.text))).map((t) => t.name);
  if (classes.some((n) => word(n).test(e2e))) p.suites.push('obsidian');
});

const words = args.map((a) => a.toLowerCase());
pieces.forEach((p) => {
  const line = [p.name, p.heading, p.features.join(', '), p.suites.length ? `tests: ${p.suites.join(' ')}` : ''].filter(Boolean).join(' — ');
  if (words.every((w) => line.toLowerCase().includes(w))) console.log(line);
});
