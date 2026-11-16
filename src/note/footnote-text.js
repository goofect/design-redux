/* ------------------------------------------------------------------ */
/* Footnotes: the text, worked out                                     */
/*                                                                     */
/* Finding a note's footnotes and the text a change makes: one added   */
/* at the cursor, all put in order. Numbers follow the order the       */
/* footnotes appear in; named ones ([^smith]) keep their names. A      */
/* footnote inside a code fence doesn't count. Nothing is drawn here.  */
/* ------------------------------------------------------------------ */

const DEF = /^\[\^([^\]\s]+)\]:[ \t]?(.*)$/;

/** The lines of a note that are inside a code fence, as a set of line numbers. */
function fenced(lines) {
  const out = new Set();
  let fence = null;
  lines.forEach((line, i) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      out.add(i);
    } else if (fence) out.add(i);
  });
  return out;
}

/**
 * A note's footnotes: { refs: [{ id, line, at }] in the order they appear,
 * defs: [{ id, text, line, to }] } — a definition runs to `to`, taking in
 * the indented lines under it.
 */
export function findFootnotes(text) {
  const lines = String(text).split('\n');
  const skip = fenced(lines);
  const refs = [];
  const defs = [];
  lines.forEach((line, i) => {
    if (skip.has(i)) return;
    const d = DEF.exec(line);
    if (d) {
      let to = i + 1;
      while (to < lines.length && /^(?: {4}|\t)\S/.test(lines[to])) to++;
      defs.push({ id: d[1], text: [d[2]].concat(lines.slice(i + 1, to).map((l) => l.trim())).join(' ').trim(), line: i, to });
      return;
    }
    Array.from(line.matchAll(/\[\^([^\]\s]+)\]/g)).forEach((m) => refs.push({ id: m[1], line: i, at: m.index }));
  });
  return { refs, defs };
}

/**
 * The text with its footnotes in order: numbered ones renumbered 1, 2, 3 by
 * where they first appear, and every definition at the end of the note in
 * that order (named ones after the numbered, as they stood).
 */
export function tidyFootnotes(text) {
  const { refs, defs } = findFootnotes(text);
  if (!refs.length && !defs.length) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const numeric = (id) => /^\d+$/.test(id);
  const order = [];
  refs.forEach((r) => { if (numeric(r.id) && !order.includes(r.id)) order.push(r.id); });
  defs.forEach((d) => { if (numeric(d.id) && !order.includes(d.id)) order.push(d.id); });
  const renumber = new Map(order.map((id, i) => [id, String(i + 1)]));
  const lines = String(text).split('\n');
  const skip = fenced(lines);
  const defLines = new Set();
  defs.forEach((d) => { for (let i = d.line; i < d.to; i++) defLines.add(i); });
  const body = [];
  lines.forEach((line, i) => {
    if (defLines.has(i)) return;
    body.push(skip.has(i) ? line : line.replace(/\[\^(\d+)\]/g, (all, id) => `[^${renumber.get(id) || id}]`));
  });
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const seen = new Set();
  const kept = defs.filter((d) => !seen.has(d.id) && seen.add(d.id));
  const numbered = kept.filter((d) => numeric(d.id)).sort((a, b) => Number(renumber.get(a.id)) - Number(renumber.get(b.id)));
  const named = kept.filter((d) => !numeric(d.id));
  const tail = numbered.map((d) => `[^${renumber.get(d.id)}]: ${d.text}`).concat(named.map((d) => `[^${d.id}]: ${d.text}`));
  return body.join('\n').replace(/\r$/, '') + (tail.length ? `${eol}${eol}${tail.join(eol)}` : '') + eol;
}

/**
 * The text with a footnote added: its number where the cursor was (`offset`
 * into the text), its citation at the end. Returns { text, id }: the id it
 * has once everything is in order.
 */
export function addFootnote(text, offset, citation, inOrder = true) {
  const { refs, defs } = findFootnotes(text);
  const used = new Set(refs.concat(defs).map((x) => x.id));
  let fresh = 1;
  while (used.has(String(fresh))) fresh++;
  const mark = 'dr-new-footnote';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const at = Math.max(0, Math.min(text.length, offset));
  const clean = String(citation).replace(/\s*\r?\n\s*/g, ' ').trim();
  let out = `${text.slice(0, at)}[^${mark}]${text.slice(at)}`.replace(/(\r?\n)*$/, '') + `${eol}${eol}[^${mark}]: ${clean}${eol}`;
  if (!inOrder) return { text: out.split(mark).join(String(fresh)), id: String(fresh) };
  // Put in order with the newcomer counted as numbered: a temporary number no note would use.
  const temp = '999999';
  out = tidyFootnotes(out.split(mark).join(temp));
  const position = findFootnotes(text.slice(0, at)).refs.filter((r) => /^\d+$/.test(r.id)).map((r) => r.id).filter((id, i, all) => all.indexOf(id) === i).length + 1;
  return { text: out, id: String(position) };
}
