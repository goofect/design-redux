// The specimen's second half: every component in every state, then the library built from them.
import { glyph, esc, attrs, iconButton, shown, component, section } from './kit.mjs';
import { folders, logic, OPEN, headings, subfolders, size, lengths, properties } from './data.mjs';

const pad = (n) => String(n).padStart(2, '0');
const mins = (words) => `${Math.max(1, Math.round(words / 250))} min`;
const button = (text, a = {}) => `<div class="dr-button ${a.class || ''}" role="button" tabindex="0"${attrs({ ...a, class: false })}>${text}</div>`;
const LEVELS = [['zoom-objects', 'Objects'], ['zoom-shelves', 'Shelves'], ['zoom-words', 'Words']];
const zoom = (on, extra = {}) => `<div class="dr-segments" role="radiogroup" aria-label="Level of detail">${LEVELS.map(([g, label], i) => `<div class="dr-segment ${extra[i]?.class || ''}" role="radio" tabindex="${i === on ? 0 : -1}" aria-checked="${i === on}" aria-label="${label}"${attrs({ ...extra[i], class: false })}>${glyph(g)}</div>`).join('')}</div>`;
const tabs = (names, on, extra = {}) => `<div class="dr-segments dr-tabs" role="tablist">${names.map((n, i) => `<div class="dr-segment dr-label ${extra[i]?.class || ''}" role="tab" tabindex="${i === on ? 0 : -1}" aria-selected="${i === on}"${attrs({ ...extra[i], class: false })}>${n}</div>`).join('')}</div>`;
const toggle = (cls = '') => `<div class="checkbox-container ${cls}"><input type="checkbox" tabindex="0"></div>`;
const field = (label, inner, note = '', a = {}) => `<div class="dr-field"${attrs(a)}><span class="dr-label">${label}</span><div class="dr-field-box ${a.box || ''}">${inner}</div>${note ? `<span class="dr-field-note dr-text">${note}</span>` : ''}</div>`;
const input = (value, placeholder = '', a = {}) => `<input class="dr-input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"${attrs(a)}>`;
const chip = (key, value, a = {}) => `<span class="dr-chip ${a.class || ''}"${attrs({ ...a, class: false })}>${key ? `<span class="dr-label">${key}</span>` : ''}<span class="dr-text">${value}</span></span>`;

