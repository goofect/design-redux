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
  return section('controls', 'Controls', 'Plain. An icon button is its glyph; a text button an underlined word; a field a line under its text; a page a word. Hover underlines, focus is a 2px outline, open is ink where its list is grey, disabled is grey. No fills.', [
    component('Icon button', 'Only where a glyph is plainer than a word. Its word is its tooltip and its aria-label.', [
      shown('rest', iconButton('fit', 'Fit')), shown('hover · a line under it', iconButton('fit', 'Fit', { class: 'spec-hover' })),
      shown('focus · the outline', iconButton('fit', 'Fit', { class: 'spec-focus' })),
      shown('disabled · grey', iconButton('plus', 'Larger', { 'aria-disabled': 'true' })),
    ]),
    component('Text button and link', 'An underlined word: a link goes somewhere, a text button does something. The one that commits says what it does, and stands last.', [
      shown('a link', link('Logic')), shown('a text button', button('New note')), shown('focus', button('New note', { class: 'spec-focus' })),
      shown('disabled · grey', button('Move', { 'aria-disabled': 'true' })),
      shown('working · its word, grey', button('Moving…', { 'aria-busy': 'true' })), shown('a link that goes nowhere', link('Next', { 'aria-disabled': 'true', tabindex: false })),
    ]),
    component('Pages', "A note's pages: words, grey; the open one ink. Many scroll a whole tab at a time, an ellipsis at the edge where more are.", [
      shown('the first open', tabs(['Notes', 'Proofs', 'Exercises'], 0)), shown('hover on another', tabs(['Notes', 'Proofs', 'Exercises'], 0, { 2: { class: 'spec-hover' } })),
      shown('focus', tabs(['Notes', 'Proofs', 'Exercises'], 1, { 1: { class: 'spec-focus' } })),
      shown('many · whole words, an ellipsis', `<div style="width:200px">${tabs(['Notes', 'Proofs', 'Exercises', 'Sources', 'Scraps'], 0, { 2: { 'data-cut': 'true' }, 3: { 'data-cut': 'true' }, 4: { 'data-cut': 'true' } }).replace('dr-tabs"', 'dr-tabs" data-more-after="true"')}</div>`),
    ]),
    component('Toggle', "Obsidian's own, squared: 40 by 20, the knob on the side that is true. The setting's words beside it.", [
      shown('off', toggle()), shown('on · the knob at the end', toggle('is-enabled')), shown('focus', toggle('spec-focus')), shown('disabled · grey', toggle('is-disabled')),
    ]),
    component('Field', 'A line under its text. Its name above, grey, only where the placeholder doesn’t say the same.', [
      shown('empty', field('Name', input('', 'Untitled'))), shown('filled', field('Name', input('Problem set 4'))),
      shown('focus', field('Name', input('Problem set 4'), '', { box: 'spec-focus' })), shown('search · the placeholder names it', field('', input('', 'Notes and folders'))),
      shown('working · its words, grey', field('', input('deduc'), 'Looking…', { 'aria-busy': 'true' })),
      shown('wrong · red, the words saying why', field('Name', input('Logic/Week: 6'), 'A name can’t hold a colon.', { 'aria-invalid': 'true' })),
      shown('disabled · grey', field('Name', input('Truth tables', '', { disabled: true }), '', { 'aria-disabled': 'true' })),
    ]),
    component('Filter part', "Plain words: a filter's part that takes itself off.", [
      shown('a part', chip('In', 'Logic', { role: 'button', tabindex: 0, close: true })), shown('hover', chip('In', 'Logic', { role: 'button', class: 'spec-hover', close: true })),
    ]),
  ].join(''));
}

const row = (name, a = {}) => `<div class="dr-row ${a.class || ''}" role="button" tabindex="0"${attrs({ ...a, class: false, end: false })}><span class="dr-row-name dr-text dr-clip">${esc(name)}</span>${a.end ? `<span class="dr-row-end dr-muted">${a.end}</span>` : ''}</div>`;
const prop = (key, value, a = {}) => `<div class="dr-prop ${a.class || ''}" tabindex="0"${attrs({ ...a, class: false, why: false, none: false })}><span class="dr-prop-name dr-muted dr-clip">${key}</span><span class="dr-prop-value dr-text dr-clip${a.none ? ' dr-muted' : ''}">${value}</span>${a.why ? `<span class="dr-prop-why">${a.why}</span>` : ''}</div>`;
const rows = (html) => `<div class="dr-rows spec-rows">${html}</div>`;
const n = logic.find((x) => x.title === 'Truth tables');

