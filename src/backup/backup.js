/* ------------------------------------------------------------------ */
/* The backup: the feature                                             */
/*                                                                     */
/* One way: the vault's files are copied to Google Drive or OneDrive,  */
/* or both, as they change; nothing ever comes back into the vault.    */
/* Signing in is the switch: signed in, a vault is backed up a minute  */
/* after it was last changed (never more than ten behind while it      */
/* keeps changing) and soon after Obsidian opens; "Back up now" any    */
/* time. What is deleted here goes to the service's bin. Nothing shows */
/* at rest: the settings page has a row a service, the palette its     */
/* commands, and a failure says so once, in words.                     */
/* ------------------------------------------------------------------ */

import { Notice, TFolder } from 'obsidian';
import { Feature } from '../core/feature.js';
import { GOOGLE_DRIVE } from './google-drive.js';
import { ONEDRIVE } from './onedrive.js';
import { collapseRenames, forgetPath, movePaths, planBackup, readRecord, recorded } from './plan.js';
import { BackupError, Session, authorize, readLocal, readSecret, revoke, vaultKey, writeLocal, writeSecret } from './session.js';

// A minute after the last change, never more than ten behind, a while after opening, and again a while after failing.
const QUIET = 60 * 1000;
const MOST = 10 * 60 * 1000;
const START = 20 * 1000;
const RETRY = 5 * 60 * 1000;
// Files sent at once, and how often the record is saved along the way.
const AT_ONCE = 4;
const SAVE_EVERY = 25;

