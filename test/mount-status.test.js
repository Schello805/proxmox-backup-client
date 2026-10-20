'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { createMountStatus } = require('../lib/mount-status');
const tick = () => new Promise(resolve => setImmediate(resolve));
test('Slow SMB checks never hold refresh; concurrent requests coalesce and changed mounts invalidate cached success', async () => {
  const source = { path: '/mnt/Daten/Daten', expectedSource: '//nas/Daten' };
  let actual = '//nas/Daten', mountId = 10, calls = 0, finish;
  const service = createMountStatus({ readMountinfo: async () => `${mountId} 1 0:10 / ${source.path} rw - cifs ${actual} rw`, inspectPath: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  let rows = await service.read([source], true); assert.equal(rows[0].checking, true); assert.equal(rows[0].ok, false);
  await service.read([source], true); await service.read([source]); assert.equal(calls, 1);
  finish({ ok: true, mount: { id: '10', device: '0:10', root: '/', target: source.path, type: 'cifs', source: actual } }); await tick();
  rows = await service.read([source]); assert.equal(rows[0].ok, true); assert.ok(rows[0].checkedAt);
  actual = '//nas/Software'; rows = await service.read([source]); assert.equal(rows[0].ok, false); assert.match(rows[0].error, /stimmt nicht/); assert.equal(rows[0].mount.source, '//nas/Software');
  actual = '//nas/Daten'; mountId++; rows = await service.read([source]); assert.equal(rows[0].ok, false); assert.equal(rows[0].checking, true); assert.equal(calls, 2);
  finish({ ok: false, error: 'Zeitlimit' }); await tick(); rows = await service.read([source]); assert.equal(rows[0].checking, false); assert.equal(rows[0].error, 'Zeitlimit'); assert.equal(calls, 2);
});
