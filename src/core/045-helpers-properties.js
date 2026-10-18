/* ------------------------------------------------------------------ */

/* Properties: reading them, a note at a time or across the vault      */
/* ------------------------------------------------------------------ */

/** A value without its wikilink brackets, alias or heading. */
export function plainValue(value) {
  return String(value)
    .replace(/^!?\[\[/, '')
    .replace(/\]\]$/, '')
    .split('|')[0]
    .split('#')[0]
    .trim();
}

/**
 * A property's value by name, whatever case the note wrote it in —
 * Obsidian treats "Author" and "author" as one property, and lists it
 * lower-cased.
 */
export function fmGet(fm, key) {
  if (!fm || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(fm, key)) return fm[key];
  const want = String(key).toLowerCase();
  const name = Object.keys(fm).find((k) => k.toLowerCase() === want);
  return name === undefined ? undefined : fm[name];
}

/**
 * How many notes carry each property, as Obsidian counts them: kept with
 * each property's info before Obsidian 1.14, asked for on their own
 * since. A function of a property's key and its info.
 */
export function propertyCounter(app) {
  const m = app && app.metadataTypeManager;
  let occ = null;
  try {
    if (m && typeof m.getPropertyOccurrences === 'function') occ = m.getPropertyOccurrences();
  } catch (err) {
    occ = null;
  }
  return (key, info) => {
    const own = info && (info.count || info.occurrences);
    if (own) return own;
    const lower = String(key || '').toLowerCase();
    return occ && typeof occ[lower] === 'number' ? occ[lower] : 0;
  };
}

/** A property's values as a list of strings, whether written as one or many. */
export function valueList(raw) {
  return (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map((v) => String(v).trim());
}

/**
 * Notes set out under the note a property names as their parent —
 * among these notes, in their order: each parent followed by the notes
 * under it, a step in, at any depth. A note whose parent isn't among
 * them, or that would hang from itself, stays at the top.
 * [{ file, depth, children }], `children` the number directly under it.
 */
export function nestByProperty(app, files, key) {
  const here = new Set(files);
  const parentOf = new Map();
  if (key) {
    files.forEach((file) => {
      const cache = app.metadataCache.getFileCache(file);
      const raw = cache ? fmGet(cache.frontmatter, key) : undefined;
      const found = valueList(raw)
        .map((v) => app.metadataCache.getFirstLinkpathDest(plainValue(v), file.path))
        .find((t) => t && t !== file && here.has(t));
      if (found) parentOf.set(file, found);
    });
  }
  // A ring of parents has no top: its notes stay at the top.
  parentOf.forEach((p, file) => {
    const seen = new Set([file]);
    for (let at = p; at; at = parentOf.get(at)) {
      if (seen.has(at)) {
        parentOf.delete(file);
        break;
      }
      seen.add(at);
    }
  });
  const under = new Map();
  files.forEach((f) => {
    const p = parentOf.get(f);
    if (!p) return;
    if (!under.has(p)) under.set(p, []);
    under.get(p).push(f);
  });
  const out = [];
  const add = (file, depth) => {
    const kids = under.get(file) || [];
    out.push({ file, depth, children: kids.length });
    kids.forEach((k) => add(k, depth + 1));
  };
  files.filter((f) => !parentOf.has(f)).forEach((f) => add(f, 0));
  return out;
}

/** Property names in the vault, most used first. */
export function knownPropertyNames(app) {
  try {
    const m = app.metadataTypeManager;
    const all =
      (m && typeof m.getAllProperties === 'function' && m.getAllProperties()) ||
      (m && m.properties) ||
      {};
    const count = propertyCounter(app);
    return Object.keys(all)
      .map((k) => ({
        name: (all[k] && all[k].name) || k,
        count: count(k, all[k]),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map((e) => e.name);
  } catch (err) {
    return [];
  }
}

/** Every value a property takes across the vault, most used first. */
export function propertyValues(app, key) {
  const want = String(key || '').toLowerCase();
  if (!want) return [];
  const counts = new Map();
  app.vault.getMarkdownFiles().forEach((file) => {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache && cache.frontmatter;
    if (!fm) return;
    const name = Object.keys(fm).find((k) => k.toLowerCase() === want);
    if (!name) return;
    const raw = fm[name];
    (Array.isArray(raw) ? raw : [raw]).forEach((v) => {
      if (v === null || v === undefined || v === '') return;
      const text = plainValue(v);
      if (text) counts.set(text, (counts.get(text) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map((e) => e[0])
    .slice(0, 200);
}

/** A property's name as the vault writes it — its own case — or the key with a capital. */
export function propertyLabel(app, key) {
  try {
    const info = app.metadataTypeManager.getAllProperties()[key];
    if (info && info.name) return info.name;
  } catch (err) {
    /* fall through */
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * The notes a parent property names, as link paths to resolve: from
 * [[Note]], [[Note|alias]], [[folder/Note#heading]], a path or plain
 * text, one value or a list. What the graph's routes and an album's map
 * both read, so they read it the same way.
 */
export function parentLinkpaths(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : [raw]).forEach((value) => {
    if (value === null || value === undefined || typeof value === 'object') return;
    const m = /^\s*!?\[\[([^\]|#]+)/.exec(String(value));
    const linkpath = (m ? m[1] : String(value)).trim();
    if (linkpath && out.indexOf(linkpath) === -1) out.push(linkpath);
  });
  return out;
}
