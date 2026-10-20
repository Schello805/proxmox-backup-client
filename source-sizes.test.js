'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSourceSizes } = require('./lib/source-sizes');
const source = { path: '/mnt/Daten/Filme', expectedSource: '//nas/Filme' };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('Größenscan läuft im Hintergrund, seriell und verwendet den Cache', async () => {
  let scans = 0, finish;
  const sizes = createSourceSizes({ inspectPath: async () => ({ ok: true }), run: async (cmd, args) => {
    scans++;
    assert.equal(cmd, 'du'); assert.equal(args.at(-1), source.path);
    return new Promise(resolve => { finish = resolve; });
  } });
  assert.equal(sizes.read(source, true).status, 'scanning');
  await tick();
  assert.equal(sizes.read({ ...source, path: '/mnt/Daten/Musik' }, true).status, 'pending');
  assert.equal(scans, 1);
  finish({ stdout: '1073741824\t/mnt/Daten/Filme\n' }); await tick();
  assert.equal(sizes.read(source, true).bytes, 1073741824);
  assert.equal(scans, 1);
  assert.equal(sizes.read(source, false).bytes, null);
});
test('Größenscan startet nicht während Backups und verwirft Teilergebnisse', async () => {
  let busy = true, scans = 0, time = 0;
  const sizes = createSourceSizes({ now: () => time, isBusy: () => busy, inspectPath: async () => ({ ok: true }), run: async () => { scans++; throw new Error('Permission denied'); } });
  assert.equal(sizes.read(source, true).status, 'pending');
  busy = false; sizes.read(source, true); await tick();
  assert.equal(sizes.read(source, true).status, 'error'); assert.equal(scans, 1);
  time = 15 * 60_000; sizes.read(source, true); await tick(); assert.equal(scans, 2);
});
test('Fehlende Mounts werden vor rekursiver Größenmessung abgefangen', async () => {
  const sizes = createSourceSizes({ inspectPath: async () => ({ ok: false }), run: async () => { assert.fail('Kein Scan ohne Mount'); } });
  sizes.read(source, true); await tick(); assert.equal(sizes.read(source, true).status, 'error');
});
