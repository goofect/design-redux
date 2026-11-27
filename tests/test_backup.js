/*
 * The backup: signing in in the browser (a page on this machine, PKCE, the
 * lasting token in Obsidian's secret storage and never in data.json); one way
 * to Google Drive and to OneDrive, each stood in for by a fake service here;
 * a second run sends nothing; a change sends one file, a deletion goes to the
 * bin, a folder deleted goes once, a rename is moved; a lost record is rebuilt
 * from Drive; a token that runs out is renewed, one ended signs out, in red.
 */
const assert = require('assert');
const http = require('http');
const { load, world, suite, settle, obsidian } = require('./harness.js');

const dr = load();
const check = suite('backup');
const { requestUrl } = obsidian;

const VAULT = {
  'Logic/Validity.md': 'valid',
  'Logic/Week 2.md': 'week two',
  'Logic/Proofs/Induction.md': 'induction',
  'Politics/Anarchy.md': 'anarchy',
  'Home.md': 'home',
};

const jwt = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const form = (body) => Object.fromEntries(new URLSearchParams(body));
const textOf = (body) => (typeof body === 'string' ? body : new TextDecoder().decode(body));

/** A token endpoint: a code traded once, a lasting token renewed until `ended`. */
function tokens(prefix, account, fake) {
  return (req) => {
    const f = form(req.body);
    fake.tokenCalls.push(f);
    if (f.grant_type === 'authorization_code') {
      if (f.code !== 'good-code' || !f.code_verifier) return { status: 400, json: { error: 'invalid_grant' } };
      return { json: { access_token: `${prefix}-access-1`, expires_in: 3600, refresh_token: `${prefix}-refresh`, id_token: jwt(account) } };
    }
    if (f.refresh_token !== `${prefix}-refresh` || fake.ended) return { status: 400, json: { error: 'invalid_grant' } };
    return { json: { access_token: `${prefix}-access-${fake.tokenCalls.length}`, expires_in: 3600 } };
  };
}

