// The specimen's second part: every piece in each of its states, written with the plugin's own classes.
// The screens built from them are drawn by the plugin itself (sections-screens.mjs).
import { glyph, esc, attrs, iconButton, shown, component, section } from './kit.mjs';
import { logic, properties } from './data.mjs';

const button = (text, a = {}) => `<div class="dr-button ${a.class || ''}" role="button" tabindex="0"${attrs({ ...a, class: false })}>${text}</div>`;
const link = (text, a = {}) => `<span class="dr-link ${a.class || ''}" role="link" tabindex="0"${attrs({ ...a, class: false })}>${text}</span>`;
const tabs = (names, on, extra = {}) => `<div class="dr-segments dr-tabs" role="tablist">${names.map((n, i) => `<div class="dr-segment dr-text ${extra[i]?.class || ''}" role="tab" tabindex="${i === on ? 0 : -1}" aria-selected="${i === on}"${attrs({ ...extra[i], class: false })}>${n}</div>`).join('')}</div>`;
const toggle = (cls = '', words = 'Library') => `<label class="spec-setting"><div class="checkbox-container ${cls}"><input type="checkbox" tabindex="0"></div><span>${words}</span></label>`;
const field = (label, inner, note = '', a = {}) => `<div class="dr-field"${attrs(a)}>${label ? `<span class="dr-muted">${label}</span>` : ''}<div class="dr-field-box ${a.box || ''}">${inner}</div>${note ? `<span class="dr-field-note dr-text">${note}</span>` : ''}</div>`;
const input = (value, placeholder = '', a = {}) => `<input class="dr-input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}"${attrs(a)}>`;
const chip = (key, value, a = {}) => `<span class="dr-chip ${a.class || ''}"${attrs({ ...a, class: false, close: false })}>${key ? `<span class="dr-muted">${key}</span>` : ''}<span class="dr-text">${value}</span>${a.close ? glyph('close') : ''}</span>`;

export function controls() {
  return section('controls', 'Controls', 'Plain. An icon button is its glyph; a text button an underlined word; the one that commits black with white words; a field a line under its text; a page a word. Hover underlines, focus is a 2px outline, on or open is inverted, disabled is grey. Nothing else.', [
    component('Icon button', 'Only where a glyph is plainer than a word. Its word is its tooltip and its aria-label.', [
      shown('rest', iconButton('fit', 'Fit')), shown('hover · a line under it', iconButton('fit', 'Fit', { class: 'spec-hover' })),
      shown('focus · the outline', iconButton('fit', 'Fit', { class: 'spec-focus' })), shown('on · inverted', iconButton('fold', 'Fold all', { 'aria-pressed': 'true' })),
      shown('disabled · grey', iconButton('plus', 'Larger', { 'aria-disabled': 'true' })),
    ]),
    component('Text button and link', 'An underlined word: a link goes somewhere, a text button does something. The one that commits is black, one a screen.', [
      shown('a link', link('Logic')), shown('a text button', button('New note')), shown('focus', button('New note', { class: 'spec-focus' })),
      shown('the one that commits', button('Move 12 notes', { class: 'is-primary' })), shown('it, under the pointer', button('Move 12 notes', { class: 'is-primary spec-hover' })),
      shown('destroys · red, its word', button('Delete folder', { class: 'is-danger' })), shown('disabled · grey', button('Move', { 'aria-disabled': 'true' })),
      shown('working · its word, grey', button('Moving…', { 'aria-busy': 'true' })), shown('a link that goes nowhere', link('Next', { 'aria-disabled': 'true', tabindex: false })),
    ]),
    component('Pages', "A note's pages: underlined words, the open one inverted. Many scroll a whole tab at a time, an ellipsis at the edge where more are.", [
      shown('the first open', tabs(['Notes', 'Proofs', 'Exercises'], 0)), shown('hover on another', tabs(['Notes', 'Proofs', 'Exercises'], 0, { 2: { class: 'spec-hover' } })),
      shown('focus', tabs(['Notes', 'Proofs', 'Exercises'], 1, { 1: { class: 'spec-focus' } })),
      shown('many · whole words, an ellipsis', `<div style="width:200px">${tabs(['Notes', 'Proofs', 'Exercises', 'Sources', 'Scraps'], 0, { 2: { class: 'is-cut' }, 3: { class: 'is-cut' }, 4: { class: 'is-cut' } }).replace('dr-tabs"', 'dr-tabs is-more-after"')}</div>`),
    ]),
    component('Toggle', "Obsidian's own, squared: 40 by 20, an ink knob on the side that is true; on, inverted. The setting's words beside it.", [
      shown('off', toggle()), shown('on · inverted', toggle('is-enabled')), shown('focus', toggle('spec-focus')), shown('disabled · grey', toggle('is-disabled')),
    ]),
    component('Field', 'A line under its text. Its name above, grey, only where the placeholder doesn’t say the same.', [
      shown('empty', field('Name', input('', 'Untitled'))), shown('filled', field('Name', input('Problem set 4'))),
      shown('focus', field('Name', input('Problem set 4'), '', { box: 'spec-focus' })), shown('search · the placeholder names it', field('', input('', 'Notes and folders'))),
      shown('working · its words, grey', field('', input('deduc'), 'Looking…', { 'aria-busy': 'true' })),
      shown('wrong · red, the words saying why', field('Name', input('Logic/Week: 6'), 'A name can’t hold a colon.', { 'aria-invalid': 'true' })),
      shown('disabled · grey', field('Name', input('Truth tables', '', { disabled: true }), '', { 'aria-disabled': 'true' })),
    ]),
    component('Filter part', "Plain words: a filter's part that takes itself off, or a filter that can be on.", [
      shown('a part', chip('In', 'Logic', { role: 'button', tabindex: 0, close: true })), shown('a filter', chip('', 'Unread', { role: 'checkbox', tabindex: 0, 'aria-checked': 'false' })),
      shown('hover', chip('', 'Unread', { role: 'checkbox', class: 'spec-hover', 'aria-checked': 'false' })), shown('on · inverted', chip('', 'Unread', { role: 'checkbox', 'aria-checked': 'true' })),
    ]),
  ].join(''));
}

