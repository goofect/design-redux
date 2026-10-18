/* ------------------------------------------------------------------ */

/* Words: counts, names, a line of markdown as plain text               */
/* ------------------------------------------------------------------ */

/** A count with its noun: "1 note", "3 notes". */
export const bulkCount = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/** One line of markdown as the words it shows: no marks, links as their text. */
export function plainMarkdownLine(line) {
  return String(line || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s*(\[![^\]]*\][+-]?\s*)?/, '')
    .replace(/^[-*+]\s+(\[.\]\s+)?/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/!?\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~=]/g, '')
    .trim();
}

/**
 * A note's opening as one short line: its first sentence of prose — past
 * its properties, headings, embeds and rules — as plain words, at most
 * `max` characters. Empty when it has none.
 */
export function noteOpening(text, max = 140) {
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
  const lines = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (lines.length) break;
      continue;
    }
    if (/^(#{1,6}\s|!\[\[|!\[|```|---|\*\*\*|\|)/.test(line) || /^%%/.test(line)) {
      if (lines.length) break;
      continue;
    }
    lines.push(plainMarkdownLine(line));
  }
  const para = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!para) return '';
  const m = /^(.+?[.!?])(\s|$)/.exec(para);
  const first = m ? m[1] : para;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** A file name from a card's words: what a file name can't hold taken out. */
export function noteNameFrom(label) {
  const name = String(label || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
  return name || 'Branch';
}

/** Whether a tag is `from` or nested beneath it, ignoring case and #. */
export function tagUnder(tag, from) {
  const t = String(tag).trim().replace(/^#/, '').toLowerCase();
  const f = String(from).replace(/^#/, '').toLowerCase();
  return !!f && (t === f || t.startsWith(f + '/'));
}

/** A tag renamed, keeping its # if it had one and what's nested beneath as written. */
export function renameTagText(tag, from, to) {
  const text = String(tag).trim();
  if (!tagUnder(text, from)) return tag;
  const hash = text.startsWith('#') ? '#' : '';
  const bare = text.replace(/^#/, '');
  return hash + to + bare.slice(String(from).replace(/^#/, '').length);
}

/**
 * Of a note's headings ({ level, line }), the one a line falls under —
 * the last at or before it — by index; -1 before the first.
 */
export function currentHeading(headings, line) {
  let at = -1;
  (headings || []).forEach((h, i) => {
    if (h.line <= line) at = i;
  });
  return at;
}

/** Where each heading's section ends: the line of the next heading of the same or a higher level, or `total`. */
export function sectionEnds(headings, total) {
  const list = headings || [];
  return list.map((h, i) => {
    for (let j = i + 1; j < list.length; j++) if (list[j].level <= h.level) return list[j].line;
    return total;
  });
}

/**
 * The words under each heading: from the line after it to the next
 * heading of the same or a higher level, so a section counts the ones
 * nested in it.
 */
export function sectionWords(text, headings) {
  const lines = String(text || '').split('\n');
  const ends = sectionEnds(headings, lines.length);
  return (headings || []).map((h, i) =>
    lines
      .slice(h.line + 1, ends[i])
      .filter((l) => !/^#{1,6}\s/.test(l))
      .join(' ')
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  );
}

/**
 * The passages marked ==like this== in a note's text: [{ text, line,
 * before, after }], before and after being the rest of its line. Not in
 * the properties, code blocks or inline code; == inside a link isn't a
 * mark. A mark inside a mark is part of the one passage.
 */
export function highlightsIn(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  let fence = null;
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end !== -1) i = end + 1;
  }
  // \u0001 stands for an = that isn't a mark: inside a link or inline code.
  const plain = (s) =>
    s
      .replace(/==/g, '')
      .replace(/\u0001/g, '=')
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      .trim();
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const opens = /^\s*(```|~~~)/.exec(raw);
    if (fence) {
      if (opens && opens[1] === fence) fence = null;
      continue;
    }
    if (opens) {
      fence = opens[1];
      continue;
    }
    if (raw.indexOf('==') === -1) continue;
    const line = raw.replace(/`[^`]*`|\[\[[^\]]*\]\]|\]\([^)]*\)/g, (m) => m.replace(/=/g, '\u0001'));
    // Each == opens a mark when a word follows it and closes one when a word comes before; marks inside marks belong to the outer one.
    const open = [];
    for (let at = line.indexOf('=='); at !== -1; at = line.indexOf('==', at + 2)) {
      const prev = line[at - 1];
      const next = line[at + 2];
      const canClose = prev !== undefined && /\S/.test(prev) && prev !== '=';
      const canOpen = next !== undefined && /\S/.test(next) && next !== '=';
      if (canClose && open.length) {
        const from = open.pop();
        if (!open.length) {
          out.push({ text: plain(line.slice(from + 2, at)), line: i, before: plain(line.slice(0, from)), after: plain(line.slice(at + 2)) });
        }
      } else if (canOpen) {
        open.push(at);
      }
    }
  }
  return out;
}

/** A short, stable key for a passage: the same words, the same key. */
export function passageHash(text) {
  let h = 5381;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
