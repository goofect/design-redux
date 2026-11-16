/*
 * An editor for the suites: the part of Obsidian's Editor the plugin's
 * commands use, over a string.
 */
exports.editor = (text = '', cursor = { line: 0, ch: 0 }) => {
  const e = {
    text,
    from: cursor,
    to: cursor,
    getValue: () => e.text,
    setValue: (t) => { e.text = t; },
    getLine: (n) => e.text.split('\n')[n] || '',
    lineCount: () => e.text.split('\n').length,
    posToOffset: (p) => e.text.split('\n').slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch,
    offsetToPos: (o) => { const before = e.text.slice(0, o).split('\n'); return { line: before.length - 1, ch: before[before.length - 1].length }; },
    getCursor: (which) => (which === 'from' ? e.from : which === 'to' ? e.to : e.to),
    setCursor: (p) => { e.from = e.to = p; },
    select: (from, to) => { e.from = from; e.to = to; },
    getSelection: () => e.text.slice(e.posToOffset(e.from), e.posToOffset(e.to)),
    replaceRange: (s, from, to = from) => { e.text = e.text.slice(0, e.posToOffset(from)) + s + e.text.slice(e.posToOffset(to)); },
    replaceSelection: (s) => { const at = e.posToOffset(e.from); e.replaceRange(s, e.from, e.to); e.from = e.to = e.offsetToPos(at + s.length); },
    getScrollInfo: () => ({ left: 0, top: 0 }),
    scrollTo: () => {},
    focus: () => {},
  };
  return e;
};
