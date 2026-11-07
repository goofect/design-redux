/* ------------------------------------------------------------------ */
/* Covers and artwork                                                  */
/*                                                                     */
/* What a note or folder is shown with: its cover, the first image in  */
/* it, or art made from its name and colour; the line printed on a     */
/* cover, and the property shown under it.                             */
/* ------------------------------------------------------------------ */

import { setIcon, TFolder } from 'obsidian';
import { ALBUM_KIND_NEUTRAL, ALBUM_TYPES, DEFAULTS, IMAGE_EXTENSIONS } from './020-constants.js';
import { hexToHsl, hexToRgb, normalHex } from './031-colours.js';
import { drawnArt } from './032-drawn-covers.js';
import { byName } from './040-sorting.js';
import { iconForFile } from './042-controls.js';
import { fmGet, plainValue } from './045-helpers-properties.js';
import { noteProps } from './073-notes.js';

/* The properties that stand in for an artist line, in the order they're
   tried. Every place that shows one line about a note uses this. */
export const LEAD_PROPERTIES = ['domain', 'author', 'book', 'status'];

/** A frontmatter value as one line of text, lists included. */
export function valueText(value) {
  if (value === undefined || value === null || value === '') return '';
  return Array.isArray(value)
    ? value.map(plainValue).filter(Boolean).join(', ')
    : plainValue(value);
}

/**
 * The one property worth showing beneath a note's name.
 *
 * Falls back to the folder, since a note with no properties still came
 * from somewhere and a blank line reads as a mistake.
 */
export function leadProperty(app, file, fallbackToFolder) {
  const fm = noteProps(app, file);
  for (const key of LEAD_PROPERTIES) {
    const text = valueText(fmGet(fm, key));
    if (text) return text;
  }
  if (!fallbackToFolder) return '';
  return file.parent && file.parent.path !== '/' ? file.parent.name : '';
}

/**
 * The image a note's cover property points at, as something an <img>
 * can load: a wikilink resolved against the vault, or a URL as given.
 * A colour isn't an image, so it comes back empty.
 */
export function resolveCover(app, file, key) {
  if (file.extension !== 'md') return null;
  const cache = app.metadataCache.getFileCache(file);
  const raw = cache && fmGet(cache.frontmatter, key || 'cover');
  if (typeof raw !== 'string' || !raw.trim()) return null;

  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('#')) return null;

  // A Markdown link — [x](path) — is read too, for values written that way.
  const md = /^!?\[[^\]]*\]\(<?([^)>]+)>?\)$/.exec(value);
  let linkpath = plainValue(value);
  if (md) {
    try {
      linkpath = decodeURI(md[1]);
    } catch (err) {
      linkpath = md[1];
    }
  }
  const target = app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
  return target ? app.vault.getResourcePath(target) : null;
}

/** The first image embedded in a note, resolved to a file in the vault, or null. */
export function firstImageFile(app, file) {
  if (!file || file.extension !== 'md') return null;
  const cache = app.metadataCache.getFileCache(file);
  for (const embed of (cache && cache.embeds) || []) {
    const target = app.metadataCache.getFirstLinkpathDest(String(embed.link || '').split('#')[0], file.path);
    if (target && IMAGE_EXTENSIONS.indexOf(String(target.extension).toLowerCase()) !== -1) return target;
  }
  return null;
}

/** A note's artwork: its cover, or — where the setting has it — the first image in it. */
export function noteCoverSrc(plugin, file) {
  const src = resolveCover(plugin.app, file, plugin.settings.coverProperty);
  if (src || !plugin.settings.coverFromFirstImage) return src;
  const image = firstImageFile(plugin.app, file);
  return image ? plugin.app.vault.getResourcePath(image) : null;
}

/**
 * Artwork into an element: the image if there is one, a glyph if not,
 * and the glyph as well if the image turns out to be missing. `look`
 * says how the glyph is drawn: { art } for an album cover drawn for the
 * name, { hue } for a backdrop coloured from a name, { title } for the
 * name set as a title page (see blankLook).
 */
export function fillArt(el, src, glyph, gen, look) {
  const blank = () => {
    // A cover drawn for the name, in its own colours or one chosen for it.
    if (look && look.art) return drawnArt(el, look, gen && typeof gen === 'object' ? gen.tint : null);
    // With a name to go on, a cover is made from it: a gradient chosen
    // by the name, so it's always the same one, and its initials. A
    // colour can be given with it: { name, tint }.
    if (gen) return generatedArt(el, typeof gen === 'string' ? { name: gen } : gen);
    blankArt(el, glyph, look);
  };
  if (!src) return blank();

  const img = el.createEl('img');
  img.src = src;
  img.alt = '';
  // Not here yet: eased in once it is. One the browser has already shows at once.
  if (!img.complete) {
    img.addClass('is-arriving');
    img.addEventListener('load', () => img.removeClass('is-arriving'), { once: true });
  }
  img.addEventListener('error', () => {
    img.remove();
    blank();
  });
}

