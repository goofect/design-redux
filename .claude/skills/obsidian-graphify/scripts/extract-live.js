// Runs inside a live Obsidian as the body of `(app, obsidian, options) => { … }` and
// returns its components as graphify node-link JSON ({ nodes, links, inventory }).
// ci/extract.e2e.mjs runs it through WebdriverIO; it also works pasted into
// DevTools as `(function (app, obsidian, options) { … })(app, require('obsidian'), {})`.
//
// Ids follow graphify's code ids for obsidian.d.ts (obsidian_d_<class>[_<method>]), so
// public classes and methods merge with a code graph of the typings; everything only the
// running app has is under obsidian_app_*, obsidian_core_plugin_*, obsidian_view_*, …

const SOURCE = 'obsidian-runtime';
const nodes = new Map();
const links = [];
const seen = new Set();
const id = (...parts) => parts.join('_').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const short = (v) => { try { const s = JSON.stringify(v); return s && s.length > 120 ? `${s.slice(0, 117)}…` : s; } catch { return String(v); } };

function node(nid, label, kind, metadata = {}) {
  if (!nodes.has(nid)) nodes.set(nid, { id: nid, label, file_type: 'code', source_file: SOURCE, source_location: kind, type: kind, metadata: { kind, ...metadata } });
  else Object.assign(nodes.get(nid).metadata, metadata);
  return nid;
}
function link(source, target, relation, confidence = 'EXTRACTED') {
  const key = `${source}|${relation}|${target}`;
  if (source === target || seen.has(key)) return;
  seen.add(key);
  links.push({ source, target, relation, confidence, source_file: SOURCE, weight: 1 });
}

// --- 1. The public API: every export of the obsidian module --------------------------
const MODULE = node('obsidian_module', 'obsidian (module)', 'module');
const exportsOf = Object.getOwnPropertyNames(obsidian).filter((k) => k !== '__esModule' && k !== 'default')
  .map((k) => { try { return [k, obsidian[k]]; } catch { return [k, undefined]; } });
const publicName = new Map();                          // constructor → exported name
for (const [name, value] of exportsOf)
  if (typeof value === 'function' && /^[A-Z]/.test(name) && value.prototype && !publicName.has(value)) publicName.set(value, name);

const methodsOf = (proto) => Object.getOwnPropertyNames(proto).filter((m) => {
  if (m === 'constructor') return false;
  const d = Object.getOwnPropertyDescriptor(proto, m);
  return d && typeof d.value === 'function';
});
const classId = (ctor) => publicName.has(ctor) ? id('obsidian_d', publicName.get(ctor)) : null;

for (const [name, value] of exportsOf) {
  if (publicName.get(value) === name) {
    const cid = node(id('obsidian_d', name), name, 'public-class');
    link(MODULE, cid, 'exports');
    for (const m of methodsOf(value.prototype)) link(cid, node(id('obsidian_d', name, m), `.${m}()`, 'method'), 'method');
    // Getters and setters on the prototype, and the class's own static methods.
    for (const m of Object.getOwnPropertyNames(value.prototype)) {
      const d = Object.getOwnPropertyDescriptor(value.prototype, m);
      if (d && (d.get || d.set)) link(cid, node(id('obsidian_d', name, m), `.${m}`, 'property', { get: !!d.get, set: !!d.set }), 'property');
    }
    for (const m of Object.getOwnPropertyNames(value)) {
      if (/^(length|name|prototype|arguments|caller)$/.test(m)) continue;
      const d = Object.getOwnPropertyDescriptor(value, m);
      if (d && typeof d.value === 'function') link(cid, node(id('obsidian_d', name, m), `${name}.${m}()`, 'static-method'), 'static_method');
    }
    const parent = Object.getPrototypeOf(value);
    if (parent && parent !== Function.prototype) {
      const pid = classId(parent) ?? node(id('obsidian_internal_class', parent.name || 'anonymous', name), `${parent.name || '(anonymous)'} (internal base of ${name})`, 'internal-class');
      link(cid, pid, 'inherits');
    }
  } else if (typeof value === 'function') {
    link(MODULE, node(id('obsidian_d', name), `${name}()`, 'public-function'), 'exports');
  } else if (value && typeof value === 'object') {
    link(MODULE, node(id('obsidian_d', name), name, 'public-object', { keys: Object.keys(value).slice(0, 40) }), 'exports');
  }
}

