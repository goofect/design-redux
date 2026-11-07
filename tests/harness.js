// What the simulation suites share: main.js loaded with Obsidian stood in for,
// and any name it declares reachable, without a list of them to keep.
const fs = require('fs');
const path = require('path');
const Module = require('module');

let hooked = null;

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
