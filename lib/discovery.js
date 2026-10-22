'use strict';
const fs = require('node:fs');
const { parseMounts } = require('./mounts');
const { validSourcePath } = require('./sources');
function createDiscovery({ getConfig, readMountinfo = () => fs.promises.readFile('/proc/self/mountinfo', 'utf8') }) {
  let state = { checkedAt: null, candidates: [], error: '' };
  const overlaps = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
  function current() { return { ...state, candidates: state.candidates.filter(candidate => !getConfig().sources.some(source => overlaps(source.path, candidate.path))) }; }
  async function refresh() {
    try {
      // Only mount points already visible to this LXC; never scan NAS directory trees.
      const mounts = parseMounts(await readMountinfo()).filter(mount => ['cifs','smb3','nfs','nfs4'].includes(mount.type) && validSourcePath(mount.target));
      const candidates = [];
      for (const mount of mounts.sort((a, b) => a.target.length - b.target.length)) {
        if (getConfig().sources.some(source => overlaps(source.path, mount.target)) || candidates.some(candidate => overlaps(candidate.path, mount.target))) continue;
        candidates.push({ path: mount.target, name: mount.target.split('/').at(-1), expectedSource: mount.source });
      }
      state = { checkedAt: new Date().toISOString(), candidates, error: '' };
    } catch { state = { checkedAt: new Date().toISOString(), candidates: [], error: 'Neue Mounts konnten nicht gelesen werden. Prüfe die Bind-Mounts im LXC.' }; }
    return current();
  }
  return { current, refresh };
}
module.exports = { createDiscovery };
