#!/usr/bin/env node
/*
 * Who styles what: every rule of styles/, read where it is written, with its
 * specificity, the @media/@container it sits in, and its place in the cascade
 * (the parts are joined in file order, so a later part wins a tie).
 *
 *   node tools/css-owners.mjs --selector .dr-lib-row [--explain]
 *        the rules that style the class (it is in the last compound), then those
 *        that only use it as context; --explain adds each property's winner
 *   node tools/css-owners.mjs --component bulk-bar     (or a source name: renderBulkBar, LibraryView)
 *        the classes of a component — dr- classes holding every word, or those a
 *        source name's piece writes — the modules that make them, the parts that dress them
 *   node tools/css-owners.mjs --report repeated-overrides | brittle | effects | tokens | hardcoded [--since REF]
 *        the same selector setting the same property in more than one rule; selectors on
 *        Obsidian's own classes with none of the plugin's, and !important; costly effects;
 *        the --dr- tokens and where they're used; lengths written out where a token
 *        exists (--since REF: only lines added since REF)
 *   node tools/css-owners.mjs --json                   the whole selector map, as data
 *
 * --all prints every line of a long answer (otherwise 40 a list). Read-only:
 * it never writes a stylesheet, and it is built from styles/ each run, so it
 * cannot go stale.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 40;

/* -- reading the parts ----------------------------------------------- */

/** Top-level splits of s on a character, outside (), [] and strings. */
function splitTop(s, ch) {
  const out = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ch && depth === 0) {
      out.push([s.slice(start, i), start]);
      start = i + 1;
    }
  }
  out.push([s.slice(start), start]);
  return out;
}

/** One part's rules: selectors, the conditions around them, declarations with their lines. */
function parsePart(file, order, text) {
  // Comments blanked, newlines kept, so every offset still has its line.
  const css = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lineStarts = [0];
  for (let i = 0; i < css.length; i++) if (css[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const rules = [];
  const keyframes = [];
  const conditions = [];
  let i = 0;
  let preludeStart = 0;
  const closeOf = (open) => {
    let depth = 0;
    for (let j = open; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) return j;
    }
    return css.length;
  };
  while (i < css.length) {
    const c = css[i];
    if (c === '{') {
      const raw = css.slice(preludeStart, i);
      const prelude = raw.trim().replace(/\s+/g, ' ');
      const at = preludeStart + raw.search(/\S/);
      if (prelude.startsWith('@keyframes')) {
        keyframes.push({ name: prelude.slice(10).trim(), file, line: lineAt(at) });
        i = closeOf(i) + 1;
      } else if (prelude.startsWith('@')) {
        conditions.push(prelude);
        i++;
      } else {
        const end = css.indexOf('}', i);
        const body = css.slice(i + 1, end);
        const declarations = splitTop(body, ';')
          .map(([d, off]) => {
            const colon = d.indexOf(':');
            if (colon < 0 || !d.trim()) return null;
            const value = d.slice(colon + 1).trim().replace(/\s+/g, ' ');
            return { property: d.slice(0, colon).trim(), value: value.replace(/\s*!important$/, ''), important: /!important$/.test(value), line: lineAt(i + 1 + off + d.search(/\S/)) };
          })
          .filter(Boolean);
        // Each selector of a group with its own line.
        const selectors = splitTop(raw, ',')
          .filter(([sel]) => sel.trim())
          .map(([sel, off]) => {
            const text = sel.trim().replace(/\s+/g, ' ');
            return { text, line: lineAt(preludeStart + off + sel.search(/\S/)), specificity: specificity(text), subject: subjectOf(text) };
          });
        rules.push({ file, order, line: lineAt(at), conditions: [...conditions], selectors, declarations });
        i = end + 1;
      }
      preludeStart = i;
    } else if (c === '}') {
      conditions.pop();
      i++;
      preludeStart = i;
    } else if (c === ';' && css.slice(preludeStart, i).trim().startsWith('@')) {
      i++;
      preludeStart = i;
    } else i++;
  }
  return { rules, keyframes };
}

/** [ids, classes/attributes/pseudo-classes, types/pseudo-elements] of one selector. */
export function specificity(sel) {
  let a = 0;
  let b = 0;
  let c = 0;
  let i = 0;
  const args = (from) => {
    let depth = 1;
    let j = from;
    while (j < sel.length && depth) {
      if (sel[j] === '(') depth++;
      else if (sel[j] === ')') depth--;
      j++;
    }
    return [sel.slice(from, j - 1), j];
  };
  const ident = (from) => {
    const m = sel.slice(from).match(/^-?[A-Za-z_\\][\w\\-]*/);
    return m ? m[0] : '';
  };
  while (i < sel.length) {
    const ch = sel[i];
    if (ch === '#') {
      a++;
      i += 1 + ident(i + 1).length;
    } else if (ch === '.') {
      b++;
      i += 1 + ident(i + 1).length;
    } else if (ch === '[') {
      b++;
      i = sel.indexOf(']', i) + 1 || sel.length;
    } else if (ch === ':') {
      const element = sel[i + 1] === ':';
      const name = ident(i + (element ? 2 : 1)).toLowerCase();
      i += (element ? 2 : 1) + name.length;
      let inner = null;
      if (sel[i] === '(') [inner, i] = args(i + 1);
      if (element || ['before', 'after', 'first-line', 'first-letter'].includes(name)) c++;
      else if (name === 'where') continue;
      else if (['is', 'not', 'has', 'matches'].includes(name) && inner !== null) {
        const best = splitTop(inner, ',').map(([s]) => specificity(s.trim())).reduce((m, s) => (cmpSpec(s, m) > 0 ? s : m), [0, 0, 0]);
        a += best[0];
        b += best[1];
        c += best[2];
      } else b++;
    } else if (/[A-Za-z]/.test(ch)) {
      c++;
      i += ident(i).length || 1;
    } else i++;
  }
  return [a, b, c];
}
const cmpSpec = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/** The last compound of a selector: what it styles. */
function subjectOf(sel) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && /[\s>+~]/.test(ch)) {
      if (cur) parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts[parts.length - 1] || '';
}