export function controls() {
  return section('controls', 'Controls', 'Bare: no frame, no line in any state but the focus ring. Ash is the pointer and the press, the ring is the keyboard, clay is on, muted words are disabled.', [
    component('Icon button', 'A control. Four units square, the glyph two; its word is its tooltip and its aria-label.', [
      shown('rest', iconButton('pin', 'Pin')), shown('hover · ash', iconButton('pin', 'Pin', { class: 'spec-hover' })),
      shown('pressed · ash', iconButton('pin', 'Pin', { class: 'spec-active' })), shown('focus · ring', iconButton('pin', 'Pin', { class: 'spec-focus' })),
      shown('on · clay', iconButton('pin', 'Unpin', { 'aria-pressed': 'true' })), shown('disabled · quiet', iconButton('next-note', 'Next note', { 'aria-disabled': 'true' })),
      shown('loading · the glass', iconButton('wait', 'Working', { 'aria-busy': 'true' })),
    ]),
    component('Text button', 'Only where a glyph would not say it: a confirmation, a first choice.', [
      shown('rest', button('Cancel')), shown('hover', button('Cancel', { class: 'spec-hover' })), shown('pressed', button('Cancel', { class: 'spec-active' })),
      shown('focus', button('Cancel', { class: 'spec-focus' })), shown('proposed · ink', button('Move 12 notes', { class: 'is-primary' })),
      shown('destroys · rust line, its word', button('Delete folder', { class: 'is-danger' })), shown('disabled · dashed', button('Move', { 'aria-disabled': 'true' })),
      shown('loading', button(`${glyph('wait')}Moving…`, { 'aria-busy': 'true' })),
    ]),
    component('Zoom control', 'Objects, shelves, words: the same place at three levels of detail. Three bare glyphs; the level shown on a clay square.', [
      shown('objects shown', zoom(0)), shown('shelves shown', zoom(1)), shown('words shown', zoom(2)),
      shown('hover on shelves', zoom(0, { 1: { class: 'spec-hover' } })), shown('focus on the level shown', zoom(1, { 1: { class: 'spec-focus' } })),
      shown('a level not to be had', zoom(0, { 2: { 'aria-disabled': 'true' } })),
    ]),
    component('Tabs', "A note's pages. Bare words; the open page on a clay fill, bold. Many scroll a whole tab at a time, an ellipsis at the edge where more are.", [
      shown('first page open', tabs(['Notes', 'Proofs', 'Exercises'], 0)), shown('hover on another', tabs(['Notes', 'Proofs', 'Exercises'], 0, { 2: { class: 'spec-hover' } })),
      shown('focus', tabs(['Notes', 'Proofs', 'Exercises'], 1, { 1: { class: 'spec-focus' } })), shown('one disabled', tabs(['Notes', 'Proofs', 'Locked'], 0, { 2: { 'aria-disabled': 'true' } })),
      // As the script leaves them at the start of the row: the tabs that fit whole, the next not drawn, the ellipsis at the edge.
      shown('many: whole tabs, an ellipsis at the edge', `<div style="width:232px">${tabs(['Notes', 'Proofs', 'Exercises', 'Sources', 'Scraps'], 0, { 2: { class: 'is-cut' }, 3: { class: 'is-cut' }, 4: { class: 'is-cut' } }).replace('dr-tabs"', 'dr-tabs is-more-after"')}</div>`),
    ]),
    component('Toggle', "Obsidian's own, restyled. The ink square stands on the side that is true.", [
      shown('off', toggle()), shown('on · clay, square at the end', toggle('is-enabled')), shown('focus', toggle('spec-focus')),
      shown('disabled, off', toggle('is-disabled')), shown('disabled, on', toggle('is-enabled is-disabled')),
    ]),
    component('Field', 'A label over a square box. The box carries the border and the ring.', [
      shown('empty', field('Name', input('', 'Untitled'))), shown('filled', field('Name', input('Problem set 4'))),
      shown('focus', field('Name', input('Problem set 4'), '', { box: 'spec-focus' })), shown('search', field('Find', `${glyph('search')}${input('', 'Notes and folders')}`)),
      shown('loading', field('Find', `${glyph('search')}${input('deduc')}${glyph('wait')}`, 'Looking…')),
      shown('wrong · rust line, glyph, reason', field('Name', `${input('Logic/Week: 6')}${glyph('alert')}`, 'A name can’t hold a colon.', { 'aria-invalid': 'true' })),
      shown('disabled · dashed', field('Name', input('Truth tables', '', { disabled: true }), '', { 'aria-disabled': 'true' })),
    ]),
    component('Chip', "Plain words, no box: a filter's part that takes itself off, or a filter that can be on.", [
      shown('a filter’s part', `<span class="dr-chip" role="button" tabindex="0" aria-label="Take off: in Logic"><span class="dr-label">In</span><span class="dr-text">Logic</span>${glyph('close')}</span>`), shown('a value alone', chip('', 'Logic')),
      shown('a filter', chip('', 'Unread', { role: 'checkbox', tabindex: 0, 'aria-checked': 'false' })), shown('hover', chip('', 'Unread', { role: 'checkbox', class: 'spec-hover', 'aria-checked': 'false' })),
      shown('focus', chip('', 'Unread', { role: 'checkbox', class: 'spec-focus', 'aria-checked': 'false' })), shown('on · clay', chip('', 'Unread', { role: 'checkbox', 'aria-checked': 'true' })),
      shown('disabled', chip('Week', '6', { 'aria-disabled': 'true' })), shown('wrong', chip('Week', 'six', { 'aria-invalid': 'true' })),
    ]),
  ].join(''));
}

// ---- Lists ----

