'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSourceSizes } = require('./lib/source-sizes');
const source = { path: '/mnt/Daten/Filme', expectedSource: '//nas/Filme' };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('Größenscans laufen seriell und halten Ergebnisse verschiedener Pfade getrennt', async () => {
  const paths = [], finishes = [];
  const sizes = createSourceSizes({ inspectPath: async () => ({ ok: true }), run: async (_, args) => {
    paths.push(args.at(-1)); return new Promise(resolve => finishes.push(resolve));
  } });
  assert.equal(sizes.read(source, true).status, 'scanning'); await tick();
  const music = { ...source, path: '/mnt/Daten/Musik' };
  assert.equal(sizes.read(music, true).status, 'pending'); assert.equal(paths.length, 1);
  finishes[0]({ stdout: '1073741824\t/mnt/Daten/Filme\n' }); await tick();
  assert.equal(sizes.read(source, true).bytes, 1073741824); assert.equal(paths.length, 2);
  finishes[1]({ stdout: '2147483648\t/mnt/Daten/Musik\n' }); await tick();
  assert.equal(sizes.read(music, true).bytes, 2147483648); assert.equal(sizes.peek(source).bytes, 1073741824);
  assert.equal(sizes.read(source, false).bytes, null); assert.equal(sizes.peek(source), null);
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

test('Geänderte oder neu eingehängte SMB-Mounts verwerfen alte Größen sofort', async () => {
  let mount = { id: '1', device: '0:1', source: '//nas/Software', root: '/', target: source.path, type: 'cifs' }, bytes = 48;
  const sizes = createSourceSizes({ inspectPath: async () => ({ ok: true, mount }), run: async () => ({ stdout: `${bytes}\t${source.path}\n` }) });
  sizes.read({ ...source, mount }, true); await tick(); assert.equal(sizes.peek({ ...source, mount }).bytes, 48);
  mount = { ...mount, id: '2', source: '//nas/Daten' }; bytes = 200;
  assert.equal(sizes.peek({ ...source, mount }), null);
  assert.equal(sizes.read({ ...source, mount }, true).bytes, null); await tick();
  assert.equal(sizes.read({ ...source, mount }, true).bytes, 200);
  mount = { ...mount, id: '3' }; assert.equal(sizes.read({ ...source, mount }, true).bytes, null); await tick();
  assert.equal(sizes.read({ ...source, mount }, true).bytes, 200);
});
test('Manuelles Aktualisieren verwirft verspätete Ergebnisse abgebrochener Scans', async () => {
  const finishes = [], signals = [];
  const sizes = createSourceSizes({ inspectPath: async () => ({ ok: true }), run: async (_, args, options) => { signals.push(options.signal); return new Promise(resolve => finishes.push(resolve)); } });
  sizes.read(source, true); await tick(); sizes.invalidate();
  assert.equal(signals[0].aborted, true); assert.equal(sizes.read(source, true).bytes, null);
  finishes[0]({ stdout: `48\t${source.path}\n` }); await tick();
  assert.equal(sizes.read(source, true).bytes, null);
  finishes[1]({ stdout: `200\t${source.path}\n` }); await tick(); assert.equal(sizes.read(source, true).bytes, 200);
});
test('Während der Messung geänderter Mount und falscher Ergebnispfad gelten nicht als gültige Summe', async () => {
  let mount = { id: '1' };
  const sizes = createSourceSizes({ inspectPath: async () => ({ ok: true, mount }), run: async () => { mount = { id: '2' }; return { stdout: `48\t${source.path}\n` }; } });
  sizes.read({ ...source, mount }, true); await tick(); assert.equal(sizes.peek({ ...source, mount }), null);
  const wrong = createSourceSizes({ inspectPath: async () => ({ ok: true }), run: async () => ({ stdout: '48\t/mnt/Daten/Software\n' }) });
  wrong.read(source, true); await tick(); assert.equal(wrong.read(source, true).status, 'error');
});
test('Entfernte Quellen werden nicht später aus der Größen-Warteschlange gelesen', async () => {
  let finish; const paths = [];
  const sizes = createSourceSizes({ inspectPath: async () => ({ ok: true }), run: async (_, args) => { paths.push(args.at(-1)); return new Promise(resolve => { finish = resolve; }); } });
  sizes.read(source, true); await tick(); sizes.read({ ...source, path: '/mnt/Daten/Musik' }, true);
  sizes.retain([source]); finish({ stdout: `100\t${source.path}\n` }); await tick();
  assert.deepEqual(paths, [source.path]); assert.equal(sizes.peek(source).bytes, 100);
});
