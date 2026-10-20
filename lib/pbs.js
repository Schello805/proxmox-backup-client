'use strict';
const { readJSON } = require('./storage');
const { parseSnapshots } = require('./pbs-format');
const { repositoryFor, targetConfig } = require('./targets');
function createPBS({ getConfig, environment, run, cacheFile: PBS_STATE, save }) {
  const caches = {}, connections = {}, requests = new Map();
  const fileFor = target => target === 'primary' ? PBS_STATE : PBS_STATE + '.secondary';
  for (const target of ['primary', 'secondary']) {
    try { caches[target] = readJSON(fileFor(target), { snapshots: [], checkedAt: null }); }
    catch { caches[target] = { snapshots: [], checkedAt: null, error: 'Lokaler PBS-Cache war unlesbar. Bestand erneut abrufen.' }; }
  }
  function keyFor(target) { return `${repositoryFor(getConfig(), target)}\n${targetConfig(getConfig(), target).namespace}`; }
  function current(target = 'primary') {
    const key = keyFor(target); // Also rejects unknown targets.
    return caches[target].key === key ? caches[target] : { snapshots: [], checkedAt: null, error: '' };
  }
  async function refresh(target = 'primary') {
    const repository = repositoryFor(getConfig(), target);
    if (!repository || !targetConfig(getConfig(), target).password) throw new Error('PBS-Zugang oder Datastore fehlt.');
    if (requests.has(target)) return requests.get(target);
    const key = keyFor(target), env = environment(target);
    const request = (async () => {
      try {
        const { stdout } = await run('proxmox-backup-client', ['snapshot', 'list', '--output-format', 'json'], { env, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
        const snapshots = parseSnapshots(JSON.parse(stdout));
        caches[target] = { key, snapshots: snapshots.slice(0, 5000), count: snapshots.length, checkedAt: new Date().toISOString(), error: '' };
        save(fileFor(target), caches[target]);
        connections[target] = { ok: true, checkedAt: caches[target].checkedAt, message: 'PBS erreichbar. Snapshot-Bestand wurde gelesen.' };
      } catch (error) {
        const message = error.code === 'ENOENT' ? 'Backup Client fehlt.' : 'PBS-Abfrage fehlgeschlagen. Zugang, Datastore-Rechte, Fingerprint und Netzwerk prüfen.';
        caches[target] = { ...current(target), key, error: message, attemptedAt: new Date().toISOString() };
        save(fileFor(target), caches[target]);
        connections[target] = { ok: false, checkedAt: caches[target].attemptedAt, message };
      }
      return caches[target];
    })().finally(() => requests.delete(target));
    requests.set(target, request); return request;
  }
  async function connection(target = 'primary') { await refresh(target); return connections[target]; }
  return { refresh, current, connection, connections: () => ({ ...connections }), get lastConnection() { return connections.primary || null; }, get busy() { return requests.size > 0; }, invalidate() { for (const target of Object.keys(connections)) delete connections[target]; } };
}
module.exports = { createPBS };
