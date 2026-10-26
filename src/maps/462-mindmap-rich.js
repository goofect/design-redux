/* ------------------------------------------------------------------ */
/* Mind map: rich nodes                                                */
/*                                                                    */
/* A node can take a shape — a box, a pill, a line under it, or none   */
/* — an icon before its title, Lucide's or an emoji, and an image over */
/* it from the vault. A map can take a theme: a shape for the root,    */
/* for its children and for the rest, a node's own shape before it.    */
/* Kept as the node's attributes and in the layout block.              */
/* ------------------------------------------------------------------ */

import { TFile } from 'obsidian';
import { ChoicePicker, ImagePicker, NamePrompt } from '../ui/230-pickers.js';
import { putIcon } from '../ui/248-value-options.js';
import { nodeById } from '../tree/400-tree-model.js';
import { setAttr } from '../tree/404-tree-ops.js';
import { MAP_THEMES, mapThemeOf, NODE_SHAPES, nodeShape, setMapTheme } from '../tree/406-tree-layout-block.js';
import { MindMapHistory } from './461-mindmap-history.js';

const SHAPE_NAMES = { box: 'A box', pill: 'A pill', underline: 'A line under it', plain: 'No outline' };

export class MindMapRich extends MindMapHistory {
  richOn() {
    return !this.plugin || this.plugin.settings.mindmapRichNodes !== false;
  }

  /** The map's theme: its own, else the one in settings. */
  mapTheme() {
    const own = this.model ? mapThemeOf(this.model) : null;
    const set = this.plugin && this.plugin.settings.mindmapTheme;
    return own || (Object.prototype.hasOwnProperty.call(MAP_THEMES, set) ? set : 'cards');
  }

  /** What a node's shape, icon and image are, for the size it's kept under and when its card's drawn again. */
  richKeyOf(n) {
    if (!this.richOn() || !this.model || n.virtual) return '';
    const a = n.attrs || {};
    return `|${nodeShape(this.model, n, this.mapTheme())}|${a.icon || ''}|${a.image || ''}`;
  }

  /** The image a node shows, as a URL, or null. */
  nodeImage(n) {
    const link = n.attrs && typeof n.attrs.image === 'string' ? n.attrs.image.replace(/^!?\[\[|\]\]$/g, '').split('|')[0] : '';
    const app = this.app;
    if (!link || !app || !app.metadataCache || !app.vault || typeof app.vault.getResourcePath !== 'function') return null;
    const file = typeof app.metadataCache.getFirstLinkpathDest === 'function' ? app.metadataCache.getFirstLinkpathDest(link, this.file ? this.file.path : '') : null;
    return file instanceof TFile ? app.vault.getResourcePath(file) : null;
  }

  /** A node's shape, icon and image onto its card. */
  richCard(el, n) {
    NODE_SHAPES.forEach((s) => el.removeClass(`is-shape-${s}`));
    el.removeClass('has-icon', 'has-image');
    if (!this.richOn() || !this.model || n.virtual) return;
    el.addClass(`is-shape-${nodeShape(this.model, n, this.mapTheme())}`);
    const a = n.attrs || {};
    if (a.image) {
      el.addClass('has-image');
      const src = this.nodeImage(n);
      const img = el.createEl('img', { cls: 'dr-mindmap-image' });
      img.setAttribute('alt', '');
      img.draggable = false;
      if (src) img.src = src;
      else img.addClass('is-missing');
    }
    if (a.icon) {
      el.addClass('has-icon');
      const icon = el.createSpan({ cls: 'dr-mindmap-icon' });
      icon.setAttribute('aria-hidden', 'true');
      putIcon(icon, a.icon);
    }
  }

  chooseShape(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n) return;
    const items = NODE_SHAPES.map((shape) => ({ label: SHAPE_NAMES[shape], shape })).concat([{ label: 'As the map’s theme has it', shape: undefined }]);
    new ChoicePicker(this.app, 'The node’s shape…', items, (item) => this.apply(setAttr(this.model, id, 'shape', item.shape))).open();
  }

  chooseIcon(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n) return;
    new NamePrompt(
      this.app,
      'An icon before the node’s title',
      'An emoji, or an icon’s name as Lucide has it: star, flag, lightbulb',
      (text) => this.apply(setAttr(this.model, id, 'icon', text.trim() || undefined)),
      { value: n.attrs.icon || '', button: 'Set', allowEmpty: true }
    ).open();
  }

  chooseImage(id) {
    const n = this.model && nodeById(this.model, id);
    if (!n) return;
    const picker = new ImagePicker(this.app, (file) => {
      const cache = this.app.metadataCache;
      const link = cache && typeof cache.fileToLinktext === 'function' ? cache.fileToLinktext(file, this.file ? this.file.path : '', false) : file.path;
      this.apply(setAttr(this.model, id, 'image', link));
    });
    if (typeof picker.setPlaceholder === 'function') picker.setPlaceholder('An image over the node…');
    picker.open();
  }

  chooseTheme() {
    if (!this.model) return;
    const items = Object.keys(MAP_THEMES).map((theme) => ({ label: MAP_THEMES[theme].name, theme })).concat([{ label: 'As in settings', theme: null }]);
    new ChoicePicker(this.app, 'The map’s theme…', items, (item) => this.apply(setMapTheme(this.model, item.theme))).open();
  }
}
