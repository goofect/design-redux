// What the simulation suites share: main.js loaded with Obsidian stood in for,
// and any name it declares reachable, without a list of them to keep.
const fs = require('fs');
const path = require('path');
const Module = require('module');

let hooked = null;

/**
 * Menu entries need a section, or Obsidian sorts them after its own. The
 * suite's Menu stand-in, whatever it is, refuses an entry without
 * `setSection` on a menu that's Obsidian's: one the suite made and handed
 * over, as a 'file-menu' or 'editor-menu' is. A menu main.js makes, and a
 * submenu, may hold only the plugin's entries, in its own order; one that
 * mixes entries with a section and without is refused when it's shown.
 * A refusal thrown in a click handler is swallowed by jsdom, so it's also
 * printed and fails the suite as it exits.
 */
const refusals = [];
function refused(message) {
  if (!refusals.length) process.on('exit', () => { process.exitCode = 1; });
  refusals.push(message);
  console.error(`menu: ${message}`);
  return new Error(message);
}

function sectionedMenus(obsidian) {
  const Menu = obsidian && 'Menu' in obsidian ? obsidian.Menu : null;
  const proto = Menu && Menu.prototype;
  if (!proto || typeof proto.addItem !== 'function' || Menu.drMade) return;
  const made = (menu) => {
    if (menu && typeof menu === 'object') menu.drMade = true;
    return menu;
  };
  if (!proto.addItem.drSectioned) {
    const addItem = proto.addItem;
    proto.addItem = function (cb) {
      const theirs = !this.drMade;
      return addItem.call(this, (item) => {
        let title = '';
        let sectioned = false;
        const { setTitle, setSection, setSubmenu } = item;
        if (typeof setTitle === 'function') item.setTitle = function (t) { title = t; return setTitle.apply(this, arguments); };
        if (typeof setSection === 'function') item.setSection = function () { sectioned = true; return setSection.apply(this, arguments); };
        if (typeof setSubmenu === 'function') item.setSubmenu = function () { return made(setSubmenu.apply(this, arguments)); };
        const out = cb(item);
        if (theirs && !sectioned) throw refused(`menu entry "${title}" has no section: give it setSection('action') or another (AGENTS.md)`);
        (this.drEntries || (this.drEntries = [])).push({ title, sectioned });
        return out;
      });
    };
    proto.addItem.drSectioned = true;
    // A menu of ours that Obsidian's entries join too ('file-menu' triggered on it) has sections
    // on some of its entries: then every one needs one. Told when it's shown.
    ['showAtMouseEvent', 'showAtPosition'].forEach((name) => {
      const show = proto[name];
      if (typeof show !== 'function') return;
      proto[name] = function () {
        const entries = this.drEntries || [];
        const bare = entries.filter((e) => !e.sectioned);
        if (bare.length && bare.length < entries.length)
          throw refused(`menu entries ${bare.map((e) => `"${e.title}"`).join(', ')} have no section, beside entries that have one (AGENTS.md)`);
        return show.apply(this, arguments);
      };
    });
  }
  // The same class and prototype (what main.js patches on it lands on the suite's), marking what it makes.
  obsidian.Menu = new Proxy(Menu, {
    construct: (target, args, newTarget) => made(Reflect.construct(target, args, newTarget)),
    get: (target, k, receiver) => (k === 'drMade' ? true : Reflect.get(target, k, receiver)),
  });
}

/**
 * Loads the built main.js with `obsidian` (the suite's stand-in) given for
 * require('obsidian'), and returns what it declares: `R.BrowseView`,
 * `const { Orders } = …`. A name main.js doesn't declare reads as undefined.
 */
exports.loadMain = (obsidian, tag = 'suite') => {
  if (!hooked) {
    const origLoad = Module._load;
    Module._load = function (req, ...rest) {
      return req === 'obsidian' ? hooked : origLoad.call(this, req, ...rest);
    };
  }
  hooked = obsidian;
  sectionedMenus(obsidian);
  const tmp = path.join(__dirname, `_${tag}_under_test.js`);
  // The bundle's names are its module scope's, so an eval there reads any of them;
  // its top-level declarations (at the line's start) say which there are, so the
  // whole can be listed too (Object.values, `in`).
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const names = [...new Set(Array.from(src.matchAll(/^(?:var|let|const|function\*?|async function|class) ([A-Za-z_$][\w$]*)/gm), (m) => m[1]))];
  fs.writeFileSync(tmp, src + `
module.exports.__test = ((names) => new Proxy({}, {
  get: (_, k) => { if (typeof k !== 'string') return undefined; try { return eval(k); } catch (e) { if (e instanceof ReferenceError) return undefined; throw e; } },
  has: (_, k) => names.includes(k),
  ownKeys: () => names,
  getOwnPropertyDescriptor: (_, k) => (names.includes(k) ? { value: eval(k), enumerable: true, configurable: true } : undefined),
}))(${JSON.stringify(names)});
`);
  try {
    return require(tmp).__test;
  } finally {
    fs.unlinkSync(tmp);
  }
};

/**
 * Obsidian's additions to elements, as the suites stand them in: createEl
 * (with cls, text and type), createDiv, createSpan, the class helpers,
 * empty and setText. A suite adds what it needs beyond these (isShown).
 */
exports.elementHelpers = (P) => {
  const apply = (el, o) => {
    if (!o) return el;
    if (typeof o === 'string') { el.className = o; return el; }
    if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
    if (o.text !== undefined) el.textContent = o.text;
    if (o.type) el.setAttribute('type', o.type);
    return el;
  };
  P.createEl = function (tag, o) { return apply(this.appendChild(this.ownerDocument.createElement(tag)), o); };
  P.createDiv = function (o) { return this.createEl('div', o); };
  P.createSpan = function (o) { return this.createEl('span', o); };
  P.addClass = function (...c) { this.classList.add(...c); };
  P.removeClass = function (...c) { this.classList.remove(...c); };
  P.toggleClass = function (c, on) { this.classList.toggle(c, !!on); };
  P.hasClass = function (c) { return this.classList.contains(c); };
  P.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
  P.setText = function (t) { this.textContent = t; };
};