export function loadStyles() {
  const dir = path.join(root, 'styles');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).sort();
  const rules = [];
  const keyframes = [];
  files.forEach((f, order) => {
    const part = parsePart(`styles/${f}`, order, fs.readFileSync(path.join(dir, f), 'utf8'));
    rules.push(...part.rules);
    keyframes.push(...part.keyframes);
  });
  return { parts: files.map((f) => `styles/${f}`), rules, keyframes };
}

const hasClass = (text, cls) => new RegExp(`\\.${cls.replace(/^\./, '').replace(/[-]/g, '\\-')}(?![\\w-])`).test(text);

/** The rules that style a class (it's in the subject) and those that only use it as context. */
export function rulesFor(styles, cls) {
  const styling = [];
  const context = [];
  styles.rules.forEach((r) =>
    r.selectors.forEach((s) => {
      if (!hasClass(s.text, cls)) return;
      (hasClass(s.subject, cls) ? styling : context).push({ rule: r, selector: s });
    })
  );
  return { styling, context };
}

/* -- answers --------------------------------------------------------- */

const fmtSpec = (s) => `(${s.join(',')})`;
const where = (r, line = r.line) => `${r.file}:${line}`;
const cond = (r) => (r.conditions.length ? `  [${r.conditions.join(' › ')}]` : '');

function limited(lines, all, what = 'lines') {
  if (all || lines.length <= LIMIT) return lines;
  return lines.slice(0, LIMIT).concat(`… ${lines.length - LIMIT} more ${what} (--all)`);
}

