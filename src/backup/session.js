/* ------------------------------------------------------------------ */
/* The backup: signing in, and the calls made once signed in           */
/*                                                                     */
/* A service is signed in to in the person's own browser. A page on    */
/* this machine (a port chosen then) waits for the browser to come     */
/* back with a code, which is traded for tokens (PKCE; the only secret */
/* in the plugin is Google's, which Google says an installed app       */
/* cannot keep). The lasting token is kept in Obsidian's secret        */
/* storage, per vault and per machine, never in data.json; the token   */
/* calls are made with is kept in memory and renewed when it runs out. */
/* The sign-in apps' ids come in at build, from the environment.       */
/* ------------------------------------------------------------------ */

import { requestUrl } from 'obsidian';

/* global DR_GOOGLE_CLIENT_ID, DR_GOOGLE_CLIENT_SECRET, DR_ONEDRIVE_CLIENT_ID */
/** The sign-in apps the build was given: an empty id leaves that service out. */
export const BACKUP_CLIENTS = {
  google: { id: typeof DR_GOOGLE_CLIENT_ID === 'string' ? DR_GOOGLE_CLIENT_ID : '', secret: typeof DR_GOOGLE_CLIENT_SECRET === 'string' ? DR_GOOGLE_CLIENT_SECRET : '' },
  onedrive: { id: typeof DR_ONEDRIVE_CLIENT_ID === 'string' ? DR_ONEDRIVE_CLIENT_ID : '' },
};

// How long the page on this machine waits for the browser.
const WAIT = 5 * 60 * 1000;

