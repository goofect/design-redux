/* ------------------------------------------------------------------ */
/* The backup: OneDrive                                                */
/*                                                                     */
/* The vault is copied into the plugin's own folder in the person's    */
/* OneDrive (Apps/<the app's name>/<vault>), folders as folders. The   */
/* plugin asks only for that folder (Files.ReadWrite.AppFolder), never */
/* the rest of the drive. OneDrive names things by path, so the record */
/* keeps no ids. What is taken away goes to OneDrive's recycle bin.    */
/* ------------------------------------------------------------------ */

import { BACKUP_CLIENTS } from './session.js';

const ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';
// Above this, a file is sent in a session of its own, in pieces of a multiple of 320 KiB.
const ONE_REQUEST = 4 * 1024 * 1024;
const PIECE = 32 * 320 * 1024;

const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p) => p.split('/').pop();

/** The copy of one vault in one OneDrive. */
class OneDriveCopy {
  constructor(session, place, record) {
    this.s = session;
    this.place = place;
    this.r = record;
  }

  /** A path in the vault as OneDrive's address for it, under the vault's folder. */
  url(path) {
    const parts = [this.place.vault].concat(path ? path.split('/') : []);
    return `${ROOT}:/${parts.map(encodeURIComponent).join('/')}`;
  }

  /** OneDrive makes the folders a path needs as a file is sent: nothing to do first. */
  async prepare() {}

  /** Makes a folder there and those above it, where OneDrive didn't. */
  async folders(path) {
    const parts = [''].concat(path ? path.split('/') : []);
    for (let i = 0; i < parts.length; i++) {
      const above = parts.slice(1, i).join('/');
      const where = i === 0 ? `${ROOT}/children` : `${this.url(above)}:/children`;
      const name = i === 0 ? this.place.vault : parts[i];
      await this.s.call({ url: where, method: 'POST', json: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }, ok: [409] });
    }
  }

  async upload(path, data, ok) {
    if (data.byteLength <= ONE_REQUEST) {
      return this.s.call({ url: `${this.url(path)}:/content`, method: 'PUT', contentType: 'application/octet-stream', body: data, ok });
    }
    const made = await this.s.call({ url: `${this.url(path)}:/createUploadSession`, method: 'POST', json: { item: { '@microsoft.graph.conflictBehavior': 'replace' } }, ok });
    if (ok.includes(made.status)) return made;
    const at = made.json.uploadUrl;
    let res = made;
    for (let start = 0; start < data.byteLength; start += PIECE) {
      const end = Math.min(start + PIECE, data.byteLength);
      // The session's address is its own permission: no token goes with it.
      res = await this.s.call({ url: at, method: 'PUT', bare: true, contentType: 'application/octet-stream', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${data.byteLength}` }, body: data.slice(start, end) });
    }
    return res;
  }

  /** Sends a file; OneDrive keeps it by its path, so the record keeps nothing more. */
  async put(path, data) {
    const res = await this.upload(path, data, [404]);
    if (res.status === 404) {
      await this.folders(parentOf(path));
      await this.upload(path, data, []);
    }
    return {};
  }

  /** Puts a file or folder there in OneDrive's recycle bin. */
  async remove(path) {
    await this.s.call({ url: this.url(path), method: 'DELETE', ok: [404] });
  }

  /** Moves a file or folder there; false when it can't be, and it is sent again instead. */
  async move(from, to) {
    const change = { name: nameOf(to) };
    if (parentOf(from) !== parentOf(to)) {
      let parent = await this.s.call({ url: this.url(parentOf(to)), ok: [404] });
      if (parent.status === 404) {
        await this.folders(parentOf(to));
        parent = await this.s.call({ url: this.url(parentOf(to)) });
      }
      change.parentReference = { id: parent.json.id };
    }
    const res = await this.s.call({ url: this.url(from), method: 'PATCH', json: change, ok: [404, 409] });
    return res.status < 300;
  }
}

export const ONEDRIVE = {
  id: 'onedrive',
  name: 'OneDrive',
  get client() {
    return BACKUP_CLIENTS.onedrive;
  },
  // Microsoft takes a page on this machine at http://localhost, on any port.
  loopback: 'localhost',
  auth: {
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid profile offline_access Files.ReadWrite.AppFolder',
    scopeOnToken: true,
    extra: { prompt: 'select_account' },
  },
  copy: (session, place, record) => new OneDriveCopy(session, place, record),
};
