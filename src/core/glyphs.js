/* ------------------------------------------------------------------ */
/* Glyphs: the object that stands for a folder                         */
/*                                                                     */
/* A folder is shown as one solid glyph from the plugin's set          */
/* (assets/icons/objects). The person can pick one; until they do, the */
/* builder here chooses, from the folder's path alone: what its name   */
/* asks for (Music, a tune) where the set has it, else a pick hashed   */
/* from the path; the same on every run and every machine.             */
/* Folders that share a parent are spread — no two alike while the set */
/* lasts, and look-alikes (a family) kept apart. What was chosen is    */
/* kept by path (the caller stores it), so it follows a rename and a   */
/* folder made later never changes the face of one already there.      */
/*                                                                     */
/* Nothing here touches Obsidian or the DOM: text in, glyph names out. */
/* ------------------------------------------------------------------ */

/** The object glyphs, in families of look-alikes. A family's glyphs share a build, so two of them side by side are the hardest to tell apart. */
export const GLYPH_FAMILIES = {
  solid: ['gem', 'vase', 'bottle', 'bowl', 'hat', 'anvil', 'boot', 'acorn'],
  cut: ['pie', 'quarter', 'corner', 'half', 'arch', 'checker', 'cheese', 'guitar'],
  barred: ['spiral', 'stairs', 'key', 'crown', 'chair', 'anchor', 'fence', 'rake'],
  stemmed: ['tree', 'glass', 'umbrella', 'tune', 'pine', 'rocket', 'lamp', 'candle'],
  boxed: ['book', 'cup', 'tower', 'factory', 'plug', 'flask', 'radio', 'truck'],
  organic: ['leaf', 'flower', 'fish', 'mountain', 'boat', 'cat', 'sun', 'cactus'],
};

/**
 * Words a folder's name may hold that name something in the set: the glyph's
 * own name, then a few plain words for the same thing. Each word names one
 * glyph. A folder called Music is a tune, Reading a book, Recipes a bowl.
 */
const GLYPH_WORDS = {
  gem: 'gem jewel jewelry jewellery treasure crystal diamond',
  vase: 'vase decor decoration pottery ceramics interior',
  bottle: 'bottle wine beer drink spirits brewing',
  bowl: 'bowl food recipe cooking kitchen meal soup baking',
  hat: 'hat fashion clothes clothing wardrobe style',
  anvil: 'anvil craft forge workshop making maker diy',
  boot: 'boot shoe running hiking walking',
  acorn: 'acorn autumn fall nut seed squirrel',
  pie: 'pie chart stats statistics data analytics budget',
  quarter: 'quarter quarterly',
  corner: 'corner',
  half: 'half dome',
  arch: 'arch magnet physics',
  checker: 'checker chess board game',
  cheese: 'cheese dairy',
  guitar: 'guitar band gig concert',
  spiral: 'spiral maze puzzle',
  stairs: 'stairs step progress level career growth',
  key: 'key password security access secret credential',
  crown: 'crown royal king queen history best favourite favorite',
  chair: 'chair furniture office',
  anchor: 'anchor sea sailing harbour harbor navy marine',
  fence: 'fence farm property land',
  rake: 'rake gardening yard lawn allotment',
  tree: 'tree family genealogy ancestry nature',
  glass: 'glass cocktail party parties',
  umbrella: 'umbrella rain weather insurance',
  tune: 'tune music song audio playlist',
  pine: 'pine christmas winter holiday forest',
  rocket: 'rocket space launch startup astronomy',
  lamp: 'lamp light lighting idea inspiration',
  candle: 'candle memorial birthday faith prayer church',
  book: 'book reading literature novel library',
  cup: 'cup coffee tea cafe mug',
  tower: 'tower castle city cities architecture',
  factory: 'factory work business company companies industry job',
  plug: 'plug electronics power energy hardware electric tech',
  flask: 'flask science lab chemistry research experiment',
  radio: 'radio news broadcast podcast',
  truck: 'truck moving delivery shipping car transport',
  leaf: 'leaf leaves plant ecology botany green',
  flower: 'flower garden spring bloom',
  fish: 'fish fishing aquarium ocean',
  mountain: 'mountain climbing outdoors',
  boat: 'boat travel trip voyage cruise',
  cat: 'cat pet animal dog',
  sun: 'sun summer daily day today journal diary',
  cactus: 'cactus desert succulent',
};

const WORD_GLYPH = new Map();
Object.keys(GLYPH_WORDS).forEach((glyph) => GLYPH_WORDS[glyph].split(' ').forEach((word) => WORD_GLYPH.set(word, glyph)));

/**
 * The glyph a folder's own name asks for, or null: the first of its words
 * that names something in the set, as written or with a plural's s taken
 * off. Accents and case are no part of it, so Café is a cup.
 */