const face = (faces, f) => faces[f.path];
export const cell = (faces, f, a = {}) => `<div class="dr-cell ${a.class || ''}" role="button" tabindex="0" aria-label="${esc(f.name)}, ${f.count} notes"${attrs({ ...a, class: false, inner: false })}>${a.inner || glyph(face(faces, f))}<span class="dr-cell-label dr-label"><span class="dr-cell-name dr-clip">${esc(f.name)}</span><span class="dr-cell-count">${f.count}</span></span></div>`;
export const noteCell = (n, a = {}) => `<div class="dr-cell" role="button" tabindex="0" aria-label="${esc(n.title)}"${attrs(a)}>${glyph('note')}<span class="dr-cell-label dr-label"><span class="dr-cell-name dr-clip">${esc(n.title)}</span></span></div>`;
export const row = (n, a = {}) => `<div class="dr-row${a.plain ? '' : ' is-numbered'} ${a.class || ''}" role="button" tabindex="0"${attrs({ ...a, class: false, end: false, plain: false })}>${a.plain ? '' : `<span class="dr-slot dr-label"><span>${pad(n.number)}</span></span>`}<span class="dr-row-name dr-text dr-clip">${esc(n.title)}</span><span class="dr-row-end dr-label">${a.end || mins(n.words)}</span></div>`;
const bar = (s, a = {}) => `<span class="dr-bar ${a.class || ''}" style="--dr-size:${s}" role="button" tabindex="-1"${attrs({ ...a, class: false })}></span>`;
export const shelf = (f, sizes, marks = {}, headAttrs = {}) => `<div class="dr-shelf"><div class="dr-shelf-head" role="button" tabindex="0"${attrs(headAttrs)}><span class="dr-label dr-clip">${esc(f.name)}</span><span class="dr-shelf-count dr-label">${f.count}</span></div><div class="dr-shelf-bars">${sizes.map((s, i) => bar(s, marks[i] || {})).join('')}</div></div>`;
export const outlineFolder = (f, open) => `<div class="dr-outline-folder" role="button" tabindex="0" aria-expanded="${open}"><span class="dr-slot">${glyph(open ? 'down' : 'next')}</span><span class="dr-label dr-clip">${esc(f.name)}</span><span class="dr-row-end dr-label">${f.count}</span></div>`;
const child = (text, a = {}) => `<div class="dr-row is-child" role="button" tabindex="-1"${attrs(a)}><span class="dr-row-name dr-text dr-clip">${esc(text)}</span></div>`;
const prop = (key, value, a = {}) => `<div class="dr-prop ${a.class || ''}" tabindex="0"${attrs({ ...a, class: false, end: false })}><span class="dr-label dr-clip">${key}</span><span class="dr-prop-value dr-text dr-clip">${value}</span>${a.end || ''}</div>`;
const cover = (tone) => `<img class="dr-cell-cover" alt="" src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80"><rect width="60" height="80" fill="${tone}"/><rect x="12" y="16" width="36" height="4" fill="#E9E6DF"/><rect x="12" y="26" width="24" height="4" fill="#E9E6DF"/></svg>`)}">`;

