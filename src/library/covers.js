/* ------------------------------------------------------------------ */
/* Covers: an image of the person's own in place of a glyph            */
/*                                                                     */
/* A note's cover is a link in its cover property; a folder's is kept  */
/* by the folder's path. Either shows instead of the glyph, in its own */
/* shape, untouched. A folder can also be given one of the five        */
/* tones, which its glyph is then drawn in. An image dropped on a      */
/* folder becomes its cover.                                           */
/* ------------------------------------------------------------------ */

import { Notice, TFile, normalizePath } from 'obsidian';
import { Feature } from '../core/feature.js';
import { linkTarget } from '../core/notes.js';
import { counted } from '../core/text.js';
import { choose } from '../ui/choose.js';

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];
export const TONES = ['rust', 'ochre', 'moss', 'slate', 'plum'];

/** The tone nearest a colour kept from the old plugin (a hex), by its hue; a grey has none. */
export function toneOf(value) {
  if (TONES.includes(value)) return value;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(value || ''));
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
  if (max - min < 0.08) return null;
  const hue = (60 * (max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4) + 360) % 360;
  return hue < 25 || hue >= 345 ? 'rust' : hue < 70 ? 'ochre' : hue < 170 ? 'moss' : hue < 260 ? 'slate' : 'plum';
}

export class Covers extends Feature {
  enable() {
    this.plugin.toneOf = (entry) => toneOf((this.settings.coverColors || {})[entry.path]);
    this.plugin.coverDropped = (folder, blob) => (this.settings.coverDrop === false ? null : this.dropped(folder, blob));
    this.add(() => {
      delete this.plugin.toneOf;
      delete this.plugin.coverDropped;
    });
  }

  get property() {
    return this.settings.coverProperty || 'cover';
  }

  images() {
    return this.app.vault.getFiles().filter((f) => IMAGE_EXTENSIONS.includes(f.extension.toLowerCase()));
  }

  chooseImage(placeholder) {
    return choose(this.app, this.images(), { placeholder, name: (f) => f.path });
  }

  async setNoteCover(file, image) {
    const img = image || (await this.chooseImage(`A cover for ${file.basename}`));
    if (!img) return false;
    await this.plugin.notes.write(file, (fm) => (fm[this.property] = `[[${img.path}]]`), { undo: `Cover set for ${file.basename}.` });
    return true;
  }

  removeNoteCover(file) {
    return this.plugin.notes.write(file, (fm) => delete fm[this.property], { undo: `Cover removed from ${file.basename}.` });
  }

