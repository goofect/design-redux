// Builds docs/specimen.html: the design system on one page, from the same
// sources the plugin ships — the SVG files under assets/icons, the parts of
// the stylesheet, the glyph builder. Nothing on the page is drawn twice.
//
//   node tools/specimen.mjs            write docs/specimen.html
//   node tools/specimen.mjs --check    fail if the page on disk is out of date
//
// Opened as it is, the page shows light and dark side by side (two frames of
// itself). With ?scheme=light or ?scheme=dark it is one scheme, which is what
// tests/screenshots.js photographs, a section at a time.
// A session that adds a screen adds a section in tools/specimen/ and lists it below.
import fs from 'node:fs';
import path from 'node:path';
import { root, builderFile, stylesheet, withHeldStates } from './specimen/kit.mjs';
import { palette, glyphs, commandList } from './specimen/sections-system.mjs';
import { controls, lists, blocks, library, browse } from './specimen/sections-parts.mjs';
import { screens } from './specimen/sections-screens.mjs';
import { folders, subfolders } from './specimen/data.mjs';

// The builder is an ES module of the plugin's source; read as text, so Node needn't guess what kind of file it is.
const { glyphsAmong, GLYPH_FAMILIES } = await import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(builderFile, 'utf8'))}`);
const faces = glyphsAmong(folders.map((f) => f.path));
const facesIn = glyphsAmong(subfolders.map((f) => f.path));

const REGIONS = ['chrome', 'tabs', 'sidebars', 'editor', 'overlays', 'library', 'note', 'strip', 'panel', 'canvas', 'graph', 'maps', 'icons', 'compat'];

// What Obsidian itself provides and the page lacks: its fonts and sizes, and the bare structure of the three pieces of its own that the look restyles.
const STAND_INS = `
body{--file-line-width:640px;--file-margins:32px;--font-text:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--font-interface:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--font-ui-smaller:12px;--font-ui-small:13px;--font-ui-medium:15px;--font-ui-large:20px;--toggle-thumb-radius:0}
.menu{display:flex;flex-direction:column;width:240px;border:var(--menu-border-width) solid var(--menu-border-color);background-color:var(--menu-background);overflow:hidden}
.menu-scroll{display:flex;flex-direction:column;padding:var(--menu-padding)}
.menu-item{display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:var(--font-ui-small);white-space:nowrap}
.menu-item:not(.is-label):not(.is-disabled).selected{background-color:var(--background-modifier-hover)}
.menu-item-icon{flex:0 1 auto;display:flex;color:var(--text-muted)}
.menu-item-title{flex:1 0 0}
.menu-item.is-disabled{color:var(--text-faint)}
.menu-item.is-warning:not(.is-disabled){color:var(--text-error)}
.menu-separator{height:0;margin:6px -6px;border-bottom:var(--border-width) solid var(--background-modifier-border)}
.modal{position:relative;width:400px;padding:16px;border:var(--modal-border-width) solid var(--modal-border-color);background-color:var(--modal-background)}
.modal-title{margin-bottom:16px;padding-right:32px;font-size:var(--font-ui-large)}
.modal-close-button{position:absolute;top:8px;right:8px}
.checkbox-container{display:inline-block;flex-shrink:0;position:relative;width:var(--toggle-s-width);height:calc(var(--toggle-s-thumb-height) + var(--toggle-s-border-width) * 2);background-color:var(--background-modifier-border-hover)}
.checkbox-container::after{content:"";display:block;position:absolute;width:var(--toggle-s-thumb-width);height:var(--toggle-s-thumb-height);background-color:var(--toggle-thumb-color);transform:translate3d(var(--toggle-s-border-width),0,0)}
.checkbox-container.is-enabled{background-color:var(--interactive-accent)}
.checkbox-container.is-enabled::after{transform:translate3d(calc(var(--toggle-s-width) - var(--toggle-s-thumb-width) - var(--toggle-s-border-width)),0,0)}
.checkbox-container input{position:absolute;inset:0;margin:0;opacity:0}
`;

// The page's own layout. spec- classes are the specimen's, never the plugin's.
const PAGE = `
html{background:var(--dr-bg)}
body{margin:0;background:var(--dr-bg);color:var(--dr-ink)}
h2,p,figure,pre{margin:0}
.spec-top-bar{display:flex;gap:16px;align-items:center;height:48px;padding:0 32px;border-bottom:1px solid var(--dr-ink)}
.spec-top-bar a{color:inherit}
.spec-section{padding:48px 32px;border-bottom:1px solid var(--dr-ink)}
.spec-section-head{display:grid;gap:8px;max-width:800px;margin-bottom:32px}
.spec-component{padding:24px 0 32px;border-top:1px solid var(--dr-ink)}
.spec-component-head{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:baseline;margin-bottom:24px}
.spec-states{display:flex;flex-wrap:wrap;gap:32px;align-items:flex-end}
.spec-states.is-close{gap:32px 24px;align-items:flex-start}
.spec-shown{display:grid;gap:8px;justify-items:start}
.spec-thing{display:flex;align-items:center;min-height:32px}
.spec-rows{width:320px}
.spec-shelf{width:176px}
.dr-grid.spec-one{grid-template-columns:var(--dr-cell)}
.spec-tight{padding:16px}
.spec-sidebar{box-sizing:content-box;border-right:1px solid var(--dr-ink);overflow:hidden}
.spec-glyphs{display:grid;grid-template-columns:repeat(auto-fill,112px);gap:24px 0}
.spec-glyphs.is-family{grid-template-columns:repeat(8,112px)}
.spec-glyph .dr-label{white-space:nowrap}
.spec-family{display:grid;gap:16px;padding:16px 0;border-top:1px solid var(--dr-ink)}
.spec-glyph{display:grid;justify-items:center;gap:8px}
.spec-glyph-small{display:flex;gap:16px;align-items:center;height:24px}
.spec-commands{display:grid;grid-template-columns:repeat(auto-fill,minmax(264px,1fr));gap:0 32px}
.spec-command{display:flex;gap:16px;align-items:center;height:32px;border-bottom:1px solid var(--dr-ink)}
.spec-swatches,.spec-tones{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:32px;margin-bottom:32px}
.spec-swatch,.spec-tone{display:grid;gap:8px;align-content:start}
.spec-chip{display:grid;place-items:center;height:64px;border:1px solid var(--dr-ink)}
.spec-tone .spec-chip{height:32px}
.spec-measured{padding:16px;border:1px solid var(--dr-ink);overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:16px}
.spec-voices{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:32px;margin:32px 0}
.spec-voices>div{display:grid;gap:8px;align-content:start}
.spec-units{display:flex;flex-wrap:wrap;gap:32px;align-items:flex-end}
.spec-unit{display:grid;gap:8px;justify-items:start}
.spec-unit-box{background:var(--dr-ink)}
.spec-wide{width:100%;margin-bottom:32px}
.spec-wide>.spec-browse{width:100%}
.spec-browse-grid{padding:32px 0}
.spec-browse-foot{height:48px}
.spec-screen{box-sizing:content-box;overflow:hidden;position:relative;background:var(--dr-bg)}
.spec-screen.is-side{border-right:1px solid var(--dr-ink)}
.spec-screen.is-panel{border-left:1px solid var(--dr-ink)}
.spec-screen>.dr-library,.spec-screen>.dr-panel,.spec-screen>.dr-map{height:100%}
.spec-screen .view-content{padding:0}
.spec-screen.is-note>.spec-note{display:flex;flex-direction:column;height:100%}
.spec-note-text{flex:1;width:100%;max-width:640px;margin:0 auto;padding:24px 32px;box-sizing:border-box;color:var(--dr-ink);font-family:var(--font-text);font-size:15px;line-height:24px}
.spec-note-text .inline-title{margin:0 0 8px;font-size:1.728em;line-height:1.2;font-weight:700}
.spec-note-text p{margin:0 0 16px}
.spec-graph{display:block}
.spec-graph-links{fill:none;stroke:var(--dr-muted);stroke-width:1}
.spec-graph .is-ink{fill:var(--dr-ink)}
.spec-graph .is-clay{fill:var(--dr-clay)}
.spec-graph-ring{fill:none;stroke:var(--dr-ink);stroke-width:1}
.spec-graph-ring.is-picked{stroke-width:2}
body.spec-shell>main,body.spec-framed>.spec-top-bar{display:none}
.spec-frames{display:grid;grid-template-columns:1fr 1fr}
.spec-frames iframe{display:block;width:100%;border:0}
.spec-frames iframe+iframe{border-left:1px solid #1A1A18}
`;

const SCRIPT = `
(function () {
  var scheme = new URLSearchParams(location.search).get('scheme');
  var body = document.body;
  if (scheme === 'light' || scheme === 'dark') {
    body.classList.add('theme-' + scheme);
    var tell = function () { parent.postMessage({ specimenHeight: document.documentElement.scrollHeight }, '*'); };
    if (parent !== window) { body.classList.add('spec-framed'); addEventListener('load', tell); addEventListener('resize', tell); }
    return;
  }
  body.classList.add('theme-light', 'spec-shell');
  var frames = document.createElement('div');
  frames.className = 'spec-frames';
  ['light', 'dark'].forEach(function (s) {
    var f = document.createElement('iframe');
    f.title = s;
    f.src = location.pathname.split('/').pop() + '?scheme=' + s;
    frames.appendChild(f);
  });
  body.appendChild(frames);
  addEventListener('message', function (e) {
    if (!e.data || !e.data.specimenHeight) return;
    Array.prototype.forEach.call(frames.children, function (f) { f.style.height = Math.max(parseInt(f.style.height) || 0, e.data.specimenHeight) + 'px'; });
  });
})();
`;

const sections = [palette(), glyphs(GLYPH_FAMILIES), commandList(), controls(), lists(faces), blocks(faces), library(faces, facesIn), browse(faces), await screens()].join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design Redux specimen</title>
<!-- Built by tools/specimen.mjs from assets/icons, the stylesheet's parts and the glyph builder. Don't edit: build it again. -->
<style>
${STAND_INS}
/* ---- The plugin's stylesheet, as shipped, each pointer and key state given a twin a class can hold still ---- */
${withHeldStates(stylesheet())}
/* ---- The page ---- */
${PAGE}
</style>
</head>
<body class="dr-active ${REGIONS.map((r) => `dr-region-${r}`).join(' ')}">
<div class="spec-top-bar dr"><span class="dr-label">Design Redux · specimen</span><a class="dr-label" href="?">Both</a><a class="dr-label" href="?scheme=light">Light</a><a class="dr-label" href="?scheme=dark">Dark</a></div>
<main class="dr">
${sections}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`;

const out = path.join(root, 'docs', 'specimen.html');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== html) {
    console.error('specimen: docs/specimen.html is out of date: node tools/specimen.mjs');
    process.exit(1);
  }
  console.log('specimen: docs/specimen.html is current');
} else {
  fs.writeFileSync(out, html);
  console.log(`specimen: docs/specimen.html written, ${(html.length / 1024).toFixed(0)} KB, ${(sections.match(/data-shot=/g) || []).length} sections`);
}