export function lists(faces) {
  const f = folders[2];
  const n = logic[4];
  const box = (html, w = 96, labelled = true) => `<div class="dr-grid spec-one${labelled ? ' is-labelled' : ''}" style="--dr-cell:${w}px">${html}</div>`;
  const rows = (html) => `<div class="dr-rows spec-rows">${html}</div>`;
  const sizes = logic.slice(0, 12).map((x) => size(x.words));
  return section('lists', 'Objects, rows, bars', 'The same folder and note at three levels of detail. Clay is never alone: a name appears, a mark stands in the slot, the words turn bold.', [
    component('Object cell', 'A folder as a glyph on the ground: no frame, its name under it on one line. Its name is always its aria-label.', [
      shown('rest · its name', box(cell(faces, f))), shown('hover · ash, the count', box(cell(faces, f, { class: 'spec-hover' }))),
      shown('focus · ring, the count', box(cell(faces, f, { class: 'spec-focus' }))), shown('picked · clay, the count', box(cell(faces, f, { 'aria-selected': 'true' }))),
      shown('open in the page · mark, bold', box(cell(faces, f, { 'aria-current': 'true' }))), shown('labels off · no words at rest', box(cell(faces, f), 96, false)),
      shown("the person's own cover", box(cell(faces, f, { inner: cover('#8A3F2C') }))), shown('disabled · quiet', box(cell(faces, f, { 'aria-disabled': 'true' }))),
      shown('wrong · alert in the corner, the reason in its tooltip', box(cell(faces, f, { inner: `${glyph(face(faces, f))}<span class="dr-cell-flag">${glyph('alert')}</span>` }))),
    ]),
    component('Row', 'A note in a list: its number in the slot, its name, what trails. No line between rows: their height parts them.', [
      shown('rest', rows(row(n))), shown('hover · ash', rows(row(n, { class: 'spec-hover' }))), shown('focus · ring inside', rows(row(n, { class: 'spec-focus' }))),
      shown('selected · clay, hollow mark', rows(row(n, { 'aria-selected': 'true' }))), shown('open · clay, solid mark, bold', rows(row(n, { 'aria-current': 'page' }))),
      shown('disabled · quiet', rows(row(n, { 'aria-disabled': 'true' }))), shown('not written yet · dashed line', rows(row({ ...n, title: 'Modal logic' }, { class: 'is-missing', end: '—' }))),
      shown('wrong · alert, a word', rows(row(n, { class: 'is-error', end: `${glyph('alert')}unreadable` }))),
    ]),
    component('Shelf', "A folder as a row of bars: one a note, as tall as the note is long, standing on a hairline.", [
      shown('rest', `<div class="spec-shelf">${shelf(f, sizes)}</div>`), shown('hover on a note · ink bar on ash', `<div class="spec-shelf">${shelf(f, sizes, { 3: { class: 'spec-hover' } })}</div>`),
      shown('focus on a note', `<div class="spec-shelf">${shelf(f, sizes, { 6: { class: 'spec-focus' } })}</div>`), shown('a note selected · clay behind, hollow mark', `<div class="spec-shelf">${shelf(f, sizes, { 2: { 'aria-selected': 'true' } })}</div>`),
      shown('the open note · clay behind, mark under the line', `<div class="spec-shelf">${shelf(f, sizes, { 4: { 'aria-current': 'page' } })}</div>`),
      shown('the folder open in the page', `<div class="spec-shelf">${shelf(f, sizes, {}, { 'aria-current': 'true' })}</div>`),
      shown('empty', `<div class="spec-shelf">${shelf({ name: 'Drafts', count: 0 }, [])}</div>`),
    ]),
    component('Outline row', 'Words: folders as labels, notes as numbered rows with no rules, the open note’s headings under it.', [
      shown('a folder, closed', `<div class="dr-outline spec-rows">${outlineFolder(folders[0], false)}</div>`), shown('hover', `<div class="dr-outline spec-rows">${outlineFolder(folders[0], false).replace('dr-outline-folder', 'dr-outline-folder spec-hover')}</div>`),
      shown('a folder, open, its notes', `<div class="dr-outline spec-rows">${outlineFolder(f, true)}${row(logic[3])}${row(n, { 'aria-current': 'page' })}${child(headings[0])}${child(headings[1], { 'aria-current': 'location' })}${child(headings[2])}${row(logic[5])}</div>`),
    ]),
    component('Panel row', "A property: its name in the label voice, muted, its value beside it in the reading voice. A section's title over its rows, no line under it; a press on a group's title folds it.", [
      shown('a section', `<div class="spec-rows"><div class="dr-section"><span class="dr-label" role="button" tabindex="0" aria-expanded="true">General</span>${iconButton('plus', 'Add a property')}${iconButton('more', 'More')}</div>${prop('Status', 'Draft')}${prop('Course', 'Logic')}</div>`),
      shown('a group folded', `<div class="spec-rows"><div class="dr-section"><span class="dr-label" role="button" tabindex="0" aria-expanded="false">Relationships · 2</span></div></div>`),
      shown('hover', `<div class="spec-rows spec-top">${prop('Status', 'Draft', { class: 'spec-hover' })}</div>`), shown('focus', `<div class="spec-rows spec-top">${prop('Status', 'Draft', { class: 'spec-focus' })}</div>`),
      shown('selected', `<div class="spec-rows spec-top">${prop('Status', 'Draft', { 'aria-selected': 'true' })}</div>`), shown('no value · a dash', `<div class="spec-rows spec-top">${prop('Sources', '—', { class: 'is-empty' })}</div>`),
      shown('wrong · alert, rust words', `<div class="spec-rows spec-top">${prop('Week', 'six', { 'aria-invalid': 'true', end: glyph('alert') })}</div>`), shown('disabled', `<div class="spec-rows spec-top">${prop('Created', '3 October', { 'aria-disabled': 'true' })}</div>`),
    ]),
  ].join(''));
}