function selectorAnswer(styles, query, opts) {
  const cls = query.replace(/^\./, '');
  const { styling, context } = rulesFor(styles, cls);
  if (!styling.length && !context.length) return { ok: false, out: [`no rule in styles/ names .${cls}${near(styles, cls)}`] };
  const out = [`.${cls}: styled by ${styling.length} selectors in ${new Set(styling.map((x) => x.rule.file)).size} parts; context in ${context.length} more`, '', 'styles it (cascade order):'];
  out.push(...limited(styling.map(({ rule, selector }) => `  ${where(rule, selector.line).padEnd(38)} ${fmtSpec(selector.specificity).padEnd(8)} ${selector.text}${cond(rule)}`), opts.all));
  if (context.length) out.push('', 'as context for something inside it:', ...limited(context.map(({ rule, selector }) => `  ${where(rule, selector.line).padEnd(38)} ${selector.text}${cond(rule)}`), opts.all));
  if (opts.explain) out.push('', ...explain(styling, cls, opts));
  return { ok: true, out };
}

/** Where a selector applies, beside the bare class: its conditions, ancestors, and the states or modifiers on the element. */
function variantOf(rule, selector, cls) {
  const ancestors = selector.text.slice(0, selector.text.length - selector.subject.length).trim();
  const mods = selector.subject.replace(new RegExp(`\\.${cls}(?![\\w-])`), '');
  return [rule.conditions.join(' › '), ancestors && `in ${ancestors}`, mods && `with ${mods}`].filter(Boolean).join(', ') || 'always';
}

/** Per variant, the declaration that wins each property: !important, then specificity, then the later in the cascade. */
function explain(styling, cls, opts) {
  const groups = new Map();
  styling.forEach(({ rule, selector }) => {
    const variant = variantOf(rule, selector, cls);
    if (!groups.has(variant)) groups.set(variant, new Map());
    const props = groups.get(variant);
    rule.declarations.forEach((d) => {
      const was = props.get(d.property);
      const order = (x) => [x.d.important ? 1 : 0, ...x.selector.specificity, x.rule.order, x.d.line];
      const at = { rule, selector, d, over: 0 };
      if (!was) return props.set(d.property, at);
      const [p, q] = [order(at), order(was)];
      const i = p.findIndex((v, k) => v !== q[k]);
      if (i >= 0 && p[i] > q[i]) props.set(d.property, Object.assign(at, { over: was.over + 1 }));
      else was.over++;
    });
  });
  const base = groups.get('always') || new Map();
  const out = ['who wins, per property, in each variant (!important, then specificity, then the later part):'];
  const lines = [];
  [...groups.keys()]
    .sort((x, y) => (x === 'always' ? -1 : y === 'always' ? 1 : x.localeCompare(y)))
    .forEach((variant) => {
      lines.push(`  ${variant}:`);
      [...groups.get(variant).entries()]
        .sort((x, y) => x[0].localeCompare(y[0]))
        .forEach(([prop, w]) => {
          const overBase = variant !== 'always' && base.has(prop) ? ` (over ${base.get(prop).d.value})` : '';
          lines.push(`    ${prop}: ${w.d.value}${w.d.important ? ' !important' : ''}${overBase} — ${where(w.rule, w.d.line)}${w.over ? `, beats ${w.over} in the same variant` : ''}`);
        });
    });
  return out.concat(limited(lines, opts.all));
}

function near(styles, cls) {
  const all = [...new Set(styles.rules.flatMap((r) => r.selectors.flatMap((s) => s.text.match(/\.dr-[\w-]+/g) || [])))].map((c) => c.slice(1));
  const words = cls.replace(/^dr-/, '').split('-').filter(Boolean);
  const close = all.filter((c) => words.some((w) => w.length > 2 && c.includes(w))).sort().slice(0, 10);
  return close.length ? `; near: ${close.join(', ')}` : '';
}

/** The source modules, as text, by path. */
function sources() {
  const src = path.join(root, 'src');
  const out = [];
  fs.readdirSync(src)
    .filter((d) => fs.statSync(path.join(src, d)).isDirectory())
    .sort()
    .forEach((d) => fs.readdirSync(path.join(src, d)).filter((f) => f.endsWith('.js')).sort().forEach((f) => out.push({ file: `src/${d}/${f}`, text: fs.readFileSync(path.join(src, d, f), 'utf8') })));
  return out;
}

