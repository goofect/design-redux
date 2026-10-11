/* ------------------------------------------------------------------ */
/* Quiet links: what Obsidian made of them                              */
/*                                                                      */
/* The stand-in links Obsidian records for them in its metadata cache,  */
/* set aside from its counts and found again: where they are, and the   */
/* notes they point at.                                                  */
/* ------------------------------------------------------------------ */

/**
 * The quiet links a note makes, from what Obsidian made of them: the
 * stand-in it links instead ("[Anarchy", or "[Realism]" in a property),
 * and the note meant.
 */
function quietRefs(cache) {
  if (!cache) return [];
  const out = [];
  const add = (ref, fromProperty) => {
    if (!ref || typeof ref.original !== 'string' || typeof ref.link !== 'string') return;
    if (!ref.original.startsWith('[[[') || ref.original.startsWith('[[[[')) return;
    const standIn = ref.link.split('#')[0].split('|')[0];
    if (!standIn.startsWith('[')) return;
    let path = standIn.slice(1);
    // In a property the closing bracket stays on the stand-in.
    if (fromProperty && path.endsWith(']') && ref.original.endsWith(']]]')) path = path.slice(0, -1);
    out.push({ standIn, path, key: ref.key || null });
  };
  (cache.links || []).forEach((ref) => add(ref, false));
  (cache.frontmatterLinks || []).forEach((ref) => add(ref, true));
  (cache.drQuietLinks || []).forEach((ref) => add(ref, !!ref.fromProperty));
  return out;
}

/** Whether a link Obsidian recorded is a quiet link's stand-in. */
function isQuietRef(ref) {
  return (
    !!ref &&
    typeof ref.original === 'string' &&
    typeof ref.link === 'string' &&
    ref.original.startsWith('[[[') &&
    !ref.original.startsWith('[[[[') &&
    ref.link.startsWith('[')
  );
}

/** The name Obsidian counts a link under: its target, without a heading. */
function linkCountKey(ref) {
  return ref.link.split('#')[0].split('|')[0];
}

/**
 * A note's quiet links, taken out of the links Obsidian counts and kept
 * beside them as drQuietLinks. Run as the note is read, before Obsidian
 * counts its links, it never counts the stand-ins at all. Returns what
 * moved.
 */
function settleQuietLinks(cache) {
  if (!cache) return [];
  const moved = [];
  [
    ['links', false],
    ['frontmatterLinks', true],
  ].forEach(([field, fromProperty]) => {
    const list = cache[field];
    if (!Array.isArray(list) || !list.some(isQuietRef)) return;
    cache[field] = list.filter((ref) => {
      if (!isQuietRef(ref)) return true;
      moved.push(Object.assign({}, ref, { fromProperty }));
      return false;
    });
    if (!cache[field].length) delete cache[field];
  });
  if (moved.length) cache.drQuietLinks = (cache.drQuietLinks || []).concat(moved);
  return moved;
}

/** The other way, for when quiet links are switched off: put back where Obsidian keeps them. */
function unsettleQuietLinks(cache) {
  if (!cache || !Array.isArray(cache.drQuietLinks)) return [];
  const back = cache.drQuietLinks;
  const at = (ref) => (ref.position && ref.position.start ? ref.position.start.offset : 0);
  back.forEach((ref) => {
    const field = ref.fromProperty ? 'frontmatterLinks' : 'links';
    const plain = Object.assign({}, ref);
    delete plain.fromProperty;
    (cache[field] = cache[field] || []).push(plain);
  });
  // In the order they're written, as Obsidian lists them.
  if (cache.links) cache.links.sort((a, b) => at(a) - at(b));
  delete cache.drQuietLinks;
  return back;
}

/**
 * Where a note's quiet links are in its text — from where Obsidian found
 * them, so none in code or maths — each over "[[[…]]]": { from, to, inner }.
 * One whose text no longer matches (an edit since it was read) is left out.
 */
function quietSpans(text, cache) {
  const refs = []
    .concat((cache && cache.drQuietLinks) || [])
    .concat(((cache && cache.links) || []).filter(isQuietRef))
    .filter((ref) => !ref.fromProperty && ref.position);
  const out = [];
  refs.forEach((ref) => {
    const from = ref.position.start.offset;
    // Obsidian's link ends before the last bracket.
    const to = ref.position.end.offset + 1;
    const m = /^\[\[\[([^[\]\n]+?)\]\]\]$/.exec(text.slice(from, to));
    if (m) out.push({ from, to, inner: m[1] });
  });
  return out.sort((a, b) => a.from - b.from);
}

/**
 * Where a note's quiet links are, to rename them: in its properties, and in
 * its text where Obsidian found them — so none in code, maths or comments,
 * which keep what's written, as Obsidian leaves its own links there.
 */
function renameSpans(text, cache) {
  const head = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  const end = head ? head[0].length : 0;
  return quietMatches(text.slice(0, end)).concat(quietSpans(text, cache).filter((s) => s.from >= end));
}

/**
 * The notes a note links to quietly, each once: { target, path, count,
 * lines, keys } — from what Obsidian read as links in its text (so not
 * in code), and from its properties.
 */
function quietLinksIn(text, cache) {
  const out = new Map();
  const entry = (target) => {
    const low = target.toLowerCase();
    if (!out.has(low)) out.set(low, { target, path: splitQuiet(target).path, count: 0, lines: [], keys: [] });
    const found = out.get(low);
    found.count++;
    return found;
  };
  quietSpans(text, cache).forEach((span) => {
    entry(splitQuiet(span.inner).target).lines.push(text.slice(0, span.from).split('\n').length);
  });
  quietRefs(cache)
    .filter((ref) => ref.key)
    .forEach((ref) => {
      const found = entry(ref.path);
      if (found.keys.indexOf(ref.key) === -1) found.keys.push(ref.key);
    });
  return Array.from(out.values());
}