// The nearest public class in an object's prototype chain, and whether its own class is internal.
function classOf(obj) {
  let proto = Object.getPrototypeOf(obj);
  const own = proto && proto.constructor;
  while (proto && proto !== Object.prototype) {
    if (publicName.has(proto.constructor)) return { pub: proto.constructor, internal: proto.constructor !== own ? own : null };
    proto = Object.getPrototypeOf(proto);
  }
  return { pub: null, internal: own && own !== Object ? own : null };
}

// --- 2. The running app: app and the objects it holds ---------------------------------
const isDom = (v) => v instanceof Node || v instanceof Window || (typeof v === 'object' && v && 'nodeType' in v && 'ownerDocument' in v);
// The main services are walked two levels deeper than the rest.
const DEEPER = /^app\.(workspace|vault|metadataCache|internalPlugins|plugins|customCss|setting|metadataTypeManager|viewRegistry|embedRegistry|keymap|hotkeyManager)\b/;
const maxDepth = options.depth ?? 2;
const limit = (p) => maxDepth + (DEEPER.test(p) ? 2 : 0);
// The vault's own data (keyed by a file path or a file name) is counted, never listed.
// So are content hashes, and the records a service keeps (caches, hotkeys, each settings row).
const dataKey = (k) => typeof k === 'string' && (/[/\\]/.test(k) || /\.[a-z0-9]{1,6}$/i.test(k) || /^[0-9a-f]{32,}$/.test(k));
const DATA = /^(metadataCache|fileCache|resolvedLinks|unresolvedLinks|defaultKeys|customKeys|bakedHotkeys|bakedIds|settingItems|tabNavItems|fileMap|properties)$/;
const record = (x) => { const p = Object.getPrototypeOf(x); return p === Object.prototype || p === null || Array.isArray(x); };
const ITEMS = 40;                                         // a list or map longer than this is counted
const emitterList = [];                                   // every Events object met, with its path
const internalClass = new Map();                          // internal constructor → its node, named by first path
const pathOf = new WeakMap();                            // object → its first path
const idOfPath = new Map();                               // path → id, unique even if two paths normalise alike
const takenBy = new Map();
const rt = (path) => {
  if (idOfPath.has(path)) return idOfPath.get(path);
  let nid = id('obsidian_rt', path);
  for (let n = 2; takenBy.has(nid) && takenBy.get(nid) !== path; n++) nid = `${id('obsidian_rt', path)}_${n}`;
  takenBy.set(nid, path);
  idOfPath.set(path, nid);
  return nid;
};
const queue = [['app', app, 0]];
while (queue.length) {
  const [path, obj, depth] = queue.shift();
  if (pathOf.has(obj) && pathOf.get(obj) !== path) continue;
  pathOf.set(obj, path);
  const { pub, internal } = classOf(obj);
  const own = Object.keys(obj);
  const protoMethods = new Set();
  for (let p = Object.getPrototypeOf(obj); p && p !== Object.prototype && !publicName.has(p.constructor); p = Object.getPrototypeOf(p))
    methodsOf(p).forEach((m) => protoMethods.add(m));
  const nid = node(rt(path), path, 'runtime-object', {
    class: pub ? publicName.get(pub) : null,
    internalMethods: [...protoMethods].slice(0, 80),
    fields: own.filter((k) => obj[k] === null || typeof obj[k] !== 'object').slice(0, 60),
  });
  if (pub) link(nid, id('obsidian_d', publicName.get(pub)), 'instance_of');
  if (internal && protoMethods.size) link(nid, pub ? id('obsidian_d', publicName.get(pub)) : MODULE, 'extends_internally', 'INFERRED');
  // Its internal class, once per constructor, with the methods no typing declares.
  if (internal && protoMethods.size) {
    let ic = internalClass.get(internal);
    if (!ic) {
      ic = node(id('obsidian_internal', path), `${path} (internal class)`, 'internal-class', { minified: internal.name || null, extends: pub ? publicName.get(pub) : null });
      internalClass.set(internal, ic);
      for (const m of protoMethods) link(ic, node(id(ic, m), `.${m}()`, 'internal-method', { owner: path }), 'method');
      if (pub) link(ic, id('obsidian_d', publicName.get(pub)), 'inherits');
    }
    link(nid, ic, 'instance_of');
  }
  const table = obj._;
  if (table && typeof table === 'object' && !Array.isArray(table) && Object.values(table).every(Array.isArray)) emitterList.push([path, obj]);
  if (depth >= limit(path) || (obsidian.TAbstractFile && obj instanceof obsidian.TAbstractFile)) continue; // a file is the person's, not Obsidian's
  const follow = (v, child) => {
    link(nid, rt(child), 'has');
    if (!pathOf.has(v)) { pathOf.set(v, child); queue.push([child, v, depth + 1]); }
  };
  for (const key of own) {
    const v = obj[key];
    if (key === '_' || !v || typeof v !== 'object' || isDom(v) || ArrayBuffer.isView(v)) continue; // `_`: an Events' listeners (section 5)
    if (depth > 0 && DATA.test(key)) { nodes.get(nid).metadata[`${key}.size`] = v.length ?? v.size ?? Object.keys(v).length; continue; }
    if (Array.isArray(v) || v instanceof Map || v instanceof Set) {
      const size = v.length ?? v.size;
      nodes.get(nid).metadata[`${key}.size`] = size;
      const items = v instanceof Map ? [...v.entries()] : [...v].map((x, i) => [i, x]);
      if (size > ITEMS || items.some(([k]) => dataKey(k))) continue;
      for (const [k, x] of items)       // a list's class instances are components; its plain records are data
        if (x && typeof x === 'object' && !isDom(x) && !ArrayBuffer.isView(x) && !record(x))
          follow(x, pathOf.get(x) ?? (typeof k === 'number' ? `${path}.${key}[${k}]` : `${path}.${key}.${k}`));
      continue;
    }
    const keys = Object.keys(v);
    const plain = Object.getPrototypeOf(v) === Object.prototype;
    if (plain && (keys.length > 150 || keys.some(dataKey))) { nodes.get(nid).metadata[`${key}.size`] = keys.length; continue; } // files, caches
    follow(v, pathOf.get(v) ?? `${path}.${key}`);
  }
}
const rtNode = (path) => node(rt(path), path, 'runtime-object');