/** Google Drive, stood in for: files by id, each with its parents. */
function fakeDrive() {
  const fake = { files: new Map(), sessions: new Map(), n: 0, tokenCalls: [], ended: false, refuse: null, expireOnce: false };
  const made = (meta, data) => {
    const id = `g${++fake.n}`;
    fake.files.set(id, { id, name: meta.name, mimeType: meta.mimeType || 'text/markdown', parents: meta.parents || ['root'], appProperties: meta.appProperties || {}, trashed: false, data, size: data == null ? undefined : String(data.length) });
    return { json: { id } };
  };
  const parts = (req) => {
    const boundary = /boundary=(.+)$/.exec(req.contentType)[1];
    const [meta, data] = textOf(req.body).split(`--${boundary}`).slice(1, 3).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4, -2));
    return { meta: JSON.parse(meta), data };
  };
  const token = tokens('g', { email: 'reader@example.com' }, fake);
  fake.handle = (req) => {
    const url = new URL(req.url);
    const method = req.method || 'GET';
    if (url.host === 'oauth2.googleapis.com') return url.pathname === '/token' ? token(req) : { status: 200 };
    if (fake.expireOnce) {
      fake.expireOnce = false;
      return { status: 401, json: { error: { message: 'Invalid Credentials' } } };
    }
    assert.ok(/^Bearer g-access-/.test(req.headers.Authorization), `no token on ${req.url}`);
    const id = (/\/files\/([^/?]+)/.exec(url.pathname) || [])[1];
    const file = id && fake.files.get(id);
    if (url.searchParams.get('upload_id')) {
      const pending = fake.sessions.get(url.searchParams.get('upload_id'));
      const data = textOf(req.body);
      if (pending.id) {
        Object.assign(fake.files.get(pending.id), { data, size: String(data.length), appProperties: pending.meta.appProperties });
        return { json: { id: pending.id } };
      }
      return made(pending.meta, data);
    }
    if (url.searchParams.get('uploadType') === 'resumable') {
      if (method === 'PATCH' && !file) return { status: 404, json: { error: { message: 'File not found' } } };
      const sid = `s${fake.sessions.size + 1}`;
      fake.sessions.set(sid, { meta: JSON.parse(req.body), id: method === 'PATCH' ? id : '' });
      return { headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${sid}` }, json: {} };
    }
    if (url.pathname.startsWith('/upload/')) {
      const { meta, data } = parts(req);
      if (fake.refuse && meta.name === fake.refuse) return { status: 400, json: { error: { message: 'That name is not taken' } } };
      if (method === 'POST') return made(meta, data);
      if (!file) return { status: 404, json: { error: { message: 'File not found' } } };
      Object.assign(file, { data, size: String(data.length), appProperties: meta.appProperties });
      return { json: { id } };
    }
    if (method === 'GET' && !id) {
      const q = url.searchParams.get('q');
      const vault = /value='([^']+)'/.exec(q);
      const all = Array.from(fake.files.values()).filter((f) => !f.trashed);
      return { json: { files: vault ? all.filter((f) => f.appProperties.drVault === vault[1]) : all } };
    }
    if (method === 'POST') return made(req.body ? JSON.parse(req.body) : {}, null);
    if (!file) return { status: 404, json: { error: { message: 'File not found' } } };
    if (method === 'GET') return { json: file };
    const change = JSON.parse(req.body);
    if (change.trashed) file.trashed = true;
    if (change.name) file.name = change.name;
    if (url.searchParams.get('addParents')) file.parents = [url.searchParams.get('addParents')];
    return { json: { id } };
  };
  /** The vault's folder there, as { path: text }. */
  fake.tree = () => {
    const root = Array.from(fake.files.values()).find((f) => f.appProperties.drVault && !f.trashed);
    const pathOf = (f) => {
      if (f.trashed) return null;
      const up = fake.files.get(f.parents[0]);
      if (!up) return null;
      if (up === root) return f.name;
      const above = pathOf(up);
      return above && `${above}/${f.name}`;
    };
    const out = {};
    fake.files.forEach((f) => {
      const p = pathOf(f);
      if (p && f.data != null) out[p] = f.data;
    });
    return out;
  };
  return fake;
}

/** OneDrive, stood in for: items by path under the app's folder. */
function fakeOneDrive() {
  const ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
  const fake = { items: new Map(), sessions: new Map(), pieces: 0, n: 0, tokenCalls: [], ended: false };
  const token = tokens('m', { preferred_username: 'reader@example.org' }, fake);
  const folders = (p) => p.split('/').slice(0, -1).forEach((_, i, a) => {
    const f = a.slice(0, i + 1).join('/');
    if (!fake.items.has(f)) fake.items.set(f, { id: `m${++fake.n}`, folder: true });
  });
  fake.handle = (req) => {
    if (req.url.startsWith('https://login.microsoftonline.com/')) return token(req);
    if (req.url.startsWith('https://upload.fake/')) {
      assert.ok(!req.headers.Authorization, 'a token sent with an upload session\'s piece');
      const up = fake.sessions.get(req.url);
      const [, start, end, total] = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers['Content-Range']).map(Number);
      assert.strictEqual(start, up.data.length, 'a piece out of order');
      up.data += textOf(req.body);
      fake.pieces++;
      if (end + 1 < total) return { status: 202, json: {} };
      folders(up.path);
      fake.items.set(up.path, { id: `m${++fake.n}`, data: up.data });
      return { status: 201, json: { id: fake.items.get(up.path).id } };
    }
    assert.ok(/^Bearer m-access-/.test(req.headers.Authorization), `no token on ${req.url}`);
    const method = req.method || 'GET';
    if (req.url === `${ROOT}/children`) {
      const { name } = JSON.parse(req.body);
      if (fake.items.has(name)) return { status: 409 };
      fake.items.set(name, { id: `m${++fake.n}`, folder: true });
      return { status: 201, json: {} };
    }
    const [, rest, action] = /^:\/(.*?)(?::\/(content|children|createUploadSession))?$/.exec(req.url.slice(ROOT.length));
    const path = rest.split('/').map(decodeURIComponent).join('/');
    if (action === 'createUploadSession') {
      const at = `https://upload.fake/${fake.sessions.size + 1}`;
      fake.sessions.set(at, { path, data: '' });
      return { json: { uploadUrl: at } };
    }
    if (action === 'content') {
      folders(path);
      fake.items.set(path, { id: `m${++fake.n}`, data: textOf(req.body) });
      return { status: 201, json: { id: fake.items.get(path).id } };
    }
    const item = fake.items.get(path);
    if (method === 'GET') return item ? { json: { id: item.id } } : { status: 404, json: { error: { message: 'Item not found' } } };
    if (!item) return { status: 404, json: { error: { message: 'Item not found' } } };
    const inside = Array.from(fake.items.keys()).filter((p) => p === path || p.startsWith(`${path}/`));
    if (method === 'DELETE') {
      inside.forEach((p) => fake.items.delete(p));
      return { status: 204 };
    }
    const change = JSON.parse(req.body);
    const parent = change.parentReference ? Array.from(fake.items.keys()).find((p) => fake.items.get(p).id === change.parentReference.id) : path.split('/').slice(0, -1).join('/');
    const to = `${parent}/${change.name}`;
    inside.forEach((p) => {
      fake.items.set(to + p.slice(path.length), fake.items.get(p));
      fake.items.delete(p);
    });
    return { json: { id: item.id } };
  };
  fake.tree = (vault = 'Seminar') => {
    const out = {};
    fake.items.forEach((it, p) => {
      if (!it.folder && p.startsWith(`${vault}/`)) out[p.slice(vault.length + 1)] = it.data;
    });
    return out;
  };
  return fake;
}