/**
 * Where there's no artwork at all: the glyph for what it is — on a soft
 * gradient in a colour picked from a name, or with the name itself set
 * as a title page, which the larger covers show in its place — so a
 * vault of notes without covers still reads as a shelf of records.
 */
export function blankArt(el, glyph, look) {
  el.addClass('is-blank');
  const { hue, title } = look || {};
  if (hue) {
    el.addClass('is-hued');
    el.style.setProperty('--dr-gen-h', String(nameHue(String(hue))));
  }
  if (title) {
    el.addClass('is-titled');
    el.createDiv({ cls: 'dr-type-cover' }).createDiv({ cls: 'dr-type-title', text: String(title) });
  }
  setIcon(el.createSpan({ cls: 'dr-card-glyph' }), glyph);
}

/* -- artwork, as the settings ask for it -------------------------------- */

/**
 * How a placeholder named `name` is drawn, as the settings ask: see
 * fillArt. `path` is what it's for, which may have a design of its own.
 */
export function blankLook(settings, name, path) {
  if (name == null || name === '') return null;
  if (settings.coverFallback === 'art') {
    const design = path && settings.coverDesigns ? settings.coverDesigns[path] : null;
    return design ? { art: name, design } : { art: name };
  }
  if (settings.coverFallback === 'soft') return { hue: name };
  if (settings.coverFallback === 'title') return { title: name };
  return null;
}

/**
 * A note's artwork: its own cover, or a colour chosen for it; then, with
 * 'Folder cover for notes' on, the cover of the folder it's directly in,
 * as a song shows its album's; then the icon — on a soft colour picked
 * from the note's own name, where that's the choice.
 */
export function drawNoteArt(plugin, el, file) {
  const settings = plugin.settings;
  const md = file.extension === 'md';
  const look = blankLook(settings, file.basename, file.path);
  const src = md ? noteCoverSrc(plugin, file) : null;
  // Coloured by kind: a note takes its album's colour, with its own icon.
  if (settings.coverFallback === 'kind' && md && !src) {
    kindArt(plugin, el, file.parent, iconForFile(file), file.path);
    return;
  }
  const gen = md ? coverGen(settings, file.basename, file.path) : null;
  if (src || gen) {
    fillArt(el, src, iconForFile(file), gen, look);
    return;
  }
  const folder = settings.coverFromFolder && file.parent && !(file.parent.isRoot && file.parent.isRoot())
    ? file.parent
    : null;
  fillArt(el, folder ? plugin.folderCoverSrc(folder) : null, iconForFile(file), null, look);
}

/** A folder's artwork: its cover, or a colour chosen for it, or the icon as the settings say. */
export function drawFolderArt(plugin, el, folder) {
  const settings = plugin.settings;
  const root = !!(folder.isRoot && folder.isRoot());
  const name = root ? plugin.app.vault.getName() : folder.name;
  const src = plugin.folderCoverSrc(folder);
  if (settings.coverFallback === 'kind' && !src) kindArt(plugin, el, root ? null : folder, null, folder.path);
  else fillArt(el, src, 'folder', coverGen(settings, name, folder.path), blankLook(settings, name, folder.path));
  // Printed on a cover that isn't a picture: its kind, its name and where it's from, in the same places on every album.
  if (settings.coverPrint && !src && !root && settings.coverFallback !== 'title') printCover(plugin, el, folder);
}

/** An album's kind, from its folder note, or null. */
export function albumKindOf(plugin, folder) {
  const info = folder && typeof plugin.albumInfo === 'function' ? plugin.albumInfo(folder) : null;
  return info && info.type ? ALBUM_TYPES.find((t) => t.id === info.type) || { id: info.type, label: info.label, icon: 'folder', color: ALBUM_KIND_NEUTRAL } : null;
}

/**
 * A cover for an album's kind: its symbol, on its colour — or on the
 * colour chosen for it. A note gets its album's colour and its own icon.
 */
export function kindArt(plugin, el, folder, glyph, path) {
  const kind = albumKindOf(plugin, folder);
  el.addClass('is-generated', 'is-kind');
  paintTint(el, ownTint(plugin.settings, path) || (kind ? kind.color : ALBUM_KIND_NEUTRAL), folder ? folder.name : '');
  setIcon(el.createSpan({ cls: 'dr-card-glyph' }), glyph || (kind ? kind.icon : 'folder'));
}

