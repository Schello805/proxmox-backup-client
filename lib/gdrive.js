'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { parseDriveCapacity } = require('./drive-capacity');
const {createRcloneOutput,redactRclone}=require('./rclone-log');
const { spawn } = require('node:child_process');
const { normalizeSchedule, scheduleKey, scheduleDue, occurrence, scheduleWindow } = require('./planning');
const { inWindow } = require('./backup-policy');
function validateDrive(value, sources) {
  value ??= { remote: 'gdrive', folder: 'QNAP-Backup', sources: [], schedule: '' };
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.remote !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(value.remote)) throw new Error('Rclone-Remote: nur Buchstaben, Ziffern, Bindestrich und Unterstrich.');
  if (typeof value.folder !== 'string' || value.folder.length > 200 || !value.folder || value.folder.startsWith('/') || /[\x00-\x1f\\:]/.test(value.folder) || value.folder.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Einen relativen Google-Drive-Zielordner angeben.');
  if (!Array.isArray(value.sources) || value.sources.length > 30 || new Set(value.sources).size !== value.sources.length || value.sources.some(id => !sources.some(source => source.id === id))) throw new Error('Google-Drive-Quellen prüfen.');
  if(value.sources.some(id=>sources.find(source=>source.id===id)?.selection))throw new Error('Datei-Sammelaufträge sind PBS-spezifisch. Für Google Drive die Hauptquelle wählen.');
  const mode = value.mode ?? 'copy';
  if (!['backup','copy','sync'].includes(mode)) throw new Error('Google-Drive-Modus muss Sicherung mit Versionen oder Abgleich mit/ohne Löschen sein.');
  if (mode === 'sync' && value.syncConfirmed !== true) throw new Error('Synchronisierung: Löschen zusätzlicher Dateien im Google-Zielordner ausdrücklich bestätigen.');
  return { mode, syncConfirmed: mode === 'sync', remote: value.remote, folder: value.folder, sources: [...value.sources], schedule: normalizeSchedule(value.schedule ?? '') };
}
function createDrive({ getConfig, state, persist, data, inspectPath, blocked, spawnProcess = spawn, clock = () => new Date(), cancelTimeout = 5000, notify = () => {} }) {
  state.drive ||= { status: 'idle', history: [] };
  if (['running','queued','cancelling'].includes(state.drive.status)) { state.drive.status = 'interrupted'; state.drive.message = 'Dienst während der Google-Drive-Kopie beendet. Erneut starten.'; persist(); }
  let execution = null, checking = false, stopping = false, probeChild = null;
  const configFile = path.join(data, 'rclone.conf');
  const env = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('RCLONE_') && !key.startsWith('PBS_')));
  const base = () => ['--config', configFile];
  const logDir=path.join(data,'gdrive-logs');
  const secrets=()=>{const config=getConfig();return [config.password,config.secondaryPBS?.password,config.notifications?.token,process.env.APP_PASSWORD];};
  function runLog(text){
    const job=state.drive;if(!/^[a-f0-9-]{36}$/.test(job.runId||''))return;
    try{fs.mkdirSync(logDir,{recursive:true,mode:0o700});const file=path.join(logDir,job.runId+'.log');const previous=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';fs.writeFileSync(file,Buffer.from(previous+redactRclone(text,secrets())).subarray(-256*1024),{mode:0o600});}
    catch{job.logError='Rclone-Protokoll konnte nicht gespeichert werden. Freien lokalen Speicher und Rechte prüfen.';}
  }
  function captureOutput(onStats){return createRcloneOutput({log:runLog,onStats,secrets,onError:text=>{state.drive.lastError=text;}});}

  function probe(args) {
    return new Promise((resolve, reject) => {
      let output = '', settled = false, timer, detail = '', diagnostic;
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); probeChild = null; diagnostic?.end(); error ? reject(new Error(error + (detail ? ' '+detail : ''))) : resolve(output); };
      diagnostic=createRcloneOutput({log:text=>{if(execution)runLog(text);},secrets,onError:text=>{detail=text;}});
      let child;
      try { child = spawnProcess('rclone', [...args, ...base()], { env: env(), stdio: ['ignore','pipe','pipe'] }); } catch { finish('Rclone ist nicht ausführbar. Einrichtung prüfen.'); return; }
      probeChild = child;
      child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 65536) { child.kill('SIGKILL'); finish('Rclone-Antwort ist zu groß.'); } });
      child.stderr.on('data', chunk=>diagnostic.push(chunk));
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
  function start(verificationOnly = false) {
    if (stopping || ['queued','running','cancelling'].includes(state.drive.status)) throw new Error('Google-Drive-Auftrag läuft bereits oder wartet.');
    const drive = getConfig().gdrive;
    if (!drive.sources.length) throw new Error('Zuerst Google-Drive-Quellen auswählen und speichern.');
    Object.assign(state.drive, { verificationOnly, lastError:null, logError:null, verification: null, transferredAt: null, mode: drive.mode || 'copy', runId: crypto.randomUUID(), status: 'queued', message: 'Wartet auf freies Startfenster und PBS-Aufträge.', progress: null, results: [], source: null, startedAt: null }); runLog(`${clock().toISOString()} · Google Drive · ${drive.mode || 'copy'} · Auftrag angefordert.\n`); persist(); void drain();
  }
  function finish(status, message) {
    const job = state.drive;
    Object.assign(job, { status, message, endedAt: clock().toISOString(), source: null });
    if (status === 'success' && !job.verificationOnly) job.lastSuccess = job.endedAt;
    job.phase = null;
    if (job.verification?.status === 'running') job.verification = { ...job.verification, status: status === 'cancelled' ? 'cancelled' : 'failed', checkedAt: job.endedAt };
    runLog(`${job.endedAt} · ${status}: ${message}\n`);
    const expired=(job.history||[]).slice(9);
    job.history = [{ runId:job.runId, logError:job.logError, mode: job.mode || 'copy', status, message, startedAt: job.startedAt, endedAt: job.endedAt, results: job.results, verification: job.verification, verificationOnly: job.verificationOnly }, ...(job.history || [])].slice(0, 10);
    for(const old of expired)if(/^[a-f0-9-]{36}$/.test(old.runId||''))try{fs.rmSync(path.join(logDir,old.runId+'.log'),{force:true});}catch{}
    execution = null; persist();
    if (status === 'failed') notify('gdrive/run/' + job.runId, 'Google Drive: ' + (job.mode === 'backup' ? 'Versionierte Sicherung' : job.mode === 'sync' ? 'Synchronisierung' : 'Kopie') + ' fehlgeschlagen' + (job.results?.length ? ' nach ' + job.results.length + ' Quellen' : '') + '. Details unter Protokoll prüfen.');
    if (status === 'success' && !job.verificationOnly) notify('gdrive/summary/' + job.runId, 'Google Drive: ' + job.results.length + (job.mode === 'backup' ? ' Quellen mit Versionen gesichert.' : job.mode === 'sync' ? ' Quellen erfolgreich synchronisiert.' : ' Quellen erfolgreich kopiert.'), { success:true });
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
        if (['backup','sync'].includes(config.gdrive.mode) && !source.expectedSource) throw new Error(`${source.name}: Vor diesem Abgleich die erwartete Netzwerkfreigabe unter Quellen bestätigen.`);
        if (!mount.ok) throw new Error(`${source.name}: ${mount.error || 'Mount nicht verfügbar.'}`);
        const destination = `${config.gdrive.remote}:${config.gdrive.folder}/${id}`;
        const backupDirectory = config.gdrive.mode === 'backup' ? `${config.gdrive.remote}:${config.gdrive.folder}.versions/${id}/${job.startedAt.replace(/[:.]/g,'-')}-${job.runId}` : null;
        job.lastError=null;job.message = `${source.name} → ${destination}`;runLog(`${clock().toISOString()} · ${job.message} · Quelle: ${source.path}\n`); persist();
        if (!job.verificationOnly) await new Promise((resolve, reject) => {
          const args = [config.gdrive.mode === 'backup' ? 'sync' : config.gdrive.mode || 'copy', source.path, destination, ...base(), '--use-json-log', '--stats', '2s', '--stats-log-level', 'NOTICE', '--retries', '3', '--contimeout', '20s', '--timeout', '2m'];
          if (['backup','sync'].includes(config.gdrive.mode)) args.push('--delete-after');
          if (backupDirectory) args.push('--backup-dir', backupDirectory);
          const rate = getConfig().backupPolicy?.driveRateMiB ?? getConfig().backupPolicy?.rateMiB ?? 0;
          if (rate) args.push('--bwlimit', rate + 'M');
          const child = spawnProcess('rclone', args, { env: env(), stdio: ['ignore','pipe','pipe'] }); run.child = child;
          let timer;
          const output=captureOutput(stats=>{const number=key=>Number.isFinite(stats[key])&&stats[key]>=0?stats[key]:null;job.progress={bytes:number('bytes'),totalBytes:number('totalBytes'),speed:number('speed'),eta:number('eta'),transferring:Array.isArray(stats.transferring)?stats.transferring.length:0};persist();});
          child.stdout.on('data',chunk=>output.push(chunk,'stdout'));child.stderr.on('data',chunk=>output.push(chunk,'stderr'));
          child.on('error', () => { clearTimeout(timer); reject(new Error('Rclone fehlt oder konnte nicht gestartet werden.')); });
          child.on('close', code => { clearTimeout(timer); output.end(); run.child = null; if (run.cancelled) resolve(); else if (code === 0) resolve(); else reject(new Error(`${source.name}: Rclone fehlgeschlagen (Exit-Code ${code}). ${job.lastError || (code===6?'NoRetry-Fehler. Konkrete Meldungen im Protokoll prüfen.':'Konkrete Meldungen im Protokoll prüfen.')}`)); });
          run.kill = () => { child.kill('SIGTERM'); timer = setTimeout(() => child.kill('SIGKILL'), cancelTimeout); timer.unref?.(); };
        });
        if (run.cancelled || stopping) return;
        const result = { id, name: source.name, destination, ...(backupDirectory ? { backupDirectory } : {}), status: job.verificationOnly ? 'not-run' : 'success' };
        job.results.push(result);
        job.progress = null; job.phase = 'verification';
        if (!job.verificationOnly) { job.transferredAt = clock().toISOString(); runLog(`${job.transferredAt} · ${source.name}: Übertragung beendet.\n`); }
        job.verification = { status: 'running', method: job.verificationOnly ? 'hash' : 'size' };
        job.lastError=null;job.message = `${source.name}: Zielbestand prüfen (${job.verificationOnly ? 'Prüfsummen, soweit verfügbar' : 'Dateien und Größen'}) …`; persist();
        runLog(`${clock().toISOString()} · ${job.message}\n`);
        const verification = result.verification = { status: 'running', method: job.verification.method };
        try {
          const mountAfter = await inspectPath(source.path, source.expectedSource);
          if (!mountAfter.ok) throw new Error('Mount während der Prüfung nicht verfügbar.');
          await new Promise((resolve, reject) => {
            const args = ['check', source.path, destination, ...base(), '--contimeout', '20s', '--timeout', '2m', '--retries', '1'];
            if (!job.verificationOnly) args.push('--size-only');
            if (!['backup','sync'].includes(config.gdrive.mode)) args.push('--one-way');
            const child = spawnProcess('rclone', args, { env: env(), stdio: ['ignore','pipe','pipe'] });
            run.child = child; let timer;
            const output=captureOutput();child.stdout.on('data',chunk=>output.push(chunk,'stdout'));child.stderr.on('data',chunk=>output.push(chunk,'stderr'));
            child.on('error', () => { clearTimeout(timer); reject(new Error('Rclone-Prüfung konnte nicht gestartet werden.')); });
            child.on('close', code => { clearTimeout(timer); output.end(); run.child = null; if (run.cancelled || stopping) resolve(); else if (code === 0) resolve(); else reject(new Error(`Zielvergleich fehlgeschlagen (Exit-Code ${code}): Dateien fehlen, weichen ab oder konnten nicht gelesen werden. ${job.lastError || 'Auch zwischenzeitliche Änderungen der Quelle können Abweichungen verursachen.'}`)); });
            run.kill = () => { child.kill('SIGTERM'); timer = setTimeout(() => child.kill('SIGKILL'), cancelTimeout); timer.unref?.(); };
          });
          verification.status = run.cancelled || stopping ? 'cancelled' : 'success';
        } catch (error) { verification.status = 'failed'; verification.message = error.message; throw error; }
        finally { verification.checkedAt = clock().toISOString(); runLog(`${verification.checkedAt} · ${source.name}: Zielprüfung: ${verification.status}${verification.message ? ' · '+verification.message : ''}\n`); persist(); }
        if (run.cancelled || stopping) return;

      }
      job.phase = null; job.verification = { status: 'success', method: job.verificationOnly ? 'hash' : 'size', checkedAt: clock().toISOString() };
      finish('success', job.verificationOnly ? 'Zielbestand verglichen: Prüfsummen, soweit verfügbar, sonst Größen. Keine Dateien geändert.' : config.gdrive.mode === 'backup' ? 'Aktueller Stand gesichert; ersetzte und entfernte Dateien werden im Versionsordner aufbewahrt.' : config.gdrive.mode === 'sync' ? 'Alle ausgewählten Quellen mit Google Drive synchronisiert.' : 'Alle ausgewählten Quellen nach Google Drive kopiert.');
    } catch (error) { if (!run.cancelled && !stopping) finish('failed', error.message); }
    finally { if (run.cancelled) finish('cancelled', 'Google-Drive-Auftrag abgebrochen. Bereits übertragene Änderungen und Löschungen bleiben wirksam.'); }
  }
  function cancel() {
    if (!execution && state.drive.status === 'queued') { finish('cancelled', 'Wartender Auftrag abgebrochen.'); return; }
    if (checking) throw new Error('Verbindungsprüfung endet nach spätestens 25 Sekunden.');
    if (execution) { execution.cancelled = true; state.drive.status = 'cancelling'; state.drive.message = 'Google-Drive-Auftrag wird abgebrochen …'; persist(); execution.kill?.(); probeChild?.kill('SIGTERM'); }
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
    const identity = config => JSON.stringify([config.gdrive?.remote, config.gdrive?.folder, config.gdrive?.mode, config.sources.filter(source => config.gdrive?.sources.includes(source.id)).map(source => [source.id,source.path,source.expectedSource])]);
    if (identity(previous) !== identity(next)) { state.drive.verification = null; state.drive.lastSuccess = null; state.drive.connection = null; state.drive.progress = null; state.drive.status = 'idle'; state.drive.message = 'Google-Drive-Einstellungen geändert. Verbindung prüfen und Kopie starten.'; }
  }
  return { changed, start, cancel, check, tick, capacity, refreshCapacity, capacityDue, get busy() { return busy(); }, get active() { return Boolean(execution) || checking; }, snapshot: () => { const config = getConfig(); return { ...state.drive, configFile, settings: config.gdrive, sources: config.sources.filter(source => config.gdrive.sources.includes(source.id)).map(({id,name}) => ({id,name})), timezone: config.timezone, nextAt: scheduleWindow(config.gdrive.schedule, config.timezone, clock()).nextAt }; }, stop(signal = 'SIGTERM') { stopping = true; execution?.child?.kill(signal); probeChild?.kill(signal); } };
}
module.exports = { validateDrive, createDrive };