// ---- Table and blocks ----

const table = (body, sorted = true) => `<table class="dr-table"><thead><tr><th scope="col"${sorted ? ' aria-sort="ascending"' : ''}><span class="dr-th"><span>Name</span>${sorted ? glyph('up') : ''}</span></th><th scope="col"><span class="dr-th"><span>Status</span></span></th><th scope="col" class="is-number"><span class="dr-th"><span>Words</span></span></th></tr></thead><tbody>${body}</tbody></table>`;
const tr = (n, status, a = {}) => `<tr${attrs({ ...a, bad: false })}><td><span class="dr-cell-text">${esc(n.title)}</span></td><td${a.bad ? ' aria-invalid="true"' : ''}><span class="dr-cell-text">${status}</span></td><td class="is-number"><span class="dr-cell-text">${n.words.toLocaleString('en')}</span></td></tr>`;
const menuItem = (g, title, cls = '', sub = false) => `<div class="menu-item ${cls}"><div class="menu-item-icon">${glyph(g)}</div><div class="menu-item-title">${title}</div>${sub ? `<div class="menu-item-icon">${glyph('next')}</div>` : ''}</div>`;
const state = (g, label, text, extra = '', cls = '') => `<div class="dr-state ${cls}">${glyph(g)}<span class="dr-label">${label}</span>${text ? `<span class="dr-text is-running">${text}</span>` : ''}${extra}</div>`;
export const strip = (f, n, faces, a = {}) => `<div class="dr-strip">${glyph(f ? face(faces, f) : 'note')}<div class="dr-strip-words"><span class="dr-strip-title dr-text dr-clip">${esc(n.title)}</span><span class="dr-strip-place dr-label dr-clip">${f ? `${esc(f.name)} · ${n.number} of ${f.count}` : 'No folder'}</span></div>${iconButton('previous-note', 'Previous note', a.first || !f ? { 'aria-disabled': 'true' } : {})}${iconButton('next-note', 'Next note', f ? {} : { 'aria-disabled': 'true' })}${iconButton('more', 'More')}</div>`;

