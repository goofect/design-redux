// The specimen's second half: every component in every state, then the library built from them.
import { glyph, esc, attrs, iconButton, shown, component, section } from './kit.mjs';
import { folders, logic, OPEN, headings, subfolders, size, lengths, properties } from './data.mjs';

const pad = (n) => String(n).padStart(2, '0');
const mins = (words) => `${Math.max(1, Math.round(words / 250))} min`;
const button = (text, a = {}) => `<div class="dr-button ${a.class || ''}" role="button" tabindex="0"${attrs({ ...a, class: false })}>${text}</div>`;
const tabs = (names, on, extra = {}) => `<div class="dr-segments dr-tabs" role="tablist">${names.map((n, i) => `<div class="dr-segment dr-label ${extra[i]?.class || ''}" role="tab" tabindex="${i === on ? 0 : -1}" aria-selected="${i === on}"${attrs({ ...extra[i], class: false })}>${n}</div>`).join('')}</div>`;
const toggle = (cls = '') => `<div class="checkbox-container ${cls}"><input type="checkbox" tabindex="0"></div>`;
const field = (label, inner, note = '', a = {}) => `<div class="dr-field"${attrs(a)}><span class="dr-label">${label}</span><div class="dr-field-box ${a.box || ''}">${inner}</div>${note ? `<span class="dr-field-note dr-text">${note}</span>` : ''}</div>`;
const input = (value, placeholder = '', a = {}) => `<input class="dr-input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"${attrs(a)}>`;
const chip = (key, value, a = {}) => `<span class="dr-chip ${a.class || ''}"${attrs({ ...a, class: false })}>${key ? `<span class="dr-label">${key}</span>` : ''}<span class="dr-text">${value}</span></span>`;

