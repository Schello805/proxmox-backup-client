'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { repositoryFor, targetsFor } = require('../lib/targets');
const { validateConfig } = require('../lib/validation');
const { migrateConfig, loadConfig } = require('../lib/storage');
const { createPBS } = require('../lib/pbs');
const { createBackups } = require('../lib/backups');
const { createConfigService } = require('../lib/config-service');
const config = () => validateConfig({ repository: 'backup@pbs!token@pbs-host:pbs1', password: 'secret', fingerprint: '', namespace: 'qnap', secondaryDatastore: 'pbs2', schedules: {}, authEnabled: false }, { password: '' });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Zweiter Datastore nutzt denselben PBS und validiert Zielzuordnungen ohne stillen Fallback', () => {
  const base = config();
  assert.equal(repositoryFor(base, 'secondary'), 'backup@pbs!token@pbs-host:pbs2');
  assert.equal(repositoryFor({ ...base, repository: 'backup@pbs@[2001:db8::1]:8007:pbs1' }, 'secondary'), 'backup@pbs@[2001:db8::1]:8007:pbs2');
  assert.deepEqual(targetsFor(base).map(target => target.name), ['pbs1', 'pbs2']);
  assert.ok(base.sources.every(source => source.target === 'primary'));
  assert.throws(() => repositoryFor(base, 'unknown'));
  for (const secondaryDatastore of ['pbs1', 'bad store', '../etc', '-unsafe']) assert.throws(() => validateConfig({ ...base, secondaryDatastore }, base));
  const assigned = { ...base, sources: base.sources.map(source => ({ ...source, target: 'secondary' })) };
  assert.throws(() => validateConfig({ ...assigned, secondaryDatastore: '' }, base), /noch von Quellen/);
  assert.throws(() => validateConfig({ ...base, sources: base.sources.map(source => ({ ...source, target: 'unknown' })) }, base));
});

test('Schema-2-Migration sichert Konfiguration und erhält bisherige Datastore-Ziele', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qnap-store-migration-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const old = config(); old.schemaVersion = 2; delete old.secondaryDatastore; for (const source of old.sources) delete source.target;
  const file = path.join(directory, 'config.json'), raw = JSON.stringify(old); fs.writeFileSync(file, raw);
  const migrated = loadConfig(file, path.join(__dirname, '..', 'config.example.json'), '');
  assert.equal(migrated.schemaVersion, 3); assert.equal(migrated.repository, old.repository); assert.equal(migrated.password, 'secret');
  assert.equal(migrated.secondaryDatastore, ''); assert.ok(migrated.sources.every(source => source.target === 'primary'));
  const backup = fs.readdirSync(directory).find(name => name.includes('pre-v3-')); assert.ok(backup); assert.equal(fs.readFileSync(path.join(directory, backup), 'utf8'), raw);
  assert.equal(migrateConfig(migrated).repository, old.repository);
});

test('PBS-Abfragen halten Bestand, Fehler und Cache beider Datastores getrennt', async () => {
  let failSecondary = false; const calls = [], files = [];
  const base = config();
  const pbs = createPBS({ getConfig: () => base, environment: target => ({ PBS_REPOSITORY: repositoryFor(base, target) }), cacheFile: '/tmp/not-written-pbs-test.json', save: (file, cache) => files.push([file, structuredClone(cache)]), run: async (_, args, options) => {
    const repository = options.env.PBS_REPOSITORY; calls.push(repository); if (failSecondary && repository.endsWith(':pbs2')) throw new Error('private failure');
    return { stdout: JSON.stringify([{ 'backup-type': 'host', 'backup-id': repository.endsWith(':pbs2') ? 'daten' : 'software', 'backup-time': 1792454400, files: [] }]) };
  } });
  await Promise.all([pbs.refresh('primary'), pbs.refresh('secondary'), pbs.refresh('secondary')]);
  assert.equal(calls.length, 2); assert.equal(pbs.current('primary').snapshots[0].id, 'software'); assert.equal(pbs.current('secondary').snapshots[0].id, 'daten');
  assert.notEqual(files[0][0], files[1][0]);
  failSecondary = true; await pbs.refresh('secondary'); assert.equal(pbs.connections().secondary.ok, false); assert.equal(pbs.connections().primary.ok, true);
  assert.equal(pbs.current('primary').error, ''); assert.ok(pbs.current('secondary').error); assert.equal(pbs.current('secondary').snapshots[0].id, 'daten');
  await assert.rejects(pbs.refresh('unknown')); assert.throws(() => pbs.current('unknown'));
});