const row = (name, a = {}) => `<div class="dr-row ${a.class || ''}" role="button" tabindex="0"${attrs({ ...a, class: false, end: false })}><span class="dr-row-name dr-text dr-clip">${esc(name)}</span>${a.end ? `<span class="dr-row-end dr-muted">${a.end}</span>` : ''}</div>`;
const prop = (key, value, a = {}) => `<div class="dr-prop ${a.class || ''}" tabindex="0"${attrs({ ...a, class: false, why: false })}><span class="dr-prop-name dr-muted dr-clip">${key}</span><span class="dr-prop-value dr-text dr-clip">${value}</span>${a.why ? `<span class="dr-prop-why">${a.why}</span>` : ''}</div>`;
const rows = (html) => `<div class="dr-rows spec-rows">${html}</div>`;
const n = logic.find((x) => x.title === 'Truth tables');

export function lists() {
  return section('lists', 'Rows', 'A name in a list, four units high, a light rule under it, like a stock list. Open or picked is filled light grey; nothing else marks it: no number, no mark, no bold.', [
    component('Row', 'A folder or a note: its name, and what trails it in grey where it says something.', [
      shown('rest', rows(row(n.title))), shown('hover · underlined', rows(row(n.title, { class: 'spec-hover' }))), shown('focus · the outline, inside', rows(row(n.title, { class: 'spec-focus' }))),
      shown('open · filled', rows(row(n.title, { 'aria-current': 'page' }))), shown('picked · filled', rows(row(n.title, { 'aria-selected': 'true' }))),
      shown('disabled · grey', rows(row(n.title, { 'aria-disabled': 'true' }))), shown('wrong · red, its word', rows(row(n.title, { class: 'is-error', end: 'unreadable' }))),
    ]),
    component('Property', 'The ledger’s row: name grey in a fixed column, value ink, a light rule under it; a value edited where it stands.', [
      shown('hover', rows(prop('Status', 'Draft', { class: 'spec-hover' }))), shown('picked · filled', rows(prop('Status', 'Draft', { 'aria-selected': 'true' }))),
      shown('no value · a dash', rows(prop('Sources', '—', { class: 'is-empty' }))), shown('wrong · red, the words saying why', rows(prop('Week', 'six', { 'aria-invalid': 'true', why: 'not a number' }))),
    ]),
  ].join(''));
}

const menuItem = (title, cls = '') => `<div class="menu-item ${cls}"><div class="menu-item-title">${title}</div></div>`;
const state = (label, text, extra = '', cls = '') => `<div class="dr-state ${cls}"><span class="dr-state-label dr-text">${label}</span>${text ? `<span class="dr-text is-running dr-muted">${text}</span>` : ''}${extra}</div>`;

export function blocks() {
  const sheet = (title, text, inner, actions) => `<div class="modal"><div class="modal-close-button">${iconButton('close', 'Close')}</div><div class="modal-title">${title}</div><div class="modal-content"><div class="dr dr-sheet"><p class="dr-text is-running">${text}</p>${inner}<div class="dr-sheet-actions">${actions}</div></div></div></div>`;
  return section('blocks', 'Head, menu, sheet, say-so', 'The larger pieces. A line only where the structure divides: under a head.', [
    component('Head', 'A pane’s name in bold, and a light line under it. No buttons.', [
      shown('a pane', `<div style="width:320px"><div class="dr-head"><span class="dr-head-name">Library</span></div></div>`),
    ]),
    component('Menu', "Obsidian's own, flattened: rows of four units, words only; the one under the pointer or the keys inverted.", [
      shown('rest, selected, disabled, one that destroys', `<div class="menu"><div class="menu-scroll">${menuItem('Open')}${menuItem('New note here', 'selected')}${menuItem('Pin')}${menuItem('Move to…', 'is-disabled')}<div class="menu-separator"></div>${menuItem('Delete folder', 'is-warning')}</div></div>`),
    ]),
    component('Sheet', "Obsidian's own modal, flattened: its title, the matter, Cancel as a word and the one that commits, black.", [
      shown('a question', sheet('Move 12 notes to Archive', 'Links to them are rewritten. Undo puts them back.', `<div class="dr-field"><span class="dr-muted">Into</span><div class="dr-field-box"><input class="dr-input" type="text" value="Archive/2026"></div></div>`, `${button('Cancel')}${button('Move 12 notes', { class: 'is-primary' })}`)),
      shown('one that destroys', sheet('Delete Seminar', 'The folder and its 14 notes go to the system bin.', '', `${button('Cancel')}${button('Delete folder', { class: 'is-danger' })}`)),
    ]),
    component('Say-so', 'A sentence in place of a screen’s contents, one text button at most.', [
      shown('empty', state('Nothing in this folder yet.', '', button('New note'))), shown('working · grey', state('Reading the vault…', '', '', 'is-busy')),
      shown('wrong · red, saying what', state('Couldn’t read Logic.', 'The folder was moved or renamed outside Obsidian.', button('Look again'), 'is-error')),
    ]),
  ].join(''));
}