/** The kind, the name and the collection, printed along a cover's foot. */
export function printCover(plugin, el, folder) {
  const kind = albumKindOf(plugin, folder);
  el.addClass('has-print');
  const band = el.createDiv({ cls: 'dr-cover-print' });
  // Its number in its collection, in the collection's own order: a catalogue number, as a series has.
  const parent = folder.parent;
  const siblings = parent ? (parent.children || []).filter((c) => c instanceof TFolder) : [];
  const ordered = plugin.orders && typeof plugin.orders.arrangeAlbum === 'function'
    ? plugin.orders.arrangeAlbum(parent, siblings, (list) => list.slice().sort((a, b) => byName(a.name, b.name)))
    : siblings.slice().sort((a, b) => byName(a.name, b.name));
  const number = siblings.length > 1 ? ordered.indexOf(folder) + 1 : 0;
  const label = [kind ? kind.label : '', number ? `No. ${String(number).padStart(2, '0')}` : ''].filter(Boolean).join(' · ');
  if (label) band.createDiv({ cls: 'dr-cover-print-kind', text: label });
  band.createDiv({ cls: 'dr-cover-print-title', text: folder.name });
  if (parent && !(parent.isRoot && parent.isRoot())) band.createDiv({ cls: 'dr-cover-print-from', text: parent.name });
}

/** A number from a name, stable between runs: the same name, the same colour. */
export function nameHue(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
  return hash;
}

/** Up to two initials: "Theories of Justice" → TJ, "Realism" → R. */
export function initialsOf(name) {
  const words = String(name)
    .replace(/[_\-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean);
  const skip = /^(of|the|and|a|an|in|on|to|for|de|la|le)$/i;
  const main = words.filter((w, i) => i === 0 || !skip.test(w));
  return main
    .slice(0, 2)
    .map((w) => Array.from(w)[0])
    .join('')
    .toUpperCase();
}

export function generatedArt(el, gen) {
  el.addClass('is-generated');
  paintTint(el, gen.tint, gen.name);
  el.createSpan({ cls: 'dr-gen-initials', text: initialsOf(gen.name) });
}

/**
 * A generated cover's colour onto an element: a chosen colour, the
 * theme's accent, or — with neither — one picked from the name.
 */
export function paintTint(el, tint, name) {
  el.removeClass('is-tinted', 'is-accent', 'is-light');
  ['--dr-gen-h', '--dr-gen-s', '--dr-gen-l'].forEach((v) => el.style.removeProperty(v));
  if (tint === 'accent') {
    // Read from the theme by the stylesheet, so it follows a change of
    // accent without anything being redrawn.
    el.addClass('is-tinted', 'is-accent');
    return;
  }
  const hsl = hexToHsl(tint);
  if (!hsl) {
    el.style.setProperty('--dr-gen-h', String(nameHue(String(name || ''))));
    return;
  }
  el.addClass('is-tinted');
  el.style.setProperty('--dr-gen-h', String(hsl.h));
  el.style.setProperty('--dr-gen-s', `${hsl.s}%`);
  el.style.setProperty('--dr-gen-l', `${hsl.l}%`);
  // White initials vanish on yellow; pale colours get dark ones.
  el.toggleClass('is-light', luminance(tint) > 0.5);
}

/** Relative luminance, 0 for black to 1 for white. */
export function luminance(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The colour chosen for one path, or null if it has none. */
export function ownTint(settings, path) {
  const own = path && settings.coverColors ? settings.coverColors[path] : null;
  return own === 'accent' ? own : normalHex(own);
}

/**
 * What a missing cover gets from settings alone: 'icon' for the icon —
 * plain, on a soft colour, or with the name as a title, which are drawn
 * with it rather than made into a cover — 'accent', a colour, or null
 * for a colour from the name.
 */
export function fallbackTint(settings) {
  const style = settings.coverFallback || 'icon';
  if (style === 'accent') return 'accent';
  if (style === 'custom') return normalHex(settings.generatedCoverColor) || DEFAULTS.generatedCoverColor;
  if (style === 'name') return null;
  return 'icon';
}

/** The colour a generated cover takes: its own, or the one in settings. */
export function coverTint(settings, path) {
  return ownTint(settings, path) || fallbackTint(settings);
}

/**
 * What fillArt needs to make a cover, or null for the plain icon. A
 * colour chosen for one album makes it a cover whatever the default.
 */
export function coverGen(settings, name, path) {
  if (name == null || name === '') return null;
  const tint = coverTint(settings, path);
  return tint === 'icon' ? null : { name: String(name), tint: tint };
}

/* The colours offered for a cover, before a custom one. */
export const COVER_SWATCHES = [
  ['Red', '#e5484d'],
  ['Orange', '#f2811d'],
  ['Yellow', '#f5c518'],
  ['Green', '#30a46c'],
  ['Mint', '#12a594'],
  ['Cyan', '#0797b9'],
  ['Blue', '#3e63dd'],
  ['Indigo', '#5b5bd6'],
  ['Purple', '#8e4ec6'],
  ['Pink', '#d6409f'],
  ['Brown', '#8d6a4f'],
  ['Graphite', '#6f6e77'],
];