/** The browser, stood in for: it goes to the service's page and comes back to the one on this machine with a code. */
function browser(code = 'good-code') {
  const seen = [];
  const open = (url) => {
    seen.push(url);
    const q = new URL(url).searchParams;
    setTimeout(() => http.get(`${q.get('redirect_uri')}?code=${code}&state=${q.get('state')}`, (res) => res.resume()), 0);
  };
  return { seen, open };
}

const uploads = () => requestUrl.log.filter((r) => /\/upload\/|:\/content$/.test(r.url));
const VAULT_TEXT = () => Object.fromEntries(Object.entries(VAULT));

/** A vault, the build given both sign-in apps, and its backup. */
async function backedUp(files = VAULT) {
  dr.BACKUP_CLIENTS.google.id = 'google-app';
  dr.BACKUP_CLIENTS.google.secret = 'google-secret';
  dr.BACKUP_CLIENTS.onedrive.id = 'microsoft-app';
  const w = await world(files);
  const backup = w.plugin.feature(dr.Backup);
  return { w, backup };
}

async function signedIn(service, fake) {
  const { w, backup } = await backedUp();
  requestUrl.handler = fake.handle;
  requestUrl.log.length = 0;
  const b = browser();
  backup.openUrl = b.open;
  await backup.signIn(service);
  await (backup.running || Promise.resolve());
  return { w, backup, seen: b.seen };
}

