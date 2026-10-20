'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdates } = require('../lib/updates');
const { createDiagnostics } = require('../lib/diagnostics');
const local = 'a'.repeat(40), remote = 'b'.repeat(40);
const run = async (_, args) => ({ stdout: args.includes('rev-parse') ? local : '' });
const tick = () => new Promise(resolve => setImmediate(resolve));
test('Update-Prüfung erkennt neue Commits auch bei gleicher Versionsnummer und cached Anfragen', async () => {
  let calls = 0;
  const updates = createUpdates({ root: '/app', run, fetchJSON: async url => {
    calls++; if (url.includes('/git/ref/')) return { object: { sha: remote } };
    if (url.includes('/compare/')) return { status: 'ahead' };
    return { version: require('../package.json').version };
  } });
  assert.equal(calls, 0); assert.equal((await updates.installed()).commit, local); assert.equal(calls, 0);
  const [first, second] = await Promise.all([updates.check(), updates.check()]);
  assert.equal(first.status, 'available'); assert.equal(second.latest.commit, remote); assert.equal(calls, 3);
  await updates.check(); assert.equal(calls, 3);
});
test('Update-Prüfung unterscheidet lokale Änderungen, unbekannten Stand und Netzwerkfehler', async () => {
  const fetchJSON = async url => url.includes('/git/ref/') ? { object: { sha: local } } : { version: '2.1.0' };
  const modified = createUpdates({ root: '/app', run: async (_, args) => ({ stdout: args.includes('rev-parse') ? local : ' M server.js' }), fetchJSON });
  assert.equal((await modified.check()).status, 'modified');
  const unknown = createUpdates({ root: '/app', run: async () => { throw new Error('git fehlt'); }, fetchJSON });
  assert.equal((await unknown.check()).status, 'unknown');
  const offline = createUpdates({ root: '/app', run, fetchJSON: async () => { throw new Error('secret-in-error'); } });
  const result = await offline.check(); assert.equal(result.status, 'error'); assert.ok(!JSON.stringify(result).includes('secret-in-error'));
});
test('Diagnose dedupliziert laufende Prüfung und zeigt konkrete Mount-, PBS- und Plan-Hinweise', async () => {
  let finish, calls = 0;
  const config = { repository: 'backup@pbs@server:store', password: 'secret', timezone: 'Europe/Berlin', sources: [{ id: 'daten', name: 'Daten', path: '/mnt/Daten/Daten' }], schedules: { daten: { days: [], time: '' } } };
  const diagnostics = createDiagnostics({ getConfig: () => config, system: { inspect: async () => ({ checks: [{ ok: true, name: 'Backup Client', message: 'Installiert' }] }) }, storageChecks: () => [], inspectPath: async () => { calls++; return new Promise(resolve => { finish = resolve; }); }, pbs: { connection: async () => ({ ok: false, message: 'PBS nicht erreichbar.' }) } });
  assert.equal(diagnostics.start().running, true); await tick(); diagnostics.start(); assert.equal(calls, 1);
  finish({ ok: false, error: 'Mount fehlt.' }); await tick();
  const report = diagnostics.current(); assert.equal(report.running, false); assert.ok(report.checkedAt);
  assert.ok(report.checks.some(check => check.name.includes('Mount') && check.status === 'error'));
  assert.ok(report.checks.some(check => check.name === 'PBS-Verbindung' && check.status === 'error'));
  assert.ok(report.checks.some(check => check.name.includes('Zeitplan') && check.status === 'warning'));
  assert.ok(!JSON.stringify(report).includes('secret'));
});
