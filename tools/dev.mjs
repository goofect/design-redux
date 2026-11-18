// Running the plugin in real Obsidian while working on it, for VS Code's Run and Debug.
//
//   node tools/dev.mjs           build with a sourcemap and install into .dev-vault/
//   node tools/dev.mjs --watch   the same, then again on every change under src/, styles/, assets/
//   node tools/dev.mjs --launch  install, then start Obsidian with a debugging port (9222) on .dev-vault/
//
// .dev-vault/ is a copy of tests/obsidian/vault, made once and kept out of git; your own vault is
// never touched. After a rebuild, reload Obsidian (Cmd+R in it, or "Reload app without saving").

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vault = path.join(root, '.dev-vault');
const pluginDir = path.join(vault, '.obsidian', 'plugins', 'design-redux');
const PORT = 9222;
const args = process.argv.slice(2);

/** The sandbox vault: the test vault's notes, with the plugin listed as on. Made once; your edits in it are kept. */
function makeVault() {
  if (!fs.existsSync(vault)) {
    fs.cpSync(path.join(root, 'tests', 'obsidian', 'vault'), vault, { recursive: true });
    console.log('dev: made .dev-vault/ from tests/obsidian/vault');
  }
  fs.mkdirSync(pluginDir, { recursive: true });
  const list = path.join(vault, '.obsidian', 'community-plugins.json');
  const on = fs.existsSync(list) ? JSON.parse(fs.readFileSync(list, 'utf8')) : [];
  if (!on.includes('design-redux')) fs.writeFileSync(list, JSON.stringify(on.concat('design-redux'), null, 2));
}

/** Builds with the sourcemap and copies what Obsidian loads into the vault. Returns whether it built. */
function install() {
  try {
    execFileSync(process.execPath, [path.join(root, 'build.mjs'), '--dev'], { cwd: root, stdio: 'inherit' });
  } catch {
    console.log('dev: the build failed; the vault keeps the last good one');
    return false;
  }
  ['main.js', 'styles.css', 'manifest.json'].forEach((f) => fs.copyFileSync(path.join(root, f), path.join(pluginDir, f)));
  // Tells a hot-reload plugin, if you have one in the vault, to reload this one.
  fs.writeFileSync(path.join(pluginDir, '.hotreload'), '');
  console.log(`dev: installed in .dev-vault at ${new Date().toLocaleTimeString()}; reload Obsidian (Cmd+R) to see it`);
  return true;
}

const listening = () => new Promise((done) => {
  const socket = net.connect(PORT, '127.0.0.1');
  socket.once('connect', () => { socket.end(); done(true); });
  socket.once('error', () => done(false));
});

/** Is the sandbox vault one Obsidian knows? It opens only vaults it has been shown once. */
function known() {
  const config = path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  try {
    return Object.values(JSON.parse(fs.readFileSync(config, 'utf8')).vaults || {}).some((v) => path.resolve(v.path) === vault);
  } catch {
    return false;
  }
}

async function launch() {
  if (process.platform !== 'darwin') throw new Error('dev: --launch knows the Mac only; start Obsidian with --remote-debugging-port=9222 yourself');
  if (await listening()) {
    console.log(`dev: Obsidian is already open with port ${PORT}; attaching`);
  } else {
    let running = false;
    try { execFileSync('pgrep', ['-x', 'Obsidian'], { stdio: 'ignore' }); running = true; } catch { /* not running */ }
    if (running) {
      console.error('dev: Obsidian is open without the debugging port. Quit it (Cmd+Q), then run this again.');
      process.exit(1);
    }
    spawn('open', ['-a', 'Obsidian', '--args', `--remote-debugging-port=${PORT}`], { stdio: 'ignore', detached: true }).unref();
    for (let i = 0; i < 40 && !(await listening()); i++) await new Promise((r) => setTimeout(r, 250));
  }
  if (known()) {
    spawn('open', [`obsidian://open?path=${encodeURIComponent(vault)}`], { stdio: 'ignore', detached: true }).unref();
  } else {
    console.log(`dev: the first time only: in Obsidian, "Open folder as vault", choose\n     ${vault}\n     and turn on community plugins when it asks.`);
  }
  console.log(`dev: Obsidian is on port ${PORT}`);
}

makeVault();
if (!install() && !args.includes('--watch')) process.exit(1);
if (args.includes('--launch')) await launch();
if (args.includes('--watch')) {
  let timer = null;
  const again = () => { clearTimeout(timer); timer = setTimeout(() => { console.log('dev: change seen, rebuilding'); install(); console.log('dev: watching'); }, 150); };
  ['src', 'styles', 'assets'].forEach((d) => fs.watch(path.join(root, d), { recursive: true }, again));
  console.log('dev: watching');
}
