/*
 * What the simulation suites share: a jsdom window, the plugin's source as
 * one object with Obsidian stood in for (tests/obsidian.js), a vault to try
 * it in, and a way to say what is checked.
 *
 *   const { load, world, suite } = require('./harness.js');
 *   const dr = load();                       every name any module exports
 *   const w = await world({ 'A/One.md': '' });   w.app, w.plugin (loaded), w.doc
 *   const check = suite('library');  check('what must hold', () => { ... });  check.done();
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { JSDOM } = require('jsdom');
const obsidian = require('./obsidian.js');

const dom = new JSDOM('<!doctype html><html><body class="theme-light"></body></html>', { pretendToBeVisual: true });
const { window } = dom;
['window', 'document', 'HTMLElement', 'Element', 'Node', 'SVGElement', 'MouseEvent', 'KeyboardEvent', 'Event', 'CustomEvent', 'getComputedStyle', 'DOMParser', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'].forEach((name) => {
  if (!(name in global) || name === 'Event') global[name] = typeof window[name] === 'function' && /^[a-z]/.test(name) ? window[name].bind(window) : window[name];
});
Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
global.activeDocument = window.document;
global.activeWindow = window;
window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
window.HTMLCanvasElement.prototype.getContext = () => null; // no canvas: text is measured by estimate
window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };
global.ResizeObserver = window.ResizeObserver;

let source = null;
/** Everything the source exports, by name; `default` is the plugin's class. */
exports.load = () => {
  if (source) return source;
  const file = path.join(__dirname, '_source.js');
  if (!fs.existsSync(file)) throw new Error('tests/_source.js is missing: npm run build');
  const original = Module._load;
  Module._load = function (request, ...rest) { return request === 'obsidian' ? obsidian : original.call(this, request, ...rest); };
  source = require(file);
  return source;
};
exports.obsidian = obsidian;

/** What is open over the workspace now, a sheet (the plugin's dialog) or one of Obsidian's modals (a picker), in the order opened. */
exports.overlays = () => {
  const all = [...obsidian.Modal.open, ...(source && source.Sheet ? source.Sheet.shown : [])];
  const node = (m) => m.dialog || m.containerEl;
  return all.filter((m) => node(m) && node(m).isConnected).sort((a, b) => (node(a).compareDocumentPosition(node(b)) & 4 ? -1 : 1));
};
/** The one in front. */
exports.front = () => exports.overlays().slice(-1)[0];
exports.window = window;

/**
 * A vault and the plugin loaded in it. `files` is { path: text }; `data` is
 * what data.json holds before the plugin loads (null: a first run).
 * Options: { load: false } leaves the plugin unloaded, for a suite that loads it itself.
 */
exports.world = async (files = {}, data = null, options = {}) => {
  const dr = exports.load();
  const doc = window.document;
  while (doc.body.firstChild) doc.body.removeChild(doc.body.firstChild);
  doc.body.className = 'theme-light';
  obsidian.Notice.log.length = 0;
  obsidian.Menu.made.length = 0;
  obsidian.Menu.shown = null;
  obsidian.Modal.open.length = 0;
  obsidian.Setting.made.length = 0;
  const app = new obsidian.App(files, doc);
  const Plugin = dr.default;
  const plugin = new Plugin(app, { id: 'design-redux', version: '4.0.0', dir: '.obsidian/plugins/design-redux' });
  plugin._data = data;
  if (options.load !== false) await plugin.onload();
  return { app, plugin, doc, dr, obsidian, file: (p) => app.vault.getAbstractFileByPath(p), text: (p) => app.vault.text.get(p) };
};

/** Lets every promise already queued settle. */
exports.settle = async (turns = 4) => { for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0)); };

/** A suite's checks: each named, run in order (await it if it is async), told in one line at the end. */
exports.suite = (name) => {
  let passed = 0;
  const failures = [];
  const check = async (what, fn) => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failures.push(what);
      console.log(`not ok  ${what}\n${String((err && err.stack) || err).split('\n').slice(0, 8).join('\n')}`);
      process.exitCode = 1;
    }
  };
  check.done = () => { if (!failures.length) console.log(`${name}: ${passed} passed`); else console.log(`${name}: ${failures.length} failed, ${passed} passed`); };
  return check;
};
