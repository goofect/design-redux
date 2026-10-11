/* ------------------------------------------------------------------ */
/* Properties: reading them, a note at a time or across the vault      */
/* ------------------------------------------------------------------ */

/** A value without its wikilink brackets, alias or heading. */
function plainValue(value) {
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
function fmGet(fm, key) {
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
function propertyCounter(app) {
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
function valueList(raw) {
  return (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map((v) => String(v).trim());
}

/** Property names in the vault, most used first. */
function knownPropertyNames(app) {
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
function propertyValues(app, key) {
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
