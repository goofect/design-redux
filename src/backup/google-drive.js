/* ------------------------------------------------------------------ */
/* The backup: Google Drive                                            */
/*                                                                     */
/* The vault is copied into a folder of its own at the top of the      */
/* person's Drive, "<vault> backup", folders as folders. The plugin    */
/* asks only to see the files it made (drive.file), never the rest of  */
/* the Drive. Drive names things by id, so the record keeps each one's */
/* id; each file also carries the time it was sent at, so a lost       */
/* record is rebuilt from the Drive rather than everything sent again. */
/* What is taken away goes to the Drive's bin.                         */
/* ------------------------------------------------------------------ */

import { BACKUP_CLIENTS } from './session.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
// Above this, a file is sent in a session of its own rather than in one request.
const ONE_REQUEST = 5 * 1024 * 1024;

const TYPES = { md: 'text/markdown', canvas: 'application/json', json: 'application/json', txt: 'text/plain', css: 'text/css', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', mp3: 'audio/mpeg', mp4: 'video/mp4' };
const typeOf = (path) => TYPES[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p) => p.split('/').pop();

/** A request's body: the file's details and its bytes, as Drive takes them in one request. */
function multipart(boundary, meta, data, type) {
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const out = new Uint8Array(head.length + data.byteLength + tail.length);
  out.set(head, 0);
  out.set(new Uint8Array(data), head.length);
  out.set(tail, head.length + data.byteLength);
  return out.buffer;
}

const header = (res, name) => {
  const headers = res.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : '';
};

/** The copy of one vault in one Drive. */
class DriveCopy {
  constructor(session, place, record) {
    this.s = session;
    this.place = place;
    this.r = record;
    this.making = new Map();
  }

  /** Finds the vault's folder (its record's, or one the plugin made before), or makes it. */
  async prepare() {
    const r = this.r;
    if (r.root) {
      const res = await this.s.call({ url: `${API}/${r.root}?fields=id,trashed`, ok: [404] });
      if (res.status === 404 || res.json.trashed) Object.assign(r, { root: '', files: {}, folders: {} });
    }
    if (r.root) return;
    const q = `appProperties has { key='drVault' and value='${this.place.key}' } and mimeType='${FOLDER}' and trashed=false`;
    const found = await this.s.call({ url: `${API}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1` });
    const hit = (found.json.files || [])[0];
    if (hit) {
      r.root = hit.id;
      await this.scan();
    } else {
      r.root = (await this.create({ name: `${this.place.vault} backup`, mimeType: FOLDER, appProperties: { drVault: this.place.key } })).id;
    }
  }

  /** Rebuilds the record from what the Drive holds under the vault's folder. */
  async scan() {
    const all = new Map();
    let page = '';
    do {
      const res = await this.s.call({ url: `${API}?q=${encodeURIComponent('trashed=false')}&pageSize=1000&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,parents,size,appProperties)')}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}` });
      (res.json.files || []).forEach((f) => all.set(f.id, f));
      page = res.json.nextPageToken || '';
    } while (page);
    const paths = new Map([[this.r.root, '']]);
    const pathOf = (id, seen = 0) => {
      if (paths.has(id)) return paths.get(id);
      const f = all.get(id);
      const up = f && f.parents && f.parents[0];
      const above = up && seen < 64 ? pathOf(up, seen + 1) : null;
      const p = above == null ? null : above ? `${above}/${f.name}` : f.name;
      paths.set(id, p);
      return p;
    };
    all.forEach((f) => {
      const p = pathOf(f.id);
      if (!p) return;
      if (f.mimeType === FOLDER) this.r.folders[p] = f.id;
      else if (f.appProperties && f.appProperties.mtime) this.r.files[p] = { id: f.id, mtime: Number(f.appProperties.mtime), size: Number(f.size) };
    });
  }

  async create(meta) {
    return (await this.s.call({ url: `${API}?fields=id`, method: 'POST', json: meta })).json;
  }

  /** A folder's id there, made (with those above it) if it isn't there yet. */
  folder(path) {
    if (!path) return Promise.resolve(this.r.root);
    if (this.r.folders[path]) return Promise.resolve(this.r.folders[path]);
    if (!this.making.has(path)) {
      this.making.set(path, (async () => {
        const parent = await this.folder(parentOf(path));
        const made = await this.create({ name: nameOf(path), mimeType: FOLDER, parents: [parent] });
        this.r.folders[path] = made.id;
        return made.id;
      })().finally(() => this.making.delete(path)));
    }
    return this.making.get(path);
  }

  /** Sends a file's details and bytes: to `id` (a new version of it) or as a new file. */
  async send(id, meta, data, path, ok) {
    const at = id ? `/${id}` : '';
    const method = id ? 'PATCH' : 'POST';
    const type = typeOf(path);
    if (data.byteLength <= ONE_REQUEST) {
      const boundary = `dr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      return this.s.call({ url: `${UPLOAD}${at}?uploadType=multipart&fields=id`, method, contentType: `multipart/related; boundary=${boundary}`, body: multipart(boundary, meta, data, type), ok });
    }
    const start = await this.s.call({ url: `${UPLOAD}${at}?uploadType=resumable&fields=id`, method, json: meta, headers: { 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(data.byteLength) }, ok });
    if (ok.includes(start.status)) return start;
    return this.s.call({ url: header(start, 'location'), method: 'PUT', contentType: type, body: data });
  }

  /** Sends a file; resolves what the record keeps of it there. */
  async put(path, data, stat, was) {
    const meta = { appProperties: { mtime: String(stat.mtime) }, modifiedTime: new Date(stat.mtime).toISOString() };
    if (was && was.id) {
      const res = await this.send(was.id, meta, data, path, [404]);
      if (res.status !== 404) return { id: was.id };
    }
    const fresh = () => this.folder(parentOf(path)).then((parent) => this.send('', Object.assign({ name: nameOf(path), parents: [parent] }, meta), data, path, [404]));
    let res = await fresh();
    // The folder it goes in was taken away there since: made again.
    if (res.status === 404) {
      delete this.r.folders[parentOf(path)];
      res = await fresh();
    }
    return { id: res.json.id };
  }

  /** Puts a file or folder there in the Drive's bin. */
  async remove(path, folder) {
    const id = folder ? this.r.folders[path] : (this.r.files[path] || {}).id;
    if (id) await this.s.call({ url: `${API}/${id}?fields=id`, method: 'PATCH', json: { trashed: true }, ok: [404] });
  }

  /** Moves a file or folder there; false when it can't be, and it is sent again instead. */
  async move(from, to, folder) {
    const id = folder ? this.r.folders[from] : (this.r.files[from] || {}).id;
    if (!id) return false;
    const now = await this.s.call({ url: `${API}/${id}?fields=parents`, ok: [404] });
    if (now.status === 404) return false;
    const old = (now.json.parents || [])[0];
    const parent = await this.folder(parentOf(to));
    const where = old && old !== parent ? `&addParents=${parent}&removeParents=${old}` : '';
    const res = await this.s.call({ url: `${API}/${id}?fields=id${where}`, method: 'PATCH', json: { name: nameOf(to) }, ok: [404] });
    return res.status !== 404;
  }
}

export const GOOGLE_DRIVE = {
  id: 'google-drive',
  name: 'Google Drive',
  get client() {
    return BACKUP_CLIENTS.google;
  },
  loopback: '127.0.0.1',
  auth: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    scope: 'openid email https://www.googleapis.com/auth/drive.file',
    // A lasting token, asked for every time: Google gives one only when the person agrees again.
    extra: { access_type: 'offline', prompt: 'consent' },
  },
  copy: (session, place, record) => new DriveCopy(session, place, record),
};