export function blocks(faces) {
  const f = folders[2];
  const body = tr(logic[2], 'Done') + tr(logic[3], 'Done', { class: 'spec-hover' }) + tr(logic[4], 'Draft', { 'aria-current': 'page' }) + tr(logic[5], 'Draft', { 'aria-selected': 'true' }) + tr(logic[6], 'drafft', { bad: true }) + tr(logic[7], 'To write', { 'aria-disabled': 'true' });
  const sheet = (title, text, inner, actions) => `<div class="modal"><div class="modal-close-button">${iconButton('close', 'Close')}</div><div class="modal-title">${title}</div><div class="modal-content"><div class="dr dr-sheet"><p class="dr-text is-running">${text}</p>${inner}<div class="dr-sheet-actions">${actions}</div></div></div></div>`;
  return section('blocks', 'Table, strip, menu, sheet, say-so', 'The larger pieces, built from the ones above.', [
    component('Table', 'A line under the header, none between columns or rows; columns as wide as what they hold; the arrow beside the name of the column it is sorted by. Numbers only where the folder has its own order. Rows: rest, hover, open, selected, a value that is wrong, disabled.', [
      shown('', `<div style="width:560px">${table(body)}</div>`),
      shown('empty', `<div style="width:320px">${table(`<tr><td colspan="3">${state('empty', 'No notes', '').replace('dr-state', 'dr-state spec-tight')}</td></tr>`, false)}</div>`),
    ]),
    component('Strip', 'Across the foot of the note: the folder, the note, its place, and on. Nothing floats, nothing waits for the pointer.', [
      shown('rest', `<div style="width:560px">${strip(f, logic[4], faces)}</div>`), shown('at the first note · back is quiet', `<div style="width:400px">${strip(f, logic[0], faces, { first: true })}</div>`),
      shown('a note in no folder', `<div style="width:320px">${strip(null, { title: 'Shopping list' }, faces)}</div>`),
    ]),
    component('Menu', "Obsidian's own, restyled: rows of four units; the item under the pointer or the keys in clay with a line round it.", [
      shown('rest, selected, disabled, a submenu, one that destroys', `<div class="menu"><div class="menu-scroll">${menuItem('open', 'Open')}${menuItem('note-new', 'New note here', 'selected')}${menuItem('pin', 'Pin')}${menuItem('move', 'Move to…', 'is-disabled')}<div class="menu-separator"></div>${menuItem('sort', 'Sort by', '', true)}${menuItem('shapes', 'Glyph…')}<div class="menu-separator"></div>${menuItem('trash', 'Delete folder', 'is-warning')}</div></div>`),
    ]),
    component('Sheet', "What the plugin puts in one of Obsidian's modals: a title, the matter, the buttons at the foot.", [
      shown('a question', sheet('Move 12 notes to Archive', 'Links to them are rewritten. Undo puts them back.', field('Into', input('Archive/2026')), button('Cancel') + button('Move 12 notes', { class: 'is-primary' }))),
      shown('one that destroys', sheet('Delete Seminar', 'The folder and its 14 notes go to the system bin.', '', button('Cancel') + button('Delete folder', { class: 'is-danger' }))),
    ]),
    component('Say-so', 'What a surface shows in place of its contents: a glyph, a label, a line if it helps, one button at most.', [
      shown('empty', state('empty', 'No notes yet', 'A folder’s notes are listed here.', button('New note'))), shown('loading', state('wait', 'Reading the vault', '')),
      shown('wrong', state('alert', 'Couldn’t read Logic', 'The folder was moved or renamed outside Obsidian.', button('Look again'), 'is-error')),
    ]),
  ].join(''));
}

// ---- The library ----

const head = (label, level, back = false) => `<div class="dr-head">${back ? iconButton('back', 'Back') : ''}<span class="dr-label dr-clip">${label}</span>${iconButton('search', 'Search')}${zoom(level)}</div>`;
const sidebar = (caption, width, inner, height = 720) => `<figure class="spec-shown"><div class="spec-sidebar" style="width:${width}px;height:${height}px"><div class="dr dr-library">${inner}</div></div><figcaption class="dr-label dr-muted">${caption}</figcaption></figure>`;
const body = (html) => `<div class="dr-library-body">${html}</div>`;

