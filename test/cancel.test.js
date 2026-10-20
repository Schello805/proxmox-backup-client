'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { createBackups } = require('../lib/backups');
const { validateConfig } = require('../lib/validation');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, extra = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'qnap-cancel-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const config = validateConfig({ repository: 'backup@pbs@pbs:store', password: 'secret', fingerprint: '', namespace: '', schedules: {}, authEnabled: false }, { password: '' });
  const state = { jobs: {} }, children = [], archived = [], notifications = [];
  const backups = createBackups({ state, data, getConfig: () => config, persist() {}, inspectPath: async () => ({ ok: true, mount: {} }), environment: () => ({}), log() {}, archive: (_, job) => archived.push(structuredClone(job)), notify: (...args) => notifications.push(args), cancelTimeout: 10, spawnProcess: () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.signals = []; child.kill = signal => child.signals.push(signal); children.push(child); return child;
  }, ...extra });
  return { backups, state, children, archived, notifications };
}
test('Cancel all removes queued jobs, waits for client exit and escalates; cancellation is not failure', async t => {
  const f = fixture(t); f.state.jobs.software = { lastSuccess: '2026-10-19T00:00:00Z' };
  f.backups.enqueue('software', 'manual'); f.backups.enqueue('filme', 'manual'); await tick();
  f.backups.cancelAll(); assert.deepEqual(f.backups.queue, []); assert.equal(f.state.jobs.filme.status, 'cancelled');
  assert.equal(f.state.jobs.software.status, 'cancelling'); assert.equal(f.backups.busy, true); assert.deepEqual(f.children[0].signals, ['SIGTERM']);
  assert.throws(() => f.backups.enqueue('software', 'manual'));
  await new Promise(resolve => setTimeout(resolve, 25)); assert.deepEqual(f.children[0].signals, ['SIGTERM', 'SIGKILL']); assert.equal(f.backups.busy, true);
  f.children[0].emit('close', null, 'SIGKILL'); assert.equal(f.backups.busy, false); assert.equal(f.state.jobs.software.status, 'cancelled'); assert.equal(f.state.jobs.software.lastSuccess, '2026-10-19T00:00:00Z');
  assert.equal(f.archived.length, 2); assert.deepEqual(f.notifications, []); assert.equal(f.children.length, 1);
  f.backups.enqueue('software', 'manual'); await tick(); assert.equal(f.children.length, 2); f.children[1].emit('close', 0); assert.equal(f.state.jobs.software.status, 'success');
});
test('Cancel during preflight never spawns the cancelled client, including after another job starts', async t => {
  const checks = []; const f = fixture(t, { inspectPath: () => new Promise(resolve => checks.push(resolve)) });
  f.backups.enqueue('software', 'manual'); f.backups.cancel('software'); assert.equal(f.backups.busy, false);
  f.backups.enqueue('filme', 'manual'); checks[0]({ ok: true, mount: {} }); await tick(); assert.equal(f.children.length, 0); assert.equal(f.backups.active.folder, 'filme');
  checks[1]({ ok: true, mount: {} }); await tick(); assert.equal(f.children.length, 1); f.children[0].emit('close', 0);
});
test('Cancelling one queued job keeps other jobs running', async t => {
  const f = fixture(t); f.backups.enqueue('software', 'manual'); f.backups.enqueue('filme', 'manual'); f.backups.enqueue('musik', 'manual');
  f.backups.cancel('filme'); await tick(); assert.deepEqual(f.backups.queue, ['musik']); assert.equal(f.state.jobs.software.status, 'running');
  f.children[0].emit('close', 0); await tick(); assert.equal(f.backups.active.folder, 'musik'); f.children[1].emit('close', 0);
});

test('All backups are queued once in source order and continue after a failed run', async t => {
  const f = fixture(t); const result = f.backups.enqueueAll();
  assert.deepEqual(result.added, ['software','filme','serien','hoerspiele','musik','daten']); assert.deepEqual(result.skipped, []);
  assert.deepEqual(f.backups.queue, result.added.slice(1));
  const repeated = f.backups.enqueueAll(); assert.deepEqual(repeated.added, []); assert.equal(repeated.skipped.length, 6);
  await tick(); assert.equal(f.children.length, 1); f.children[0].emit('close', 1); await tick(); assert.equal(f.backups.active.folder, 'filme'); assert.equal(f.children.length, 2);
  f.backups.cancelAll(); f.children[1].emit('close', null, 'SIGTERM'); assert.equal(f.backups.busy, false);
});
test('All backups skip missing target credentials and maintenance never partially enqueues', t => {
  const config = validateConfig({ repository: '', password: '', fingerprint: '', namespace: '', schedules: {}, authEnabled: false }, { password: '' });
  const f = fixture(t, { getConfig: () => config }); const result = f.backups.enqueueAll(); assert.deepEqual(result.added, []); assert.equal(result.skipped.length, 6); assert.equal(f.backups.busy, false);
  const maintenance = fixture(t, { isMaintenance: () => true }); assert.throws(() => maintenance.backups.enqueueAll(), { status: 409 }); assert.equal(maintenance.backups.busy, false);
});