export function controls() {
  return section('controls', 'Controls', 'Each state names what carries it besides colour: ash is the pointer, an inner line is the press, the ring is the keyboard, a bar along the foot is on, a dashed line is disabled.', [
    component('Icon button', 'A control. Four units square, the glyph two; its word is its tooltip and its aria-label.', [
      shown('rest', iconButton('pin', 'Pin')), shown('hover · ash', iconButton('pin', 'Pin', { class: 'spec-hover' })),
      shown('pressed · ash, inner line', iconButton('pin', 'Pin', { class: 'spec-active' })), shown('focus · ring', iconButton('pin', 'Pin', { class: 'spec-focus' })),
      shown('on · clay, foot bar', iconButton('pin', 'Unpin', { 'aria-pressed': 'true' })), shown('disabled · quiet', iconButton('next-note', 'Next note', { 'aria-disabled': 'true' })),
      shown('loading · the glass', iconButton('wait', 'Working', { 'aria-busy': 'true' })),
    ]),
    component('Text button', 'Only where a glyph would not say it: a confirmation, a first choice.', [
      shown('rest', button('Cancel')), shown('hover', button('Cancel', { class: 'spec-hover' })), shown('pressed', button('Cancel', { class: 'spec-active' })),
      shown('focus', button('Cancel', { class: 'spec-focus' })), shown('proposed · ink', button('Move 12 notes', { class: 'is-primary' })),
      shown('destroys · rust line, its word', button('Delete folder', { class: 'is-danger' })), shown('disabled · dashed', button('Move', { 'aria-disabled': 'true' })),
      shown('loading', button(`${glyph('wait')}Moving…`, { 'aria-busy': 'true' })),
    ]),
    component('Tabs', "A note's pages. The label voice; the open page in clay, bold, with the foot bar.", [
      shown('first page open', tabs(['Notes', 'Proofs', 'Exercises'], 0)), shown('hover on another', tabs(['Notes', 'Proofs', 'Exercises'], 0, { 2: { class: 'spec-hover' } })),
      shown('focus', tabs(['Notes', 'Proofs', 'Exercises'], 1, { 1: { class: 'spec-focus' } })), shown('one disabled', tabs(['Notes', 'Proofs', 'Locked'], 0, { 2: { 'aria-disabled': 'true' } })),
      shown('many: they scroll', `<div style="width:232px">${tabs(['Notes', 'Proofs', 'Exercises', 'Sources', 'Scraps'], 3)}</div>`),
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
    component('Chip', "Plain words in a hairline: a property under a note's title, or a filter that can be on.", [
      shown('a property', chip('Status', 'Draft')), shown('a value alone', chip('', 'Logic')),
      shown('a filter', chip('', 'Unread', { role: 'checkbox', tabindex: 0, 'aria-checked': 'false' })), shown('hover', chip('', 'Unread', { role: 'checkbox', class: 'spec-hover', 'aria-checked': 'false' })),
      shown('focus', chip('', 'Unread', { role: 'checkbox', class: 'spec-focus', 'aria-checked': 'false' })), shown('on · clay, the mark', chip('', 'Unread', { role: 'checkbox', 'aria-checked': 'true' })),
      shown('disabled', chip('Week', '6', { 'aria-disabled': 'true' })), shown('wrong', chip('Week', 'six', { 'aria-invalid': 'true' })),
    ]),
  ].join(''));
}

// ---- Lists ----

const face = (faces, f) => faces[f.path];
export const cell = (faces, f, a = {}) => `<div class="dr-cell ${a.class || ''}" role="button" tabindex="0" aria-label="${esc(f.name)}, ${f.count} notes"${attrs({ ...a, class: false, inner: false })}>${a.inner || glyph(face(faces, f))}<span class="dr-cell-label dr-label"><span class="dr-cell-name dr-clip">${esc(f.name)}</span><span class="dr-cell-count">${f.count}</span></span></div>`;
export const noteCell = (n, a = {}) => `<div class="dr-cell" role="button" tabindex="0" aria-label="${esc(n.title)}"${attrs(a)}>${glyph('note')}<span class="dr-cell-label dr-label"><span class="dr-cell-name dr-clip">${esc(n.title)}</span></span></div>`;
export const row = (n, a = {}) => `<div class="dr-row ${a.class || ''}" role="button" tabindex="0"${attrs({ ...a, class: false, end: false })}><span class="dr-slot dr-label"><span>${pad(n.number)}</span></span><span class="dr-row-name dr-text dr-clip">${esc(n.title)}</span><span class="dr-row-end dr-label">${a.end || mins(n.words)}</span></div>`;
export const outlineFolder = (f, open) => `<div class="dr-outline-folder" role="button" tabindex="0" aria-expanded="${open}"><span class="dr-slot">${glyph(open ? 'down' : 'next')}</span><span class="dr-label dr-clip">${esc(f.name)}</span><span class="dr-row-end dr-label">${f.count}</span></div>`;
const child = (text, a = {}) => `<div class="dr-row is-child" role="button" tabindex="-1"${attrs(a)}><span class="dr-slot"></span><span class="dr-row-name dr-text dr-clip">${esc(text)}</span></div>`;
const prop = (key, value, a = {}) => `<div class="dr-prop ${a.class || ''}" tabindex="0"${attrs({ ...a, class: false, end: false })}><span class="dr-label dr-clip">${key}</span><span class="dr-prop-value dr-text dr-clip">${value}</span>${a.end || ''}</div>`;
const cover = (tone) => `<img class="dr-cell-cover" alt="" src="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80"><rect width="60" height="80" fill="${tone}"/><rect x="12" y="16" width="36" height="4" fill="#E9E6DF"/><rect x="12" y="26" width="24" height="4" fill="#E9E6DF"/></svg>`)}">`;