export function library(faces, facesIn) {
  const picked = 'Logic';
  const grid = (extra = 'is-labelled', pick = picked) => `<div class="dr-grid ${extra}" role="list">${folders.map((f) => cell(faces, f, f.name === pick ? { 'aria-selected': 'true' } : {})).join('')}</div>`;
  const openAt = logic.findIndex((n) => n.title === OPEN);
  const shelves = `<div class="dr-shelves">${folders.slice(0, 7).map((f) => (f.name === 'Logic' ? shelf(f, logic.map((n) => size(n.words)), { [openAt]: { 'aria-current': 'page' } }) : shelf(f, lengths(f.name, f.count)))).join('')}</div>`;
  const words = `<div class="dr-outline">${folders.map((f) => (f.name !== 'Logic' ? outlineFolder(f, false) : outlineFolder(f, true) + logic.map((n) => (n.title === OPEN ? row(n, { 'aria-current': 'page' }) + headings.map((h, i) => child(h, i === 1 ? { 'aria-current': 'location' } : {})).join('') : row(n))).join(''))).join('')}</div>`;
  const f = folders[2];
  const detail = `<div class="dr-detail">${glyph(faces[f.path])}<span class="dr-detail-name dr-label dr-clip">${f.name}</span><span class="dr-detail-counts dr-label"><span>${f.count} notes</span><span>${subfolders.length} folders</span></span><div class="dr-detail-actions">${iconButton('open', 'Open')}${iconButton('note-new', 'New note')}${iconButton('pin', 'Pin')}${iconButton('more', 'More')}</div></div><div class="dr-rows" role="list">${logic.map((n) => (n.title === OPEN ? row(n, { 'aria-current': 'page' }) : row(n))).join('')}</div>`;
  const opened = `<div class="dr-grid is-labelled" role="list">${subfolders.map((s) => cell(facesIn, s)).join('')}${logic.slice(0, 15).map((n) => noteCell(n, n.title === OPEN ? { 'aria-current': 'page' } : {})).join('')}</div>`;
  return section('library', 'The library sidebar', 'One place, three levels of detail, and a folder picked. Each is a sidebar 320px wide and 720 high; what runs past the foot scrolls.', `<div class="spec-states is-close">${[
    sidebar('objects · Logic picked', 320, head('Library', 0) + body(grid())), sidebar('shelves · a bar a note', 320, head('Library', 1) + body(shelves)),
    sidebar('words · Logic open', 320, head('Library', 2) + body(words)), sidebar('a folder picked', 320, head('Library', 0, true) + body(detail)),
  ].join('')}</div>`)
  + section('library-widths', 'The grid at the sidebar’s widths', 'Three columns of square cells, each a whole number of units cut from the width: 80px at 280, 104 at 344, 120 at 400. Then labels turned off, and a folder opened: its folders and its notes.', `<div class="spec-states is-close">${[
    sidebar('280 wide · cells of 80', 280, head('Library', 0) + body(grid()), 464), sidebar('344 wide · cells of 104', 344, head('Library', 0) + body(grid()), 464), sidebar('400 wide · cells of 120', 400, head('Library', 0) + body(grid('is-labelled', 'Reading')), 464),
    sidebar('labels off · names with the pointer', 320, head('Library', 0) + body(grid('')), 464), sidebar('Logic opened · its folders, its notes', 320, head('Logic', 0, true) + body(opened), 464),
  ].join('')}</div>`);
}

export function browse(faces) {
  const rows = logic.slice(0, 9).map((n, i) => tr(n, ['Done', 'Done', 'Done', 'Done', 'Draft', 'Draft', 'To write', 'Draft', 'Done'][i], n.title === OPEN ? { 'aria-current': 'page' } : {})).join('');
  const pane = (caption, inner) => `<figure class="spec-shown spec-wide"><div class="dr spec-browse">${inner}</div><figcaption class="dr-label dr-muted">${caption}</figcaption></figure>`;
  return section('browse', 'The browse view', 'The same grid at the window’s width: cells of sixteen units, as many columns as fit, the same zoom control. A folder at the level of words is the table.', [
    pane('objects at the window’s width · Logic picked', `<div class="dr-head"><span class="dr-label">Library</span>${iconButton('search', 'Search')}${iconButton('sort', 'Sort')}${iconButton('filter', 'Filter')}${zoom(0)}</div><div class="spec-browse-grid"><div class="dr-grid is-wide is-labelled" role="list">${folders.map((f) => cell(faces, f, f.name === 'Logic' ? { 'aria-selected': 'true' } : {})).join('')}</div></div>`),
    pane('a folder as words · the table', `<div class="dr-head">${iconButton('back', 'Back')}<span class="dr-label">Logic <span class="dr-muted">24 notes</span></span>${iconButton('note-new', 'New note')}${iconButton('more', 'More')}${zoom(2)}</div>${table(rows).replace('class="dr-table"', 'class="dr-table is-flush"')}<div class="spec-browse-foot"></div>`),
  ].join(''));
}
