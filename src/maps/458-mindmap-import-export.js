/* ------------------------------------------------------------------ */
/* Mind map: import and export                                         */
/*                                                                    */
/* A map made from an OPML outline, a FreeMind map or a note's         */
/* headings; a map written out as OPML, or as a picture — SVG, PNG, or */
/* a one-page PDF of it — beside the map. The picture is drawn from    */
/* the map's layout, every node shown, whatever's on screen.           */
/* ------------------------------------------------------------------ */

import { Notice, TFile } from 'obsidian';
import { noteNameFrom } from '../core/047-helpers-text.js';
import { ChoicePicker } from '../ui/230-pickers.js';
import { writeOutline } from '../tree/401-tree-outline.js';
import { mapFromFreeMind, mapFromHeadings, mapFromOpml } from '../tree/418-tree-import.js';
import { opmlFromMap, xmlAttr } from '../tree/419-tree-export.js';
import { MINDMAP_VIEW } from './421-mindmap-view.js';
import { showFileAs } from './422-mindmap-takeover.js';
import { CHAR_WIDTH, colourKey, edgePath, estimateSize, layoutScene, NODE_LINE, NODE_PAD, nodeLabel } from './423-mindmap-scene.js';
import { MindMapsTemplates } from './457-mindmap-templates.js';

/* The six colours as a picture shows them, away from the theme. */
const PICTURE_COLOURS = { 1: '#e93147', 2: '#ec7500', 3: '#e0ac00', 4: '#08b94e', 5: '#00bfbc', 6: '#7852ee' };