export function lists(faces) {
  const f = folders[2];
  const n = logic[4];
  const box = (html, w = 96) => `<div class="dr-grid spec-one" style="--dr-cell:${w}px">${html}</div>`;
  const rows = (html) => `<div class="dr-rows spec-rows">${html}</div>`;
  return section('lists', 'Objects and rows', 'The same folder and note at three levels of detail. Clay is never alone: a name appears, a mark stands in the slot, the words turn bold.', [
    component('Object cell', 'A folder as a glyph on the ground: no frame, no label at rest. Its name is always its aria-label.', [
      shown('rest · no words', box(cell(faces, f))), shown('hover · ash, the name', box(cell(faces, f, { class: 'spec-hover' }))),
      shown('focus · ring, the name', box(cell(faces, f, { class: 'spec-focus' }))), shown('picked · clay, the name', box(cell(faces, f, { 'aria-selected': 'true' }))),
      shown('open in the page · mark, bold', box(cell(faces, f, { 'aria-current': 'true' }))), shown('labels always shown', `<div class="dr-grid spec-one is-labelled" style="--dr-cell:96px">${cell(faces, f)}</div>`),
      shown("the person's own cover", box(cell(faces, f, { inner: cover('#8A3F2C') }))), shown('disabled · quiet', box(cell(faces, f, { 'aria-disabled': 'true' }))),
      shown('wrong · alert in the corner, the reason in its tooltip', box(cell(faces, f, { inner: `${glyph(face(faces, f))}<span class="dr-cell-flag">${glyph('alert')}</span>` }))),
    ]),
    component('Row', 'A note in a list: its number in the slot, its name, what trails. Hairlines between.', [
      shown('rest', rows(row(n))), shown('hover · ash', rows(row(n, { class: 'spec-hover' }))), shown('focus · ring inside', rows(row(n, { class: 'spec-focus' }))),
      shown('selected · clay, hollow mark', rows(row(n, { 'aria-selected': 'true' }))), shown('open · clay, solid mark, bold', rows(row(n, { 'aria-current': 'page' }))),
      shown('disabled · quiet', rows(row(n, { 'aria-disabled': 'true' }))), shown('not written yet · dashed line', rows(row({ ...n, title: 'Modal logic' }, { class: 'is-missing', end: '—' }))),
      shown('wrong · alert, a word', rows(row(n, { class: 'is-error', end: `${glyph('alert')}unreadable` }))),
    ]),
    component('Outline row', 'Words: folders as labels, notes as numbered rows with no rules, the open note’s headings under it.', [
      shown('a folder, closed', `<div class="dr-outline spec-rows">${outlineFolder(folders[0], false)}</div>`), shown('hover', `<div class="dr-outline spec-rows">${outlineFolder(folders[0], false).replace('dr-outline-folder', 'dr-outline-folder spec-hover')}</div>`),
      shown('a folder, open, its notes', `<div class="dr-outline spec-rows">${outlineFolder(f, true)}${row(logic[3])}${row(n, { 'aria-current': 'page' })}${child(headings[0])}${child(headings[1], { 'aria-current': 'location' })}${child(headings[2])}${row(logic[5])}</div>`),
    ]),
    component('Panel row', "A property: its name in the label voice, its value in the reading voice. A section's title over its rows.", [
      shown('a section', `<div class="spec-rows"><div class="dr-section"><span class="dr-label">Properties</span>${iconButton('plus', 'Add a property')}</div>${prop('Status', 'Draft')}${prop('Course', 'Logic')}</div>`),
      shown('hover', `<div class="spec-rows spec-top">${prop('Status', 'Draft', { class: 'spec-hover' })}</div>`), shown('focus', `<div class="spec-rows spec-top">${prop('Status', 'Draft', { class: 'spec-focus' })}</div>`),
      shown('selected', `<div class="spec-rows spec-top">${prop('Status', 'Draft', { 'aria-selected': 'true' })}</div>`), shown('no value · a dash', `<div class="spec-rows spec-top">${prop('Sources', '—', { class: 'is-empty' })}</div>`),
      shown('wrong · alert, rust words', `<div class="spec-rows spec-top">${prop('Week', 'six', { 'aria-invalid': 'true', end: glyph('alert') })}</div>`), shown('disabled', `<div class="spec-rows spec-top">${prop('Created', '3 October', { 'aria-disabled': 'true' })}</div>`),
    ]),
  ].join(''));
}

// ---- Table and blocks ----

const menuItem = (g, title, cls = '', sub = false) => `<div class="menu-item ${cls}"><div class="menu-item-icon">${glyph(g)}</div><div class="menu-item-title">${title}</div>${sub ? `<div class="menu-item-icon">${glyph('next')}</div>` : ''}</div>`;
const state = (g, label, text, extra = '', cls = '') => `<div class="dr-state ${cls}">${glyph(g)}<span class="dr-label">${label}</span>${text ? `<span class="dr-text is-running">${text}</span>` : ''}${extra}</div>`;

export function blocks(faces) {
  const f = folders[2];
  const sheet = (title, text, inner, actions) => `<div class="modal"><div class="modal-close-button">${iconButton('close', 'Close')}</div><div class="modal-title">${title}</div><div class="modal-content"><div class="dr dr-sheet"><p class="dr-text is-running">${text}</p>${inner}<div class="dr-sheet-actions">${actions}</div></div></div></div>`;
  return section('blocks', 'Menu, sheet, say-so', 'The larger pieces, built from the ones above.', [
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
