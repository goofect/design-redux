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

/** When, in the spirit of a track length: a glance, not a date. */
export function relativeDay(time) {
  const day = 86400000;
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (time >= midnight) return 'Today';
  if (time >= midnight - day) return 'Yesterday';
  const days = Math.floor((midnight - time) / day) + 1;
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  return new Date(time).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