export function lists() {
  return section('lists', 'Rows', 'A name in a list, four units high, parted by space, like a stock list. Open or picked is underlined where the list is ink, ink where it is grey: no fill, no number, no mark, no bold.', [
    component('Row', 'A folder or a note: its name, and what trails it in grey where it says something.', [
      shown('rest', rows(row(n.title))), shown('hover · underlined', rows(row(n.title, { class: 'spec-hover' }))), shown('focus · the outline, inside', rows(row(n.title, { class: 'spec-focus' }))),
      shown('open · underlined', rows(row(n.title, { 'aria-current': 'page' }))), shown('picked · underlined', rows(row(n.title, { 'aria-selected': 'true' }))),
      shown('disabled · grey', rows(row(n.title, { 'aria-disabled': 'true' }))), shown('wrong · red, its word', rows(row(n.title, { 'aria-invalid': 'true', end: 'unreadable' }))),
    ]),
    component('Property', 'The ledger’s row: name grey in a fixed column, value ink, parted by space; a value edited where it stands, and a property added there, a field each.', [
      shown('hover', rows(prop('Status', 'Draft', { class: 'spec-hover' }))), shown('picked · underlined', rows(prop('Status', 'Draft', { 'aria-selected': 'true' }))),
      shown('no value · a dash', rows(prop('Sources', '—', { none: true }))), shown('wrong · red, the words saying why', rows(prop('Week', 'six', { 'aria-invalid': 'true', why: 'not a number' }))),
      shown('added · a field each, where it will stand', `<div class="dr-note-props" style="width:360px">${rows(`<div class="dr-prop dr-prop-new"><span class="dr-prop-name dr-field-box"><input class="dr-input" type="text" value="source"></span><span class="dr-prop-value dr-field-box spec-focus"><input class="dr-input" type="text" placeholder="value"></span><span class="dr-prop-why"></span></div>`)}</div>`),
    ]),
  ].join(''));
}

const menuItem = (title, cls = '') => `<div class="menu-item ${cls}"><div class="menu-item-title">${title}</div></div>`;
const state = (label, text, extra = '', cls = '', a = {}) => `<div class="dr-state ${cls}"${attrs(a)}><span class="dr-state-label dr-text">${label}</span>${text ? `<span class="dr-text dr-running dr-muted">${text}</span>` : ''}${extra}</div>`;

export function blocks() {
  // The dialog as it is drawn open, kept in the page's flow (a modal one would stand over the specimen).
  const sheet = (title, text, inner, actions) => `<dialog class="dr dr-sheet spec-dialog" open><header class="dr-sheet-head"><hgroup class="dr-sheet-titles"><h2 class="dr-sheet-title">${title}</h2><p class="dr-text dr-running">${text}</p></hgroup></header><div class="dr-sheet-matter">${inner}</div><footer class="dr-sheet-actions">${actions}</footer></dialog>`;
  return section('blocks', 'Head, menu, sheet, say-so', 'The larger pieces, parted by space: no line, no box.', [
    component('Head', 'A pane’s name, a label. No buttons.', [
      shown('a pane', `<div style="width:320px"><div class="dr-head"><span class="dr-head-name">Library</span></div></div>`),
    ]),
    component('Menu', "Obsidian's own, flattened: rows of four units, words only; the one under the pointer or the keys underlined.", [
      shown('rest, selected, disabled, one that destroys', `<div class="menu"><div class="menu-scroll">${menuItem('Open')}${menuItem('New note here', 'selected')}${menuItem('Pin')}${menuItem('Move to…', 'is-disabled')}<div class="menu-separator"></div>${menuItem('Delete folder', 'is-warning')}</div></div>`),
    ]),
    component('Sheet', "The browser's own modal dialog: its title a label, what it asks under it, the matter, then Cancel and the one that commits, last, as underlined words. No close glyph: Escape and Cancel.", [
      shown('a question', sheet('Move 12 notes to Archive', 'Links to them are rewritten. Undo puts them back.', `<div class="dr-field"><span class="dr-muted">Into</span><div class="dr-field-box"><input class="dr-input" type="text" value="Archive/2026"></div></div>`, `${button('Cancel')}${button('Move 12 notes')}`)),
      shown('one that destroys', sheet('Delete Seminar', 'The folder and its 14 notes go to the system bin.', '', `${button('Cancel')}${button('Delete folder')}`)),
    ]),
    component('Say-so', 'A sentence in place of a screen’s contents, one text button at most.', [
      shown('empty', state('Nothing in this folder yet.', '', button('New note'))), shown('working · grey', state('Reading the vault…', '', '', '', { 'aria-busy': 'true' })),
      shown('wrong · red, saying what', state('Couldn’t read Logic.', 'The folder was moved or renamed outside Obsidian.', button('Look again'), '', { role: 'alert' })),
    ]),
  ].join(''));
}
