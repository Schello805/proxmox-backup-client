'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { parseDriveCapacity } = require('./drive-capacity');
const { spawn } = require('node:child_process');
const { normalizeSchedule, scheduleKey, scheduleDue, occurrence, scheduleWindow } = require('./planning');
const { inWindow } = require('./backup-policy');
function validateDrive(value, sources) {
  value ??= { remote: 'gdrive', folder: 'QNAP-Backup', sources: [], schedule: '' };
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.remote !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(value.remote)) throw new Error('Rclone-Remote: nur Buchstaben, Ziffern, Bindestrich und Unterstrich.');
  if (typeof value.folder !== 'string' || value.folder.length > 200 || !value.folder || value.folder.startsWith('/') || /[\x00-\x1f\\:]/.test(value.folder) || value.folder.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Einen relativen Google-Drive-Zielordner angeben.');
  if (!Array.isArray(value.sources) || value.sources.length > 30 || new Set(value.sources).size !== value.sources.length || value.sources.some(id => !sources.some(source => source.id === id))) throw new Error('Google-Drive-Quellen prüfen.');
  return { remote: value.remote, folder: value.folder, sources: [...value.sources], schedule: normalizeSchedule(value.schedule ?? '') };
}
function createDrive({ getConfig, state, persist, data, inspectPath, blocked, spawnProcess = spawn, clock = () => new Date(), cancelTimeout = 5000, notify = () => {} }) {
  state.drive ||= { status: 'idle', history: [] };
  if (['running','queued','cancelling'].includes(state.drive.status)) { state.drive.status = 'interrupted'; state.drive.message = 'Dienst während der Google-Drive-Kopie beendet. Erneut starten.'; persist(); }
  let execution = null, checking = false, stopping = false, probeChild = null;
  const configFile = path.join(data, 'rclone.conf');
  const env = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RCLONE_') && !key.startsWith('PBS_')));
  const base = () => ['--config', configFile];
  function probe(args) {
    return new Promise((resolve, reject) => {
      let output = '', settled = false, timer;
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); probeChild = null; error ? reject(new Error(error)) : resolve(output); };
      let child;
      try { child = spawnProcess('rclone', [...args, ...base()], { env: env(), stdio: ['ignore','pipe','pipe'] }); } catch { finish('Rclone ist nicht ausführbar. Einrichtung prüfen.'); return; }
      probeChild = child;
      child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 65536) { child.kill('SIGKILL'); finish('Rclone-Antwort ist zu groß.'); } });
      child.stderr.on('data', () => {});
      child.on('error', () => finish('Rclone fehlt oder ist nicht ausführbar.'));
      child.on('close', code => finish(code === 0 ? null : 'Google-Drive-Zugang fehlgeschlagen. Rclone-Konfiguration und Berechtigungen prüfen.'));
      timer = setTimeout(() => { child.kill('SIGKILL'); finish('Google-Drive-Prüfung nach 25 Sekunden abgebrochen.'); }, 25000); timer.unref?.();
    });
  }
  async function verifyRemote() {
    const drive = getConfig().gdrive;
    const remotes = await probe(['listremotes', '--long']);
    if (!remotes.split(/\r?\n/).some(line => line.trim().split(/\s+/)[0] === drive.remote + ':' && line.trim().split(/\s+/)[1] === 'drive')) throw new Error('Das ausgewählte Remote fehlt oder ist kein Google-Drive-Remote (Typ drive).');
    if (execution?.cancelled || stopping) throw new Error('Abgebrochen.');
    await probe(['lsf', drive.remote + ':', '--dirs-only', '--max-depth', '1', '--retries', '1', '--contimeout', '10s', '--timeout', '20s']);
  }
  async function check() {
    if (busy() || blocked()) throw new Error('Ein Auftrag läuft oder wartet. Verbindung danach prüfen.');
    checking = true;
    try { await verifyRemote(); state.drive.connection = { ok: true, checkedAt: clock().toISOString() }; }
    catch (error) { state.drive.connection = { ok: false, checkedAt: clock().toISOString(), message: error.message }; notify('gdrive/connection/' + getConfig().gdrive.remote + '/' + clock().toISOString().slice(0,10), 'Google Drive: Verbindungsprüfung fehlgeschlagen. Zugang unter Backup-Ziele prüfen.'); }
    finally { checking = false; persist(); }
    return state.drive.connection;
  }
  function capacity() {
    const saved = state.drive.capacity?.remote === getConfig().gdrive.remote ? state.drive.capacity : {};
    return { ...saved, stale: Boolean(saved.checkedAt && clock().getTime() - Date.parse(saved.checkedAt) > 20 * 60000), warning: saved.usedPercent != null && saved.usedPercent >= getConfig().capacityWarnPercent };
  }
  async function refreshCapacity() {
    if (!getConfig().gdrive.sources.length && !fs.existsSync(configFile)) return { error:'Google Drive noch nicht eingerichtet.' };
    if (busy() || blocked()) return { ...capacity(), deferred:true };
    checking = true;
    const remote = getConfig().gdrive.remote;
    try {
      await verifyRemote();
      const raw = await probe(['about', remote + ':', '--json', '--retries', '1', '--contimeout', '10s', '--timeout', '20s']);
      state.drive.capacity = { remote, ...parseDriveCapacity(JSON.parse(raw)), checkedAt:clock().toISOString(), error:'' };
    } catch {
      state.drive.capacity = { ...capacity(), remote, error:'Google-Speicherstand nicht abrufbar. Anmeldung, Rclone-Remote und Unterstützung der Speicherquote prüfen.', attemptedAt:clock().toISOString() };
      notify('gdrive/capacity/' + remote + '/' + clock().toISOString().slice(0,10), 'Google Drive: Speicherstand konnte nicht abgerufen werden. Zugang und Speicherquote prüfen.');
    } finally { checking = false; persist(); }
    return capacity();
  }
  function capacityDue() { const value = capacity(); return fs.existsSync(configFile) && (!value.checkedAt && !value.attemptedAt || clock().getTime() - Date.parse(value.attemptedAt || value.checkedAt) > 15 * 60000); }
  function start() {
    if (stopping || ['queued','running','cancelling'].includes(state.drive.status)) throw new Error('Google-Drive-Auftrag läuft bereits oder wartet.');
    const drive = getConfig().gdrive;
    if (!drive.sources.length) throw new Error('Zuerst Google-Drive-Quellen auswählen und speichern.');
    Object.assign(state.drive, { runId: crypto.randomUUID(), status: 'queued', message: 'Wartet auf freies Startfenster und PBS-Aufträge.', progress: null, results: [], source: null, startedAt: null }); persist(); void drain();
  }
  function finish(status, message) {
    const job = state.drive;
    Object.assign(job, { status, message, endedAt: clock().toISOString(), source: null });
    if (status === 'success') job.lastSuccess = job.endedAt;
    job.history = [{ status, message, startedAt: job.startedAt, endedAt: job.endedAt, results: job.results }, ...(job.history || [])].slice(0, 10);
    execution = null; persist();
    if (status === 'failed') notify('gdrive/run/' + job.runId, 'Google Drive: Kopie fehlgeschlagen' + (job.results?.length ? ' nach ' + job.results.length + ' Quellen' : '') + '. Details unter Backup-Ziele → Google Drive prüfen.');
    if (status === 'success') notify('gdrive/summary/' + job.runId, 'Google Drive: ' + job.results.length + ' Quellen erfolgreich kopiert.', { success:true });
  }
  async function drain() {
    const config = getConfig();
    if (stopping || execution || checking || state.drive.status !== 'queued' || blocked() || !inWindow(config, clock())) return;
    const run = { child: null, cancelled: false }; execution = run;
    const job = state.drive; job.status = 'running'; job.startedAt = clock().toISOString(); job.message = 'Google-Drive-Verbindung prüfen …'; persist();
    try {
      await verifyRemote();
      if (run.cancelled || stopping) return;
      for (const id of config.gdrive.sources) {
        const source = config.sources.find(source => source.id === id);
        job.source = source.name; job.progress = null; job.message = `${source.name}: Mount prüfen …`; persist();
        const mount = await inspectPath(source.path, source.expectedSource);
        if (run.cancelled || stopping) return;
        if (!mount.ok) throw new Error(`${source.name}: ${mount.error || 'SMB nicht verfügbar.'}`);
        const destination = `${config.gdrive.remote}:${config.gdrive.folder}/${id}`;
        job.message = `${source.name} → ${destination}`; persist();
        await new Promise((resolve, reject) => {
          const args = ['copy', source.path, destination, ...base(), '--use-json-log', '--stats', '2s', '--stats-log-level', 'NOTICE', '--retries', '3', '--contimeout', '20s', '--timeout', '2m'];
          const rate = getConfig().backupPolicy?.driveRateMiB ?? getConfig().backupPolicy?.rateMiB ?? 0;
          if (rate) args.push('--bwlimit', rate + 'M');
          const child = spawnProcess('rclone', args, { env: env(), stdio: ['ignore','pipe','pipe'] }); run.child = child;
          let buffer = '', timer;
          const parse = chunk => {
            buffer = (buffer + chunk.toString()).slice(-65536); const lines = buffer.split('\n'); buffer = lines.pop();
            for (const line of lines) { try { const stats = JSON.parse(line).stats; if (stats) { const number = key => Number.isFinite(stats[key]) && stats[key] >= 0 ? stats[key] : null; job.progress = { bytes: number('bytes'), totalBytes: number('totalBytes'), speed: number('speed'), eta: number('eta'), transferring: Array.isArray(stats.transferring) ? stats.transferring.length : 0 }; persist(); } } catch {} }
          };
          child.stdout.on('data', parse); child.stderr.on('data', parse);
          child.on('error', () => { clearTimeout(timer); reject(new Error('Rclone fehlt oder konnte nicht gestartet werden.')); });
          child.on('close', code => { clearTimeout(timer); run.child = null; if (run.cancelled) resolve(); else if (code === 0) resolve(); else reject(new Error(`${source.name}: Rclone fehlgeschlagen (Exit-Code ${code}). Zugang, Speicherplatz und Quelldateien prüfen.`)); });
          run.kill = () => { child.kill('SIGTERM'); timer = setTimeout(() => child.kill('SIGKILL'), cancelTimeout); timer.unref?.(); };
        });
        if (run.cancelled || stopping) return;
        job.results.push({ id, name: source.name, destination, status: 'success' }); persist();
      }
      finish('success', 'Alle ausgewählten Quellen nach Google Drive kopiert.');
    } catch (error) { if (!run.cancelled && !stopping) finish('failed', error.message); }
    finally { if (run.cancelled) finish('cancelled', 'Google-Drive-Kopie abgebrochen. Bereits kopierte Dateien bleiben erhalten.'); }
  }
  function cancel() {
    if (checking) throw new Error('Verbindungsprüfung endet nach spätestens 25 Sekunden.');
    if (execution) { execution.cancelled = true; state.drive.status = 'cancelling'; state.drive.message = 'Google-Drive-Kopie wird abgebrochen …'; persist(); execution.kill?.(); probeChild?.kill('SIGTERM'); }
    else if (state.drive.status === 'queued') finish('cancelled', 'Wartender Auftrag abgebrochen.');
  }
  function tick() {
    if (stopping) return;
    const config = getConfig(), date = clock(), key = scheduleKey(date, config.timezone), schedule = config.gdrive.schedule;
    if (scheduleDue(schedule, key, state.drive.triggered) && occurrence(key.day, key.time, config.timezone) === Math.floor(date.getTime() / 60000) * 60000) {
      state.drive.triggered = key.day; persist(); if (!['queued','running','cancelling'].includes(state.drive.status) && config.gdrive.sources.length) start();
    }
    void drain();
  }
  function busy() { return checking || ['queued','running','cancelling'].includes(state.drive.status); }
  function changed(previous, next) {
    if (previous.gdrive?.remote !== next.gdrive?.remote) state.drive.capacity = null;
    const identity = config => JSON.stringify([config.gdrive?.remote, config.gdrive?.folder, config.sources.filter(source => config.gdrive?.sources.includes(source.id)).map(source => [source.id,source.path,source.expectedSource])]);
    if (identity(previous) !== identity(next)) { state.drive.lastSuccess = null; state.drive.connection = null; state.drive.progress = null; state.drive.status = 'idle'; state.drive.message = 'Google-Drive-Einstellungen geändert. Verbindung prüfen und Kopie starten.'; }
  }
  return { changed, start, cancel, check, tick, capacity, refreshCapacity, capacityDue, get busy() { return busy(); }, get active() { return Boolean(execution) || checking; }, snapshot: () => { const config = getConfig(); return { ...state.drive, configFile, settings: config.gdrive, sources: config.sources.filter(source => config.gdrive.sources.includes(source.id)).map(({id,name}) => ({id,name})), timezone: config.timezone, nextAt: scheduleWindow(config.gdrive.schedule, config.timezone, clock()).nextAt }; }, stop(signal = 'SIGTERM') { stopping = true; execution?.child?.kill(signal); probeChild?.kill(signal); } };
}
module.exports = { validateDrive, createDrive };