/** A top-level name (its whole piece) or a method (its own body), by the way the source is written. */
function findSymbol(mods, name) {
  const n = name.replace(/\$/g, '\\$');
  const top = mods.find((m) => new RegExp(`^(?:export )?(?:class|function|const|let) ${n}\\b`, 'm').test(m.text));
  if (top) return { where: `${top.file} (which declares ${name})`, text: top.text };
  for (const m of mods) {
    const lines = m.text.split('\n');
    const at = lines.findIndex((l) => new RegExp(`^( +)(?:async |static |get |set )*${n}\\(.*\\) \\{$`).test(l));
    if (at < 0) continue;
    const indent = lines[at].match(/^ */)[0];
    let end = at + 1;
    while (end < lines.length && lines[end] !== `${indent}}`) end++;
    return { where: `${name} at ${m.file}:${at + 1}-${end + 1}`, text: lines.slice(at, end + 1).join('\n') };
  }
  return null;
}

function componentAnswer(styles, name, opts) {
  const mods = sources();
  const allClasses = [...new Set(styles.rules.flatMap((r) => r.selectors.flatMap((s) => s.text.match(/\.dr-[\w-]+/g) || [])).map((c) => c.slice(1)))].sort();
  let classes = null;
  let how;
  const symbol = /^[A-Za-z_$][\w$]*$/.test(name) && !name.includes('-') ? findSymbol(mods, name) : null;
  if (symbol) {
    classes = allClasses.filter((c) => new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(symbol.text));
    how = `the classes ${symbol.where} writes and styles/ dresses`;
  }
  // A source name that writes no class (a method like bulk()) gives way to the words.
  if (!classes || !classes.length) {
    const words = name.toLowerCase().replace(/^\.?dr-/, '').split(/[-\s]+/).filter(Boolean);
    classes = allClasses.filter((c) => words.every((w) => c.split('-').includes(w)));
    how = `dr- classes holding ${words.map((w) => `"${w}"`).join(' and ')}`;
  }
  if (!classes.length) return { ok: false, out: [`no component "${name}": no dr- class holds those words and no source name is called that${near(styles, name.toLowerCase())}`] };
  const out = [`${name}: ${classes.length} classes — ${how}`, ''];
  classes.forEach((c) => {
    const { styling, context } = rulesFor(styles, c);
    const parts = new Map();
    styling.forEach(({ rule, selector }) => parts.set(rule.file, (parts.get(rule.file) || []).concat(selector.line)));
    const owners = mods.filter((m) => new RegExp(`(?<![\\w-])${c}(?![\\w-])`).test(m.text)).map((m) => path.basename(m.file, '.js'));
    out.push(`.${c}`);
    out.push(`  dressed in: ${[...parts.entries()].map(([f, ls]) => `${f}:${[...new Set(ls)].slice(0, 4).join(',')}${new Set(ls).size > 4 ? ` +${new Set(ls).size - 4}` : ''}`).join('; ') || 'nothing (only as context)'}${context.length ? `; context in ${context.length}` : ''}`);
    out.push(`  made by: ${owners.join(', ') || 'no module names it whole (built at run time?)'}`);
  });
  const files = new Set(classes.flatMap((c) => rulesFor(styles, c).styling.map((x) => x.rule.file)));
  out.push('', `parts, in cascade order: ${styles.parts.filter((p) => files.has(p)).join(', ')}`);
  return { ok: true, out: limited(out, opts.all) };
}

/* -- reports --------------------------------------------------------- */

function repeated(styles, opts) {
  const seen = new Map();
  styles.rules.forEach((r) =>
    r.selectors.forEach((s) =>
      r.declarations.forEach((d) => {
        if (d.property.startsWith('--')) return;
        const key = `${r.conditions.join(' › ')}\u0000${s.text}\u0000${d.property}`;
        seen.set(key, (seen.get(key) || []).concat({ r, d }));
      })
    )
  );
  const lines = [...seen.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      const [c, sel, prop] = key.split('\u0000');
      return `${sel} { ${prop} }${c ? ` [${c}]` : ''}: ${list.map(({ r, d }) => `${where(r, d.line)} ${d.value}`).join(' → ')}`;
    });
  return [`the same selector setting the same property in more than one rule (the last wins): ${lines.length}`, ...limited(lines, opts.all)];
}