/** A failure in words. `code`: 'signed-out', 'offline', 'full'; `fatal`: the run stops, rather than one file being passed over. */
export class BackupError extends Error {
  constructor(message, code = '', fatal = false) {
    super(message);
    this.code = code;
    this.fatal = fatal;
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Who signed in, from the id token's claims: an address, or a name. */
function accountOf(idToken) {
  try {
    const part = String(idToken).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
    return claims.email || claims.preferred_username || claims.name || '';
  } catch (err) {
    return '';
  }
}

const jsonOf = (res) => {
  try {
    return res.json;
  } catch (err) {
    return null;
  }
};

/** Trades a code or a lasting token for tokens: { access, expires, refresh, account }. */
async function exchange(service, params) {
  const client = service.client;
  const body = Object.assign({ client_id: client.id }, client.secret ? { client_secret: client.secret } : {}, service.auth.scopeOnToken ? { scope: service.auth.scope } : {}, params);
  let res;
  try {
    res = await requestUrl({ url: service.auth.token, method: 'POST', contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams(body).toString(), throw: false });
  } catch (err) {
    throw new BackupError(`${service.name} could not be reached`, 'offline', true);
  }
  const json = jsonOf(res) || {};
  if (res.status >= 400 || !json.access_token) {
    if (json.error === 'invalid_grant' && params.grant_type === 'refresh_token') throw new BackupError(`${service.name} ended the sign-in: sign in again`, 'signed-out', true);
    throw new BackupError(`${service.name} refused the sign-in${json.error_description || json.error ? `: ${String(json.error_description || json.error).split('\n')[0]}` : ''}`, '', true);
  }
  return {
    access: json.access_token,
    expires: Date.now() + (Number(json.expires_in) || 3600) * 1000 - 60 * 1000,
    refresh: json.refresh_token || params.refresh_token || '',
    account: accountOf(json.id_token),
  };
}

/** The page the browser is shown once it is back: a line, nothing else. */
const page = (text) => `<!doctype html><html><head><meta charset="utf-8"><title>${escape(text)}</title></head><body style="font:13px/1.6 ui-monospace,Menlo,monospace;margin:48px">${escape(text)}</body></html>`;

/**
 * Signs in to a service in the browser. `open(url)` shows the service's page;
 * `signal` stops the wait. Resolves the tokens.
 */
export async function authorize(service, { open, signal } = {}) {
  const http = require('http');
  const verifier = random(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = random(16);
  const servers = [];
  let timer = null;
  try {
    const { code, redirect } = await new Promise((resolve, reject) => {
      let redirect = '';
      const stop = (err) => reject(err);
      timer = setTimeout(() => stop(new BackupError('the browser did not come back within five minutes')), WAIT);
      if (signal) signal.addEventListener('abort', () => stop(new BackupError('the sign-in was stopped')), { once: true });
      const handle = (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const got = url.searchParams;
        // Only the browser's return, with this sign-in's state, is listened to.
        if (url.pathname !== '/' || got.get('state') !== state) {
          res.writeHead(404);
          res.end();
          return;
        }
        const denied = got.get('error');
        res.writeHead(denied ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page(denied ? `Not signed in to ${service.name}. You can close this tab.` : `Signed in to ${service.name}. You can close this tab and go back to Obsidian.`));
        if (denied) stop(new BackupError(denied === 'access_denied' ? 'access was refused' : `${service.name} said ${denied}`));
        else resolve({ code: got.get('code'), redirect });
      };
      const main = http.createServer(handle);
      servers.push(main);
      main.on('error', (err) => stop(new BackupError(`no page could be opened on this machine (${err.code || err.message})`)));
      main.listen(0, '127.0.0.1', () => {
        const port = main.address().port;
        const host = service.loopback || '127.0.0.1';
        // A browser may look for "localhost" at ::1 first: the same page there too, where the machine has it.
        if (host === 'localhost') {
          const six = http.createServer(handle);
          six.on('error', () => {});
          six.listen(port, '::1');
          servers.push(six);
        }
        redirect = `http://${host}:${port}/`;
        const query = new URLSearchParams(Object.assign({
          client_id: service.client.id,
          redirect_uri: redirect,
          response_type: 'code',
          scope: service.auth.scope,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        }, service.auth.extra || {}));
        open(`${service.auth.authorize}?${query}`);
      });
    });
    return await exchange(service, { grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier });
  } finally {
    clearTimeout(timer);
    servers.forEach((s) => s.close());
  }
}

/** Ends a sign-in at the service, where it has a way to: best effort, never in the way of signing out. */
export async function revoke(service, refresh) {
  if (!service.auth.revoke || !refresh) return;
  try {
    await requestUrl({ url: service.auth.revoke, method: 'POST', contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams({ token: refresh }).toString(), throw: false });
  } catch (err) {
    // Offline: the token stays valid at the service until it runs out; it is gone from this machine all the same.
  }
}

/** This vault's own key: Obsidian's id for it where there is one, else its name, in letters, digits and dashes. */
export function vaultKey(app) {
  const raw = (typeof app.appId === 'string' && app.appId) || app.vault.getName();
  return String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vault';
}

/** Per vault, on this machine, not synced: Obsidian's local storage where there is one, else the window's. */
export function readLocal(app, key) {
  if (typeof app.loadLocalStorage === 'function') return app.loadLocalStorage(key) || null;
  try {
    return JSON.parse(activeWindow.localStorage.getItem(`${vaultKey(app)}-${key}`));
  } catch (err) {
    return null;
  }
}

export function writeLocal(app, key, value) {
  if (typeof app.saveLocalStorage === 'function') return void app.saveLocalStorage(key, value == null ? null : value);
  try {
    if (value == null) activeWindow.localStorage.removeItem(`${vaultKey(app)}-${key}`);
    else activeWindow.localStorage.setItem(`${vaultKey(app)}-${key}`, JSON.stringify(value));
  } catch (err) {
    // No storage: the sign-in lasts until Obsidian closes.
  }
}

/** A secret, kept in Obsidian's secret storage (1.11.4), or this vault's local storage before it. */
export function readSecret(app, id) {
  const store = app.secretStorage;
  if (store && typeof store.getSecret === 'function') return store.getSecret(id) || '';
  return readLocal(app, id) || '';
}

export function writeSecret(app, id, value) {
  const store = app.secretStorage;
  if (store && typeof store.setSecret === 'function') store.setSecret(id, value || '');
  else writeLocal(app, id, value || null);
}

/** Seconds a service asked to be left alone for, in milliseconds. */
const retryAfter = (res) => {
  const headers = res.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'retry-after');
  const s = key ? Number(headers[key]) : 0;
  return s > 0 ? Math.min(s, 60) * 1000 : 0;
};

/** A response that failed, in words: whether it stops the run, and why. */
function failure(service, res) {
  const json = jsonOf(res) || {};
  const error = json.error || {};
  const said = String(error.message || json.error_description || '').split('\n')[0].replace(/\.$/, '');
  const reasons = (error.errors || []).map((e) => e.reason).concat(error.code || []);
  if (res.status === 401) return new BackupError(`${service.name} ended the sign-in: sign in again`, 'signed-out', true);
  if (res.status === 507 || reasons.some((r) => /quota|insufficientStorage/i.test(r))) return new BackupError(`${service.name} is full`, 'full', true);
  if (res.status === 403) return new BackupError(`${service.name} refused${said ? `: ${said}` : ''}`, '', true);
  if (res.status >= 500 || res.status === 429) return new BackupError(`${service.name} is not answering (${res.status})`, 'offline', true);
  return new BackupError(said || `${service.name} answered ${res.status}`);
}

/** Calls to one service as the person signed in: the token added, renewed when it runs out, a busy service waited for. */
export class Session {
  /** `keep`: { get() the lasting token, set(token) }. */
  constructor(service, keep) {
    this.service = service;
    this.keep = keep;
    this.access = '';
    this.expires = 0;
    this.renewing = null;
  }

  /** Takes the tokens a sign-in gave. */
  take(tokens) {
    this.access = tokens.access;
    this.expires = tokens.expires;
    if (tokens.refresh) this.keep.set(tokens.refresh);
  }

  async token() {
    if (this.access && Date.now() < this.expires) return this.access;
    if (!this.renewing) {
      this.renewing = (async () => {
        const refresh = this.keep.get();
        if (!refresh) throw new BackupError(`not signed in to ${this.service.name}`, 'signed-out', true);
        const got = await exchange(this.service, { grant_type: 'refresh_token', refresh_token: refresh });
        this.access = got.access;
        this.expires = got.expires;
        if (got.refresh && got.refresh !== refresh) this.keep.set(got.refresh);
      })().finally(() => (this.renewing = null));
    }
    await this.renewing;
    return this.access;
  }

  /**
   * { url, method, json | body + contentType, headers, ok: [statuses answered, not thrown], bare: no token }.
   * Resolves the response; a failure throws a BackupError.
   */
  async call(req) {
    for (let attempt = 0; ; attempt++) {
      const headers = Object.assign({}, req.headers);
      if (!req.bare) headers.Authorization = `Bearer ${await this.token()}`;
      let res;
      try {
        res = await requestUrl({
          url: req.url,
          method: req.method || 'GET',
          headers,
          contentType: req.json ? 'application/json' : req.contentType,
          body: req.json ? JSON.stringify(req.json) : req.body,
          throw: false,
        });
      } catch (err) {
        if (attempt < 2) {
          await wait(1500 * (attempt + 1));
          continue;
        }
        throw new BackupError(`${this.service.name} could not be reached`, 'offline', true);
      }
      if ((req.ok || []).includes(res.status) || (res.status >= 200 && res.status < 300)) return res;
      if (res.status === 401 && !req.bare && attempt === 0) {
        this.access = '';
        continue;
      }
      const reasons = ((jsonOf(res) || {}).error || {}).errors || [];
      const busy = res.status === 429 || res.status >= 500 || (res.status === 403 && reasons.some((e) => /rateLimit/i.test(e.reason)));
      if (busy && attempt < 4) {
        await wait(retryAfter(res) || 1000 * 2 ** attempt);
        continue;
      }
      throw failure(this.service, res);
    }
  }
}
