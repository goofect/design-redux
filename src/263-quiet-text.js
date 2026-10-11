/* ------------------------------------------------------------------ */
/* Quiet links: their text                                              */
/*                                                                      */
/* [[[Note]]], [[[Note|words]]], [[[Note#heading]]] found in text, read  */
/* and written back — renamed, made shareable and quiet again. Pure:    */
/* text in, text out. The feature itself is in 265-quiet-links.         */
/* ------------------------------------------------------------------ */

/* [[[target]]], [[[target|words]]], [[[target#heading]]] — the character before is captured, not looked behind at. */
const QUIET_TRIPLE = /(^|[^[])\[\[\[([^[\]\n]+?)\]\]\](?!\])/g;

/**
 * Every quiet link in some text: { from, to, inner }. Two written back to
 * back are both found — a link's last bracket can be the next one's lead.
 */
function quietMatches(text) {
  const out = [];
  const re = new RegExp(QUIET_TRIPLE.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    const from = m.index + m[1].length;
    const to = from + m[2].length + 6;
    out.push({ from, to, inner: m[2] });
    re.lastIndex = to - 1;
  }
  return out;
}

/** "Note|words" or "Note#Heading" → { target, path, subpath, words }. */
function splitQuiet(inner) {
  const bar = inner.indexOf('|');
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const words = bar === -1 ? '' : inner.slice(bar + 1).trim();
  const hash = target.indexOf('#');
  return {
    target,
    path: hash === -1 ? target : target.slice(0, hash),
    subpath: hash === -1 ? '' : target.slice(hash),
    words,
  };
}

/**
 * What a quiet link shows: its own words, or its target as it's written —
 * a heading after " > " — as Obsidian shows any link.
 */
function quietLabel(target, words) {
  const own = String(words || '').trim();
  if (own) return own;
  const [path, ...rest] = String(target || '').split('#');
  const sub = rest.filter(Boolean).join(' > ').replace(/^\^/, '');
  if (!path) return sub || String(target || '');
  return sub ? `${path} > ${sub}` : path;
}

/** What a quiet link says under the pointer: where it goes, and that it's kept off the graph. */
function quietHint(target, missing) {
  return `Quiet link to ${quietLabel(target, '')}${missing ? ' (not made yet)' : ''} — kept off the graph and backlinks`;
}

/** The same link the other way: quiet if it was plain, plain if it was quiet. */
function toggledLink(hit) {
  return hit.quiet ? `[[${hit.inner}]]` : `[[[${hit.inner}]]]`;
}

/**
 * Whether a quiet link's target is the file that was at `oldPath` —
 * written as its name, its path, or the end of its path, with or
 * without ".md", as Obsidian resolves a link.
 */
function quietPointsAt(path, oldPath) {
  const want = String(path || '').trim().toLowerCase();
  if (!want) return false;
  const old = String(oldPath).toLowerCase();
  const bare = old.replace(/\.md$/, '');
  if (want === old || want === bare) return true;
  return bare.endsWith('/' + want) || old.endsWith('/' + want);
}

/**
 * Text with every quiet link to the file once at `oldPath` pointing at
 * `linktext` instead — its heading and words kept. The count of links
 * changed comes back with it.
 */
function renameQuietLinks(text, oldPath, linktext, stillResolves, spans) {
  return renameQuietLinksIn(text, [{ oldPath, linktext }], stillResolves, spans);
}

/**
 * The same for several renamed files at once: { oldPath, linktext } each,
 * in one pass so the places found stay true. Only over `spans` when given
 * — where links really are — or every quiet link in the text.
 */
function renameQuietLinksIn(text, renames, stillResolves, spans) {
  let count = 0;
  let out = '';
  let at = 0;
  (spans || quietMatches(text)).forEach((q) => {
    const parts = splitQuiet(q.inner);
    const r = renames.find((x) => quietPointsAt(parts.path, x.oldPath));
    if (!r) return;
    if (stillResolves && stillResolves(parts.path)) return;
    count++;
    const words = parts.words ? `|${parts.words}` : '';
    out += text.slice(at, q.from) + `[[[${r.linktext}${parts.subpath}${words}]]]`;
    at = q.to;
  });
  return { text: out + text.slice(at), count };
}

/* The comment a portable quiet link carries: hidden by Obsidian when read. */
const PORTABLE_MARK = '%%quiet%%';

/**
 * Where a note's shared quiet links are: an ordinary link with the mark
 * straight after. Found in the text itself — the mark is its own sign —
 * so it works even before Obsidian has read the note again.
 */
function portableSpans(text) {
  const out = [];
  const re = /(^|[^[])\[\[([^[\]\n]+?)\]\]%%quiet%%/g;
  let m;
  while ((m = re.exec(text))) {
    const from = m.index + m[1].length;
    out.push({ from, to: from + m[2].length + 4 + PORTABLE_MARK.length, inner: m[2] });
  }
  return out;
}

/** Text with each span written another way, back to front so the places hold. */
function rewriteSpans(text, spans, write) {
  let out = text;
  spans
    .slice()
    .sort((a, b) => b.from - a.from)
    .forEach((span) => {
      out = out.slice(0, span.from) + write(span.inner) + out.slice(span.to);
    });
  return out;
}

/**
 * A note made by following a quiet link on a device without this plugin:
 * "[Anarchy.md", or "[Politics/Anarchy.md" as a folder and a note. The
 * link it was made for — "Anarchy", "Politics/Anarchy" — or null.
 */
function strayLinkpath(path) {
  const parts = String(path || '').split('/');
  const at = parts.findIndex((part) => part.startsWith('[') && !part.startsWith('[['));
  if (at === -1 || !/\.md$/i.test(path)) return null;
  const rest = parts.slice(at);
  rest[0] = rest[0].slice(1);
  const linkpath = rest.join('/').replace(/\.md$/i, '');
  return linkpath.trim() ? linkpath : null;
}