export function glyphMeant(path) {
  const name = String(path).split('/').pop().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const word of name.split(/[^a-z]+/)) {
    if (!word) continue;
    const glyph = WORD_GLYPH.get(word) || (word.endsWith('s') && WORD_GLYPH.get(word.slice(0, -1))) || (word.endsWith('es') && WORD_GLYPH.get(word.slice(0, -2)));
    if (glyph && GLYPH_FAMILY.has(glyph)) return glyph;
  }
  return null;
}

/** Every object glyph, in the order the picker shows them. */
export const GLYPHS = Object.values(GLYPH_FAMILIES).flat();

const GLYPH_FAMILY = new Map();
Object.keys(GLYPH_FAMILIES).forEach((family) => GLYPH_FAMILIES[family].forEach((glyph) => GLYPH_FAMILY.set(glyph, family)));

/** Whether a name is one of the object glyphs (a stored choice may be older than the set). */
export function isGlyph(name) {
  return GLYPH_FAMILY.has(name);
}

/** The family a glyph belongs to. */
export function glyphFamily(name) {
  return GLYPH_FAMILY.get(name) || null;
}

/**
 * A 32-bit number from some text: FNV-1a over its letters, then a last mix so
 * one changed letter changes every bit. The text is put in one Unicode form
 * first, so a name typed on a Mac and the same name synced from elsewhere agree.
 */
export function hashText(text, seed = 0x811c9dc5) {
  const s = String(text).normalize('NFC');
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 0x01000193);
    h = Math.imul(h ^ (c >>> 8), 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The glyphs in the order one path would take them: each glyph is scored
 * against the path and the best comes first. Scoring pair by pair means a
 * glyph added to the set later moves only the folders that take it; the
 * rest keep their order.
 */
function glyphOrder(path) {
  const seed = hashText(path);
  return GLYPHS.map((glyph) => [hashText(glyph, seed), glyph])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1))
    .map((scored) => scored[1]);
}

/** The glyph a folder gets from its path alone: what its name asks for, or else the first of its order. */
export function glyphFor(path) {
  return glyphMeant(path) || glyphOrder(path)[0];
}

/** How many times each glyph of a family is in use. */
function familyLoad(glyph, used) {
  return GLYPH_FAMILIES[GLYPH_FAMILY.get(glyph)].reduce((n, g) => n + used.get(g), 0);
}

/** The first glyph in a path's order that is used least, from a family used least. */
function leastUsed(order, used) {
  const least = Math.min(...used.values());
  const free = order.filter((glyph) => used.get(glyph) === least);
  const lightest = Math.min(...free.map((glyph) => familyLoad(glyph, used)));
  return free.find((glyph) => familyLoad(glyph, used) === lightest);
}

/**
 * Glyphs for the folders that share a parent, as { path: glyph }.
 * `chosen` holds what's already settled, by path — picked by the person or
 * stored from an earlier call — and is kept as it is. The rest are given
 * theirs one at a time, in an order that depends on their paths alone, each
 * taking the first glyph of its own order that no sibling has, from the
 * family the siblings have used least. So up to six siblings are six
 * different builds, up to 48 are 48 different glyphs, and past that the
 * repeats are as few as can be.
 */
export function glyphsAmong(paths, chosen = {}) {
  const out = {};
  const used = new Map(GLYPHS.map((glyph) => [glyph, 0]));
  const open = [];
  Array.from(new Set(paths)).forEach((path) => {
    const glyph = chosen[path];
    if (!isGlyph(glyph)) return void open.push(path);
    out[path] = glyph;
    used.set(glyph, used.get(glyph) + 1);
  });
  const ordered = open
    .map((path) => [hashText(path), path])
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1))
    .map(([, path]) => path);
  // First what a name says: a folder named for something in the set takes it, if no sibling has it yet.
  const rest = ordered.filter((path) => {
    const meant = glyphMeant(path);
    if (!meant || used.get(meant) > 0) return true;
    out[path] = meant;
    used.set(meant, 1);
    return false;
  });
  rest.forEach((path) => {
    const glyph = leastUsed(glyphOrder(path), used);
    out[path] = glyph;
    used.set(glyph, used.get(glyph) + 1);
  });
  return out;
}

/** The choices after a folder is renamed or moved: its own and those of everything under it go with it. */
export function glyphsRenamed(chosen, from, to) {
  const out = {};
  const moved = {};
  Object.keys(chosen).forEach((path) => {
    if (path === from) moved[to] = chosen[path];
    else if (path.startsWith(`${from}/`)) moved[to + path.slice(from.length)] = chosen[path];
    else out[path] = chosen[path];
  });
  return Object.assign(out, moved);
}

/** The choices after a folder is deleted: its own and those of everything under it are dropped. */
export function glyphsRemoved(chosen, gone) {
  const out = {};
  Object.keys(chosen).forEach((path) => {
    if (path !== gone && !path.startsWith(`${gone}/`)) out[path] = chosen[path];
  });
  return out;
}
