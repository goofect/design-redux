/* ------------------------------------------------------------------ */
/* Lists written as text: where each line starts                       */
/*                                                                     */
/* In a list written as text (3.1., i., a.), each line starts under    */
/* the words of the item it belongs to: an item's marker, and the      */
/* words written under it, where its parent's words begin, however     */
/* wide that parent's marker. The parent is the nearest item above     */
/* with less indent, Obsidian's own or one of these. A line belongs to */
/* this layout when it is such an item, under one, or among one's      */
/* siblings; a list of Obsidian's own with none of these is left to    */
/* Obsidian. A place is CSS: pixels measured, Obsidian's list inset    */
/* and its indent counted. Nothing here touches the editor.            */
/* ------------------------------------------------------------------ */

import { around, depth, isMarker, LIST_ITEM } from './list-markers.js';

// An item of Obsidian's own: a dash, a star, a plus, or a number and its stop.
const OWN = /^[ \t]*([-*+]|\d{1,9}[.)])([ \t]+)/;
const lead = (text) => depth(/^[ \t]*/.exec(text)[0]);
const REACH = 400;

/** A place as CSS: pixels, then insets (Obsidian's list inset), then indents (a tab's width). */
export function placeCss(place) {
  return `calc(${Math.round(place.px * 10) / 10}px + ${place.insets} * var(--dr-inset) + ${place.indents} * var(--list-indent))`;
}

export class OutlineLayout {
  /** `lineOf(i)` a line (from 0), `count` how many, `width(text)` text's width in the editor's font. */
  constructor(lineOf, count, width) {
    this.lineOf = lineOf;
    this.count = count;
    this.width = width;
    this.kinds = new Map();
    this.parents = new Map();
    this.typedUnder = new Map();
    this.places = new Map();
  }

  /** What line `n` is: { kind: 'typed' | 'own' | 'words' | 'blank', head } (head: the marker as drawn, its stop and the space after). */
  kind(n) {
    if (this.kinds.has(n)) return this.kinds.get(n);
    const line = this.lineOf(n);
    let k = { kind: 'words', head: '' };
    if (!line.trim()) k = { kind: 'blank', head: '' };
    else {
      const m = LIST_ITEM.exec(line);
      const near = m ? around({ getLine: this.lineOf }, n, depth(m[1])) : null;
      if (m && isMarker(m[2], near.sibling, m[3], near.parent)) k = { kind: 'typed', head: `${m[2]}${m[3]}${m[4]}` };
      else {
        const o = OWN.exec(line);
        if (o) k = { kind: 'own', head: `${o[1]}${o[2]}` };
      }
    }
    this.kinds.set(n, k);
    return k;
  }

  isItem(n) {
    const k = this.kind(n).kind;
    return k === 'typed' || k === 'own';
  }

  /** The item line `n` belongs to: the nearest item above with less indent, past the words of items between; -1 at the margin. */
  parent(n) {
    if (this.parents.has(n)) return this.parents.get(n);
    const d = lead(this.lineOf(n));
    let found = -1;
    for (let i = n - 1; d > 0 && i >= 0 && n - i <= REACH; i--) {
      const line = this.lineOf(i);
      if (!line.trim()) continue;
      const di = lead(line);
      if (di >= d) continue;
      if (this.isItem(i)) {
        found = i;
        break;
      }
      if (!di) break;
    }
    this.parents.set(n, found);
    return found;
  }

  /** Whether an item has one of these lists among what is under it. */
  hasTyped(p) {
    if (this.typedUnder.has(p)) return this.typedUnder.get(p);
    const d = lead(this.lineOf(p));
    let found = false;
    for (let i = p + 1; i < this.count && i - p <= REACH; i++) {
      const line = this.lineOf(i);
      if (!line.trim()) continue;
      if (lead(line) <= d) break;
      if (this.kind(i).kind === 'typed') {
        found = true;
        break;
      }
    }
    this.typedUnder.set(p, found);
    return found;
  }

  /** Whether line `n` is laid out here: indented, and one of these items, under one, or under an item that has one. */
  ours(n) {
    if (!lead(this.lineOf(n)) || this.kind(n).kind === 'blank') return false;
    const p = this.parent(n);
    if (p < 0) return false;
    return this.kind(n).kind === 'typed' || this.kind(p).kind === 'typed' || this.hasTyped(p);
  }

  /**
   * Where line `n` starts: for a line laid out here, its parent's words (an
   * item's marker box one inset earlier, since Obsidian's inset is inside it,
   * so its number stands right under them); otherwise where its indent puts it.
   */
  start(n) {
    if (this.places.has(n)) return this.places.get(n).start;
    const p = this.ours(n) ? this.parent(n) : -1;
    let start = { px: 0, insets: 0, indents: Math.round(lead(this.lineOf(n)) / 4) };
    if (p >= 0) {
      const under = this.words(p);
      start = this.isItem(n) ? { ...under, insets: under.insets - 1 } : under;
    }
    this.places.set(n, { start });
    return start;
  }

  /** Where line `n`'s words start: after its marker (and Obsidian's inset before it), for an item; where it starts, for words. */
  words(n) {
    const start = this.start(n);
    const k = this.kind(n);
    if (k.kind !== 'typed' && k.kind !== 'own') return start;
    return { px: start.px + this.width(k.head), insets: start.insets + 1, indents: start.indents };
  }

  /** The items line `n` is under, outermost first: where an indentation guide stands for each. */
  ancestors(n) {
    const out = [];
    for (let p = this.parent(n); p >= 0; p = this.parent(p)) out.unshift(p);
    return out;
  }

  /**
   * The items both the line above a blank line and the line below it are in, outermost first:
   * none when the blank line is not inside a list laid out here.
   */
  blankAncestors(n) {
    let p = n - 1;
    while (p >= 0 && n - p < REACH && this.kind(p).kind === 'blank') p--;
    let q = n + 1;
    while (q < this.count && q - n < REACH && this.kind(q).kind === 'blank') q++;
    if (p < 0 || q >= this.count || this.kind(p).kind === 'blank' || this.kind(q).kind === 'blank' || !this.ours(p) || !this.ours(q)) return [];
    const chain = (x) => this.ancestors(x).concat(this.isItem(x) ? [x] : []);
    const [above, below] = [chain(p), chain(q)];
    const out = [];
    for (let i = 0; i < Math.min(above.length, below.length) && above[i] === below[i]; i++) out.push(above[i]);
    return out;
  }
}