function brittle(styles, opts) {
  const outright = [];
  let inside = 0;
  const important = new Map();
  // On body or :root alone a rule sets tokens or the plugin's looks: not Obsidian's elements.
  const bodyOnly = (sel) => /^(html|body|:root)([.:[][^\s>+~]*)?$/.test(sel.trim());
  styles.rules.forEach((r) => {
    r.selectors.forEach((s) => {
      // The plugin's: any dr- (a class or [class^="dr-"]). Neutral: is-/has-/mod- states, which either sets.
      // Obsidian's: another class, or an element type.
      const native = /\.(?!dr-|is-|has-|mod-)[a-z]/.test(s.subject) || /^(?!html|body)[a-z]/.test(s.subject);
      if (/dr-/.test(s.subject) || bodyOnly(s.text) || !native) return;
      const ancestors = s.text.slice(0, s.text.length - s.subject.length);
      // A dr- class on body only picks a look; on any other ancestor the element is inside the plugin's own.
      if (/\.dr-/.test(ancestors.replace(/^body[^\s]*/, ''))) inside++;
      else outright.push(`${where(r, s.line).padEnd(38)} ${s.text}${cond(r)}`);
    });
    r.declarations.filter((d) => d.important).forEach(() => important.set(r.file, (important.get(r.file) || 0) + 1));
  });
  const out = [`selectors on Obsidian's own elements with none of the plugin's around them (break when Obsidian renames): ${outright.length}`, ...limited([...new Set(outright)], opts.all)];
  out.push('', `Obsidian's elements inside the plugin's own (safer, still Obsidian's names): ${inside}`);
  out.push(`!important by part: ${[...important.entries()].map(([f, n]) => `${path.basename(f)} ${n}`).join(', ') || 'none'}`);
  return out;
}

function effects(styles, opts) {
  const lines = [];
  styles.rules.forEach((r) =>
    r.declarations.forEach((d) => {
      let why = null;
      if (/^(-webkit-)?backdrop-filter$/.test(d.property) && d.value !== 'none') why = 'backdrop blur repaints what is behind it';
      else if (d.property === 'filter' && /blur|drop-shadow/.test(d.value)) why = 'filter';
      else if (d.property === 'will-change') why = 'will-change keeps a layer';
      else if (/^transition(-property)?$/.test(d.property) && /\ball\b|box-shadow|filter|width|height|top|left|margin|padding/.test(d.value)) why = 'transition of a property that lays out or repaints';
      else if (d.property === 'animation' && d.value !== 'none') why = 'animation';
      if (why) lines.push(`${where(r, d.line).padEnd(38)} ${d.property}: ${d.value.length > 60 ? `${d.value.slice(0, 59)}…` : d.value} — ${why}${cond(r)}`);
    })
  );
  return [`effects that cost a repaint or a layer: ${lines.length}`, ...limited(lines, opts.all)];
}

function tokenTable(styles) {
  const defined = new Map();
  const used = new Map();
  styles.rules.forEach((r) =>
    r.declarations.forEach((d) => {
      if (d.property.startsWith('--dr-')) defined.set(d.property, (defined.get(d.property) || []).concat({ r, d }));
      (d.value.match(/var\(\s*(--dr-[\w-]+)/g) || []).forEach((v) => {
        const t = v.replace(/var\(\s*/, '');
        used.set(t, (used.get(t) || 0) + 1);
      });
    })
  );
  return { defined, used };
}

function tokens(styles, opts) {
  const { defined, used } = tokenTable(styles);
  const lines = [...defined.keys()].sort().map((t) => {
    const first = defined.get(t)[0];
    return `${t.padEnd(30)} ${String(used.get(t) || 0).padStart(4)} uses — first set ${where(first.r, first.d.line)} to ${first.d.value}${defined.get(t).length > 1 ? ` (set in ${defined.get(t).length} rules)` : ''}`;
  });
  const unknown = [...used.keys()].filter((t) => !defined.has(t)).sort();
  const out = [`--dr- tokens: ${defined.size}`, ...limited(lines, opts.all)];
  if (unknown.length) out.push('', `used but set nowhere in styles/ (set from code, or a slip): ${unknown.join(', ')}`);
  return out;
}

/** Lines added since a ref, by part. */
function addedSince(ref) {
  const diff = execFileSync('git', ['diff', '-U0', ref, '--', 'styles/'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString();
  const added = new Map();
  let file = null;
  diff.split('\n').forEach((l) => {
    const f = l.match(/^\+\+\+ b\/(.+)$/);
    if (f) file = f[1];
    const h = l.match(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/);
    if (h && file) for (let n = 0; n < Number(h[2] === undefined ? 1 : h[2]); n++) added.set(`${file}:${Number(h[1]) + n}`, true);
  });
  return added;
}

const SPACE_PROPS = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/;
function hardcoded(styles, opts) {
  const added = opts.since ? addedSince(opts.since) : null;
  const lines = [];
  styles.rules.forEach((r) => {
    // The foundation sets the tokens; values there are the scale itself.
    if (r.file === 'styles/04-foundation.css') return;
    r.declarations.forEach((d) => {
      if (added && !added.has(`${r.file}:${d.line}`)) return;
      // A fallback inside var() is the token's, not a value written out.
      let v = d.value;
      while (/var\([^()]*\)/.test(v)) v = v.replace(/var\([^()]*\)/g, 'var');
      let kind = null;
      if (SPACE_PROPS.test(d.property) && /(?<![\w.-])[1-9]\d*(\.\d+)?px\b/.test(v)) kind = 'spacing: --dr-space-*';
      else if (/radius$/.test(d.property) && /(?<![\w.-])[1-9]\d*px\b/.test(v)) kind = 'corner: --dr-radius-*';
      else if (d.property === 'box-shadow' && !/var/.test(v) && v !== 'none') kind = 'shadow: --dr-shadow-*';
      else if (d.property === 'font-size' && /\d(px|rem|em)\b/.test(v)) kind = 'type: --dr-font-* / Obsidian font sizes';
      if (kind) lines.push(`${where(r, d.line).padEnd(38)} ${d.property}: ${d.value} — ${kind}`);
    });
  });
  const head = `${added ? `added since ${opts.since}: ` : ''}values written out where a token exists: ${lines.length}${added ? '' : ' (some are a part\'s own measure, as 04-foundation says)'}`;
  return [head, ...limited(lines, opts.all)];
}

const REPORTS = { 'repeated-overrides': repeated, brittle, effects, tokens, hardcoded };

/* -- the command line ------------------------------------------------ */

export function cssOwners(argv) {
  const opts = { all: argv.includes('--all'), explain: argv.includes('--explain') };
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  opts.since = value('--since');
  const styles = loadStyles();
  if (argv.includes('--json')) return { ok: true, out: [JSON.stringify({ parts: styles.parts, keyframes: styles.keyframes, rules: styles.rules })] };
  if (value('--selector')) return selectorAnswer(styles, value('--selector'), opts);
  if (value('--component')) return componentAnswer(styles, value('--component'), opts);
  if (argv.includes('--report')) {
    const report = REPORTS[value('--report')];
    if (!report) return { ok: false, out: [`--report takes one of: ${Object.keys(REPORTS).join(', ')}`] };
    return { ok: true, out: report(styles, opts) };
  }
  return { ok: false, help: true, out: [] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const answer = cssOwners(process.argv.slice(2));
  if (answer.help) {
    process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').match(/\/\*\n([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, ''));
  } else {
    (answer.ok ? process.stdout : process.stderr).write(`${answer.out.join('\n')}\n`);
    if (!answer.ok) process.exitCode = 1;
  }
}
