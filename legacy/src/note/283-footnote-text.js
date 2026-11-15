/* ------------------------------------------------------------------ */
/* Footnotes: the text, worked out                                    */
/*                                                                    */
/* Finding footnotes in a note, numbering them in order, and the plan */
/* of changes for adding, editing, removing and putting them in order —*/
/* all from the note's text, nothing drawn.                           */
/* ------------------------------------------------------------------ */

export const FOOTNOTE_REF = /\[\^([^\s\]^[]+)\]/g;
export const FOOTNOTE_DEF = /^ {0,3}\[\^([^\s\]^[]+)\]:[ \t]?/;

export function isFootnoteNumber(label) {
  return /^\d+$/.test(label);
}

/**
 * The footnotes in a note: each reference [^n] in the text, and each
 * definition "[^n]: …" with the lines that continue it. Not in the
 * properties, in code or in inline code; not a definition's own label.
 */
export function scanFootnotes(text) {
  const refs = [];
  const defs = [];
  const lines = [];
  let pos = 0;
  text.split('\n').forEach((line) => {
    lines.push({ from: pos, to: pos + line.length, text: line });
    pos += line.length + 1;
  });

  const findRefs = (line, start) => {
    // Inline code, blanked out so its brackets aren't read.
    const masked = line.text.replace(/(`+)[^`]*?\1/g, (s) => ' '.repeat(s.length));
    FOOTNOTE_REF.lastIndex = 0;
    let m;
    while ((m = FOOTNOTE_REF.exec(masked))) {
      if (m.index < start || masked[m.index - 1] === '\\') continue;
      refs.push({ label: m[1], from: line.from + m.index, to: line.from + m.index + m[0].length });
    }
  };

  let i = 0;
  if (lines.length && /^---\s*$/.test(lines[0].text)) {
    for (let j = 1; j < lines.length; j++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[j].text)) {
        i = j + 1;
        break;
      }
    }
  }

  let fence = null;
  let def = null;
  const close = () => {
    if (def) defs.push(def);
    def = null;
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    const t = line.text;
    if (fence) {
      const end = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(t);
      if (end && end[1][0] === fence[0] && end[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(t);
    if (open) {
      close();
      fence = open[1];
      continue;
    }
    if (def) {
      if (!t.trim()) continue;
      if (/^( {4}|\t)/.test(t)) {
        def.to = line.to;
        findRefs(line, 0);
        continue;
      }
      close();
    }
    const m = FOOTNOTE_DEF.exec(t);
    if (m) {
      const labelFrom = line.from + t.indexOf('[^') + 2;
      def = {
        label: m[1],
        lineFrom: line.from,
        labelFrom,
        labelTo: labelFrom + m[1].length,
        bodyFrom: line.from + m[0].length,
        to: line.to,
      };
      findRefs(line, m[0].length);
      continue;
    }
    findRefs(line, 0);
  }
  close();
  return { refs, defs };
}

/** A definition's text, as typed: its continuation lines unindented. */
export function footnoteBody(text, def) {
  return text
    .slice(def.bodyFrom, def.to)
    .split('\n')
    .map((line, i) => (i ? line.replace(/^( {1,4}|\t)/, '') : line))
    .join('\n')
    .trim();
}

/** Text as a definition's body: lines after the first indented, blank ones left blank. */
export function footnoteText(body) {
  return String(body || '')
    .trim()
    .split('\n')
    .map((line, i) => (i && line.trim() ? '    ' + line : line.trimEnd()))
    .join('\n');
}

/**
 * The definitions that end the note: those after which there's nothing
 * but other definitions and blank lines. The list kept in order.
 */
export function trailingFootnotes(text, defs) {
  let k = defs.length;
  let end = text.length;
  while (k > 0) {
    const def = defs[k - 1];
    if (text.slice(def.to, end).trim()) break;
    end = def.lineFrom;
    k--;
  }
  return defs.slice(k);
}

/**
 * What to change in a note's text to add, change, remove or tidy
 * footnotes, as changes to the text as it is ({ from, to, insert },
 * in order, none overlapping), and where the cursor goes after.
 *
 * op: { type: 'add', at, body } — a footnote at `at`
 *     { type: 'edit', label, body } — a footnote's text
 *     { type: 'remove', from, to, label } — the reference there
 *     { type: 'tidy' } — renumbered, and unused ones taken out
 * opts: { renumber (default true), cursor }
 */
export function planFootnotes(text, op, opts) {
  const renumber = !opts || opts.renumber !== false;
  const cursor = opts && typeof opts.cursor === 'number' ? opts.cursor : null;
  const { refs, defs } = scanFootnotes(text);
  const NEW = '\u0000new';

  const removing = (r) =>
    op.type === 'remove' && (op.all ? r.label === op.label : r.from === op.from && r.to === op.to);
  const present = refs.filter((r) => !removing(r)).map((r) => ({ label: r.label, pos: r.from }));
  if (op.type === 'add') present.push({ label: NEW, pos: op.at, first: true });
  present.sort((a, b) => a.pos - b.pos || (a.first ? -1 : b.first ? 1 : 0));

  // New numbers, in the order the footnotes first appear.
  const map = new Map();
  const firstAt = new Map();
  let n = 0;
  present.forEach((r, i) => {
    if (!firstAt.has(r.label)) firstAt.set(r.label, i);
    if (renumber && !map.has(r.label) && (r.label === NEW || isFootnoteNumber(r.label))) map.set(r.label, String(++n));
  });
  if (!renumber && op.type === 'add') {
    const numbers = refs.concat(defs).map((x) => x.label).filter(isFootnoteNumber).map(Number);
    map.set(NEW, String(Math.max(0, ...numbers) + 1));
  }

  // Citations no reference uses: cleared on tidying, and the removed
  // reference's own; otherwise kept, numbered last.
  const used = new Set(present.map((r) => r.label));
  const drop = new Set();
  defs.forEach((d) => {
    if (used.has(d.label)) return;
    if (op.type === 'tidy' || (op.type === 'remove' && d.label === op.label)) {
      drop.add(d);
      return;
    }
    if (renumber && isFootnoteNumber(d.label) && !map.has(d.label)) map.set(d.label, String(++n));
  });
  const relabel = (label) => (map.has(label) ? map.get(label) : label);
  const newLabel = op.type === 'add' ? map.get(NEW) : null;

  const trailing = trailingFootnotes(text, defs);
  // The list at the end is rewritten in order — unless the cursor is in
  // it, or numbers aren't being kept in order.
  const rebuild =
    renumber && trailing.length > 0 && !(op.type === 'add' && op.at >= trailing[0].lineFrom);
  const blockFrom = rebuild ? trailing[0].lineFrom : text.length;
  const inBlock = new Set(rebuild ? trailing : []);

  const changes = [];
  const replaced = [];
  const replace = (from, to, insert) => {
    changes.push({ from, to, insert });
    replaced.push([from, to]);
  };
  const within = (pos) => replaced.some(([a, b]) => pos >= a && pos < b);

  // The same edits, made to a stretch of the text on its own.
  const local = (from, to, inner) => {
    let out = '';
    let at = from;
    inner
      .filter((c) => c.from >= from && c.to <= to)
      .sort((a, b) => a.from - b.from)
      .forEach((c) => {
        out += text.slice(at, c.from) + c.insert;
        at = c.to;
      });
    return out + text.slice(at, to);
  };
  const refEdits = (from, to) =>
    refs
      .filter((r) => r.from >= from && r.to <= to)
      .map((r) =>
        removing(r)
          ? { from: r.from, to: r.to, insert: '' }
          : { from: r.from + 2, to: r.to - 1, insert: relabel(r.label) }
      );

  let edited = false;
  const editing = (d) => op.type === 'edit' && d.label === op.label && !edited && (edited = true);

  // Definitions outside the list at the end: changed where they are.
  defs.forEach((d) => {
    if (inBlock.has(d)) return;
    if (drop.has(d)) {
      replace(d.lineFrom, Math.min(d.to + 1, text.length), '');
    } else if (editing(d)) {
      replace(d.bodyFrom, d.to, footnoteText(op.body));
    }
  });

  // The list at the end, in order.
  let added = false;
  if (rebuild) {
    const entries = trailing
      .filter((d) => !drop.has(d))
      .map((d, i) => {
        const body = editing(d)
          ? footnoteText(op.body)
          : local(d.bodyFrom, d.to, refEdits(d.bodyFrom, d.to));
        return {
          line: `${text.slice(d.lineFrom, d.labelFrom)}${relabel(d.label)}${text.slice(d.labelTo, d.bodyFrom)}${body}`,
          order: firstAt.has(d.label) ? firstAt.get(d.label) : Infinity,
          i,
        };
      });
    if (op.type === 'add') {
      entries.push({ line: `[^${newLabel}]: ${footnoteText(op.body)}`, order: firstAt.get(NEW), i: -1 });
      added = true;
    } else if (op.type === 'edit' && !edited) {
      entries.push({ line: `[^${op.label}]: ${footnoteText(op.body)}`, order: firstAt.get(op.label), i: -1 });
      edited = true;
    }
    entries.sort((a, b) => a.order - b.order || a.i - b.i);
    if (entries.length) {
      replace(blockFrom, text.length, entries.map((e) => e.line).join('\n') + '\n');
    } else {
      // Nothing left to list: the blank lines before it go too.
      let from = blockFrom;
      while (from > 0 && /\s/.test(text[from - 1])) from--;
      replace(from, text.length, from > 0 ? '\n' : '');
    }
  }

  // A citation with no list to join starts one at the end.
  const append = (line) => {
    const tail = text.match(/\n*$/)[0].length;
    const lead = !text.length ? '' : trailing.length ? (tail ? '' : '\n') : '\n'.repeat(Math.max(0, 2 - tail));
    changes.push({ from: text.length, to: text.length, insert: lead + line + '\n' });
  };
  if (op.type === 'add' && !added) append(`[^${newLabel}]: ${footnoteText(op.body)}`);
  if (op.type === 'edit' && !edited) append(`[^${op.label}]: ${footnoteText(op.body)}`);

  // Labels and references everywhere else.
  defs.forEach((d) => {
    if (inBlock.has(d) || drop.has(d) || within(d.labelFrom)) return;
    const label = relabel(d.label);
    if (label !== d.label) changes.push({ from: d.labelFrom, to: d.labelTo, insert: label });
  });
  refs.forEach((r) => {
    if (within(r.from) || (rebuild && r.from >= blockFrom)) return;
    if (removing(r)) {
      changes.push({ from: r.from, to: r.to, insert: '' });
      return;
    }
    const label = relabel(r.label);
    if (label !== r.label) changes.push({ from: r.from + 2, to: r.to - 1, insert: label });
  });
  const refText = op.type === 'add' ? `[^${newLabel}]` : '';
  if (op.type === 'add') changes.push({ from: op.at, to: op.at, insert: refText, isNew: true });

  changes.sort((a, b) => a.from - b.from || (a.isNew ? -1 : b.isNew ? 1 : 0));

  // Where a position ends up once all that's done.
  const mapPos = (pos) => {
    let delta = 0;
    for (const c of changes) {
      if (c.isNew) continue;
      if (c.to <= pos && !(c.from === pos && c.to === pos)) delta += c.insert.length - (c.to - c.from);
      else if (c.from < pos && pos < c.to) return c.from + delta;
    }
    return pos + delta;
  };
  let after = null;
  if (op.type === 'add') after = mapPos(op.at) + refText.length;
  else if (op.type === 'remove' && !op.all) after = mapPos(op.from);
  else if (cursor !== null) after = mapPos(cursor);

  return {
    changes: changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert })),
    cursor: after,
    label: newLabel,
    removed: drop.size,
  };
}

/** The changes made, as text: for tests, and for checking a plan before it's used. */
export function applyFootnoteChanges(text, changes) {
  let out = '';
  let at = 0;
  changes.forEach((c) => {
    out += text.slice(at, c.from) + c.insert;
    at = c.to;
  });
  return out + text.slice(at);
}

/** The reference at or just before a position, if there's one. */
export function footnoteAt(text, pos) {
  return scanFootnotes(text).refs.find((r) => pos >= r.from && pos <= r.to) || null;
}
