/* ------------------------------------------------------------------ */
/* Numbering: how a note's numbered lists read                         */
/*                                                                     */
/* The lists are Obsidian's own: 1. items, nested by indent. Obsidian  */
/* does all a list does with them (Enter, Tab, the numbers kept in     */
/* order, folding, collapsing, moving), and other apps read them as    */
/* lists. A note says how they read with a property, `numbering`:      */
/* "1.1" an outline (1., 1.1., 1.1.1.), or a style a level, "1 a i"    */
/* (numbers, letters under them, numerals under those; 1 a A i I).     */
/* An item's label is worked out from the numbers Obsidian keeps: its  */
/* own and those of the numbered items it is in. Nothing here is       */
/* drawn; the editor and reading view draw the labels.                 */
/* ------------------------------------------------------------------ */

import { depth, toLetters, toRoman } from './list-markers.js';

/** The property a note says its numbering with. */
export const NUMBERING = 'numbering';

/** A numbered item of Obsidian's: its indent, its number and its stop. */
export const ORDERED = /^([ \t]*)(\d{1,9})([.)])(?=[ \t]|$)/;

const STYLES = /^[\s,;/]*(?:[1aAiI][\s,;/]*)+$/;

/** A property's value as a numbering, { outline } or { styles: ['1', 'a', 'i'] }; null for Obsidian's own 1., 1., 1. */
export function parseNumbering(value) {
  const text = (Array.isArray(value) ? value.join(' ') : value == null ? '' : String(value)).trim();
  if (/^(1\.1|outline)$/i.test(text)) return { outline: true, styles: [] };
  if (!STYLES.test(text)) return null;
  const styles = text.match(/[1aAiI]/g);
  return styles.every((s) => s === '1') ? null : { outline: false, styles };
}

/** A numbering as the property writes it. */
export function numberingText(numbering) {
  return numbering.outline ? '1.1' : numbering.styles.join(' ');
}

/** An item's label: `path` is the numbers from the outermost numbered item it is in down to its own. */
export function labelOf(numbering, path, stop = '.') {
  if (numbering.outline) return `${path.join('.')}${stop}`;
  const level = path.length - 1;
  const style = numbering.styles[level % numbering.styles.length];
  const n = path[level];
  const text = style === '1' ? String(n) : /a/i.test(style) ? toLetters(n) : toRoman(n);
  return `${style === style.toUpperCase() && style !== '1' ? text.toUpperCase() : text}${stop}`;
}

/**
 * The numbers of the item on line `n` and of the numbered items it is in,
 * outermost first, read from the lines above; null when the line is no
 * numbered item. A bullet above it, or words at the margin, start its
 * numbering afresh. `getLine(i)` gives a line.
 */
export function pathAt(getLine, n, reach = 500) {
  const m = ORDERED.exec(getLine(n));
  if (!m) return null;
  const path = [Number(m[2])];
  let d = depth(m[1]);
  for (let i = n - 1; i >= 0 && d > 0 && n - i <= reach; i--) {
    const line = getLine(i);
    if (!line.trim()) continue;
    const ws = depth(/^[ \t]*/.exec(line)[0]);
    if (ws >= d) continue;
    const o = ORDERED.exec(line);
    if (o) {
      path.unshift(Number(o[2]));
      d = ws;
    } else if (!ws || /^[ \t]*[-*+][ \t]/.test(line)) {
      break;
    }
    // An indented line with no number is more of an item above: read on past it.
  }
  return path;
}

/**
 * Lines made one of Obsidian's numbered lists, nested by their indent (or,
 * for a number written as an outline, 1.2.1., by how deep it says it is),
 * any marker they had giving way. `unit` is one indent.
 */
export function toRealList(lines, unit = '\t', tab = 4) {
  const counts = [];
  return lines.map((line) => {
    if (!line.trim()) return line;
    const m = /^([ \t]*)(?:[-*+]|(\d+(?:\.\d+)*)[.)]?(?=[ \t])|[a-z]+[.)](?=[ \t]))?[ \t]*(.*)$/i.exec(line);
    const level = m[2] && m[2].includes('.') ? m[2].split('.').length - 1 : Math.round(depth(m[1]) / tab);
    counts.length = level + 1;
    counts[level] = (counts[level] || 0) + 1;
    return `${unit.repeat(level)}${counts[level]}. ${m[3]}`;
  });
}

/**
 * Reading view: each item of the numbered lists Obsidian rendered gets its
 * label, which the styles show in the place of the number; a list's room
 * for its widest label is set on it.
 */
export function numberRendered(root, numbering) {
  const ordinal = (li) => {
    const list = li.parentElement;
    const items = Array.from(list.children).filter((c) => c.tagName === 'LI');
    return (Number(list.getAttribute('start')) || 1) + items.indexOf(li);
  };
  const lists = new Set();
  root.querySelectorAll('ol > li').forEach((li) => {
    const path = [];
    for (let item = li; item && item.parentElement && item.parentElement.tagName === 'OL'; item = item.parentElement.parentElement && item.parentElement.parentElement.closest('li')) {
      path.unshift(ordinal(item));
    }
    li.dataset.drNumber = labelOf(numbering, path);
    li.classList.add('dr-numbered');
    li.classList.toggle('dr-numbered-in', path.length > 1);
    lists.add(li.parentElement);
  });
  lists.forEach((list) => {
    list.classList.add('dr-numbered-list');
    const widest = Math.max(...Array.from(list.querySelectorAll(':scope > .dr-numbered')).map((li) => li.dataset.drNumber.length));
    list.style.setProperty('--dr-marker', `${widest + 1}ch`);
  });
}
