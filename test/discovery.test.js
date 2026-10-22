'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDiscovery } = require('../lib/discovery');
test('Mount-Erkennung bietet neue Netzwerkfreigaben an und registriert keine Quelle automatisch', async () => {
  const config = { sources: [{ path: '/mnt/Daten/Daten' }] };
  const mount = (id, target, type = 'cifs') => `${id} 1 0:${id} / ${target} rw - ${type} //nas/Share rw`;
  const discovery = createDiscovery({ getConfig: () => config, readMountinfo: async () => [mount(2, '/mnt/Daten/Daten'), mount(3, '/mnt/Daten/Daten/Nested'), mount(4, '/mnt/Daten/Fotos'), mount(5, '/mnt/Daten/Fotos/Nested'), mount(6, '/mnt/Daten/Local', 'ext4'), mount(7, '/mnt/Daten2/Wrong')].join('\n') });
  assert.equal(discovery.current().candidates.length, 0);
  const result = await discovery.refresh(); assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].path, '/mnt/Daten/Fotos'); assert.equal(config.sources.length, 1);
  config.sources.push({ path: '/mnt/Daten/Fotos' }); assert.equal(discovery.current().candidates.length, 0);
});
test('Fehlgeschlagene Mount-Erkennung wird ausdrücklich gemeldet', async () => {
  const discovery = createDiscovery({ getConfig: () => ({ sources: [] }), readMountinfo: async () => { throw new Error('no proc'); } });
  assert.ok((await discovery.refresh()).error); assert.deepEqual(discovery.current().candidates, []);
});
