'use strict';
const { readJSON } = require('./storage');
const { parseSnapshots } = require('./pbs-format');
function createPBS({ getConfig, environment, run, cacheFile: PBS_STATE, save }) {
  const configured = () => Boolean(getConfig().repository && getConfig().password);
  let lastConnection = null;
  let pbs; try { pbs = readJSON(PBS_STATE, { snapshots: [], checkedAt: null }); } catch { pbs = { snapshots: [], checkedAt: null, error: 'Lokaler PBS-Cache war unlesbar. Bestand erneut abrufen.' }; }
  const pbsKey = () => `${getConfig().repository}\n${getConfig().namespace}`;
  function currentPBS() { return pbs.key === pbsKey() ? pbs : { snapshots: [], checkedAt: null, error: '' }; }
  let pbsRequest = null;
  async function refreshPBS() {
    if (!configured()) throw new Error('PBS-Zugang fehlt.');
    if (pbsRequest) return pbsRequest;
    const key = pbsKey(), env = environment();
    pbsRequest = (async () => {
      try {
        const { stdout } = await run('proxmox-backup-client', ['snapshot','list','--output-format','json'], { env, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
        const snapshots = parseSnapshots(JSON.parse(stdout));
        pbs = { key, snapshots: snapshots.slice(0,5000), count: snapshots.length, checkedAt: new Date().toISOString(), error: '' }; save(PBS_STATE, pbs);
        lastConnection = { ok: true, checkedAt: pbs.checkedAt, message: 'PBS erreichbar. Snapshot-Bestand wurde gelesen.' };
      } catch (e) {
        const message = e.code === 'ENOENT' ? 'Backup Client fehlt.' : 'PBS-Abfrage fehlgeschlagen. Zugang, Rechte, Fingerprint und Netzwerk prüfen.';
        pbs = { ...currentPBS(), key, error: message, attemptedAt: new Date().toISOString() }; save(PBS_STATE, pbs);
        lastConnection = { ok: false, checkedAt: pbs.attemptedAt, message };
      }
      return pbs;
    })().finally(() => pbsRequest = null);
    return pbsRequest;
  }
  async function connection() { await refreshPBS(); return lastConnection; }
  return { refresh: refreshPBS, current: currentPBS, connection, get lastConnection() { return lastConnection; }, get busy() { return Boolean(pbsRequest); }, invalidate() { lastConnection = null; } };

}
module.exports = { createPBS };
