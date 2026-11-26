# How Obsidian reads Markdown, and how a plugin changes it

This was read from Obsidian 1.15.1's own `app.js` and `worker.js` (the
release `.asar` on GitHub) on 2026-11-26, and checked by running the
patterns it found. Minified names change with every release, but strings and
regexes don't: `scripts/obsidian-source.mjs` finds them again after an
update.

## Three readers, not one

Obsidian has no single Markdown parser. Three separate pieces of code decide
what a line is, and each feeds different features.

| Reader | Where | What it is | Its list rule (1.15.1) | What it feeds |
| --- | --- | --- | --- | --- |
| **Editor drawing** | `app.js` | The CodeMirror 5 mode `hypermd` (HyperMD, built on CM5's markdown mode), defined on `window.CodeMirror` and run in CM6 through `StreamLanguage.define(CodeMirror.getMode({}, { name: 'hypermd' }))`. There are three variants: the editor, one for table cells, and one with no front matter | `/^(?:[*\-+]\|^[0-9]+([.)]))\s+/` | `syntaxTree` (node names are the mode's tokens joined by `_`); line classes such as `HyperMD-list-line HyperMD-list-line-1`; Live Preview's bullets and its `list-number` mark; the hanging indent; folding by list |
| **Editor commands** | `app.js` | Obsidian's own pattern | `/^([>\s]*)(([*+-] \|(\d+)([.)] ))(?:\[(.)\] )?)?/` | Enter continuing a list; Tab and Shift-Tab; the renumbering `transactionFilter`; "Toggle numbered list"; checkboxes |
| **Reading view and metadata cache** | `app.js` (renders the reading view's HTML) and `worker.js` (the "Metadata Cache Worker") | A fork of remark-parse 8's tokenizer (`eat(…).apply(node)`), producing an mdast-style tree with Obsidian's own nodes: `ilink`, `iembed`, `tag`, `blockid`, `comment`, `mark`, `math`, `inlineMath`, `footnote*`, `checklist`, `checkbox` | `/^([ \t]*)([*+-]\|\d+[.)])( {1,4}(?! )\| \|\t\|$\|(?=\n))([^\n]*)/` | `<ol>` / `<ul>` in the reading view and PDF export; `getFileCache().listItems` and `sections`; links, tags and blocks in the cache |

### What each of them calls a list

Each line below was tested against the three rules:

| Line | Editor drawing | Editor commands | Reading view / cache |
| --- | --- | --- | --- |
| `1. a`, `1) a`, `  2. a` | list | list | list |
| `3.1.1. a`, `3.1 a` | text | text | text |
| `a. a`, `iv. a` | text | text | text |
| `1.` (nothing after) | text | text | **list** |
| `1.`⇥`a` (a tab after) | list | **text** | list |
| `1234567890. a` (10 digits) | list | list | list (CommonMark allows 9) |

So an outline number such as `3.1.1.`, a letter or a numeral is a paragraph
to all three readers:
- no bullet, number style or hanging indent in the editor;
- Enter doesn't continue it, Tab doesn't indent it, and nothing renumbers
  it;
- in the reading view, consecutive lines run together into one `<p>` with
  `<br>`s;
- nothing appears in `listItems`, so list folding and list-reading plugins
  ignore it.

The three readers also disagree at the edges (the bold cells above), so a
plugin that decides "is this a list?" must say which reader it is matching.

## Why a plugin can't change the parser

- **There is no API, and nothing is reachable.** All three parsers are
  closures inside `app.js` and `worker.js`. The only globals are
  `window.CodeMirror` (CM5, used for code blocks in the editor), `DOMPurify`,
  `requestUrl`, `Notice`, `FS` and `CodeMirrorAdapter`. The hypermd
  `StreamLanguage`s are built once, when `app.js` loads.
- **Replacing the editor's language breaks Obsidian.** CM6's `language`
  facet keeps the highest-precedence language (`combine: (l) => l[0]`), so a
  plugin could install its own. But Live Preview, folding, the list commands
  and the renumbering all read hypermd's tokens (`tokens.has
  ('formatting-list-ol')`, `'hmd-codeblock'`, `'HyperMD-list-line'`). One
  developer who replaced it is looking for a way back (forum, "Is there a way
  to extend Obsidian's markdown parser").
- **The reading view has no hook before parsing.** Post-processors receive
  the HTML each section rendered to. `registerMarkdownCodeBlockProcessor`
  owns only the inside of a fenced block.
- **The metadata cache parses in a worker** that plugins can't reach.

## The two ways that work

First decide where the number lives.

**A. In the structure (recommended unless the text must carry it).** Write
a standard nested list (`1.` at every level, indented) and change only how
it looks. This is recipe 24:
- in the reading view and PDF export, CSS counters on `ol > li::marker`;
- in the editor, a `ViewPlugin` that replaces each nested marker with a
  widget showing `3.1.1.`.

All three readers still see a list, so all of these keep working:
- Enter, Tab and renumbering;
- folding;
- `listItems`, and the plugins that read them (Tasks, Outliner);
- plain Markdown in the file.

The cost is that the file says `1.` at each level. LawList works this way
(it changes only the rendering).

**B. In the text.** When the literal numbers must be in the file (a legal
document cited by number, text pasted elsewhere), write `3.1.1.` and accept
that the plugin owns every layer Obsidian no longer handles. This is recipe
23, and Multilevel Number Indent works this way ("real characters in the
file"). Write one pure module that says what an item is and how its number
steps, then use it in four places:

1. **Editor drawing.** A `ViewPlugin` over `visibleRanges`:
   - a line decoration that hangs the text, which is how Obsidian hangs its
     own lists: inline `text-indent:-Npx; padding-inline-start:Npx`, with N
     the marker's columns × `view.defaultCharacterWidth`;
   - a mark decoration on the number;
   - skip lines in code: tokens `hmd-codeblock` and `inline-code`.
2. **Editor keys.** `registerEditorExtension(Prec.high(keymap.of([...])))`
   for Enter, Tab and Shift-Tab. Each returns `false` when the line isn't
   one of yours, so Obsidian's own keys run.
3. **Reading view.** A post-processor that turns the paragraph into a list.
   - Split the `<p>` at `<br>`, read the number from the first text of each
     row, and move the rendered nodes (links, bold) into the new rows.
   - Take the depth from the number itself (`3.1.1` is three parts), since
     rendering drops the leading spaces.
   - This is allowed: the rendered text is drawn again from the note, so a
     post-processor may rebuild it.
   - Use `ctx.getSectionInfo(el)` only when you need the source. It can be
     `null`, for example in embeds.
4. **The index.** The cache lists these lines as a `paragraph` in
   `sections`. Read those lines with `cachedRead` and parse them in your own
   index, not per render.

What B loses that A keeps: list folding (folding by indent still works with
`foldIndent`), indentation guides, Obsidian's renumbering, and every plugin
that reads `listItems`.

## Editor facts worth knowing

- **Node names.** They are the hypermd tokens joined by `_`, e.g.
  `formatting_formatting-list_formatting-list-ol_list-1`. Obsidian itself
  splits them into a set and tests membership; do the same
  (`name.split('_')`), never match the whole name, because 1.15.0 added
  `formatting-*-end` segments. The tokens at a position:
  `syntaxTree(state).resolveInner(pos, 1).name.split('_')`.
- **Line classes from the mode:**
  - `HyperMD-list-line` and `HyperMD-list-line-N` (depth);
  - `HyperMD-list-line-nobullet` (a continuation line inside a list item);
  - `HyperMD-codeblock` with `-begin` / `-end`;
  - `HyperMD-header-N` and `HyperMD-quote`.

  `app.css` styles lists through these (`.HyperMD-list-line {
  padding-inline-start: var(--size-4-4) }`).
- **Live Preview** marks an ordered marker with `Decoration.mark({ class:
  'list-number' })`. In the reading view, `ol > li::marker` takes its colour
  from `--list-marker-color`, and its style from `ol { list-style-type:
  var(--list-numbered-style) }`.
- **Renumbering** is a `transactionFilter`. After a change, it rewrites the
  numbers of the standard ordered items around it, and its own edit carries
  `userEvent: 'input.renumber'`.
  - It skips a transaction whose user event is `set` or `input.renumber`,
    one carrying Obsidian's internal table annotation, and anything during
    IME composition.
  - A plugin that rewrites standard list numbers itself can dispatch with
    `userEvent: 'input.renumber'` so Obsidian doesn't redo them. This is
    internal behaviour, so check it after updates with
    `obsidian-source.mjs --find "input.renumber"`.
  - Lines that aren't Obsidian lists (`3.1.1.`) are never touched.
- **Smart lists** follow the `smartIndentList` setting (default on).
  Reading it is internal: `app.vault.getConfig('smartIndentList')`, behind a
  `typeof` guard.
- **CSS counters don't work in the editor.** CodeMirror only keeps visible
  lines in the DOM, so a counter restarts wherever the viewport starts.
  Count from the document (recipe 24's `outlineNumber`).

## Checking again after an update

```sh
node scripts/obsidian-source.mjs --regexes "[.)]"          # the three list rules
node scripts/obsidian-source.mjs --find "input.renumber"   # the renumbering filter
node scripts/obsidian-source.mjs --find '"hypermd"'        # how the editor's language is built
node scripts/obsidian-source.mjs --find "formatting-list-ol" --around 300
```

## Sources

- Obsidian 1.15.1 `app.js` and `worker.js`, from [obsidian-1.15.1.asar.gz](https://github.com/obsidianmd/obsidian-releases/releases/tag/v1.15.1).
- `@codemirror/language` 6, the `language` facet (`dist/index.js`).
- [Is there a way to extend Obsidian's markdown parser for Editor Extensions?](https://forum.obsidian.md/t/is-there-a-way-to-extend-obsidians-markdown-parser-for-editor-extensions/93610), Obsidian forum
- [Ordered lists: each nested level must start with "1"](https://forum.obsidian.md/t/ordered-lists-each-nested-level-must-start-with-1-to-be-understood-as-a-new-list-item/97828) and [Obsidian repeatedly changes user-entered numerals](https://forum.obsidian.md/t/obsidian-repeatedly-wrongly-changes-user-entered-numerals-in-numeric-lists/110237), Obsidian forum
- [LawList](https://community.obsidian.md/plugins/lawlist) (rendering only), [Multilevel Number Indent](https://community.obsidian.md/plugins/nested-outline-numbering) (numbers in the text), [Extended Markdown Syntax](https://community.obsidian.md/plugins/extended-markdown-syntax) (its own incremental parser beside Obsidian's)