// --- 3. Core plugins, community plugins, views and file types -------------------------
const views = app.viewRegistry?.viewByType ? Object.keys(app.viewRegistry.viewByType) : [];
for (const type of views) node(id('obsidian_view', type), `${type} (view)`, 'view-type');
for (const [ext, type] of Object.entries(app.viewRegistry?.typeByExtension ?? {}))
  link(node(id('obsidian_extension', ext), `.${ext}`, 'file-extension'), node(id('obsidian_view', type), `${type} (view)`, 'view-type'), 'opens_in');

const corePlugins = app.internalPlugins?.plugins ?? {};
for (const [pid, p] of Object.entries(corePlugins)) {
  const cp = node(id('obsidian_core_plugin', pid), `${pid} (core plugin)`, 'core-plugin', {
    enabled: !!p.enabled, name: p.instance?.name ?? null, description: p.instance?.description ?? null,
    ...(options.defaultEnabled ? { enabledByDefault: options.defaultEnabled.includes(pid) } : {}),
  });
  link(rt('app.internalPlugins'), cp, 'contains');
  for (const type of Object.keys(p.views ?? {})) link(cp, node(id('obsidian_view', type), `${type} (view)`, 'view-type'), 'registers_view');
}
for (const [pid, m] of Object.entries(app.plugins?.manifests ?? {})) {
  const pl = node(id('obsidian_plugin', pid), `${m.name ?? pid} (plugin)`, 'community-plugin', {
    version: m.version, minAppVersion: m.minAppVersion, enabled: !!app.plugins.enabledPlugins?.has?.(pid),
  });
  link(rt('app.plugins'), pl, 'contains');
  const inst = app.plugins.plugins?.[pid];
  for (const type of views) if (inst && app.viewRegistry.viewByType[type] && String(type).startsWith(pid)) link(pl, id('obsidian_view', type), 'registers_view', 'INFERRED');
}