(async () => {
  await check('with no sign-in apps in the build, the backup offers nothing: no rows, and its commands never apply', async () => {
    const w = await world(VAULT);
    const backup = w.plugin.feature(dr.Backup);
    assert.deepStrictEqual(backup.rows(), []);
    ['backup-now', 'backup-sign-in-google-drive', 'backup-sign-in-onedrive', 'backup-sign-out-google-drive', 'backup-sign-out-onedrive'].forEach((id) => {
      const c = w.app.commands.commands[`design-redux:${id}`];
      assert.ok(c, `${id} is not a command`);
      assert.strictEqual(c.checkCallback(true), false, `${id} applies`);
    });
    w.plugin.unload();
  });

  await check('signing in to Google Drive: the browser sent there with PKCE, the token kept in secret storage and not in data.json, the vault copied, folders as folders', async () => {
    const drive = fakeDrive();
    const { w, backup, seen } = await signedIn(dr.GOOGLE_DRIVE, drive);
    const q = new URL(seen[0]).searchParams;
    assert.strictEqual(q.get('client_id'), 'google-app');
    assert.strictEqual(q.get('code_challenge_method'), 'S256');
    assert.ok(/drive\.file/.test(q.get('scope')) && !/auth\/drive( |$)/.test(q.get('scope')), 'more than its own files asked for');
    assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/$/.test(q.get('redirect_uri')));
    assert.strictEqual(drive.tokenCalls[0].client_secret, 'google-secret');
    assert.strictEqual(w.app.secretStorage.getSecret(backup.secretId(dr.GOOGLE_DRIVE)), 'g-refresh');
    assert.ok(!JSON.stringify(w.plugin._data || {}).includes('g-refresh'), 'the token is in data.json');
    assert.deepStrictEqual(drive.tree(), VAULT_TEXT());
    const root = Array.from(drive.files.values()).find((f) => f.appProperties.drVault);
    assert.strictEqual(root.name, 'Seminar backup');
    assert.strictEqual(Array.from(drive.files.values()).filter((f) => f.name === 'Logic').length, 1, 'a folder made twice');
    assert.strictEqual(backup.status(dr.GOOGLE_DRIVE).account, 'reader@example.com');
    assert.ok(backup.status(dr.GOOGLE_DRIVE).at > 0);
    assert.ok(obsidian.Notice.log.some((n) => /Signed in to Google Drive as reader@example\.com/.test(n)));
    const row = backup.rows().find((r) => r.name === 'Google Drive');
    assert.strictEqual(row.button, 'Sign out');
    assert.ok(/^Signed in as reader@example\.com\. Backed up today at /.test(row.desc), row.desc);
    w.plugin.unload();
  });

  await check('a second run sends nothing; a change sends that file again, to the same file there', async () => {
    const drive = fakeDrive();
    const { w, backup } = await signedIn(dr.GOOGLE_DRIVE, drive);
    requestUrl.log.length = 0;
    await backup.backUp();
    assert.strictEqual(uploads().length, 0);
    await w.app.vault.modify(w.file('Home.md'), 'home, again');
    await backup.backUp();
    assert.strictEqual(uploads().length, 1);
    assert.ok(/\/files\/g\d+\?uploadType=multipart/.test(uploads()[0].url) && uploads()[0].method === 'PATCH', 'a changed file was sent as a new one');
    assert.strictEqual(drive.tree()['Home.md'], 'home, again');
    w.plugin.unload();
  });

  await check('a note deleted goes to the bin there; a folder deleted goes once, not file by file; a folder renamed is moved, nothing sent again', async () => {
    const drive = fakeDrive();
    const { w, backup } = await signedIn(dr.GOOGLE_DRIVE, drive);
    await w.app.vault.delete(w.file('Home.md'));
    await w.app.vault.delete(w.file('Politics'));
    requestUrl.log.length = 0;
    await backup.backUp();
    const trashed = requestUrl.log.filter((r) => r.method === 'PATCH' && /"trashed":true/.test(r.body));
    assert.strictEqual(trashed.length, 2, 'not one for the note and one for the folder');
    const expected = VAULT_TEXT();
    delete expected['Home.md'];
    delete expected['Politics/Anarchy.md'];
    assert.deepStrictEqual(drive.tree(), expected);
    await w.app.vault.rename(w.file('Logic'), 'Reasoning');
    requestUrl.log.length = 0;
    await backup.backUp();
    assert.strictEqual(uploads().length, 0, 'a renamed folder was sent again');
    assert.deepStrictEqual(Object.keys(drive.tree()).sort(), ['Reasoning/Proofs/Induction.md', 'Reasoning/Validity.md', 'Reasoning/Week 2.md']);
    w.plugin.unload();
  });

  await check('a lost record is rebuilt from the Drive: no second folder, nothing sent again', async () => {
    const drive = fakeDrive();
    const { w, backup } = await signedIn(dr.GOOGLE_DRIVE, drive);
    await w.app.vault.adapter.remove(backup.recordFile(dr.GOOGLE_DRIVE));
    const before = drive.files.size;
    requestUrl.log.length = 0;
    await backup.backUp();
    assert.strictEqual(uploads().length, 0);
    assert.strictEqual(drive.files.size, before);
    w.plugin.unload();
  });

  await check('a token that ran out is renewed; a sign-in the service ended signs out, said once in a notice and in red on its row', async () => {
    const drive = fakeDrive();
    const { w, backup } = await signedIn(dr.GOOGLE_DRIVE, drive);
    await w.app.vault.modify(w.file('Home.md'), 'one');
    drive.expireOnce = true;
    await backup.backUp();
    assert.strictEqual(drive.tree()['Home.md'], 'one');
    assert.ok(drive.tokenCalls.some((c) => c.grant_type === 'refresh_token'), 'not renewed');
    drive.ended = true;
    backup.session(dr.GOOGLE_DRIVE).expires = 0;
    await w.app.vault.modify(w.file('Home.md'), 'two');
    obsidian.Notice.log.length = 0;
    await backup.backUp();
    assert.strictEqual(backup.signedIn(dr.GOOGLE_DRIVE), false);
    assert.ok(obsidian.Notice.log.some((n) => /The backup to Google Drive failed: Google Drive ended the sign-in: sign in again\./.test(n)), obsidian.Notice.log.join('\n'));
    const tab = new dr.SettingsTab(w.app, w.plugin);
    tab.display();
    const row = Array.from(tab.containerEl.querySelectorAll('.setting-item')).find((r) => r.querySelector('.setting-item-name').textContent === 'Google Drive');
    assert.strictEqual(row.querySelector('button').textContent, 'Sign in');
    const said = row.querySelector('.dr-backup-error[role="alert"]');
    assert.ok(said && /failed: Google Drive ended the sign-in/.test(said.textContent));
    w.plugin.unload();
  });

  await check('a file the service refuses is passed over and said; the rest are sent', async () => {
    const drive = fakeDrive();
    drive.refuse = 'Anarchy.md';
    const { w, backup } = await signedIn(dr.GOOGLE_DRIVE, drive);
    const expected = VAULT_TEXT();
    delete expected['Politics/Anarchy.md'];
    assert.deepStrictEqual(drive.tree(), expected);
    assert.ok(/^1 file was not backed up; Politics\/Anarchy\.md: That name is not taken$/.test(backup.status(dr.GOOGLE_DRIVE).error), backup.status(dr.GOOGLE_DRIVE).error);
    drive.refuse = null;
    await backup.backUp();
    assert.deepStrictEqual(drive.tree(), VAULT_TEXT());
    assert.strictEqual(backup.status(dr.GOOGLE_DRIVE).error, '');
    w.plugin.unload();
  });

  await check('OneDrive: the app folder asked for and nothing more, the vault copied by path, a deletion and a rename made there', async () => {
    const one = fakeOneDrive();
    const { w, backup, seen } = await signedIn(dr.ONEDRIVE, one);
    const q = new URL(seen[0]).searchParams;
    assert.ok(/Files\.ReadWrite\.AppFolder/.test(q.get('scope')) && /offline_access/.test(q.get('scope')));
    assert.ok(/^http:\/\/localhost:\d+\/$/.test(q.get('redirect_uri')));
    assert.ok(one.tokenCalls[0].scope && !one.tokenCalls[0].client_secret, 'a secret sent, or no scope');
    assert.deepStrictEqual(one.tree(), VAULT_TEXT());
    assert.strictEqual(backup.status(dr.ONEDRIVE).account, 'reader@example.org');
    await w.app.vault.delete(w.file('Home.md'));
    await w.app.vault.rename(w.file('Politics/Anarchy.md'), 'Logic/Anarchy.md');
    requestUrl.log.length = 0;
    await backup.backUp();
    assert.strictEqual(uploads().length, 0, 'a moved note was sent again');
    const expected = VAULT_TEXT();
    delete expected['Home.md'];
    expected['Logic/Anarchy.md'] = expected['Politics/Anarchy.md'];
    delete expected['Politics/Anarchy.md'];
    assert.deepStrictEqual(one.tree(), expected);
    w.plugin.unload();
  });

  await check('a large file goes in a session of its own: to Drive in one piece after the session is opened, to OneDrive in pieces with no token', async () => {
    const big = 'x'.repeat(5 * 1024 * 1024 + 7);
    const drive = fakeDrive();
    let { w, backup } = await signedIn(dr.GOOGLE_DRIVE, drive);
    await w.app.vault.create('Attachments/Big.md', big);
    await backup.backUp();
    assert.strictEqual(drive.tree()['Attachments/Big.md'].length, big.length);
    await w.app.vault.modify(w.file('Attachments/Big.md'), `${big}y`);
    await backup.backUp();
    assert.strictEqual(drive.tree()['Attachments/Big.md'].length, big.length + 1);
    assert.strictEqual(Array.from(drive.files.values()).filter((f) => f.name === 'Big.md').length, 1, 'a new version made a second file');
    w.plugin.unload();
    const one = fakeOneDrive();
    ({ w, backup } = await signedIn(dr.ONEDRIVE, one));
    await w.app.vault.create('Attachments/Big.md', big);
    await backup.backUp();
    assert.strictEqual(one.tree()['Attachments/Big.md'], big);
    assert.strictEqual(one.pieces, 1 + Math.floor(big.length / (32 * 320 * 1024)));
    w.plugin.unload();
  });

  await check('a change is backed up a minute after the last one, not at once', async () => {
    const drive = fakeDrive();
    const { w, backup } = await signedIn(dr.GOOGLE_DRIVE, drive);
    let asked = null;
    backup.schedule = (ms) => (asked = ms);
    await w.app.vault.modify(w.file('Home.md'), 'later');
    assert.strictEqual(asked, 60 * 1000);
    w.plugin.unload();
  });

  await check('offline, a backup waits: asked for, it says so and sends nothing; the network back, it runs', async () => {
    const drive = fakeDrive();
    const { w, backup } = await signedIn(dr.GOOGLE_DRIVE, drive);
    await w.app.vault.modify(w.file('Home.md'), 'written offline');
    const online = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window.navigator), 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    requestUrl.log.length = 0;
    assert.deepStrictEqual(await backup.backUp(true), []);
    assert.strictEqual(uploads().length, 0, 'something was sent offline');
    assert.ok(obsidian.Notice.log.some((n) => /Offline/.test(n)), 'nothing said the backup waits');
    delete window.navigator.onLine;
    if (online) assert.strictEqual(window.navigator.onLine, true);
    let asked = null;
    backup.schedule = (ms) => (asked = ms);
    window.dispatchEvent(new window.Event('online'));
    assert.strictEqual(asked, 0, 'the network back, the backup did not run');
    w.plugin.unload();
  });

  await check('signing out forgets the sign-in and the record on this machine, and leaves the copy there', async () => {
    const drive = fakeDrive();
    const { w, backup } = await signedIn(dr.GOOGLE_DRIVE, drive);
    const record = backup.recordFile(dr.GOOGLE_DRIVE);
    assert.ok(await w.app.vault.adapter.exists(record));
    w.app.commands.executeCommandById('design-redux:backup-sign-out-google-drive');
    await settle(8);
    assert.strictEqual(w.app.secretStorage.getSecret(backup.secretId(dr.GOOGLE_DRIVE)), null);
    assert.ok(!(await w.app.vault.adapter.exists(record)));
    assert.deepStrictEqual(drive.tree(), VAULT_TEXT());
    assert.strictEqual(w.app.commands.commands['design-redux:backup-now'].checkCallback(true), false);
    assert.strictEqual(backup.rows().find((r) => r.name === 'Google Drive').button, 'Sign in');
    w.plugin.unload();
  });

  await check('refused in the browser: not signed in, and said so', async () => {
    const { w, backup } = await backedUp();
    requestUrl.handler = fakeDrive().handle;
    backup.openUrl = browser('wrong-code').open;
    await backup.signIn(dr.GOOGLE_DRIVE);
    assert.strictEqual(backup.signedIn(dr.GOOGLE_DRIVE), false);
    assert.ok(obsidian.Notice.log.some((n) => /^Not signed in to Google Drive: Google Drive refused the sign-in/.test(n)), obsidian.Notice.log.join('\n'));
    w.plugin.unload();
  });

  requestUrl.handler = null;
  check.done();
})();
