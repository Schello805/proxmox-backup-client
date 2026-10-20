'use strict';
const fs = require('node:fs');
const { mountFor, mountIssue, mountIdentity } = require('./mounts');
// Read local mount metadata immediately; SMB I/O runs once per source in the background.
function createMountStatus({ inspectPath, readMountinfo = () => fs.promises.readFile('/proc/self/mountinfo', 'utf8'), now = Date.now }) {
  const cache = new Map();
  function check(source, entry) {
    if (entry.pending) return;
    entry.pending = true;
    void Promise.resolve().then(() => inspectPath(source.path, source.expectedSource)).then(result => {
      if (cache.get(source.path) === entry) {
        entry.result = !result.mount || mountIdentity(result.mount) === entry.identity ? result : { ok: false, error: 'Mount während der Prüfung geändert. Erneut aktualisieren.' }; entry.checkedAt = new Date(now()).toISOString();
      }
    }).catch(() => { entry.result = { ok: false, error: 'Mount-Prüfung fehlgeschlagen.' }; }).finally(() => { entry.pending = false; entry.finished = now(); });
  }
  async function read(sources, fresh = false) {
    let mounts;
    try { mounts = await readMountinfo(); } catch { return sources.map(source => ({ path: source.path, ok: false, error: 'Linux-Mountinfo nicht lesbar.' })); }
    const paths = new Set(sources.map(source => source.path));
    for (const key of cache.keys()) if (!paths.has(key)) cache.delete(key);
    return sources.map(source => {
      const mount = mountFor(source.path, mounts), error = mountIssue(mount, source.expectedSource);
      const identity = mountIdentity(mount) + JSON.stringify(source.expectedSource);
      let entry = cache.get(source.path);
      if (!entry || entry.key !== identity) {
        entry = { key: identity, identity: mountIdentity(mount), result: null, pending: false, finished: 0 };
        cache.set(source.path, entry);
      }
      if (error) return { path: source.path, mount, ok: false, error };
      if (fresh || !entry.result || now() - entry.finished >= 15000) check(source, entry);
      return { path: source.path, mount, ...(entry.result || { ok: false, error: '' }), checking: entry.pending, checkedAt: entry.checkedAt || null };
    });
  }
  return { read };
}
module.exports = { createMountStatus };