/** Runs `fn` over `items`, `n` at a time; the first failure that stops the run stops it. */
async function pool(items, n, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** When, in words: "today at 10:42", or "on 3 Nov at 10:42". */
function when(at) {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `today at ${time}` : `on ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`;
}

export class Backup extends Feature {
  constructor(plugin) {
    super(plugin);
    this.services = [GOOGLE_DRIVE, ONEDRIVE];
    this.sessions = new Map();
    this.waiting = new Map();
    this.renames = new Map();
    this.timer = null;
    this.since = 0;
    this.running = null;
    this.again = false;
  }

  /** The services this build can sign in to. */
  offered() {
    return this.services.filter((s) => !!(s.client && s.client.id));
  }

  secretId(service) {
    return `design-redux-backup-${service.id}-${vaultKey(this.app)}`;
  }

  signedIn(service) {
    return !!(service.client && service.client.id) && !!readSecret(this.app, this.secretId(service));
  }

  /** The services this vault is backed up to. */
  targets() {
    return this.offered().filter((s) => this.signedIn(s));
  }

  /** { account, at, error }: who is signed in, when the last backup ended well, and what went wrong since. On this machine only. */
  status(service) {
    return Object.assign({ account: '', at: 0, error: '' }, readLocal(this.app, `design-redux-backup-${service.id}`) || {});
  }

  keepStatus(service, change) {
    writeLocal(this.app, `design-redux-backup-${service.id}`, change ? Object.assign(this.status(service), change) : null);
    this.app.workspace.trigger('design-redux:backup');
  }

  session(service) {
    if (!this.sessions.has(service.id)) {
      const id = this.secretId(service);
      this.sessions.set(service.id, new Session(service, { get: () => readSecret(this.app, id), set: (v) => writeSecret(this.app, id, v) }));
    }
    return this.sessions.get(service.id);
  }

  enable() {
    const vault = this.app.vault;
    ['create', 'modify', 'delete'].forEach((name) => this.listen(vault, name, () => this.changed()));
    this.listen(vault, 'rename', (entry, from) => {
      this.targets().forEach((s) => {
        if (!this.renames.has(s.id)) this.renames.set(s.id, []);
        this.renames.get(s.id).push({ from, to: entry.path, folder: entry instanceof TFolder });
      });
      this.changed();
    });
    if (this.targets().length) this.schedule(START);
    this.add(() => {
      clearTimeout(this.timer);
      this.timer = null;
      this.waiting.forEach((w) => w.abort.abort());
    });
  }

  /** Something in the vault changed: a backup a minute after the last change, never more than ten behind the first. */
  changed() {
    if (!this.targets().length) return;
    this.since = this.since || Date.now();
    this.schedule(Math.max(0, Math.min(QUIET, this.since + MOST - Date.now())));
  }

  schedule(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.backUp();
    }, ms);
  }

  /** Backs up to every service signed in to. `told`: say so as it goes (a backup asked for). Resolves [{ service, sent, removed, failed, error }]. */
  async backUp(told = false) {
    if (this.running) {
      this.again = true;
      if (told) new Notice('A backup is running: this one comes after it.');
      return this.running;
    }
    clearTimeout(this.timer);
    this.timer = null;
    this.since = 0;
    this.running = (async () => {
      const done = [];
      for (const service of this.targets()) done.push(await this.backUpTo(service, told));
      return done;
    })();
    try {
      return await this.running;
    } finally {
      this.running = null;
      if (this.again && this.on) {
        this.again = false;
        this.changed();
      }
    }
  }

  /** Where a service's record is kept: beside the plugin, on this machine. */
  recordFile(service) {
    return `${this.plugin.manifest.dir}/backup-${service.id}.json`;
  }

  async readRecord(service, account) {
    const adapter = this.app.vault.adapter;
    const file = this.recordFile(service);
    const text = (await adapter.exists(file)) ? await adapter.read(file) : '';
    return readRecord(text, account);
  }

  async writeRecord(service, record) {
    await this.app.vault.adapter.write(this.recordFile(service), JSON.stringify(record));
  }

  /** One service's backup: renames moved there, what is gone taken away, what is new or changed sent. */
  async backUpTo(service, told) {
    const vault = this.app.vault;
    const { account } = this.status(service);
    const result = { service, sent: 0, removed: 0, failed: [], error: '' };
    const notice = told ? new Notice(`Backing up to ${service.name}…`, 0) : null;
    try {
      const record = await this.readRecord(service, account);
      const copy = service.copy(this.session(service), { vault: vault.getName(), key: vaultKey(this.app) }, record);
      await copy.prepare();
      const renames = collapseRenames(this.renames.get(service.id) || []);
      this.renames.set(service.id, []);
      // One thing the service refuses is passed over and said; what stops the run (signed out, full, offline) stops it.
      const passOver = async (path, fn) => {
        try {
          return await fn();
        } catch (err) {
          if (!(err instanceof BackupError) || err.fatal) throw err;
          result.failed.push({ path, why: err.message });
          return false;
        }
      };
      for (const { from, to, folder } of renames) {
        if (!recorded(record, from, folder) || recorded(record, to, folder)) continue;
        // A move refused there: it is taken away and sent again instead.
        if (await passOver(from, () => copy.move(from, to, folder))) movePaths(record, from, to);
      }
      result.failed.length = 0;
      const folders = new Set(vault.getAllFolders().map((f) => f.path));
      const { send, drop } = planBackup(vault.getFiles(), folders, record);
      for (const { path, folder } of drop) {
        if (await passOver(path, () => copy.remove(path, folder).then(() => true))) {
          forgetPath(record, path, folder);
          result.removed++;
        }
      }
      await pool(send, AT_ONCE, (file) => passOver(file.path, async () => {
        if (!vault.getAbstractFileByPath(file.path)) return;
        const stat = { mtime: file.stat.mtime, size: file.stat.size };
        const data = await vault.readBinary(file);
        record.files[file.path] = Object.assign({ mtime: stat.mtime, size: stat.size }, await copy.put(file.path, data, stat, record.files[file.path]));
        result.sent++;
        if (result.sent % SAVE_EVERY === 0) await this.writeRecord(service, record);
      }));
      await this.writeRecord(service, record);
      const first = result.failed[0];
      const error = first ? `${plural(result.failed.length, 'file was', 'files were')} not backed up; ${first.path}: ${first.why}` : '';
      if (error) this.tell(service, error, told);
      this.keepStatus(service, { at: Date.now(), error });
    } catch (err) {
      result.error = err instanceof BackupError ? err.message : `something went wrong (${err && err.message})`;
      if (err && err.code === 'signed-out') this.forget(service);
      this.tell(service, result.error, told);
      this.keepStatus(service, { error: result.error });
      if (this.on && this.targets().length) this.schedule(RETRY);
    }
    if (notice) {
      if (result.error) notice.hide();
      else notice.setMessage(result.sent || result.removed
        ? `Backed up to ${service.name}: ${plural(result.sent, 'file')} sent${result.removed ? `, ${result.removed} taken away` : ''}.`
        : `${service.name} already holds this vault as it is.`);
      if (!result.error) setTimeout(() => notice.hide(), 4000);
    }
    return result;
  }

  /** A failure, in words, once: a backup asked for says every one; one on its own only a new one. */
  tell(service, error, told) {
    if (told || this.status(service).error !== error) new Notice(`The backup to ${service.name} failed: ${error}.`);
  }

  /** Signs in in the browser, then backs up. A second ask while one waits shows the browser's page again. */
  async signIn(service) {
    const pending = this.waiting.get(service.id);
    if (pending) {
      if (pending.url) this.openUrl(pending.url);
      return;
    }
    const abort = new AbortController();
    const wait = { url: '', abort };
    this.waiting.set(service.id, wait);
    this.app.workspace.trigger('design-redux:backup');
    try {
      const tokens = await authorize(service, { signal: abort.signal, open: (url) => this.openUrl((wait.url = url)) });
      if (!tokens.refresh) throw new BackupError(`${service.name} gave no lasting sign-in`);
      this.sessions.delete(service.id);
      this.renames.delete(service.id);
      this.session(service).take(tokens);
      this.keepStatus(service, { account: tokens.account, at: 0, error: '' });
      new Notice(`Signed in to ${service.name}${tokens.account ? ` as ${tokens.account}` : ''}. The vault is being backed up there.`);
      this.waiting.delete(service.id);
      if (this.on) this.backUp();
    } catch (err) {
      if (!abort.signal.aborted) new Notice(`Not signed in to ${service.name}: ${err instanceof BackupError ? err.message : err && err.message}.`);
    } finally {
      this.waiting.delete(service.id);
      this.app.workspace.trigger('design-redux:backup');
    }
  }

  /** Opens a page in the person's browser. */
  openUrl(url) {
    activeWindow.open(url);
  }

  /** Forgets the sign-in on this machine; the copy there stays as it is. */
  forget(service) {
    writeSecret(this.app, this.secretId(service), '');
    this.sessions.delete(service.id);
    this.renames.delete(service.id);
  }

  async signOut(service) {
    const refresh = readSecret(this.app, this.secretId(service));
    this.forget(service);
    this.keepStatus(service, null);
    const adapter = this.app.vault.adapter;
    const file = this.recordFile(service);
    if (typeof adapter.remove === 'function' && (await adapter.exists(file))) await adapter.remove(file);
    await revoke(service, refresh);
    new Notice(`Signed out of ${service.name}. The backup there stays as it is.`);
  }

  /** The settings page's rows: [{ name, desc, error, button, run }], a service each this build offers. */
  rows() {
    return this.offered().map((service) => {
      const status = this.status(service);
      const name = service.name;
      if (this.waiting.has(service.id)) return { name, desc: 'Waiting for the browser: sign in there.', error: '', button: 'Show again', run: () => this.signIn(service) };
      if (!this.signedIn(service)) {
        return { name, desc: `Back up this vault to your ${name}, one way: what changes here is copied there, and what is deleted here goes to its bin.`, error: status.error, button: 'Sign in', run: () => this.signIn(service) };
      }
      const who = status.account ? `Signed in as ${status.account}.` : 'Signed in.';
      return { name, desc: `${who} ${status.at ? `Backed up ${when(status.at)}.` : 'Not backed up yet.'}`, error: status.error, button: 'Sign out', run: () => this.signOut(service) };
    });
  }

  actions() {
    const offered = (s) => !!(s.client && s.client.id);
    return [
      { id: 'backup-now', name: 'Back up now', when: () => this.targets().length > 0, run: () => this.backUp(true) },
      ...this.services.flatMap((s) => [
        { id: `backup-sign-in-${s.id}`, name: `Sign in to ${s.name} for backups`, when: () => offered(s) && !this.signedIn(s), run: () => this.signIn(s) },
        { id: `backup-sign-out-${s.id}`, name: `Sign out of ${s.name}`, when: () => this.signedIn(s), run: () => this.signOut(s) },
      ]),
    ];
  }
}
Backup.section = 'Backup';
Backup.about = 'The vault copied, one way, to Google Drive or OneDrive as it changes.';