  /** The first image a note embeds, or null. */
  async firstImage(file) {
    const text = await this.app.vault.cachedRead(file);
    const all = Array.from(text.matchAll(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)\)/g));
    for (const m of all) {
      const target = this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(m[1] || m[2]), file.path);
      if (target instanceof TFile && IMAGE_EXTENSIONS.includes(target.extension.toLowerCase())) return target;
    }
    return null;
  }

  async coverFromFirstImage(file) {
    const img = await this.firstImage(file);
    if (!img) return void new Notice('This note embeds no image.');
    return this.setNoteCover(file, img);
  }

  async setFolderCover(folder, image) {
    const img = image || (await this.chooseImage(`A cover for ${folder.name}`));
    if (!img) return false;
    (this.settings.folderCovers || (this.settings.folderCovers = {}))[folder.path] = img.path;
    await this.plugin.saveSettings();
    return true;
  }

  async removeFolderCover(folder) {
    delete (this.settings.folderCovers || {})[folder.path];
    await this.plugin.saveSettings();
  }

  async chooseTone(folder) {
    const tone = await choose(this.app, TONES.concat('none'), { placeholder: `A tone for ${folder.name}`, name: (t) => (t === 'none' ? 'No tone: ink' : t[0].toUpperCase() + t.slice(1)) });
    if (!tone) return;
    const colors = this.settings.coverColors || (this.settings.coverColors = {});
    if (tone === 'none') delete colors[folder.path];
    else colors[folder.path] = tone;
    await this.plugin.saveSettings();
  }

  /** An image dropped on a folder: saved into the images folder and made the folder's cover. */
  async dropped(folder, blob) {
    const ext = (/\.([a-z0-9]+)$/i.exec(blob.name || '') || [null, (blob.type || '').split('/')[1] || 'png'])[1].toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) return false;
    const dir = normalizePath(this.settings.imageFolder || 'attachments');
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
    const path = this.plugin.files.freePath(this.app.vault.getAbstractFileByPath(dir), `${folder.name} cover`, ext);
    const file = await this.app.vault.createBinary(path, await blob.arrayBuffer());
    return this.setFolderCover(folder, file);
  }

  /** Covers that name a file that is gone: relinked where a file of that name is found elsewhere. */
  async repair() {
    let fixed = 0;
    let lost = 0;
    const byName = new Map(this.images().map((f) => [f.name.toLowerCase(), f]));
    for (const note of this.plugin.index.markdown()) {
      const value = this.plugin.notes.get(note, this.property);
      const first = Array.isArray(value) ? value[0] : value;
      if (!first) continue;
      const target = linkTarget(first) || String(first);
      if (this.app.metadataCache.getFirstLinkpathDest(target, note.path)) continue;
      const found = byName.get(target.split('/').pop().toLowerCase());
      if (!found) { lost++; continue; }
      await this.plugin.notes.write(note, (fm) => (fm[this.property] = `[[${found.path}]]`), { failure: false });
      fixed++;
    }
    const covers = this.settings.folderCovers || {};
    Object.keys(covers).forEach((p) => {
      if (this.app.vault.getAbstractFileByPath(covers[p])) return;
      const found = byName.get(String(covers[p]).split('/').pop().toLowerCase());
      if (found) { covers[p] = found.path; fixed++; } else lost++;
    });
    if (fixed) await this.plugin.saveSettings();
    new Notice(fixed || lost ? `${counted(fixed, 'cover')} relinked${lost ? `; ${counted(lost, 'cover')} still point nowhere` : ''}.` : 'Every cover points at a file.');
    return { fixed, lost };
  }

  actions() {
    const has = (file) => !!this.plugin.notes.get(file, this.property);
    return [
      { id: 'set-cover-image', name: 'Set cover image', glyph: 'cover-add', on: 'note', menu: 'Cover…', run: (ctx) => this.setNoteCover(ctx.file) },
      { id: 'remove-cover-image', name: 'Remove cover image', glyph: 'cover-remove', on: 'note', menu: 'Remove cover', when: (ctx) => has(ctx.file), run: (ctx) => this.removeNoteCover(ctx.file) },
      { id: 'cover-from-first-image', name: 'Use the note’s first image as its cover', glyph: 'cover', on: 'note', menu: false, run: (ctx) => this.coverFromFirstImage(ctx.file) },
      { id: 'set-folder-cover', name: 'Set cover image for a folder', glyph: 'cover-add', on: 'folder', menu: 'Cover…', run: (ctx) => this.setFolderCover(ctx.folder) },
      { id: 'remove-folder-cover', name: 'Remove cover image from a folder', glyph: 'cover-remove', on: 'folder', menu: 'Remove cover', when: (ctx) => !!(this.settings.folderCovers || {})[ctx.folder.path], run: (ctx) => this.removeFolderCover(ctx.folder) },
      { id: 'set-cover-color', name: 'Set a folder’s tone', glyph: 'color', on: 'folder', menu: 'Tone…', run: (ctx) => this.chooseTone(ctx.folder) },
      { id: 'repair-cover-link', name: 'Relink covers that point nowhere', glyph: 'link', run: () => this.repair() },
    ];
  }

  settingsRows() {
    return [
      { key: 'coverProperty', name: 'Cover property', desc: 'The property of a note that names its cover image.', type: 'text' },
      { key: 'coverDrop', name: 'Drop an image on a folder to set its cover', type: 'toggle' },
      { key: 'imageFolder', name: 'Where dropped images are kept', type: 'text' },
    ];
  }
}
Covers.title = 'Covers';
Covers.glyph = 'cover';
Covers.section = 'Library';
Covers.about = 'An image of your own in place of a glyph, and a tone for a folder.';