/** A node's first line broken into lines that fit its box. */
function wrapped(text, width) {
  const per = Math.max(4, Math.floor((width - NODE_PAD.x * 2) / CHAR_WIDTH));
  const out = [];
  let line = '';
  String(text || '').split(/\s+/).forEach((word) => {
    if (line && (line + ' ' + word).length > per) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  });
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** A map as an SVG picture: its boxes, edges and first lines, every node shown. { svg, width, height }. */
export function svgOfMap(model, scene, mode) {
  const pad = 24;
  const b = scene.bounds;
  const width = Math.ceil(b.maxX - b.minX + pad * 2);
  const height = Math.ceil(b.maxY - b.minY + pad * 2);
  const parts = [];
  const at = (x, y) => [x - b.minX + pad, y - b.minY + pad];
  const shift = (box) => {
    const [x, y] = at(box.x, box.y);
    return Object.assign({}, box, { x, y });
  };
  const edges = (n) =>
    n.children.forEach((c) => {
      const from = scene.boxes.get(n.id);
      const to = scene.boxes.get(c.id);
      if (from && to) {
        const colour = PICTURE_COLOURS[colourKey(c)] || colourKey(c) || '#9a9a9a';
        parts.push(`<path d="${edgePath(shift(from), shift(to), to.way || mode)}" fill="none" stroke="${xmlAttr(colour)}" stroke-width="2"/>`);
      }
      edges(c);
    });
  if (model.root) edges(model.root);
  scene.boxes.forEach((box, id) => {
    const n = model.root && findNode(model, id);
    if (!n || n.virtual) return;
    const [x, y] = at(box.x, box.y);
    const colour = PICTURE_COLOURS[colourKey(n)] || colourKey(n);
    parts.push(`<rect x="${x}" y="${y}" width="${box.width}" height="${box.height}" rx="8" fill="${colour ? xmlAttr(colour) + '22' : '#ffffff'}" stroke="${colour ? xmlAttr(colour) : '#c8c8c8'}"/>`);
    wrapped(nodeLabel(n), box.width).forEach((line, k) => {
      parts.push(`<text x="${x + NODE_PAD.x}" y="${y + NODE_PAD.y + 14 + k * NODE_LINE}" font-family="-apple-system, Segoe UI, sans-serif" font-size="13" fill="#222">${xmlAttr(line)}</text>`);
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${parts.join('')}</svg>\n`;
  return { svg, width, height };
}

function findNode(model, id) {
  let found = null;
  const go = (n) => {
    if (found) return;
    if (n.id === id) found = n;
    else n.children.forEach(go);
  };
  go(model.root);
  (model.free || []).forEach(go);
  return found;
}

/** A one-page PDF of a JPEG picture: the page the picture's size, in points. */
export function pdfFromJpeg(jpeg, width, height) {
  const enc = new TextEncoder();
  const w = Math.round(width * 0.75);
  const h = Math.round(height * 0.75);
  const chunks = [];
  const offsets = [];
  let length = 0;
  const put = (part) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    put(`${n} 0 obj\n${body}\nendobj\n`);
  };
  put('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  put(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  put(jpeg);
  put('\nendstream\nendobj\n');
  const draw = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
  const xref = length;
  put(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  put(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let k = 0;
  chunks.forEach((c) => {
    out.set(c, k);
    k += c.length;
  });
  return out;
}

export class MindMapsImportExport extends MindMapsTemplates {
  /** A map made beside a file, from a model, and opened. */
  async writeImported(model, from, name) {
    const folder = from && from.parent ? from.parent : this.app.vault.getRoot();
    const path = this.plugin.freeChildPath(folder, noteNameFrom(name) || 'Mind map', 'md');
    let file = null;
    try {
      file = await this.app.vault.create(path, writeOutline(model, null, { title: name }));
    } catch (err) {
      console.error('Design Redux: could not make the map', err);
      new Notice('Could not make the map.');
      return null;
    }
    const leaf = this.app.workspace.getLeaf(true);
    if (leaf && file instanceof TFile) await showFileAs(this.app, leaf, MINDMAP_VIEW, file);
    return file;
  }

  /** An OPML or FreeMind file picked from the vault, made a map. */
  chooseImport() {
    const files = this.app.vault.getFiles().filter((f) => f.extension === 'opml' || f.extension === 'mm');
    if (!files.length) {
      new Notice('There are no .opml or .mm files in this vault to make a map of.');
      return;
    }
    new ChoicePicker(this.app, 'Make a mind map of…', files.map((f) => ({ label: f.path, file: f })), (item) => this.importFile(item.file)).open();
  }

  async importFile(file) {
    const text = await this.app.vault.cachedRead(file);
    let model;
    try {
      model = file.extension === 'mm' ? mapFromFreeMind(text, file.basename) : mapFromOpml(text, file.basename);
    } catch (err) {
      new Notice(`${file.name} can’t be read as ${file.extension === 'mm' ? 'a FreeMind map' : 'an OPML outline'}.`);
      return null;
    }
    return this.writeImported(model, file, file.basename);
  }

  async mapHeadings(file) {
    const model = mapFromHeadings(await this.app.vault.cachedRead(file), file.basename);
    if (!model.root.children.length && model.root.virtual) {
      new Notice(`${file.basename} has no headings or list to make a map of.`);
      return null;
    }
    return this.writeImported(model, file, `${file.basename} map`);
  }

  /** The open map written beside it, in a format: 'opml', 'svg', 'png' or 'pdf'. */
  async exportAs(view, kind) {
    if (!view || !view.model || !view.file) return null;
    const folder = view.file.parent || this.app.vault.getRoot();
    const path = this.plugin.freeChildPath(folder, view.file.basename, kind);
    try {
      let file;
      if (kind === 'opml') file = await this.app.vault.create(path, opmlFromMap(view.model, view.file.basename));
      else {
        // Every node, unfolded or not as the map has it, but none left out by a view's filter or a branch alone.
        const scene = layoutScene(view.model, (n) => (typeof view.sizeOf === 'function' ? view.sizeOf(n) : estimateSize(n.text)), view.mode);
        const picture = svgOfMap(view.model, scene, view.mode);
        if (kind === 'svg') file = await this.app.vault.create(path, picture.svg);
        else {
          const bytes = await this.rasterize(picture, kind === 'pdf' ? 'image/jpeg' : 'image/png');
          const data = kind === 'pdf' ? pdfFromJpeg(bytes, picture.width * 2, picture.height * 2) : bytes;
          file = await this.app.vault.createBinary(path, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        }
      }
      new Notice(`Wrote “${file.name}” beside the map.`);
      return file;
    } catch (err) {
      console.error('Design Redux: could not export the map', err);
      new Notice('Could not export the map.');
      return null;
    }
  }

  /** An SVG drawn into an image at twice its size: its bytes. */
  rasterize(picture, type) {
    return new Promise((resolve, reject) => {
      const doc = typeof activeDocument !== 'undefined' ? activeDocument : document;
      const img = new Image();
      const url = URL.createObjectURL(new Blob([picture.svg], { type: 'image/svg+xml' }));
      img.onload = () => {
        const canvas = doc.createElement('canvas');
        canvas.width = picture.width * 2;
        canvas.height = picture.height * 2;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(2, 2);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b))) : reject(new Error('No picture'))), type, 0.92);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('The picture could not be drawn'));
      };
      img.src = url;
    });
  }
}
