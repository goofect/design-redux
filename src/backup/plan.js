/* ------------------------------------------------------------------ */
/* The backup: what a run sends and takes away                         */
/*                                                                     */
/* A copy's record (kept per service, on this machine) holds what was  */
/* last sent: each file's path, its time and size as they were, and    */
/* the service's id for it where the service has ids. A run sends the  */
/* files that are new or changed since, and takes away what is gone    */
/* here: a folder gone once, not each file in it. A rename is moved    */
/* there, not sent again. Nothing here talks to a service.             */
/* ------------------------------------------------------------------ */

/** A record with nothing sent yet. `account` is who it was sent as: another account starts afresh. */
export function emptyRecord(account = '') {
  return { account, root: '', files: {}, folders: {} };
}

/** A record read from disk, or a fresh one when there is none, it is damaged, or it was another account's. */
export function readRecord(text, account) {
  try {
    const r = JSON.parse(text);
    if (r && typeof r.files === 'object' && r.account === account) return Object.assign(emptyRecord(account), r);
  } catch (err) {
    // A damaged record: the service's copy is looked for again, or everything is sent again.
  }
  return emptyRecord(account);
}

const under = (p, folder) => p.startsWith(`${folder}/`);
const ancestors = (p) => p.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'));

/**
 * What a run does: { send: [files new or changed], drop: [{ path, folder }] }.
 * `files` are the vault's files ({ path, stat }); `folders` the set of its folders' paths.
 */
export function planBackup(files, folders, record) {
  const here = new Set(files.map((f) => f.path));
  const send = files.filter((f) => {
    const was = record.files[f.path];
    return !was || was.mtime !== f.stat.mtime || was.size !== f.stat.size;
  });
  const goneFiles = Object.keys(record.files).filter((p) => !here.has(p));
  // The folders there: those the record names, and those its gone files were in.
  const there = new Set(Object.keys(record.folders || {}).filter(Boolean));
  goneFiles.forEach((p) => ancestors(p).forEach((a) => there.add(a)));
  const goneFolders = Array.from(there).filter((p) => !folders.has(p));
  const top = goneFolders.filter((p) => !goneFolders.some((q) => under(p, q))).sort();
  const drop = top.map((path) => ({ path, folder: true }))
    .concat(goneFiles.filter((p) => !top.some((q) => under(p, q))).sort().map((path) => ({ path, folder: false })));
  return { send, drop };
}

/** The record after a file or folder there was taken away. */
export function forgetPath(record, path, folder) {
  delete record.files[path];
  if (!folder) return;
  delete record.folders[path];
  Object.keys(record.files).filter((p) => under(p, path)).forEach((p) => delete record.files[p]);
  Object.keys(record.folders).filter((p) => under(p, path)).forEach((p) => delete record.folders[p]);
}

/** The record after a file or folder there was moved from `from` to `to`. */
export function movePaths(record, from, to) {
  const move = (map) => Object.keys(map).forEach((p) => {
    if (p !== from && !under(p, from)) return;
    map[to + p.slice(from.length)] = map[p];
    delete map[p];
  });
  move(record.files);
  move(record.folders);
}

/** Whether the record holds a path: as a file, or as a folder (named, or holding files). */
export function recorded(record, path, folder) {
  if (!folder) return !!record.files[path];
  return !!record.folders[path] || Object.keys(record.files).some((p) => under(p, path));
}

/**
 * The renames worth making there, in order: a folder's rename stands for
 * the renames of everything in it, which Obsidian reports one by one.
 */
export function collapseRenames(renames) {
  const folders = renames.filter((r) => r.folder);
  return renames.filter((r) => !folders.some((f) => f !== r && under(r.from, f.from) && r.to === f.to + r.from.slice(f.from.length)));
}
