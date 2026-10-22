'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createProgressParser } = require('./progress');
const { inWindow, rateArgs } = require('./backup-policy');
const { repositoryFor, targetConfig } = require('./targets');
function createBackups({ state, data: DATA, persist, getConfig, inspectPath, environment, log, archive, notify, verifySnapshot = null, isMaintenance = () => false, isBlocked = () => false, spawnProcess = spawn, getSourceSize = () => null, onBatchComplete = () => {}, cancelTimeout = 5000, now = () => new Date() }) {
  const queue = []; let batch = null; let active = null, stopping = false;
  state.queueControl ||= { paused: false };
  function waitingReason() { return isMaintenance() ? 'maintenance' : isBlocked() ? 'cloud' : state.queueControl.paused ? 'paused' : !inWindow(getConfig(), now()) ? 'window' : null; }
  const sourceFor = id => getConfig().sources.find(source => source.id === id);
  const configured = id => Boolean(repositoryFor(getConfig(), sourceFor(id)?.target) && targetConfig(getConfig(), sourceFor(id)?.target).password);
  const inspectFolder = id => inspectPath(sourceFor(id).path, sourceFor(id).expectedSource);
  function enqueue(id, source) {
    if (isMaintenance()) throw Object.assign(new Error('Update läuft. Neue Backups sind vorübergehend gesperrt.'), { status: 409 });
    if (!sourceFor(id)) throw new Error('Unbekannter Auftrag.');
    if (!configured(id)) throw new Error('Zuerst PBS-Repository und Passwort konfigurieren.');
    if (['running','queued','cancelling'].includes(state.jobs[id]?.status)) throw new Error('Auftrag läuft bereits oder wartet.');
    batch ||= { id: crypto.randomUUID(), results: [] };
    state.jobs[id] = { ...state.jobs[id], status: 'queued', verification: null, transferredAt: null, error: '', progress: null, estimatedTotalBytes: null, sizeCheckedAt: null, source, runId: crypto.randomUUID(), startedAt: null, endedAt: null, exitCode: null };
    fs.writeFileSync(path.join(DATA, id + '.log'), 'Auftrag wartet auf Ausführung.\n', { mode: 0o600 });
    queue.push(id); persist(); void drain();
  }
  function enqueueAll() {
    if (isMaintenance()) throw Object.assign(new Error('Update läuft. Neue Backups sind vorübergehend gesperrt.'), { status: 409 });
    const added = [], skipped = [];
    for (const source of getConfig().sources) {
      if (['running','queued','cancelling'].includes(state.jobs[source.id]?.status)) {
        skipped.push({ id: source.id, name: source.name, reason: 'Läuft bereits oder wartet.' }); continue;
      }
      if (!configured(source.id)) {
        skipped.push({ id: source.id, name: source.name, reason: 'PBS-Zugang fehlt.' }); continue;
      }
      enqueue(source.id, 'manual'); added.push(source.id);
    }
    return { added, skipped };
  }
  async function drain() { const config = getConfig();
    if (active || stopping || !queue.length || waitingReason()) return;
    const id = queue.shift(), source = sourceFor(id); active = { folder: id, child: null };
    const execution = active;
    const job = state.jobs[id];
    let confirmedMount;
    function captureSize() {
      if (!confirmedMount) return;
      const size = getSourceSize({ ...source, mount: confirmedMount });
      if (job.estimatedTotalBytes === null && size?.bytes > 0) { job.estimatedTotalBytes = size.bytes; job.sizeCheckedAt = size.checkedAt; }
    }
    Object.assign(job, { status: 'running', runId: crypto.randomUUID(), startedAt: new Date().toISOString(), endedAt: null, exitCode: null, path: source.path, repository: repositoryFor(config, source.target), target: source.target || 'primary', namespace: targetConfig(config, source.target).namespace });
    fs.writeFileSync(path.join(DATA, id + '.log'), '', { mode: 0o600 });
    log(id, `${job.startedAt} · Prüfe ${source.path}\n`); persist();
    let mount;
    try { mount = await inspectFolder(id); } catch { mount = { ok: false, error: 'Mount-Prüfung fehlgeschlagen.' }; }
    if (active !== execution || stopping) return;
    if (!mount.ok) { finish(id, null, mount.error); return; }
    if (waitingReason()) { job.status = 'queued'; job.startedAt = null; active = null; queue.unshift(id); persist(); return; }
    confirmedMount = mount.mount; captureSize();
    log(id, `Ziel: ${job.repository}\nSMB eingebunden: ${mount.mount.source} → ${mount.mount.target} (${mount.mount.type})\nBackup startet …\n`);
    let child;
    try { child = spawnProcess('proxmox-backup-client', ['backup', `qnap-${id}.pxar:${source.path}`, '--backup-type', 'host', '--backup-id', id, '--crypt-mode', 'none', ...rateArgs(getConfig())], { env: environment(source.target || 'primary'), stdio: ['ignore','pipe','pipe'] });
    } catch { finish(id, null, 'Backup-Prozess konnte nicht gestartet werden.'); return; }
    execution.child = child; let error = '';
    const progress = createProgressParser(value => {
      // An older client's final summary is a fallback, not a replacement for live upload counters.
      captureSize();
      if (value.uploadedBytes !== null || !job.progress) job.progress = value;
    });
    child.stdout.on('data', data => { progress.push(data, 'stdout'); log(id, data.toString()); }); child.stderr.on('data', data => { progress.push(data, 'stderr'); log(id, data.toString()); });
    child.on('error', e => { error = e.code === 'ENOENT' ? 'proxmox-backup-client ist nicht installiert.' : 'Backup-Prozess konnte nicht gestartet werden.'; });
    child.on('close', async (code, signal) => {
      if (active !== execution) return;
      clearTimeout(execution.cancelTimer); progress.end(); execution.child = null;
      if (!error && code === 0 && job.status !== 'cancelling' && !stopping && verifySnapshot) {
        job.transferredAt = new Date().toISOString(); job.verification = {status:'running',method:'snapshot'}; persist();
        log(id, '\nÜbertragung beendet. Prüfe Snapshot und Archiv auf dem PBS …\n');
        try { job.verification = await verifySnapshot(id, job); }
        catch { job.verification = {status:'failed',method:'snapshot',checkedAt:new Date().toISOString(),message:'PBS-Snapshot-Prüfung fehlgeschlagen.'}; }
        if (active !== execution || stopping) return;
        log(id, `Zielprüfung: ${job.verification.status} · ${job.verification.message}\n`);
        if (job.verification.status !== 'success') notify(`verify/${job.runId}`, `${source.name}: Übertragung beendet, PBS-Snapshot nicht bestätigt. Protokoll prüfen.`);
      }
      if (active === execution && !stopping) finish(id, code, error || (signal ? `Prozess durch ${signal} beendet.` : code === 0 ? '' : `Backup fehlgeschlagen (Exit-Code ${code}).`));
    });
  }
  function finish(id, code, error) {
    const job = state.jobs[id]; const cancelled = job.status === 'cancelling';
    job.status = cancelled ? 'cancelled' : !error && code === 0 ? 'success' : 'failed';
    if (cancelled) error = '';
    if (cancelled && job.verification) job.verification.status = 'cancelled';
    job.error = error; job.exitCode = code; job.endedAt = new Date().toISOString();
    if (job.status === 'success') job.lastSuccess = job.endedAt;
    log(id, `\n${job.endedAt} · ${error || (cancelled ? 'Backup auf Wunsch abgebrochen.' : 'Backup erfolgreich.')}\n`); archive(id, job); persist();
    if (error) notify(`run/${job.runId}`, `${sourceFor(id).name}: Backup fehlgeschlagen. Details in Backup Control prüfen.`);
    batch?.results.push({name:sourceFor(id).name,status:job.status,durationSeconds:Math.max(0,Math.round((Date.parse(job.endedAt)-Date.parse(job.startedAt || job.endedAt))/1000))});
    active = null; finishBatch(); void drain();
  }
  function finishBatch() { if (!queue.length && batch && !stopping) { const completed = batch; batch = null; if (completed.results.some(result => result.status === 'success')) onBatchComplete(completed); } }
  function cancel(id) {
    if (!sourceFor(id)) throw new Error('Unbekannter Auftrag.');
    const index = queue.indexOf(id);
    if (index >= 0) {
      queue.splice(index, 1);
      const job = state.jobs[id];
      Object.assign(job, { status: 'cancelled', error: '', endedAt: new Date().toISOString() });
      log(id, 'Wartender Auftrag auf Wunsch abgebrochen.\n'); archive(id, job); persist();
      batch?.results.push({ name: sourceFor(id).name, status: 'cancelled', durationSeconds: 0 });
      if (!active) finishBatch();
      return;
    }
    if (active?.folder !== id) throw Object.assign(new Error('Dieser Auftrag läuft nicht und wartet nicht.'), { status: 409 });
    if (state.jobs[id].status === 'cancelling') return;
    const execution = active;
    state.jobs[id].status = 'cancelling'; persist(); log(id, 'Abbruch angefordert …\n');
    if (!execution.child) { if (state.jobs[id].verification?.status === 'running') return; finish(id, null, ''); return; }
    // Stay busy until close confirms the client has exited, including after SIGKILL.
    execution.cancelTimer = setTimeout(() => { if (active === execution) execution.child.kill('SIGKILL'); }, cancelTimeout);
    execution.cancelTimer.unref?.();
    execution.child.kill('SIGTERM');
  }
  function cancelAll() {
    for (const id of [...queue]) cancel(id);
    if (active) cancel(active.folder);
  }
  function control(action, id, direction) {
    if (action === 'pause' || action === 'resume') { state.queueControl.paused = action === 'pause'; persist(); void drain(); return; }
    if (action !== 'move' || !['up','down'].includes(direction)) throw new Error('Ungültige Warteschlangen-Aktion.');
    const index = queue.indexOf(id);
    if (index < 0) throw Object.assign(new Error('Auftrag wartet nicht mehr. Ansicht aktualisieren.'), { status: 409 });
    const destination = index + (direction === 'up' ? -1 : 1);
    if (destination >= 0 && destination < queue.length) [queue[index],queue[destination]] = [queue[destination],queue[index]];
  }
  return { enqueue, enqueueAll, control, tick: () => { void drain(); }, get paused() { return state.queueControl.paused; }, get waitingReason() { return waitingReason(); }, cancel, cancelAll, get active() { return active; }, get queue() { return [...queue]; }, get busy() { return Boolean(active || queue.length); }, stop(signal = 'SIGTERM') { stopping = true; active?.child?.kill(signal); } };

}
module.exports = { createBackups };
