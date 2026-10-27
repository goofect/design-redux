#!/usr/bin/env node
// Compares two folders of UI snapshots (the PNGs the real-Obsidian tests
// save to ci-output/snapshots/) and says what changed.
//
//   node tools/snapshot-diff.mjs <before-dir> <after-dir> [--out <dir>]
//
// A line for each snapshot: unchanged, changed (with the share of pixels
// that moved and where), new, gone, or resized. With --out, an image for
// each changed one: the new snapshot greyed, the changed pixels in red,
// and summary.txt with the lines. A pixel counts as changed when a channel
// moves by more than 24, so text antialiasing alone doesn't. It reports,
// never fails: whether a change was meant is for the reviewer.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const TOLERANCE = 24;

/** An 8-bit, non-interlaced PNG (what Chromium saves), as RGBA pixels. */
export function readPng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let at = 8;
  let width = 0;
  let height = 0;
  let type = 0;
  const data = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const name = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (name === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      type = body[9];
      if (body[8] !== 8 || body[12] !== 0 || (type !== 2 && type !== 6)) throw new Error('only 8-bit RGB or RGBA, not interlaced');
    } else if (name === 'IDAT') data.push(body);
    else if (name === 'IEND') break;
    at += 12 + length;
  }
  const channels = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      line.copy(out, o, x * channels, x * channels + 3);
      out[o + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev = line;
  }
  return { width, height, pixels: out };
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(name, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(name, 4, 'ascii');
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([head.subarray(4), body])) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
}

/** RGBA pixels as a PNG. */
export function writePng({ width, height, pixels }) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([SIGNATURE, chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Two images of one size compared: how many pixels changed, the box around them, and the picture of it. */
export function compare(before, after) {
  const { width, height } = after;
  const marked = Buffer.alloc(width * height * 4);
  let changed = 0;
  const box = { left: width, top: height, right: -1, bottom: -1 };
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    let moved = false;
    for (let k = 0; k < 4; k++) if (Math.abs(before.pixels[o + k] - after.pixels[o + k]) > TOLERANCE) moved = true;
    if (moved) {
      changed++;
      const x = i % width;
      const y = Math.floor(i / width);
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x);
      box.bottom = Math.max(box.bottom, y);
      marked.set([230, 30, 30, 255], o);
    } else {
      const grey = Math.round((after.pixels[o] + after.pixels[o + 1] + after.pixels[o + 2]) / 3 / 3 + 170);
      marked.set([grey, grey, grey, 255], o);
    }
  }
  return { changed, share: changed / (width * height), box: changed ? box : null, image: { width, height, pixels: marked } };
}

/** A line for each snapshot in either folder, and the pictures of the changes. */
export function diffFolders(beforeDir, afterDir) {
  const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png')) : []);
  const names = Array.from(new Set([...list(beforeDir), ...list(afterDir)])).sort();
  const lines = [];
  const pictures = [];
  names.forEach((name) => {
    const was = path.join(beforeDir, name);
    const now = path.join(afterDir, name);
    const label = name.replace(/\.png$/, '');
    if (!fs.existsSync(was)) return lines.push(`new        ${label}`);
    if (!fs.existsSync(now)) return lines.push(`gone       ${label}`);
    const a = readPng(fs.readFileSync(was));
    const b = readPng(fs.readFileSync(now));
    if (a.width !== b.width || a.height !== b.height) return lines.push(`resized    ${label}: ${a.width}×${a.height} → ${b.width}×${b.height}`);
    const result = compare(a, b);
    if (!result.changed) return lines.push(`unchanged  ${label}`);
    const { left, top, right, bottom } = result.box;
    lines.push(`changed    ${label}: ${(result.share * 100).toFixed(2)}% of pixels, within x ${left}–${right}, y ${top}–${bottom}`);
    pictures.push({ name: `${label}.diff.png`, image: result.image });
  });
  return { lines, pictures };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt === -1 ? null : args[outAt + 1];
  const [beforeDir, afterDir] = outAt === -1 ? args : args.filter((_, i) => i !== outAt && i !== outAt + 1);
  if (!beforeDir || !afterDir) {
    console.error('usage: node tools/snapshot-diff.mjs <before-dir> <after-dir> [--out <dir>]');
    process.exit(2);
  }
  const { lines, pictures } = diffFolders(beforeDir, afterDir);
  const text = lines.length ? lines.join('\n') : 'no snapshots';
  console.log(text);
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    pictures.forEach((p) => fs.writeFileSync(path.join(out, p.name), writePng(p.image)));
    fs.writeFileSync(path.join(out, 'summary.txt'), text + '\n');
  }
}
