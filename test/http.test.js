'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
test('HTTP: Auth, Secret-Schutz, persistente Konfiguration und fehlende Mounts', async t => {
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qnap-test-'));
 const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, APP_PASSWORD: 'integration-password', HOST: '127.0.0.1', PORT: '0', CONFIG_FILE: path.join(tmp, 'config.json'), DATA_DIR: tmp }, stdio: ['ignore', 'pipe', 'pipe'] });
 t.after(async () => { child.kill('SIGTERM'); if (child.exitCode === null) await once(child, 'exit'); fs.rmSync(tmp, { recursive: true, force: true }); });
 const url = await new Promise((resolve, reject) => {
   const timer = setTimeout(() => reject(new Error('Serverstart überschritten')), 5000);
   child.stdout.on('data', data => { const match = data.toString().match(/http:\/\/127.0.0.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } });
   child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server beendet: ${code}`)); });
 });
 const headers = { Authorization: `Basic ${Buffer.from('admin:integration-password').toString('base64')}` };
 const post = (route, data, extra = {}) => fetch(url + route, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'X-Requested-With': 'qnap-dashboard', ...extra }, body: JSON.stringify(data) });
 assert.equal((await fetch(url + '/api/status')).status, 401);
 assert.equal((await fetch(url + '/config.json', { headers })).status, 404);
 assert.equal((await fetch(url + '/server.js', { headers })).status, 404);
 assert.equal((await fetch(url + '/', { headers })).status, 200);
 const initial = await (await fetch(url + '/api/status', { headers })).json();
 assert.equal(initial.folders.length, 5); assert.equal(initial.config.password, '');
 const config = { ...initial.config, repository: 'backup@pbs@localhost:store', password: 'test-secret' };
 assert.equal((await post('/api/config', config, { Origin: 'https://evil.example' })).status, 403);
 assert.equal((await post('/api/config', config)).status, 200);
 assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'config.json'))).password, 'test-secret');
 const statusText = await (await fetch(url + '/api/status', { headers })).text();
 assert.ok(!statusText.includes('test-secret')); assert.equal(JSON.parse(statusText).config.hasPassword, true);
 assert.equal((await post('/api/backup/unknown', {})).status, 400);
 if (os.platform() !== 'linux') {
   assert.equal((await post('/api/backup/software', {})).status, 202);
   let state;
   for (let n = 0; n < 30; n++) { state = JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'))); if (state.jobs.software?.status === 'failed') break; await new Promise(resolve => setTimeout(resolve, 30)); }
   assert.equal(state.jobs.software.status, 'failed'); assert.ok(state.jobs.software.error.includes('Mount'));
 }
});
