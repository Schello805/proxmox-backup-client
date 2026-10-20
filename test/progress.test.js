'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseProgress, createProgressParser } = require('../lib/progress');
test('Client-Fortschritt unterscheidet verarbeitete Daten und Upload und berechnet Ø Verarbeitung', () => {
  const result = parseProgress('INFO: processed 4.963 GiB in 2min, uploaded 4.929 GiB', () => 'timestamp');
  assert.equal(result.processedBytes, Math.round(4.963 * 1024 ** 3));
  assert.equal(result.uploadedBytes, Math.round(4.929 * 1024 ** 3));
  assert.equal(result.elapsedSeconds, 120); assert.equal(result.updatedAt, 'timestamp');
  assert.equal(result.processingBytesPerSecond, result.processedBytes / 120);
  assert.equal(parseProgress('processed 1.452 TiB in 1h 19m 2s, uploaded 0 B').elapsedSeconds, 4742);
  assert.equal(parseProgress('processed 1 GiB in 0s, uploaded 1 GiB'), null);
  assert.equal(parseProgress('processed 1 GiB in unknown, uploaded 1 GiB'), null);
  assert.equal(parseProgress('Error: upload failed'), null);
});
test('Parser trennt Datenströme und verarbeitet unvollständige Zeilen erst vollständig', () => {
  const results = [], parser = createProgressParser(result => results.push(result));
  parser.push(Buffer.from('processed 2.4 GiB in 1'));
  parser.push(Buffer.from('Andere Zeile\n'), 'stderr'); assert.equal(results.length, 0);
  parser.push(Buffer.from('min, uploaded 2.1 GiB\nprocessed 3 GiB in 2m, uploaded 2 GiB'));
  assert.equal(results.length, 1); parser.end(); assert.equal(results.length, 2);
  assert.equal(results[1].elapsedSeconds, 120);
});
test('Ältere Zusammenfassung liefert Verarbeitung statt erfundenen Upload-Werten', () => {
  const result = parseProgress('qnap-software.pxar: had to backup 1 MiB of 4 MiB (compressed 512 KiB) in 2.00 s (average 512 KiB/s)');
  assert.equal(result.processedBytes, 4 * 1024 ** 2); assert.equal(result.uploadedBytes, null);
  assert.equal(result.processingBytesPerSecond, 2 * 1024 ** 2);
});

test('Backup übernimmt Live-Messwerte, archiviert Abschluss und setzt Werte vor erneutem Lauf zurück', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { EventEmitter } = require('node:events');
  const { createBackups } = require('../lib/backups');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'qnap-progress-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const state = { jobs: {} }, archived = [];
  let child, measuredSize = { bytes: 10 * 1024 ** 3, checkedAt: new Date().toISOString() };
  const config = { repository: 'backup@pbs@host:store', password: 'secret', sources: [{ id: 'daten', name: 'Daten', path: '/mnt/Daten/Daten' }] };
  const backups = createBackups({ state, data, getSourceSize: () => measuredSize, persist() {}, getConfig: () => config, inspectPath: async () => ({ ok: true, mount: { source: '//nas/Daten', target: '/mnt/Daten/Daten', type: 'cifs' } }), environment: () => ({}), log() {}, archive: (_, job) => archived.push(structuredClone(job)), notify() {}, spawnProcess: () => { child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); return child; } });
  backups.enqueue('daten', 'manual'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.jobs.daten.estimatedTotalBytes, 10 * 1024 ** 3); measuredSize = { ...measuredSize, bytes: 20 * 1024 ** 3 };
  child.stderr.emit('data', Buffer.from('processed 2 GiB in 1min, uploaded 1 GiB\n'));
  assert.equal(state.jobs.daten.progress.processedBytes, 2 * 1024 ** 3);
  assert.equal(state.jobs.daten.estimatedTotalBytes, 10 * 1024 ** 3);
  child.stdout.emit('data', Buffer.from('qnap-daten.pxar: had to backup 1 GiB of 2 GiB (compressed 512 MiB) in 60.00s\n'));
  child.emit('close', 0, null);
  assert.equal(archived[0].status, 'success'); assert.equal(archived[0].progress.uploadedBytes, 1024 ** 3);
  backups.enqueue('daten', 'manual'); assert.equal(state.jobs.daten.progress, null);
  assert.equal(state.jobs.daten.estimatedTotalBytes, 20 * 1024 ** 3);
  await new Promise(resolve => setImmediate(resolve)); child.emit('close', 1, null);
  assert.equal(state.jobs.daten.status, 'failed'); assert.equal(state.jobs.daten.progress, null);
});

test('Prozent und Restzeit beruhen auf Verarbeitung, nicht auf dedupliziertem Upload', () => {
  const { estimateProgress } = require('../lib/progress');
  const now = Date.now(), job = { status: 'running', estimatedTotalBytes: 10 * 1024 ** 3, sizeCheckedAt: 'size-time', progress: { processedBytes: 5 * 1024 ** 3, uploadedBytes: 1024, processingBytesPerSecond: 5 * 1024 ** 3 / 120, updatedAt: new Date(now).toISOString() } };
  const result = estimateProgress(job, now); assert.equal(result.percent, 50); assert.equal(result.remainingSeconds, 120); assert.equal(result.sizeCheckedAt, 'size-time');
  assert.equal(estimateProgress({ ...job, estimatedTotalBytes: null }, now).status, 'waiting-size');
  assert.equal(estimateProgress({ ...job, progress: null }, now).status, 'waiting-data');
  assert.equal(estimateProgress(job, now + 181_000).status, 'stale');
  assert.equal(estimateProgress({ ...job, progress: { ...job.progress, processingBytesPerSecond: 0 } }, now).remainingSeconds, null);
  const reached = estimateProgress({ ...job, estimatedTotalBytes: 4 * 1024 ** 3 }, now);
  assert.equal(reached.status, 'size-reached'); assert.equal(reached.percent, 99); assert.equal(reached.remainingSeconds, null);
  assert.equal(estimateProgress({ ...job, status: 'success' }, now).percent, 100);
  assert.equal(estimateProgress({ ...job, status: 'failed' }, now).percent, null);
});