// --- 4. Commands, by owner -------------------------------------------------------------
const commands = app.commands?.commands ?? {};
for (const [cid, c] of Object.entries(commands)) {
  const prefix = cid.includes(':') ? cid.slice(0, cid.indexOf(':')) : 'app';
  const owner = corePlugins[prefix] ? id('obsidian_core_plugin', prefix)
    : app.plugins?.manifests?.[prefix] ? id('obsidian_plugin', prefix)
    : node(id('obsidian_command_group', prefix), `${prefix}: (commands)`, 'command-group');
  const hotkeys = app.hotkeyManager?.getDefaultHotkeys?.(cid) ?? app.hotkeyManager?.defaultKeys?.[cid] ?? [];
  const kinds = ['callback', 'checkCallback', 'editorCallback', 'editorCheckCallback'].filter((k) => typeof c[k] === 'function');
  link(owner, node(id('obsidian_command', cid), cid, 'command', { name: c.name, kinds, hotkeys: short(hotkeys) }), 'provides_command');
}

// --- 5. Events each part listens to now (Events keeps them in `_`) -----------------------
// Every Events object the walk met, not only the main services.
for (const [path, em] of emitterList) {
  const name = path.replace(/^app\.?/, '') || 'app';
  for (const [ev, handlers] of Object.entries(em._))
    link(rt(path), node(id('obsidian_event', name, ev), `${name}.on('${ev}')`, 'event', { emitter: name, listeners: Array.isArray(handlers) ? handlers.length : null }), 'emits');
}

// --- 6. Settings (the vault's config, as set now) ---------------------------------------
for (const [key, value] of Object.entries(app.vault?.config ?? {}))
  link(rt('app.vault'), node(id('obsidian_setting', key), key, 'setting', { value: short(value) }), 'has_setting');

// --- 7. The DOM's regions, and the body's classes ---------------------------------------
const domId = (cls) => id('obsidian_dom', cls);
const root = document.querySelector('.app-container') ?? document.body;
const walk = (el, parentCls, depth) => {
  if (depth > (options.domDepth ?? 7)) return;
  for (const child of el.children) {
    const cls = [...child.classList].find((c) => !/^(is-|mod-|cm-|svg-icon|lucide)/.test(c));
    if (!cls || child.closest('.markdown-preview-view, .cm-content, .view-content > *')) continue;
    const nid = node(domId(cls), `.${cls}`, 'dom-region', { tag: child.tagName.toLowerCase(), mods: [...child.classList].filter((c) => /^(mod-|is-)/.test(c)).slice(0, 8) });
    if (parentCls) link(domId(parentCls), nid, 'contains_dom');
    walk(child, cls, depth + 1);
  }
};
node(domId('app-container'), '.app-container', 'dom-region');
walk(root, 'app-container', 0);
for (const cls of document.body.classList) link(node(id('obsidian_dom', 'body'), 'body', 'dom-region'), node(id('obsidian_body_class', cls), `body.${cls}`, 'body-class'), 'has_class');

// --- 8. Command line handlers, and the globals Obsidian adds ------------------------------
const cli = app.cli?.handlers ?? null;                    // a Map of name → { description, flags, … }
if (cli && typeof cli === 'object')
  for (const [name, h] of cli instanceof Map ? cli.entries() : Object.entries(cli))
    link(rt('app.cli'), node(id('obsidian_cli', name), `obsidian ${name}`, 'cli-command', { description: h?.description ?? h?.desc ?? null, flags: h?.flags ? Object.keys(h.flags) : [] }), 'provides_cli');

