'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createProgressParser } = require('./progress');
function createBackups({ state, data: DATA, persist, getConfig, inspectPath, environment, log, archive, notify, isMaintenance = () => false, spawnProcess = spawn }) {
  const queue = []; let active = null, stopping = false;
  const sourceFor = id => getConfig().sources.find(source => source.id === id);
  const configured = () => Boolean(getConfig().repository && getConfig().password);
  const inspectFolder = id => inspectPath(sourceFor(id).path, sourceFor(id).expectedSource);
  function enqueue(id, source) {
    if (isMaintenance()) throw Object.assign(new Error('Update läuft. Neue Backups sind vorübergehend gesperrt.'), { status: 409 });
    if (!sourceFor(id)) throw new Error('Unbekannter Auftrag.');
    if (!configured()) throw new Error('Zuerst PBS-Repository und Passwort konfigurieren.');
    if (['running','queued'].includes(state.jobs[id]?.status)) throw new Error('Auftrag läuft bereits oder wartet.');
    state.jobs[id] = { ...state.jobs[id], status: 'queued', error: '', progress: null, source, runId: crypto.randomUUID(), startedAt: null, endedAt: null, exitCode: null };
    fs.writeFileSync(path.join(DATA, id + '.log'), 'Auftrag wartet auf Ausführung.\n', { mode: 0o600 });
    queue.push(id); persist(); void drain();
  }
  async function drain() { const config = getConfig();
    if (active || stopping || !queue.length) return;
    const id = queue.shift(), source = sourceFor(id); active = { folder: id, child: null };
    const job = state.jobs[id]; Object.assign(job, { status: 'running', runId: crypto.randomUUID(), startedAt: new Date().toISOString(), endedAt: null, exitCode: null, path: source.path, repository: config.repository, namespace: config.namespace });
    fs.writeFileSync(path.join(DATA, id + '.log'), '', { mode: 0o600 });
    log(id, `${job.startedAt} · Prüfe ${source.path}\n`); persist();
    const mount = await inspectFolder(id); if (stopping) return;
    if (!mount.ok) { finish(id, null, mount.error); return; }
    log(id, `SMB eingebunden: ${mount.mount.source} → ${mount.mount.target} (${mount.mount.type})\nBackup startet …\n`);
    const child = spawnProcess('proxmox-backup-client', ['backup', `qnap-${id}.pxar:${source.path}`, '--backup-type', 'host', '--backup-id', id, '--crypt-mode', 'none'], { env: environment(), stdio: ['ignore','pipe','pipe'] });
    active.child = child; let error = '';
    const progress = createProgressParser(value => {
      // An older client's final summary is a fallback, not a replacement for live upload counters.
      if (value.uploadedBytes !== null || !job.progress) job.progress = value;
    });
    child.stdout.on('data', data => { progress.push(data, 'stdout'); log(id, data.toString()); }); child.stderr.on('data', data => { progress.push(data, 'stderr'); log(id, data.toString()); });
    child.on('error', e => { error = e.code === 'ENOENT' ? 'proxmox-backup-client ist nicht installiert.' : 'Backup-Prozess konnte nicht gestartet werden.'; });
    child.on('close', (code, signal) => { progress.end(); finish(id, code, error || (signal ? `Prozess durch ${signal} beendet.` : code === 0 ? '' : `Backup fehlgeschlagen (Exit-Code ${code}).`)); });
  }
  function finish(id, code, error) {
    const job = state.jobs[id]; job.status = !error && code === 0 ? 'success' : 'failed';
    job.error = error; job.exitCode = code; job.endedAt = new Date().toISOString();
    if (job.status === 'success') job.lastSuccess = job.endedAt;
    log(id, `\n${job.endedAt} · ${error || 'Backup erfolgreich.'}\n`); archive(id, job); persist();
    if (error) notify(`run/${job.runId}`, `${sourceFor(id).name}: Backup fehlgeschlagen. Details in Backup Control prüfen.`);
    active = null; void drain();
  }
  return { enqueue, get active() { return active; }, get queue() { return [...queue]; }, get busy() { return Boolean(active || queue.length); }, stop(signal = 'SIGTERM') { stopping = true; active?.child?.kill(signal); } };

}
module.exports = { createBackups };