test('Backups und Warteschlange verwenden den zugewiesenen Datastore und speichern das tatsächliche Ziel', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qnap-store-backup-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const base = config(); base.sources.find(source => source.id === 'daten').target = 'secondary';
  const state = { jobs: {} }, children = [], environments = [], archives = [];
  const backups = createBackups({ state, data: directory, getConfig: () => base, persist() {}, inspectPath: async () => ({ ok: true, mount: {} }), environment: target => ({ PBS_REPOSITORY: repositoryFor(base, target), PBS_PASSWORD: base.password }), log() {}, archive: (_, job) => archives.push(structuredClone(job)), notify() {}, spawnProcess: (_, args, options) => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); children.push(child); environments.push(options.env); return child; } });
  backups.enqueue('software', 'manual'); backups.enqueue('daten', 'schedule'); await tick();
  assert.equal(environments[0].PBS_REPOSITORY, base.repository); children[0].emit('close', 0, null); await tick();
  assert.equal(environments[1].PBS_REPOSITORY, 'backup@pbs!token@pbs-host:pbs2'); assert.equal(environments[1].PBS_PASSWORD, base.password);
  children[1].emit('close', 0, null); assert.equal(archives[1].repository, environments[1].PBS_REPOSITORY);
  base.secondaryDatastore = ''; assert.throws(() => backups.enqueue('daten', 'manual'), /konfigurieren/);
});

test('Zielwechsel setzt nur betroffene Laufzustände zurück und erhält Zeitpläne', () => {
  const base = config(), state = { jobs: { software: { status: 'success' }, daten: { status: 'success' } }, watchSince: {} };
  const service = createConfigService({ initial: base, state, write() {}, persist() {}, isBusy: () => false, onChange() {}, password: '' });
  service.apply({ ...base, sources: base.sources.map(source => source.id === 'daten' ? { ...source, target: 'secondary' } : source) });
  assert.equal(state.jobs.software.status, 'success'); assert.equal(state.jobs.daten.status, 'idle'); assert.deepEqual(service.get().schedules, base.schedules);
  state.jobs.daten.status = 'success'; service.apply({ ...service.get(), secondaryDatastore: 'pbs-archive' });
  assert.equal(state.jobs.software.status, 'success'); assert.equal(state.jobs.daten.status, 'idle');
});

test('Diagnose prüft beide konfigurierten Datastores mit getrennten Ergebnissen', async () => {
  const { createDiagnostics } = require('../lib/diagnostics');
  const calls = [], base = config();
  const diagnostics = createDiagnostics({ getConfig: () => base, system: { inspect: async () => ({ checks: [] }) }, storageChecks: () => [], inspectPath: async () => ({ ok: true, identityConfirmed: true }), pbs: { connection: async target => { calls.push(target); return { ok: target === 'primary', message: target === 'primary' ? 'Erreichbar' : 'Keine Rechte' }; } } });
  diagnostics.start(); await tick();
  const report = diagnostics.current(); assert.equal(report.running, false); assert.deepEqual(calls, ['primary', 'secondary']);
  assert.ok(report.checks.some(check => check.name.includes('pbs2') && check.status === 'error'));
  assert.ok(report.checks.some(check => check.name === 'PBS-Verbindung' && check.status === 'ok'));
});