const frame = document.createElement('iframe');
document.body.appendChild(frame);
const plainKeys = new Set(Object.getOwnPropertyNames(frame.contentWindow));
frame.remove();
for (const key of Object.getOwnPropertyNames(window)) {
  if (plainKeys.has(key) || /^(webkit|on|__|\$)/.test(key) || /^\d/.test(key)) continue;
  link(node('obsidian_window', 'window', 'global-scope'), node(id('obsidian_global', key), `window.${key}`, 'global', { typeof: typeof window[key] }), 'defines_global');
}

// --- 9. Registries: icons, code block languages, embeds, property types, settings tabs, ribbon --
const keysOf = (o) => (o instanceof Map ? [...o.keys()] : o && typeof o === 'object' ? Object.keys(o) : []);
const icons = typeof obsidian.getIconIds === 'function' ? obsidian.getIconIds() : [];
if (icons.length) {
  const set = node('obsidian_icons', 'icons (getIconIds)', 'icon-set', { count: icons.length });
  link(MODULE, set, 'contains');
  for (const icon of icons) link(set, node(id('obsidian_icon', icon), `icon: ${icon}`, 'icon'), 'has_icon');
}
const renderer = obsidian.MarkdownPreviewRenderer;
for (const lang of keysOf(renderer?.codeBlockPostProcessors))
  link(id('obsidian_d', 'MarkdownPreviewRenderer'), node(id('obsidian_code_block', lang), `\`\`\`${lang}`, 'code-block-language'), 'renders_code_block');
if (Array.isArray(renderer?.postProcessors)) node(id('obsidian_d', 'MarkdownPreviewRenderer'), 'MarkdownPreviewRenderer', 'public-class', { postProcessors: renderer.postProcessors.length });
for (const ext of keysOf(app.embedRegistry?.embedByExtension))
  link(rtNode('app.embedRegistry'), node(id('obsidian_extension', ext), `.${ext}`, 'file-extension'), 'embeds');
for (const type of keysOf(app.metadataTypeManager?.registeredTypeWidgets))
  link(rtNode('app.metadataTypeManager'), node(id('obsidian_property_type', type), `${type} (property type)`, 'property-type', { name: app.metadataTypeManager.registeredTypeWidgets[type]?.name ?? null }), 'registers_type');
for (const [list, tabs] of [['settingTabs', app.setting?.settingTabs], ['pluginTabs', app.setting?.pluginTabs]])
  for (const tab of Array.isArray(tabs) ? tabs : [])
    if (tab?.id) link(rtNode('app.setting'), node(id('obsidian_settings_tab', tab.id), `${tab.name ?? tab.id} (settings tab)`, 'settings-tab', { id: tab.id, core: list === 'settingTabs' }), 'has_tab');
for (const side of ['leftRibbon', 'rightRibbon'])
  for (const item of app.workspace?.[side]?.items ?? [])
    if (item?.id) link(rtNode(`app.workspace.${side}`), node(id('obsidian_ribbon', item.id), `${item.title ?? item.id} (ribbon)`, 'ribbon-action', { icon: item.icon ?? null }), 'has_action');

// --- done ---------------------------------------------------------------------------------
const inventory = {
  version: obsidian.apiVersion ?? null,
  exports: exportsOf.length,
  appId: app.appId,
  counts: [...nodes.values()].reduce((m, n) => ((m[n.type] = (m[n.type] || 0) + 1), m), {}),
};
node('obsidian', `Obsidian ${inventory.version ?? ''}`.trim(), 'app', inventory);
link('obsidian', rt('app'), 'has');
link('obsidian', MODULE, 'exports');
return { directed: true, multigraph: false, graph: { source: 'obsidian-graphify', obsidian: inventory.version }, nodes: [...nodes.values()], links, inventory };
